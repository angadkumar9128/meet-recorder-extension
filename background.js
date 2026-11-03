importScripts('lib/transcript.js');
const getState=async()=>((await chrome.storage.session.get('state')).state)||{recording:false,paused:false};
const setState=state=>chrome.storage.session.set({state});
const pad=n=>String(n).padStart(2,'0');
const stamp=ms=>{const d=new Date(ms);return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+'_'+pad(d.getHours())+'-'+pad(d.getMinutes());};
const codeFrom=url=>{try{return new URL(url).pathname.replace(/\//g,'')||'meet';}catch{return 'meet';}};
async function ensureOffscreen(){const list=await chrome.runtime.getContexts({contextTypes:['OFFSCREEN_DOCUMENT']});if(!list.length)await chrome.offscreen.createDocument({url:'offscreen.html',reasons:['USER_MEDIA','BLOBS'],justification:'Capture and locally persist meeting media chunks.'});}
async function sendTab(tabId,message){try{return await chrome.tabs.sendMessage(tabId,message);}catch{await chrome.scripting.executeScript({target:{tabId},files:['lib/transcript.js','content.js']});return chrome.tabs.sendMessage(tabId,message);}}
function transcriptText(entries,state,format){
  const turns=MeetNotebookTranscript.buildTurns(entries,state.myName||'You');
  if(format==='json')return JSON.stringify({meeting:state.code,startedAt:state.startedAt,turns},null,2);
  if(format==='md')return '# '+state.code+'\n\n'+turns.map(t=>'**'+t.name+'** — '+t.text).join('\n\n')+'\n';
  return turns.map(t=>t.name+' - '+t.text).join('\n\n')+'\n';
}
async function downloadTranscript(sessionId,format){
  const all=await chrome.storage.local.get('sessions');const sessions=all.sessions||[];const s=sessions.find(x=>x.id===sessionId);if(!s)throw new Error('Meeting transcript not found.');
  const content=transcriptText(s.entries||[],s,format||'txt');const mime=format==='json'?'application/json':format==='md'?'text/markdown':'text/plain';
  await chrome.downloads.download({url:'data:'+mime+';charset=utf-8,'+encodeURIComponent(content),filename:'MeetNotebook/'+stamp(s.startedAt)+'_'+s.code+'_transcript.'+(format||'txt'),saveAs:false});
}
async function saveSession(state,entries,status){
  const data=await chrome.storage.local.get('sessions');const sessions=data.sessions||[];const old=sessions.find(x=>x.id===state.sessionId)||{};
  const record={...old,id:state.sessionId,code:state.code,startedAt:state.startedAt,endedAt:old.endedAt||Date.now(),myName:state.myName,entries,status};
  await chrome.storage.local.set({sessions:[record,...sessions.filter(x=>x.id!==state.sessionId)]});
}
async function stopRecording(){
  const state=await getState();if(!state.recording)return {ok:true};
  await setState({...state,recording:false,paused:false,finalizing:true});await chrome.action.setBadgeText({text:''});
  let entries=[];try{const r=await chrome.tabs.sendMessage(state.tabId,{type:'STOP_TRANSCRIPT'});entries=r.entries||[];}catch{}
  const saved=await chrome.storage.local.get('transcript:'+state.sessionId);if(!entries.length)entries=saved['transcript:'+state.sessionId]||[];
  await saveSession(state,entries,'finalizing');
  await chrome.downloads.download({url:'data:text/plain;charset=utf-8,'+encodeURIComponent(transcriptText(entries,state,'txt')),filename:'MeetNotebook/'+state.stamp+'_'+state.code+'_transcript.txt',saveAs:false});
  await chrome.runtime.sendMessage({target:'offscreen',type:'STOP'}).catch(()=>{});
  return {ok:true};
}
chrome.runtime.onMessage.addListener((msg,sender,reply)=>{
  if(msg.target==='offscreen')return;
  (async()=>{try{
    switch(msg.type){
      case 'START':{
        const old=await getState();if(old.recording)throw new Error('A recording is already active.');
        const tab=await chrome.tabs.get(msg.tabId);if(!tab.url||!tab.url.startsWith('https://meet.google.com/'))throw new Error('Open a Google Meet tab first.');
        await ensureOffscreen();const sessionId=crypto.randomUUID();const startedAt=Date.now();
        const capture=await chrome.runtime.sendMessage({target:'offscreen',type:'START',streamId:msg.streamId,sessionId,quality:msg.quality||'high'});
        if(!capture||!capture.ok)throw new Error(capture&&capture.error||'Could not start recording.');
        let transcriptOk=true;try{await sendTab(tab.id,{type:'START_TRANSCRIPT',startedAt,sessionId});}catch{transcriptOk=false;}
        const state={recording:true,paused:false,tabId:tab.id,sessionId,startedAt,myName:msg.myName||'You',code:codeFrom(tab.url),stamp:stamp(startedAt),quality:msg.quality||'high'};
        await setState(state);await chrome.storage.local.set({activeSessionId:sessionId,['transcript:'+sessionId]:[],pendingRecoverable:true});
        await chrome.action.setBadgeBackgroundColor({color:'#d93025'});await chrome.action.setBadgeText({text:'REC'});
        reply({ok:true,micOk:capture.micOk,transcriptOk,sessionId});break;
      }
      case 'STOP':reply(await stopRecording());break;
      case 'PAUSE':{
        const s=await getState();if(!s.recording||s.paused)throw new Error('Recording is not running.');
        await chrome.runtime.sendMessage({target:'offscreen',type:'PAUSE'});await chrome.tabs.sendMessage(s.tabId,{type:'PAUSE_TRANSCRIPT'}).catch(()=>{});await setState({...s,paused:true});reply({ok:true});break;
      }
      case 'RESUME':{
        const s=await getState();if(!s.recording||!s.paused)throw new Error('Recording is not paused.');
        await chrome.runtime.sendMessage({target:'offscreen',type:'RESUME'});await chrome.tabs.sendMessage(s.tabId,{type:'RESUME_TRANSCRIPT'}).catch(()=>{});await setState({...s,paused:false});reply({ok:true});break;
      }
      case 'GET_STATE':reply(await getState());break;
      case 'GET_TRANSCRIPT':{
        const s=await getState();const id=msg.sessionId||s.sessionId;if(!id){reply({entries:[]});break;}const d=await chrome.storage.local.get('transcript:'+id);reply({entries:d['transcript:'+id]||[]});break;
      }
      case 'TRANSCRIPT_UPDATE':{
        const s=await getState();const id=msg.sessionId||s.sessionId;if(!id)throw new Error('No active meeting session.');
        const entries=msg.entries||[];await chrome.storage.local.set({['transcript:'+id]:entries});await saveSession({...s,sessionId:id},entries,s.recording?'recording':'saved');reply({ok:true});break;
      }
      case 'LIST_SESSIONS':{const d=await chrome.storage.local.get('sessions');reply({sessions:d.sessions||[]});break;}
      case 'DOWNLOAD_TRANSCRIPT':await downloadTranscript(msg.sessionId,msg.format||'txt');reply({ok:true});break;
      case 'DELETE_SESSION':{const d=await chrome.storage.local.get('sessions');await chrome.storage.local.set({sessions:(d.sessions||[]).filter(x=>x.id!==msg.sessionId)});reply({ok:true});break;}
      case 'VIDEO_READY':{
        const s=await getState();const d=await chrome.storage.local.get('sessions');const session=(d.sessions||[]).find(x=>x.id===msg.sessionId)||{id:msg.sessionId,code:s.code||'meet',startedAt:s.startedAt||Date.now(),entries:[]};
        const downloadId=await chrome.downloads.download({url:msg.url,filename:'MeetNotebook/'+stamp(session.startedAt)+'_'+session.code+'_video.'+(String(msg.mimeType||'').includes('mp4')?'mp4':'webm'),saveAs:false});
        await chrome.storage.local.set({pendingRecoverable:false});
        const next={...session,status:'saved',endedAt:Date.now()};const sessions=[next,...(d.sessions||[]).filter(x=>x.id!==session.id)];await chrome.storage.local.set({sessions});
        await chrome.runtime.sendMessage({target:'offscreen',type:'REVOKE_URL',url:msg.url}).catch(()=>{});
        if(s.sessionId===msg.sessionId)await setState({recording:false,paused:false,sessionId:msg.sessionId,code:session.code});
        reply({ok:true,downloadId});break;
      }
      case 'RECORDING_ERROR':await chrome.storage.local.set({pendingRecoverable:true,lastRecordingError:msg.error||'Recording failed.'});reply({ok:true});break;
      case 'DIAGNOSE':reply(await chrome.tabs.sendMessage(msg.tabId,{type:'DIAGNOSE'}));break;
      default:reply({ok:false,error:'Unknown request.'});
    }
  }catch(e){reply({ok:false,error:e.message||String(e)});}})();return true;
});
chrome.action.onClicked.addListener(async tab=>{if(tab.id)await chrome.sidePanel.open({tabId:tab.id});});
chrome.commands.onCommand.addListener(async command=>{if(command==='open-notebook'){const [tab]=await chrome.tabs.query({active:true,lastFocusedWindow:true});if(tab&&tab.id)await chrome.sidePanel.open({tabId:tab.id});}});
chrome.tabs.onRemoved.addListener(async tabId=>{const s=await getState();if(s.recording&&s.tabId===tabId)await stopRecording();});
chrome.runtime.onStartup.addListener(async()=>{const s=await getState();if(s.recording)await chrome.storage.local.set({pendingRecoverable:true});});
