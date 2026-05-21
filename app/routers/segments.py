from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from sqlalchemy.orm import Session
from app.database import get_db, SessionLocal
from app.models.models import Segment, Trip
from app.schemas.schemas import SegmentCreate, SegmentUpdate, SegmentOut
from app.routers.enrich import _enrich_segment
import asyncio
import logging

log = logging.getLogger("waypoint.segments")

async def _bg_enrich(segment_id: str):
    """Run enrichment in background after segment create/update."""
    db = SessionLocal()
    try:
        seg = db.query(Segment).filter(Segment.id == segment_id).first()
        if not seg:
            return
        enrichment = await _enrich_segment(seg)
        if enrichment.get("enrich_status") not in ("skipped", None):
            meta = dict(seg.meta or {})
            meta.update(enrichment)
            seg.meta = meta
            db.commit()
            log.info("auto-enriched segment %s (%s) → %s", segment_id[:8], seg.type, enrichment.get("enrich_status"))
    except Exception as e:
        log.warning("auto-enrich failed for %s: %s", segment_id[:8], e)
    finally:
        db.close()

def schedule_enrich(bg: BackgroundTasks, segment_id: str):
    # Use create_task so we stay within the running event loop
    bg.add_task(_run_enrich, segment_id)

async def _run_enrich(segment_id: str):
    await _bg_enrich(segment_id)

router = APIRouter(prefix="/api/segments", tags=["segments"])

@router.get("/", response_model=list[SegmentOut])
def list_segments(trip_id: str, db: Session = Depends(get_db)):
    return (
        db.query(Segment)
        .filter(Segment.trip_id == trip_id)
        .order_by(Segment.departs_at.asc())
        .all()
    )

@router.post("/", response_model=SegmentOut, status_code=201)
def create_segment(body: SegmentCreate, bg: BackgroundTasks, db: Session = Depends(get_db)):
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")
    seg = Segment(**body.model_dump())
    db.add(seg); db.commit(); db.refresh(seg)
    schedule_enrich(bg, seg.id)
    return seg

@router.get("/{segment_id}", response_model=SegmentOut)
def get_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    return seg

@router.patch("/{segment_id}", response_model=SegmentOut)
def update_segment(segment_id: str, body: SegmentUpdate, bg: BackgroundTasks, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(seg, k, v)
    db.commit(); db.refresh(seg)
    schedule_enrich(bg, seg.id)
    return seg

@router.delete("/{segment_id}", status_code=204)
def delete_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    db.delete(seg); db.commit()
