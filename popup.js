const $ = (id) => document.getElementById(id);
let timer = null;

const fmt = (ms) => {
  const s = Math.floor(ms / 1000);
  const p = (n) => String(n).padStart(2, '0');
  return `${p(Math.floor(s / 3600))}:${p(Math.floor((s % 3600) / 60))}:${p(s % 60)}`;
};

function render(state) {
  clearInterval(timer);
  if (state.recording) {
    const tick = () => { $('status').textContent = `● Recording ${fmt(Date.now() - state.startedAt)}`; };
    tick(); timer = setInterval(tick, 1000);
    $('status').className = 'rec';
  } else {
    $('status').textContent = 'Idle';
    $('status').className = '';
  }
  $('start').disabled = !!state.recording;
  $('stop').disabled = !state.recording;
  $('name').disabled = !!state.recording;
}

async function init() {
  const { myName } = await chrome.storage.local.get('myName');
  if (myName) $('name').value = myName;
  render(await chrome.runtime.sendMessage({ type: 'GET_STATE' }));

  try {
    const p = await navigator.permissions.query({ name: 'microphone' });
    if (p.state !== 'granted') $('mic').style.display = 'block';
  } catch {}
}

$('micLink').onclick = () => chrome.tabs.create({ url: chrome.runtime.getURL('setup.html') });

$('start').onclick = async () => {
  $('msg').textContent = '';
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.url?.startsWith('https://meet.google.com/')) {
    $('msg').textContent = 'Open a Google Meet tab first.';
    return;
  }
  const myName = $('name').value.trim() || 'You';
  await chrome.storage.local.set({ myName });
  try {
    // Must be called here (user gesture from the popup)
    const streamId = await chrome.tabCapture.getMediaStreamId({ targetTabId: tab.id });
    const res = await chrome.runtime.sendMessage({ type: 'START', tabId: tab.id, streamId, myName });
    if (!res?.ok) throw new Error(res?.error || 'Failed to start');
    let note = 'Recording started.';
    if (!res.micOk) note += ' Mic not allowed - only others will be heard.';
    if (!res.transcriptOk) note += ' Reload the Meet tab for transcript.';
    $('msg').textContent = note;
    render(await chrome.runtime.sendMessage({ type: 'GET_STATE' }));
  } catch (e) {
    $('msg').textContent = e.message;
  }
};

$('stop').onclick = async () => {
  $('stop').disabled = true;
  $('msg').textContent = 'Saving files to Downloads/MeetRecordings ...';
  await chrome.runtime.sendMessage({ type: 'STOP' });
  render(await chrome.runtime.sendMessage({ type: 'GET_STATE' }));
};

$('diag').onclick = async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    const r = await chrome.tabs.sendMessage(tab.id, { type: 'DIAGNOSE' });
    if (!r?.found) { $('msg').textContent = 'Captions box not found. Turn on captions (CC) in Meet first.'; return; }
    await navigator.clipboard.writeText(r.html);
    $('msg').textContent = 'Copied! Paste it in the chat.';
  } catch { $('msg').textContent = 'Reload the Meet tab and try again.'; }
};

init();
