document.getElementById('b').onclick = async () => {
  const r = document.getElementById('r');
  try {
    const s = await navigator.mediaDevices.getUserMedia({ audio: true });
    s.getTracks().forEach((t) => t.stop());
    r.textContent = '✅ Done! You can close this tab.';
  } catch (e) {
    r.textContent = '❌ Blocked. Click the lock/mic icon in the address bar and allow the microphone.';
  }
};
