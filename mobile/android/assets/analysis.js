/* Explicit, immutable input snapshots. Provider credentials and paths never travel here. */
(function(root){
  'use strict';
  const statuses=['queued','running','completed','failed','cancelled'];
  function validate(id,row){
    if(!/^[a-zA-Z0-9-]{1,100}$/.test(id)||!row||!['codex','claude'].includes(row.provider)||
      !statuses.includes(row.status)||row.effort!=='xhigh')throw Error('Invalid analysis request');
    for(const [key,max] of Object.entries({title:200,createdAt:40,instructions:4000,source:200000,result:1000000,error:4000,model:200}))
      if(typeof row[key]!=='string'||row[key].length>max)throw Error('Invalid analysis field: '+key);
    if(!row.source.trim()||!Number.isFinite(Date.parse(row.createdAt)))throw Error('Invalid analysis snapshot');
    return row;
  }
  function clean(text){return String(text||'').replace(/!\[[^\]]*\]\([^)]*\)/g,'[图片未发送 / image not shared]').replace(/[\uE000-\uF8FF]/g,'[图片未发送 / image not shared]');}
  function create(provider,title,sources,instructions=''){
    if(!sources.length)throw Error('所选范围没有文字记录 / No text in the selected scope');
    const source=sources.map(s=>'## '+String(s.label).replace(/[\r\n]/g,' ')+' ['+s.key+']\n\n'+clean(s.text)).join('\n\n');
    const id=crypto.randomUUID(),row={provider,title,createdAt:new Date().toISOString(),instructions,source,status:'queued',effort:'xhigh',model:'',result:'',error:''};
    validate(id,row);return {id,row};
  }
  function exportText(row){return '# '+row.title+'\n\n'+row.provider+' · '+(row.model||'等待执行 / pending')+' · '+row.effort+'\n'+row.createdAt+'\n\n'+(row.result||row.error||row.status)+'\n\n---\n\n# 来源快照 / Source snapshot\n\n'+row.source;}
  const api={validate,create,clean,exportText};root.ScheduleAnalysis=api;if(typeof module!=='undefined')module.exports=api;
})(globalThis);
