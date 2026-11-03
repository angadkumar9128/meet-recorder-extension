# Meet Recorder + Speaker Transcript

1. chrome://extensions -> enable Developer mode -> Load unpacked -> select this folder.
2. Click the extension icon once -> "Grant access" (one-time mic permission).
3. Join a Google Meet, click the extension icon, enter your name, press Start.
4. When done press "Stop & download". Files go to Downloads/MeetRecordings/:
   - <date>_<meetcode>_video.webm
   - <date>_<meetcode>_transcript.txt   ("Name - text" per speaker)

Tips
- Transcript = Meet's own live captions (CC). The extension turns them on automatically.
- If speaker names/text don't appear, Google changed Meet's HTML: adjust findBlocks() in content.js.
- Set INCLUDE_TIMESTAMPS = false in background.js to remove [mm:ss] before each line.
- Convert WebM to MP4: ffmpeg -i video.webm video.mp4
- Tell participants you are recording.
