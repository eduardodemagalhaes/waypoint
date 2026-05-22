"""
deps.py — shared FastAPI dependencies
"""
from fastapi import Request, HTTPException, Depends
from sqlalchemy.orm import Session
from sqlalchemy import text
from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
from app.database import get_db
import os

COOKIE_NAME   = "wp_session"
COOKIE_MAX_AGE = 60 * 60 * 24 * 30

def _decode_session(token: str):
    secret = os.getenv("SESSION_SECRET", "changeme")
    try:
        return URLSafeTimedSerializer(secret).loads(token, max_age=COOKIE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None

def get_current_user(request: Request, db: Session = Depends(get_db)) -> dict:
    """Dependency: returns current user dict or raises 401."""
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")
    user_id = _decode_session(token)
    if not user_id:
        raise HTTPException(401, "Session expired")
    row = db.execute(
        text("SELECT id, username, email, is_admin FROM users WHERE id=:id"),
        {"id": user_id}
    ).mappings().fetchone()
    if not row:
        raise HTTPException(401, "User not found")
    return dict(row)

def get_current_user_optional(request: Request, db: Session = Depends(get_db)):
    """Like get_current_user but returns None instead of raising (for legacy token fallback)."""
    try:
        return get_current_user(request, db)
    except HTTPException:
        return None
