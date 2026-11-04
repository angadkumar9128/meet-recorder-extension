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
    const turns=[];
    for(const e of entries||[]){
      let name=String(e&&e.speaker||'').trim();
      if(/^you$/i.test(name))name=configuredName||'You';
      const text=String(e&&e.text||'').replace(/\s+/g,' ').trim();
      if(!name||!text)continue;
      const last=turns[turns.length-1];
      if(last&&last.name.toLowerCase()===name.toLowerCase())last.text=mergeRollingText(last.text,text);
      else turns.push({name,text,t:Math.max(0,Number(e.t)||0)});
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
      const incomingExtends=existing.length>=6&&startsWith(incoming,existing);
      const previousExtends=incoming.length>=6&&startsWith(existing,incoming)&&delta<=5;
      if(incomingExtends||previousExtends){
        if(incomingExtends)previous.text=String(entry.text||'').trim();
        previous.t=Math.min(previousTime,incomingTime);previous.lastAsrAt=incomingTime;previous.updatedAt=Date.now();
        if(entry.partial)previous.partial=true;else delete previous.partial;
        return {merged:true,duplicate:false,index:i};
      }
      let overlap=0;for(let k=Math.min(existing.length,incoming.length);k>=5;k--){if(existing.slice(-k).join('|')===incoming.slice(0,k).join('|')){overlap=k;break;}}
      if(overlap){previous.text=words(previous.text).concat(words(entry.text).slice(overlap)).join(' ');previous.t=Math.min(previousTime,incomingTime);previous.lastAsrAt=incomingTime;previous.updatedAt=Date.now();if(!entry.partial)delete previous.partial;return {merged:true,duplicate:false,index:i};}
    }
    entries.push(entry);return {merged:false,duplicate:false,index:entries.length-1};
  }
  return {mergeRollingText,isRollingUpdate,mergeRecentSpeechEntry,buildTurns,formatPlainText};
});