(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;root.MeetNotebookTranscript=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const words=s=>String(s||'').trim().split(/\s+/).filter(Boolean);
  const norm=s=>String(s||'').toLocaleLowerCase().normalize('NFKC').replace(/[\p{P}\p{S}]/gu,'').split(/\s+/).filter(Boolean);
  function mergeRollingText(oldText,newText,tailWindow=8){
    const a=words(oldText),b=words(newText);if(!a.length)return b.join(' ');if(!b.length)return a.join(' ');
    const an=a.map(x=>norm(x)[0]||''),bn=b.map(x=>norm(x)[0]||'');let prefix=0;
    while(prefix<an.length&&prefix<bn.length&&an[prefix]===bn[prefix])prefix++;
    if(prefix===an.length&&bn.length>=an.length)return b.join(' ');
    let overlap=0;for(let k=Math.min(an.length,bn.length);k>0;k--){if(an.slice(-k).join('|')===bn.slice(0,k).join('|')){overlap=k;break;}}
    if(overlap){if(overlap===b.length)return a.join(' ');return a.slice(0,a.length-overlap).concat(b).join(' ');}
    const keep=Math.max(1,a.length-tailWindow);
    if(prefix>=keep&&prefix>0&&b.length>=prefix)return a.slice(0,prefix).concat(b.slice(prefix)).join(' ');
    if(bn.length<=an.length&&an.join('|').includes(bn.join('|')))return a.join(' ');
    return a.concat(b).join(' ');
  }
  function buildTurns(entries,configuredName){
    const turns=[];for(const e of entries||[]){let name=String(e&&e.speaker||'').trim();if(/^you$/i.test(name))name=configuredName||'You';const text=String(e&&e.text||'').replace(/\s+/g,' ').trim();if(!name||!text)continue;const last=turns[turns.length-1];if(last&&last.name.toLowerCase()===name.toLowerCase())last.text=mergeRollingText(last.text,text);else turns.push({name,text,t:Math.max(0,Number(e.t)||0)});}return turns;
  }
  function formatPlainText(entries,configuredName){
    const turns=buildTurns(entries,configuredName);
    const clean=value=>String(value||'').replace(/\r\n?/g,' ').replace(/[ \t]+/g,' ').replace(/\s+/g,' ').trim();
    return turns.map(turn=>clean(turn.name)+' - '+clean(turn.text)).join('\n\n')+'\n';
  }
  return {mergeRollingText,buildTurns,formatPlainText};
});