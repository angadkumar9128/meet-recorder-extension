"""Local-only WhisperX transcription API for Meet Notebook.

The API binds to loopback by default. Meeting media is processed on this machine
and is never forwarded to a third-party service by this application.
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import FastAPI, File, Form, HTTPException, UploadFile, Request
from dotenv import load_dotenv

load_dotenv(Path(__file__).with_name('.env'))
from fastapi.middleware.cors import CORSMiddleware

APP_HOST = os.getenv("MEETNOTEBOOK_HOST", "127.0.0.1")
MAX_UPLOAD_BYTES = int(os.getenv("MEETNOTEBOOK_MAX_UPLOAD_MB", "2048")) * 1024 * 1024
MODEL_NAME = os.getenv("WHISPER_MODEL", "base")
HF_TOKEN = os.getenv("HF_TOKEN", "").strip()

app = FastAPI(title="Meet Notebook Local Transcription", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"^(chrome-extension://[a-p]{32}|http://127\\.0\\.0\\.1(:[0-9]+)?|http://localhost(:[0-9]+)?)$",
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


@app.middleware("http")
async def restrict_browser_origins(request: Request, call_next):
    origin = request.headers.get("origin", "")
    if origin and not (
        origin.startswith("chrome-extension://")
        or origin.startswith("http://127.0.0.1")
        or origin.startswith("http://localhost")
    ):
        return __import__("fastapi").responses.JSONResponse(
            status_code=403, content={"detail": "Only the Meet Notebook extension or loopback clients are allowed."}
        )
    return await call_next(request)


@app.get("/health")
def health() -> dict[str, Any]:
    return {
        "ok": True,
        "service": "meet-notebook-local-asr",
        "model": MODEL_NAME,
        "device": "cpu",
        "diarization_available": bool(HF_TOKEN),
    }


def transcribe_file(path: str, language: str | None) -> dict[str, Any]:
    try:
        import torch
        import whisperx
    except ImportError as exc:
        raise RuntimeError(
            "WhisperX dependencies are missing. Run the setup script in transcription-service."
        ) from exc

    # CPU + int8 reduces RAM pressure. A small batch avoids memory spikes on
    # ordinary laptops; WhisperX handles VAD/chunking inside the transcription pipeline.
    device = "cpu"
    compute_type = "int8"
    model = whisperx.load_model(
        MODEL_NAME,
        device,
        compute_type=compute_type,
        language=language or None,
        vad_method="silero",
    )
    audio = whisperx.load_audio(path)
    result = model.transcribe(audio, batch_size=2, language=language or None)
    detected_language = result.get("language") or language or "unknown"
    del model
    if torch.cuda.is_available():
        torch.cuda.empty_cache()

    # Align words to the audio timeline when a supported alignment model exists.
    try:
        align_model, metadata = whisperx.load_align_model(
            language_code=detected_language, device=device
        )
        result = whisperx.align(
            result["segments"], align_model, metadata, audio, device,
            return_char_alignments=False,
        )
        del align_model
    except Exception as exc:
        # Transcription remains useful if word alignment is unavailable for a language.
        result["alignment_warning"] = str(exc)[:300]

    diarization_status = "disabled"
    if HF_TOKEN:
        try:
            diarize_model = whisperx.DiarizationPipeline(
                model_name="pyannote/speaker-diarization-community-1",
                use_auth_token=HF_TOKEN,
                device=device,
            )
            diarized = diarize_model(audio)
            result = whisperx.assign_word_speakers(diarized, result)
            diarization_status = "completed"
        except Exception as exc:
            diarization_status = "failed: " + str(exc)[:300]

    segments = []
    for index, segment in enumerate(result.get("segments", [])):
        text = str(segment.get("text", "")).strip()
        if not text:
            continue
        speaker = segment.get("speaker") or "Speaker (unassigned)"
        segments.append({
            "id": index,
            "start": max(0.0, float(segment.get("start", 0.0))),
            "end": max(0.0, float(segment.get("end", segment.get("start", 0.0)))),
            "speaker": str(speaker),
            "text": text,
            "words": [
                {
                    "word": str(word.get("word", "")),
                    "start": word.get("start"),
                    "end": word.get("end"),
                    "score": word.get("score"),
                }
                for word in segment.get("words", [])
                if word.get("word")
            ],
        })
    return {
        "ok": True,
        "language": detected_language,
        "model": MODEL_NAME,
        "device": device,
        "diarization": diarization_status,
        "alignment_warning": result.get("alignment_warning"),
        "segments": segments,
    }


@app.post("/transcribe")
async def transcribe(
    file: UploadFile = File(...),
    language: str = Form(""),
) -> dict[str, Any]:
    if not file.filename:
        raise HTTPException(status_code=400, detail="A recording file is required.")
    suffix = Path(file.filename).suffix.lower()
    if suffix not in {".webm", ".mp4", ".m4v", ".mkv", ".wav", ".mp3", ".m4a", ".ogg"}:
        suffix = ".media"
    tmp_path = None
    total = 0
    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
            tmp_path = tmp.name
            while True:
                chunk = await file.read(1024 * 1024)
                if not chunk:
                    break
                total += len(chunk)
                if total > MAX_UPLOAD_BYTES:
                    raise HTTPException(
                        status_code=413,
                        detail=f"Recording exceeds {MAX_UPLOAD_BYTES // (1024 * 1024)} MB limit.",
                    )
                tmp.write(chunk)
        if total == 0:
            raise HTTPException(status_code=400, detail="The recording file is empty.")
        try:
            return transcribe_file(tmp_path, language.strip() or None)
        except RuntimeError as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        except Exception as exc:
            raise HTTPException(status_code=500, detail=f"Transcription failed: {exc}") from exc
    finally:
        await file.close()
        if tmp_path and os.path.exists(tmp_path):
            os.unlink(tmp_path)


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=APP_HOST, port=int(os.getenv("MEETNOTEBOOK_PORT", "8765")))
