from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import RawEmail
from app.schemas.schemas import RawEmailOut

router = APIRouter(prefix="/api/emails", tags=["emails"])

@router.get("/review", response_model=list[RawEmailOut])
def emails_needing_review(db: Session = Depends(get_db)):
    return (
        db.query(RawEmail)
        .filter(RawEmail.parse_status.in_(["needs_review", "failed"]))
        .order_by(RawEmail.received_at.desc())
        .all()
    )

@router.get("/", response_model=list[RawEmailOut])
def list_emails(trip_id: str | None = None, db: Session = Depends(get_db)):
    q = db.query(RawEmail)
    if trip_id:
        q = q.filter(RawEmail.trip_id == trip_id)
    return q.order_by(RawEmail.received_at.desc()).all()
