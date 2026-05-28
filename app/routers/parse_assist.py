"""
parse_assist.py — /api/parse/assist/edit, /api/parse/assist/trip
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import Optional, Any
from app.database import get_db
from app.models.models import Segment, Trip
from app.routers.deps import get_current_user
from app.routers.parse_core import _verify_trip_ownership, client
from sqlalchemy import text
import os, json, re

router = APIRouter(prefix="/api/parse", tags=["parse"])


# ── Edit segment assistant endpoint ──────────────────────────────────────────

class EditAssistRequest(BaseModel):
    segment: dict
    history: list
    message: str
    trip_segments: list = []

class EditAssistResponse(BaseModel):
    message: str
    updates: dict

@router.post("/assist/edit", response_model=EditAssistResponse)
async def edit_assist(body: EditAssistRequest):
    # Build trip context from other segments
    trip_ctx = ""
    if body.trip_segments:
        other = [s for s in body.trip_segments if s.get("type")]
        if other:
            lines_ctx = []
            for s in sorted(other, key=lambda x: x.get("departs_at") or ""):
                dep = (s.get("departs_at") or "")[:16].replace("T", " ")
                arr = (s.get("arrives_at") or "")[:16].replace("T", " ")
                lines_ctx.append(
                    f"  - {s['type']}: {s.get('origin','?')}→{s.get('destination','?')} "
                    f"{dep}{(' → '+arr) if arr else ''} [{s.get('carrier','')}]"
                )
            trip_ctx = "\n\nOTHER SEGMENTS IN THIS TRIP (use for context):\n" + "\n".join(lines_ctx)

    system = f"""You are helping edit a travel segment. Current state: {json.dumps(body.segment)}.{trip_ctx}

The user wants to update one or more fields. Respond with a JSON object:
{{
  "message": "short confirmation e.g. Done! Set seat to 12A.",
  "updates": {{
    "origin": null, "destination": null, "carrier": null,
    "airline": null, "flight_number": null, "flight_iata": null,
    "departs_date": null, "departs_time": null,
    "arrives_date": null, "arrives_time": null,
    "confirmation_ref": null, "notes": null, "confirmed": null
  }}
}}
Only include fields in updates that should change. Omit null fields.
Use DD.MM.YYYY for dates, HH:MM for times.
If user gives a flight number like LX966 → set flight_number=LX966, airline=Swiss (infer from IATA prefix).
Seat/terminal/gate → append to existing notes, don't replace.
Vague time references like "after my train ride" or "after arriving" → look at OTHER SEGMENTS to find the relevant train/flight arriving at the same city, use its arrives_at time + 30min as the new departs_time.
For "mark as confirmed" → confirmed=true. For "unconfirm" → confirmed=false.
If user asks to SEARCH FOR A CONNECTION or train between two places → set action="search_connection" and include from_station, to_station, and either datetime or arrive_before in the updates object.
Respond ONLY with the JSON object, no markdown fences."""

    messages = list(body.history) + [{"role": "user", "content": body.message}]

    try:
        r = client.chat.completions.create(
            model="gpt-4o", temperature=0,
            messages=[{"role": "system", "content": system}] + messages,
            response_format={"type": "json_object"},
        )
        raw = r.choices[0].message.content
        parsed = json.loads(raw)
        return EditAssistResponse(
            message=parsed.get("message", "Done!"),
            updates={k: v for k, v in parsed.get("updates", {}).items() if v is not None}
        )
    except Exception as e:
        raise HTTPException(500, f"Assistant error: {e}")

class TripAssistRequest(BaseModel):
    message: str

class TripAssistResponse(BaseModel):
    message: str
    name: Optional[str] = None
    start_date: Optional[str] = None
    end_date: Optional[str] = None

@router.post("/assist/trip", response_model=TripAssistResponse)
async def trip_assist(body: TripAssistRequest):
    from datetime import date
    today = str(date.today())
    system = f"""Extract trip details from a natural language description. Today is {today}.
Return ONLY a JSON object:
{{
  "message": "short confirmation e.g. Got it! Berlin trip 3–7 June 2026.",
  "name": "trip name e.g. Berlin Trip",
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD"
}}
Infer reasonable dates if partial info given (e.g. "June" → use current year).
If duration not specified, default to 4 days.
Name should be concise: city + optional label (e.g. "Berlin", "Tokyo Conference", "Egypt Holiday").
Respond ONLY with the JSON object."""

    try:
        r = client.chat.completions.create(
            model="gpt-4o", temperature=0,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": body.message}
            ],
            response_format={"type": "json_object"},
        )
        parsed = json.loads(r.choices[0].message.content)
        return TripAssistResponse(
            message=parsed.get("message", "Done!"),
            name=parsed.get("name"),
            start_date=parsed.get("start_date"),
            end_date=parsed.get("end_date"),
        )
    except Exception as e:
        raise HTTPException(500, f"Trip assistant error: {e}")


