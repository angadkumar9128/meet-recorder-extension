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
    const replaceThreshold=Math.max(1,Math.min(an.length,bn.length)-tailWindow);
    if(prefix>=replaceThreshold&&prefix>0)return a.slice(0,prefix).concat(b.slice(prefix)).join(' ');
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
    return prefix>=2&&Math.min(a.length,b.length)-prefix<=3;
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
  return {mergeRollingText,isRollingUpdate,buildTurns,formatPlainText};
});