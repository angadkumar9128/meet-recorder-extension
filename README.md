# Meet Notebook

A local-first Chrome Manifest V3 extension for Google Meet recording and speaker-labelled caption notes.

## Install
1. Download/clone this repository.
2. Visit \`chrome://extensions\`, enable Developer mode, and click **Load unpacked**.
3. Select the repository folder.
4. Open a Google Meet tab and click the extension icon. Use **Alt+Shift+N** to open the side panel.
5. Configure your display name and grant microphone permission when Chrome prompts.
6. Tell every participant before recording and comply with your organization's recording rules and local law.

## Included foundation
- Right-side Chrome Side Panel UI with live transcript, meeting timer and start/pause/resume/stop controls.
- Meet captions observed through MutationObserver and reattached if Meet rebuilds its caption region.
- Word-level, case/punctuation-insensitive caption overlap stitching and speaker turn merging.
- Configurable replacement for the Meet speaker label "You".
- Local transcript snapshots in extension storage and 1-second recording chunks in IndexedDB.
- Tab audio and optional microphone mix through a 48 kHz Web Audio graph with compressor limiting.
- MP4 H.264/AAC selected when supported; otherwise VP8/Opus WebM.
- Download transcript as TXT, Markdown and JSON; past-session list and sanitized caption diagnostics.
- Quality targets: High 1080p/8 Mbps, Standard 720p/4 Mbps, Data saver 720p/2 Mbps.

## Verification and known limitations
Run \`node --check background.js\`, \`node --check content.js\`, \`node --check offscreen.js\`, \`node --check sidepanel.js\`, and \`node --test\`.

Chrome's tab-capture source may reject exact dimensions or fixed frame rate; the extension requests constraints but cannot guarantee a fixed output format on every device. MediaRecorder WebM chunks are stored incrementally, but this build does not add EBML duration/cue repair, so VLC seeking must be tested on real recordings. Final video assembly currently creates a Blob from stored chunks and can still reach browser memory limits for very long meetings. A full browser/Meet test is required to verify speaker attribution, 60-minute integrity and crash recovery.

ZIP export, full inline transcript editing/renaming/bookmarks/action-item workflow, local Whisper gap filling, Gemini note generation and perfect tab-crash finalization are not included in this foundation version. Data is not uploaded to a server; all data remains in the local browser profile.

## Tests
\`node --test\` exercises growing captions, punctuation-insensitive overlap, tail corrections, speaker merging and a 300-update monologue simulation.
