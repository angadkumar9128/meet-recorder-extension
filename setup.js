const $=id=>document.getElementById(id);
let stream=null,context=null,analyser=null,data=null,frame=0;
function stop(){if(frame)cancelAnimationFrame(frame);frame=0;stream?.getTracks().forEach(t=>t.stop());stream=null;context?.close();context=null;analyser=null;data=null;$('stop').disabled=true;$('start').disabled=false;$('level').value=0;}
async function listDevices(){const saved=await chrome.storage.local.get('micDeviceId');const devices=await navigator.mediaDevices.enumerateDevices();const inputs=devices.filter(d=>d.kind==='audioinput');$('device').replaceChildren();const def=document.createElement('option');def.value='';def.textContent='Default microphone';$('device').append(def);for(const d of inputs){const o=document.createElement('option');o.value=d.deviceId;o.textContent=d.label||('Microphone '+( $('device').length));$('device').append(o);}if(saved.micDeviceId&&inputs.some(d=>d.deviceId===saved.micDeviceId))$('device').value=saved.micDeviceId;}
async function start(){
  stop();
  try{
    const id=$('device').value;const constraints={audio:{...(id?{deviceId:{exact:id}}:{}),echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}};
    stream=await navigator.mediaDevices.getUserMedia(constraints);const track=stream.getAudioTracks()[0];const settings=track.getSettings();
    await chrome.storage.local.set({micDeviceId:settings.deviceId||id||null,micDeviceLabel:track.label||'Default microphone',micGain:Number($('gain').value)});
    await listDevices();if(settings.deviceId)$('device').value=settings.deviceId;
    context=new AudioContext();await context.resume();const source=context.createMediaStreamSource(stream);analyser=context.createAnalyser();analyser.fftSize=1024;source.connect(analyser);data=new Float32Array(analyser.fftSize);
    $('result').textContent='Microphone connected: '+(track.label||'input device')+'. Speak normally to test the level.';$('start').disabled=true;$('stop').disabled=false;
    const tick=()=>{if(!analyser||!data)return;analyser.getFloatTimeDomainData(data);let sum=0;for(let i=0;i<data.length;i++)sum+=data[i]*data[i];const level=Math.sqrt(sum/data.length);$('level').value=Math.min(1,level*7);frame=requestAnimationFrame(tick);};tick();
  }catch(e){stop();$('result').textContent='Microphone access failed: '+(e.message||String(e))+'. Check Chrome site permissions and select a connected microphone.';}
}
$('gain').oninput=async()=>{$('gainValue').textContent=Number($('gain').value).toFixed(1)+'×';await chrome.storage.local.set({micGain:Number($('gain').value)});};
$('device').onchange=async()=>{await chrome.storage.local.set({micDeviceId:$('device').value||null});if(stream)await start();};
$('start').onclick=start;$('stop').onclick=()=>{$('result').textContent='Microphone test stopped.';stop();};
navigator.mediaDevices.addEventListener?.('devicechange',()=>listDevices().catch(()=>{}));
listDevices().catch(()=>{});
window.addEventListener('pagehide',stop);
