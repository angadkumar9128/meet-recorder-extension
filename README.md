# Meet Notebook

A portable, local-first Chrome Manifest V3 extension for Google Meet recording and speaker-labelled live caption notes.

## Install

1. Download or clone this repository.
2. Open `chrome://extensions` and enable Developer mode.
3. Click **Load unpacked** and select this folder.
4. Open Google Meet, enable captions in the correct language and start recording.
5. Tell every participant before recording and comply with local law and organizational rules.

**No Python, FFmpeg, API key, local server, model download or external account is required.** The extension uses Google Meet captions and stores recordings and notes in the browser.

## Transcription and speaker attribution

- Remote participants' speaker-labelled text comes from Google Meet captions.
- The observer processes visible caption cards, tracks rolling updates, handles speaker switches and deduplicates repeated DOM mutations.
- It reattaches when Meet rebuilds the caption interface.
- Transcript snapshots are saved periodically and after caption changes.
- Optional Chrome on-device dictation can separately capture the user's own microphone voice when supported. It is disabled by default, may require a Chrome language pack, and does not transcribe remote participants.

## Recording

- Tab audio plus optional microphone capture.
- 48 kHz Web Audio mixing, microphone gain controls, voice filtering/compression and a final limiter.
- MP4 H.264/AAC when supported, otherwise VP8/Opus WebM.
- One-second media chunks are written to IndexedDB while recording.
- Finalized video is retained locally for playback and seeking.

## Important limitations

This portable build does not run its own independent ASR or diarization model. It cannot correct words Google Meet fails to recognize or recover speech for which Meet produces no caption. Accuracy depends on Meet's language support, audio quality, microphone placement, network conditions and the caption service.

Speaker names come from Meet's caption interface. Overlapping speech, interruptions, similar voices and caption delays can still cause errors. Chrome tab capture does not provide separate participant audio tracks. Zero missed words cannot be guaranteed, including during long monologues.

For long meetings, keep the Meet tab open, keep captions enabled and prevent the computer from sleeping. Periodic local persistence reduces loss, but browser crashes, forced shutdowns, storage exhaustion or Meet caption outages can still interrupt capture.

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

Recording and transcript data remain in the local browser profile. No meeting audio or transcript is sent to an external service by this extension. Inform participants before recording.

### Live caption reliability improvements (1.4.2)

- Live caption snapshots are published on a steady short interval so continuous speech does not keep resetting a debounce timer.
- Caption updates are merged per caption card rather than merging every consecutive phrase from the same speaker.
- Recreated caption cards are checked for rolling-text overlap to reduce repeated partial sentences.
- Rolling corrections replace the changed tail instead of duplicating the earlier words.
- The extension still uses Google Meet captions as its speaker-labelled source; recognition accuracy is therefore bounded by Meet's caption engine and selected caption language.

### Cumulative caption snapshot fix (1.4.3)

- Detects long rolling caption snapshots even when Google Meet rebuilds its caption DOM card.
- Replaces revised caption tails instead of appending a near-complete repeated sentence.
- Keeps the active same-speaker rolling caption associated for up to 90 seconds while it continues updating.
