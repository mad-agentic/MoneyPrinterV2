from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from pydantic import BaseModel
import sys
import os

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from cache import get_accounts
from classes.YouTube import YouTube
from classes.Tts import TTS
from post_bridge_integration import maybe_crosspost_youtube_short
from api.session_manager import create_session, find_session_by_subject
from api.log_stream import add_log
from llm_provider import ensure_model_selected

router = APIRouter(prefix="/youtube", tags=["youtube"])

class GenerateRequest(BaseModel):
    subject: str = ""
    script: str = ""
    resume_session_id: str = ""   # optional: force reuse a specific session


def _build_session_name_hint(subject: str, script: str) -> str:
    label = (subject or "").strip()
    if label:
        return label

    snippet = (script or "").strip()
    if not snippet:
        return ""

    words = snippet.split()
    return " ".join(words[:8])


def generate_and_upload_video(
    account_id: str,
    session_id: str,
    custom_subject: str = "",
    custom_script: str = "",
):
    from api.session_manager import SessionManager

    session = SessionManager(session_id)

    try:
        accounts = get_accounts("youtube")
        acc = next((a for a in accounts if a["id"] == account_id), None)
        if not acc:
            add_log("error", f"Account {account_id} not found")
            return

        active_model = ensure_model_selected()
        add_log("info", f"🤖 Ollama model active: {active_model}")
        add_log("info", f"🎬 Session started: {session_id}")
        add_log("info", f"📺 Channel: {acc['nickname']} | Niche: {acc['niche']}")

        youtube = YouTube(
            acc["id"],
            acc["nickname"],
            acc["firefox_profile"],
            acc["niche"],
            acc["language"],
            session=session,
        )
        tts = TTS()

        if custom_subject.strip():
            youtube.subject = custom_subject.strip()
            session.save_stage("subject_set", subject=custom_subject.strip())
        if custom_script.strip():
            youtube.script = custom_script.strip()
            session.save_stage("script_set", script=custom_script.strip())

        youtube.generate_video(tts)

        upload_success = youtube.upload_video()
        if upload_success:
            maybe_crosspost_youtube_short(
                video_path=youtube.video_path,
                title=youtube.metadata.get("title", ""),
                interactive=False,
            )
    except Exception as exc:
        add_log("error", f"❌ Session {session_id} failed: {exc}")
        session.save_stage("failed", error=str(exc))


@router.post("/{account_id}/generate")
def trigger_generation(account_id: str, req: GenerateRequest, background_tasks: BackgroundTasks):
    accounts = get_accounts("youtube")
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    # Try to reuse existing session for same subject (cache hit)
    session = None
    if req.resume_session_id:
        from api.session_manager import SessionManager
        session = SessionManager(req.resume_session_id)
        add_log("info", f"♻️  Resuming session {req.resume_session_id}")
    elif req.subject.strip():
        session = find_session_by_subject(req.subject.strip())
        if session:
            add_log("info", f"♻️  Found cached session {session.session_id} for subject: {req.subject}")

    if not session:
        session = create_session(_build_session_name_hint(req.subject, req.script))
        add_log("info", f"🆕 Created new session: {session.session_id}")

    background_tasks.add_task(
        generate_and_upload_video,
        account_id,
        session.session_id,
        req.subject,
        req.script,
    )
    return {
        "status": "success",
        "message": "Quy trình AI Video đã được khởi chạy trong nền!",
        "session_id": session.session_id,
    }
