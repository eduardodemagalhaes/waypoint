from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any
from app.database import get_db
from app.models.models import Segment, Trip
from app.schemas.schemas import SegmentOut
import os, json, re, httpx
from openai import OpenAI

router = APIRouter(prefix="/api/parse", tags=["parse"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

AVIATIONSTACK_BASE = "http://api.aviationstack.com/v1/flights"

# ── one-shot system prompt (kept for /parse/text backward compat) ────────────

SYSTEM_ONESHOT = """Extract travel data from natural language. Return ONLY JSON:
{"type":"flight|hotel|train|car|activity|other",
"origin":"city or airport code","destination":"city or airport code",
"carrier":"airline name and flight number e.g. Swiss LX392",
"flight_iata":"IATA flight code only e.g. LX392 or null if not a flight",
"departs_at":"YYYY-MM-DDTHH:MM:00",
"departs_tz":"IANA tz e.g. Europe/Zurich","arrives_at":"YYYY-MM-DDTHH:MM:00 or null",
"arrives_tz":"IANA tz or null","confirmation_ref":"ref or null",
"confirmed":true,"meta":{"notes":"extra details or empty string"}}
Use year 2026 if no year is given. Infer timezone from city/airport."""

# ── dialog system prompt ─────────────────────────────────────────────────────

SYSTEM_DIALOG = """You are a travel data assistant helping fill in a trip itinerary entry.

Your job:
1. Extract whatever travel information is present in the user's message.
2. Identify what important fields are still missing or ambiguous.
3. Ask ONE focused question to fill the most important gap — or, if you have enough, mark it ready.

Important fields by type:
- flight: origin, destination, departs_at (date+time), carrier/flight number
- hotel: origin (location), carrier (hotel name), departs_at (check-in date), meta.nights (number of nights)
- train: origin, destination, departs_at
- car: origin (pick-up), departs_at (pick-up date)
- activity: origin (location), carrier (activity name), departs_at (date)

Rules:
- Ask only ONE question per turn — the most important missing piece.
- Be brief and direct. No preamble like "Sure!" or "Of course!".
- If the type is ambiguous, ask that first.
- Once you have enough for a complete, accurate entry, set status to "ready".
- Always return valid JSON and nothing else.

Return this exact JSON structure:
{
  "status": "question" or "ready",
  "question": "Your single question here (only when status=question)",
  "draft": {
    "type": "flight|hotel|train|car|activity|other",
    "origin": "string or null",
    "destination": "string or null",
    "carrier": "string or null",
    "flight_iata": "IATA code only e.g. LX392 or null",
    "departs_at": "YYYY-MM-DDTHH:MM:00 or null",
    "departs_tz": "IANA timezone or null",
    "arrives_at": "YYYY-MM-DDTHH:MM:00 or null",
    "arrives_tz": "IANA timezone or null",
    "confirmation_ref": "string or null",
    "confirmed": false,
    "meta": {"notes": "", "nights": null}
  },
  "missing": ["list", "of", "still-uncertain", "fields"]
}

Use year 2026 if no year given. Infer IANA timezone from city or airport name."""

# ── AviationStack ────────────────────────────────────────────────────────────

def aviationstack_lookup(flight_iata: str, flight_date: str):
    """
    Returns (flight_data_or_None, limitation_note_or_None).
    limitation_note is a user-friendly explanation when the free tier can't help.
    """
    key = os.getenv("AVIATIONSTACK_KEY")
    if not key:
        return None, "AviationStack key not configured on this server."

    try:
        resp = httpx.get(
            AVIATIONSTACK_BASE,
            params={"access_key": key, "flight_iata": flight_iata.upper(), "flight_date": flight_date},
            timeout=8,
        )
    except httpx.TimeoutException:
        return None, "Flight lookup timed out — AviationStack didn't respond in time."
    except httpx.HTTPError as e:
        return None, f"Could not reach AviationStack: {e}"

    if resp.status_code == 403:
        return None, (
            "Waypoint uses the AviationStack free tier, which only supports live flight lookups "
            "— date filtering is a paid feature. Flight times are estimated from what you typed."
        )
    if resp.status_code != 200:
        return None, f"AviationStack returned an unexpected error (HTTP {resp.status_code})."

    data = resp.json().get("data", [])
    if not data:
        return None, (
            "No live data found for this flight right now. Waypoint uses the AviationStack free tier, "
            "which only covers currently active flights — future or past flights don't appear. "
            "Flight times are estimated from what you typed."
        )

    return data[0], None


def enrich_with_aviationstack(data: dict):
    """
    Try to verify and enrich a flight draft via AviationStack.
    Returns (enriched_data, parse_status, aviationstack_note).
    """
    flight_iata = data.get("flight_iata")
    departs_at = data.get("departs_at", "")
    date_match = re.match(r"(\d{4}-\d{2}-\d{2})", departs_at or "")

    if not flight_iata or not date_match:
        return data, "ok", None

    flight_date = date_match.group(1)
    f, limitation = aviationstack_lookup(flight_iata, flight_date)

    if limitation:
        return data, "needs_review", limitation

    dep = f.get("departure", {})
    arr = f.get("arrival", {})

    data["origin"] = dep.get("iata") or data.get("origin")
    data["destination"] = arr.get("iata") or data.get("destination")
    data["departs_at"] = dep.get("scheduled") or data.get("departs_at")
    data["departs_tz"] = dep.get("timezone") or data.get("departs_tz")
    data["arrives_at"] = arr.get("scheduled") or data.get("arrives_at")
    data["arrives_tz"] = arr.get("timezone") or data.get("arrives_tz")

    meta = data.get("meta", {})
    if dep.get("terminal"):
        meta["terminal_departure"] = dep["terminal"]
    if dep.get("gate"):
        meta["gate_departure"] = dep["gate"]
    if arr.get("terminal"):
        meta["terminal_arrival"] = arr["terminal"]
    meta["aviationstack_verified"] = True
    data["meta"] = meta

    return data, "ok", None


# ── Pydantic models ──────────────────────────────────────────────────────────

class ParseRequest(BaseModel):
    text: str
    trip_id: str

class DialogMessage(BaseModel):
    role: str        # "user" or "assistant"
    content: str

class DialogRequest(BaseModel):
    trip_id: str
    message: str
    history: list[DialogMessage] = []
    draft: Optional[dict[str, Any]] = None

class DialogResponse(BaseModel):
    status: str      # "question" | "ready"
    question: Optional[str] = None
    draft: Optional[dict[str, Any]] = None
    missing: list[str] = []
    aviationstack_note: Optional[str] = None
    history: list[DialogMessage] = []

class DialogConfirmRequest(BaseModel):
    trip_id: str
    draft: dict[str, Any]


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/text", response_model=SegmentOut, status_code=201)
def parse_text(body: ParseRequest, db: Session = Depends(get_db)):
    """One-shot NL parse — kept for backward compatibility."""
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")

    r = client.chat.completions.create(
        model="gpt-4o", temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM_ONESHOT},
            {"role": "user", "content": body.text},
        ],
    )
    data = json.loads(r.choices[0].message.content)
    parse_status, av_note = "ok", None
    if data.get("type") == "flight":
        data, parse_status, av_note = enrich_with_aviationstack(data)

    cols = Segment.__table__.columns.keys()
    seg = Segment(trip_id=body.trip_id, parse_status=parse_status,
                  **{k: v for k, v in data.items() if k in cols})
    seg.meta = data.get("meta", {})
    if av_note:
        seg.meta["aviationstack_note"] = av_note
    db.add(seg); db.commit(); db.refresh(seg)
    return seg


@router.post("/dialog", response_model=DialogResponse)
def parse_dialog(body: DialogRequest, db: Session = Depends(get_db)):
    """
    Multi-turn dialog. Frontend sends full history + draft each turn.
    GPT asks one question at a time until it has enough, then sets status=ready.
    No DB write happens here — that's done by /dialog/confirm.
    """
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")

    messages = [{"role": "system", "content": SYSTEM_DIALOG}]
    for m in body.history:
        messages.append({"role": m.role, "content": m.content})

    user_content = body.message
    if body.draft:
        user_content += f"\n\n[Draft so far: {json.dumps(body.draft)}]"
    messages.append({"role": "user", "content": user_content})

    r = client.chat.completions.create(
        model="gpt-4o", temperature=0,
        response_format={"type": "json_object"},
        messages=messages,
    )
    gpt = json.loads(r.choices[0].message.content)

    new_history = list(body.history) + [
        DialogMessage(role="user", content=body.message),
        DialogMessage(role="assistant", content=r.choices[0].message.content),
    ]

    status = gpt.get("status", "question")
    draft = gpt.get("draft", body.draft or {})
    av_note = None

    # Try AviationStack enrichment as soon as we hit ready on a flight
    if status == "ready" and draft.get("type") == "flight" and draft.get("flight_iata"):
        draft, _, av_note = enrich_with_aviationstack(draft)

    return DialogResponse(
        status=status,
        question=gpt.get("question"),
        draft=draft,
        missing=gpt.get("missing", []),
        aviationstack_note=av_note,
        history=new_history,
    )


@router.post("/dialog/confirm", response_model=SegmentOut, status_code=201)
def dialog_confirm(body: DialogConfirmRequest, db: Session = Depends(get_db)):
    """
    User approved the summary card — write the segment to DB.
    """
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")

    data = dict(body.draft)
    parse_status = data.pop("parse_status", "ok")
    av_note = data.pop("aviationstack_note", None)

    cols = Segment.__table__.columns.keys()
    seg = Segment(trip_id=body.trip_id, parse_status=parse_status,
                  **{k: v for k, v in data.items() if k in cols})
    seg.meta = data.get("meta", {})
    if av_note:
        seg.meta["aviationstack_note"] = av_note
    db.add(seg); db.commit(); db.refresh(seg)
    return seg
