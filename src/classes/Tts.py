import os
import re
import unicodedata
import numpy as np
import soundfile as sf
from kittentts import KittenTTS as KittenModel
from typing import List, Tuple, Optional

from config import ROOT_DIR, get_tts_voice, get_tts_strict_mode
from status import warning

KITTEN_MODEL = "KittenML/kitten-tts-mini-0.8"
KITTEN_SAMPLE_RATE = 24000

class TTS:
    def __init__(self, voice: Optional[str] = None) -> None:
        self._model = KittenModel(KITTEN_MODEL)
        self._voice = (voice or get_tts_voice() or "Jasper").strip()
        self._strict_mode = get_tts_strict_mode()

    @property
    def voice_name(self) -> str:
        return self._voice

    def _normalize_tts_text(self, text: str) -> str:
        """Normalize and sanitize text for more stable ONNX inference."""
        normalized = unicodedata.normalize("NFKC", str(text))

        # Replace common typography variants with model-friendly equivalents.
        replacements = {
            "“": '"',
            "”": '"',
            "‘": "'",
            "’": "'",
            "–": "-",
            "—": "-",
            "…": "...",
            "\u00a0": " ",
        }
        for src, dst in replacements.items():
            normalized = normalized.replace(src, dst)

        # Remove unsupported control chars but keep Vietnamese and punctuation.
        normalized = "".join(ch for ch in normalized if ch == "\n" or (ord(ch) >= 32 and unicodedata.category(ch) != "Cf"))
        normalized = re.sub(r"\s+", " ", normalized).strip()
        return normalized

    def _split_text_for_tts(self, text: str, max_chars: int = 140) -> list[str]:
        """Split text into safer chunks for KittenTTS/ONNX runtime."""
        text = self._normalize_tts_text(text)
        if not text:
            return []

        sentence_like_parts = re.split(r"(?<=[.!?])\s+", text)
        chunks: list[str] = []
        current = ""

        for part in sentence_like_parts:
            part = part.strip()
            if not part:
                continue

            candidate = part if not current else f"{current} {part}"
            if len(candidate) <= max_chars:
                current = candidate
                continue

            if current:
                chunks.append(current)
                current = ""

            if len(part) <= max_chars:
                current = part
                continue

            words = part.split()
            subchunk = ""
            for word in words:
                word_candidate = word if not subchunk else f"{subchunk} {word}"
                if len(word_candidate) <= max_chars:
                    subchunk = word_candidate
                else:
                    if subchunk:
                        chunks.append(subchunk)
                    subchunk = word
            if subchunk:
                current = subchunk

        if current:
            chunks.append(current)

        return chunks

    def _render_chunk_with_fallback(self, chunk: str, depth: int = 0) -> List[np.ndarray]:
        """Render one chunk, recursively splitting when ONNX rejects shape/length."""
        safe_chunk = self._normalize_tts_text(chunk)
        if not safe_chunk:
            return []

        try:
            chunk_audio = self._model.generate(safe_chunk, voice=self._voice)
            return [np.asarray(chunk_audio, dtype=np.float32)]
        except Exception as chunk_exc:
            # Limit recursion depth to avoid pathological loops.
            if depth >= 3 or len(safe_chunk) <= 40:
                raise chunk_exc

            warning(
                f"TTS chunk failed at depth {depth}, splitting further ({len(safe_chunk)} chars): {chunk_exc}"
            )

            # Adaptive split strategy:
            # 1) Split by model-safe chunk size (gets stricter on deeper recursion)
            # 2) Fallback to punctuation split
            # 3) Final fallback to hard midpoint split
            adaptive_max_chars = max(40, 90 - (depth * 20))
            subchunks = self._split_text_for_tts(safe_chunk, max_chars=adaptive_max_chars)

            if len(subchunks) <= 1:
                subchunks = re.split(r"(?<=[,;:.!?])\s+", safe_chunk)
                subchunks = [s.strip() for s in subchunks if s and s.strip()]

            if len(subchunks) <= 1:
                midpoint = len(safe_chunk) // 2
                subchunks = [safe_chunk[:midpoint].strip(), safe_chunk[midpoint:].strip()]

            rendered: List[np.ndarray] = []
            for sub in subchunks:
                if not sub:
                    continue
                rendered.extend(self._render_chunk_with_fallback(sub, depth + 1))
            return rendered

    def _render_chunks(self, chunks: List[str]) -> Tuple[List[np.ndarray], int]:
        """Render chunk list and return successful chunks + fail count."""
        rendered_chunks: List[np.ndarray] = []
        failed_chunks = 0

        for idx, chunk in enumerate(chunks, start=1):
            try:
                rendered_chunks.extend(self._render_chunk_with_fallback(chunk))
            except Exception as chunk_exc:
                failed_chunks += 1
                warning(f"Skipping failed TTS chunk {idx}/{len(chunks)}: {chunk_exc}")

        return rendered_chunks, failed_chunks

    def synthesize(self, text, output_file=os.path.join(ROOT_DIR, ".mp", "audio.wav")):
        normalized_text = self._normalize_tts_text(str(text))
        if not normalized_text:
            raise ValueError("TTS input text is empty after normalization")

        try:
            audio = self._model.generate(normalized_text, voice=self._voice)
            sf.write(output_file, audio, KITTEN_SAMPLE_RATE)
            return output_file
        except Exception as exc:
            warning(
                f"KittenTTS single-pass generation failed ({exc}). Retrying with chunked synthesis to continue without regenerating content..."
            )

        chunks = self._split_text_for_tts(normalized_text)
        if not chunks:
            raise RuntimeError("TTS chunking produced no chunks")

        rendered_chunks, failed_chunks = self._render_chunks(chunks)

        # If too many chunks fail, reduce chunk size and retry one additional pass.
        failed_ratio = (failed_chunks / len(chunks)) if chunks else 1.0
        too_many_failures = failed_chunks > 0 and (failed_chunks >= 2 or failed_ratio >= 0.4)

        if too_many_failures:
            warning(
                f"TTS chunk failures are high ({failed_chunks}/{len(chunks)}). "
                "Reducing chunk size and retrying one additional pass..."
            )
            retry_chunks = self._split_text_for_tts(normalized_text, max_chars=80)
            retry_rendered_chunks, retry_failed_chunks = self._render_chunks(retry_chunks)

            # Prefer retry output when it successfully renders more chunks.
            if retry_rendered_chunks and len(retry_rendered_chunks) >= len(rendered_chunks):
                rendered_chunks = retry_rendered_chunks
                failed_chunks = retry_failed_chunks
                chunks = retry_chunks

        if not rendered_chunks:
            raise RuntimeError("All TTS chunks failed to render")

        if failed_chunks:
            message = f"TTS finished with partial chunk success ({len(chunks) - failed_chunks}/{len(chunks)} chunks rendered)."
            if self._strict_mode:
                raise RuntimeError(f"{message} Strict mode enabled, aborting run.")
            warning(message)

        merged_audio = np.concatenate(rendered_chunks)
        sf.write(output_file, merged_audio, KITTEN_SAMPLE_RATE)
        return output_file
