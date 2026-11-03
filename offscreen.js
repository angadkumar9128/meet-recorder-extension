// Capture is isolated from the Meet page. Chunks are persisted to IndexedDB every second.
let recorder=null,tabStream=null,micStream=null,audioContext=null,sessionId=null,chunkIndex=0,chunkWrites=[],videoUrl=null;
const PRESETS={standard:{width:1280,height:720,bitrate:4000000},high:{width:1920,height:1080,bitrate:8000000},saver:{width:1280,height:720,bitrate:2000000}};
function openDb(){return new Promise((resolve,reject)=>{const r=indexedDB.open('meet-notebook-media',1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('chunks'))r.result.createObjectStore('chunks',{keyPath:['sessionId','index']});};r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});}
async function saveChunk(blob,index){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readwrite');tx.objectStore('chunks').put({sessionId,index,blob,type:blob.type});tx.oncomplete=()=>{db.close();resolve();};tx.onerror=()=>{db.close();reject(tx.error);};});}
async function readChunks(){const db=await openDb();return new Promise((resolve,reject)=>{const tx=db.transaction('chunks','readonly');const r=tx.objectStore('chunks').getAll();r.onsuccess=()=>resolve(r.result.filter(x=>x.sessionId===sessionId).sort((a,b)=>a.index-b.index));r.onerror=()=>reject(r.error);tx.oncomplete=()=>db.close();});}
async function clearChunks(){const db=await openDb();return new Promise(resolve=>{const tx=db.transaction('chunks','readwrite');const store=tx.objectStore('chunks');const r=store.openCursor();r.onsuccess=()=>{const c=r.result;if(!c)return;if(c.value.sessionId===sessionId)c.delete();c.continue();};tx.oncomplete=()=>{db.close();resolve();};});}
function supportedMime(){const mp4='video/mp4;codecs=avc1.640028,mp4a.40.2';if(MediaRecorder.isTypeSupported(mp4))return mp4;const vp8='video/webm;codecs=vp8,opus';return MediaRecorder.isTypeSupported(vp8)?vp8:'video/webm';}
async function start(msg){
 if(recorder&&recorder.state!=='inactive')throw new Error('Recorder is already active.');
 sessionId=msg.sessionId;chunkIndex=0;chunkWrites=[];
 const preset=PRESETS[msg.quality]||PRESETS.high;
 tabStream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:msg.streamId}},video:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:msg.streamId}}});
 const video=tabStream.getVideoTracks()[0];if(!video)throw new Error('Meet did not provide a video track.');video.contentHint='detail';
 try{await video.applyConstraints({width:{exact:preset.width},height:{exact:preset.height},frameRate:{min:30,max:30}});}catch(e){console.warn('Meet Notebook: browser did not accept fixed video constraints.',e);}
 let micOk=true;try{micStream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}catch{micOk=false;}
 audioContext=new AudioContext({sampleRate:48000});await audioContext.resume();
 const destination=audioContext.createMediaStreamDestination();const limiter=audioContext.createDynamicsCompressor();limiter.threshold.value=-6;limiter.knee.value=3;limiter.ratio.value=12;limiter.attack.value=.003;limiter.release.value=.25;
 const tabSource=audioContext.createMediaStreamSource(tabStream);const tabGain=audioContext.createGain();tabGain.gain.value=.8;tabSource.connect(tabGain);tabGain.connect(limiter);tabGain.connect(audioContext.destination);
 if(micStream){const micSource=audioContext.createMediaStreamSource(micStream);const micGain=audioContext.createGain();micGain.gain.value=.8;micSource.connect(micGain);micGain.connect(limiter);}
 limiter.connect(destination);
 const output=new MediaStream([video,...destination.stream.getAudioTracks()]);const mimeType=supportedMime();
 recorder=new MediaRecorder(output,{mimeType,videoBitsPerSecond:preset.bitrate,audioBitsPerSecond:192000});
 recorder.ondataavailable=e=>{if(e.data&&e.data.size){const index=chunkIndex++;const p=saveChunk(e.data,index);chunkWrites.push(p);p.catch(err=>console.error('Chunk persistence failed',err));}};
 recorder.onerror=e=>console.error('MediaRecorder error',e.error);
 recorder.onstop=async()=>{try{await Promise.all(chunkWrites);const chunks=await readChunks();if(!chunks.length)throw new Error('No media chunks were saved.');const blob=new Blob(chunks.map(x=>x.blob),{type:chunks[0].type||mimeType});videoUrl=URL.createObjectURL(blob);const result=await chrome.runtime.sendMessage({type:'VIDEO_READY',sessionId,mimeType:blob.type,url:videoUrl,size:blob.size});if(!result||!result.ok)throw new Error(result&&result.error||'Video download failed.');await clearChunks();}catch(err){chrome.runtime.sendMessage({type:'RECORDING_ERROR',sessionId,error:err.message}).catch(()=>{});}finally{cleanup();}};
 recorder.start(1000);video.addEventListener('ended',()=>{if(recorder&&recorder.state!=='inactive')recorder.stop();},{once:true});
 return {ok:true,micOk,mimeType};
}
function cleanup(){[tabStream,micStream].filter(Boolean).forEach(s=>s.getTracks().forEach(t=>t.stop()));tabStream=null;micStream=null;audioContext?.close();audioContext=null;recorder=null;sessionId=null;chunkWrites=[];}
chrome.runtime.onMessage.addListener((msg,_sender,reply)=>{if(msg.target!=='offscreen')return;(async()=>{try{if(msg.type==='START')reply(await start(msg));else if(msg.type==='STOP'){if(recorder&&recorder.state!=='inactive')recorder.stop();reply({ok:true});}else if(msg.type==='PAUSE'){if(recorder&&recorder.state==='recording')recorder.pause();reply({ok:true});}else if(msg.type==='RESUME'){if(recorder&&recorder.state==='paused')recorder.resume();reply({ok:true});}else if(msg.type==='REVOKE_URL'){if(msg.url)URL.revokeObjectURL(msg.url);reply({ok:true});}else reply({ok:false,error:'Unknown offscreen operation.'});}catch(e){reply({ok:false,error:e.message||String(e)});}})();return true;});