from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Trip
from app.schemas.schemas import TripCreate, TripUpdate, TripOut, TripListOut
from app.routers.deps import get_current_user

router = APIRouter(prefix="/api/trips", tags=["trips"])


def _owned_trip(trip_id: str, user: dict, db: Session) -> Trip:
    """Fetch a trip and verify it belongs to the current user."""
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip:
        raise HTTPException(404, "Trip not found")
    if trip.user_id != user["id"]:
        raise HTTPException(403, "Not your trip")
    return trip


@router.get("/", response_model=list[TripListOut])
def list_trips(db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return (
        db.query(Trip)
        .filter(Trip.user_id == user["id"])
        .order_by(Trip.created_at.desc())
        .all()
    )


@router.post("/", response_model=TripOut, status_code=201)
def create_trip(body: TripCreate, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    trip = Trip(**body.model_dump(), user_id=user["id"])
    db.add(trip); db.commit(); db.refresh(trip)
    return trip


@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    return _owned_trip(trip_id, user, db)


@router.patch("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: str, body: TripUpdate, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    trip = _owned_trip(trip_id, user, db)
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(trip, k, v)
    db.commit(); db.refresh(trip)
    return trip


@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: str, db: Session = Depends(get_db), user: dict = Depends(get_current_user)):
    trip = _owned_trip(trip_id, user, db)
    db.delete(trip); db.commit()
