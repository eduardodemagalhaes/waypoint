# Waypoint — Project Backlog & Context

## Development workflow
- **All new features go to test first** (`test.waypoint.emdm.ch`, port 8001, service: `waypoint-test`)
- Eduardo tests and approves → then promote to live (`waypoint.emdm.ch`, port 8000, service: `waypoint`)
- Never implement new features directly on live
- This rule applies to all emdm.ch projects

## Quick context for new sessions
- **Server**: Hetzner CX22, `178.104.227.162`, Ubuntu 24.04, user `eduardo`
- **App**: `/home/eduardo/waypoint/` — FastAPI + SQLite + OpenAI GPT-4o
- **Frontend**: `/home/eduardo/waypoint/static/` — split JS/CSS files + index.html
- **Service**: `sudo systemctl restart waypoint` — runs on `localhost:8000`
- **Domain**: `emdm.ch` via Nginx reverse proxy
- **Keys**: `.env` file has `OPENAI_API_KEY`, `AVIATIONSTACK_KEY`, `SECRET_TOKEN`
- **Stack**: Python venv at `venv/`, logs at `logs/dialog.log`

## Architecture notes
- Segments auto-enriched after every save (trains via transport.opendata.ch, flights via AviationStack free tier)
- Email ingest: forward to `waypoint@emdm.ch` → parsed by GPT-4o → segments created
- Connection search: `transport.opendata.ch` for Swiss/cross-border, DB Vendo for German routes
- Auth: session cookies + bcrypt, single user currently
- Frontend: vanilla JS split across `static/js/` modules, CSS in `static/css/app.css`

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
- Every `catch` block now shows `[ERRxx]` in toast/bot message and `console.error()`

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
| ERR13 | PDF upload (`handlePdfFile`) |
| ERR14 | Discard orphans |
| ERR15 | Save profile |

Next free: **ERR16**

---

## Backlog

### 1. Multi-user & authentication ✅ DONE (2026-05-18)
- Session cookie auth, bcrypt passwords, login/logout/register
- Each user sees only their own trips and segments

### 2. Source email management
- Each user registers multiple "source emails" (work, personal, assistant, etc.)
- Each source email verified before activation (confirmation link)
- When `waypoint@emdm.ch` receives mail: identify sender → map to user → auto-assign to trip via `find_best_trip`
- Unknown sender → queue for review
- UI: "My email sources" settings page — add, verify, remove

### 3. Trip-level assistant ✅ DONE (2026-05-18)
- Persistent chat panel at trip level
- Full context: all segments, dates, notes, enrichment data

### 4. Segment maps
- Minimap thumbnail inside each expanded segment card
- Hotels: pin on exact OSM coordinates (from enrichment lat/lon)
- Flights & trains: both endpoints shown with a route line between them
- Click thumbnail → full map modal
- **Note**: use Leaflet.js via CDN — previous raw OSM tile attempts failed on CORS/canvas/display:none

### 5. Top-level trip creation assistant ✅ DONE (2026-05-18)
- Conversational planner at dashboard level builds full trip from scratch
- Lives at home screen "✦ Plan with AI" action card
- Endpoint: `POST /api/parse/plan`

### 6. Segment date guardrails — see "In progress" above

### 7. DB (Deutsche Bahn) connection search ✅ DONE (2026-05-18)
- `db-vendo-client` Docker container on VPS, port 3000
- Wired into `search_connections()` in `app/routers/enrich.py`

### 8. Additional European rail APIs (same Docker pattern as #7)
- ÖBB (Austria): `v6.oebb.transport.rest`
- SNCF (France): community HAFAS wrapper
- Trenitalia (Italy): partially covered by transport.opendata.ch already

### 9. OpenAI token usage log (low priority)
- Shared SQLite DB `/opt/emdm/shared/usage.db` with one `api_usage` table
- Per-endpoint granularity across all emdm.ch apps
- Only worth building if curious about feature-level cost breakdown

### 10. Uncertain email → user confirmation flow
- When `find_best_trip` returns no match, email user with candidate trip links
- Signed one-click tokens, expire after 48h
- Backend: `POST /api/emails/resolve/{token}`

### 11. Orphan segments tray ✅ DONE (2026-05-18)
- Segments without a trip land in Inbox tray
- Each orphan has: "Add to trip →" / "Create new trip" / "Discard"
- Backend: `trip_id = NULL` + `parse_status = 'pending_assignment'`

### 12. PDF upload drop zone ✅ DONE (2026-05-28)
- Removed large drop zone from trip view (not useful on iPad, too prominent)
- PDF upload accessible via Home screen action card
- Inline progress text while parsing

### 13. Avatar upload
- User can upload a profile photo from the Profile page
- Backend: `POST /api/auth/avatar` — resize to 128×128, serve as static
- Frontend: tap avatar circle in Profile to open file picker
- Avatar shown in header (28px) and sidebar footer (22px)
- Fallback: initials on accent background (already implemented)

### 14. Home screen ✅ DONE (2026-05-28)
- Shown on login and on logo click
- Greeting + next trip countdown
- Quick action cards: Plan with AI / Upload PDF / New trip
- Email forwarding tip with tap-to-copy address
- Trip list: 4 upcoming inline, Past trips + More trips as folder rows

### 15. Dark mode ✅ DONE (2026-05-28)
- Full warm dark palette matching existing serif aesthetic
- Theme picker in Settings: Light / Dark / System
- Persisted in `localStorage`, applied before first paint (no flash)

### 16. Sidebar folders ✅ DONE (2026-05-28)
- Past trips → "▸ Past trips" folder in sidebar, opens in main window
- Upcoming overflow (5th+) → "▸ More trips" folder
- Both show trip list; click row to open trip

### 17. Profile / Settings split ✅ DONE (2026-05-28)
- Profile: personal data (email, username, home city, airports)
- Settings: system preferences (theme; future: date format, currency, notifications)
- Separate pages, separate sidebar entries

### 18. Avatar initials ✅ DONE (2026-05-28)
- Orange circle with initials in header and sidebar
- Wired for future photo upload (#13)

### 19. Header cleanup ✅ DONE (2026-05-28)
- Edit trip + Add segment buttons hidden outside trip view
- No Profile/Sign out buttons in header — sidebar only
- Upload PDF removed from header

### 20. API usage widget ✅ DONE (2026-05-28)
- Removed from sidebar — admin panel only
- `/api/usage` endpoint still active

### 21. Bug fix: trip edit ERR05 ✅ DONE (2026-05-28)
- `ForeignKey("users.id")` removed from Trip ORM model
- `users` table has no SQLAlchemy class → caused `sort_tables` crash on flush

### 22. Frontend refactor ✅ DONE (2026-05-28)
- `index.html` split into `static/css/app.css` + `static/js/*.js` modules
- Python backend: dead code removed, unused imports cleaned, parse.py bak remnants gone

