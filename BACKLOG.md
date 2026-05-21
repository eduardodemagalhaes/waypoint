# Waypoint — Project Backlog & Context

## Quick context for new sessions
- **Server**: Hetzner CX22, `178.104.227.162`, Ubuntu 24.04, user `eduardo`
- **App**: `/home/eduardo/waypoint/` — FastAPI + SQLite + OpenAI GPT-4o
- **Frontend**: `/home/eduardo/waypoint/static/index.html` — single-file vanilla JS
- **Service**: `sudo systemctl restart waypoint` — runs on `localhost:8000`
- **Domain**: `emdm.ch` via Nginx reverse proxy
- **Keys**: `.env` file has `OPENAI_API_KEY`, `AVIATIONSTACK_KEY`, `SECRET_TOKEN`
- **Stack**: Python venv at `venv/`, logs at `logs/dialog.log`

## Architecture notes
- Segments auto-enriched after every save (trains via transport.opendata.ch, flights via AviationStack free tier)
- Email ingest: forward to `waypoint@emdm.ch` → parsed by GPT-4o → segments created
- Connection search: `transport.opendata.ch` for Swiss/cross-border, fallback to taxi estimate + booking sites for German/other routes
- No auth yet — single user, protected by `SECRET_TOKEN` header

---

## Backlog

### 1. Multi-user & authentication
- User accounts: login/logout, password reset, email verification
- Each user sees only their own trips and segments
- Session management (JWT or session tokens)
- Admin view for Eduardo

### 2. Source email management
- Each user registers multiple "source emails" (work, personal, assistant, etc.)
- Each source email verified before activation (confirmation link)
- When `waypoint@emdm.ch` receives mail: identify sender → map to user → auto-assign to trip via `find_best_trip`
- Unknown sender → queue for review
- UI: "My email sources" settings page — add, verify, remove

### 3. Trip-level assistant
- Persistent chat panel at the trip level (not just segment add/edit)
- Answers questions about the whole trip: "what's my first flight?", "do I have a hotel in SP?"
- Makes multi-segment changes at once
- Full context: all segments, dates, notes, enrichment data
- Conversation history per trip

### 4. Segment maps
- Minimap thumbnail inside each expanded segment card
- Hotels: pin on exact OSM coordinates (from enrichment lat/lon)
- Flights & trains: both endpoints shown with a route line between them
- Click thumbnail → full map modal (no new browser window)
- **Blocked**: needs Leaflet.js — previous attempts with raw OSM tiles failed due to
  CORS on canvas, display:none timing (offsetWidth=0), and iframe scaling issues.
  Solution: use Leaflet.js loaded via CDN script tag in index.html.

### 5. Top-level trip creation assistant ✅ DONE
- Conversational planner at dashboard level builds full trip from scratch
- Lives at empty state + "✦ Plan with AI" in sidebar
- Endpoint: `POST /api/parse/plan`

### 6. Segment date guardrails
- When adding a segment (chatbot or form) outside the current trip's date range:
  show warning: "Update trip dates / Move to [matching trip] / Create new trip?"
- Applies to NL dialog and manual add form
- If another trip covers that date, suggest moving there

### 7. DB (Deutsche Bahn) connection search ✅ DONE
- Self-host `db-vendo-client` Docker container on the VPS:
  `docker run -e USER_AGENT=waypoint -e DB_PROFILE=dbnav -p 3000:3000 ghcr.io/public-transport/db-vendo-client`
- Wire into `search_connections()` in `app/routers/enrich.py` as second provider
  alongside `transport.opendata.ch`
- German domestic routes (e.g. Frankenthal Hbf → Mannheim Hbf) currently fall back
  to bahn.de link — this fixes that with live results
- Journey endpoint: `GET localhost:3000/journeys?from=8019073&to=8014008&departure=...`

### 8. Additional European rail APIs (same Docker pattern as #7)
- ÖBB (Austria): `v6.oebb.transport.rest` — same hafas-rest-api framework
- SNCF (France): community HAFAS wrapper
- Trenitalia (Italy): partially covered by transport.opendata.ch already
- All self-hostable as Docker containers on the VPS

---

## Recently completed (2026-05-18)
- Multi-trip support with sidebar navigation (past/upcoming grouping)
- Trip creation assistant (natural language → trip + segments)
- Calendar date picker in new trip modal
- Flight edit form: split airline + flight number fields
- Edit segment assistant (✦ Ask assistant button in edit modal)
- Auto-enrichment on every segment save (no manual trigger needed)
- AviationStack live enrichment for flights (terminal, gate, baggage claim)
- Delay only shown within 24h of departure
- SBB connection search wired into NL dialog
- Fallback to taxi estimate + booking site links for non-Swiss routes
- Dialog quality log: `logs/dialog.log` (rotating, 10MB)
- No-cache headers on index.html
- Train timetable verification: `verify_train_time()` cross-checks all train segments against DB Vendo / SBB before showing summary card — corrects fictional times, fills carrier, shows ✓/⚠ banner
