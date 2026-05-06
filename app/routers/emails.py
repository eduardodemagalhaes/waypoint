from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.models import RawEmail, Segment, Trip
from app.schemas.schemas import SegmentOut
import os, json, re
from openai import OpenAI

router = APIRouter(prefix="/api/emails", tags=["emails"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM = """Extract ALL travel segments from this booking confirmation email.
Return a JSON array of segments. Each segment:
{
  "type": "flight|hotel|train|car|activity|other",
  "origin": "city or IATA code",
  "destination": "city or IATA code or null",
  "carrier": "airline/hotel/operator name and number",
  "flight_iata": "e.g. LX392 or null",
  "departs_at": "YYYY-MM-DDTHH:MM:00",
  "departs_tz": "IANA timezone",
  "arrives_at": "YYYY-MM-DDTHH:MM:00 or null",
  "arrives_tz": "IANA timezone or null",
  "confirmation_ref": "booking ref or null",
  "confirmed": true,
  "meta": {"notes": ""}
}
Rules:
- Extract every segment (outbound + return flights, hotel check-in, transfers)
- Set confirmed=true for all (it is a booking confirmation)
- Infer IANA timezone from city/airport
- Use the year from the email; if missing use 2026
- Return [] if no travel data found
- Return ONLY the JSON array, no other text
"""


def find_best_trip(db: Session, segments: list[dict]) -> Optional[Trip]:
    """
    Match segments to the most relevant upcoming trip by date proximity.
    Falls back to the soonest upcoming trip.
    """
    trips = db.query(Trip).all()
    if not trips:
        return None

    # Try to find a trip whose date range overlaps with any segment date
    seg_dates = []
    for s in segments:
        d = (s.get("departs_at") or "")[:10]
        if d:
            seg_dates.append(d)

    if seg_dates:
        first_date = min(seg_dates)
        for trip in sorted(trips, key=lambda t: t.start_date or ""):
            if trip.start_date and trip.end_date:
                if trip.start_date <= first_date <= trip.end_date:
                    return trip
            if trip.start_date and abs(
                (first_date[:7] == (trip.start_date or "")[:7])
            ):
                return trip  # same month

    # Fallback: soonest upcoming trip
    from datetime import date
    today = str(date.today())
    upcoming = [t for t in trips if (t.start_date or "") >= today]
    if upcoming:
        return min(upcoming, key=lambda t: t.start_date)
    return trips[0]


# ── Pydantic models ──────────────────────────────────────────────────────────

class IngestRequest(BaseModel):
    message_id: str
    from_address: str
    subject: str
    body_text: str
    trip_id: Optional[str] = None    # override auto-detection


class IngestResponse(BaseModel):
    ok: bool
    message_id: str
    trip_id: Optional[str] = None
    segments_created: int = 0
    parse_status: str = "ok"
    error: Optional[str] = None


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/ingest", response_model=IngestResponse)
def ingest_email(body: IngestRequest, db: Session = Depends(get_db)):
    """
    Receive a parsed email (from the Postfix pipe script),
    extract travel segments via GPT-4o, and save them.
    """
    # Deduplicate by message_id
    existing = db.query(RawEmail).filter(
        RawEmail.message_id == body.message_id
    ).first()
    if existing:
        return IngestResponse(
            ok=True, message_id=body.message_id,
            parse_status="duplicate",
            error="Already processed"
        )

    # Store the raw email
    raw = RawEmail(
        message_id=body.message_id,
        from_address=body.from_address,
        subject=body.subject,
        body_text=body.body_text,
        parse_status="processing",
    )
    db.add(raw)
    db.flush()

    # Call GPT-4o
    try:
        r = client.chat.completions.create(
            model="gpt-4o",
            temperature=0,
            response_format={"type": "json_object"},
            messages=[
                {"role": "system", "content": SYSTEM},
                {"role": "user", "content": f"Subject: {body.subject}\n\n{body.body_text}"},
            ],
        )
        raw_content = r.choices[0].message.content
        # GPT returns {"segments": [...]} or directly [...] — handle both
        parsed = json.loads(raw_content)
        if isinstance(parsed, list):
            segments_data = parsed
        elif "segments" in parsed:
            segments_data = parsed["segments"]
        elif "type" in parsed:
            segments_data = [parsed]  # single segment object
        else:
            # try any list value
            segments_data = next((v for v in parsed.values() if isinstance(v,list)),[])
        # normalise whatever schema GPT returned
        segments_data = normalise_segments(segments_data)
    except Exception as e:
        raw.parse_status = "failed"
        db.commit()
        return IngestResponse(
            ok=False, message_id=body.message_id,
            parse_status="failed", error=str(e)
        )

    if not segments_data:
        raw.parse_status = "no_segments"
        db.commit()
        return IngestResponse(
            ok=True, message_id=body.message_id,
            parse_status="no_segments", segments_created=0
        )

    # Find the right trip
    trip_id = body.trip_id
    if not trip_id:
        trip = find_best_trip(db, segments_data)
        trip_id = trip.id if trip else None

    if not trip_id:
        raw.parse_status = "failed"
        db.commit()
        return IngestResponse(
            ok=False, message_id=body.message_id,
            parse_status="failed", error="No trip found to assign segments to"
        )

    raw.trip_id = trip_id

    # Create segments
    cols = Segment.__table__.columns.keys()
    created = 0
    for seg_data in segments_data:
        seg = Segment(
            trip_id=trip_id,
            raw_email_id=raw.id,
            parse_status="ok",
            **{k: v for k, v in seg_data.items() if k in cols},
        )
        seg.meta = seg_data.get("meta", {})
        seg.meta["source"] = "email"
        db.add(seg)
        created += 1

    raw.parse_status = "ok"
    db.commit()

    return IngestResponse(
        ok=True,
        message_id=body.message_id,
        trip_id=trip_id,
        segments_created=created,
        parse_status="ok",
    )


@router.get("/review")
def get_review_emails(db: Session = Depends(get_db)):
    """Return emails that failed or need review."""
    emails = db.query(RawEmail).filter(
        RawEmail.parse_status.in_(["failed", "needs_review", "no_segments"])
    ).order_by(RawEmail.created_at.desc()).limit(50).all()
    return emails

def _last(s): return s.strip().split()[-1] if s and s.strip() else None
def _dt(s): return s if s and "T" in str(s) else (s if s else None)

def normalise_segments(raw):
    out=[]
    for s in raw:
        n={"type":s.get("type","flight"),"confirmed":True,"meta":s.get("meta",{"notes":""})}
        n["origin"]=s.get("origin") or _last(s.get("departure_airport",""))
        n["destination"]=s.get("destination") or _last(s.get("arrival_airport",""))
        n["carrier"]=s.get("carrier") or s.get("airline") or s.get("flight_number")
        n["flight_iata"]=s.get("flight_iata") or s.get("flight_number")
        n["departs_at"]=_dt(s.get("departs_at") or s.get("departure_time"))
        n["departs_tz"]=s.get("departs_tz") or s.get("departure_timezone")
        n["arrives_at"]=_dt(s.get("arrives_at") or s.get("arrival_time"))
        n["arrives_tz"]=s.get("arrives_tz") or s.get("arrival_timezone")
        n["confirmation_ref"]=s.get("confirmation_ref") or s.get("reference") or s.get("booking_ref")
        out.append(n)
    return out
