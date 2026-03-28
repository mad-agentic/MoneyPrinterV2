from fastapi import APIRouter, HTTPException, BackgroundTasks
from pydantic import BaseModel
import sys
import os
from urllib.parse import urlparse

sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))
from cache import get_accounts
from classes.YouTube import YouTube
from classes.Tts import TTS
from post_bridge_integration import maybe_crosspost_youtube_short
from api.session_manager import create_session, find_session_by_subject, get_session
from api.log_stream import add_log
from llm_provider import ensure_model_selected
from config import ROOT_DIR

router = APIRouter(prefix="/youtube", tags=["youtube"])

class GenerateRequest(BaseModel):
    subject: str = ""
    script: str = ""
    resume_session_id: str = ""   # optional: force reuse a specific session
    regenerate_from_step: str = ""  # optional: skip to this step (e.g., 'images', 'tts', 'video_generated')
    publish_mode: str = "manual_review"    # auto | manual_review
    auto_push_social: bool = True
    is_for_kids: bool | None = None
    title_override: str = ""
    description_override: str = ""
    tags_override: str = ""
    tts_voice: str = ""
    script_language: str = ""
    english_cc_bottom: bool = False


class AudioTextRequest(BaseModel):
    subject: str = ""
    script_language: str = ""
    resume_session_id: str = ""


class SubtitlePreviewRequest(BaseModel):
    subject: str = ""
    script: str = ""
    script_language: str = ""
    resume_session_id: str = ""
    tts_voice: str = ""
    english_cc_bottom: bool = False


class PushNowRequest(BaseModel):
    auto_push_social: bool | None = None


class CustomImagesRequest(BaseModel):
    image_urls: list[str] = []


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
    publish_mode: str = "manual_review",
    auto_push_social: bool = True,
    is_for_kids: bool | None = None,
    title_override: str = "",
    description_override: str = "",
    tags_override: str = "",
    tts_voice: str = "",
    script_language: str = "",
    english_cc_bottom: bool = False,
    regenerate_from_step: str = "",
):
    from api.session_manager import SessionManager

    session = SessionManager(session_id)
    publish_mode = "manual_review" if str(publish_mode).lower() == "manual_review" else "auto"

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
            (script_language.strip() if script_language.strip() else acc["language"]),
            session=session,
        )
        youtube.english_cc_bottom = bool(english_cc_bottom)
        tts = TTS(voice=tts_voice.strip() if str(tts_voice).strip() else None)

        if custom_subject.strip():
            youtube.subject = custom_subject.strip()
            session.save_stage("subject_set", subject=custom_subject.strip())
        if custom_script.strip():
            youtube.script = custom_script.strip()
            session.save_stage("script_set", script=custom_script.strip())

        # Load previous session state if re-generating from a specific step
        if regenerate_from_step.strip():
            if session.meta:
                if session.meta.get("audio_path"):
                    youtube.tts_path = session.meta["audio_path"]
                if session.meta.get("image_paths"):
                    youtube.images = session.meta["image_paths"]
                if session.meta.get("metadata"):
                    youtube.metadata = session.meta.get("metadata", {})
                if (not custom_script.strip()) and session.meta.get("tts_text"):
                    youtube.script = session.meta["tts_text"]

        youtube.generate_video(tts, skip_until_stage=regenerate_from_step.strip() if regenerate_from_step else "")

        # Apply optional publish metadata overrides after generation.
        if title_override.strip():
            youtube.metadata["title"] = title_override.strip()
        if description_override.strip():
            youtube.metadata["description"] = description_override.strip()
        if tags_override.strip():
            youtube.metadata["tags"] = [t.strip() for t in tags_override.split(",") if t.strip()]

        # Allow manual review before pushing to YouTube/social.
        if publish_mode == "manual_review":
            session.save_stage(
                "ready_for_review",
                account_id=account_id,
                subject=youtube.subject,
                script=youtube.script,
                video_path=getattr(youtube, "video_path", ""),
                metadata=youtube.metadata,
                english_cc_bottom=bool(english_cc_bottom),
                pending_publish={
                    "auto_push_social": bool(auto_push_social),
                    "is_for_kids": is_for_kids,
                },
            )
            add_log("info", "🛑 Publish mode = manual_review. Video prepared; skipping auto upload.")
            return

        upload_success = youtube.upload_video(is_for_kids_override=is_for_kids)
        if upload_success:
            if auto_push_social:
                maybe_crosspost_youtube_short(
                    video_path=youtube.video_path,
                    title=youtube.metadata.get("title", ""),
                    interactive=False,
                )
            else:
                add_log("info", "ℹ️ Social auto-push disabled by config.")
            session.save_stage("published", metadata=youtube.metadata)
        else:
            session.save_stage("publish_failed", metadata=youtube.metadata)
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
        req.publish_mode,
        req.auto_push_social,
        req.is_for_kids,
        req.title_override,
        req.description_override,
        req.tags_override,
        req.tts_voice,
        req.script_language,
        req.english_cc_bottom,
        req.regenerate_from_step,
    )
    return {
        "status": "success",
        "message": "Quy trình AI Video đã được khởi chạy trong nền!",
        "session_id": session.session_id,
    }


@router.post("/{account_id}/generate-audio-text")
def generate_audio_text(account_id: str, req: AudioTextRequest):
    from api.session_manager import SessionManager

    subject = (req.subject or "").strip()
    if not subject:
        raise HTTPException(status_code=400, detail="Subject is required")

    accounts = get_accounts("youtube")
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    ensure_model_selected()
    language = req.script_language.strip() if req.script_language.strip() else acc["language"]

    session = None
    if req.resume_session_id.strip():
        session = SessionManager(req.resume_session_id.strip())
        add_log("info", f"♻️  Reusing session {req.resume_session_id.strip()} for audio text generation")

    youtube = YouTube(
        acc["id"],
        acc["nickname"],
        acc["firefox_profile"],
        acc["niche"],
        language,
        session=session,
    )
    youtube.subject = subject

    if session is not None:
        session.save_stage("subject_set", subject=subject)

    generated_script = youtube.generate_script()

    if not generated_script:
        raise HTTPException(status_code=500, detail="Failed to generate audio text")

    prompt_trace = ""
    if session is not None:
        script_prompt = str(session.meta.get("script_prompt", "")).strip()
        script_output = str(session.meta.get("script_output", generated_script)).strip()
        prompt_trace = (
            "[SCRIPT PROMPT]\n"
            f"{script_prompt}\n\n"
            "[SCRIPT OUTPUT]\n"
            f"{script_output}"
        )

    return {
        "subject": subject,
        "script": generated_script,
        "script_language": language,
        "session_id": session.session_id if session is not None else "",
        "prompt_trace": prompt_trace,
    }


@router.post("/{account_id}/generate-cc-preview")
def generate_cc_preview(account_id: str, req: SubtitlePreviewRequest):
    from api.session_manager import SessionManager

    accounts = get_accounts("youtube")
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="Account not found")

    session = None
    if req.resume_session_id.strip():
        session = SessionManager(req.resume_session_id.strip())
        add_log("info", f"♻️  Reusing session {req.resume_session_id.strip()} for CC preview generation")

    if session is None:
        session = create_session(_build_session_name_hint(req.subject, req.script))
        add_log("info", f"🆕 Created new session for CC preview: {session.session_id}")

    subject = (req.subject or "").strip() or str(session.meta.get("subject", "")).strip()
    script = (req.script or "").strip() or str(session.meta.get("tts_text") or session.meta.get("script") or "").strip()
    language = req.script_language.strip() if req.script_language.strip() else acc["language"]

    if not script:
        raise HTTPException(status_code=400, detail="Audio Text is required to generate CC preview")

    try:
        youtube = YouTube(
            acc["id"],
            acc["nickname"],
            acc["firefox_profile"],
            acc["niche"],
            language,
            session=session,
        )
        youtube.subject = subject
        youtube.script = script
        youtube.english_cc_bottom = bool(req.english_cc_bottom)

        tts = TTS(voice=req.tts_voice.strip() if str(req.tts_voice).strip() else None)
        preview_data = youtube.generate_subtitle_preview(tts)

        session.save_stage(
            str(session.meta.get("stage") or "script_set"),
            subject=subject,
            script=script,
            tts_text=preview_data["tts_text"],
            audio_path=preview_data["audio_path"],
            subtitle_path=preview_data["subtitle_path"],
            subtitle_content=preview_data.get("subtitle_content", ""),
            subtitle_preview=preview_data["subtitle_preview"],
            voice_used=preview_data["voice_used"],
            english_cc_bottom=bool(req.english_cc_bottom),
        )

        add_log("success", f"✅ CC preview regenerated for session {session.session_id}")
        return {
            "ok": True,
            "session_id": session.session_id,
            "stage": str(session.meta.get("stage") or "script_set"),
            "subject": subject,
            "tts_text": preview_data["tts_text"],
            "audio_path": preview_data["audio_path"],
            "subtitle_path": preview_data["subtitle_path"],
            "subtitle_content": preview_data.get("subtitle_content", ""),
            "subtitle_preview": preview_data["subtitle_preview"],
            "voice_used": preview_data["voice_used"],
            "english_cc_bottom": bool(req.english_cc_bottom),
        }
    except HTTPException:
        raise
    except Exception as exc:
        add_log("error", f"❌ Failed to regenerate CC preview: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))


@router.post("/sessions/{session_id}/push-now")
def push_now(session_id: str, req: PushNowRequest):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    if session.meta.get("stage") != "ready_for_review":
        raise HTTPException(status_code=400, detail="Session is not ready for manual publish")

    account_id = str(session.meta.get("account_id", "")).strip()
    if not account_id:
        raise HTTPException(status_code=400, detail="Missing account_id in session metadata")

    accounts = get_accounts("youtube")
    acc = next((a for a in accounts if a["id"] == account_id), None)
    if not acc:
        raise HTTPException(status_code=404, detail="YouTube account not found")

    video_path = str(session.meta.get("video_path", "")).strip()
    if not video_path or not os.path.exists(video_path):
        raise HTTPException(status_code=400, detail="Video file not found for this session")

    metadata = session.meta.get("metadata") or {}
    title = str(metadata.get("title", "")).strip()
    description = str(metadata.get("description", "")).strip()
    if not title or not description:
        raise HTTPException(status_code=400, detail="Session metadata is missing title/description")

    pending_publish = session.meta.get("pending_publish") or {}
    auto_push_social = (
        bool(req.auto_push_social)
        if req.auto_push_social is not None
        else bool(pending_publish.get("auto_push_social", True))
    )
    is_for_kids = pending_publish.get("is_for_kids", None)

    add_log("info", f"🚀 Push Now triggered for session {session_id}")

    youtube = YouTube(
        acc["id"],
        acc["nickname"],
        acc["firefox_profile"],
        acc["niche"],
        acc["language"],
        session=session,
    )
    youtube.video_path = video_path
    youtube.metadata = metadata

    upload_success = youtube.upload_video(is_for_kids_override=is_for_kids)
    if not upload_success:
        session.save_stage("publish_failed", metadata=metadata)
        raise HTTPException(status_code=500, detail="Upload failed")

    if auto_push_social:
        maybe_crosspost_youtube_short(
            video_path=youtube.video_path,
            title=youtube.metadata.get("title", ""),
            interactive=False,
        )

    session.save_stage("published", metadata=youtube.metadata)
    return {
        "ok": True,
        "session_id": session_id,
        "uploaded_video_url": getattr(youtube, "uploaded_video_url", ""),
        "auto_push_social": auto_push_social,
    }


@router.post("/sessions/{session_id}/custom-images")
def set_custom_images(session_id: str, req: CustomImagesRequest):
    session = get_session(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    mp_root = os.path.abspath(os.path.join(ROOT_DIR, ".mp"))
    selected_paths: list[str] = []

    for raw_url in req.image_urls:
        if not str(raw_url).strip():
            continue
        parsed_path = urlparse(raw_url).path
        if not parsed_path.startswith("/media/"):
            raise HTTPException(status_code=400, detail=f"Invalid media URL: {raw_url}")

        rel = parsed_path[len("/media/"):].replace("/", os.sep)
        candidate = os.path.abspath(os.path.join(mp_root, rel))

        if not candidate.startswith(mp_root):
            raise HTTPException(status_code=400, detail="Invalid media path")
        if not os.path.exists(candidate):
            raise HTTPException(status_code=400, detail=f"Image not found: {raw_url}")
        if not candidate.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            raise HTTPException(status_code=400, detail=f"Not an image file: {raw_url}")

        selected_paths.append(candidate)

    deduped = list(dict.fromkeys(selected_paths))
    next_stage = "images" if deduped else str(session.meta.get("stage") or "script_set")
    session.save_stage(next_stage, image_paths=deduped)

    add_log("info", f"🧩 Session {session_id}: applied {len(deduped)} custom image(s)")
    return {
        "ok": True,
        "session_id": session_id,
        "image_count": len(deduped),
        "stage": next_stage,
    }
