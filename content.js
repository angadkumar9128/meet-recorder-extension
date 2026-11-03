(() => {
  if(window.__meetNotebookLoaded)return;window.__meetNotebookLoaded=true;
  const SELECTORS={regions:['[role="region"][aria-label*="caption" i]','[aria-label="Captions"]','[aria-label*="caption" i][role="group"]','[aria-live]'],buttons:['button[aria-label*="turn on captions" i]','button[aria-label*="turn off captions" i]'],tiles:['[data-participant-id]','[data-self-name]','[role="listitem"][aria-label]']};
  let entries=[],active=null,observer=null,observedRegion=null,rootObserver=null,persistTimer=null,reattachTimer=null,stableTimer=null,publishTimer=null,sessionId=null,elapsedBeforePause=0,activeSegmentStart=0,paused=false,hideNativeCaptions=true;
  const originalCaptionStyles=new WeakMap();
  const elapsed=()=>Math.max(0,Math.floor((elapsedBeforePause+(activeSegmentStart?performance.now()-activeSegmentStart:0))/1000));
  const region=()=>{for(const sel of SELECTORS.regions){const el=document.querySelector(sel);if(el&&((el.getAttribute('aria-label')||'').toLowerCase().includes('caption')||el.querySelector('img,[role="img"]')))return el;}return null;};
  function setCaptionVisibility(hide){
    hideNativeCaptions=!!hide;
    const r=region();if(!r)return;
    if(!originalCaptionStyles.has(r))originalCaptionStyles.set(r,{opacity:r.style.getPropertyValue('opacity'),opacityPriority:r.style.getPropertyPriority('opacity'),pointerEvents:r.style.getPropertyValue('pointer-events'),pointerEventsPriority:r.style.getPropertyPriority('pointer-events')});
    if(hide){r.style.setProperty('opacity','0','important');r.style.setProperty('pointer-events','none','important');}
    else{const old=originalCaptionStyles.get(r);old.opacity?r.style.setProperty('opacity',old.opacity,old.opacityPriority):r.style.removeProperty('opacity');old.pointerEvents?r.style.setProperty('pointer-events',old.pointerEvents,old.pointerEventsPriority):r.style.removeProperty('pointer-events');}
  }
  function enableCaptions(){const bs=SELECTORS.buttons.flatMap(s=>[...document.querySelectorAll(s)]);if(bs.some(b=>/turn off captions/i.test(b.getAttribute('aria-label')||'')))return true;const b=bs.find(x=>/turn on captions/i.test(x.getAttribute('aria-label')||''));if(b){b.click();return true;}return false;}
  const junk=/^(jump to bottom|caption settings|format size|settings|arrow_downward|more options|mic|volume up)$/i;
  const lines=el=>(el.innerText||'').split('\n').map(x=>x.trim()).filter(x=>x&&!junk.test(x)&&!/^[a-z]+(_[a-z]+)+$/i.test(x));
  function blocks(r){const out=new Set();r.querySelectorAll('img,[role="img"]').forEach(img=>{let el=img.parentElement;while(el&&el!==r){if(el.querySelectorAll('img,[role="img"]').length>1)break;if(lines(el).length>=2){out.add(el);break;}el=el.parentElement;}});if(!out.size){const root=r.firstElementChild||r;[...root.children].forEach(el=>{if(lines(el).length>=2)out.add(el);});}return [...out];}
  function scan(){
    if(paused)return;const r=region();if(!r)return;let newest=null;
    for(const b of blocks(r)){const l=lines(b);if(l.length<2)continue;const speaker=l[0].replace(/\s*\(you\)\s*$/i,'').trim();const text=l.slice(1).join(' ').trim();if(!speaker||!text||speaker.length>80)continue;newest={speaker,text};}
    if(!newest)return;
    if(active&&active.speaker===newest.speaker)active.text=MeetNotebookTranscript.mergeRollingText(active.text,newest.text);
    else{active={speaker:newest.speaker,text:newest.text,t:elapsed(),committed:false};entries.push(active);}
    active.updatedAt=Date.now();clearTimeout(stableTimer);stableTimer=setTimeout(()=>{if(active)active.committed=true;publish();},650);publish();
  }
  function publish(){if(!sessionId)return;clearTimeout(publishTimer);publishTimer=setTimeout(()=>chrome.runtime.sendMessage({type:'TRANSCRIPT_UPDATE',sessionId,entries}).catch(()=>{}),180);}
  function attach(){const r=region();if(!r)return false;if(hideNativeCaptions)setCaptionVisibility(true);if(observer&&observedRegion===r)return true;observer?.disconnect();observedRegion=r;observer=new MutationObserver(scan);observer.observe(r,{childList:true,characterData:true,subtree:true});scan();return true;}
  function participants(){const out=new Set();SELECTORS.tiles.forEach(sel=>document.querySelectorAll(sel).forEach(el=>{const n=(el.getAttribute('aria-label')||el.getAttribute('data-self-name')||el.innerText||'').split(/[,\n]/)[0].trim();if(n&&n.length<80)out.add(n);}));return [...out];}
  function cleanup(){observer?.disconnect();rootObserver?.disconnect();clearInterval(persistTimer);clearInterval(reattachTimer);clearTimeout(stableTimer);clearTimeout(publishTimer);observer=null;observedRegion=null;rootObserver=null;}
  function start(msg){cleanup();entries=[];active=null;elapsedBeforePause=0;activeSegmentStart=performance.now();sessionId=msg.sessionId;paused=false;hideNativeCaptions=msg.hideNativeCaptions!==false;enableCaptions();attach();rootObserver=new MutationObserver(()=>{if(region())attach();else{observer?.disconnect();observer=null;observedRegion=null;}});rootObserver.observe(document.documentElement,{childList:true,subtree:true});reattachTimer=setInterval(()=>{enableCaptions();attach();},1800);persistTimer=setInterval(()=>{publish();chrome.runtime.sendMessage({type:'ROSTER_UPDATE',sessionId,participants:participants()}).catch(()=>{});},2500);}
  function pause(){if(paused)return;elapsedBeforePause+=activeSegmentStart?performance.now()-activeSegmentStart:0;activeSegmentStart=0;paused=true;publish();}
  function resume(){if(!paused)return;paused=false;activeSegmentStart=performance.now();scan();}
  function stop(){if(!paused){elapsedBeforePause+=activeSegmentStart?performance.now()-activeSegmentStart:0;activeSegmentStart=0;paused=true;}clearTimeout(stableTimer);if(active)active.committed=true;setCaptionVisibility(false);cleanup();publish();return entries;}
  function diagnose(){const r=region();if(!r)return {found:false,html:''};const c=r.cloneNode(true);c.querySelectorAll('*').forEach(el=>{[...el.attributes].forEach(a=>{if(!['class','role','aria-label','aria-live'].includes(a.name))el.removeAttribute(a.name);});if(el.tagName==='IMG')el.setAttribute('src','redacted');});const w=document.createTreeWalker(c,NodeFilter.SHOW_TEXT);while(w.nextNode())w.currentNode.nodeValue='[redacted]';return {found:true,html:c.outerHTML.slice(0,6000)};}
  chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg.type==='SET_CAPTION_VISIBILITY'){setCaptionVisibility(msg.hidden);reply({ok:true});}else if(msg.type==='START_TRANSCRIPT'){start(msg);reply({ok:true});}else if(msg.type==='STOP_TRANSCRIPT')reply({entries:stop()});else if(msg.type==='PAUSE_TRANSCRIPT'){pause();reply({ok:true});}else if(msg.type==='RESUME_TRANSCRIPT'){resume();reply({ok:true});}else if(msg.type==='DIAGNOSE')reply(diagnose());});
})();
