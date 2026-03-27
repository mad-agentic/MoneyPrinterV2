import os
import re
import numpy as np
import soundfile as sf
from kittentts import KittenTTS as KittenModel
from typing import List, Tuple

from config import ROOT_DIR, get_tts_voice
from status import warning

KITTEN_MODEL = "KittenML/kitten-tts-mini-0.8"
KITTEN_SAMPLE_RATE = 24000

class TTS:
    def __init__(self) -> None:
        self._model = KittenModel(KITTEN_MODEL)
        self._voice = get_tts_voice()

    def _split_text_for_tts(self, text: str, max_chars: int = 220) -> list[str]:
        """Split text into safer chunks for KittenTTS/ONNX runtime."""
        text = re.sub(r"\s+", " ", text).strip()
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

    def _render_chunks(self, chunks: List[str]) -> Tuple[List[np.ndarray], int]:
        """Render chunk list and return successful chunks + fail count."""
        rendered_chunks: List[np.ndarray] = []
        failed_chunks = 0

        for idx, chunk in enumerate(chunks, start=1):
            try:
                chunk_audio = self._model.generate(chunk, voice=self._voice)
                rendered_chunks.append(np.asarray(chunk_audio, dtype=np.float32))
            except Exception as chunk_exc:
                failed_chunks += 1
                warning(f"Skipping failed TTS chunk {idx}/{len(chunks)}: {chunk_exc}")

        return rendered_chunks, failed_chunks

    def synthesize(self, text, output_file=os.path.join(ROOT_DIR, ".mp", "audio.wav")):
        normalized_text = re.sub(r"\s+", " ", str(text)).strip()
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
            retry_chunks = self._split_text_for_tts(normalized_text, max_chars=120)
            retry_rendered_chunks, retry_failed_chunks = self._render_chunks(retry_chunks)

            # Prefer retry output when it successfully renders more chunks.
            if retry_rendered_chunks and len(retry_rendered_chunks) >= len(rendered_chunks):
                rendered_chunks = retry_rendered_chunks
                failed_chunks = retry_failed_chunks
                chunks = retry_chunks

        if not rendered_chunks:
            raise RuntimeError("All TTS chunks failed to render")

        if failed_chunks:
            warning(f"TTS finished with partial chunk success ({len(chunks) - failed_chunks}/{len(chunks)} chunks rendered).")

        merged_audio = np.concatenate(rendered_chunks)
        sf.write(output_file, merged_audio, KITTEN_SAMPLE_RATE)
        return output_file
