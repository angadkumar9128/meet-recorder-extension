# Meet Notebook

A local-first Chrome Manifest V3 extension for Google Meet recording and speaker-labelled caption notes.

## Install
1. Download or clone this repository.
2. Visit `chrome://extensions`, enable Developer mode, and click **Load unpacked**.
3. Select the repository folder.
4. Open a Google Meet tab and click the extension icon. Use **Alt+Shift+N** to open the side panel.
5. Open **Settings → Test microphone / grant access** once, choose the microphone you actually use, and speak at a normal volume to verify the level meter.
6. Tell every participant before recording and comply with your organization's recording rules and local law.

## Current functionality
- Chrome Side Panel on the right with live transcript, pause-aware timer, start/pause/resume/stop controls and past meetings. The Meet caption overlay can be hidden while its text continues to feed the Side Panel.
- Meet captions observed through MutationObserver, with reattachment when Meet rebuilds the caption region and faster caption update handling.
- Word-overlap stitching, speaker turn merging and transcript timestamps that exclude paused time.
- Local tab-audio capture plus optional microphone capture, device selection, live input meters, adjustable mic sensitivity, automatic gain and voice filtering/compression.
- Optional Chrome on-device dictation for the user's own voice (language-pack availability varies); results are labelled separately from Meet's speaker-attributed captions.
- 48 kHz Web Audio mixing with a final dynamics limiter.
- MP4 H.264/AAC when supported, otherwise VP8/Opus WebM.
- WebM duration metadata and cue-point generation on finalization to improve the native seek timeline.
- Saved video blob in IndexedDB for in-extension playback and seeking; local video data is removed when its past-meeting record is deleted.
- Transcript export as TXT, Markdown and JSON, copy, searchable live transcript, persistent manual notes, past-meeting playback and sanitized caption diagnostics.
- Explicit Light, Dark and System themes.

## Important speech-recognition limitation
The extension records and enhances the microphone audio that is included in the saved video. Google Meet generates its speaker-attributed captions using its own microphone and speech-recognition service. The extension cannot inject its processed audio into Meet's internal caption engine. An optional Chrome on-device dictation path separately transcribes the user's own voice and labels it “You (on-device)”. It feeds the selected microphone through a local high-pass/compressor/automatic-gain audio graph into the recognizer; it requires a supported Chrome build and a locally installed language pack. Chrome's on-device speech-recognition APIs are still marked experimental and language availability varies. For best results, choose the correct microphone and spoken language in Meet settings, use a close microphone, avoid clipping, and enable Meet captions in the correct language. Very fast speech, overlapping speakers, low-quality microphones and background noise can still cause recognition errors.

Mic sensitivity, automatic gain and voice enhancement apply to the saved microphone track. The on-device recognizer uses the microphone selected in the extension's microphone setup page; if no device is selected, it falls back to the browser's default microphone. Excessive gain can also raise room noise, so use the setup meter and select the lowest gain that captures normal speech clearly.

## Verification and known limitations
Run `node --check background.js`, `node --check content.js`, `node --check offscreen.js`, `node --check sidepanel.js`, `node --check setup.js`, and `node --test`.

Chrome's tab-capture source may reject exact dimensions or frame rate; requested quality is best-effort. WebM duration and cue repair is performed during finalization, but actual seeking must still be checked on real long recordings and across VLC, Chrome and other players. The extension retains a local finalized video blob for in-extension playback; this uses local browser storage and can consume substantial space for long meetings. Delete a past meeting to remove its local video data.

No real Google Meet browser session, long-duration recording, multi-device microphone test or VLC/WMP compatibility test has been performed as part of this code update. Verify these in Chrome after reloading the unpacked extension.

## Privacy
Recordings, transcripts and microphone data remain in the local browser profile. The extension does not upload them to a server. Participants should be informed before recording.
