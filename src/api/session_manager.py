"""
Session Manager – per-generation cache to avoid regenerating expensive assets.

Directory structure:
    .mp/sessions/{folder_name}/
        session.json          ← metadata (id, name, stage, subject, script, paths)
        images/               ← cached AI images (MD5(prompt) → .png)
        audio/                ← cached TTS audio (MD5(script) → .wav)
        video/                ← generated video outputs (.mp4)

`session_id` is a stable UUID in metadata/API.
Folder names are derived from session name hints (and remain renameable).
"""
import hashlib
import json
import os
import re
import time
from uuid import uuid4
from typing import Optional


def _root_dir() -> str:
    """Project root – go up 2 dirs from src/api/."""
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))


def _mp_dir() -> str:
    root = os.path.join(_root_dir(), ".mp")
    os.makedirs(root, exist_ok=True)
    return root


def _sessions_dir() -> str:
    d = os.path.join(_mp_dir(), "sessions")
    os.makedirs(d, exist_ok=True)
    return d


def _next_session_name() -> str:
    """Return the next sequential name: s1, s2, s3, …"""
    existing = list_sessions()
    # Find highest existing sN index
    max_idx = 0
    for meta in existing:
        name = meta.get("name", "")
        if name.startswith("s") and name[1:].isdigit():
            max_idx = max(max_idx, int(name[1:]))
    return f"s{max_idx + 1}"


def _slugify_folder_name(name: str) -> str:
    raw = (name or "session").strip().lower()
    slug = re.sub(r"[^a-z0-9._-]+", "-", raw)
    slug = re.sub(r"-+", "-", slug).strip("-._")
    return slug or "session"


def _session_subdirs() -> list[str]:
    root = _sessions_dir()
    if not os.path.exists(root):
        return []
    return [
        os.path.join(root, d)
        for d in os.listdir(root)
        if os.path.isdir(os.path.join(root, d))
    ]


def _find_session_dir_by_id(session_id: str) -> Optional[str]:
    for sess_dir in _session_subdirs():
        meta_path = os.path.join(sess_dir, "session.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if str(meta.get("session_id", "")).strip() == session_id:
                return sess_dir
        except Exception:
            continue
    return None


def _unique_session_dir_name(base_name: str, exclude_dir: Optional[str] = None) -> str:
    root = _sessions_dir()
    candidate = _slugify_folder_name(base_name)
    current = candidate
    idx = 2

    while True:
        candidate_path = os.path.join(root, current)
        if not os.path.exists(candidate_path):
            return current
        if exclude_dir and os.path.abspath(candidate_path) == os.path.abspath(exclude_dir):
            return current
        current = f"{candidate}-{idx}"
        idx += 1


class SessionManager:
    """Manages a single generation session with file-based caching."""

    def __init__(self, session_id: str, initial_name: str = ""):
        self.session_id = session_id
        existing_dir = _find_session_dir_by_id(session_id)

        if existing_dir:
            self.session_dir = existing_dir
        else:
            base_name = (initial_name or "").strip() or _next_session_name()
            folder_name = _unique_session_dir_name(base_name)
            self.session_dir = os.path.join(_sessions_dir(), folder_name)

        self.images_dir = os.path.join(self.session_dir, "images")
        self.audio_dir = os.path.join(self.session_dir, "audio")
        self.video_dir = os.path.join(self.session_dir, "video")
        self.meta_path = os.path.join(self.session_dir, "session.json")

        os.makedirs(self.images_dir, exist_ok=True)
        os.makedirs(self.audio_dir, exist_ok=True)
        os.makedirs(self.video_dir, exist_ok=True)

        if os.path.exists(self.meta_path):
            with open(self.meta_path, "r", encoding="utf-8") as f:
                self.meta: dict = json.load(f)
            self.meta.setdefault("folder_name", os.path.basename(self.session_dir))
            if not self.meta.get("session_id"):
                self.meta["session_id"] = session_id
            self._save_meta()
        else:
            display_name = (initial_name or "").strip() or os.path.basename(self.session_dir)
            self.meta = {
                "session_id": session_id,
                "name": display_name,
                "folder_name": os.path.basename(self.session_dir),
                "created_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
                "stage": "init",
                "subject": "",
                "script": "",
                "image_paths": [],
                "audio_path": "",
                "video_path": "",
            }
            self._save_meta()

    # ── Persistence ────────────────────────────────────────────────────────

    def _save_meta(self) -> None:
        with open(self.meta_path, "w", encoding="utf-8") as f:
            json.dump(self.meta, f, ensure_ascii=False, indent=2)

    def save_stage(self, stage: str, **kwargs) -> None:
        self.meta["stage"] = stage
        self.meta["folder_name"] = os.path.basename(self.session_dir)
        self.meta.update(kwargs)
        self._save_meta()

    # ── Image cache ────────────────────────────────────────────────────────

    @staticmethod
    def _prompt_hash(prompt: str) -> str:
        return hashlib.md5(prompt.strip().encode()).hexdigest()[:16]

    def get_cached_image(self, prompt: str) -> Optional[str]:
        h = self._prompt_hash(prompt)
        candidate = os.path.join(self.images_dir, f"{h}.png")
        return candidate if os.path.exists(candidate) else None

    def image_cache_path(self, prompt: str) -> str:
        h = self._prompt_hash(prompt)
        return os.path.join(self.images_dir, f"{h}.png")

    # ── Audio / TTS cache ──────────────────────────────────────────────────

    @staticmethod
    def _text_hash(text: str) -> str:
        return hashlib.md5(text.strip().encode()).hexdigest()[:16]

    def get_cached_audio(self, tts_text: str) -> Optional[str]:
        h = self._text_hash(tts_text)
        candidate = os.path.join(self.audio_dir, f"{h}.wav")
        return candidate if os.path.exists(candidate) else None

    def audio_cache_path(self, tts_text: str) -> str:
        return os.path.join(self.audio_dir, f"{self._text_hash(tts_text)}.wav")

    # ── Video output path ──────────────────────────────────────────────────

    def video_output_path(self) -> str:
        filename = f"{time.strftime('%Y%m%d_%H%M%S')}_{uuid4().hex[:8]}.mp4"
        return os.path.join(self.video_dir, filename)

    # ── Script / subject cache ─────────────────────────────────────────────

    def get_cached_script(self) -> Optional[str]:
        return self.meta.get("script") or None

    def get_cached_subject(self) -> Optional[str]:
        return self.meta.get("subject") or None


# ── Factory helpers ───────────────────────────────────────────────────────────

def create_session(initial_name: str = "") -> SessionManager:
    return SessionManager(str(uuid4()), initial_name=initial_name)


def get_session(session_id: str) -> Optional[SessionManager]:
    if not _find_session_dir_by_id(session_id):
        return None
    return SessionManager(session_id)


def find_session_by_subject(subject: str) -> Optional[SessionManager]:
    sessions_root = _sessions_dir()
    candidates = []
    for name in os.listdir(sessions_root):
        meta_path = os.path.join(sessions_root, name, "session.json")
        if not os.path.exists(meta_path):
            continue
        try:
            with open(meta_path, "r", encoding="utf-8") as f:
                meta = json.load(f)
            if meta.get("subject", "").strip().lower() == subject.strip().lower():
                candidates.append((meta.get("created_at", ""), str(meta.get("session_id", "")).strip()))
        except Exception:
            continue
    if not candidates:
        return None
    candidates.sort(reverse=True)
    matched_session_id = candidates[0][1]
    if not matched_session_id:
        return None
    return SessionManager(matched_session_id)


def list_sessions() -> list:
    sessions_root = _sessions_dir()
    result = []
    if not os.path.exists(sessions_root):
        return result
    for name in os.listdir(sessions_root):
        meta_path = os.path.join(sessions_root, name, "session.json")
        if os.path.exists(meta_path):
            try:
                with open(meta_path, "r", encoding="utf-8") as f:
                    result.append(json.load(f))
            except Exception:
                pass
    result.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return result


def rename_session(session_id: str, new_name: str) -> bool:
    """Rename a session. Returns True on success, False if not found."""
    s = get_session(session_id)
    if s is None:
        return False

    sessions_root = _sessions_dir()
    target_folder = _unique_session_dir_name(new_name, exclude_dir=s.session_dir)
    target_dir = os.path.join(sessions_root, target_folder)

    if os.path.abspath(target_dir) != os.path.abspath(s.session_dir):
        os.rename(s.session_dir, target_dir)
        s.session_dir = target_dir
        s.images_dir = os.path.join(s.session_dir, "images")
        s.audio_dir = os.path.join(s.session_dir, "audio")
        s.video_dir = os.path.join(s.session_dir, "video")
        s.meta_path = os.path.join(s.session_dir, "session.json")

    s.meta["name"] = new_name
    s.meta["folder_name"] = os.path.basename(s.session_dir)
    s._save_meta()
    return True
