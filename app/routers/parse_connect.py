"""
parse_connect.py — /api/parse/connections/search
"""
from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
from app.routers.parse_core import client
import os, json, re, httpx

router = APIRouter(prefix="/api/parse", tags=["parse"])


# ── Connection search endpoint ────────────────────────────────────────────────

class ConnectionSearchRequest(BaseModel):
    from_station: str
    to_station: str
    datetime: Optional[str] = None      # "YYYY-MM-DD HH:MM" depart after
    arrive_before: Optional[str] = None  # "YYYY-MM-DD HH:MM" arrive before
    context: Optional[str] = None        # natural language request for AI interpretation

class ConnectionSearchResponse(BaseModel):
    connections: list = []
    source: Optional[str] = None
    fallback: Optional[dict] = None
    ai_summary: Optional[str] = None

@router.post("/connections/search", response_model=ConnectionSearchResponse)
async def search_connections_endpoint(body: ConnectionSearchRequest):
    from app.routers.enrich import search_connections as _search

    result = await _search(
        from_station=body.from_station,
        to_station=body.to_station,
        datetime_str=body.datetime or "",
        arrive_before=body.arrive_before,
    )

    # Generate AI summary
    ai_summary = None
    if result["connections"]:
        conns = result["connections"][:3]
        lines = []
        for i, c in enumerate(conns, 1):
            plat = f" (platform {c['platform_dep']})" if c.get('platform_dep') else ""
            xfer = f", {c['transfers']} transfer{'s' if c['transfers']!=1 else ''}" if c.get('transfers') else ""
            lines.append(f"{i}. {c['carrier'] or 'Train'}{plat}: departs {c['departs']}, arrives {c['arrives']} ({c['duration'].replace('00d','').strip()}{ xfer})")
        ai_summary = "\n".join(lines)
    elif result.get("fallback"):
        fb = result["fallback"]
        suggestions = fb.get("suggestions", [])
        parts = []
        for s in suggestions:
            if s["type"] == "taxi":
                parts.append(s["label"])
            else:
                parts.append(f"{s['label']}: {s['url']}")
        ai_summary = "No live connections found. Options:\n" + "\n".join(f"• {p}" for p in parts)

    return ConnectionSearchResponse(
        connections=result["connections"],
        source=result["source"],
        fallback=result["fallback"],
        ai_summary=ai_summary,
    )

