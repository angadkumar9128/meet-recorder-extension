(() => {
  if (window.__meetNotebookLoaded) return;
  window.__meetNotebookLoaded = true;

  const SELECTORS = {
    regions: [
      '[role="region"][aria-label*="caption" i]',
      '[aria-label="Captions"]',
      '[aria-label*="caption" i][role="group"]',
      '[aria-live]'
    ],
    buttons: [
      'button[aria-label*="turn on captions" i]',
      'button[aria-label*="turn off captions" i]'
    ],
    tiles: ['[data-participant-id]', '[data-self-name]', '[role="listitem"][aria-label]']
  };

  let entries = [];
  let observer = null;
  let observedRegion = null;
  let rootObserver = null;
  let persistTimer = null;
  let reattachTimer = null;
  let rosterTimer = null;
  let publishTimer = null;
  let sessionId = null;
  let elapsedBeforePause = 0;
  let activeSegmentStart = 0;
  let paused = false;
  let hideNativeCaptions = true;
  let nodeEntries = new WeakMap();
  let seenCaptionFingerprints = new Map();
  let publishQueue = Promise.resolve();
  const commitTimers = new Map();
  const originalCaptionStyles = new WeakMap();

  const elapsed = () => Math.max(0, Math.floor(
    (elapsedBeforePause + (activeSegmentStart ? performance.now() - activeSegmentStart : 0)) / 1000
  ));

  function region() {
    for (const selector of SELECTORS.regions) {
      const element = document.querySelector(selector);
      if (element && (
        (element.getAttribute('aria-label') || '').toLowerCase().includes('caption') ||
        element.querySelector('img,[role="img"]')
      )) return element;
    }
    return null;
  }

  function setCaptionVisibility(hide) {
    hideNativeCaptions = !!hide;
    const element = region();
    if (!element) return;
    if (!originalCaptionStyles.has(element)) {
      originalCaptionStyles.set(element, {
        opacity: element.style.getPropertyValue('opacity'),
        opacityPriority: element.style.getPropertyPriority('opacity'),
        pointerEvents: element.style.getPropertyValue('pointer-events'),
        pointerEventsPriority: element.style.getPropertyPriority('pointer-events')
      });
    }
    if (hide) {
      element.style.setProperty('opacity', '0', 'important');
      element.style.setProperty('pointer-events', 'none', 'important');
    } else {
      const old = originalCaptionStyles.get(element);
      old.opacity ? element.style.setProperty('opacity', old.opacity, old.opacityPriority) : element.style.removeProperty('opacity');
      old.pointerEvents ? element.style.setProperty('pointer-events', old.pointerEvents, old.pointerEventsPriority) : element.style.removeProperty('pointer-events');
    }
  }

  function enableCaptions() {
    const buttons = SELECTORS.buttons.flatMap(selector => [...document.querySelectorAll(selector)]);
    if (buttons.some(button => /turn off captions/i.test(button.getAttribute('aria-label') || ''))) return true;
    const button = buttons.find(item => /turn on captions/i.test(item.getAttribute('aria-label') || ''));
    if (button) { button.click(); return true; }
    return false;
  }

  const junk = /^(jump to bottom|caption settings|format size|settings|arrow_downward|more options|mic|volume up)$/i;
  function lines(element) {
    return (element.innerText || '').split('\n').map(value => value.trim())
      .filter(value => value && !junk.test(value) && !/^[a-z]+(_[a-z]+)+$/i.test(value));
  }

  function blocks(captionRegion) {
    const output = new Set();
    captionRegion.querySelectorAll('img,[role="img"]').forEach(image => {
      let element = image.parentElement;
      while (element && element !== captionRegion) {
        if (element.querySelectorAll('img,[role="img"]').length > 1) break;
        if (lines(element).length >= 2) { output.add(element); break; }
        element = element.parentElement;
      }
    });
    if (!output.size) {
      const root = captionRegion.firstElementChild || captionRegion;
      [...root.children].forEach(element => { if (lines(element).length >= 2) output.add(element); });
    }
    return [...output];
  }

  function fingerprint(speaker, text) {
    return speaker.toLocaleLowerCase() + '|' +
      text.toLocaleLowerCase().normalize('NFKC').replace(/\s+/g, ' ').trim();
  }

  function scheduleCommit(entry) {
    const old = commitTimers.get(entry);
    if (old) clearTimeout(old);
    entry.committed = false;
    commitTimers.set(entry, setTimeout(() => {
      entry.committed = true;
      commitTimers.delete(entry);
      publish();
    }, 850));
  }

  function publish() {
    if (!sessionId || publishTimer) return;
    // A fixed-rate trailing publish prevents a continuous speaker from continually
    // resetting a debounce timer and starving the live side panel of updates.
    publishTimer = setTimeout(() => {
      publishTimer = null;
      if (!sessionId) return;
      const snapshot = entries.map(entry => ({ ...entry }));
      const id = sessionId;
      publishQueue = publishQueue
        .then(() => chrome.runtime.sendMessage({ type: 'TRANSCRIPT_UPDATE', sessionId: id, entries: snapshot }))
        .catch(() => {});
    }, 120);
  }

  function scan() {
    if (paused) return;
    const captionRegion = region();
    if (!captionRegion) return;

    // A DOM caption card represents one utterance. Only updates to that same card
    // are merged; separate cards from the same speaker remain separate turns.
    for (const block of blocks(captionRegion)) {
      const values = lines(block);
      if (values.length < 2) continue;
      const speaker = values[0].replace(/\s*\(you\)\s*$/i, '').trim();
      const text = values.slice(1).join(' ').replace(/\s+/g, ' ').trim();
      if (!speaker || !text || speaker.length > 80 || text.length > 2000) continue;

      const key = fingerprint(speaker, text);
      const previousForNode = nodeEntries.get(block);
      if (previousForNode && previousForNode.fingerprint === key) continue;

      const now = Date.now();
      if (previousForNode?.entry && previousForNode.speaker.toLowerCase() === speaker.toLowerCase()) {
        const merged = MeetNotebookTranscript.mergeRollingText(previousForNode.entry.text, text);
        previousForNode.entry.text = merged;
        previousForNode.entry.updatedAt = now;
        previousForNode.fingerprint = key;
        nodeEntries.set(block, previousForNode);
        seenCaptionFingerprints.set(key, now);
        scheduleCommit(previousForNode.entry);
        publish();
        continue;
      }

      const seenAt = seenCaptionFingerprints.get(key);
      if (seenAt && now - seenAt < 2500) {
        nodeEntries.set(block, { speaker, fingerprint: key, entry: null });
        continue;
      }

      const recentEntry = entries[entries.length - 1];
      if (recentEntry &&
          recentEntry.speaker.toLowerCase() === speaker.toLowerCase() &&
          now - (recentEntry.updatedAt || now) < 90000 &&
          MeetNotebookTranscript.isRollingUpdate(recentEntry.text, text)) {
        recentEntry.text = MeetNotebookTranscript.mergeRollingText(recentEntry.text, text);
        recentEntry.updatedAt = now;
        nodeEntries.set(block, { speaker, fingerprint: key, entry: recentEntry });
        seenCaptionFingerprints.set(key, now);
        scheduleCommit(recentEntry);
        publish();
        continue;
      }

      const entry = { speaker, text, t: elapsed(), updatedAt: now, committed: false, source: 'meet' };
      entries.push(entry);
      nodeEntries.set(block, { speaker, fingerprint: key, entry });
      seenCaptionFingerprints.set(key, now);

      // Keep the deduplication cache bounded and remove stale captions.
      for (const [fingerprintKey, timestamp] of seenCaptionFingerprints) {
        if (now - timestamp > 15000) seenCaptionFingerprints.delete(fingerprintKey);
        else if (seenCaptionFingerprints.size > 2000) seenCaptionFingerprints.delete(fingerprintKey);
        if (seenCaptionFingerprints.size <= 2000 && now - timestamp <= 15000) break;
      }
      scheduleCommit(entry);
      publish();
    }
  }

  function attach() {
    const captionRegion = region();
    if (!captionRegion) return false;
    if (hideNativeCaptions) setCaptionVisibility(true);
    if (observer && observedRegion === captionRegion) return true;
    observer?.disconnect();
    observedRegion = captionRegion;
    observer = new MutationObserver(scan);
    observer.observe(captionRegion, { childList: true, characterData: true, subtree: true });
    scan();
    return true;
  }

  function participants() {
    const output = new Set();
    SELECTORS.tiles.forEach(selector => document.querySelectorAll(selector).forEach(element => {
      const name = (element.getAttribute('aria-label') || element.getAttribute('data-self-name') || element.innerText || '')
        .split(/[\n,]/)[0].trim();
      if (name && name.length < 80) output.add(name);
    }));
    return [...output];
  }

  function cleanup() {
    observer?.disconnect();
    rootObserver?.disconnect();
    clearInterval(persistTimer);
    clearInterval(reattachTimer);
    clearInterval(rosterTimer);
    clearTimeout(publishTimer);
    for (const timer of commitTimers.values()) clearTimeout(timer);
    commitTimers.clear();
    publishTimer = null;
    observer = null;
    observedRegion = null;
    rootObserver = null;
  }

  function start(message) {
    cleanup();
    entries = [];
    nodeEntries = new WeakMap();
    seenCaptionFingerprints.clear();
    publishQueue = Promise.resolve();
    elapsedBeforePause = 0;
    activeSegmentStart = performance.now();
    sessionId = message.sessionId;
    paused = false;
    hideNativeCaptions = message.hideNativeCaptions !== false;
    enableCaptions();
    attach();
    rootObserver = new MutationObserver(() => {
      if (region()) attach();
      else { observer?.disconnect(); observer = null; observedRegion = null; }
    });
    rootObserver.observe(document.documentElement, { childList: true, subtree: true });
    reattachTimer = setInterval(() => { enableCaptions(); attach(); }, 1800);
    persistTimer = setInterval(publish, 1000);
    rosterTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'ROSTER_UPDATE', sessionId, participants: participants() }).catch(() => {});
    }, 10000);
  }

  function pause() {
    if (paused) return;
    elapsedBeforePause += activeSegmentStart ? performance.now() - activeSegmentStart : 0;
    activeSegmentStart = 0;
    paused = true;
    publish();
  }

  function resume() {
    if (!paused) return;
    paused = false;
    activeSegmentStart = performance.now();
    scan();
  }

  function stop() {
    if (!paused) {
      elapsedBeforePause += activeSegmentStart ? performance.now() - activeSegmentStart : 0;
      activeSegmentStart = 0;
      paused = true;
    }
    for (const timer of commitTimers.values()) clearTimeout(timer);
    commitTimers.clear();
    entries.forEach(entry => { entry.committed = true; });
    setCaptionVisibility(false);
    cleanup();
    return entries;
  }

  function diagnose() {
    const captionRegion = region();
    if (!captionRegion) return { found: false, html: '' };
    const clone = captionRegion.cloneNode(true);
    clone.querySelectorAll('*').forEach(element => {
      [...element.attributes].forEach(attribute => {
        if (!['class', 'role', 'aria-label', 'aria-live'].includes(attribute.name)) element.removeAttribute(attribute.name);
      });
      if (element.tagName === 'IMG') element.setAttribute('src', 'redacted');
    });
    const walker = document.createTreeWalker(clone, NodeFilter.SHOW_TEXT);
    while (walker.nextNode()) walker.currentNode.nodeValue = '[redacted]';
    return { found: true, html: clone.outerHTML.slice(0, 6000) };
  }

  chrome.runtime.onMessage.addListener((message, _sender, reply) => {
    if (message.type === 'SET_CAPTION_VISIBILITY') { setCaptionVisibility(message.hidden); reply({ ok: true }); }
    else if (message.type === 'START_TRANSCRIPT') { start(message); reply({ ok: true }); }
    else if (message.type === 'STOP_TRANSCRIPT') reply({ entries: stop() });
    else if (message.type === 'PAUSE_TRANSCRIPT') { pause(); reply({ ok: true }); }
    else if (message.type === 'RESUME_TRANSCRIPT') { resume(); reply({ ok: true }); }
    else if (message.type === 'DIAGNOSE') reply(diagnose());
  });
})();