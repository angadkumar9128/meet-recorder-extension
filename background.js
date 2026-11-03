importScripts('lib/transcript.js');

const getState=async()=>((await chrome.storage.session.get('state')).state)||{recording:false,paused:false,elapsedMs:0};
const setState=state=>chrome.storage.session.set({state});
const pad=n=>String(n).padStart(2,'0');
const stamp=ms=>{const d=new Date(ms);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+'-'+pad(d.getMinutes());};
const codeFrom=url=>{try{return new URL(url).pathname.split('/').filter(Boolean).join('')||'meet';}catch{return 'meet';}};
function elapsedNow(s){return Math.max(0,(s.elapsedMs||0)+(s.recording&&!s.paused&&s.segmentStartedAt?Date.now()-s.segmentStartedAt:0));}
function mergeWithAuxiliary(meetEntries,storedEntries){const auxiliary=(storedEntries||[]).filter(e=>e.source==='local-asr'||e.source==='note');const meet=(meetEntries||[]).map(e=>({...e,source:'meet'}));return [...meet,...auxiliary].sort((a,b)=>(a.t||0)-(b.t||0));}
function normalizeSpeech(s){return String(s||'').toLocaleLowerCase().normalize('NFKC').replace(/[^\p{L}\p{N}\s]/gu,'').replace(/\s+/g,' ').trim();}
async function ensureOffscreen(){const list=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});if(!list.length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','BLOBS'],justification:'Capture, enhance and locally persist meeting media.'});}
async function sendTab(tabId,message){try{return await chrome.tabs.sendMessage(tabId,message);}catch{await chrome.scripting.executeScript({target:{tabId},files:['lib/transcript.js','content.js']});return chrome.tabs.sendMessage(tabId,message);}}
function transcriptText(entries,state,format){const turns=MeetNotebookTranscript.buildTurns(entries,state.myName||'You');if(format==='json')return JSON.stringify({meeting:state.code,startedAt:state.startedAt,turns},null,2);if(format==='md')return '# '+state.code+'\n\n'+turns.map(t=>'**'+t.name+'** — '+t.text).join('\n\n')+'\n';return MeetNotebookTranscript.formatPlainText(entries,state.myName||'You');}
async function downloadTranscript(sessionId,format){const all=await chrome.storage.local.get('sessions');const s=(all.sessions||[]).find(x=>x.id===sessionId);if(!s)throw new Error('Meeting transcript not found.');const content=transcriptText(s.entries||[],s,format||'txt');const mime=format==='json'?'application/json':format==='md'?'text/markdown':'text/plain';await chrome.downloads.download({url:'data:'+mime+';charset=utf-8,'+encodeURIComponent(content),filename:'MeetNotebook/'+stamp(s.startedAt)+'_'+s.code+'_transcript.'+(format||'txt'),saveAs:false});}
async function saveSession(state,entries,status,extra={}){const data=await chrome.storage.local.get('sessions');const sessions=data.sessions||[];const old=sessions.find(x=>x.id===state.sessionId)||{};const record={...old,id:state.sessionId,code:state.code,startedAt:state.startedAt,endedAt:old.endedAt||Date.now(),durationMs:elapsedNow(state),myName:state.myName,entries,status,...extra};await chrome.storage.local.set({sessions:[record,...sessions.filter(x=>x.id!==state.sessionId)]});}
async function stopRecording(){
  const state=await getState();if(!state.recording)return {ok:true};
  const elapsedMs=elapsedNow(state);const stopped={...state,recording:false,paused:false,elapsedMs,segmentStartedAt:null,finalizing:true};
  await setState(stopped);await chrome.action.setBadgeText({text:''});
  let entries=[];try{const r=await chrome.tabs.sendMessage(state.tabId,{type:'STOP_TRANSCRIPT'});entries=r.entries||[];}catch{}
  const saved=await chrome.storage.local.get('transcript:'+state.sessionId);entries=entries.length?mergeWithAuxiliary(entries,saved['transcript:'+state.sessionId]||[]):(saved['transcript:'+state.sessionId]||[]);
  await saveSession(stopped,entries,'finalizing');
  await chrome.downloads.download({url:'data:text/plain;charset=utf-8,'+encodeURIComponent(transcriptText(entries,stopped,'txt')),filename:'MeetNotebook/'+state.stamp+'_'+state.code+'_transcript.txt',saveAs:false});
  await chrome.runtime.sendMessage({target:'offscreen',type:'STOP'}).catch(()=>{});
  return {ok:true,elapsedMs};
}
async function deleteChunks(sessionId){return new Promise(resolve=>{const req=indexedDB.open('meet-notebook-media',2);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('chunks'))db.createObjectStore('chunks',{keyPath:['sessionId','index']});if(!db.objectStoreNames.contains('videos'))db.createObjectStore('videos',{keyPath:'sessionId'});};req.onerror=()=>resolve();req.onsuccess=()=>{const db=req.result;const tx=db.transaction(['chunks','videos'],'readwrite');const cursor=tx.objectStore('chunks').openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(c.value.sessionId===sessionId)c.delete();c.continue();};tx.objectStore('videos').delete(sessionId);tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();resolve();};};});}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg.target==='offscreen')return;
  (async()=>{try{
    switch(msg.type){
      case 'START':{
        const old=await getState();if(old.recording)throw new Error('A recording is already active.');
        const tab=await chrome.tabs.get(msg.tabId);if(!tab.url||!tab.url.startsWith('https://meet.google.com/'))throw new Error('Open a Google Meet tab first.');
        await ensureOffscreen();const sessionId=crypto.randomUUID();const startedAt=Date.now();
        const capture=await chrome.runtime.sendMessage({target:'offscreen',type:'START',streamId:msg.streamId,sessionId,quality:msg.quality||'high',micGain:msg.micGain||2,autoGain:msg.autoGain!==false,enhanceMic:msg.enhanceMic!==false,micDeviceId:msg.micDeviceId||null});
        if(!capture||!capture.ok)throw new Error(capture&&capture.error||'Could not start recording.');
        let transcriptOk=true;try{await sendTab(tab.id,{type:'START_TRANSCRIPT',startedAt,sessionId,hideNativeCaptions:msg.hideMeetCaptions!==false});}catch{transcriptOk=false;}
        const state={recording:true,paused:false,tabId:tab.id,sessionId,startedAt,segmentStartedAt:Date.now(),elapsedMs:0,myName:msg.myName||'You',code:codeFrom(tab.url),stamp:stamp(startedAt),quality:msg.quality||'high'};
        await setState(state);await chrome.storage.local.set({activeSessionId:sessionId,['transcript:'+sessionId]:[],pendingRecoverable:true});
        await chrome.action.setBadgeBackgroundColor({color:'#d93025'});await chrome.action.setBadgeText({text:'REC'});
        reply({ok:true,micOk:capture.micOk,transcriptOk,sessionId});break;
      }
      case 'STOP':reply(await stopRecording());break;
      case 'PAUSE':{
        const s=await getState();if(!s.recording||s.paused)throw new Error('Recording is not running.');
        const elapsedMs=elapsedNow(s);const r=await chrome.runtime.sendMessage({target:'offscreen',type:'PAUSE'});if(r&&r.ok===false)throw new Error(r.error||'Could not pause media.');
        await chrome.tabs.sendMessage(s.tabId,{type:'PAUSE_TRANSCRIPT'}).catch(()=>{});await setState({...s,paused:true,elapsedMs,segmentStartedAt:null});reply({ok:true,elapsedMs});break;
      }
      case 'RESUME':{
        const s=await getState();if(!s.recording||!s.paused)throw new Error('Recording is not paused.');
        const r=await chrome.runtime.sendMessage({target:'offscreen',type:'RESUME'});if(r&&r.ok===false)throw new Error(r.error||'Could not resume media.');
        await chrome.tabs.sendMessage(s.tabId,{type:'RESUME_TRANSCRIPT'}).catch(()=>{});await setState({...s,paused:false,segmentStartedAt:Date.now()});reply({ok:true});break;
      }
      case 'GET_STATE':{reply(await getState());break;}
      case 'GET_TRANSCRIPT':{const s=await getState();const id=msg.sessionId||s.sessionId;if(!id){reply({entries:[]});break;}const d=await chrome.storage.local.get('transcript:'+id);reply({entries:d['transcript:'+id]||[]});break;}
      case 'TRANSCRIPT_UPDATE':{
        const s=await getState();const id=msg.sessionId||s.sessionId;if(!id)throw new Error('No active meeting session.');
        const old=await chrome.storage.local.get('transcript:'+id);const entries=mergeWithAuxiliary(msg.entries||[],old['transcript:'+id]||[]);await chrome.storage.local.set({['transcript:'+id]:entries});await saveSession({...s,sessionId:id},entries,s.recording?'recording':s.finalizing?'finalizing':'saved');reply({ok:true});break;
      }
      case 'ROSTER_UPDATE':{const d=await chrome.storage.local.get('sessions');const rows=d.sessions||[];const i=rows.findIndex(x=>x.id===msg.sessionId);if(i>=0){rows[i]={...rows[i],participants:msg.participants||[]};await chrome.storage.local.set({sessions:rows});}reply({ok:true});break;}
      case 'AUDIO_LEVELS':await chrome.storage.local.set({micAudioLevel:msg.mic||0,tabAudioLevel:msg.tab||0});reply({ok:true});break;
      case 'LOCAL_TRANSCRIPT_UPDATE':
      case 'NOTE_UPDATE':{
        const s=await getState();const id=msg.sessionId||s.sessionId;if(!id)throw new Error('No active meeting session.');
        const key='transcript:'+id;const d=await chrome.storage.local.get(key);const entries=d[key]||[];const entry={...(msg.entry||{}),source:msg.type==='NOTE_UPDATE'?'note':'local-asr'};
        const normalized=normalizeSpeech(entry.text);const duplicate=entries.some(e=>Math.abs((e.t||0)-(entry.t||0))<=4&&normalizeSpeech(e.text)===normalized);
        if(normalized&&!duplicate)entries.push(entry);
        entries.sort((a,b)=>(a.t||0)-(b.t||0));await chrome.storage.local.set({[key]:entries});await saveSession({...s,sessionId:id},entries,s.recording?'recording':s.finalizing?'finalizing':'saved');reply({ok:true,duplicate});break;
      }
      case 'LIST_SESSIONS':{const d=await chrome.storage.local.get('sessions');reply({sessions:d.sessions||[]});break;}
      case 'DOWNLOAD_TRANSCRIPT':await downloadTranscript(msg.sessionId,msg.format||'txt');reply({ok:true});break;
      case 'DELETE_SESSION':{const d=await chrome.storage.local.get('sessions');await chrome.storage.local.set({sessions:(d.sessions||[]).filter(x=>x.id!==msg.sessionId)});await chrome.storage.local.remove('transcript:'+msg.sessionId);await deleteChunks(msg.sessionId);reply({ok:true});break;}
      case 'VIDEO_READY':{
        const s=await getState();const d=await chrome.storage.local.get('sessions');const session=(d.sessions||[]).find(x=>x.id===msg.sessionId)||{id:msg.sessionId,code:s.code||'meet',startedAt:s.startedAt||Date.now(),entries:[]};
        const downloadId=await chrome.downloads.download({url:msg.url,filename:'MeetNotebook/'+stamp(session.startedAt)+'_'+session.code+'_video.'+(String(msg.mimeType||'').includes('mp4')?'mp4':'webm'),saveAs:false});
        await chrome.storage.local.set({pendingRecoverable:false,['downloadUrl:'+downloadId]:msg.url});
        const next={...session,status:'saved',endedAt:Date.now(),durationMs:msg.durationMs||session.durationMs||0,videoAvailable:true,mimeType:msg.mimeType,videoSize:msg.size};
        await chrome.storage.local.set({sessions:[next,...(d.sessions||[]).filter(x=>x.id!==session.id)]});
        if(s.sessionId===msg.sessionId)await setState({recording:false,paused:false,sessionId:msg.sessionId,code:session.code,elapsedMs:next.durationMs,finalizing:false});
        reply({ok:true,downloadId});break;
      }
      case 'RECORDING_ERROR':await chrome.storage.local.set({pendingRecoverable:true,lastRecordingError:msg.error||'Recording failed.'});reply({ok:true});break;
      case 'DIAGNOSE':reply(await chrome.tabs.sendMessage(msg.tabId,{type:'DIAGNOSE'}));break;
      default:reply({ok:false,error:'Unknown request.'});
    }
  }catch(e){reply({ok:false,error:e.message||String(e)});}})();return true;
});
chrome.downloads.onChanged.addListener(async delta=>{if(!delta.state||!['complete','interrupted'].includes(delta.state.current))return;const key='downloadUrl:'+delta.id;const d=await chrome.storage.local.get(key);if(d[key]){await chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE_URL',url:d[key]}).catch(()=>{});await chrome.storage.local.remove(key);}});
chrome.action.onClicked.addListener(async tab=>{if(tab.id)await chrome.sidePanel.open({tabId:tab.id});});
chrome.commands.onCommand.addListener(async command=>{if(command==='open-notebook'){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(tab&&tab.id)await chrome.sidePanel.open({tabId:tab.id});}});
chrome.tabs.onRemoved.addListener(async tabId=>{const s=await getState();if(s.recording&&s.tabId===tabId)await stopRecording();});
chrome.runtime.onStartup.addListener(async()=>{const s=await getState();if(s.recording)await chrome.storage.local.set({pendingRecoverable:true});});
