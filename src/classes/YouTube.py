import re
import base64
import json
import time
import os
import atexit
import shutil
import tempfile
from typing import Any, List, Optional

import requests
import assemblyai as aai

# Map full language names → ISO 639-1 codes accepted by faster-whisper.
_WHISPER_LANGUAGE_CODES: set[str] = {
    "af","am","ar","as","az","ba","be","bg","bn","bo","br","bs","ca","cs",
    "cy","da","de","el","en","es","et","eu","fa","fi","fo","fr","gl","gu",
    "ha","haw","he","hi","hr","ht","hu","hy","id","is","it","ja","jw","ka",
    "kk","km","kn","ko","la","lb","ln","lo","lt","lv","mg","mi","mk","ml",
    "mn","mr","ms","mt","my","ne","nl","nn","no","oc","pa","pl","ps","pt",
    "ro","ru","sa","sd","si","sk","sl","sn","so","sq","sr","su","sv","sw",
    "ta","te","tg","th","tk","tl","tr","tt","uk","ur","uz","vi","yi","yo",
    "zh","yue",
}
_WHISPER_LANGUAGE_NAME_TO_CODE: dict[str, str] = {
    "afrikaans": "af", "amharic": "am", "arabic": "ar", "assamese": "as",
    "azerbaijani": "az", "bashkir": "ba", "belarusian": "be", "bulgarian": "bg",
    "bengali": "bn", "tibetan": "bo", "breton": "br", "bosnian": "bs",
    "catalan": "ca", "czech": "cs", "welsh": "cy", "danish": "da",
    "german": "de", "greek": "el", "english": "en", "spanish": "es",
    "estonian": "et", "basque": "eu", "persian": "fa", "finnish": "fi",
    "faroese": "fo", "french": "fr", "galician": "gl", "gujarati": "gu",
    "hausa": "ha", "hawaiian": "haw", "hebrew": "he", "hindi": "hi",
    "croatian": "hr", "haitian creole": "ht", "hungarian": "hu", "armenian": "hy",
    "indonesian": "id", "icelandic": "is", "italian": "it", "japanese": "ja",
    "javanese": "jw", "georgian": "ka", "kazakh": "kk", "khmer": "km",
    "kannada": "kn", "korean": "ko", "latin": "la", "luxembourgish": "lb",
    "lingala": "ln", "lao": "lo", "lithuanian": "lt", "latvian": "lv",
    "malagasy": "mg", "maori": "mi", "macedonian": "mk", "malayalam": "ml",
    "mongolian": "mn", "marathi": "mr", "malay": "ms", "maltese": "mt",
    "burmese": "my", "nepali": "ne", "dutch": "nl", "norwegian nynorsk": "nn",
    "norwegian": "no", "occitan": "oc", "punjabi": "pa", "polish": "pl",
    "pashto": "ps", "portuguese": "pt", "romanian": "ro", "russian": "ru",
    "sanskrit": "sa", "sindhi": "sd", "sinhala": "si", "slovak": "sk",
    "slovenian": "sl", "shona": "sn", "somali": "so", "albanian": "sq",
    "serbian": "sr", "sundanese": "su", "swedish": "sv", "swahili": "sw",
    "tamil": "ta", "telugu": "te", "tajik": "tg", "thai": "th",
    "turkmen": "tk", "tagalog": "tl", "turkish": "tr", "tatar": "tt",
    "ukrainian": "uk", "urdu": "ur", "uzbek": "uz", "vietnamese": "vi",
    "yiddish": "yi", "yoruba": "yo", "chinese": "zh", "cantonese": "yue",
}


def _resolve_whisper_language(language: str) -> Optional[str]:
    """Convert a language name or code to a faster-whisper ISO code, or None."""
    lang = (language or "").strip().lower()
    if not lang:
        return None
    if lang in _WHISPER_LANGUAGE_CODES:
        return lang
    return _WHISPER_LANGUAGE_NAME_TO_CODE.get(lang)

from utils import *
from cache import *
from .Tts import TTS
from llm_provider import generate_text
from config import *
from status import *
from uuid import uuid4
from constants import *
from moviepy import (
    AudioFileClip,
    ColorClip,
    CompositeAudioClip,
    CompositeVideoClip,
    ImageClip,
    TextClip,
    concatenate_videoclips,
)
from termcolor import colored
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from moviepy.video.tools.subtitles import SubtitlesClip
from webdriver_manager.firefox import GeckoDriverManager
from datetime import datetime
from selenium.webdriver import Firefox

# Set ImageMagick Path for MoviePy
os.environ["IMAGEMAGICK_BINARY"] = get_imagemagick_path()


class YouTube:
    """
    Class for YouTube Automation.

    Steps to create a YouTube Short:
    1. Generate a topic [DONE]
    2. Generate a script [DONE]
    3. Generate metadata (Title, Description, Tags) [DONE]
    4. Generate AI Image Prompts [DONE]
    4. Generate Images based on generated Prompts [DONE]
    5. Convert Text-to-Speech [DONE]
    6. Show images each for n seconds, n: Duration of TTS / Amount of images [DONE]
    7. Combine Concatenated Images with the Text-to-Speech [DONE]
    """

    def __init__(
        self,
        account_uuid: str,
        account_nickname: str,
        fp_profile_path: str,
        niche: str,
        language: str,
        session=None,           # Optional[SessionManager] – injected by API layer
    ) -> None:
        """
        Constructor for YouTube Class.

        Args:
            account_uuid (str): The unique identifier for the YouTube account.
            account_nickname (str): The nickname for the YouTube account.
            fp_profile_path (str): Path to the firefox profile that is logged into the specificed YouTube Account.
            niche (str): The niche of the provided YouTube Channel.
            language (str): The language of the Automation.

        Returns:
            None
        """
        self._account_uuid: str = account_uuid
        self._account_nickname: str = account_nickname
        self._fp_profile_path: str = fp_profile_path
        self._niche: str = niche
        self._language: str = language

        # Optional session for caching; None = no caching (CLI mode)
        self._session = session

        self.subject: str = ""
        self.script: str = ""
        self.metadata: dict = {}
        self.image_prompts: List[str] = []
        self.images = []
        self.tts_path: str = ""  # Audio file path; set by generate_script_to_speech()
        self.voice_used: str = ""
        self.english_cc_bottom: bool = False

        # Browser is lazy-initialized (only needed for upload, not generation)
        self._browser_initialized: bool = False
        self.browser = None
        self.service = None
        self.options: Options = Options()

        atexit.register(self._cleanup_runtime_profile)

    def _init_browser(self) -> None:
        """Lazy-initialize Firefox WebDriver. Called only when upload is needed."""
        if self._browser_initialized:
            return

        if get_headless():
            self.options.add_argument("--headless")

        if not os.path.isdir(self._fp_profile_path):
            raise ValueError(
                f"Firefox profile path does not exist or is not a directory: {self._fp_profile_path}"
            )

        self._runtime_profile_path = self._create_runtime_profile(self._fp_profile_path)
        self.options.add_argument("-profile")
        self.options.add_argument(self._runtime_profile_path)

        self.service = Service(self._get_geckodriver_path())
        try:
            self.browser = Firefox(service=self.service, options=self.options)
        except Exception as exc:
            self._cleanup_runtime_profile()
            raise RuntimeError(
                "Could not start Firefox WebDriver. Close Firefox windows and verify your Firefox profile path."
            ) from exc

        self._browser_initialized = True

    @staticmethod
    def _get_geckodriver_path() -> str:
        """Return geckodriver binary path, using a local cache file to avoid repeated
        GitHub API calls (which are rate-limited to 60 req/hour for anonymous IPs)."""
        cache_file = os.path.join(ROOT_DIR, ".mp", ".geckodriver_path")

        # Use cached path if binary still exists on disk
        if os.path.exists(cache_file):
            with open(cache_file, "r", encoding="utf-8") as f:
                cached_path = f.read().strip()
            if cached_path and os.path.exists(cached_path):
                return cached_path

        # Download / locate via webdriver-manager
        try:
            driver_path = GeckoDriverManager().install()
        except ValueError as exc:
            if "rate limit" in str(exc).lower():
                raise RuntimeError(
                    "GitHub API rate limit exceeded while fetching geckodriver. "
                    "Please wait ~1 hour or set the GH_TOKEN environment variable."
                ) from exc
            raise

        # Persist path so next call skips the API entirely
        os.makedirs(os.path.dirname(cache_file), exist_ok=True)
        with open(cache_file, "w", encoding="utf-8") as f:
            f.write(driver_path)
        return driver_path

    def _create_runtime_profile(self, source_profile_path: str) -> str:
        """
        Creates a temporary copy of the Firefox profile to avoid profile-lock issues
        when regular Firefox is open.
        """
        temp_profile_path = tempfile.mkdtemp(prefix="mpv2_ff_profile_")
        copied_profile_path = os.path.join(temp_profile_path, "profile")

        shutil.copytree(
            source_profile_path,
            copied_profile_path,
            dirs_exist_ok=True,
            ignore=shutil.ignore_patterns("parent.lock", "lock", ".parentlock"),
        )

        return copied_profile_path

    def _cleanup_runtime_profile(self) -> None:
        """Best-effort cleanup for the temporary Firefox profile copy."""
        runtime_profile = getattr(self, "_runtime_profile_path", None)
        if runtime_profile and os.path.isdir(runtime_profile):
            temp_root = os.path.dirname(runtime_profile)
            shutil.rmtree(temp_root, ignore_errors=True)

    def _resume_state_path(self) -> str:
        return os.path.join(ROOT_DIR, ".mp", f"youtube_resume_{self._account_uuid}.json")

    def _save_resume_state(self, stage: str) -> None:
        payload = {
            "stage": stage,
            "account_id": self._account_uuid,
            "subject": self.subject,
            "script": self.script,
            "metadata": self.metadata,
            "image_prompts": self.image_prompts,
        }
        with open(self._resume_state_path(), "w", encoding="utf-8") as file:
            json.dump(payload, file, ensure_ascii=False, indent=2)

    def _load_resume_state(self) -> bool:
        state_path = self._resume_state_path()
        if not os.path.exists(state_path):
            return False

        try:
            with open(state_path, "r", encoding="utf-8") as file:
                payload = json.load(file)

            if payload.get("account_id") != self._account_uuid:
                return False

            self.subject = str(payload.get("subject") or "")
            self.script = str(payload.get("script") or "")
            self.metadata = payload.get("metadata") or {}
            self.image_prompts = payload.get("image_prompts") or []

            if get_verbose():
                info(
                    f" => Resuming previous YouTube generation from stage: {payload.get('stage', 'unknown')}"
                )

            return True
        except Exception as exc:
            warning(f"Failed to load resume state, starting fresh: {exc}")
            return False

    def _clear_resume_state(self) -> None:
        state_path = self._resume_state_path()
        if os.path.exists(state_path):
            os.remove(state_path)

    @property
    def niche(self) -> str:
        """
        Getter Method for the niche.

        Returns:
            niche (str): The niche
        """
        return self._niche

    @property
    def language(self) -> str:
        """
        Getter Method for the language to use.

        Returns:
            language (str): The language
        """
        return self._language

    def generate_response(self, prompt: str, model_name: Optional[str] = None) -> str:
        """
        Generates an LLM Response based on a prompt and the user-provided model.

        Args:
            prompt (str): The prompt to use in the text generation.

        Returns:
            response (str): The generated AI Repsonse.
        """
        return generate_text(prompt, model_name=model_name)

    def generate_topic(self) -> str:
        """
        Generates a topic based on the YouTube Channel niche.

        Returns:
            topic (str): The generated topic.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n📚 [Session {session_id}] === STAGE: TOPIC GENERATION ===")
        info(f"    Niche: {self.niche}")
        
        topic_prompt = (
            f"Please generate a specific video idea that takes about the following topic: {self.niche}. "
            "Make it exactly one sentence. Only return the topic, nothing else."
        )
        completion = self.generate_response(topic_prompt)

        if not completion:
            error("Failed to generate Topic.")

        self.subject = completion
        info(f"    Generated Subject: {completion[:100]}...")

        if self._session:
            self._session.save_stage(
                "topic",
                subject=self.subject,
                topic_prompt=topic_prompt,
                topic_output=completion,
            )

        return completion

    def generate_script(self) -> Optional[str]:
        """
        Generate a script for a video, depending on the subject of the video, the number of paragraphs, and the AI model.

        Returns:
            script (str): The script of the video.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n📝 [Session {session_id}] === STAGE: SCRIPT GENERATION ===")
        info(f"    Subject: {self.subject}")
        
        sentence_length = get_script_sentence_length()
        prompt = f"""
        Generate a script for a video in {sentence_length} sentences, depending on the subject of the video.

        The script is to be returned as a string with the specified number of paragraphs.

        Here is an example of a string:
        "This is an example string."

        Do not under any circumstance reference this prompt in your response.

        Get straight to the point, don't start with unnecessary things like, "welcome to this video".

        Obviously, the script should be related to the subject of the video.
        
        YOU MUST NOT EXCEED THE {sentence_length} SENTENCES LIMIT. MAKE SURE THE {sentence_length} SENTENCES ARE SHORT.
        YOU MUST NOT INCLUDE ANY TYPE OF MARKDOWN OR FORMATTING IN THE SCRIPT, NEVER USE A TITLE.
        YOU MUST WRITE THE SCRIPT IN THE LANGUAGE SPECIFIED IN [LANGUAGE].
        ONLY RETURN THE RAW CONTENT OF THE SCRIPT. DO NOT INCLUDE "VOICEOVER", "NARRATOR" OR SIMILAR INDICATORS OF WHAT SHOULD BE SPOKEN AT THE BEGINNING OF EACH PARAGRAPH OR LINE. YOU MUST NOT MENTION THE PROMPT, OR ANYTHING ABOUT THE SCRIPT ITSELF. ALSO, NEVER TALK ABOUT THE AMOUNT OF PARAGRAPHS OR LINES. JUST WRITE THE SCRIPT
        
        Subject: {self.subject}
        Language: {self.language}
        """
        completion = self.generate_response(prompt)

        # Apply regex to remove *
        completion = re.sub(r"\*", "", completion)

        if not completion:
            error("The generated script is empty.")
            return

        if len(completion) > 5000:
            if get_verbose():
                warning("Generated Script is too long. Retrying...")
            return self.generate_script()

        self.script = completion
        session_id = self._session.session_id if self._session else "unknown"
        info(f"    Generated script: {len(completion)} chars, {len(completion.split())} words")

        if self._session:
            self._session.save_stage(
                "script",
                subject=self.subject,
                script=self.script,
                script_prompt=prompt.strip(),
                script_output=completion,
            )

        return completion

    def generate_metadata(self) -> dict:
        """
        Generates Video metadata for the to-be-uploaded YouTube Short (Title, Description).

        Returns:
            metadata (dict): The generated metadata.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n📋 [Session {session_id}] === STAGE: METADATA GENERATION ===")

        title_prompt = (
            "Please generate a YouTube Video Title for the following subject, including hashtags: "
            f"{self.subject}. Only return the title, nothing else. Limit the title under 100 characters."
        )

        title = ""
        for _ in range(3):
            generated_title = self.generate_response(title_prompt)

            if generated_title:
                title = generated_title.strip().replace("\n", " ")

            if len(title) <= 100:
                break

            if get_verbose():
                warning("Generated Title is too long. Retrying...")

        if len(title) > 100:
            title = title[:97].rsplit(" ", 1)[0] + "..."
            if get_verbose():
                warning("Generated Title is still too long. Trimming automatically.")

        description_prompt = (
            f"Please generate a YouTube Video Description for the following script: {self.script}. "
            "Only return the description, nothing else."
        )
        description = self.generate_response(description_prompt)

        self.metadata = {"title": title, "description": description}
        info(f"    Title: {title}")
        info(f"    Description: {description[:80]}...")

        if self._session:
            self._session.save_stage(
                "metadata",
                subject=self.subject,
                script=self.script,
                metadata=self.metadata,
                metadata_title_prompt=title_prompt,
                metadata_description_prompt=description_prompt,
                metadata_output=self.metadata,
            )

        return self.metadata

    def _sanitize_prompt(self, prompt: str) -> str:
        """
        Sanitize image prompts to avoid Gemini safety filter triggers.
        Replaces problematic keywords with safer alternatives.

        Args:
            prompt (str): Raw image prompt

        Returns:
            prompt (str): Sanitized prompt
        """
        # Replace problematic keywords with safe alternatives
        replacements = {
            "mad agent": "innovative agent",
            "unbridled": "boundless",
            "unconventional": "creative",
            "improvisational role-playing": "creative role-playing",
            "boundary-pushing": "exploration-driven",
            "transgressive": "transformative",
        }
        
        sanitized = prompt.lower()
        for unsafe, safe in replacements.items():
            if unsafe in sanitized:
                prompt = re.sub(
                    re.escape(unsafe),
                    safe,
                    prompt,
                    flags=re.IGNORECASE
                )
                if get_verbose():
                    info(f"🛡️  Sanitized prompt: '{unsafe}' → '{safe}'")
        
        return prompt

    def _estimate_image_prompt_count(self) -> int:
        """
        Estimate a reasonable number of image prompts from the script.
        Uses sentence count instead of raw character count.
        """
        sentences = [s.strip() for s in re.split(r"[.!?]+", self.script) if s.strip()]
        sentence_count = len(sentences)

        if sentence_count <= 0:
            return 4

        return max(3, min(sentence_count, 8))

    def _extract_image_prompts(self, completion: str) -> List[str]:
        """
        Parse image prompts from various LLM output formats.
        Supports JSON array/object, bracket blocks, and numbered/bulleted lines.
        """
        text = (completion or "").strip()
        if not text:
            return []

        # 1) JSON object with image_prompts key
        try:
            parsed = json.loads(text)
            if isinstance(parsed, dict) and isinstance(parsed.get("image_prompts"), list):
                return [str(p).strip() for p in parsed["image_prompts"] if str(p).strip()]
            if isinstance(parsed, list):
                return [str(p).strip() for p in parsed if str(p).strip()]
        except Exception:
            pass

        # 2) Bracket array somewhere in text
        try:
            bracket_match = re.search(r"\[[\s\S]*\]", text)
            if bracket_match:
                parsed = json.loads(bracket_match.group(0))
                if isinstance(parsed, list):
                    return [str(p).strip() for p in parsed if str(p).strip()]
        except Exception:
            pass

        # 3) Numbered or bulleted lines
        prompts = []
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue

            # remove prefix like "1.", "1)", "-", "*"
            line = re.sub(r"^\d+[\.)]\s*", "", line)
            line = re.sub(r"^[\-*]\s*", "", line)

            if line and len(line) > 8:
                prompts.append(line)

        return prompts

    def _fallback_image_prompts(self, n_prompts: int) -> List[str]:
        """Generate deterministic fallback prompts so pipeline can continue."""
        safe_subject = (self.subject or "the topic").strip()
        base = [
            f"A clean cinematic scene representing {safe_subject} with natural lighting and clear composition.",
            f"A close-up visual concept about {safe_subject}, modern style, high detail, 9:16 framing.",
            f"An inspiring visual metaphor for {safe_subject}, vibrant colors, professional photography look.",
            f"A realistic environment illustrating {safe_subject}, balanced contrast, soft shadows, sharp focus.",
            f"A minimal but powerful visual about {safe_subject}, studio-quality render, vertical layout.",
            f"A dynamic scene tied to {safe_subject}, storytelling composition, high-resolution detail.",
            f"A modern editorial image around {safe_subject}, polished, clean, and engaging aesthetic.",
            f"A symbolic and creative depiction of {safe_subject}, cinematic depth, premium visual style.",
        ]
        return base[: max(1, min(n_prompts, len(base)))]

    def generate_prompts(self) -> List[str]:
        """
        Generates AI Image Prompts based on the provided Video Script.

        Returns:
            image_prompts (List[str]): Generated List of image prompts.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"📝 [Session {session_id}] Generating image prompts from script...")

        n_prompts = self._estimate_image_prompt_count()
        info(f"    Requesting {n_prompts} image prompts from Ollama based on script length")

        prompt = f"""
        Generate {n_prompts} Image Prompts for AI Image Generation,
        depending on the subject of a video.
        Subject: {self.subject}

        The image prompts are to be returned as
        a JSON-Array of strings.

        Each search term should consist of a full sentence,
        always add the main subject of the video.

        Be emotional and use interesting adjectives to make the
        Image Prompt as detailed as possible.

        IMPORTANT SAFETY GUIDELINES:
        - Always use positive, constructive language
        - Avoid extreme or transgressive adjectives
        - Focus on beauty, creativity, and discovery
        - Keep descriptions professional and neutral
        - Example safe descriptors: innovative, creative, beautiful, inspiring, engaging

        YOU MUST ONLY RETURN THE JSON-ARRAY OF STRINGS.
        YOU MUST NOT RETURN ANYTHING ELSE.
        YOU MUST NOT RETURN THE SCRIPT.

        The search terms must be related to the subject of the video.
        Here is an example of a JSON-Array of strings:
        ["image prompt 1", "image prompt 2", "image prompt 3"]

        For context, here is the full text:
        {self.script}
        """

        image_prompts = []
        completion = ""
        max_attempts = 2

        for attempt in range(1, max_attempts + 1):
            completion = (
                str(self.generate_response(prompt))
                .replace("```json", "")
                .replace("```", "")
            )
            info(f"    Ollama returned {len(completion)} characters of prompt data (attempt {attempt}/{max_attempts})")

            image_prompts = self._extract_image_prompts(completion)
            if image_prompts:
                break

            warning("Could not parse image prompts from Ollama response.")
            if attempt < max_attempts:
                warning("Retrying image prompt generation once...")

        if not image_prompts:
            warning("Using fallback image prompts to keep pipeline moving.")
            image_prompts = self._fallback_image_prompts(n_prompts)

        if len(image_prompts) > n_prompts:
            image_prompts = image_prompts[:n_prompts]

        # Sanitize all prompts to avoid safety filter triggers
        session_id = self._session.session_id if self._session else "unknown"
        info(f"🔍 [Session {session_id}] Sanitizing {len(image_prompts)} image prompts...")
        image_prompts = [self._sanitize_prompt(p) for p in image_prompts]

        self.image_prompts = image_prompts

        success(f"✅ Generated & sanitized {len(image_prompts)} Image Prompts.")
        if get_verbose():
            for idx, p in enumerate(image_prompts, 1):
                info(f"  [{idx}] {p[:80]}...")

        if self._session:
            self._session.save_stage(
                "prompts",
                subject=self.subject,
                script=self.script,
                image_prompts=self.image_prompts,
                image_prompt_count=n_prompts,
                image_prompt_request=prompt.strip(),
                image_prompt_raw_response=str(completion or "").strip(),
            )

        return image_prompts

    def _persist_image(self, image_bytes: bytes, provider_label: str) -> str:
        """
        Writes generated image bytes to a PNG file in .mp (no session).
        """
        image_path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".png")
        with open(image_path, "wb") as image_file:
            image_file.write(image_bytes)
        if get_verbose():
            info(f' => Wrote image from {provider_label} to "{image_path}"')
        self.images.append(image_path)
        return image_path

    def _persist_image_to_session(self, prompt: str, image_bytes: bytes, provider_label: str) -> str:
        """Write image to session cache dir (if session exists) or fallback to .mp root."""
        if self._session:
            image_path = self._session.image_cache_path(prompt)
        else:
            image_path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".png")

        with open(image_path, "wb") as image_file:
            image_file.write(image_bytes)

        if get_verbose():
            info(f' => Wrote image from {provider_label} to "{image_path}"')

        self.images.append(image_path)
        return image_path

    def generate_image_nanobanana2(self, prompt: str) -> Optional[str]:
        """
        Generates an AI Image using Nano Banana 2 API (Gemini image API).

        Args:
            prompt (str): Prompt for image generation

        Returns:
            path (str): The path to the generated image.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"🎨 [Session {session_id}] Generating Image using Nano Banana 2 API")
        info(f"    Prompt: {prompt[:100]}...")

        api_key = get_nanobanana2_api_key()
        if not api_key:
            error("nanobanana2_api_key is not configured.")
            return None

        base_url = get_nanobanana2_api_base_url().rstrip("/")
        model = get_nanobanana2_model()
        aspect_ratio = get_nanobanana2_aspect_ratio()

        endpoint = f"{base_url}/models/{model}:generateContent"
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {
                "responseModalities": ["IMAGE"],
                "imageConfig": {"aspectRatio": aspect_ratio},
            },
        }

        try:
            response = requests.post(
                endpoint,
                headers={"x-goog-api-key": api_key, "Content-Type": "application/json"},
                json=payload,
                timeout=300,
            )
            response.raise_for_status()
            body = response.json()

            candidates = body.get("candidates", [])
            for candidate in candidates:
                finish_reason = candidate.get("finishReason", "UNKNOWN")
                content = candidate.get("content", {})
                for part in content.get("parts", []):
                    inline_data = part.get("inlineData") or part.get("inline_data")
                    if not inline_data:
                        continue
                    data = inline_data.get("data")
                    mime_type = inline_data.get("mimeType") or inline_data.get("mime_type", "")
                    if data and str(mime_type).startswith("image/"):
                        image_bytes = base64.b64decode(data)
                        success(f"✅ [Session {session_id}] Image generated successfully")
                        return self._persist_image_to_session(prompt, image_bytes, "Nano Banana 2 API")

            # Log detailed failure info
            finish_reason = candidates[0].get("finishReason", "UNKNOWN") if candidates else "NO_CANDIDATES"
            warning(f"⚠️  [Session {session_id}] Nano Banana 2 rejected image (reason: {finish_reason})")
            if get_verbose():
                warning(f"    Full response: {body}")
            return None
        except Exception as e:
            error(f"❌ [Session {session_id}] Image generation failed: {str(e)}")
            if get_verbose():
                import traceback
                warning(traceback.format_exc())
            return None

    def generate_image(self, prompt: str) -> Optional[str]:
        """
        Generates an AI Image. Checks session cache first to save API tokens.

        Args:
            prompt (str): Reference for image generation

        Returns:
            path (str): The path to the generated image.
        """
        # Cache check before calling API
        if self._session:
            cached = self._session.get_cached_image(prompt)
            if cached:
                info(f"💾 Cache HIT image: {os.path.basename(cached)}")
                self.images.append(cached)
                return cached

        return self.generate_image_nanobanana2(prompt)

    def generate_script_to_speech(self, tts_instance: TTS, force_regenerate: bool = False) -> str:
        """
        Converts the generated script into Speech. Checks session cache first.

        Args:
            tts_instance (tts): Instance of TTS Class.

        Returns:
            path_to_wav (str): Path to generated audio (WAV Format).
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n🎙️  [Session {session_id}] === STAGE: TEXT-TO-SPEECH ===")
        
        # Normalise whitespace before cache lookup
        self.script = re.sub(r"\s+", " ", self.script).strip()
        self.voice_used = tts_instance.voice_name
        tts_cache_key = f"{self.script}||voice:{tts_instance.voice_name}"

        # Cache check
        if self._session and not force_regenerate:
            cached_audio = self._session.get_cached_audio(tts_cache_key)
            if cached_audio:
                info(f"💾 Cache HIT audio: {os.path.basename(cached_audio)}")
                self.tts_path = cached_audio
                return cached_audio

        # Determine output path (session cache or .mp root)
        if self._session:
            path = self._session.audio_cache_path(tts_cache_key)
        else:
            path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".wav")

        if force_regenerate:
            info("    Re-generating audio from TTS step (cache bypass enabled)...")
        info(f"    Synthesizing audio ({len(self.script)} chars) with voice: {tts_instance.voice_name}...")
        tts_instance.synthesize(self.script, path)
        self.tts_path = path

        if get_verbose():
            info(f' => Wrote TTS to "{path}"')
        
        success(f"✅ Audio generated: {os.path.basename(path)}")

        return path

    @staticmethod
    def _extract_srt_preview(srt_path: str, max_lines: int = 8) -> str:
        try:
            with open(srt_path, "r", encoding="utf-8") as file:
                raw_lines = [line.strip() for line in file.readlines()]

            text_lines = []
            for line in raw_lines:
                if not line or line.isdigit() or "-->" in line:
                    continue
                text_lines.append(line)

            return "\n".join(text_lines[:max_lines]).strip()
        except Exception:
            return ""

    def generate_subtitle_preview(self, tts_instance: TTS, force_regenerate_audio: bool = False) -> dict:
        """
        Generate or refresh subtitle preview from the current script/audio without composing the video.

        Args:
            tts_instance (TTS): Instance of TTS Class.
            force_regenerate_audio (bool): Bypass cached audio when True.

        Returns:
            dict: Paths and preview text for the generated subtitle preview.
        """
        if not str(self.script).strip():
            raise ValueError("Cannot generate subtitle preview without script text")

        audio_path = self.generate_script_to_speech(
            tts_instance,
            force_regenerate=force_regenerate_audio,
        )
        subtitles_path = self.generate_subtitles(
            audio_path,
            translate_to_english=bool(self.english_cc_bottom),
        )

        self.tts_path = audio_path
        self.subtitle_path = subtitles_path
        self.subtitle_preview = self._extract_srt_preview(subtitles_path)

        return {
            "audio_path": audio_path,
            "subtitle_path": subtitles_path,
            "subtitle_preview": self.subtitle_preview,
            "voice_used": self.voice_used,
            "tts_text": self.script,
        }

    def add_video(self, video: dict) -> None:
        """
        Adds a video to the cache.

        Args:
            video (dict): The video to add

        Returns:
            None
        """
        videos = self.get_videos()
        videos.append(video)

        cache = get_youtube_cache_path()

        with open(cache, "r") as file:
            previous_json = json.loads(file.read())

            # Find our account
            accounts = previous_json["accounts"]
            for account in accounts:
                if account["id"] == self._account_uuid:
                    account["videos"].append(video)

            # Commit changes
            with open(cache, "w") as f:
                f.write(json.dumps(previous_json))

    def generate_subtitles(self, audio_path: str, translate_to_english: bool = False) -> str:
        """
        Generates subtitles for the audio using the configured STT provider.

        Args:
            audio_path (str): The path to the audio file.

        Returns:
            path (str): The path to the generated SRT File.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n📝 [Session {session_id}] === STAGE: SUBTITLE GENERATION ===")
        
        provider = str(get_stt_provider() or "local_whisper").lower()
        if translate_to_english:
            info("    Subtitle mode: English translation")
        info(f"    STT Provider: {provider}")

        if provider == "local_whisper":
            return self.generate_subtitles_local_whisper(audio_path, translate_to_english=translate_to_english)

        if provider == "third_party_assemblyai":
            if translate_to_english:
                warning("AssemblyAI provider does not support in-pipeline translation here. Using original transcript for subtitles.")
            return self.generate_subtitles_assemblyai(audio_path)

        warning(f"Unknown stt_provider '{provider}'. Falling back to local_whisper.")
        return self.generate_subtitles_local_whisper(audio_path, translate_to_english=translate_to_english)

    def generate_subtitles_assemblyai(self, audio_path: str) -> str:
        """
        Generates subtitles using AssemblyAI.

        Args:
            audio_path (str): Audio file path

        Returns:
            path (str): Path to SRT file
        """
        aai.settings.api_key = get_assemblyai_api_key()
        config = aai.TranscriptionConfig()
        transcriber = aai.Transcriber(config=config)
        transcript = transcriber.transcribe(audio_path)
        subtitles = transcript.export_subtitles_srt()

        srt_path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".srt")

        with open(srt_path, "w") as file:
            file.write(subtitles)

        return srt_path

    def _format_srt_timestamp(self, seconds: float) -> str:
        """
        Formats a timestamp in seconds to SRT format.

        Args:
            seconds (float): Seconds

        Returns:
            ts (str): HH:MM:SS,mmm
        """
        total_millis = max(0, int(round(seconds * 1000)))
        hours = total_millis // 3600000
        minutes = (total_millis % 3600000) // 60000
        secs = (total_millis % 60000) // 1000
        millis = total_millis % 1000
        return f"{hours:02d}:{minutes:02d}:{secs:02d},{millis:03d}"

    def generate_subtitles_local_whisper(self, audio_path: str, translate_to_english: bool = False) -> str:
        """
        Generates subtitles using local Whisper (faster-whisper).

        Args:
            audio_path (str): Audio file path

        Returns:
            path (str): Path to SRT file
        """
        try:
            from faster_whisper import WhisperModel
        except ImportError:
            error(
                "Local STT selected but 'faster-whisper' is not installed. "
                "Install it or switch stt_provider to third_party_assemblyai."
            )
            raise

        def _is_cuda_runtime_error(exc: Exception) -> bool:
            msg = str(exc).lower()
            cuda_markers = ["cublas", "cuda", "cudnn", "cannot be loaded", "failed to load"]
            return any(marker in msg for marker in cuda_markers)

        def _looks_broken_translation(text: str) -> bool:
            sample = (text or "").lower()
            if not sample:
                return False

            # Common artifact pattern seen in failed translation decoding
            # e.g. "B-letter ... 1-E-..."
            markers = ["-letter", "letter 1-", "1-e-", "1-a-"]
            marker_hits = sum(sample.count(m) for m in markers)
            return marker_hits >= 3

        def _transcribe_to_srt(device: str, compute_type: str, use_language_hint: bool = True) -> str:
            whisper_model_name = get_whisper_model()
            whisper_language = _resolve_whisper_language(self.language)
            task_name = "translate" if translate_to_english else "transcribe"
            whisper_language_for_run = whisper_language if use_language_hint else None

            info(
                f"    Loading local Whisper model='{whisper_model_name}' "
                f"device='{device}' compute='{compute_type}'"
            )
            if whisper_language_for_run:
                info(f"    Whisper language hint: {whisper_language_for_run}")
            elif translate_to_english:
                info("    Whisper language hint: auto-detect")
            info(f"    Whisper task: {task_name}")

            started_at = time.time()
            model = WhisperModel(
                whisper_model_name,
                device=device,
                compute_type=compute_type,
            )
            info("    Whisper model ready. Starting transcription...")

            # Pass the account language so Whisper does not mis-detect
            # Vietnamese (or other non-English languages) as English.
            segments, _ = model.transcribe(
                audio_path,
                language=whisper_language_for_run,
                vad_filter=get_whisper_vad_filter(),
                beam_size=max(1, int(get_whisper_beam_size())),
                best_of=1,
                task=task_name,
            )

            lines = []
            emitted_segments = 0
            for idx, segment in enumerate(segments, start=1):
                start = self._format_srt_timestamp(segment.start)
                end = self._format_srt_timestamp(segment.end)
                text = str(segment.text).strip()

                if not text:
                    continue

                emitted_segments += 1
                if emitted_segments == 1 or emitted_segments % 20 == 0:
                    info(f"    Whisper progress: {emitted_segments} subtitle segment(s) parsed...")

                lines.append(str(idx))
                lines.append(f"{start} --> {end}")
                lines.append(text)
                lines.append("")

            subtitles = "\n".join(lines)
            srt_path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".srt")
            with open(srt_path, "w", encoding="utf-8") as file:
                file.write(subtitles)

            elapsed = time.time() - started_at
            if emitted_segments == 0:
                warning(
                    "    Whisper finished but produced 0 subtitle segments. "
                    "Check audio quality/language settings."
                )
            info(
                f"    Whisper transcription done: {emitted_segments} segment(s) "
                f"in {elapsed:.1f}s"
            )
            info(f"    Subtitle file: {srt_path}")

            return srt_path

        configured_device = str(get_whisper_device() or "auto").lower()
        configured_compute_type = str(get_whisper_compute_type() or "int8").lower()

        try:
            srt_path = _transcribe_to_srt(
                configured_device,
                configured_compute_type,
                use_language_hint=True,
            )

            if translate_to_english:
                preview = self._extract_srt_preview(srt_path, max_lines=4)
                if _looks_broken_translation(preview):
                    warning(
                        "Detected broken translated subtitles from local Whisper. "
                        "Retrying with auto language detection..."
                    )
                    srt_path = _transcribe_to_srt(
                        configured_device,
                        configured_compute_type,
                        use_language_hint=False,
                    )

            return srt_path
        except Exception as exc:
            if configured_device != "cpu" and _is_cuda_runtime_error(exc):
                warning(
                    "CUDA runtime for local Whisper is unavailable. "
                    "Retrying subtitle generation on CPU..."
                )
                srt_path = _transcribe_to_srt("cpu", "int8", use_language_hint=True)

                if translate_to_english:
                    preview = self._extract_srt_preview(srt_path, max_lines=4)
                    if _looks_broken_translation(preview):
                        warning(
                            "Detected broken translated subtitles on CPU run. "
                            "Retrying with auto language detection..."
                        )
                        srt_path = _transcribe_to_srt("cpu", "int8", use_language_hint=False)

                return srt_path
            raise

    def combine(self) -> str:
        """
        Combines everything into the final video.

        Returns:
            path (str): The path to the generated MP4 File.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"    Composing final video (audio duration: {self._get_audio_duration()}s)...")
        
        if not self.tts_path or not os.path.exists(self.tts_path):
            warning(f"⚠️  Audio file not found: {self.tts_path}. Re-running TTS generation...")
            # This shouldn't happen in normal flow, but let's handle it gracefully
            raise RuntimeError(f"Audio file missing: {self.tts_path}. Cannot compose video.")
        
        if self._session:
            combined_image_path = self._session.video_output_path()
        else:
            combined_image_path = os.path.join(ROOT_DIR, ".mp", str(uuid4()) + ".mp4")
        threads = get_threads()
        tts_clip = AudioFileClip(self.tts_path)
        max_duration = tts_clip.duration

        # Subtitle rendering tuned for vertical 1080x1920 output.
        # In bottom mode we use a safe-area box and smaller dynamic font size
        # to avoid clipping long translated lines.
        subtitle_font_path = os.path.join(get_fonts_dir(), get_font())

        def _subtitle_font_size(text: str) -> int:
            text_len = len((text or "").strip())
            if bool(self.english_cc_bottom):
                if text_len > 120:
                    return 48
                if text_len > 90:
                    return 52
                if text_len > 60:
                    return 56
                return 60

            if text_len > 120:
                return 64
            if text_len > 80:
                return 70
            return 76

        def generator(txt: str) -> TextClip:
            subtitle_box = (980, 320) if bool(self.english_cc_bottom) else (980, 280)
            return TextClip(
                text=txt,
                font=subtitle_font_path,
                font_size=_subtitle_font_size(txt),
                color="#FFFF00",
                stroke_color="black",
                stroke_width=5,
                size=subtitle_box,
                method="caption",
            )

        print(colored("[+] Combining images...", "blue"))

        if not self.images:
            warning(
                "No images were generated. Falling back to a plain background video. Check image API configuration."
            )
            final_clip = ColorClip(size=(1080, 1920), color=(18, 18, 18), duration=max_duration)
            final_clip = final_clip.with_fps(30)
        else:
            req_dur = max_duration / len(self.images)
            clips = []
            tot_dur = 0

            # Add downloaded clips over and over until the duration of the audio (max_duration) has been reached
            while tot_dur < max_duration:
                for image_path in self.images:
                    clip = ImageClip(image_path).with_duration(req_dur).with_fps(30)

                    # Not all images are same size,
                    # so we need to resize them
                    if round((clip.w / clip.h), 4) < 0.5625:
                        if get_verbose():
                            info(f" => Resizing Image: {image_path} to 1080x1920")
                        clip = clip.cropped(
                            width=clip.w,
                            height=round(clip.w / 0.5625),
                            x_center=clip.w / 2,
                            y_center=clip.h / 2,
                        )
                    else:
                        if get_verbose():
                            info(f" => Resizing Image: {image_path} to 1920x1080")
                        clip = clip.cropped(
                            width=round(0.5625 * clip.h),
                            height=clip.h,
                            x_center=clip.w / 2,
                            y_center=clip.h / 2,
                        )
                    clip = clip.resized((1080, 1920))

                    clips.append(clip)
                    tot_dur += req_dur

                    if tot_dur >= max_duration:
                        break

            final_clip = concatenate_videoclips(clips).with_fps(30)
        try:
            random_song = choose_random_song()
        except Exception as e:
            warning(f"No background music found: {e}")
            random_song = None

        subtitles = None
        self.subtitle_path = ""
        self.subtitle_preview = ""
        try:
            if self._session:
                self._session.save_stage(
                    "subtitles",
                    subject=self.subject,
                    script=self.script,
                    tts_text=self.script,
                    audio_path=self.tts_path,
                    voice_used=getattr(self, "voice_used", ""),
                    metadata=self.metadata,
                    image_paths=self.images,
                    english_cc_bottom=bool(self.english_cc_bottom),
                )
            subtitles_path = self.generate_subtitles(
                self.tts_path,
                translate_to_english=bool(self.english_cc_bottom),
            )
            try:
                equalize_subtitles(subtitles_path, 10)
            except Exception as eq_exc:
                # Keep original subtitles if equalizer rejects absolute paths or fails.
                warning(f"Subtitle equalizer failed, using raw subtitles: {eq_exc}")
            # Keep subtitles inside a bottom safe-area to prevent cropped text.
            subtitle_position = ("center", 1460) if bool(self.english_cc_bottom) else ("center", 1520)
            info(
                f"    Subtitle render: position={subtitle_position}, "
                f"mode={'english_bottom' if bool(self.english_cc_bottom) else 'default'}"
            )
            subtitles = SubtitlesClip(subtitles_path, make_textclip=generator).with_position(subtitle_position)
            self.subtitle_path = subtitles_path
            self.subtitle_preview = self._extract_srt_preview(subtitles_path)
        except Exception as e:
            warning(f"Failed to generate subtitles, continuing without subtitles: {e}")

        if random_song:
            random_song_clip = AudioFileClip(random_song).with_fps(44100)
            # Turn down volume
            random_song_clip = random_song_clip.with_volume_scaled(0.1)
            comp_audio = CompositeAudioClip([tts_clip.with_fps(44100), random_song_clip])
        else:
            comp_audio = tts_clip.with_fps(44100)

        final_clip = final_clip.with_audio(comp_audio)  # type: ignore[attr-defined]
        final_clip = final_clip.with_duration(tts_clip.duration)

        if subtitles is not None:
            final_clip = CompositeVideoClip([final_clip, subtitles])

        if self._session:
            self._session.save_stage(
                "video_generated",
                subject=self.subject,
                script=self.script,
                tts_text=self.script,
                subtitle_path=getattr(self, "subtitle_path", ""),
                subtitle_preview=getattr(self, "subtitle_preview", ""),
                english_cc_bottom=bool(getattr(self, "english_cc_bottom", False)),
                image_paths=self.images,
                audio_path=self.tts_path,
                voice_used=getattr(self, "voice_used", ""),
                metadata=self.metadata,
            )

        info(f"    Writing video file (this may take a few minutes)...")
        final_clip.write_videofile(
            combined_image_path,
            threads=threads,
            codec="libx264",
            audio_codec="aac",
            preset=get_video_encode_preset(),
            ffmpeg_params=["-crf", str(get_video_encode_crf())],
        )

        success(f'✅ Video saved to "{combined_image_path}"')

        return combined_image_path
    
    def _get_audio_duration(self) -> float:
        """Helper to get audio duration safely."""
        try:
            return AudioFileClip(self.tts_path).duration if self.tts_path else 0
        except:
            return 0

    def generate_video(self, tts_instance: TTS, skip_until_stage: str = "") -> str:
        """
        Generates a YouTube Short based on the provided niche and language.

        Args:
            tts_instance (TTS): Instance of TTS Class.
            skip_until_stage (str): If provided, skip stages before this one (e.g., 'images', 'tts', 'video_generated').

        Returns:
            path (str): The path to the generated MP4 File.
        """
        session_id = self._session.session_id if self._session else "unknown"
        info(f"\n{'='*60}")
        info(f"🚀 [Session {session_id}] Starting YouTube Short Generation")
        info(f"   Niche: {self.niche}")
        info(f"   Language: {self.language}")
        if skip_until_stage:
            info(f"   🔄 Re-generating from: {skip_until_stage}")
        info(f"{'='*60}\n")
        
        self._load_resume_state()

        # Map of stages to skip regenerating before
        skip_stages = {
            'script': ['topic'],  # Skip topic, regenerate script onward
            'images': ['topic', 'script', 'metadata', 'prompts'],  # Skip these, regenerate images onward
            'tts': ['topic', 'script', 'metadata', 'prompts', 'images'],  # Skip these, regenerate TTS onward
            'subtitles': ['topic', 'script', 'metadata', 'prompts', 'images', 'tts'],  # Re-compose video to regenerate subtitles
            'video_generated': ['topic', 'script', 'metadata', 'prompts', 'images', 'tts'],  # Skip these, regenerate video onward
            'ready_for_review': ['topic', 'script', 'metadata', 'prompts', 'images', 'tts'],  # Re-compose and return ready_for_review
        }

        # Generate only missing stages so reruns can resume without re-calling LLM.
        if skip_until_stage not in skip_stages or 'topic' not in skip_stages.get(skip_until_stage, []):
            if not self.subject:
                self.generate_topic()
                self._save_resume_state("topic")

        if skip_until_stage not in skip_stages or 'script' not in skip_stages.get(skip_until_stage, []):
            if not self.script:
                self.generate_script()
                self._save_resume_state("script")

        if skip_until_stage not in skip_stages or 'metadata' not in skip_stages.get(skip_until_stage, []):
            if not self.metadata or not self.metadata.get("title"):
                self.generate_metadata()
                self._save_resume_state("metadata")

        if skip_until_stage not in skip_stages or 'prompts' not in skip_stages.get(skip_until_stage, []):
            if not self.image_prompts:
                self.generate_prompts()
                self._save_resume_state("prompts")

        # Generate the Images (or skip if regenerating after this stage)
        if skip_until_stage not in skip_stages or 'images' not in skip_stages.get(skip_until_stage, []):
            session_id = self._session.session_id if self._session else "unknown"
            info(f"\n🎨 [Session {session_id}] === STAGE: IMAGE GENERATION ===")
            info(f"    Generating {len(self.image_prompts)} images...")
            if self._session:
                self._session.save_stage(
                    "images",
                    subject=self.subject,
                    script=self.script,
                    metadata=self.metadata,
                    image_prompts=self.image_prompts,
                    image_paths=self.images,
                    english_cc_bottom=bool(self.english_cc_bottom),
                )
            
            image_generation_failures = 0
            for idx, prompt in enumerate(self.image_prompts, 1):
                info(f"    [{idx}/{len(self.image_prompts)}] {prompt[:60]}...")
                generated_image_path = self.generate_image(prompt)
                if not generated_image_path:
                    image_generation_failures += 1

            self._save_resume_state("images")

            if image_generation_failures:
                warning(
                    f"⚠️  Failed to generate {image_generation_failures} image(s). Continuing with {len(self.images)} generated image(s)."
                )

            if not self.images:
                warning(
                    "⚠️  Image generation produced no usable files. The final video will use a plain background instead."
                )

        # Generate the TTS (or skip if regenerating after this stage)
        if skip_until_stage not in skip_stages or 'tts' not in skip_stages.get(skip_until_stage, []):
            if self._session:
                self._session.save_stage(
                    "tts",
                    subject=self.subject,
                    script=self.script,
                    metadata=self.metadata,
                    image_prompts=self.image_prompts,
                    image_paths=self.images,
                    english_cc_bottom=bool(self.english_cc_bottom),
                )
            self.generate_script_to_speech(
                tts_instance,
                force_regenerate=(skip_until_stage == 'tts'),
            )
            if self._session:
                self._session.save_stage(
                    "tts",
                    subject=self.subject,
                    script=self.script,
                    tts_text=self.script,
                    audio_path=self.tts_path,
                    voice_used=getattr(self, "voice_used", ""),
                    metadata=self.metadata,
                    image_prompts=self.image_prompts,
                    image_paths=self.images,
                    english_cc_bottom=bool(self.english_cc_bottom),
                )
            self._save_resume_state("tts")

        # Combine everything
        info(f"\n🎬 [Session {session_id}] === STAGE: VIDEO COMPOSITION ===")
        path = self.combine()
        self._clear_resume_state()

        if get_verbose():
            info(f" => Generated Video: {path}")

        success(f"✅ [Session {session_id}] Video generation complete!")
        self.video_path = os.path.abspath(path)

        if self._session:
            self._session.save_stage(
                "video_generated",
                subject=self.subject,
                script=self.script,
                tts_text=self.script,
                subtitle_path=getattr(self, "subtitle_path", ""),
                subtitle_preview=getattr(self, "subtitle_preview", ""),
                english_cc_bottom=bool(getattr(self, "english_cc_bottom", False)),
                image_paths=self.images,
                audio_path=self.tts_path,
                voice_used=getattr(self, "voice_used", ""),
                video_path=self.video_path,
            )

        return path

    def get_channel_id(self) -> str:
        """
        Gets the Channel ID of the YouTube Account.

        Returns:
            channel_id (str): The Channel ID.
        """
        self._init_browser()   # lazy-init browser only on first upload use
        driver = self.browser
        driver.get("https://studio.youtube.com")
        time.sleep(2)
        channel_id = driver.current_url.split("/")[-1]
        self.channel_id = channel_id

        return channel_id

    def upload_video(self, is_for_kids_override: Optional[bool] = None) -> bool:
        """
        Uploads the video to YouTube.

        Returns:
            success (bool): Whether the upload was successful or not.
        """
        try:
            self._init_browser()   # lazy-init browser only on upload
            self.get_channel_id()

            driver = self.browser
            verbose = get_verbose()

            # Go to youtube.com/upload
            driver.get("https://www.youtube.com/upload")

            # Set video file
            FILE_PICKER_TAG = "ytcp-uploads-file-picker"
            file_picker = driver.find_element(By.TAG_NAME, FILE_PICKER_TAG)
            INPUT_TAG = "input"
            file_input = file_picker.find_element(By.TAG_NAME, INPUT_TAG)
            file_input.send_keys(self.video_path)

            # Wait for upload to finish
            time.sleep(5)

            # Set title
            textboxes = driver.find_elements(By.ID, YOUTUBE_TEXTBOX_ID)

            title_el = textboxes[0]
            description_el = textboxes[-1]

            if verbose:
                info("\t=> Setting title...")

            title_el.click()
            time.sleep(1)
            title_el.clear()
            title_el.send_keys(self.metadata["title"])

            if verbose:
                info("\t=> Setting description...")

            # Set description
            time.sleep(10)
            description_el.click()
            time.sleep(0.5)
            description_el.clear()
            description_el.send_keys(self.metadata["description"])

            time.sleep(0.5)

            # Set `made for kids` option
            if verbose:
                info("\t=> Setting `made for kids` option...")

            is_for_kids_checkbox = driver.find_element(
                By.NAME, YOUTUBE_MADE_FOR_KIDS_NAME
            )
            is_not_for_kids_checkbox = driver.find_element(
                By.NAME, YOUTUBE_NOT_MADE_FOR_KIDS_NAME
            )

            resolved_is_for_kids = get_is_for_kids() if is_for_kids_override is None else bool(is_for_kids_override)

            if not resolved_is_for_kids:
                is_not_for_kids_checkbox.click()
            else:
                is_for_kids_checkbox.click()

            time.sleep(0.5)

            # Click next
            if verbose:
                info("\t=> Clicking next...")

            next_button = driver.find_element(By.ID, YOUTUBE_NEXT_BUTTON_ID)
            next_button.click()

            # Click next again
            if verbose:
                info("\t=> Clicking next again...")
            next_button = driver.find_element(By.ID, YOUTUBE_NEXT_BUTTON_ID)
            next_button.click()

            # Wait for 2 seconds
            time.sleep(2)

            # Click next again
            if verbose:
                info("\t=> Clicking next again...")
            next_button = driver.find_element(By.ID, YOUTUBE_NEXT_BUTTON_ID)
            next_button.click()

            # Set as unlisted
            if verbose:
                info("\t=> Setting as unlisted...")

            radio_button = driver.find_elements(By.XPATH, YOUTUBE_RADIO_BUTTON_XPATH)
            radio_button[2].click()

            if verbose:
                info("\t=> Clicking done button...")

            # Click done button
            done_button = driver.find_element(By.ID, YOUTUBE_DONE_BUTTON_ID)
            done_button.click()

            # Wait for 2 seconds
            time.sleep(2)

            # Get latest video
            if verbose:
                info("\t=> Getting video URL...")

            # Get the latest uploaded video URL
            driver.get(
                f"https://studio.youtube.com/channel/{self.channel_id}/videos/short"
            )
            time.sleep(2)
            videos = driver.find_elements(By.TAG_NAME, "ytcp-video-row")
            first_video = videos[0]
            anchor_tag = first_video.find_element(By.TAG_NAME, "a")
            href = anchor_tag.get_attribute("href")
            if verbose:
                info(f"\t=> Extracting video ID from URL: {href}")
            video_id = href.split("/")[-2]

            # Build URL
            url = build_url(video_id)

            self.uploaded_video_url = url

            if verbose:
                success(f" => Uploaded Video: {url}")

            # Add video to cache
            self.add_video(
                {
                    "title": self.metadata["title"],
                    "description": self.metadata["description"],
                    "url": url,
                    "date": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
                }
            )

            # Close the browser
            driver.quit()

            return True
        except Exception:
            if self.browser is not None:
                try:
                    self.browser.quit()
                except Exception:
                    pass
            return False

    def get_videos(self) -> List[dict]:
        """
        Gets the uploaded videos from the YouTube Channel.

        Returns:
            videos (List[dict]): The uploaded videos.
        """
        if not os.path.exists(get_youtube_cache_path()):
            # Create the cache file
            with open(get_youtube_cache_path(), "w") as file:
                json.dump({"videos": []}, file, indent=4)
            return []

        videos = []
        # Read the cache file
        with open(get_youtube_cache_path(), "r") as file:
            previous_json = json.loads(file.read())
            # Find our account
            accounts = previous_json["accounts"]
            for account in accounts:
                if account["id"] == self._account_uuid:
                    videos = account["videos"]

        return videos
