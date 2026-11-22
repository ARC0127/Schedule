const test=require('node:test'), assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
global.ScheduleContent=require('../src/web/content.js');
const model=require('../src/web/sync.js');
const date='2026-11-20', png='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+tmVQAAAAASUVORK5CYII=';
const note=text=>({date,text,title:'',important:false,formats:[]});
test('desktop review applies exact explicit choices only and invalidates stale approvals',()=>{
  const key='note/'+date,base={[key]:note('base')},desktop={[key]:note('B')},phone={[key]:note('A')};
  const merged=model.merge(base,desktop,phone),review={peer:'pc',approved:true,conflicts:merged.conflicts,decisions:{[key]:'phone'}};
  assert.ok(model.same(model.resolveReview(merged,null,'pc').conflicts,merged.conflicts));
  assert.ok(model.same(model.resolveReview(merged,{...review,approved:false},'pc').conflicts,merged.conflicts));
  assert.ok(model.same(model.resolveReview(merged,review,'other').conflicts,merged.conflicts));
  const resolved=model.resolveReview(merged,review,'pc');assert.equal(resolved.entities[key].text,'A');assert.equal(Object.keys(resolved.conflicts).length,0);
  for(const values of [[base,{[key]:note('B2')},phone],[base,desktop,{[key]:note('A2')}],[{[key]:note('older')},desktop,phone]])
    assert.ok(model.resolveReview(model.merge(...values),review,'pc').conflicts[key]);
  const deleted=model.merge(base,{},phone),deleteReview={...review,conflicts:deleted.conflicts,decisions:{[key]:'desktop'}};
  assert.ok(!model.resolveReview(deleted,deleteReview,'pc').entities[key]);
});
test('review cannot delete referenced projects or replace locked events',()=>{
  const idea={date,text:'new',formats:[],projects:['p'],state:'note',important:false,due:'',order:0},base={'project/p':{name:'p'},'idea/i':{...idea,text:'old'}},desktop={},phone={...base,'idea/i':idea};
  const raw=model.merge(base,desktop,phone),review={peer:'p',approved:true,conflicts:raw.conflicts,decisions:{'idea/i':'phone'}};
  let resolved=model.resolveReview(raw,review,'p',{base,desktop,phone});assert.ok(resolved.conflicts['project/p']);
  review.conflicts={...review.conflicts,...resolved.conflicts};review.decisions['project/p']='phone';
  resolved=model.resolveReview(raw,review,'p',{base,desktop,phone});assert.deepEqual(resolved.conflicts,{});assert.equal(resolved.entities['project/p'].name,'p');
  review.decisions['project/p']='desktop';assert.ok(model.resolveReview(raw,review,'p',{base,desktop,phone}).conflicts['project/p']);
  const key='event/'+date+'/e',event={key:date+'/e',title:'linked',time:'12:00',at:1,minutes:0,done:false,important:false,locked:true};
  const locked=model.merge({[key]:event},{[key]:event},{[key]:{...event,title:'phone'}});
  assert.ok(model.resolveReview(locked,{peer:'p',approved:true,conflicts:locked.conflicts,decisions:{[key]:'phone'}},'p').conflicts[key]);
});
test('disjoint changes, deletes, concurrent edits and lost-ack retry',()=>{
  const base={['note/'+date]:note('base')};
  const phone={...base,'project/p':{name:'phone'}};
  const desktop={...base,['note/'+date]:note('desktop')};
  const result=model.merge(base,desktop,phone);
  assert.equal(result.entities['note/'+date].text,'desktop');assert.equal(result.entities['project/p'].name,'phone');assert.deepEqual(Object.keys(result.conflicts),[]);
  assert.deepEqual(model.merge(base,result.entities,phone).entities,result.entities);
  const conflict=model.merge(base,desktop,{['note/'+date]:note('phone')});
  assert.equal(conflict.conflicts['note/'+date].phone.text,'phone');
  const accepted=model.accept(base,{['note/'+date]:note('phone')},conflict);
  assert.equal(accepted.entities['note/'+date].text,'phone');assert.equal(accepted.base['note/'+date].text,'base');
  assert.deepEqual(Object.keys(model.merge(base,base,{}).entities),[]);
});
test('desktop -> phone -> desktop retains original bytes, IDs, bindings and styles',async()=>{
  const body='前言\n• 想法 \uE000\n• second';
  const records={[date]:{body,title:'标题',important:true,files:[{path:'C:/keep'}],formats:[{start:5,end:7,bold:true}],ideas:[{id:'one',offset:3,projectIds:['p'],todo:true},{id:'two',offset:10,projectIds:[],done:true}]}};
  // Derive the independent offsets from the literal markers.
  records[date].ideas[0].offset=body.indexOf('•');records[date].ideas[1].offset=body.lastIndexOf('•');
  const projects=[{id:'p',name:'项目',root:'C:/local'}],images=[['\uE000',{name:'original',src:png,status:'ready'}]];
  const exported=await model.desktopExport(records,projects,images);
  const phone=model.phoneImport(exported.entities,{days:{},ideas:[],projects:[],docs:{}},{base:exported.entities});
  const returned=await model.phoneExport(phone,[],id=>'data:'+exported.assets[id].mime+';base64,'+exported.assets[id].data);
  assert.deepEqual(returned.entities,exported.entities);assert.deepEqual(returned.assets,exported.assets);
  const restored=await model.desktopImport(returned.entities,returned.assets,records,projects,images);
  assert.equal(restored.records[date].body,body);assert.deepEqual(restored.records[date].formats,records[date].formats);
  assert.equal(restored.projects[0].root,'C:/local');assert.deepEqual(restored.records[date].files,records[date].files);
  assert.equal(restored.images[0][1].src,png);
  phone.ideas[0].text+=' 手机修改';
  const edited=await model.phoneExport(phone,[],id=>'data:'+exported.assets[id].mime+';base64,'+exported.assets[id].data);
  const imported=await model.desktopImport(edited.entities,edited.assets,records,projects,images);
  assert.match(imported.records[date].body,/手机修改/);assert.equal(imported.records[date].ideas[0].id,'one');
});
test('bad original image and missing attachment reject the whole payload',async()=>{
  const assets={};const id=await model.asset(png,assets);
  const entities={['note/'+date]:note('![x](schedule-image:'+id+')')};
  await assert.rejects(()=>model.validateAssets({},entities),/missing image/);
  assets[id].data='AAAA';await assert.rejects(()=>model.validateAssets(assets,entities),/digest/);
});
test('image alt text plus literal bullets survives desktop import and lost-ack retry',async()=>{
  const assets={},id=await model.asset(png,assets),entities={'idea/i':{date,text:'![original](schedule-image:'+id+')\n• literal',formats:[],projects:[],state:'note',important:false,due:'',order:0}};
  const imported=await model.desktopImport(entities,assets,{},[],[]);
  const actual=await model.desktopExport(imported.records,imported.projects,imported.images);
  assert.ok(model.same(actual.entities,entities));
  assert.equal(Object.keys(model.merge({},actual.entities,entities).conflicts).length,0);
  imported.records[date].body+=' edited';
  assert.match((await model.desktopExport(imported.records,[],imported.images)).entities['idea/i'].text,/edited$/);
});
test('independent ideas at the same local index merge and retry without false conflict',async()=>{
  const item=text=>({date,text,formats:[],projects:[],state:'note',important:false,due:'',order:0});
  const pc={'idea/b':item('B')},mobile={'idea/a':item('A')},merged=model.merge({},pc,mobile);
  assert.equal(Object.keys(merged.entities).length,2);assert.equal(Object.keys(merged.conflicts).length,0);
  const imported=await model.desktopImport(merged.entities,{}, {},[],[]);
  const returned=await model.desktopExport(imported.records,[],[]);
  assert.ok(model.same(returned.entities,merged.entities));
  assert.equal(Object.keys(model.merge({},returned.entities,mobile).conflicts).length,0);
  const phone=model.phoneImport(returned.entities,{days:{},ideas:[],projects:[]},{base:returned.entities});
  const reply=await model.phoneExport(phone,[],()=>{});
  assert.ok(model.same(reply.entities,returned.entities));
});
test('concurrent project deletion cannot silently unbind a new idea',()=>{
  const idea={date,text:'new',formats:[],projects:['p'],state:'note',important:false,due:'',order:0};
  const result=model.merge({'project/p':{name:'p'}},{'project/p':{name:'p'},'idea/i':idea},{});
  assert.ok(result.entities['project/p']);assert.ok(result.conflicts['project/p']);
});
test('blank continuation lines and literal bullets round trip without splitting identities',async()=>{
  const body='• first\n\n• second\n',records={[date]:{body,ideas:[{id:'first',offset:0},{id:'second',offset:9}]}};
  const exported=await model.desktopExport(records,[],[]), restored=await model.desktopImport(exported.entities,{},records,[],[]);
  assert.equal(restored.records[date].body,body);
  exported.entities['idea/first'].text='literal\n• nested';
  const quoted=await model.desktopImport(exported.entities,{},records,[],[]);
  assert.equal(global.ScheduleContent.ideaRanges(quoted.records[date].body).length,2);
  assert.equal((await model.desktopExport(quoted.records,[],[])).entities['idea/first'].text,'literal\n• nested');
  exported.entities['note/'+date]=note('• literal note');
  const withNote=await model.desktopImport(exported.entities,{},records,[],[]);
  assert.equal(global.ScheduleContent.ideaRanges(withNote.records[date].body).length,2);
  assert.deepEqual((await model.desktopExport(withNote.records,[],[])).entities,exported.entities);
});
