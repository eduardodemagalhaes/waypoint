from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.models.models import RawEmail, Segment, Trip
from app.schemas.schemas import SegmentOut
import os, json, re, smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from sqlalchemy import text
from openai import OpenAI

router = APIRouter(prefix="/api/emails", tags=["emails"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

FROM_EMAIL   = os.getenv("FROM_EMAIL", "trip.helper@emdm.ch")
FRONTEND_URL = os.getenv("FRONTEND_URL", "https://waypoint.emdm.ch")

import re as _re
def _extract_email(addr: str) -> str:
    """Extract plain email from 'Name <email>' format."""
    m = _re.search(r'<([^>]+)>', addr)
    return (m.group(1) if m else addr).strip().lower()

def lookup_user_by_email(db, sender_email: str):
    """Return user row for a verified sender, or None."""
    clean = _extract_email(sender_email)
    row = db.execute(
        text("SELECT id, username, email FROM users WHERE LOWER(email)=:email AND is_verified=1"),
        {"email": clean}
    ).mappings().fetchone()
    return dict(row) if row else None

def send_unregistered_reply(to: str):
    """Send a friendly reply when sender is not a registered user."""
    register_url = f"{FRONTEND_URL}"
    subject = "Waypoint — we don't recognise this email address"
    body_text = f"""Hi,

We received your email but couldn't match it to a Waypoint account.

To use Waypoint, please register at:
{register_url}

Once registered, forward your travel confirmation emails to waypoint@emdm.ch and we'll parse them automatically.

— Waypoint
"""
    body_html = f"""
<div style="font-family:sans-serif;max-width:480px;margin:auto;padding:32px">
  <h2 style="color:#1a1a2e">We don't recognise this email ✦</h2>
  <p>We received your forwarded email but couldn't match <b>{to}</b> to a Waypoint account.</p>
  <p>To get started, create a free account — make sure to register with this email address.</p>
  <a href="{register_url}" style="display:inline-block;margin:24px 0;padding:12px 28px;
     background:#6c63ff;color:#fff;border-radius:8px;text-decoration:none;font-weight:bold">
    Create account
  </a>
  <p style="color:#888;font-size:13px">Once registered, forward any travel confirmation email to
     <b>waypoint@emdm.ch</b> and we'll build your itinerary automatically.</p>
</div>"""
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"Waypoint <{FROM_EMAIL}>"
        msg["To"]      = to
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(body_html, "html"))
        with smtplib.SMTP("localhost") as s:
            s.sendmail(FROM_EMAIL, [to], msg.as_string())
    except Exception as e:
        import logging; logging.getLogger("waypoint").warning(f"Could not send unregistered reply: {e}")

SYSTEM = """Extract ALL travel segments from this booking confirmation email.
You MUST return a JSON object with a single key "segments" whose value is an array.
Each element represents one travel segment with this structure:
{
  "type": "flight|hotel|train|car|activity|other",
  "origin": "city or IATA code",
  "destination": "city or IATA code or null",
  "carrier": "airline/hotel/operator name and number",
  "flight_iata": "IATA flight code only e.g. BA0579 or null",
  "departs_at": "YYYY-MM-DDTHH:MM:00",
  "departs_tz": "IANA timezone",
  "arrives_at": "YYYY-MM-DDTHH:MM:00 or null",
  "arrives_tz": "IANA timezone or null",
  "confirmation_ref": "booking ref or null",
  "confirmed": true,
  "meta": {
    "notes": "any extra info not captured elsewhere",
    "cabin_class": "Economy/Premium Economy/Business/First or null",
    "seat": "seat number e.g. 14A or null",
    "boarding_time": "HH:MM or null",
    "terminal_departure": "terminal at departure airport or null",
    "terminal_arrival": "terminal at arrival airport or null",
    "gate": "gate number or null",
    "baggage_allowance": "e.g. 1 bag 23kg or null",
    "fare_type": "e.g. World Traveller Plus or null",
    "ticket_number": "e-ticket number or null",
    "platform_departure": "platform number at departure station or null",
    "platform_arrival": "platform number at arrival station or null",
    "train_number": "e.g. EC 37 or null",
    "coach": "coach/carriage number or null",
    "class": "1st or 2nd or null",
    "address": "full street address for hotels or null",
    "phone": "hotel phone or null",
    "checkin_time": "HH:MM local e.g. 15:00 or null",
    "checkout_time": "HH:MM local e.g. 12:00 or null",
    "room_type": "e.g. 1 Queen Studio Suite or null",
    "nights": "number of nights or null",
    "rate_plan": "e.g. Reward Nights or null",
    "loyalty_points": "e.g. 50000 Points or null",
    "cancellation_policy": "brief summary or null",
    "price": "total price with currency e.g. CHF 2306.00 or null",
    "payment_card": "last 4 digits only e.g. **** 3679 or null"
  }
}
Rules:
- Extract EVERY segment — all flights each leg separately, each train leg separately, hotel check-in, transfers
- A 4-flight itinerary MUST produce 4 segment objects. A 2-leg train MUST produce 2 segment objects.
- For hotels: departs_at = check-in datetime, arrives_at = check-out datetime
- Set confirmed=true for all
- Infer IANA timezone from city/airport
- Use the year from the email; if missing use 2026
- Only set meta fields where data is present in the email — use null otherwise
- Return {"segments": []} if no travel data found
"""


def find_best_trip(db, segments, user_id: str = None):
    """
    Find the best trip for a set of segments based on date overlap.
    Scoped to user_id if provided.
    Priority: exact date range match > same month > closest upcoming > most recent.
    """
    q = db.query(Trip)
    if user_id:
        q = q.filter(Trip.user_id == user_id)
    trips = q.order_by(Trip.start_date).all()
    if not trips:
        return None
    if len(trips) == 1:
        return trips[0]

    seg_dates = sorted([(s.get("departs_at") or "")[:10]
                        for s in segments if (s.get("departs_at") or "")[:10]])
    if not seg_dates:
        from datetime import date
        today = str(date.today())
        upcoming = [t for t in trips if (t.start_date or "") >= today]
        return min(upcoming, key=lambda t: t.start_date) if upcoming else trips[-1]

    first_date = seg_dates[0]

    # 1. Exact overlap: first segment date falls within trip range
    for trip in trips:
        if trip.start_date and trip.end_date:
            if trip.start_date <= first_date <= trip.end_date:
                return trip

    # 2. Partial overlap: any segment date within any trip
    all_dates = set(seg_dates)
    for trip in trips:
        if trip.start_date and trip.end_date:
            if any(trip.start_date <= d <= trip.end_date for d in all_dates):
                return trip

    # 3. Same month as trip start
    for trip in trips:
        if trip.start_date and first_date[:7] == trip.start_date[:7]:
            return trip

    # 4. Closest trip by proximity to first segment date
    def proximity(t):
        if t.start_date:
            return abs((
                __import__('datetime').date.fromisoformat(first_date) -
                __import__('datetime').date.fromisoformat(t.start_date)
            ).days)
        return 9999

    return min(trips, key=proximity)


def call_gpt(subject, body_text):
    r = client.chat.completions.create(
        model="gpt-4o", temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": f"Subject: {subject}\n\n{body_text}"},
        ],
    )
    parsed = json.loads(r.choices[0].message.content)
    if isinstance(parsed, list):
        segments_data = parsed
    elif "segments" in parsed:
        segments_data = parsed["segments"]
    elif "type" in parsed:
        segments_data = [parsed]
    else:
        segments_data = next((v for v in parsed.values() if isinstance(v, list)), [])
    return normalise_segments(segments_data)


class IngestRequest(BaseModel):
    message_id: str
    from_address: str
    subject: str
    body_text: str
    trip_id: Optional[str] = None

class IngestResponse(BaseModel):
    ok: bool
    message_id: str
    trip_id: Optional[str] = None
    segments_created: int = 0
    parse_status: str = "ok"
    error: Optional[str] = None

class ReparseRequest(BaseModel):
    raw_email_id: str
    trip_id: Optional[str] = None


@router.post("/ingest", response_model=IngestResponse)
def ingest_email(body: IngestRequest, db: Session = Depends(get_db)):
    existing = db.query(RawEmail).filter(RawEmail.message_id == body.message_id).first()
    if existing:
        return IngestResponse(ok=True, message_id=body.message_id, parse_status="duplicate", error="Already processed")

    # ── Resolve sender to a user ───────────────────────────────────────────────
    sender_clean = _extract_email(body.from_address)
    user = lookup_user_by_email(db, sender_clean)
    if not user:
        send_unregistered_reply(sender_clean)
        return IngestResponse(ok=False, message_id=body.message_id,
                              parse_status="unregistered",
                              error=f"Sender {sender_clean} not registered")

    raw = RawEmail(message_id=body.message_id, from_address=body.from_address,
                   subject=body.subject, body_text=body.body_text, parse_status="processing")
    db.add(raw); db.flush()
    try:
        segments_data = call_gpt(body.subject, body.body_text)
    except Exception as e:
        raw.parse_status = "failed"; db.commit()
        return IngestResponse(ok=False, message_id=body.message_id, parse_status="failed", error=str(e))
    if not segments_data:
        raw.parse_status = "no_segments"; db.commit()
        return IngestResponse(ok=True, message_id=body.message_id, parse_status="no_segments", segments_created=0)
    trip_id = body.trip_id
    if not trip_id:
        trip = find_best_trip(db, segments_data, user_id=user["id"])
        trip_id = trip.id if trip else None
    if not trip_id:
        raw.parse_status = "failed"; db.commit()
        return IngestResponse(ok=False, message_id=body.message_id, parse_status="failed", error="No trip found for this user")
    raw.trip_id = trip_id
    cols = Segment.__table__.columns.keys()
    created = 0
    for seg_data in segments_data:
        seg = Segment(trip_id=trip_id, raw_email_id=raw.id, parse_status="ok",
                      **{k: v for k, v in seg_data.items() if k in cols})
        seg.meta = seg_data.get("meta", {}); seg.meta["source"] = "email"
        db.add(seg); created += 1
    raw.parse_status = "ok"; db.commit()
    return IngestResponse(ok=True, message_id=body.message_id, trip_id=trip_id, segments_created=created)


@router.post("/reparse", response_model=IngestResponse)
def reparse_email(body: ReparseRequest, db: Session = Depends(get_db)):
    raw = db.query(RawEmail).filter(RawEmail.id == body.raw_email_id).first()
    if not raw:
        raise HTTPException(404, "Raw email not found")
    db.query(Segment).filter(Segment.raw_email_id == raw.id).delete(); db.flush()
    try:
        segments_data = call_gpt(raw.subject or "", raw.body_text or "")
    except Exception as e:
        raw.parse_status = "failed"; db.commit()
        return IngestResponse(ok=False, message_id=raw.message_id, parse_status="failed", error=str(e))
    if not segments_data:
        raw.parse_status = "no_segments"; db.commit()
        return IngestResponse(ok=True, message_id=raw.message_id, parse_status="no_segments", segments_created=0)
    trip_id = body.trip_id or raw.trip_id
    if not trip_id:
        trip = find_best_trip(db, segments_data)
        trip_id = trip.id if trip else None
    if not trip_id:
        raw.parse_status = "failed"; db.commit()
        return IngestResponse(ok=False, message_id=raw.message_id, parse_status="failed", error="No trip found")
    raw.trip_id = trip_id
    cols = Segment.__table__.columns.keys()
    created = 0
    for seg_data in segments_data:
        seg = Segment(trip_id=trip_id, raw_email_id=raw.id, parse_status="ok",
                      **{k: v for k, v in seg_data.items() if k in cols})
        seg.meta = seg_data.get("meta", {}); seg.meta["source"] = "email"
        db.add(seg); created += 1
    raw.parse_status = "ok"; db.commit()
    return IngestResponse(ok=True, message_id=raw.message_id, trip_id=trip_id, segments_created=created)


@router.get("/review")
def get_review_emails(db: Session = Depends(get_db)):
    return db.query(RawEmail).filter(
        RawEmail.parse_status.in_(["failed", "needs_review", "no_segments"])
    ).order_by(RawEmail.received_at.desc()).limit(50).all()


def _last(s): return s.strip().split()[-1] if s and s.strip() else None
def _dt(s): return s if s and "T" in str(s) else (s if s else None)

def normalise_segments(raw):
    out = []
    for s in raw:
        n = {"type": s.get("type", "flight"), "confirmed": True, "meta": s.get("meta", {"notes": ""})}
        n["origin"] = s.get("origin") or _last(s.get("departure_airport", ""))
        n["destination"] = s.get("destination") or _last(s.get("arrival_airport", ""))
        n["carrier"] = s.get("carrier") or s.get("airline") or s.get("flight_number")
        n["flight_iata"] = s.get("flight_iata") or s.get("flight_number")
        n["departs_at"] = _dt(s.get("departs_at") or s.get("departure_time"))
        n["departs_tz"] = s.get("departs_tz") or s.get("departure_timezone")
        n["arrives_at"] = _dt(s.get("arrives_at") or s.get("arrival_time"))
        n["arrives_tz"] = s.get("arrives_tz") or s.get("arrival_timezone")
        n["confirmation_ref"] = s.get("confirmation_ref") or s.get("reference") or s.get("booking_ref")
        out.append(n)
    return out
