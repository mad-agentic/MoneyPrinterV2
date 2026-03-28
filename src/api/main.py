from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
import asyncio
import sys
import os
import glob
import json
from typing import Any

if sys.platform == "win32":
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

# Ensure src module is accessible
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from cache import get_accounts, get_products, add_account, remove_account, add_product
from constants import OPTIONS, YOUTUBE_OPTIONS, TWITTER_OPTIONS
from config import get_first_time_running, ROOT_DIR   # ← ROOT_DIR from config

from api.youtube import router as youtube_router
from api.log_stream import _log_generator, get_log_history
from api.session_manager import list_sessions, rename_session, get_session, create_session

# ── Project .mp directory (project root, NOT src/.mp) ──────────────────────
MP_DIR = os.path.join(ROOT_DIR, '.mp')
os.makedirs(MP_DIR, exist_ok=True)
CONFIG_PATH = os.path.join(ROOT_DIR, 'config.json')

app = FastAPI(title="MoneyPrinterV2 API Hub", description="REST API for MPV2 UI")
app.include_router(youtube_router)

# Serve everything under .mp as /media
app.mount("/media", StaticFiles(directory=MP_DIR), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {"message": "Welcome to MoneyPrinterV2 API"}

@app.get("/system/status")
def get_status():
    return {
        "first_time_running": get_first_time_running(),
        "options": OPTIONS,
        "youtube_options": YOUTUBE_OPTIONS,
        "twitter_options": TWITTER_OPTIONS
    }

@app.get("/system/gallery")
def get_gallery(session_id: str = ""):
    """
    List media files.
    - If session_id provided → only return that session's images
    - Otherwise → return ALL .mp root assets + all session images
    """
    files = []

    def _collect_file(abs_path: str, url_path: str):
        if abs_path.endswith((".mp4", ".png")):
            files.append({
                "name": os.path.basename(abs_path),
                "url": url_path,
                "type": "video" if abs_path.endswith(".mp4") else "image",
                "created_at": os.path.getctime(abs_path),
            })

    sessions_root = os.path.join(MP_DIR, "sessions")

    if session_id:
        # Only show this session's images + videos
        sess = get_session(session_id)
        if sess is not None:
            folder_name = os.path.basename(sess.session_dir)
            img_dir = sess.images_dir
            if os.path.exists(img_dir):
                for f in glob.glob(os.path.join(img_dir, "*.png")):
                    _collect_file(f, f"/media/sessions/{folder_name}/images/{os.path.basename(f)}")

            vid_dir = sess.video_dir
            if os.path.exists(vid_dir):
                for f in glob.glob(os.path.join(vid_dir, "*.mp4")):
                    _collect_file(f, f"/media/sessions/{folder_name}/video/{os.path.basename(f)}")
    else:
        # All mode: include every image/video under .mp recursively.
        for root, _, filenames in os.walk(MP_DIR):
            for name in filenames:
                if not name.endswith((".png", ".mp4")):
                    continue
                abs_path = os.path.join(root, name)
                rel_path = os.path.relpath(abs_path, MP_DIR).replace("\\", "/")
                _collect_file(abs_path, f"/media/{rel_path}")

    files.sort(key=lambda x: x["created_at"], reverse=True)
    return files

# ── Log streaming ────────────────────────────────────────────────────────────

@app.get("/system/logs/stream")
async def stream_logs(request: Request):
    """SSE: stream backend logs in real time."""
    return StreamingResponse(
        _log_generator(request),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

@app.get("/system/logs/history")
def log_history():
    return get_log_history()

# ── Sessions ─────────────────────────────────────────────────────────────────

@app.get("/system/sessions")
def get_sessions_list():
    return list_sessions()

@app.get("/system/sessions/{session_id}")
def get_single_session(session_id: str):
    s = get_session(session_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return s.meta

class RenameBody(BaseModel):
    name: str


class CreateSessionBody(BaseModel):
    name: str = ""


class ConfigUpdateBody(BaseModel):
    values: dict[str, Any]


@app.post("/system/sessions")
def create_new_session(body: CreateSessionBody):
    session = create_session(body.name.strip())
    return session.meta

@app.patch("/system/sessions/{session_id}/rename")
def do_rename_session(session_id: str, body: RenameBody):
    ok = rename_session(session_id, body.name.strip())
    if not ok:
        raise HTTPException(status_code=404, detail="Session not found")
    return {"ok": True}


# ── Config ───────────────────────────────────────────────────────────────────

EDITABLE_CONFIG_KEYS = {
    "verbose",
    "headless",
    "threads",
    "is_for_kids",
    "stt_provider",
    "whisper_model",
    "whisper_device",
    "whisper_compute_type",
    "whisper_vad_filter",
    "whisper_beam_size",
    "tts_voice",
    "tts_strict_mode",
    "video_encode_preset",
    "video_encode_crf",
    "script_sentence_length",
    "font",
}


def _read_config() -> dict[str, Any]:
    if not os.path.exists(CONFIG_PATH):
        raise HTTPException(status_code=500, detail="config.json not found")
    with open(CONFIG_PATH, "r", encoding="utf-8") as f:
        return dict(json.load(f))


def _write_config(payload: dict[str, Any]) -> None:
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2, ensure_ascii=False)
        f.write("\n")


@app.get("/system/config")
def get_config():
    return _read_config()


@app.patch("/system/config")
def patch_config(body: ConfigUpdateBody):
    incoming = body.values or {}
    if not isinstance(incoming, dict):
        raise HTTPException(status_code=400, detail="values must be an object")

    cfg = _read_config()
    rejected = [k for k in incoming.keys() if k not in EDITABLE_CONFIG_KEYS]
    if rejected:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported config keys: {', '.join(sorted(rejected))}",
        )

    for key, value in incoming.items():
        cfg[key] = value

    _write_config(cfg)
    return {"ok": True, "updated": sorted(list(incoming.keys())), "config": cfg}

# ── Accounts ─────────────────────────────────────────────────────────────────

@app.get("/accounts/{platform}")
def get_platform_accounts(platform: str):
    if platform not in ["youtube", "twitter"]:
        raise HTTPException(status_code=400, detail="Invalid platform")
    return get_accounts(platform)

@app.post("/accounts/{platform}")
def create_account(platform: str, account_data: dict):
    if platform not in ["youtube", "twitter"]:
        raise HTTPException(status_code=400, detail="Invalid platform")
    add_account(platform, account_data)
    return {"status": "success", "message": f"Account for {platform} added."}

@app.delete("/accounts/{platform}/{account_id}")
def delete_account(platform: str, account_id: str):
    if platform not in ["youtube", "twitter"]:
        raise HTTPException(status_code=400, detail="Invalid platform")
    remove_account(platform, account_id)
    return {"status": "success", "message": f"Account {account_id} for {platform} deleted."}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("api.main:app", host="127.0.0.1", port=15001, reload=True)
