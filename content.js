(() => {
  const INSTANCE_TOKEN='meet-notebook-content-v1.7.6';
  if(window.__meetNotebookLoaded===INSTANCE_TOKEN)return;
  window.__meetNotebookLoaded=INSTANCE_TOKEN;
  try{if(typeof chrome==='undefined'||!chrome.runtime||!chrome.runtime.id)return;}catch(_){return;}
  const SELECTORS={
    regions:['[role="region"][aria-label*="caption" i]','[aria-label="Captions"]','[aria-label*="caption" i][role="group"]','[aria-live]'],
    buttons:['button[aria-label*="turn on captions" i]','button[aria-label*="turn off captions" i]'],
    tiles:['[data-participant-id]','[data-self-name]','[role="listitem"][aria-label]'],
    cards:['.nMcdL','[data-caption-id]','[data-message-id]','[data-speaker-id]','[role="listitem"]','[role="group"]']
  };
  let entries=[],observer=null,observedRegion=null,rootObserver=null,persistTimer=null,reattachTimer=null,rosterTimer=null,publishTimer=null;
  let sessionId=null,elapsedBeforePause=0,activeSegmentStart=0,paused=false,hideNativeCaptions=true;
  let nodeEntries=new WeakMap(),seenCaptionFingerprints=new Map(),publishQueue=Promise.resolve(),fallbackSpeakerIds=new Map();
  const changedEntries=new Map(),activitySamples=[];
  const entryId=()=>crypto.randomUUID?crypto.randomUUID():'meet-'+Date.now()+'-'+Math.random().toString(36).slice(2);
  function markChanged(entry,speaker){changedEntries.set(entry.id,{...entry});const now=Date.now(),last=activitySamples[activitySamples.length-1];if(!last||last.speaker.toLowerCase()!==speaker.toLowerCase()||now-last.at>=300)activitySamples.push({speaker,at:now});while(activitySamples.length>500)activitySamples.shift();}
  const commitTimers=new Map(),originalCaptionStyles=new WeakMap();
  const elapsed=()=>Math.max(0,Math.floor((elapsedBeforePause+(activeSegmentStart?performance.now()-activeSegmentStart:0))/1000));
  function sendRuntimeMessage(message){try{if(typeof chrome==='undefined'||!chrome.runtime||!chrome.runtime.id)return Promise.resolve(null);return chrome.runtime.sendMessage(message).catch(()=>null);}catch(_){return Promise.resolve(null);}}
  function region(){
    // Meet can retain empty, hidden, or stale caption regions. Enumerate all
    // candidates and prefer the one with rendered speaker-labelled cards.
    const candidates=new Set();
    for(const selector of SELECTORS.regions){
      document.querySelectorAll(selector).forEach(el=>{
        const label=(el.getAttribute('aria-label')||'').toLowerCase();
        const hasMeetCards=!!el.querySelector('.nMcdL .NWpY1d,.nMcdL .ygicle');
        const hasCaptionMetadata=!!el.querySelector('[data-caption-id],[data-message-id],[data-speaker-id]');
        if(label.includes('caption')||hasMeetCards||hasCaptionMetadata)candidates.add(el);
      });
    }
    if(!candidates.size)return null;
    const isRendered=el=>{
      // Do not test opacity: Meet Notebook may deliberately set the selected
      // captions region to opacity:0 while continuing to observe its DOM.
      for(let node=el;node&&node!==document.documentElement;node=node.parentElement){
        if(node.hidden||node.getAttribute?.('aria-hidden')==='true')return false;
        const style=getComputedStyle(node);
        if(style.display==='none'||style.visibility==='hidden'||style.contentVisibility==='hidden')return false;
      }
      return !el.getClientRects||el.getClientRects().length>0;
    };
    const score=el=>{
      if(!isRendered(el))return -1;
      const cards=[...el.querySelectorAll('.nMcdL')].filter(isRendered);
      const pairedCards=cards.filter(card=>card.querySelector('.NWpY1d')&&card.querySelector('.ygicle')).length;
      const metadata=el.querySelectorAll('[data-caption-id],[data-message-id],[data-speaker-id]').length;
      const avatars=el.querySelectorAll('img,[role="img"]').length;
      const label=((el.getAttribute('aria-label')||'').toLowerCase().includes('caption'))?2:0;
      // A rendered card with both a speaker and utterance is stronger evidence
      // than a stale card count or an aria-label on an otherwise empty region.
      return pairedCards*1000+cards.length*100+metadata*5+Math.min(avatars,5)+label;
    };
    return [...candidates].map(el=>({el,score:score(el)}))
      .filter(candidate=>candidate.score>=0)
      .sort((a,b)=>b.score-a.score)[0]?.el||null;
  }
  function setCaptionVisibility(hide){hideNativeCaptions=!!hide;const el=region();if(!el)return;if(!originalCaptionStyles.has(el))originalCaptionStyles.set(el,{opacity:el.style.getPropertyValue('opacity'),opacityPriority:el.style.getPropertyPriority('opacity'),pointerEvents:el.style.getPropertyValue('pointer-events'),pointerEventsPriority:el.style.getPropertyPriority('pointer-events')});if(hide){el.style.setProperty('opacity','0','important');el.style.setProperty('pointer-events','none','important');}else{const old=originalCaptionStyles.get(el);old.opacity?el.style.setProperty('opacity',old.opacity,old.opacityPriority):el.style.removeProperty('opacity');old.pointerEvents?el.style.setProperty('pointer-events',old.pointerEvents,old.pointerEventsPriority):el.style.removeProperty('pointer-events');}}
  function enableCaptions(){const buttons=SELECTORS.buttons.flatMap(selector=>[...document.querySelectorAll(selector)]);if(buttons.some(b=>/turn off captions/i.test(b.getAttribute('aria-label')||'')))return true;const b=buttons.find(x=>/turn on captions/i.test(x.getAttribute('aria-label')||''));if(b){b.click();return true;}return false;}
  const junk=/^(jump to bottom|caption settings|format size|settings|arrow_downward|more options|mic|volume up)$/i;
  function cleanLines(el){return (el.innerText||el.textContent||'').split('\n').map(v=>v.trim()).filter(v=>v&&!junk.test(v)&&!/^[a-z]+(_[a-z]+)+$/i.test(v));}
  function speakerLike(v){v=String(v||'').trim();return !!v&&v.length<=80&&!junk.test(v)&&!/^(you|your microphone|microphone|captions?|remote participant|unattributed audio)$/i.test(v)&&v.split(/\s+/).length<=8;}
  function metadataSpeaker(card){const extract=v=>{v=String(v||'').trim();if(!v)return '';const patterns=[/^(?:speaker|participant|from|caption(?:s)?(?:\s+from)?)\s*[:—-]\s*(.+)$/i,/^(.{1,80}?)\s+(?:said|says|speaking)\b/i,/^(.{1,80}?)\s*[:—-]\s*.+$/];for(const pattern of patterns){const m=v.match(pattern);if(m&&speakerLike(m[1].trim()))return m[1].trim().replace(/\s*\(you\)\s*$/i,'').trim();}if(speakerLike(v)&&!/(caption|participant|speaker|microphone)/i.test(v))return v.replace(/\s*\(you\)\s*$/i,'').trim();return '';};for(let current=card,depth=0;current&&depth<4;current=current.parentElement,depth++){for(const attr of ['data-speaker-name','data-author-name','aria-label','title']){const name=extract(current.getAttribute?.(attr));if(name)return name;}const node=current.querySelector?.('[data-speaker-name],[data-author-name],[aria-label*="speaker" i],[aria-label*="participant" i]');if(node&&node!==current){for(const attr of ['data-speaker-name','data-author-name','aria-label','title']){const name=extract(node.getAttribute?.(attr));if(name)return name;}const name=extract(node.textContent);if(name)return name;}}return '';}
  function captionBlocks(root){
    const candidates=new Set();
    // Current Google Meet caption DOM (confirmed from the user's sanitized
    // diagnostics): each .nMcdL card contains the speaker in .NWpY1d and
    // the utterance in .ygicle. Prefer these exact card boundaries so the
    // speaker and its text are never accidentally paired across participants.
    root.querySelectorAll('.nMcdL').forEach(el=>{
      if(el.querySelector('.NWpY1d')&&el.querySelector('.ygicle'))candidates.add(el);
    });
    for(const selector of SELECTORS.cards)root.querySelectorAll(selector).forEach(el=>candidates.add(el));
    // Preserve the original working Meet strategy: walk upward from each
    // speaker avatar and identify the smallest caption block containing both
    // speaker and utterance text. Some Meet builds nest cards below wrappers.
    root.querySelectorAll('img,[role="img"]').forEach(img=>{
      let el=img.parentElement;
      while(el&&el!==root){
        if(el.matches?.('.nMcdL')){candidates.add(el);break;}
        if(cleanLines(el).length>=2){candidates.add(el);break;}
        el=el.parentElement;
      }
    });
    root.querySelectorAll('img,[role="img"]').forEach(img=>{let el=img.parentElement;while(el&&el!==root){const ls=cleanLines(el);if(ls.length>=2){candidates.add(el);break;}el=el.parentElement;}});
    // Compatibility fallback: older Meet builds expose caption cards only as
    // direct children of the live caption region, without stable data/ARIA IDs.
    if(!candidates.size){const scope=root.firstElementChild||root;[...scope.children].forEach(el=>{if(cleanLines(el).length>=2)candidates.add(el);});}
    const valid=[...candidates].filter(el=>{
      if(el===root)return false;
      // Do not run generic line-count/metadata validation on the confirmed
      // Meet card shape: captions may be rendered as one concatenated text
      // line (or innerText may omit line breaks), even though the speaker and
      // utterance are present in their own descendants.
      if(el.matches?.('.nMcdL')&&el.querySelector('.NWpY1d')&&el.querySelector('.ygicle'))return true;
      const ls=cleanLines(el),meta=metadataSpeaker(el);
      return(meta&&ls.some(x=>x!==meta))||(ls.length>=2&&speakerLike(ls[0]));
    });
    // Prefer each individual card; do not collapse sibling captions into a shared wrapper.
    return valid.filter(el=>!valid.some(child=>child!==el&&el.contains(child)));
  }
  function parseCaptionCard(card){
    // Current Meet renders speaker + text in distinct descendants. Read them
    // directly before applying generic/legacy heuristics.
    const meetName=card.querySelector?.('.NWpY1d')?.textContent?.trim()||'';
    const meetText=card.querySelector?.('.ygicle')?.textContent?.trim()||'';
    if(meetName&&meetText&&speakerLike(meetName)&&meetText.length<=2000){
      return{speaker:meetName.replace(/\s*\(you\)\s*$/i,'').trim(),text:meetText.replace(/\s+/g,' ').trim()};
    }
    const ls=cleanLines(card),metadata=metadataSpeaker(card);let parsed=MeetNotebookTranscript.parseCaptionLines(ls,metadata),speaker=parsed?.speaker||'',text=parsed?.text||'';if(!parsed&&metadata&&ls.length){speaker=metadata;text=ls.filter(x=>x!==metadata).join(' ').trim();}if(!text)return null;if(!speaker){const id=card.getAttribute('data-speaker-id')||card.getAttribute('data-participant-id')||card.parentElement?.getAttribute('data-speaker-id')||card.parentElement?.getAttribute('data-participant-id');if(id){if(!fallbackSpeakerIds.has(id))fallbackSpeakerIds.set(id,'Speaker '+(fallbackSpeakerIds.size+1));speaker=fallbackSpeakerIds.get(id);}}if(!speaker||!speakerLike(speaker)||text.length>2000)return null;return{speaker,text:text.replace(/\s+/g,' ').trim()};}
  function fingerprint(speaker,text){return speaker.toLocaleLowerCase()+'|'+text.toLocaleLowerCase().normalize('NFKC').replace(/\s+/g,' ').trim();}
  function scheduleCommit(entry){const old=commitTimers.get(entry);if(old)clearTimeout(old);entry.committed=false;commitTimers.set(entry,setTimeout(()=>{entry.committed=true;commitTimers.delete(entry);markChanged(entry,entry.speaker);publish();},850));}
  function flushPublish(){if(publishTimer){clearTimeout(publishTimer);publishTimer=null;}if(!sessionId)return publishQueue;const snapshot=[...changedEntries.values()].map(e=>({...e})),samples=activitySamples.splice(0),id=sessionId;changedEntries.clear();if(!snapshot.length&&!samples.length)return publishQueue;publishQueue=publishQueue.then(()=>sendRuntimeMessage({type:'TRANSCRIPT_UPDATE',sessionId:id,entries:snapshot,samples})).catch(()=>{});return publishQueue;}
  function publish(){if(!sessionId||publishTimer)return;publishTimer=setTimeout(()=>{publishTimer=null;flushPublish();},120);}
  function scan(){if(paused)return;const root=region();if(!root)return;for(const block of captionBlocks(root)){const parsed=parseCaptionCard(block);if(!parsed)continue;const {speaker,text}=parsed,key=fingerprint(speaker,text),previous=nodeEntries.get(block);if(previous&&previous.fingerprint===key)continue;const now=Date.now();if(previous?.entry&&previous.speaker.toLowerCase()===speaker.toLowerCase()){previous.entry.text=MeetNotebookTranscript.mergeRollingText(previous.entry.text,text);previous.entry.updatedAt=now;previous.entry.endAt=now;previous.fingerprint=key;nodeEntries.set(block,previous);seenCaptionFingerprints.set(key,now);markChanged(previous.entry,speaker);scheduleCommit(previous.entry);publish();continue;}const seenAt=seenCaptionFingerprints.get(key);if(seenAt&&now-seenAt<2500){nodeEntries.set(block,{speaker,fingerprint:key,entry:null});continue;}const recent=entries[entries.length-1];if(recent&&recent.source==='meet'&&recent.speaker.toLowerCase()===speaker.toLowerCase()&&now-(recent.updatedAt||now)<90000&&MeetNotebookTranscript.isRollingUpdate(recent.text,text)){recent.text=MeetNotebookTranscript.mergeRollingText(recent.text,text);recent.updatedAt=now;recent.endAt=now;nodeEntries.set(block,{speaker,fingerprint:key,entry:recent});seenCaptionFingerprints.set(key,now);markChanged(recent,speaker);scheduleCommit(recent);publish();continue;}const entry={id:entryId(),speaker,text,t:elapsed(),at:now,endAt:now,updatedAt:now,committed:false,source:'meet'};entries.push(entry);nodeEntries.set(block,{speaker,fingerprint:key,entry});seenCaptionFingerprints.set(key,now);markChanged(entry,speaker);for(const [fp,ts] of seenCaptionFingerprints){if(now-ts>15000||seenCaptionFingerprints.size>2000)seenCaptionFingerprints.delete(fp);if(seenCaptionFingerprints.size<=2000&&now-ts<=15000)break;}scheduleCommit(entry);publish();}}
  function attach(){const root=region();if(!root)return false;if(hideNativeCaptions)setCaptionVisibility(true);if(observer&&observedRegion===root)return true;observer?.disconnect();observedRegion=root;observer=new MutationObserver(scan);observer.observe(root,{childList:true,characterData:true,subtree:true});scan();return true;}
  function participants(){const out=new Set();SELECTORS.tiles.forEach(sel=>document.querySelectorAll(sel).forEach(el=>{const name=(el.getAttribute('aria-label')||el.getAttribute('data-self-name')||el.innerText||'').split(/[\n,]/)[0].trim();if(name&&name.length<80)out.add(name);}));return[...out];}
  function cleanup(){observer?.disconnect();rootObserver?.disconnect();clearInterval(persistTimer);clearInterval(reattachTimer);clearInterval(rosterTimer);clearTimeout(publishTimer);for(const timer of commitTimers.values())clearTimeout(timer);commitTimers.clear();publishTimer=null;observer=null;observedRegion=null;rootObserver=null;}
  function start(message){cleanup();entries=[];nodeEntries=new WeakMap();seenCaptionFingerprints.clear();fallbackSpeakerIds.clear();changedEntries.clear();activitySamples.length=0;publishQueue=Promise.resolve();elapsedBeforePause=0;activeSegmentStart=performance.now();sessionId=message.sessionId;paused=false;hideNativeCaptions=message.hideNativeCaptions!==false;enableCaptions();attach();rootObserver=new MutationObserver(()=>{if(region())attach();else{observer?.disconnect();observer=null;observedRegion=null;}});rootObserver.observe(document.documentElement,{childList:true,subtree:true});reattachTimer=setInterval(()=>{enableCaptions();attach();},1800);persistTimer=setInterval(publish,1000);rosterTimer=setInterval(()=>sendRuntimeMessage({type:'ROSTER_UPDATE',sessionId,participants:participants()}),10000);}
  function pause(){if(paused)return;elapsedBeforePause+=activeSegmentStart?performance.now()-activeSegmentStart:0;activeSegmentStart=0;paused=true;publish();}
  function resume(){if(!paused)return;paused=false;activeSegmentStart=performance.now();scan();}
  async function stop(){if(!paused){elapsedBeforePause+=activeSegmentStart?performance.now()-activeSegmentStart:0;activeSegmentStart=0;paused=true;}for(const timer of commitTimers.values())clearTimeout(timer);commitTimers.clear();entries.forEach(e=>{e.committed=true;markChanged(e,e.speaker);});await flushPublish();setCaptionVisibility(false);cleanup();return entries;}
  function diagnose(){const root=region();if(!root)return{found:false,html:''};const clone=root.cloneNode(true);clone.querySelectorAll('*').forEach(el=>{[...el.attributes].forEach(a=>{if(!['class','role','aria-label','aria-live','data-speaker-id','data-participant-id','data-caption-id','data-message-id','data-speaker-name','data-author-name'].includes(a.name))el.removeAttribute(a.name);});if(el.tagName==='IMG')el.setAttribute('src','redacted');});const walker=document.createTreeWalker(clone,NodeFilter.SHOW_TEXT);while(walker.nextNode())walker.currentNode.nodeValue='[redacted]';return{found:true,html:clone.outerHTML.slice(0,12000)};}
  chrome.runtime.onMessage.addListener((message,_sender,reply)=>{if(message.type==='SET_CAPTION_VISIBILITY'){setCaptionVisibility(message.hidden);reply({ok:true});}else if(message.type==='START_TRANSCRIPT'){start(message);reply({ok:true});}else if(message.type==='STOP_TRANSCRIPT'){stop().then(entries=>reply({entries})).catch(error=>reply({entries:[],error:error.message||String(error)}));return true;}else if(message.type==='PAUSE_TRANSCRIPT'){pause();reply({ok:true});}else if(message.type==='RESUME_TRANSCRIPT'){resume();reply({ok:true});}else if(message.type==='DIAGNOSE')reply(diagnose());});
})();