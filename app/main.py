from fastapi import FastAPI, Request, UploadFile, File, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
import os, subprocess

from app.database import Base, engine
from app.routers import trips, segments, emails, parse, lookup, enrich

Base.metadata.create_all(bind=engine)

app = FastAPI(title="Waypoint", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

SECRET_TOKEN = os.getenv("SECRET_TOKEN", "change_me")

@app.middleware("http")
async def auth_middleware(request: Request, call_next):
    if not request.url.path.startswith("/api"):
        return await call_next(request)
    token = request.headers.get("X-Token") or request.query_params.get("token")
    if token != SECRET_TOKEN:
        from fastapi.responses import JSONResponse
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)

app.include_router(trips.router)
app.include_router(segments.router)
app.include_router(emails.router)
app.include_router(parse.router)
app.include_router(lookup.router)
app.include_router(enrich.router)

@app.get("/health")
def health():
    return {"status": "ok"}



# ── DEPLOY ENDPOINT ──
DEPLOY_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
ALLOWED = ["static/index.html","app/routers/parse.py","app/routers/lookup.py","app/routers/trips.py","app/routers/segments.py","app/main.py"]

@app.post("/api/deploy")
async def deploy_file(file: UploadFile = File(...), path: str = "", restart: bool = False, x_token: str = Header(None)):
    if x_token != SECRET_TOKEN: raise HTTPException(401, "Unauthorized")
    if path not in ALLOWED: raise HTTPException(400, f"Path not allowed: {path}")
    target = os.path.join(DEPLOY_ROOT, path)
    content = await file.read()
    open(target, "wb").write(content)
    if restart: subprocess.Popen(["sudo","systemctl","restart","waypoint"])
    return {"ok": True, "path": path, "bytes": len(content)}

from fastapi.responses import FileResponse

static_dir = os.path.join(os.path.dirname(__file__), "..", "static")

# Add middleware to prevent HTML caching
@app.middleware("http")
async def no_cache_html(request, call_next):
    response = await call_next(request)
    path = request.url.path
    if path in ("/", "/index.html") or path.endswith(".html"):
        response.headers["Cache-Control"] = "no-store, no-cache, must-revalidate"
        response.headers["Pragma"]        = "no-cache"
        response.headers["Expires"]       = "0"
    return response

if os.path.exists(static_dir):
    app.mount("/", StaticFiles(directory=static_dir, html=True), name="static")
