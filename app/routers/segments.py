from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Segment, Trip
from app.schemas.schemas import SegmentCreate, SegmentUpdate, SegmentOut

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
def create_segment(body: SegmentCreate, db: Session = Depends(get_db)):
    if not db.query(Trip).filter(Trip.id == body.trip_id).first():
        raise HTTPException(404, "Trip not found")
    seg = Segment(**body.model_dump())
    db.add(seg); db.commit(); db.refresh(seg)
    return seg

@router.get("/{segment_id}", response_model=SegmentOut)
def get_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    return seg

@router.patch("/{segment_id}", response_model=SegmentOut)
def update_segment(segment_id: str, body: SegmentUpdate, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(seg, k, v)
    db.commit(); db.refresh(seg)
    return seg

@router.delete("/{segment_id}", status_code=204)
def delete_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg: raise HTTPException(404, "Segment not found")
    db.delete(seg); db.commit()
