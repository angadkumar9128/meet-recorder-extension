// Service worker: coordinates recording (offscreen doc) + transcript (content script)

const INCLUDE_TIMESTAMPS = false; // true -> adds [mm:ss] before each speaker turn

const getState = async () => (await chrome.storage.session.get('state')).state || { recording: false };
const setState = (state) => chrome.storage.session.set({ state });
const pad = (n) => String(n).padStart(2, '0');

function stamp(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}`;
}
function meetingCode(url) {
  try { return new URL(url).pathname.replace(/\//g, '') || 'meet'; } catch { return 'meet'; }
}
function fmtTime(sec) {
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

async function ensureOffscreen() {
  const ctxs = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (ctxs.length) return;
  await chrome.offscreen.createDocument({
    url: 'offscreen.html',
    reasons: ['USER_MEDIA'],
    justification: 'Record the Google Meet tab and microphone'
  });
}

async function sendToTabWithInject(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    // Tab was opened before the extension was loaded -> inject the script now
    await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    return await chrome.tabs.sendMessage(tabId, msg);
  }
}

async function startRecording({ tabId, streamId, myName }) {
  const st = await getState();
  if (st.recording) throw new Error('Already recording');

  const tab = await chrome.tabs.get(tabId);
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', type: 'START', streamId });
  if (!r?.ok) throw new Error(r?.error || 'Could not start recording');

  const startedAt = Date.now();
  await chrome.storage.local.set({ transcript: [] });

  let transcriptOk = true;
  try {
    await sendToTabWithInject(tabId, { type: 'START_TRANSCRIPT', startedAt });
  } catch { transcriptOk = false; }

  await setState({
    recording: true, tabId, startedAt, myName: myName || 'You',
    code: meetingCode(tab.url), stamp: stamp(startedAt)
  });
  chrome.action.setBadgeBackgroundColor({ color: '#d93025' });
  chrome.action.setBadgeText({ text: 'REC' });
  return { ok: true, micOk: r.micOk, transcriptOk };
}

function cleanSentence(t) {
  t = t.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  t = t.charAt(0).toUpperCase() + t.slice(1);
  if (!/[.?!।…]$/.test(t)) t += '.';
  return t;
}

// Group consecutive lines of the same speaker into ONE turn (notebook style)
function buildTurns(entries, me) {
  const turns = [];
  for (const e of entries) {
    let name = (e.speaker || '').trim();
    if (/^you$/i.test(name)) name = me;
    const text = (e.text || '').trim();
    if (!name || !text) continue;
    const last = turns[turns.length - 1];
    if (last && last.name.toLowerCase() === name.toLowerCase()) {
      const prev = last.parts[last.parts.length - 1];
      if (text.startsWith(prev)) last.parts[last.parts.length - 1] = text; // same sentence, grown
      else if (!prev.includes(text)) last.parts.push(text);
    } else {
      turns.push({ name, parts: [text], t: e.t });
    }
  }
  return turns;
}

function buildTranscriptText(entries, st) {
  const me = st.myName || 'You';
  const header = `Meeting: ${st.code}\nDate: ${new Date(st.startedAt).toLocaleString()}\n\n`;
  const turns = buildTurns(entries, me);
  if (!turns.length) {
    return header + '(No captions were captured. Make sure captions (CC) were on in Meet.)\n';
  }
  const speakers = [...new Set(turns.map((t) => t.name))];
  const top = `Participants: ${speakers.join(', ')}\n${'-'.repeat(40)}\n\n`;
  const body = turns.map((t) => {
    const ts = INCLUDE_TIMESTAMPS ? `[${fmtTime(t.t)}] ` : '';
    return `${ts}${t.name} - ${t.parts.map(cleanSentence).join(' ')}`;
  }).join('\n\n');
  return header + top + body + '\n';
}

async function stopRecording() {
  const st = await getState();
  if (!st.recording) return { ok: true };
  await setState({ ...st, recording: false });
  chrome.action.setBadgeText({ text: '' });

  // 1) transcript
  let entries = [];
  try {
    const r = await chrome.tabs.sendMessage(st.tabId, { type: 'STOP_TRANSCRIPT' });
    entries = r?.entries || [];
  } catch { /* tab closed or script gone */ }
  if (!entries.length) {
    entries = (await chrome.storage.local.get('transcript')).transcript || [];
  }
  const text = buildTranscriptText(entries, st);
  await chrome.downloads.download({
    url: 'data:text/plain;charset=utf-8,' + encodeURIComponent(text),
    filename: `MeetRecordings/${st.stamp}_${st.code}_transcript.txt`
  });

  // 2) video (offscreen finalises it, then sends VIDEO_READY)
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'STOP' }).catch(() => {});
  return { ok: true };
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return; // not for us

  (async () => {
    try {
      switch (msg.type) {
        case 'START':
          sendResponse(await startRecording(msg)); break;
        case 'STOP':
          sendResponse(await stopRecording()); break;
        case 'GET_STATE':
          sendResponse(await getState()); break;
        case 'TRANSCRIPT_UPDATE':
          await chrome.storage.local.set({ transcript: msg.entries });
          sendResponse({ ok: true }); break;
        case 'VIDEO_READY': {
          let st = await getState();
          if (st.recording) { await stopRecording(); st = await getState(); } // recorder ended by itself
          const id = await chrome.downloads.download({
            url: msg.url,
            filename: `MeetRecordings/${st.stamp || 'meeting'}_${st.code || 'meet'}_video.webm`
          });
          await chrome.storage.session.set({ pendingDownloadId: id });
          sendResponse({ ok: true }); break;
        }
        default:
          sendResponse({ ok: false });
      }
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
  })();
  return true; // async response
});

// Close the offscreen document once the video file is saved
chrome.downloads.onChanged.addListener(async (delta) => {
  const { pendingDownloadId } = await chrome.storage.session.get('pendingDownloadId');
  if (delta.id !== pendingDownloadId || !delta.state) return;
  if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
    await chrome.storage.session.remove('pendingDownloadId');
    chrome.offscreen.closeDocument().catch(() => {});
  }
});

// If the Meet tab is closed while recording, save everything
chrome.tabs.onRemoved.addListener(async (tabId) => {
  const st = await getState();
  if (st.recording && st.tabId === tabId) stopRecording();
});
