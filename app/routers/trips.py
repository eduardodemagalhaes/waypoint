from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Trip
from app.schemas.schemas import TripCreate, TripUpdate, TripOut

router = APIRouter(prefix="/api/trips", tags=["trips"])

@router.get("/", response_model=list[TripOut])
def list_trips(db: Session = Depends(get_db)):
    return db.query(Trip).order_by(Trip.created_at.desc()).all()

@router.post("/", response_model=TripOut, status_code=201)
def create_trip(body: TripCreate, db: Session = Depends(get_db)):
    trip = Trip(**body.model_dump())
    db.add(trip); db.commit(); db.refresh(trip)
    return trip

@router.get("/{trip_id}", response_model=TripOut)
def get_trip(trip_id: str, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip: raise HTTPException(404, "Trip not found")
    return trip

@router.patch("/{trip_id}", response_model=TripOut)
def update_trip(trip_id: str, body: TripUpdate, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip: raise HTTPException(404, "Trip not found")
    for k, v in body.model_dump(exclude_unset=True).items():
        setattr(trip, k, v)
    db.commit(); db.refresh(trip)
    return trip

@router.delete("/{trip_id}", status_code=204)
def delete_trip(trip_id: str, db: Session = Depends(get_db)):
    trip = db.query(Trip).filter(Trip.id == trip_id).first()
    if not trip: raise HTTPException(404, "Trip not found")
    db.delete(trip); db.commit()
