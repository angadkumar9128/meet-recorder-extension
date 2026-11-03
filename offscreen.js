// Offscreen capture pipeline. Media chunks are persisted in IndexedDB as they arrive.
let recorder=null,tabStream=null,micStream=null,audioContext=null,sessionId=null,chunkIndex=0,chunkWrites=[],videoUrl=null;
let levelTimer=null,micGainNode=null,micAnalyser=null,tabAnalyser=null,micData=null,tabData=null;
let baseMicGain=2,autoGain=true,enhanceMic=true,activeElapsedMs=0,segmentStartedAt=0;
const PRESETS={standard:{width:1280,height:720,bitrate:4000000},high:{width:1920,height:1080,bitrate:8000000},saver:{width:1280,height:720,bitrate:2000000}};
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('meet-notebook-media',2);r.onupgradeneeded=()=>{const db=r.result;if(!db.objectStoreNames.contains('chunks'))db.createObjectStore('chunks',{keyPath:['sessionId','index']});if(!db.objectStoreNames.contains('videos'))db.createObjectStore('videos',{keyPath:'sessionId'});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function saveVideo(blob){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('videos','readwrite');tx.objectStore('videos').put({sessionId,blob,type:blob.type,savedAt:Date.now()});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function saveChunk(blob,index){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put({sessionId,index,blob,type:blob.type});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function readChunks(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readonly');const r=tx.objectStore('chunks').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.sessionId===sessionId).sort((a,b)=>a.index-b.index));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function clearChunks(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');const store=tx.objectStore('chunks');const cursor=store.openCursor();cursor.onsuccess=()=>{const c=cursor.result;if(!c)return;if(c.value.sessionId===sessionId)c.delete();c.continue();};tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
function supportedMime(){const mp4='video/mp4;codecs=avc1.640028,mp4a.40.2';if(MediaRecorder.isTypeSupported(mp4))return mp4;const vp8='video/webm;codecs=vp8,opus';return MediaRecorder.isTypeSupported(vp8)?vp8:'video/webm';}
function activeDuration(){return activeElapsedMs+(recorder&&recorder.state==='recording'&&segmentStartedAt?performance.now()-segmentStartedAt:0);}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function rms(analyser,data){if(!analyser||!data)return 0;analyser.getFloatTimeDomainData(data);let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];return Math.sqrt(sum/data.length);}
function monitorLevels(){
  if(!audioContext||audioContext.state==='closed')return;
  const mic=rms(micAnalyser,micData),tab=rms(tabAnalyser,tabData);
  if(micGainNode&&autoGain&&mic>0.00025){const target=clamp(.085/mic,1,3.2);micGainNode.gain.setTargetAtTime(clamp(baseMicGain*target,.5,5),audioContext.currentTime,.22);}
  chrome.runtime.sendMessage({type:'AUDIO_LEVELS',mic:clamp(mic*7,0,1),tab:clamp(tab*7,0,1)}).catch(()=>{});
}
function readVint(data,pos,isId=false){if(pos>=data.length)return null;const first=data[pos];let mask=0x80,len=1;while(len<=8&&(first&mask)===0){mask>>=1;len++;}if(len>8||pos+len>data.length)return null;let value=isId?first:first&(mask-1);for(let i=1;i<len;i++)value=value*256+data[pos+i];const unknown=!isId&&value===Math.pow(2,7*len)-1;return {length:len,value,unknown};}
function parseElement(data,pos,limit=data.length){const id=readVint(data,pos,true);if(!id)return null;const size=readVint(data,pos+id.length,false);if(!size)return null;const dataStart=pos+id.length+size.length;const end=size.unknown?limit:dataStart+size.value;if(end>limit||end<dataStart)return null;let idValue=0;for(let i=0;i<id.length;i++)idValue=idValue*256+data[pos+i];return {id:idValue,start:pos,idLength:id.length,sizeLength:size.length,dataStart,end,unknown:size.unknown,sizeValue:size.value};}
function encodeSize(value){for(let len=1;len<=8;len++){if(value<Math.pow(2,7*len)-1){let n=value,out=new Uint8Array(len);for(let i=len-1;i>=0;i--){out[i]=n&255;n=Math.floor(n/256);}out[0]|=1<<(8-len);return out;}}throw new Error('WebM element is too large to index.');}
function uintBytes(value){let n=Math.max(0,Math.floor(value)),a=[];do{a.unshift(n&255);n=Math.floor(n/256);}while(n>0);return new Uint8Array(a);}
function idBytes(value){const a=[];while(value>0){a.unshift(value&255);value=Math.floor(value/256);}return new Uint8Array(a);}
function makeElement(id,payload){const idPart=idBytes(id),size=encodeSize(payload.length),out=new Uint8Array(idPart.length+size.length+payload.length);out.set(idPart,0);out.set(size,idPart.length);out.set(payload,idPart.length+size.length);return out;}
function joinBytes(parts){const total=parts.reduce((n,p)=>n+p.length,0),out=new Uint8Array(total);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;}
function float64Bytes(value){const b=new ArrayBuffer(8);new DataView(b).setFloat64(0,value,false);return new Uint8Array(b);}
function readUInt(data,start,end){let n=0;for(let i=start;i<end;i++)n=n*256+data[i];return n;}
function findTrackNumber(data,tracks){if(!tracks)return 1;let p=tracks.dataStart;while(p<tracks.end){const entry=parseElement(data,p,tracks.end);if(!entry)break;if(entry.id===0xAE){let q=entry.dataStart,num=1,type=0;while(q<entry.end){const x=parseElement(data,q,entry.end);if(!x)break;if(x.id===0xD7)num=readUInt(data,x.dataStart,x.end);if(x.id===0x83)type=readUInt(data,x.dataStart,x.end);q=x.end;}if(type===1)return num;}p=entry.end;}return 1;}
// Add a duration and CuePoints to MediaRecorder WebM output so native players can build a timeline and seek by cluster.
async function repairWebm(input,durationMs){
  try{
    const data=new Uint8Array(await input.arrayBuffer());let p=0,segment=null;
    while(p<data.length){const e=parseElement(data,p);if(!e)break;if(e.id===0x18538067){segment=e;break;}p=e.end;}
    if(!segment)return new Blob([input],{type:input.type});
    const children=[];p=segment.dataStart;let timecodeScale=1000000,tracks=null,hasCues=false,info=null;
    while(p<segment.end){const e=parseElement(data,p,segment.end);if(!e)break;children.push(e);if(e.id===0x1549A966)info=e;if(e.id===0x1654AE6B)tracks=e;if(e.id===0x1C53BB6B)hasCues=true;p=e.end;}
    if(!info)return new Blob([input],{type:input.type});
    let ip=info.dataStart,infoParts=[],hasDuration=false;
    while(ip<info.end){const e=parseElement(data,ip,info.end);if(!e)break;if(e.id===0x2AD7B1)timecodeScale=readUInt(data,e.dataStart,e.end)||1000000;if(e.id===0x4489){hasDuration=true;infoParts.push(makeElement(0x4489,float64Bytes(durationMs*1000000/timecodeScale)));}else infoParts.push(data.slice(e.start,e.end));ip=e.end;}
    if(!hasDuration)infoParts.push(makeElement(0x4489,float64Bytes(durationMs*1000000/timecodeScale)));
    const newInfoPayload=joinBytes(infoParts),newInfo=makeElement(0x1549A966,newInfoPayload),trackNumber=findTrackNumber(data,tracks);
    const segmentParts=[],cueRows=[];let offset=0;
    for(const e of children){
      if(e.id===0x1C53BB6B)continue;
      let part=e.id===0x1549A966?newInfo:data.slice(e.start,e.end);
      if(e.id===0x1F43B675){let q=e.dataStart,clusterTime=0;while(q<e.end){const x=parseElement(data,q,e.end);if(!x)break;if(x.id===0xE7)clusterTime=readUInt(data,x.dataStart,x.end);q=x.end;}cueRows.push({time:clusterTime,position:offset});}
      segmentParts.push(part);offset+=part.length;
    }
    if(cueRows.length>1){const points=cueRows.map(row=>{const trackPos=makeElement(0xB7,joinBytes([makeElement(0xF7,uintBytes(trackNumber)),makeElement(0xF1,uintBytes(row.position))]));return makeElement(0xBB,joinBytes([makeElement(0xB3,uintBytes(row.time)),trackPos]));});segmentParts.push(makeElement(0x1C53BB6B,joinBytes(points)));}
    const payload=joinBytes(segmentParts),segmentId=data.slice(segment.start,segment.start+segment.idLength);
    let sizePart;if(segment.unknown)sizePart=data.slice(segment.start+segment.idLength,segment.dataStart);else sizePart=encodeSize(payload.length);
    const newSegment=joinBytes([segmentId,sizePart,payload]);const prefix=data.slice(0,segment.start);const suffix=data.slice(segment.end);
    return new Blob([prefix,newSegment,suffix],{type:input.type});
  }catch(err){console.warn('Meet Notebook: WebM index repair skipped.',err);return new Blob([input],{type:input.type});}
}
async function start(msg){
  if(recorder&&recorder.state!=='inactive')throw new Error('Recorder is already active.');
  sessionId=msg.sessionId;chunkIndex=0;chunkWrites=[];activeElapsedMs=0;segmentStartedAt=0;
  baseMicGain=clamp(Number(msg.micGain)||2,.5,5);autoGain=msg.autoGain!==false;enhanceMic=msg.enhanceMic!==false;
  const preset=PRESETS[msg.quality]||PRESETS.high;
  tabStream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:msg.streamId}},video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:msg.streamId}}});
  const video=tabStream.getVideoTracks()[0];if(!video)throw new Error('Meet did not provide a video track.');video.contentHint='detail';
  try{await video.applyConstraints({width:{ideal:preset.width},height:{ideal:preset.height},frameRate:{ideal:30,max:30}});}catch(e){console.warn('Meet Notebook: capture constraints were not accepted.',e);}
  let micOk=true;const micAudio={echoCancellation:true,noiseSuppression:enhanceMic,autoGainControl:true,channelCount:1};try{micStream=await navigator.mediaDevices.getUserMedia({audio:{...micAudio,...(msg.micDeviceId?{deviceId:{exact:msg.micDeviceId}}:{})}});}catch(firstError){if(msg.micDeviceId){try{micStream=await navigator.mediaDevices.getUserMedia({audio:micAudio});}catch(e){micOk=false;console.warn('Meet Notebook: microphone unavailable.',e);}}else{micOk=false;console.warn('Meet Notebook: microphone unavailable.',firstError);}}
  audioContext=new AudioContext({sampleRate:48000});await audioContext.resume();
  const destination=audioContext.createMediaStreamDestination(),mixBus=audioContext.createGain(),limiter=audioContext.createDynamicsCompressor();
  limiter.threshold.value=-8;limiter.knee.value=8;limiter.ratio.value=10;limiter.attack.value=.003;limiter.release.value=.22;
  const tabSource=audioContext.createMediaStreamSource(tabStream),tabGain=audioContext.createGain();tabGain.gain.value=.9;tabSource.connect(tabGain);tabGain.connect(mixBus);tabGain.connect(audioContext.destination);
  tabAnalyser=audioContext.createAnalyser();tabAnalyser.fftSize=512;tabGain.connect(tabAnalyser);tabData=new Float32Array(tabAnalyser.fftSize);
  if(micStream){
    const micSource=audioContext.createMediaStreamSource(micStream),highpass=audioContext.createBiquadFilter(),lowpass=audioContext.createBiquadFilter(),micComp=audioContext.createDynamicsCompressor();
    highpass.type='highpass';highpass.frequency.value=enhanceMic?85:45;highpass.Q.value=.7;
    lowpass.type='lowpass';lowpass.frequency.value=enhanceMic?9500:18000;
    micComp.threshold.value=-28;micComp.knee.value=18;micComp.ratio.value=3.5;micComp.attack.value=.006;micComp.release.value=.24;
    micGainNode=audioContext.createGain();micGainNode.gain.value=baseMicGain;
    micAnalyser=audioContext.createAnalyser();micAnalyser.fftSize=512;micData=new Float32Array(micAnalyser.fftSize);
    micSource.connect(highpass);highpass.connect(lowpass);lowpass.connect(micComp);micComp.connect(micGainNode);micGainNode.connect(mixBus);micSource.connect(micAnalyser);
  }else{micGainNode=null;micAnalyser=null;micData=null;}
  mixBus.connect(limiter);limiter.connect(destination);
  levelTimer=setInterval(monitorLevels,200);
  const output=new MediaStream([video,...destination.stream.getAudioTracks()]),mimeType=supportedMime();
  recorder=new MediaRecorder(output,{mimeType,videoBitsPerSecond:preset.bitrate,audioBitsPerSecond:192000});
  recorder.ondataavailable=e=>{if(e.data&&e.data.size){const index=chunkIndex++;const task=saveChunk(e.data,index);chunkWrites.push(task);task.catch(err=>console.error('Chunk persistence failed',err));}};
  recorder.onerror=e=>console.error('MediaRecorder error',e.error);
  recorder.onstop=async()=>{const durationMs=Math.max(0,activeElapsedMs);try{await Promise.all(chunkWrites);const chunks=await readChunks();if(!chunks.length)throw new Error('No media chunks were saved.');let blob=new Blob(chunks.map(x=>x.blob),{type:chunks[0].type||mimeType});if(blob.type.includes('webm'))blob=await repairWebm(blob,durationMs);await saveVideo(blob);await clearChunks();videoUrl=URL.createObjectURL(blob);const result=await chrome.runtime.sendMessage({type:'VIDEO_READY',sessionId,mimeType:blob.type,url:videoUrl,size:blob.size,durationMs});if(!result||!result.ok)throw new Error(result&&result.error||'Video download failed.');}catch(err){chrome.runtime.sendMessage({type:'RECORDING_ERROR',sessionId,error:err.message}).catch(()=>{});}finally{cleanup();}};
  recorder.start(1000);segmentStartedAt=performance.now();
  video.addEventListener('ended',()=>{if(recorder&&recorder.state!=='inactive'){if(recorder.state==='recording'&&segmentStartedAt)activeElapsedMs+=performance.now()-segmentStartedAt;segmentStartedAt=0;recorder.stop();}},{once:true});
  return {ok:true,micOk,mimeType,micGain:baseMicGain};
}
function cleanup(){clearInterval(levelTimer);levelTimer=null;[tabStream,micStream].filter(Boolean).forEach(s=>s.getTracks().forEach(t=>t.stop()));tabStream=null;micStream=null;audioContext?.close();audioContext=null;recorder=null;micGainNode=null;micAnalyser=null;tabAnalyser=null;micData=null;tabData=null;sessionId=null;chunkWrites=[];segmentStartedAt=0;chrome.runtime.sendMessage({type:'AUDIO_LEVELS',mic:0,tab:0}).catch(()=>{});}
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg.target!=='offscreen')return;(async()=>{try{
  if(msg.type==='START')reply(await start(msg));
  else if(msg.type==='STOP'){if(recorder&&recorder.state!=='inactive'){if(recorder.state==='recording'&&segmentStartedAt)activeElapsedMs+=performance.now()-segmentStartedAt;segmentStartedAt=0;recorder.stop();}reply({ok:true});}
  else if(msg.type==='PAUSE'){if(recorder&&recorder.state==='recording'){if(segmentStartedAt)activeElapsedMs+=performance.now()-segmentStartedAt;segmentStartedAt=0;recorder.pause();}reply({ok:true});}
  else if(msg.type==='RESUME'){if(recorder&&recorder.state==='paused'){recorder.resume();segmentStartedAt=performance.now();}reply({ok:true});}
  else if(msg.type==='REVOKE_URL'){if(msg.url)URL.revokeObjectURL(msg.url);reply({ok:true});}
  else reply({ok:false,error:'Unknown offscreen operation.'});
}catch(e){reply({ok:false,error:e.message||String(e)});}})();return true;});
