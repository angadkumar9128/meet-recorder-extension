(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MeetNotebookTranscript=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const words=s=>String(s||'').trim().split(/\s+/).filter(Boolean);
  const token=s=>String(s||'').toLocaleLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}]/gu,'');
  const norm=s=>words(s).map(token).filter(Boolean);
  function mergeRollingText(oldText,newText,tailWindow=8){
    const a=words(oldText),b=words(newText);if(!a.length)return b.join(' ');if(!b.length)return a.join(' ');
    const an=a.map(token),bn=b.map(token);
    if(an.join('|')===bn.join('|'))return a.join(' ');
    if(bn.length>=an.length&&an.every((w,i)=>w===bn[i]))return b.join(' ');
    if(an.length>=bn.length&&bn.every((w,i)=>w===an[i]))return a.join(' ');
    if(bn.length<=an.length){
      for(let i=0;i<=an.length-bn.length;i++)if(an.slice(i,i+bn.length).join('|')===bn.join('|'))return a.join(' ');
    }
    let overlap=0;
    for(let k=Math.min(an.length,bn.length);k>0;k--){
      if(an.slice(-k).join('|')===bn.slice(0,k).join('|')){overlap=k;break;}
    }
    if(overlap)return a.slice(0,a.length-overlap).concat(b).join(' ');
    let prefix=0;
    while(prefix<an.length&&prefix<bn.length&&an[prefix]===bn[prefix])prefix++;
    // Meet may replace a live caption card with a longer cumulative snapshot.
    // When most of both strings is the same prefix, treat the changed tail as
    // a correction/update rather than appending the entire new snapshot again.
    const sharedRatio=prefix/Math.max(1,Math.min(an.length,bn.length));
    if(prefix>=2&&sharedRatio>=0.55)return a.slice(0,prefix).concat(b.slice(prefix)).join(' ');
    return a.concat(b).join(' ');
  }
  function isRollingUpdate(oldText,newText){
    const a=norm(oldText),b=norm(newText);
    if(!a.length||!b.length)return false;
    if(a.join('|')===b.join('|'))return true;
    if(a.length<=b.length&&a.every((word,i)=>word===b[i]))return true;
    if(b.length<=a.length&&b.every((word,i)=>word===a[i]))return true;
    for(let k=Math.min(a.length,b.length);k>=2;k--){
      if(a.slice(-k).join('|')===b.slice(0,k).join('|'))return true;
    }
    let prefix=0;
    while(prefix<a.length&&prefix<b.length&&a[prefix]===b[prefix])prefix++;
    return prefix>=2&&prefix/Math.max(1,Math.min(a.length,b.length))>=0.55;
  }
  function buildTurns(entries,configuredName){
    const turns=[],audioTurns=new WeakSet();
    for(const e of entries||[]){
      if(e.suppressedByMeet||e.echo)continue;
      let name=String(e&&e.speaker||'').trim();
      if(/^you$/i.test(name))name=configuredName||'You';
      const text=String(e&&e.text||'').replace(/\s+/g,' ').trim();
      if(!name||!text)continue;
      const last=turns[turns.length-1];
      if(last&&last.name.toLowerCase()===name.toLowerCase()){if(audioTurns.has(last)||e.source==='local-asr'){last.text+=' '+text;audioTurns.add(last);}else last.text=mergeRollingText(last.text,text);}
      else{const turn={name,text,t:Math.max(0,Number(e.t)||0)};turns.push(turn);if(e.source==='local-asr')audioTurns.add(turn);}
    }
    return turns;
  }
  function formatPlainText(entries,configuredName){
    const turns=buildTurns(entries,configuredName);
    const clean=value=>String(value||'').replace(/\r\n?/g,' ').replace(/[ \t]+/g,' ').replace(/\s+/g,' ').trim();
    return turns.map(turn=>clean(turn.name)+' - '+clean(turn.text)).join('\n\n')+'\n';
  }

  // Merge cumulative/repeated local-ASR snapshots from recognizer restarts.
  // Only compare nearby local-ASR segments; Meet captions and notes remain untouched.
  // Conservative local-ASR deduplication: merge only strong rolling evidence.
  // Similar openings alone are retained to avoid silently discarding real speech.
  function mergeRecentSpeechEntry(entries,entry,windowSeconds=12){
    const incoming=norm(entry&&entry.text);if(!incoming.length)return {merged:false,duplicate:false};
    const incomingTime=Math.max(0,Number(entry.t)||0);
    for(let i=(entries||[]).length-1,checked=0;i>=0&&checked<30;i--){
      const previous=entries[i];if(!previous||previous.source!=='local-asr')continue;checked++;
      const previousTime=Math.max(0,Number(previous.t)||0),previousUpdateTime=Math.max(0,Number(previous.lastAsrAt??previous.t)||0);
      const delta=Math.abs(incomingTime-previousUpdateTime);if(delta>windowSeconds)continue;
      const existing=norm(previous.text);if(!existing.length)continue;
      const same=(x,y)=>x.length===y.length&&x.every((w,j)=>w===y[j]);
      const startsWith=(x,y)=>x.length>=y.length&&y.every((w,j)=>x[j]===w);
      if(same(existing,incoming)&&delta<=3){previous.lastAsrAt=Math.max(previousUpdateTime,incomingTime);previous.updatedAt=Date.now();return {merged:true,duplicate:true,index:i};}
      if(same(existing,incoming))continue;
      const incomingExtends=incoming.length>existing.length&&existing.length>=6&&startsWith(incoming,existing);
      const previousExtends=existing.length>incoming.length&&incoming.length>=6&&startsWith(existing,incoming)&&delta<=5;
      if(incomingExtends||previousExtends){
        if(incomingExtends)previous.text=String(entry.text||'').trim();
        previous.t=Math.min(previousTime,incomingTime);previous.lastAsrAt=incomingTime;previous.updatedAt=Date.now();
        if(incomingExtends){if(entry.partial)previous.partial=true;else delete previous.partial;}
        return {merged:true,duplicate:false,index:i};
      }
      let overlap=0;for(let k=Math.min(existing.length,incoming.length);k>=5;k--){if(existing.slice(-k).join('|')===incoming.slice(0,k).join('|')){overlap=k;break;}}
      if(overlap){previous.text=words(previous.text).concat(words(entry.text).slice(overlap)).join(' ');previous.t=Math.min(previousTime,incomingTime);previous.lastAsrAt=incomingTime;previous.updatedAt=Date.now();if(!entry.partial)delete previous.partial;return {merged:true,duplicate:false,index:i};}
    }
    entries.push(entry);return {merged:false,duplicate:false,index:entries.length-1};
  }
  function upsertById(existing,incoming,source='meet'){const rows=(existing||[]).map(e=>({...e}));for(const raw of incoming||[]){const e={...raw,source:raw.source||source};if(e.id){const i=rows.findIndex(x=>x.id===e.id);if(i>=0)rows[i]={...rows[i],...e};else rows.push(e);}else rows.push(e);}return rows.sort((a,b)=>(Number(a.t)||0)-(Number(b.t)||0)||(Number(a.at)||0)-(Number(b.at)||0));}
  function resolveSpeaker(e,samples,options={}){if(e.channel==='mic')return options.myName||'You';const start=Number(e.at)||0,end=Math.max(start,Number(e.endAt)||start),mid=start&&end>=start?(start+end)/2:start,self=new Set([String(options.myName||'You').toLowerCase(),'you','your microphone']),candidates=[];for(const s of samples||[]){const name=String(s.speaker||'').trim();if(!name||self.has(name.toLowerCase()))continue;const at=Number(s.at)||0,distance=Math.abs(at-mid);if(at>=start-1200&&at<=end+1800)candidates.push({name,at,distance});}candidates.sort((a,b)=>a.distance-b.distance);if(!candidates.length||candidates[0].distance>2800)return 'Unattributed audio';const nearest=candidates[0],other=candidates.find(x=>x.name.toLowerCase()!==nearest.name.toLowerCase());if(other&&other.distance-nearest.distance<350)return 'Unattributed audio';return nearest.name;}
  function pairCounts(text){const w=norm(text),a=[];for(let i=1;i<w.length;i++)a.push(w[i-1]+'|'+w[i]);return a;}
  function coverageRatio(a,b){const pairs=pairCounts(a);if(!pairs.length)return 0;const counts=new Map();for(const p of pairCounts(b))counts.set(p,(counts.get(p)||0)+1);let hit=0;for(const p of pairs){const n=counts.get(p)||0;if(n){hit++;counts.set(p,n-1);}}return hit/pairs.length;}
  function shouldSuppressAsr(e,captions){return (captions||[]).some(m=>String(m.speaker||'').toLowerCase()===String(e.speaker||'').toLowerCase()&&Math.abs((Number(m.t)||0)-(Number(e.t)||0))<=10&&coverageRatio(e.text,m.text)>=.5);}
  function isMicEcho(e,others){return (others||[]).some(o=>o.source==='local-asr'&&o.channel==='tab'&&Math.abs((Number(o.t)||0)-(Number(e.t)||0))<=6&&coverageRatio(e.text,o.text)>=.7);}
  function mergeAdjacentTurns(entries,configuredName){const out=[];for(const e of entries||[]){const name=String(e.speaker||'Remote participant').trim(),text=String(e.text||'').replace(/\s+/g,' ').trim();if(!text)continue;const last=out[out.length-1];if(last&&last.name.toLowerCase()===name.toLowerCase()){last.text=e.source==='local-asr'||last.source==='local-asr'?last.text+' '+text:mergeRollingText(last.text,text);last.endAt=e.endAt||last.endAt;}else out.push({name:/^you$/i.test(name)?(configuredName||'You'):name,text,t:Number(e.t)||0,endAt:e.endAt,source:e.source,committed:e.committed,partial:e.partial});}return out;}
  function parseCaptionLines(lines,metadataSpeaker=''){const clean=(lines||[]).map(v=>String(v||'').trim()).filter(Boolean);const valid=v=>!!v&&v.length<=80&&v.split(/\s+/).length<=8&&!/[.!?。！？]$/.test(v)&&!/^(jump to bottom|caption settings|settings|captions?|you|remote participant|unattributed audio)$/i.test(v);let speaker=valid(String(metadataSpeaker||'').trim())?String(metadataSpeaker).trim():'',text='';if(speaker)text=clean.filter(v=>v!==speaker).join(' ').trim();else if(clean.length>=2&&valid(clean[0])){speaker=clean[0].replace(/\s*\(you\)\s*$/i,'').trim();text=clean.slice(1).join(' ').trim();}else if(clean.length===1){const match=clean[0].match(/^([^:—-]{1,80})\s*[:—-]\s*(.{2,})$/);if(match&&valid(match[1].trim())){speaker=match[1].trim();text=match[2].trim();}}if(!speaker||!text)return null;return{speaker,text:text.replace(/\s+/g,' ').trim()};}
  return {mergeRollingText,isRollingUpdate,mergeRecentSpeechEntry,buildTurns,formatPlainText,parseCaptionLines,upsertById,resolveSpeaker,coverageRatio,shouldSuppressAsr,isMicEcho,mergeAdjacentTurns};
});