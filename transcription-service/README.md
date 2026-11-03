# Meet Notebook — local CPU transcription service

This optional service adds open-source, post-meeting transcription to the Chrome extension.

## Stack

- **WhisperX** for VAD-aware long-form transcription, word alignment and optional diarization.
- **faster-whisper / CTranslate2** is used by WhisperX for efficient inference.
- **Silero VAD** is WhisperX's default speech segmentation path.
- **pyannote.audio** speaker diarization is optional and requires a Hugging Face token and acceptance of the model terms.
- **FastAPI** exposes a loopback-only upload endpoint.

## Windows CPU setup

Requirements: Windows 10/11, Python 3.11, FFmpeg installed and available on PATH, and enough free disk space for model downloads and temporary recording files. 8 GB RAM may run the tiny/base models with limited headroom; 16 GB or more is recommended. CPU inference can be slow for long meetings.

1. Install Python 3.11 and FFmpeg.
2. Open PowerShell in this folder.
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\start.ps1
   ```

4. Wait for the model and dependencies to install. The service listens only on `127.0.0.1:8765`.
5. Open `http://127.0.0.1:8765/health` to verify it is ready.
6. Reload Meet Notebook from `chrome://extensions`, open **Past meetings**, and select **Transcribe locally** for a meeting with a saved recording.

The first transcription downloads the selected model. Set `WHISPER_MODEL=tiny` in `.env` for lower RAM/faster processing, `base` for a balanced CPU default, or `small` for better recognition at a much higher CPU/RAM cost. Restart the service after changing `.env`.

## Optional speaker diarization

1. Create a Hugging Face access token with read permission.
2. Visit the model page for `pyannote/speaker-diarization-community-1`, sign in and accept its access conditions.
3. Add `HF_TOKEN=...` to `.env`, then restart the service.

Without a token, transcription and word alignment still work; the speaker is shown as **Speaker (unassigned)**. With diarization, labels such as **SPEAKER_00** are generated from the mixed meeting audio. They are not guaranteed to match Meet participant names.

## Reliability design

- The extension continues persisting one-second media chunks to IndexedDB while recording.
- The finalized recording is uploaded to this service only after the user clicks **Transcribe locally**.
- WhisperX applies VAD and processes long audio without relying on a single browser SpeechRecognition session.
- The response contains timestamped segments and word-level timing where alignment is supported.
- The extension replaces only its previous WhisperX-generated transcript entries, leaving Meet captions and manual notes intact.

## Privacy and limitations

The service binds to loopback and stores uploads only in a temporary file that is removed after processing. There is no cloud upload or analytics. The browser extension sends audio only after an explicit user click. Keep the local service running only when needed and do not expose port 8765 to your LAN or internet.

This does not create separate audio channels per Meet participant. Chrome tab capture provides a mixed meeting audio stream; diarization estimates voice turns and may confuse speakers, particularly during interruptions, crosstalk, short turns or similar voices. It cannot reliably map diarized voice IDs to Google Meet display names. No ASR system can promise zero missed words. Check the transcript against the saved recording for critical meeting records.
