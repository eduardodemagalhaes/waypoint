# Waypoint — Project Backlog & Context

## Development workflow
- **All new features go to test first** (`test.waypoint.emdm.ch`, port 8001, service: `waypoint-test`)
- Eduardo tests and approves → then promote to live (`waypoint.emdm.ch`, port 8000, service: `waypoint`)
- Never implement new features directly on live
- This rule applies to all emdm.ch projects

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

## Public beta principles (pre-auth)
- Dialog state (`dlg`) is **ephemeral and trip-scoped**: resets on trip switch, page reload, or explicit cancel
- Dialog history is never persisted server-side (pre-auth) — each conversation starts fresh
- Trip context (name, dates, all existing segments) is always injected into every GPT call via `trip_ctx` — this is the only "memory" the assistant has
- Once auth lands (#1), dialog history can optionally be persisted per trip/user

---

## In progress

### Segment date guardrails (backlog #6) — test ready, not yet promoted
- `app/routers/guardrails.py` — new dedicated module, pre-GPT checks
- `GuardrailHit` dataclass: `code`, `message`, `options`, `meta`
- `check_date_out_of_range()` — fires when segment date is outside trip bounds; suggests matching trip if one exists
- `run_guardrails()` registry pattern — new checks can be added without touching `parse.py`
- `parse.py`: calls `run_guardrails()` before GPT; returns `status="guardrail"` early; supports `bypass_guardrails=True`
- Frontend: `appendGuardrailInline()` renders warning + action buttons inline in dialog thread
- Actions: Extend trip dates / Move to matching trip / Add anyway / Cancel
- **Planned next**: route relevance guardrail (GPT-assisted, saved for later — risk of false positives)

### Frontend error codes — test ready, not yet promoted
- Every `catch` block in `static/index.html` now shows `[ERRxx]` in the toast/bot message and `console.error()`
- Makes it trivial to pinpoint errors without reading all the code

| Code | Location |
|------|----------|
| ERR01 | `loadTrips()` — trips fetch failed on boot |
| ERR02 | `sendDialogTurn()` — main NL add dialog |
| ERR03 | Segment save — inline form catch block |
| ERR04 | Segment save — modal POST/PATCH |
| ERR05 | Trip edit save |
| ERR07 | Edit segment assistant (`_editAssistAddMsg`) |
| ERR08 | Segment move |
| ERR09 | Trip-level assistant |
| ERR10 | Trip planner (`plannerSend`) |
| ERR11 | Add segment (guardrail / date-check path) |
| ERR12 | Connection search (`searchConnections`) |

When adding new catch blocks, use the next available number and add it here.
Next free: **ERR13**

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

### 6. Segment date guardrails — see "In progress" above

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

### 9. OpenAI token usage log (low priority)
- Local log of OpenAI API calls across all emdm.ch apps (Waypoint, Flights, future)
- Captures: timestamp, app, endpoint, model, input/output tokens, computed cost, success/error
- Shared SQLite DB (e.g. `/opt/emdm/shared/usage.db`) with one `api_usage` table
- Tiny dashboard route to show totals by app / by day / by endpoint
- Rationale: per-key usage is already visible in OpenAI's dashboard if separate keys
  are used per app. This log adds per-endpoint granularity (which Waypoint feature
  burns the most tokens — `/parse/plan` vs `/parse/assist/edit` vs enrichment).
- Only worth building if/when consolidating to a single key or curious about
  feature-level cost breakdown.

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

### 10. Uncertain email → user confirmation flow
- When `find_best_trip` returns no match AND there are existing trips in the account,
  before auto-creating, email the user with:
  - "We parsed your booking but weren't sure which trip to add it to."
  - List of candidate trips (name + dates) as tappable links → each resolves the segment into that trip
  - "Or create a new trip" link → triggers auto-create
  - Implement as signed one-click tokens (no login required), expire after 48h
  - Backend: `POST /api/emails/resolve/{token}` → assigns pending segment to chosen trip

### 11. Orphan segments tray
- Segments parsed from email but not yet assigned to a trip land in an "Orphan" holding area
- Visible in the UI as a tray/drawer (e.g. bottom of sidebar or dedicated section)
- Each orphan card has: "Add to trip →" dropdown + "Create new trip" + "Discard"
- Backend: `trip_id = NULL` segments with `parse_status = 'pending_assignment'`
- Ties into #10: the confirmation email links resolve orphans

### 12. Hide PDF upload drop zone on mobile
- The upload area at the top of the trip view is not useful on mobile
- Hide it on viewports < ~600px wide (CSS media query, not remove entirely)
- Keep visible on desktop where drag-and-drop is practical

### 13. Avatar upload
- User can upload a profile photo from the Profile page
- Stored server-side (e.g. `/opt/emdm/waypoint-avatars/<user_id>.jpg`, served as static)
- Backend: `POST /api/auth/avatar` — accepts image, resizes to 128×128, saves
- Frontend: tap the avatar circle in Profile to open file picker; preview updates immediately
- Avatar shown in header (28px circle) and sidebar footer (22px circle)
- Fallback: initials on accent background (already implemented)
