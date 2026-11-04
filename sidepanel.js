const $=id=>document.getElementById(id);
let state={recording:false,paused:false,elapsedMs:0},sessionId=null,entries=[],timer=null,scrollLatest=true,playerUrl=null,lastStatusSignature='';
const fmt=ms=>{const n=Math.floor(ms/1000),p=x=>String(x).padStart(2,'0');return p(Math.floor(n/3600))+':'+p(Math.floor(n%3600/60))+':'+p(n%60);};
const elapsed=()=>Math.max(0,(state.elapsedMs||0)+(state.recording&&!state.paused&&state.segmentStartedAt?Date.now()-state.segmentStartedAt:0));
async function request(type,extra={}){const r=await chrome.runtime.sendMessage({type,...extra});if(r&&r.ok===false)throw new Error(r.error||'Request failed');return r;}
async function activeMeet(){const [tab]=await chrome.tabs.query({active:true,currentWindow:true});if(!tab||!tab.url||!tab.url.startsWith('https://meet.google.com/'))throw new Error('Open a Google Meet tab first.');return tab;}
function renderState(){
  $('clock').classList.toggle('active',!!state.recording&&!state.paused);
  $('timer').textContent=fmt(elapsed());
  $('meeting').textContent=state.code||'No meeting selected';
  $('start').disabled=!!state.recording;$('pause').disabled=!state.recording;$('pause').textContent=state.paused?'Resume':'Pause';$('stop').disabled=!state.recording;
  const signature=state.recording?(state.paused?'Recording paused':'Recording in progress'):state.finalizing?'Finalizing video…':'Ready';if(signature!==lastStatusSignature){$('status').textContent=signature;lastStatusSignature=signature;}
}
function render(){
  const root=$('transcript'),q=$('search').value.trim().toLowerCase();root.replaceChildren();
  const rows=entries.filter(e=>!q||(e.speaker+' '+e.text).toLowerCase().includes(q));
  if(!rows.length){const p=document.createElement('p');p.className='empty';p.textContent='No matching captions yet.';root.append(p);return;}
  for(const entry of rows){const card=document.createElement('article');card.className='turn'+(entry.committed?'':' current')+(entry.source==='local-asr'?' audio-backup':'');const head=document.createElement('div');head.className='turnhead';const avatar=document.createElement('span');avatar.className='avatar';avatar.textContent=entry.speaker.split(/\s+/).map(x=>x[0]).slice(0,2).join('').toUpperCase();const name=document.createElement('span');name.className='speaker';name.textContent=entry.speaker;const time=document.createElement('span');time.className='time';time.textContent=fmt((entry.t||0)*1000);head.append(avatar,name,time);const p=document.createElement('p');p.textContent=entry.text;card.append(head,p);root.append(card);}
  if(scrollLatest)root.scrollTop=root.scrollHeight;
}
async function refresh(){
  state=await request('GET_STATE');sessionId=state.sessionId||sessionId;renderState();
  if(sessionId){const r=await request('GET_TRANSCRIPT',{sessionId});entries=r.entries||[];render();}
  clearInterval(timer);timer=setInterval(renderState,250);
}
function setSpeechModelStatus(message,isError=false){
  const output=$('speechModelStatus');
  if(output){output.textContent=message;output.dataset.state=isError?'error':'info';}
  if($('status'))$('status').textContent=message;
}
async function checkLocalSpeechModel(lang,install=false){
  const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SR||typeof SR.available!=='function'||typeof SR.install!=='function'){
    throw new Error('This Chrome installation does not expose local speech-model management. Update Chrome and reopen the extension.');
  }
  const options={langs:[lang],processLocally:true};
  setSpeechModelStatus('Checking Chrome local speech model for '+lang+'…');
  let availability;
  try{availability=await SR.available(options);}
  catch(error){throw new Error('Chrome could not check the local speech model: '+(error.message||error));}
  if(availability==='available'){
    setSpeechModelStatus('Ready: the '+lang+' local speech model is already installed.');
    return true;
  }
  if(availability==='unavailable'){
    throw new Error('Chrome does not offer an on-device speech model for '+lang+'. Try English (US) or another supported language.');
  }
  if(!install){
    throw new Error('The '+lang+' local speech model is not installed. Open Settings and click Install / check local speech model.');
  }
  setSpeechModelStatus('Downloading Chrome’s '+lang+' speech model. Keep this panel open until it finishes…');
  let installed;
  try{
    // install() accepts only the language list. processLocally belongs to available().
    installed=await SR.install({langs:[lang]});
  }catch(error){
    throw new Error('Chrome could not install the '+lang+' speech model: '+(error.message||error));
  }
  if(!installed)throw new Error('Chrome reported that the '+lang+' speech model could not be installed. Check your connection and try again.');
  let verified;
  try{verified=await SR.available(options);}
  catch(error){throw new Error('The model download finished, but Chrome could not verify it: '+(error.message||error));}
  if(verified!=='available')throw new Error('Chrome did not confirm that the '+lang+' model is ready. Please retry the installation.');
  setSpeechModelStatus('Installed and verified: '+lang+'. Local meeting transcription is ready.');
  return true;
}
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('meet-notebook-media',2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('chunks'))db.createObjectStore('chunks',{keyPath:['sessionId','index']});if(!db.objectStoreNames.contains('videos'))db.createObjectStore('videos',{keyPath:'sessionId'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function readVideo(id){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('videos','readonly');const r=tx.objectStore('videos').get(id);r.onsuccess=()=>resolve(r.result?.blob||null);r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function playback(id){
  try{const blob=await readVideo(id);if(!blob)throw new Error('Playback file is not available in local storage for this meeting.');if(playerUrl)URL.revokeObjectURL(playerUrl);playerUrl=URL.createObjectURL(blob);$('player').src=playerUrl;$('playbackPanel').hidden=false;$('player').load();$('playbackPanel').scrollIntoView({behavior:'smooth',block:'nearest'});$('status').textContent='Recording ready. Use the video timeline to seek.';}catch(e){$('status').textContent=e.message;}
}
$('start').onclick=async()=>{
  try{const tab=await activeMeet();const settings=await chrome.storage.local.get(['myName','quality','micGain','autoGain','enhanceMic','micDeviceId','audioTranscription','captionLanguage','hideMeetCaptions']);if(settings.audioTranscription!==false)await checkLocalSpeechModel(settings.captionLanguage||'en-US',false);const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:tab.id});
    const r=await request('START',{tabId:tab.id,streamId,myName:settings.myName,quality:settings.quality||'high',micGain:settings.micGain??2,autoGain:settings.autoGain!==false,enhanceMic:settings.enhanceMic!==false,micDeviceId:settings.micDeviceId||null,hideMeetCaptions:settings.hideMeetCaptions!==false,audioTranscription:settings.audioTranscription!==false,speechLanguage:settings.captionLanguage||'en-US'});
    sessionId=r.sessionId;await refresh();if(!r.micOk)$('status').textContent='Recording started, but microphone access was denied. Open Settings → Test microphone / grant access, then start a new recording.';else if(!r.transcriptOk)$('status').textContent='Recording started, but Meet captions could not be attached. Reload the Meet tab and try again.';
  }catch(e){$('status').textContent=e.message;}
};
$('pause').onclick=async()=>{try{const resuming=state.paused;await request(resuming?'RESUME':'PAUSE');await refresh();}catch(e){$('status').textContent=e.message;}};
$('stop').onclick=async()=>{try{await request('STOP');await refresh();$('status').textContent='Finalizing video…';}catch(e){$('status').textContent=e.message;}};
$('search').oninput=render;$('transcript').onscroll=()=>{scrollLatest=$('transcript').scrollHeight-$('transcript').scrollTop-$('transcript').clientHeight<35;};
$('addNote').onclick=async()=>{const text=$('manualNote').value.trim();if(!text)return;const entry={speaker:'My note',text,t:Math.floor(elapsed()/1000),committed:true,note:true,source:'note'};$('manualNote').value='';try{await request('NOTE_UPDATE',{sessionId,entry});const latest=await request('GET_TRANSCRIPT',{sessionId});entries=latest.entries||[];render();}catch(e){$('status').textContent='Note could not be saved: '+e.message;}};
document.querySelectorAll('[data-format]').forEach(b=>b.onclick=async()=>{try{await request('DOWNLOAD_TRANSCRIPT',{sessionId,format:b.dataset.format});}catch(e){$('status').textContent=e.message;}});
$('copy').onclick=()=>navigator.clipboard.writeText(entries.map(e=>e.speaker+' - '+e.text).join('\n\n'));
$('video').onclick=()=>{if(sessionId)playback(sessionId);else $('status').textContent='Start and stop a recording before opening playback.';};
document.querySelectorAll('.tab').forEach(b=>b.onclick=async()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x===b));['live','past','settings'].forEach(id=>$(id).hidden=id!==b.dataset.view);if(b.dataset.view==='past')await loadSessions();});
async function loadSessions(){
  const r=await request('LIST_SESSIONS');const root=$('sessions');root.replaceChildren();
  for(const s of (r.sessions||[]).sort((a,b)=>b.startedAt-a.startedAt)){
    const card=document.createElement('article');card.className='session';const title=document.createElement('strong');title.textContent=s.code||'Meet meeting';
    const meta=document.createElement('small');meta.textContent=new Date(s.startedAt).toLocaleString()+' · '+fmt(s.durationMs||0)+' · '+s.status;
    const dl=document.createElement('button');dl.textContent='Transcript';dl.onclick=()=>request('DOWNLOAD_TRANSCRIPT',{sessionId:s.id,format:'txt'}).catch(e=>$('status').textContent=e.message);
    card.append(title,meta,dl);
    if(s.videoAvailable){
      const play=document.createElement('button');play.textContent='Play / seek';play.onclick=()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.view==='live'));['live','past','settings'].forEach(id=>$(id).hidden=id!=='live');sessionId=s.id;playback(s.id);};card.append(play);

    }
    const del=document.createElement('button');del.textContent='Delete';del.onclick=async()=>{await request('DELETE_SESSION',{sessionId:s.id});await loadSessions();};card.append(del);root.append(card);
  }
}
async function settings(){
  const s=await chrome.storage.local.get(['myName','quality','theme','micGain','autoGain','enhanceMic','audioTranscription','captionLanguage']);
  $('myName').value=s.myName||'';$('quality').value=s.quality||'high';$('theme').value=s.theme||'system';$('micGain').value=s.micGain??2;$('gainValue').textContent=(Number($('micGain').value)).toFixed(1)+'×';$('autoGain').checked=s.autoGain!==false;$('enhanceMic').checked=s.enhanceMic!==false;$('audioTranscription').checked=s.audioTranscription!==false;$('captionLanguage').value=s.captionLanguage||'en-US';$('hideMeetCaptions').checked=s.hideMeetCaptions!==false;document.body.dataset.theme=s.theme==='system'?'':s.theme;
}
$('micGain').oninput=()=>$('gainValue').textContent=Number($('micGain').value).toFixed(1)+'×';
$('theme').onchange=()=>{document.body.dataset.theme=$('theme').value==='system'?'':$('theme').value;};
$('installSpeechPack').onclick=async()=>{
  const button=$('installSpeechPack'),lang=$('captionLanguage').value;
  if(button.disabled)return;
  button.disabled=true;button.textContent='Checking / installing…';
  try{
    await checkLocalSpeechModel(lang,true);
    $('audioTranscription').checked=true;
    await chrome.storage.local.set({audioTranscription:true,captionLanguage:lang});
    setSpeechModelStatus('Installed and enabled: '+lang+'. Start your next recording to transcribe the full meeting audio locally.');
  }catch(error){
    setSpeechModelStatus(error.message||String(error),true);
  }finally{
    button.disabled=false;button.textContent='Install / check local speech model';
  }
};
$('micSetup').onclick=()=>chrome.tabs.create({url:chrome.runtime.getURL('setup.html')});
$('save').onclick=async()=>{
  const s={myName:$('myName').value.trim(),quality:$('quality').value,theme:$('theme').value,micGain:Number($('micGain').value),autoGain:$('autoGain').checked,enhanceMic:$('enhanceMic').checked,audioTranscription:$('audioTranscription').checked,captionLanguage:$('captionLanguage').value,hideMeetCaptions:$('hideMeetCaptions').checked};
  await chrome.storage.local.set(s);document.body.dataset.theme=s.theme==='system'?'':s.theme;if(state.recording){const [activeTab]=await chrome.tabs.query({active:true,currentWindow:true});if(activeTab?.id)await chrome.tabs.sendMessage(activeTab.id,{type:'SET_CAPTION_VISIBILITY',hidden:s.hideMeetCaptions}).catch(()=>{});}$('status').textContent='Settings saved. Audio changes apply to the next recording.';
};
$('diagnostics').onclick=async()=>{try{const tab=await activeMeet();const r=await request('DIAGNOSE',{tabId:tab.id});if(!r.found)throw new Error('Meet captions were not found. Turn on CC.');await navigator.clipboard.writeText(r.html);$('status').textContent='Sanitized diagnostics copied.';}catch(e){$('status').textContent=e.message;}};
chrome.storage.onChanged.addListener((changes,area)=>{
  if(area==='local'){const c=changes['transcript:'+sessionId];if(c){entries=c.newValue||[];render();}if(changes.tabAudioLevel)$('tabMeter').value=changes.tabAudioLevel.newValue||0;if(changes.micAudioLevel)$('micMeter').value=changes.micAudioLevel.newValue||0;if(changes.audioTranscriptionStatus){$('status').textContent=changes.audioTranscriptionStatus.newValue||'';setSpeechModelStatus(changes.audioTranscriptionStatus.newValue||'');}}
  if(area==='session'&&changes.state){state={...state,...changes.state.newValue};sessionId=state.sessionId||sessionId;renderState();}
});
(async()=>{await settings();await refresh();})();
