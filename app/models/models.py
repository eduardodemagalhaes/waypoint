from sqlalchemy import Column, String, DateTime, Boolean, Text, JSON, ForeignKey
from sqlalchemy.orm import relationship
from datetime import datetime, timezone
import uuid
from app.database import Base

def new_uuid():
    return str(uuid.uuid4())

class Trip(Base):
    __tablename__ = "trips"
    id            = Column(String, primary_key=True, default=new_uuid)
    name          = Column(String, nullable=False)
    start_date    = Column(String, nullable=True)
    end_date      = Column(String, nullable=True)
    location      = Column(String, nullable=True)
    description   = Column(String, nullable=True)
    home_currency = Column(String, default="CHF")
    created_at    = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    segments   = relationship("Segment",  back_populates="trip", cascade="all, delete-orphan")
    raw_emails = relationship("RawEmail", back_populates="trip", cascade="all, delete-orphan")

class Segment(Base):
    __tablename__ = "segments"
    id               = Column(String, primary_key=True, default=new_uuid)
    trip_id          = Column(String, ForeignKey("trips.id"), nullable=False)
    raw_email_id     = Column(String, ForeignKey("raw_emails.id"), nullable=True)
    type             = Column(String, nullable=False, default="other")
    departs_at       = Column(String, nullable=True)
    departs_tz       = Column(String, nullable=True)
    arrives_at       = Column(String, nullable=True)
    arrives_tz       = Column(String, nullable=True)
    origin           = Column(String, nullable=True)
    destination      = Column(String, nullable=True)
    carrier          = Column(String, nullable=True)
    confirmation_ref = Column(String, nullable=True)
    confirmed        = Column(Boolean, default=False)
    parse_status     = Column(String, default="ok")
    meta             = Column(JSON, default=dict)
    next_segment_id  = Column(String, ForeignKey("segments.id"), nullable=True)
    created_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    updated_at = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    trip      = relationship("Trip", back_populates="segments")
    raw_email = relationship("RawEmail", back_populates="segments")

class RawEmail(Base):
    __tablename__ = "raw_emails"
    id           = Column(String, primary_key=True, default=new_uuid)
    trip_id      = Column(String, ForeignKey("trips.id"), nullable=True)
    message_id   = Column(String, nullable=True, unique=True)
    from_address = Column(String, nullable=True)
    subject      = Column(String, nullable=True)
    body_text    = Column(Text, nullable=True)
    body_html    = Column(Text, nullable=True)
    has_pdf      = Column(Boolean, default=False)
    parse_status = Column(String, default="pending")
    received_at  = Column(DateTime, default=lambda: datetime.now(timezone.utc))
    trip     = relationship("Trip", back_populates="raw_emails")
    segments = relationship("Segment", back_populates="raw_email")
