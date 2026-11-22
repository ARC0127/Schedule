const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),appDir=process.env.SCHEDULE_TEST_BUILD||path.join(root,'dist/Schedule');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-bluetooth-')),file=path.join(profile,'journal.json');
const pipe='ScheduleBluetoothTest-'+crypto.randomUUID().replaceAll('-',''),pipePath='\\\\.\\pipe\\'+pipe;
const date='2034-03-10',at=new Date(date+'T12:30:00').toISOString();
const fixture={WidgetState:{privateContent:{projects:[{id:'p',name:'保留项目',root:''}],selected:date,filter:'all',sidebar:'open',edits:{[date]:{title:'保留记录',body:'• 保留想法及图片 \uE000',files:[],ideas:[{id:'idea',offset:0,projectIds:['p'],todo:true,done:false}]}}},nativeImages:[['\uE000',{name:'原图',status:'ready',src:'data:image/png;base64,'+fs.readFileSync(path.join(root,'assets/schedule-icon.png')).toString('base64')}]]},Schedules:{
  [date+'/desktop-one']:{Id:'desktop-one',Date:date,Title:'电脑日程',Time:'12:30',At:at,RemindMinutes:-1,Done:false,Important:false},
  [date+'/linked']:{Id:'linked',Date:date,Title:'关联想法',Time:'12:30',At:at,RemindMinutes:-1,Done:false,Important:true,IdeaId:'idea',IdeaDate:date},
  ['2034-03-11']:{Title:'旧版日程',Time:'12:30',At:new Date('2034-03-11T12:30:00').toISOString(),RemindMinutes:-1,Done:false,Important:false}
}};
fs.writeFileSync(file,JSON.stringify(fixture));
// Manual-protocol regressions deliberately disable the independent automatic scheduler.
fs.writeFileSync(path.join(profile,'auto-sync.json'),JSON.stringify({enabled:false,peer:'',hours:2}));
let app,browser,page,server,exchangeHandler;
const errors=[],cases=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,SCHEDULE_TEST_DATA:profile,SCHEDULE_TEST_BLUETOOTH_PIPE:pipe};
async function launch(){
  const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
  // Hidden API-host launch avoids bringing a test window in front of the user.
  app=spawn(path.join(appDir,'Journal.exe'),['--api-host'],{cwd:appDir,windowsHide:true,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion`}});
  for(let i=0;i<180;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{if(app.exitCode!==null)throw Error('App exited');await pause(100);}}
  assert.ok(browser);page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(String(e)));
  await page.waitForFunction(()=>window.journalReady);await page.setViewportSize({width:1440,height:900});
}
async function exit(){
  const stopped=new Promise(r=>app.once('exit',r));spawn(path.join(appDir,'Journal.exe'),['--exit'],{windowsHide:true,env});
  let timer;try{await Promise.race([stopped,new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Exit timed out')),10000);})]);}finally{clearTimeout(timer);}
  await browser.close();browser=null;
}
async function api(request){return new Promise((resolve,reject)=>{
  const child=spawn(path.join(appDir,'Schedule.Cli.exe'),[],{windowsHide:true,env});let output='',stderr='';
  child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>stderr+=d);child.on('error',reject);
  child.on('close',()=>{try{resolve(JSON.parse(output.replace(/^\uFEFF/,'')));}catch{reject(Error(output+stderr));}});child.stdin.end(JSON.stringify(request));
});}
async function saved(){await page.evaluate(()=>window.journalFlush());return JSON.parse(fs.readFileSync(file,'utf8'));}
function peer(socket){
  let buffer=Buffer.alloc(0),ended=false;const frames=[],waiters=[];
  const fail=error=>{ended=true;while(waiters.length)waiters.shift().reject(error);};
  socket.on('error',fail);socket.on('end',()=>fail(Error('Peer ended')));
  socket.on('data',data=>{buffer=Buffer.concat([buffer,data]);while(buffer.length>=4){const n=buffer.readUInt32BE(0);if(n>4*1024*1024){fail(Error('Oversize frame'));socket.destroy();return;}if(buffer.length<4+n)return;let message;try{message=JSON.parse(buffer.subarray(4,4+n).toString('utf8'));}catch(e){fail(e);return;}buffer=buffer.subarray(4+n);if(waiters.length)waiters.shift().resolve(message);else frames.push(message);}});
  return {read(){if(frames.length)return Promise.resolve(frames.shift());if(ended)return Promise.reject(Error('Peer ended'));return new Promise((resolve,reject)=>waiters.push({resolve,reject}));},send(message){const bytes=Buffer.from(JSON.stringify(message)),header=Buffer.alloc(4);header.writeUInt32BE(bytes.length);socket.write(Buffer.concat([header,bytes]));}};
}
let lastSource;
async function roundtrip(items,options={}){
  let resolvePeer,rejectPeer;const completed=new Promise((r,j)=>{resolvePeer=r;rejectPeer=j;});
  exchangeHandler=async socket=>{const stream=peer(socket);try{
    const hello=await stream.read();assert.equal(hello.type,'hello');assert.equal(hello.v,1);assert.match(hello.source,/^[a-f0-9]{64}$/);
    if(lastSource)assert.equal(hello.source,lastSource);lastSource=hello.source;
    if(options.beforeChanges)await options.beforeChanges();
    stream.send({v:1,type:'changes',items});
    if(options.malformed){await new Promise(r=>socket.once('close',r));resolvePeer(null);return;}
    const snapshot=await stream.read();assert.equal(snapshot.type,'snapshot');assert.equal(snapshot.v,1);assert.equal(snapshot.source,hello.source);
    if(!options.lostAck)stream.send({v:1,type:'ack',source:hello.source});
    socket.end();resolvePeer(snapshot);
  }catch(error){socket.destroy();rejectPeer(error);}};
  await page.locator('#j-bluetooth-sync').click();
  let timeout;const snapshot=await Promise.race([completed,new Promise((_,reject)=>{timeout=setTimeout(()=>reject(Error('Protocol exchange timed out')),20000);})]).finally(()=>clearTimeout(timeout));
  await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-sync').disabled);
  return snapshot;
}
function change(base,value){return {key:(value||base).key,token:crypto.randomUUID(),base,value};}
async function journalRoundtrip(payload,lostAck=false,button='#j-bluetooth-sync',incremental=false){
  let done,failed;const completed=new Promise((r,j)=>{done=r;failed=j;});
  exchangeHandler=async socket=>{try{
    const stream=peer(socket),hello=await stream.read();assert.equal(hello.journalSync,2);lastSource=hello.source;
    let wire=payload;
    if(incremental) {
      assert.equal(hello.wifiSync,1);stream.send({v:1,type:'wifi-offer',available:false});
      const fallback=await stream.read();assert.equal(fallback.type,'wifi-result');assert.equal(fallback.use,false);
    }
    stream.send({v:1,type:'changes',items:[],journalSync:2,...(incremental?{assetSync:1}:{})});
    if(incremental) {
      const inventory=await stream.read();assert.equal(inventory.type,'asset-inventory');
      wire={...payload,knownAssets:Object.keys(payload.assets),assets:Object.fromEntries(Object.entries(payload.assets).filter(([id])=>!inventory.ids.includes(id)))};
      assert.equal(Object.keys(wire.assets).length,0);
    }
    const bytes=Buffer.from(JSON.stringify({reviewSupport:1,...wire,source:hello.source}));
    stream.send({v:1,type:'journal-start',length:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    for(let offset=0,index=0;offset<bytes.length;offset+=384*1024,index++)stream.send({v:1,type:'journal-part',index,data:bytes.subarray(offset,offset+384*1024).toString('base64')});
    const header=await stream.read();assert.equal(header.type,'journal-start');const chunks=[];let length=0;
    while(length<header.length){const part=await stream.read();assert.equal(part.type,'journal-part');assert.equal(part.index,chunks.length);const buffer=Buffer.from(part.data,'base64');chunks.push(buffer);length+=buffer.length;}
    const response=Buffer.concat(chunks);assert.equal(crypto.createHash('sha256').update(response).digest('hex'),header.sha256);
    if(!lostAck)stream.send({v:1,type:'ack',source:hello.source});socket.end();done(JSON.parse(response.toString()));
  }catch(e){socket.destroy();failed(e);}};
  await page.locator(button).click();let timeout;
  const result=await Promise.race([completed,new Promise((_,j)=>{timeout=setTimeout(()=>j(Error('Journal protocol timeout')),60000);})]).finally(()=>clearTimeout(timeout));
  await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-sync').disabled);
  await page.waitForFunction(()=>!document.querySelector('#j-sync-review').inert);
  if(result.status==='pending-review')await page.waitForFunction(id=>document.querySelector('#j-sync-approve')&&window.journalNative.call('loadSyncReview').then(r=>r?.id===id),result.reviewId);
  else if(!lostAck)await page.waitForFunction(()=>document.querySelector('#j-sync-review').hidden);
  return result;
}
(async()=>{try{
  server=net.createServer(socket=>{if(exchangeHandler){const handle=exchangeHandler;exchangeHandler=null;handle(socket);}else socket.destroy();});
  await new Promise(r=>server.listen(pipePath,r));await launch();const baseline=await saved();
  await page.locator('#j-bluetooth-open').click();await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-device').disabled);
  assert.equal(await page.locator('#j-bluetooth-sync').isDisabled(),true);
  await page.locator('#j-bluetooth-device').selectOption('000000000001');
  const listed=await roundtrip([],{beforeChanges:async()=>{
    // While waiting for the phone, the UI and native message loop still answer.
    assert.equal(await page.evaluate(()=>document.querySelector('#j-bluetooth-dialog').open),true);
    const busy=await page.evaluate(()=>window.journalNative.call('bluetoothSync',{address:'000000000001'}).then(()=>'',e=>e.message));assert.match(busy,/正在同步/);
    const cap=await api({op:'capabilities'});assert.equal(cap.ok,true);
  }});
  assert.equal(listed.events.length,3);assert.ok(listed.events.find(e=>e.key.endsWith('/linked')).locked);assert.ok(listed.events.find(e=>e.key.includes('legacy-')).locked);
  const expectedSource=await api({op:'capabilities'});assert.equal(expectedSource.result.dataDirectory.toLowerCase(),profile.toLowerCase());
  cases.push('Existing Journal exposes paired-device selection; no implicit target; protocol snapshot, linked/legacy locks and API responsiveness work while the sync dialog is open');
  const phone={key:date+'/android-'+crypto.randomUUID(),title:'手机新增',time:'12:30',at:new Date(at).getTime(),minutes:15,done:false,important:true,locked:false};
  const create=change(null,phone);let result=await roundtrip([create],{lostAck:true});
  assert.equal(result.results[0].status,'applied');assert.match(await page.locator('#j-bluetooth-status').textContent(),/同步未完成/);
  result=await roundtrip([create]);assert.equal(result.results[0].status,'applied');assert.equal(result.events.filter(e=>e.key===phone.key).length,1);
  assert.equal((await saved()).Schedules[phone.key].RemindMinutes,15);
  const updated={...phone,title:'手机修改',minutes:5,done:true};result=await roundtrip([change(phone,updated)]);assert.equal(result.results[0].status,'applied');assert.equal(result.events.find(e=>e.key===phone.key).minutes,5);
  assert.equal((await saved()).Schedules[phone.key].Status,'off');
  result=await roundtrip([change(phone,null)]);assert.equal(result.results[0].status,'conflict');assert.equal(result.events.find(e=>e.key===phone.key).title,updated.title);
  const locked=listed.events.find(e=>e.key.endsWith('/linked'));result=await roundtrip([change(locked,{...locked,title:'不能修改',locked:false})]);assert.equal(result.results[0].status,'conflict');
  result=await roundtrip([change(updated,null)]);assert.equal(result.results[0].status,'applied');assert.ok(!result.events.some(e=>e.key===phone.key));
  result=await roundtrip([change(updated,null)]);assert.equal(result.results[0].status,'applied');
  cases.push('Phone create/update/delete use the real guarded event API; lost-ack retries do not duplicate events; stale edits and linked-event writes are conflicts');
  const stable=fs.readFileSync(file,'utf8');
  result=await roundtrip([change(null,phone)],{beforeChanges:async()=>fs.appendFileSync(file,' ')});
  assert.equal(result.results[0].status,'retry');assert.equal(fs.readFileSync(file,'utf8'),stable+' ');fs.writeFileSync(file,stable);
  await roundtrip([create,create],{malformed:true});assert.match(await page.locator('#j-bluetooth-status').textContent(),/同步未完成/);
  const read=await api({op:'get_day',date});assert.equal(read.ok,true);
  const stale=await api({op:'save_event',date,id:'should-not-save',revision:'stale',event:{title:'过期写入',time:'12:30',at,remindMinutes:-1}});assert.equal(stale.ok,false);assert.match(stale.error,/CONFLICT/);
  await page.evaluate(()=>document.querySelector('#j-project-dialog').showModal());
  assert.match((await api({op:'get_day',date})).error,/BUSY/);await page.evaluate(()=>document.querySelector('#j-project-dialog').close());
  const invalid=await page.evaluate(()=>window.journalNative.call('bluetoothSync',{address:'000000000002'}).then(()=>'',e=>e.message));assert.match(invalid,/已配对/);
  cases.push('External-file changes are not overwritten; malformed frames, invalid peers, stale API revisions and other open dialogs remain protected');
  result=await roundtrip([create]);assert.equal(result.results[0].status,'applied');
  const dialogBounds=await page.locator('#j-bluetooth-dialog').boundingBox();assert.ok(dialogBounds.width<=1440 && dialogBounds.height<=900);
  const before=await saved();assert.deepEqual(before.WidgetState.nativeImages,baseline.WidgetState.nativeImages);assert.deepEqual(before.WidgetState.privateContent.projects,baseline.WidgetState.privateContent.projects);
  for(const [day,entry] of Object.entries(baseline.WidgetState.privateContent.edits))for(const name of ['body','ideas','files','title'])assert.deepEqual(before.WidgetState.privateContent.edits[day][name],entry[name]);
  await exit();await launch();const after=await saved();assert.deepEqual(after.Schedules,before.Schedules);assert.deepEqual(after.WidgetState.nativeImages,before.WidgetState.nativeImages);
  await page.locator('#j-bluetooth-open').click();await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-device').disabled);await page.locator('#j-bluetooth-device').selectOption('000000000001');
  result=await roundtrip([]);assert.ok(result.events.some(e=>e.key===phone.key));
  cases.push('Event changes and source identity survive a cold restart; projects, notes, idea bindings and original images remain intact');
  const model=require('../src/web/sync.js'),assets={},imageId=await model.asset(fixture.WidgetState.nativeImages[0][1].src,assets);
  const phoneOriginal=Buffer.concat([fs.readFileSync(path.join(root,'assets/schedule-icon.png')),Buffer.from('original-phone-fixture')]);
  const phoneImageId=await model.asset('data:image/png;base64,'+phoneOriginal.toString('base64'),assets);
  const entities={
    'project/android-project':{name:'手机项目'},
    ['note/'+date]:{date,text:'手机笔记\n',title:'手机标题',important:false,formats:[]},
    'idea/android-idea':{date,text:'手机想法 ![original](schedule-image:'+imageId+') ![new](schedule-image:'+phoneImageId+')\n• 想法内部的条目',projects:['android-project'],state:'todo',important:true,due:'',order:1,formats:[]},
    ['event/'+date+'/android-local']:{key:date+'/android-local',title:'手机本地日程',time:'12:30',at:new Date(at).getTime(),minutes:-1,done:false,important:false,locked:false}
  };
  const full={schema:2,entities,base:{},assets};
  const preConflict=await saved();
  let synced=await journalRoundtrip(full);assert.equal(synced.status,'pending-review');assert.ok(!synced.entities);
  assert.deepEqual(await saved(),preConflict);assert.ok(await page.locator('#j-sync-approve').isDisabled());
  assert.equal((await page.evaluate(()=>window.journalNative.call('loadSyncReview'))).conflicts['note/'+date].phone.text,'手机笔记\n');
  await page.locator('#j-bluetooth-close').click();assert.deepEqual(await saved(),preConflict);
  await exit();await launch();
  await page.locator('#j-bluetooth-open').click();await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-device').disabled);
  await page.locator('#j-bluetooth-device').selectOption('000000000001');
  await page.locator('#j-sync-review input[value="phone"]').check();
  synced=await journalRoundtrip(full,true,'#j-sync-approve');
  assert.ok(fs.existsSync(path.join(profile,'sync-review.json'))); // lost acknowledgement retains approval
  assert.ok(synced.entities['idea/android-idea']);assert.ok(synced.entities['idea/idea']);
  assert.ok(synced.entities['event/'+date+'/android-local']);
  const count=Object.keys(synced.entities).length;synced=await journalRoundtrip(full);assert.equal(Object.keys(synced.entities).length,count);
  assert.ok(!fs.existsSync(path.join(profile,'sync-review.json')));
  cases.push('Conflicts pause the entire transfer without journal writes; closing/restarting retains both versions; desktop choice is required; lost acknowledgements retain approval until safe retry');
  const both=await saved();assert.equal(both.WidgetState.privateContent.projects.length,2);assert.equal(both.WidgetState.privateContent.edits[date].ideas.length,2);
  assert.ok(both.WidgetState.nativeImages.some(([,value])=>value.src===fixture.WidgetState.nativeImages[0][1].src));
  const fileImage=both.WidgetState.nativeImages.find(([,value])=>value.src==='https://schedule-images.local/'+phoneImageId);
  assert.ok(fileImage);assert.deepEqual(fs.readFileSync(path.join(profile,'images',phoneImageId)),phoneOriginal);
  assert.equal(await page.evaluate(src=>new Promise(resolve=>{const img=new Image();img.onload=()=>resolve(img.naturalWidth>0);img.onerror=()=>resolve(false);img.src=src;}),fileImage[1].src),true);
  cases.push('Received originals are stored byte-exact outside journal JSON and rendered through the native image origin');
  const prior=JSON.parse(JSON.stringify(synced.entities)),changed=JSON.parse(JSON.stringify(synced.entities));changed['idea/android-idea'].text+=' 双向修改';
  synced=await journalRoundtrip({schema:2,base:prior,entities:changed,assets:synced.assets});
  assert.match((await saved()).WidgetState.privateContent.edits[date].body,/双向修改/);
  const readDay=await api({op:'get_day',date});assert.equal((await api({op:'update_idea',date,id:'android-idea',revision:readDay.revision,text:'电脑并发修改'})).ok,true);
  const mobile=JSON.parse(JSON.stringify(synced.entities));mobile['idea/android-idea'].text='手机并发修改';
  const concurrent={schema:2,base:synced.entities,entities:mobile,assets:synced.assets};
  const conflictBefore=await saved(),conflicted=await journalRoundtrip(concurrent);
  assert.equal(conflicted.status,'pending-review');assert.deepEqual(await saved(),conflictBefore);
  await page.locator('#j-sync-review input[value="phone"]').check();
  const later=await api({op:'get_day',date});
  assert.equal((await api({op:'update_idea',date,id:'android-idea',revision:later.revision,text:'电脑等待期间再修改'})).ok,true);
  const staleReview=await journalRoundtrip(concurrent,false,'#j-sync-approve');assert.equal(staleReview.status,'pending-review');
  assert.ok(await page.locator('#j-sync-approve').isDisabled());assert.match((await saved()).WidgetState.privateContent.edits[date].body,/电脑等待期间再修改/);
  await page.locator('#j-sync-review input[value="desktop"]').check();
  const resolved=await journalRoundtrip(concurrent,false,'#j-sync-approve');
  assert.equal(resolved.entities['idea/android-idea'].text,'电脑等待期间再修改');
  fs.writeFileSync(path.join(root,'artifacts/full-sync-desktop.json'),JSON.stringify({...resolved,source:lastSource}));
  const incremental=await journalRoundtrip({schema:2,base:resolved.entities,entities:resolved.entities,assets:resolved.assets},false,'#j-bluetooth-sync',true);
  assert.deepEqual(incremental.assets,{});assert.ok(model.same(incremental.entities,resolved.entities));
  assert.deepEqual((await saved()).WidgetState.nativeImages,both.WidgetState.nativeImages);
  cases.push('Wi-Fi unavailable explicitly falls back to Bluetooth; shared original images omitted both ways and retained by native commit');
  await exit();await launch();assert.match((await saved()).WidgetState.privateContent.edits[date].body,/电脑等待期间再修改/);
  cases.push('Editing either reviewed version invalidates the prior choice; fresh desktop approval resolves the exact current versions before write');
  cases.push('Negotiated full journal frames merge original images, phone-only events, notes, stable ideas and projects; lost acknowledgements are idempotent; concurrent edits retain both; cold restart persists the merge');
  if(process.env.SCHEDULE_ANDROID_FIXTURE) {
    const android=JSON.parse(fs.readFileSync(process.env.SCHEDULE_ANDROID_FIXTURE,'utf8'));
    await page.locator('#j-bluetooth-open').click();await page.waitForFunction(()=>!document.querySelector('#j-bluetooth-device').disabled);await page.locator('#j-bluetooth-device').selectOption('000000000001');
    const received=await journalRoundtrip(android);
    assert.ok(received.entities['idea/phone-idea']);assert.ok(received.entities['project/phone-project']);
    assert.ok(Object.values(received.entities).some(value=>value.title==='手机原有日程'));
    fs.writeFileSync(path.join(root,'artifacts/full-sync-cross-response.json'),JSON.stringify(received));
    const actual=await saved();assert.match(actual.WidgetState.privateContent.edits['2034-03-12'].body,/手机原有想法/);
    cases.push('Actual Android WebView/native export imported by the real Windows app, including original-image bytes, project binding and formerly local event');
  }
  await exit();delete env.SCHEDULE_TEST_BLUETOOTH_PIPE;await launch();
  const realDevices=await page.evaluate(()=>window.journalNative.call('bluetoothDevices'));assert.ok(Array.isArray(realDevices));
  await exit();assert.deepEqual(errors,[]);
  const report={passed:true,cases,errors,pairedHardwareDevices:realDevices.length,transport:'Actual Journal/WebView APIs with Android v1 frames over an isolated local stream; real paired-device enumeration separately verified',livePhoneSync:false};
  fs.writeFileSync(path.join(root,'artifacts/bluetooth-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();if(server)server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
