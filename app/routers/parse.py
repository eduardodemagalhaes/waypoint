from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models.models import Segment, Trip
from app.schemas.schemas import SegmentOut
import os, json, re, httpx
from openai import OpenAI

router = APIRouter(prefix="/api/parse", tags=["parse"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

AVIATIONSTACK_BASE = "http://api.aviationstack.com/v1/flights"

SYSTEM = """Extract travel data from natural language. Return ONLY JSON:
{"type":"flight|hotel|train|car|activity|other",
"origin":"city or airport code","destination":"city or airport code",
"carrier":"airline name and flight number e.g. Swiss LX392",
"flight_iata":"IATA flight code only e.g. LX392 or null if not a flight",
"departs_at":"YYYY-MM-DDTHH:MM:00",
"departs_tz":"IANA tz e.g. Europe/Zurich","arrives_at":"YYYY-MM-DDTHH:MM:00 or null",
"arrives_tz":"IANA tz or null","confirmation_ref":"ref or null",
"confirmed":true,"meta":{"notes":"extra details or empty string"}}
Use year 2026 if no year is given. Infer timezone from city/airport."""


def aviationstack_lookup(flight_iata: str, flight_date: str) -> dict | None:
    """Call AviationStack and return the first matching flight, or None."""
    key = os.getenv("AVIATIONSTACK_KEY")
    if not key:
        return None
    try:
        resp = httpx.get(
            AVIATIONSTACK_BASE,
            params={"access_key": key, "flight_iata": flight_iata.upper(), "flight_date": flight_date},
            timeout=8,
        )
        resp.raise_for_status()
        data = resp.json().get("data", [])
        return data[0] if data else None
    except Exception:
        return None


def enrich_with_aviationstack(data: dict) -> tuple[dict, str]:
    """
    If GPT extracted a flight_iata, verify against AviationStack and
    overwrite departure/arrival fields with authoritative data.
    Returns (enriched_data, parse_status).
    """
    flight_iata = data.get("flight_iata")
    departs_at = data.get("departs_at", "")

    # Extract date portion from GPT's departs_at (YYYY-MM-DD)
    date_match = re.match(r"(\d{4}-\d{2}-\d{2})", departs_at)
    if not flight_iata or not date_match:
        return data, "ok"

    flight_date = date_match.group(1)
    f = aviationstack_lookup(flight_iata, flight_date)

    if f is None:
        # Couldn't verify — keep GPT data but flag for review
        return data, "needs_review"

    dep = f.get("departure", {})
    arr = f.get("arrival", {})

    # Overwrite with authoritative AviationStack values
    data["origin"] = dep.get("iata") or data.get("origin")
    data["destination"] = arr.get("iata") or data.get("destination")
    data["departs_at"] = dep.get("scheduled") or data.get("departs_at")
    data["departs_tz"] = dep.get("timezone") or data.get("departs_tz")
    data["arrives_at"] = arr.get("scheduled") or data.get("arrives_at")
    data["arrives_tz"] = arr.get("timezone") or data.get("arrives_tz")

    # Enrich meta with terminal/gate info
    meta = data.get("meta", {})
    if dep.get("terminal"):
        meta["terminal_departure"] = dep["terminal"]
    if dep.get("gate"):
        meta["gate_departure"] = dep["gate"]
    if arr.get("terminal"):
        meta["terminal_arrival"] = arr["terminal"]
    meta["aviationstack_verified"] = True
    data["meta"] = meta

    return data, "ok"


class ParseRequest(BaseModel):
    text: str
    trip_id: str


@router.post("/text", response_model=SegmentOut, status_code=201)
def parse_text(body: ParseRequest, db: Session = Depends(get_db)):
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")

    r = client.chat.completions.create(
        model="gpt-4o",
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": SYSTEM},
            {"role": "user", "content": body.text},
        ],
    )
    data = json.loads(r.choices[0].message.content)

    # Enrich flights with AviationStack
    parse_status = "ok"
    if data.get("type") == "flight":
        data, parse_status = enrich_with_aviationstack(data)

    cols = Segment.__table__.columns.keys()
    seg = Segment(
        trip_id=body.trip_id,
        parse_status=parse_status,
        **{k: v for k, v in data.items() if k in cols},
    )
    seg.meta = data.get("meta", {})
    db.add(seg)
    db.commit()
    db.refresh(seg)
    return seg
