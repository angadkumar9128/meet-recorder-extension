// Runs on meet.google.com: turns on captions and builds a speaker-labelled transcript
(() => {
  if (window.__meetRecInit) return;
  window.__meetRecInit = true;

  let entries = [];            // [{speaker, text, t}]
  let startedAt = 0;
  let readTimer = null, pushTimer = null, captionAttempts = 0;
  const blockMap = new WeakMap(); // caption DOM block -> entry

  const elapsed = () => Math.max(0, Math.round((Date.now() - startedAt) / 1000));

  function enableCaptions() {
    const btns = [...document.querySelectorAll('button[aria-label]')];
    if (btns.find((b) => /turn off captions/i.test(b.getAttribute('aria-label')))) return true;
    const on = btns.find((b) => /turn on captions/i.test(b.getAttribute('aria-label')));
    if (on) { on.click(); return true; }
    return false;
  }

  function getRegion() {
    return (
      document.querySelector('[role="region"][aria-label*="aption" i]') ||
      document.querySelector('[aria-label="Captions"]') ||
      document.querySelector('[aria-label*="aption" i][role="group"]') ||
      [...document.querySelectorAll('[aria-live]')].find((el) => el.querySelector('img'))
    );
  }

  // Material-icon ligature names (e.g. "arrow_downward") and UI labels leak into innerText
  const JUNK = /^([a-z]+(_[a-z]+)+|jump to bottom|caption settings|format_size|settings)$/i;
  const linesOf = (el) =>
    (el.innerText || '').split('\n').map((s) => s.trim()).filter((s) => s && !JUNK.test(s));

  // One "block" = one speaker's caption bubble (avatar + name + text)
  function findBlocks(region) {
    const blocks = new Set();
    region.querySelectorAll('img').forEach((img) => {
      let el = img.parentElement;
      while (el && el !== region) {
        if (el.querySelectorAll('img').length > 1) break;      // climbed too far
        if (linesOf(el).length >= 2) { blocks.add(el); break; }
        el = el.parentElement;
      }
    });
    if (!blocks.size) { // fallback: no avatars -> direct children that have name + text
      const container = region.firstElementChild || region;
      [...container.children].forEach((c) => { if (linesOf(c).length >= 2) blocks.add(c); });
    }
    return [...blocks];
  }

  // Merge growing / corrected / trimmed caption text into what we already have
  function merge(oldT, newT) {
    if (newT.startsWith(oldT)) return newT;
    if (oldT.includes(newT)) return oldT;
    for (let k = Math.min(oldT.length, newT.length); k >= 10; k--) {
      if (oldT.endsWith(newT.slice(0, k))) return oldT + newT.slice(k); // Meet trimmed the start
    }
    let i = 0;
    while (i < oldT.length && i < newT.length && oldT[i] === newT[i]) i++;
    if (i >= oldT.length * 0.6) return newT;                           // Meet corrected last words
    return oldT + ' ' + newT;
  }

  function readCaptions() {
    const region = getRegion();
    if (!region) {
      if (captionAttempts < 30) { captionAttempts++; enableCaptions(); } // try for ~1 min
      return;
    }
    for (const block of findBlocks(region)) {
      const lines = linesOf(block);
      const speaker = lines[0].replace(/\s*\(you\)\s*$/i, '').trim() || lines[0];
      const text = lines.slice(1).join(' ').trim();
      if (!speaker || !text) continue;

      let entry = blockMap.get(block);
      if (entry && entry.speaker === speaker) {
        entry.text = merge(entry.text, text);
        continue;
      }
      // New DOM block: maybe Meet re-rendered the same sentence -> reuse recent entry
      const recent = entries.slice(-3).reverse().find((e) => e.speaker === speaker);
      if (recent && (text.startsWith(recent.text) || recent.text.includes(text))) {
        recent.text = merge(recent.text, text);
        blockMap.set(block, recent);
        continue;
      }
      entry = { speaker, text, t: elapsed() };
      entries.push(entry);
      blockMap.set(block, entry);
    }
  }

  function push() {
    try { chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', entries }).catch(() => {}); } catch {}
  }

  function start(ts) {
    clearInterval(readTimer); clearInterval(pushTimer);
    entries = []; captionAttempts = 0; startedAt = ts || Date.now();
    enableCaptions();
    readTimer = setInterval(readCaptions, 500);
    pushTimer = setInterval(push, 5000);
  }

  function stop() {
    clearInterval(readTimer); clearInterval(pushTimer);
    readCaptions();
    return entries;
  }

  // Debug helper: sanitised structure of the captions area (text is shortened for privacy)
  function diagnose() {
    const region = getRegion();
    if (!region) return { found: false, html: '' };
    const clone = region.cloneNode(true);
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    const texts = []; while (walker.nextNode()) texts.push(walker.currentNode);
    texts.forEach((n) => { const t = n.nodeValue.trim(); n.nodeValue = t.length > 12 ? t.slice(0, 12) + '…' : t; });
    clone.querySelectorAll('*').forEach((el) => {
      [...el.attributes].forEach((a) => { if (!['class', 'role', 'aria-label', 'aria-live'].includes(a.name)) el.removeAttribute(a.name); });
      if (el.tagName === 'IMG') el.setAttribute('src', 'x');
    });
    return { found: true, html: clone.outerHTML.slice(0, 7000) };
  }

  chrome.runtime.onMessage.addListener((msg, _s, reply) => {
    if (msg.type === 'START_TRANSCRIPT') { start(msg.startedAt); reply({ ok: true }); }
    if (msg.type === 'STOP_TRANSCRIPT') { reply({ entries: stop() }); }
    if (msg.type === 'DIAGNOSE') { reply(diagnose()); }
  });
})();
