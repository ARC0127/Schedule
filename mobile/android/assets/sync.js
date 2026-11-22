/* Shared by Windows and Android. Plain records only; no clocks decide conflicts. */
(function (root) {
  'use strict';
  const copy = value => JSON.parse(JSON.stringify(value));
  const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
  const dict = () => Object.create(null);
  const stable = value => JSON.stringify(value, function (_, item) {
    if (item && !Array.isArray(item) && typeof item === 'object')
      return Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]));
    return item;
  });
  const same = (a, b) => stable(a ?? null) === stable(b ?? null);
  const idOK = id => typeof id === 'string' && /^[a-zA-Z0-9-]{1,100}$/.test(id);
  const dateOK = date => typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    !Number.isNaN(Date.parse(date)) && new Date(date).toISOString().slice(0,10) === date;
  const assetPattern = /schedule-image:([a-f0-9]{64}\.(?:png|jpeg|gif|webp|avif|bmp|heic|heif))/g;
  const fail = message => { throw Error('同步数据无效 / Invalid sync data: ' + message); };
  function validate(entities) {
    if (!entities || typeof entities !== 'object' || Array.isArray(entities) || Object.keys(entities).length > 30000) fail('entities');
    for (const [key, value] of Object.entries(entities)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) fail(key);
      const [kind, ...parts] = key.split('/');
      if (kind === 'project') {
        if (parts.length !== 1 || !idOK(parts[0]) || typeof value.name !== 'string' || !value.name.trim() || value.name.length > 100) fail(key);
      } else if (kind === 'note' || kind === 'idea') {
        if (parts.length !== 1 || (kind === 'note' ? !dateOK(parts[0]) : !idOK(parts[0])) ||
            !dateOK(value.date) || (kind === 'note' && parts[0] !== value.date) || typeof value.text !== 'string' || value.text.length > 2000000 ||
            typeof value.important !== 'boolean' || !Array.isArray(value.formats)) fail(key);
        if (kind === 'note' && typeof value.title !== 'string') fail(key);
        if (kind === 'idea' && (!['note','todo','done'].includes(value.state) || !Array.isArray(value.projects) ||
            value.projects.some(id => !idOK(id)) || (value.due !== '' && !dateOK(value.due)) || !Number.isFinite(value.order))) fail(key);
      } else if (kind === 'event') {
        if (parts.length !== 2 || !dateOK(parts[0]) || !idOK(parts[1]) || value.key !== parts.join('/') ||
            typeof value.title !== 'string' || !value.title.trim() || value.title.length > 100 || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value.time) ||
            !Number.isSafeInteger(value.at) || ![-1,0,5,15,30,60].includes(value.minutes) ||
            ['done','important','locked'].some(field => typeof value[field] !== 'boolean')) fail(key);
      } else fail(key);
    }
    return entities;
  }
  function merge(base, desktop, phone) {
    [base, desktop, phone].forEach(validate);
    const merged = dict(), conflicts = dict();
    for (const key of new Set([...Object.keys(base), ...Object.keys(desktop), ...Object.keys(phone)])) {
      const b = base[key] ?? null, d = desktop[key] ?? null, p = phone[key] ?? null;
      let value;
      if (same(d,p)) value = d;
      else if ((d?.locked || b?.locked) && key.startsWith('event/')) {
        value = d;
        if (!same(b,p)) conflicts[key] = {base:b, desktop:d, phone:p};
      } else if (same(d,b)) value = p;
      else if (same(p,b)) value = d;
      else {value = d; conflicts[key] = {base:b, desktop:d, phone:p};}
      if (value !== null) merged[key] = copy(value);
    }
    // A concurrent idea can still refer to a deleted project. Keep that project
    // and expose the deletion conflict instead of silently removing its binding.
    for (const item of Object.values(merged)) for (const id of item.projects || []) {
      const key = 'project/' + id;
      if (!own(merged,key)) {
        const value = desktop[key] || phone[key] || base[key];
        if (!value) fail('missing project ' + id);
        merged[key] = copy(value);
        conflicts[key] = {base:base[key] ?? null, desktop:desktop[key] ?? null, phone:phone[key] ?? null};
      }
    }
    return {entities:merged, conflicts};
  }
  async function digest(bytes) {
    return [...new Uint8Array(await root.crypto.subtle.digest('SHA-256', bytes))].map(n=>n.toString(16).padStart(2,'0')).join('');
  }
  // A choice authorizes only the exact three versions the person reviewed.
  function resolveReview(merged, review, peer, versions = {}) {
    const result=copy(merged);
    if(!review?.approved || review.peer!==peer)return result;
    for(const [key,conflict] of Object.entries(merged.conflicts)) {
      const choice=review.decisions?.[key];
      if(!['desktop','phone'].includes(choice)||!same(conflict,review.conflicts?.[key]))continue;
      if(choice==='phone' && key.startsWith('event/') && (conflict.base?.locked||conflict.desktop?.locked))continue;
      const value=conflict[choice];
      if(value===null)delete result.entities[key];else result.entities[key]=copy(value);
      delete result.conflicts[key];
    }
    for(const item of Object.values(result.entities))for(const id of item.projects||[]) {
      const key='project/'+id;
      if(!own(result.entities,key)) {
        const conflict=merged.conflicts[key]||{base:versions.base?.[key]??null,desktop:versions.desktop?.[key]??null,phone:versions.phone?.[key]??null};
        const project=merged.entities[key]||conflict.desktop||conflict.phone||conflict.base;
        if(!project)fail('missing project '+id);
        const choice=review.decisions?.[key];
        const chosen=['desktop','phone'].includes(choice)&&same(conflict,review.conflicts?.[key])&&conflict[choice];
        result.entities[key]=copy(chosen||project);
        if(!chosen)result.conflicts[key]=copy(conflict);
      }
    }
    return result;
  }
  function bytes(data) {
    const raw = atob(data), out = new Uint8Array(raw.length);
    for(let i=0;i<raw.length;i++) out[i]=raw.charCodeAt(i);
    return out;
  }
  async function asset(dataURL, assets) {
    const external=/^https:\/\/schedule-images\.local\/([a-f0-9]{64}\.(?:png|jpeg|gif|webp|avif|bmp|heic|heif))$/.exec(dataURL);
    if(external){const id=external[1];assets[id]={ref:true,mime:'image/'+id.split('.').pop()};return id;}
    if(dataURL && typeof dataURL==='object' && dataURL.ref===true && /^[a-f0-9]{64}\.(png|jpeg|gif|webp|avif|bmp|heic|heif)$/.test(dataURL.id)){assets[dataURL.id]={ref:true,mime:'image/'+dataURL.id.split('.').pop()};return dataURL.id;}
    const match = /^data:image\/(png|jpeg|gif|webp|avif|bmp|heic|heif);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(dataURL);
    if (!match) fail('image encoding');
    const binary = bytes(match[2]);
    if (!binary.length || binary.length > 64*1024*1024) fail('image size');
    const id = await digest(binary) + '.' + match[1];
    assets[id] = {mime:'image/'+match[1], data:match[2].replace(/[\r\n]/g,'')};
    return id;
  }
  async function validateAssets(assets, entities) {
    if (!assets || Array.isArray(assets) || typeof assets !== 'object') fail('images');
    for (const [id, value] of Object.entries(assets)) {
      if(value.ref===true){if(!/^[a-f0-9]{64}\.(png|jpeg|gif|webp|avif|bmp|heic|heif)$/.test(id)||value.mime!=='image/'+id.split('.').pop())fail('image reference');continue;}
      const checked = dict();
      if (await asset('data:'+value.mime+';base64,'+value.data, checked) !== id) fail('image digest');
    }
    for (const item of Object.values(entities)) for (const match of (item.text || '').matchAll(assetPattern))
      if (!own(assets,match[1])) fail('missing image ' + match[1]);
  }
  // Map style endpoints through image-token expansion/contraction.
  function replaceText(text, formats, regex, transform) {
    const edits = [...text.matchAll(regex)].map(m=>({start:m.index,end:m.index+m[0].length,value:transform(m)}));
    const position = p => {
      let delta=0;
      for(const e of edits) {
        if(p<=e.start) break;
        if(p<e.end) return e.start+delta;
        delta+=e.value.length-(e.end-e.start);
      }
      return p+delta;
    };
    let next=text;
    for(const e of [...edits].reverse()) next=next.slice(0,e.start)+e.value+next.slice(e.end);
    return {text:next,formats:(formats||[]).map(f=>({...f,start:position(f.start),end:position(f.end)})).filter(f=>f.end>f.start)};
  }
  function sliceFormats(runs,start,end) {
    return (runs||[]).filter(r=>r.end>start&&r.start<end).map(r=>({...r,start:Math.max(start,r.start)-start,end:Math.min(end,r.end)-start}));
  }
  function editedFormats(before,after,runs) {
    let start=0,a=before.length,b=after.length;
    while(start<a&&start<b&&before[start]===after[start])start++;
    while(a>start&&b>start&&before[a-1]===after[b-1]){a--;b--;}
    const delta=b-a,result=[];
    for(const run of runs||[]) {
      if(run.start<start)result.push({...run,end:Math.min(run.end,start)});
      if(run.end>a)result.push({...run,start:Math.max(run.start,a)+delta,end:run.end+delta});
    }
    return result.filter(r=>r.end>r.start);
  }
  function quoteBullets(text,formats) {
    const lines=[];
    const result=replaceText(text,formats,/^•(?= |$)/gm,m=>{lines.push(text.slice(0,m.index).split('\n').length-1);return '  •';});
    return {...result,escape:lines.length?{text:result.text,lines}:null};
  }
  function unquoteBullets(content,escape) {
    if(!escape||escape.text!==content.text)return content;
    return replaceText(content.text,content.formats,/^  •(?= |$)/gm,m=>escape.lines.includes(content.text.slice(0,m.index).split('\n').length-1)?'•':m[0]);
  }
  function restoreSyncText(content, record, key) {
    const mapping=record.syncContent?.[key];
    return mapping&&same(content,mapping.stored)?copy(mapping.original):content;
  }
  async function desktopExport(records, projects, images) {
    const entities=dict(), assets=dict(), tokens=dict();
    const used=Object.values(records).map(r=>r.body||'').join('');
    for(const [token,value] of images) if(used.includes(token)) tokens[token]=await asset(value.src,assets);
    const encode = (text,formats) => replaceText(text,formats,/[\uE000-\uF8FF]/g,m=>{
      if(!tokens[m[0]])fail('missing desktop image');
      return '![image](schedule-image:'+tokens[m[0]]+')';
    });
    for(const p of projects) entities['project/'+p.id]={name:p.name};
    for(const [date,r] of Object.entries(records)) {
      const body=r.body||'', ranges=root.ScheduleContent.ideaRanges(body);
      const first=ranges.length?ranges[0].offset:body.length;
      let prefix=encode(body.slice(0,first),sliceFormats(r.formats,0,first));
      if(typeof r.syncNotePrefix==='string'&&prefix.text===r.syncNotePrefix+'\n')prefix={text:r.syncNotePrefix,formats:sliceFormats(prefix.formats,0,r.syncNotePrefix.length)};
      prefix=restoreSyncText(unquoteBullets(prefix,r.syncEscapes?.note),r,'note/'+date);
      if(prefix.text||r.title||r.important) entities['note/'+date]={date,title:r.title||'',important:!!r.important,...prefix};
      ranges.forEach((range,index)=>{
        const idea=(r.ideas||[]).find(i=>i.offset===range.offset);
        if(!idea)fail('idea identity');
        const end=range.end;
        const content=restoreSyncText(unquoteBullets(encode(body.slice(range.offset+2,end),sliceFormats(r.formats,range.offset+2,end)),r.syncEscapes?.['idea/'+idea.id]),r,'idea/'+idea.id);
        const priorOrder=r.syncOrder?.[idea.id];
        entities['idea/'+idea.id]={date,...content,projects:[...(idea.projectIds||[])].sort(),state:idea.done?'done':idea.todo?'todo':'note',important:!!idea.important,due:idea.dueDate||'',order:priorOrder?.index===index?priorOrder.order:index};
      });
    }
    validate(entities);
    return {entities,assets};
  }
  async function desktopImport(entities, assets, records, projects, imageEntries) {
    validate(entities);await validateAssets(assets,entities);
    const images=new Map(imageEntries), imageTokens=dict();
    for(const [token,value] of images) if(value.src) {
      const scratch=dict();imageTokens[await asset(value.src,scratch)]=token;
    }
    let next=0xE000;
    const decode=(text,formats)=>replaceText(text,formats,/!\[[^\]\n]*\]\(schedule-image:([a-f0-9]{64}\.[a-z]+)\)/g,m=>{
      const id=m[1];if(imageTokens[id])return imageTokens[id];
      while(images.has(String.fromCharCode(next))&&next<=0xF8FF)next++;
      if(next>0xF8FF)fail('too many images');
      const token=String.fromCharCode(next++), a=assets[id];if(!a)fail('missing image');
      images.set(token,{name:'image.'+id.split('.').pop(),src:a.ref===true?'https://schedule-images.local/'+id:'data:'+a.mime+';base64,'+a.data,status:'ready'});imageTokens[id]=token;return token;
    });
    const result=copy(records), dates=new Set([...Object.keys(records),...Object.values(entities).filter(e=>e.date).map(e=>e.date)]);
    for(const date of dates) {
      const old=records[date]||{}, note=entities['note/'+date], ideas=Object.entries(entities).filter(([k,v])=>k.startsWith('idea/')&&v.date===date).sort((a,b)=>a[1].order-b[1].order||a[0].localeCompare(b[0]));
      // Literal phone bullets are indented in the Windows storage grammar, so
      // they never create extra structural ideas. Keep the exact original text
      // mapping while that text remains unchanged, including style offsets.
      const escapedNote=quoteBullets(note?.text||'',note?.formats||[]),syncEscapes={};
      if(escapedNote.escape)syncEscapes.note=escapedNote.escape;
      const prefix=decode(escapedNote.text,escapedNote.formats);let body=prefix.text, formats=prefix.formats, list=[];
      for(const [key,item] of ideas) {
        if(list.length||(body&&!body.endsWith('\n')))body+='\n';
        const escaped=quoteBullets(item.text,item.formats);if(escaped.escape)syncEscapes[key]=escaped.escape;
        const offset=body.length, content=decode(escaped.text,escaped.formats);body+='• '+content.text;
        formats.push(...content.formats.map(f=>({...f,start:f.start+offset+2,end:f.end+offset+2})));
        list.push({id:key.slice(5),offset,done:item.state==='done',todo:item.state!=='note',important:item.important,dueDate:item.due,projectIds:item.projects});
      }
      result[date]={...old,title:note?.title||'',important:!!note?.important,body,formats,ideas:list,files:old.files||[],kind:'journal',source:old.source||'同步',project:old.project||'',schedule:old.schedule||'',syncEscapes,syncContent:{},syncNotePrefix:escapedNote.text&&!escapedNote.text.endsWith('\n')&&ideas.length?escapedNote.text:null};
      result[date].syncOrder=Object.fromEntries(ideas.map(([key,item],index)=>[key.slice(5),{index,order:item.order}]));
    }
    const nextProjects=Object.entries(entities).filter(([key])=>key.startsWith('project/')).map(([key,value])=>({...projects.find(p=>p.id===key.slice(8)),id:key.slice(8),name:value.name,root:projects.find(p=>p.id===key.slice(8))?.root||''}));
    // Windows stores image tokens and structural bullets. Remember any exact
    // wire spelling lost by that conversion, only while its stored text is unchanged.
    const rendered=await desktopExport(result,nextProjects,images);
    for(const [key,item] of Object.entries(entities))if(key.startsWith('idea/')||key.startsWith('note/')) {
      const value=rendered.entities[key];if(!value)continue;
      const stored={text:value.text,formats:value.formats},original={text:item.text,formats:item.formats};
      if(!same(stored,original))result[item.date].syncContent[key]={stored,original};
    }
    return {records:result,projects:nextProjects,images:[...images]};
  }
  async function phoneExport(state, events, readImage) {
    const entities=dict(),assets=dict(),cached=state._sync?.current||{}, names=dict();
    async function encode(text, previous) {
      for(const m of text.matchAll(/schedule-image:([a-f0-9-]+\.[a-z]+)/g)) if(!names[m[1]]) names[m[1]]=await asset(readImage(m[1]),assets);
      const value=replaceText(text,previous?.formats||[],/schedule-image:([a-f0-9-]+\.[a-z]+)/g,m=>'schedule-image:'+names[m[1]]);
      // Preserve styles received from Windows until text is edited on this device.
      if(previous&&value.text!==previous.text)value.formats=editedFormats(previous.text,value.text,previous.formats);
      return value;
    }
    for(const p of state.projects) entities['project/'+p.id]={name:p.name};
    for(const date of new Set([...Object.keys(state.days),...Object.keys(cached).filter(k=>k.startsWith('note/')).map(k=>k.slice(5))])) {
      const prior=cached['note/'+date], text=state.days[date]||'';
      if(text||prior?.title||prior?.important)entities['note/'+date]={date,title:prior?.title||'',important:!!prior?.important,...await encode(text,prior)};
    }
    for(let index=0;index<state.ideas.length;index++) {
      const i=state.ideas[index],key='idea/'+i.id;
      const position=state.ideas.filter(v=>v.date===i.date).findIndex(v=>v.id===i.id);
      const previous=Object.entries(cached).filter(([k,v])=>k.startsWith('idea/')&&v.date===i.date).sort((a,b)=>a[1].order-b[1].order||a[0].localeCompare(b[0]));
      entities[key]={date:i.date,...await encode(i.text,cached[key]),projects:[...i.projects].sort(),state:i.state,important:!!i.important,due:i.due||'',order:previous[position]?.[0]===key?cached[key].order:position};
    }
    for(const event of events) {const {key,title,time,at,minutes,done,important,locked}=event;entities['event/'+key]={key,title,time,at,minutes,done,important,locked};}
    validate(entities);return {entities,assets};
  }
  function phoneImport(entities, state, sync) {
    validate(entities);const next=copy(state);next.days={};next.ideas=[];
    next.projects=Object.entries(entities).filter(([k])=>k.startsWith('project/')).map(([k,v])=>({...state.projects.find(p=>p.id===k.slice(8)),id:k.slice(8),name:v.name}));
    for(const [key,value] of Object.entries(entities)) {
      if(key.startsWith('note/'))next.days[value.date]=value.text;
      if(key.startsWith('idea/')) next.ideas.push({id:key.slice(5),date:value.date,text:value.text,projects:value.projects,state:value.state,important:value.important,due:value.due,order:value.order});
    }
    next.ideas.sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.id.localeCompare(b.id));
    next._sync={...sync,current:copy(entities)};return next;
  }
  function accept(base, phone, result) {
    const local=copy(result.entities), nextBase=copy(result.entities);
    for(const [key,c] of Object.entries(result.conflicts)) {
      if(phone[key])local[key]=copy(phone[key]);else delete local[key];
      if(base[key])nextBase[key]=copy(base[key]);else delete nextBase[key];
    }
    for(const item of Object.values(local))for(const id of item.projects||[])if(!own(local,'project/'+id)&&result.entities['project/'+id])local['project/'+id]=copy(result.entities['project/'+id]);
    return {entities:local,base:nextBase,conflicts:result.conflicts};
  }
  const api={copy,same,validate,merge,resolveReview,asset,digest,validateAssets,desktopExport,desktopImport,phoneExport,phoneImport,accept};
  root.ScheduleSyncModel=api;if(typeof module!=='undefined')module.exports=api;
})(typeof window!=='undefined'?window:globalThis);
