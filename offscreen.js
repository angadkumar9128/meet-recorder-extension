// Offscreen document: does the actual recording (MV3 service workers can't use MediaRecorder)

let recorder = null;
let chunks = [];
let audioCtx = null;
let openStreams = [];

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'START') {
    startRecording(msg.streamId)
      .then(sendResponse)
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type === 'STOP') {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    sendResponse({ ok: true });
  }
});

async function startRecording(streamId) {
  // Meet tab: video + everyone else's audio
  const tabStream = await navigator.mediaDevices.getUserMedia({
    audio: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } },
    video: { mandatory: { chromeMediaSource: 'tab', chromeMediaSourceId: streamId } }
  });
  openStreams = [tabStream];

  // Your own microphone (tab capture does NOT include your voice)
  let micStream = null, micOk = true;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    openStreams.push(micStream);
  } catch {
    micOk = false; // permission not granted yet -> only others' audio is recorded
  }

  audioCtx = new AudioContext();
  await audioCtx.resume();
  const dest = audioCtx.createMediaStreamDestination();
  const tabSource = audioCtx.createMediaStreamSource(tabStream);
  tabSource.connect(dest);
  tabSource.connect(audioCtx.destination); // keep the meeting audible for you
  if (micStream) audioCtx.createMediaStreamSource(micStream).connect(dest);

  const finalStream = new MediaStream([
    ...tabStream.getVideoTracks(),
    ...dest.stream.getAudioTracks()
  ]);

  const mimeType = MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
    ? 'video/webm;codecs=vp9,opus' : 'video/webm';

  chunks = [];
  recorder = new MediaRecorder(finalStream, { mimeType, videoBitsPerSecond: 2500000 });
  recorder.ondataavailable = (e) => { if (e.data.size) chunks.push(e.data); };
  recorder.onstop = finish;
  recorder.start(1000);

  // Tab closed / capture ended -> finish cleanly
  tabStream.getVideoTracks()[0]?.addEventListener('ended', () => {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
  });

  return { ok: true, micOk };
}

function finish() {
  const blob = new Blob(chunks, { type: 'video/webm' });
  chunks = [];
  const url = URL.createObjectURL(blob);
  openStreams.forEach((s) => s.getTracks().forEach((t) => t.stop()));
  openStreams = [];
  audioCtx?.close();
  recorder = null;
  chrome.runtime.sendMessage({ type: 'VIDEO_READY', url });
}
