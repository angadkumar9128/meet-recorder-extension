# Meet Notebook

A local-first Chrome Manifest V3 extension for recording Google Meet and producing a more complete meeting transcript.

## Install

1. Download or clone this repository.
2. Use **Chrome 139 or newer**.
3. Open `chrome://extensions` and enable Developer mode.
4. Click **Load unpacked** and select this folder.
5. Open Google Meet, select the spoken language in Meet captions and Meet Notebook, then start recording.
6. On the first use, open Meet Notebook **Settings** and click **Install / check local speech model**. Chrome downloads the selected language pack once. Wait until installation completes before starting a meeting.
7. Tell every participant before recording and comply with local law and organizational rules.

No Python, FFmpeg, API key, local server, external account or cloud transcription service is required. The one-time Chrome language-model download is required for independent local audio transcription. If you disable this feature, the extension falls back to Google Meet captions only.

## Two-source transcription

Meet Notebook now uses two complementary sources:

1. **Google Meet captions** — captures Meet's speaker-labelled captions and keeps participant names attached to those caption segments.
2. **Independent on-device audio transcription** — Chrome's local Speech Recognition engine listens to the mixed meeting audio track captured by the extension. This is a second recognition pass intended to recover words that Meet captions omit or misrecognize.

The audio backup is labelled **Meeting audio (all speakers)**. Because Chrome receives one mixed audio track, it cannot reliably identify which participant spoke each word. It is intentionally kept separate from Meet's speaker-attributed captions rather than inventing speaker identities.

The local recognizer runs with `processLocally = true`. The selected language pack is downloaded once through Chrome's on-device speech recognition API and reused for later meetings. Language availability depends on the Chrome build and platform. If Chrome reports that a language is unavailable, choose another supported language in Settings.

## Accuracy and limitations

This dual-source design should capture more spoken content than Meet captions alone, but it cannot guarantee a complete or word-perfect transcript. Recognition quality still depends on language/model availability, microphone and speaker volume, echo, background noise, overlapping speech and audio quality.

- Keep the Meet tab open and ensure the tab audio meter shows activity.
- Keep the correct language selected in both Meet captions and Meet Notebook.
- Use a clear microphone and avoid playing meeting audio through loudspeakers near an open microphone.
- The independent audio transcript covers the mixed meeting audio, including remote participants and the local participant when their voice is present in the captured mix.
- Meet captions remain the source for speaker names. The local audio backup does not have reliable per-person diarization.
- When the local model is unavailable or local transcription is disabled, Meet captions continue as the fallback.
- Overlapping speakers, interruptions, uncommon names, technical terms and language switching can still produce errors. Since the two recognizers are independent, the same phrase may occasionally appear in both sources; the source labels make this visible rather than silently deleting potentially useful words. Zero missed words cannot be guaranteed.

## Recording

- Captures Google Meet tab audio and optional microphone audio.
- 48 kHz Web Audio mixing, microphone gain controls, voice filtering/compression and a final limiter.
- MP4 H.264/AAC when supported, otherwise VP8/Opus WebM.
- One-second media chunks are written to IndexedDB while recording.
- Finalized video is retained locally for playback and seeking.
- Pausing the recording also pauses the local audio recognizer; it resumes with the recording.

## Verification

```bash
node --check background.js
node --check content.js
node --check offscreen.js
node --check sidepanel.js
node --check setup.js
node --test
```

## Privacy

The independent speech recognizer is explicitly configured for on-device processing. The extension does not send meeting audio or transcripts to an external transcription API or server. Google Meet captions are still supplied by Google Meet itself. Recordings and transcripts are stored in the local browser profile. Inform participants before recording.

## Release notes

### 1.5.2 — Installer activation and ASR snapshot fixes

- Calls Chrome's idempotent `SpeechRecognition.install({ langs: [language] })` directly from the Settings button click, then verifies the installed model with `available()`.
- Displays progress, success and failure in a dedicated visible Settings status area.
- Lists Chrome's documented on-device language choices; actual availability is still checked on the current device.
- Merges near-identical rolling local-ASR snapshots in a 12-second window to suppress repeated phrase variants while preserving later repetitions.

### 1.5.1 — Speech model installer and repeated-result fixes

- Shows installation progress and errors inside the visible Settings panel.
- Uses the documented language-only argument for `SpeechRecognition.install()`, then verifies installation with `available()`.
- Automatically enables local audio transcription after successful installation.
- Removes a stale stop-handler call that could prevent the recording from stopping.
- Prevents overlapping recognizer instances and makes restarts wait for the previous recognition session to end.
- Merges cumulative and near-identical local audio snapshots within a short 12-second window while preserving Meet captions, notes and later genuine repetitions.
- Adds regression tests for the repeated phrase pattern reported by the user.

### 1.5.0 — Independent local audio transcription

- Added a second transcription source using Chrome's on-device Speech Recognition API.
- Feeds the mixed meeting audio track to local recognition, rather than only listening to the user's microphone.
- Keeps Meet's speaker-labelled captions and local audio-backup text as separate sources.
- Adds a one-time language-pack installation step in Settings.
- Adds a language selector for the local audio recognizer.
- Requires Chrome 139 or newer for local processing and audio-track recognition.
- No API key, local server, Python, FFmpeg or external transcription service is required.

### 1.4.3 — Cumulative caption snapshot fix

- Detects long rolling caption snapshots even when Google Meet rebuilds its caption DOM card.
- Replaces revised caption tails instead of appending a near-complete repeated sentence.
- Keeps the active same-speaker rolling caption associated for up to 90 seconds while it continues updating.

### 1.4.2 — Live caption reliability improvements

- Publishes live caption snapshots on a steady short interval.
- Merges updates per caption card and deduplicates repeated DOM mutations.
- Replaces corrected rolling tails instead of duplicating earlier words.
