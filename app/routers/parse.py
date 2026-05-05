from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from pydantic import BaseModel
from app.database import get_db
from app.models.models import Segment, Trip
from app.schemas.schemas import SegmentOut
import os, json
from openai import OpenAI

router = APIRouter(prefix="/api/parse", tags=["parse"])
client = OpenAI(api_key=os.getenv("OPENAI_API_KEY"))

SYSTEM = """Extract travel data from natural language. Return ONLY JSON:
{"type":"flight|hotel|train|car|activity|other",
"origin":"city or airport code","destination":"city or airport code",
"carrier":"name and number","departs_at":"YYYY-MM-DDTHH:MM:00",
"departs_tz":"IANA tz e.g. Europe/Zurich","arrives_at":"YYYY-MM-DDTHH:MM:00 or null",
"arrives_tz":"IANA tz or null","confirmation_ref":"ref or null",
"confirmed":true,"meta":{"notes":"extra details or empty string"}}
Use year 2026 if no year is given. Infer timezone from city/airport."""

class ParseRequest(BaseModel):
    text: str
    trip_id: str

@router.post("/text", response_model=SegmentOut, status_code=201)
def parse_text(body: ParseRequest, db: Session = Depends(get_db)):
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")
    r = client.chat.completions.create(
        model="gpt-4o", temperature=0,
        response_format={"type": "json_object"},
        messages=[{"role":"system","content":SYSTEM},
                  {"role":"user","content":body.text}]
    )
    data = json.loads(r.choices[0].message.content)
    cols = Segment.__table__.columns.keys()
    seg = Segment(trip_id=body.trip_id, parse_status="ok",
                  **{k:v for k,v in data.items() if k in cols})
    seg.meta = data.get("meta", {})
    db.add(seg); db.commit(); db.refresh(seg)
    return seg
