"""
auth.py — Registration + email verification
Routes:
  POST /api/auth/register        → create unverified user, send confirmation email
  GET  /api/auth/verify-email    → verify token, activate account
"""
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel, EmailStr
from datetime import datetime, timezone, timedelta
import uuid, bcrypt, os

from app.database import get_db
from app.routers.email_templates import _email_template, send_verification_email, send_reset_email
from sqlalchemy import text

router = APIRouter(prefix="/api/auth", tags=["auth"])

FRONTEND_URL = os.getenv("FRONTEND_URL", "https://test.waypoint.emdm.ch")
FROM_EMAIL   = os.getenv("FROM_EMAIL", "trip.helper@emdm.ch")
TOKEN_EXPIRY_HOURS = 24


# ── helpers ────────────────────────────────────────────────────────────────────

from app.routers.email_templates import send_email, _email_template, send_verification_email, send_reset_email

def create_token(db: Session, user_id: str, token_type: str) -> str:
    token = uuid.uuid4().hex + uuid.uuid4().hex  # 64-char random token
    expires = (datetime.now(timezone.utc) + timedelta(hours=TOKEN_EXPIRY_HOURS)).isoformat()
    token_id = str(uuid.uuid4())
    db.execute(text("INSERT INTO email_tokens (id, user_id, token, type, expires_at) VALUES (:id, :uid, :tok, :type, :exp)"),
        {"id": token_id, "uid": user_id, "tok": token, "type": token_type, "exp": expires}
    )
    db.commit()
    return token



# ── models ─────────────────────────────────────────────────────────────────────

class RegisterRequest(BaseModel):
    email: EmailStr
    password: str


# ── routes ─────────────────────────────────────────────────────────────────────
class ForgotRequest(BaseModel):
    email: EmailStr

class ResetRequest(BaseModel):
    token: str
    password: str


@router.post("/register")
async def register(body: RegisterRequest, db: Session = Depends(get_db)):
    # Validate
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    # Derive username from email local part
    username = body.email.split("@")[0].lower()

    # Check duplicates
    existing = db.execute(text("SELECT id FROM users WHERE email=:email"),
        {"email": body.email}
    ).mappings().fetchone()
    if existing:
        raise HTTPException(409, "An account with that email already exists")

    # Create user
    now = datetime.now(timezone.utc).isoformat()
    user_id = str(uuid.uuid4())
    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    db.execute(text("""INSERT INTO users (id, username, email, password_hash, is_verified, is_admin, created_at, updated_at)
           VALUES (:id, :username, :email, :pw, 0, 0, :now, :now)"""),
        {"id": user_id, "username": username, "email": body.email, "pw": pw_hash, "now": now}
    )
    db.commit()

    # Send verification email
    token = create_token(db, user_id, "verify")
    send_verification_email(body.email, username, token)

    return {"ok": True, "message": "Account created — check your email to confirm."}


@router.get("/verify-email", response_class=HTMLResponse)
async def verify_email(token: str, db: Session = Depends(get_db)):
    now = datetime.now(timezone.utc).isoformat()

    row = db.execute(text("SELECT * FROM email_tokens WHERE token=:tok AND type='verify'"),
        {"tok": token}
    ).mappings().fetchone()

    if not row:
        return _verify_page("Invalid link", "This verification link is invalid.", success=False)

    if row["used_at"]:
        return _verify_page("Already verified", "Your email is already confirmed. You can log in.", success=True)

    if row["expires_at"] < now:
        return _verify_page("Link expired", "This link has expired. Please register again.", success=False)

    # Mark token used + verify user
    db.execute(text("UPDATE email_tokens SET used_at=:now WHERE id=:id"), {"now": now, "id": row["id"]})
    db.execute(text("UPDATE users SET is_verified=1, updated_at=:now WHERE id=:uid"), {"now": now, "uid": row["user_id"]})
    db.commit()

    return _verify_page("Email confirmed ✦", "Your account is active. You can now log in to Waypoint.", success=True)


def _verify_page(title: str, message: str, success: bool) -> str:
    color = "#6c63ff" if success else "#e74c3c"
    login_url = FRONTEND_URL
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>{title}</title>
<style>body{{font-family:sans-serif;display:flex;justify-content:center;align-items:center;
min-height:100vh;margin:0;background:#0f0f1a;color:#e0e0e0}}
.card{{text-align:center;padding:48px 40px;background:#1a1a2e;border-radius:16px;max-width:400px}}
h2{{color:{color};margin-bottom:16px}} p{{color:#aaa;margin-bottom:32px}}
a{{display:inline-block;padding:12px 28px;background:{color};color:#fff;
border-radius:8px;text-decoration:none;font-weight:bold}}</style></head>
<body><div class="card">
  <h2>{title}</h2><p>{message}</p>
  <a href="{login_url}">Go to Waypoint</a>
</div></body></html>"""


# ── LOGIN / LOGOUT / ME ────────────────────────────────────────────────────────

from fastapi import Response, Cookie
from typing import Optional

SESSION_SECRET   = os.getenv("SESSION_SECRET", "changeme")
COOKIE_NAME      = "wp_session"
COOKIE_MAX_AGE   = 60 * 60 * 24 * 30   # 30 days
COOKIE_SECURE    = os.getenv("FRONTEND_URL", "").startswith("https")

from itsdangerous import URLSafeTimedSerializer, BadSignature, SignatureExpired
_signer = URLSafeTimedSerializer(SESSION_SECRET)

def make_session(user_id: str) -> str:
    return _signer.dumps(user_id)

def decode_session(token: str) -> Optional[str]:
    try:
        return _signer.loads(token, max_age=COOKIE_MAX_AGE)
    except (BadSignature, SignatureExpired):
        return None


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


@router.post("/login")
async def login(body: LoginRequest, response: Response, db: Session = Depends(get_db)):
    row = db.execute(
        text("SELECT id, username, email, password_hash, is_verified, is_admin, is_disabled FROM users WHERE email=:email"),
        {"email": body.email}
    ).mappings().fetchone()

    if not row:
        raise HTTPException(401, "Invalid email or password")
    if not bcrypt.checkpw(body.password.encode(), row["password_hash"].encode()):
        raise HTTPException(401, "Invalid email or password")
    if not row["is_verified"]:
        raise HTTPException(403, "Please verify your email address before logging in")
    if row["is_disabled"]:
        raise HTTPException(403, "This account has been disabled")

    token = make_session(row["id"])
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=COOKIE_SECURE,
        samesite="lax"
    )
    return {
        "ok": True,
        "user": {
            "id": row["id"],
            "username": row["username"],
            "email": row["email"],
            "is_admin": bool(row["is_admin"])
        }
    }


@router.post("/logout")
async def logout(response: Response):
    response.delete_cookie(COOKIE_NAME)
    return {"ok": True}


@router.get("/me")
async def me(request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")
    user_id = decode_session(token)
    if not user_id:
        raise HTTPException(401, "Session expired")

    row = db.execute(
        text("SELECT id, username, email, is_admin, home_city, home_airports FROM users WHERE id=:id"),
        {"id": user_id}
    ).mappings().fetchone()
    if not row:
        raise HTTPException(401, "User not found")

    return {
        "id":            row["id"],
        "username":      row["username"],
        "email":         row["email"],
        "is_admin":      bool(row["is_admin"]),
        "home_city":     row["home_city"] or "",
        "home_airports": row["home_airports"] or "",
    }




class ProfileUpdate(BaseModel):
    home_city:     Optional[str] = None
    home_airports: Optional[str] = None  # comma-separated IATAs, max 3

@router.patch("/profile")
async def update_profile(body: ProfileUpdate, request: Request, db: Session = Depends(get_db)):
    token = request.cookies.get(COOKIE_NAME)
    if not token:
        raise HTTPException(401, "Not authenticated")
    user_id = decode_session(token)
    if not user_id:
        raise HTTPException(401, "Session expired")

    # Clean + validate airports: strip whitespace, uppercase, max 3
    airports_clean = ""
    if body.home_airports is not None:
        codes = [c.strip().upper() for c in body.home_airports.replace(",", " ").split() if c.strip()]
        codes = [c for c in codes if len(c) <= 4][:3]
        airports_clean = ",".join(codes)

    now = datetime.now(timezone.utc).isoformat()
    updates = {}
    if body.home_city is not None:
        updates["home_city"] = body.home_city.strip()
    if body.home_airports is not None:
        updates["home_airports"] = airports_clean

    if updates:
        set_clause = ", ".join(f"{k}=:{k}" for k in updates)
        updates["id"] = user_id
        updates["now"] = now
        db.execute(text(f"UPDATE users SET {set_clause}, updated_at=:now WHERE id=:id"), updates)
        db.commit()

    row = db.execute(
        text("SELECT id, username, email, is_admin, home_city, home_airports FROM users WHERE id=:id"),
        {"id": user_id}
    ).mappings().fetchone()
    return {
        "id":            row["id"],
        "username":      row["username"],
        "email":         row["email"],
        "is_admin":      bool(row["is_admin"]),
        "home_city":     row["home_city"] or "",
        "home_airports": row["home_airports"] or "",
    }

# ── FORGOT / RESET PASSWORD ────────────────────────────────────────────────────

RESET_EXPIRY_HOURS = 1
@router.post("/forgot-password")
async def forgot_password(body: ForgotRequest, db: Session = Depends(get_db)):
    # Always return same response to avoid user enumeration
    row = db.execute(
        text("SELECT id, username, email FROM users WHERE email=:email AND is_verified=1"),
        {"email": body.email}
    ).mappings().fetchone()

    if row:
        # Invalidate any existing unused reset tokens for this user
        db.execute(
            text("UPDATE email_tokens SET used_at=:now WHERE user_id=:uid AND type='reset' AND used_at IS NULL"),
            {"now": datetime.now(timezone.utc).isoformat(), "uid": row["id"]}
        )
        db.commit()

        token = create_token(db, row["id"], "reset")
        # Override expiry to 1h
        expires = (datetime.now(timezone.utc) + timedelta(hours=RESET_EXPIRY_HOURS)).isoformat()
        db.execute(
            text("UPDATE email_tokens SET expires_at=:exp WHERE token=:tok"),
            {"exp": expires, "tok": token}
        )
        db.commit()
        send_reset_email(row["email"], row["username"], token)

    return {"ok": True, "message": "If that email is registered, a reset link has been sent."}


@router.post("/reset-password")
async def reset_password(body: ResetRequest, db: Session = Depends(get_db)):
    if len(body.password) < 8:
        raise HTTPException(400, "Password must be at least 8 characters")

    now = datetime.now(timezone.utc).isoformat()
    row = db.execute(
        text("SELECT * FROM email_tokens WHERE token=:tok AND type='reset'"),
        {"tok": body.token}
    ).mappings().fetchone()

    if not row:
        raise HTTPException(400, "Invalid reset link")
    if row["used_at"]:
        raise HTTPException(400, "This reset link has already been used")
    if row["expires_at"] < now:
        raise HTTPException(400, "This reset link has expired — please request a new one")

    pw_hash = bcrypt.hashpw(body.password.encode(), bcrypt.gensalt()).decode()

    db.execute(
        text("UPDATE users SET password_hash=:pw, updated_at=:now WHERE id=:uid"),
        {"pw": pw_hash, "now": now, "uid": row["user_id"]}
    )
    db.execute(
        text("UPDATE email_tokens SET used_at=:now WHERE id=:id"),
        {"now": now, "id": row["id"]}
    )
    db.commit()

    return {"ok": True, "message": "Password updated — you can now log in."}
