from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional
from app.database import get_db
from app.routers.auth import _email_template
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
    """Send a branded reply when sender is not a registered user."""
    register_url = FRONTEND_URL
    subject = "Waypoint — we don't recognise this email address"
    body_text = (
        f"Hi,\n\n"
        f"We received your forwarded email but couldn't match {to} to a Waypoint account.\n\n"
        f"To use Waypoint, register at:\n{register_url}\n\n"
        f"Once registered, forward your travel confirmation emails to waypoint@emdm.ch "
        f"and we'll build your itinerary automatically.\n\n"
        f"— Waypoint"
    )
    body_html = (
        "<p style=\"margin:0 0 12px;font-size:15px;color:#4a4540;line-height:1.7;\">"
        "  We received your forwarded email but couldn&#39;t find a Waypoint account"
        f" registered to <strong style=\"color:#1a1814\">{to}</strong>."
        "</p>"
        "<p style=\"margin:0;font-size:15px;color:#4a4540;line-height:1.7;\">"
        "  Create a free account — make sure to register with this exact email address."
        "  Once you&#39;re in, forward any travel confirmation to"
        "  <strong style=\"color:#1a1814\">waypoint@emdm.ch</strong>"
        "  and we&#39;ll build your itinerary automatically."
        "</p>"
    )
    html = _email_template(
        heading="Email not recognised",
        body_html=body_html,
        cta_url=register_url,
        cta_label="Create your account",
        footnote="You're receiving this because someone forwarded a travel confirmation from this address to waypoint@emdm.ch."
    )
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"]    = f"Waypoint <{FROM_EMAIL}>"
        msg["To"]      = to
        msg.attach(MIMEText(body_text, "plain"))
        msg.attach(MIMEText(html, "html"))
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



# ── Ingest confirmation reply ─────────────────────────────────────────────────

SEGMENT_ICONS = {
    "flight":   "✈",
    "train":    "🚄",
    "hotel":    "🏨",
    "car":      "🚗",
    "activity": "🎟",
    "other":    "📌",
}

def _fmt_segment_row(seg_data: dict) -> str:
    """One-line summary of a segment for the reply email."""
    icon  = SEGMENT_ICONS.get(seg_data.get("type", "other"), "📌")
    typ   = (seg_data.get("type") or "segment").capitalize()
    orig  = seg_data.get("origin") or ""
    dest  = seg_data.get("destination") or ""
    route = f"{orig} → {dest}" if orig and dest else (orig or dest or "")
    date  = ""
    dep   = seg_data.get("departs_at") or seg_data.get("check_in") or ""
    if dep and "T" in dep:
        date = dep[:10]
    elif dep:
        date = dep[:10]
    carrier = seg_data.get("carrier") or seg_data.get("hotel_name") or ""
    ref     = seg_data.get("confirmation_ref") or ""

    parts = [p for p in [route, carrier, ref] if p]
    detail = " · ".join(parts)
    line = f"{icon} {typ}"
    if date:    line += f" &nbsp;·&nbsp; {date}"
    if detail:  line += f" &nbsp;·&nbsp; {detail}"
    return line


def send_ingest_reply(to: str, status: str, subject: str,
                      segments_data: list = None, trip_name: str = None,
                      error: str = None):
    """Reply to sender summarising what Waypoint did with their forwarded email."""
    app_url = FRONTEND_URL
    reply_subject = f"Re: {subject}" if subject else "Your Waypoint itinerary update"

    if status == "ok" and segments_data:
        count = len(segments_data)
        heading = f"Added {count} segment{'s' if count > 1 else ''} to your itinerary"
        trip_line = (
            f'<p style="margin:0 0 20px;font-size:13px;color:#8a847c;">'
            f'Trip: <strong style="color:#4a4540">{trip_name}</strong></p>'
        ) if trip_name else ""
        seg_rows = "".join(
            '<li style="padding:6px 0;border-bottom:1px solid #e0d8cc;'
            'font-size:14px;color:#4a4540;">'
            + _fmt_segment_row(s) + "</li>"
            for s in segments_data
        )
        body_html = (
            '<p style="margin:0 0 16px;font-size:15px;color:#4a4540;line-height:1.7;">'
            "We parsed your forwarded email and added the following to Waypoint:"
            "</p>"
            + trip_line
            + '<ul style="margin:0 0 8px;padding:0;list-style:none;">'
            + seg_rows + "</ul>"
        )
        plain = (
            f"We parsed your forwarded email and added {count} segment(s) to Waypoint"
            + (f" ({trip_name})" if trip_name else "") + ":\n\n"
            + "\n".join(
                "  - " + _fmt_segment_row(s).replace("&nbsp;", " ").replace("·", "|")
                for s in segments_data
            )
            + f"\n\nView your trip: {app_url}\n\n— Waypoint"
        )
        footnote = "Questions or corrections? Reply to this email or edit directly in Waypoint."

    elif status == "no_segments":
        heading = "We couldn\u2019t find any travel details"
        body_html = (
            '<p style="margin:0 0 16px;font-size:15px;color:#4a4540;line-height:1.7;">'
            "We received your forwarded email but couldn\u2019t extract any travel segments from it."
            "</p>"
            '<p style="margin:0;font-size:15px;color:#4a4540;line-height:1.7;">'
            "This can happen with heavily formatted emails or scanned documents. "
            "You can add segments manually in the app, or try forwarding a plain-text version."
            "</p>"
        )
        plain = (
            "We received your forwarded email but couldn't extract any travel segments.\n\n"
            "You can add segments manually in the app, or try forwarding a plain-text version.\n\n"
            f"Open Waypoint: {app_url}\n\n\u2014 Waypoint"
        )
        footnote = "If this keeps happening, reply to this email and we\u2019ll take a look."

    elif status == "no_trip":
        heading = "Couldn\u2019t match your email to a trip"
        body_html = (
            '<p style="margin:0 0 16px;font-size:15px;color:#4a4540;line-height:1.7;">'
            "We parsed your email but couldn\u2019t find a matching trip in your account."
            "</p>"
            '<p style="margin:0;font-size:15px;color:#4a4540;line-height:1.7;">'
            "Open Waypoint to create a trip first, then forward the email again \u2014 "
            "or add the segment manually."
            "</p>"
        )
        plain = (
            "We parsed your email but couldn't find a matching trip in your account.\n\n"
            "Create a trip in Waypoint first, then forward the email again.\n\n"
            f"Open Waypoint: {app_url}\n\n\u2014 Waypoint"
        )
        footnote = "Need help? Reply to this email."

    else:
        heading = "Something went wrong"
        body_html = (
            '<p style="margin:0 0 16px;font-size:15px;color:#4a4540;line-height:1.7;">'
            "We received your email but ran into a problem while processing it."
            "</p>"
            '<p style="margin:0;font-size:15px;color:#4a4540;line-height:1.7;">'
            "Please try forwarding it again, or add your travel details manually in the app."
            "</p>"
        )
        plain = (
            "We received your email but ran into a problem processing it.\n\n"
            "Please try forwarding it again, or add your travel details manually.\n\n"
            f"Open Waypoint: {app_url}\n\n\u2014 Waypoint"
        )
        footnote = "If this keeps happening, reply to this email and we\u2019ll investigate."

    html = _email_template(
        heading=heading,
        body_html=body_html,
        cta_url=app_url,
        cta_label="Open Waypoint",
        footnote=footnote,
    )
    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = reply_subject
        msg["From"]    = f"Waypoint <{FROM_EMAIL}>"
        msg["To"]      = to
        msg["Reply-To"] = "Waypoint <waypoint@emdm.ch>"
        msg.attach(MIMEText(plain, "plain"))
        msg.attach(MIMEText(html, "html"))
        with smtplib.SMTP("localhost") as s:
            s.sendmail(FROM_EMAIL, [to], msg.as_string())
    except Exception as e:
        import logging
        logging.getLogger("waypoint").warning(f"Could not send ingest reply to {to}: {e}")


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
        send_ingest_reply(sender_clean, "failed", body.subject)
        return IngestResponse(ok=False, message_id=body.message_id, parse_status="failed", error=str(e))
    if not segments_data:
        raw.parse_status = "no_segments"; db.commit()
        send_ingest_reply(sender_clean, "no_segments", body.subject)
        return IngestResponse(ok=True, message_id=body.message_id, parse_status="no_segments", segments_created=0)
    trip_id = body.trip_id
    if not trip_id:
        trip = find_best_trip(db, segments_data, user_id=user["id"])
        trip_id = trip.id if trip else None
    if not trip_id:
        raw.parse_status = "failed"; db.commit()
        send_ingest_reply(sender_clean, "no_trip", body.subject)
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
    trip_obj = db.query(Trip).filter(Trip.id == trip_id).first()
    send_ingest_reply(
        to=sender_clean,
        status="ok",
        subject=body.subject,
        segments_data=segments_data,
        trip_name=trip_obj.name if trip_obj else None,
    )
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
