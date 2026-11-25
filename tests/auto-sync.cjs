const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),appDir=process.env.SCHEDULE_TEST_BUILD||path.join(root,'dist/Schedule');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-auto-sync-')),file=path.join(profile,'journal.json');
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

const model=require('../src/web/sync.js');
let phone={schema:2,base:{},entities:{'note/2034-03-14':{date:'2034-03-14',title:'',text:'PHONE AUTO',important:false,formats:[]}},assets:{}},revision='1',changed=0,transfers=0,probes=0,radio=true;
let releaseProbe,connections=0,reused=0,interruptNext=false,interruptions=0;
const probeGate=new Promise(resolve=>{releaseProbe=resolve;});
const serverErrors=[];
async function handle(socket){
  connections++;
  const stream=peer(socket);
  try {
    let hello=await stream.read();
    if(!radio){socket.destroy();return;}
    if(hello.autoProbe){
      probes++;assert.equal(hello.hours,2);assert.equal(hello.continueSync,true);
      if(probes===1)await probeGate;
      stream.send({v:1,type:'auto-status',enabled:true,hours:2,revision,changed,continueSync:true});
      const next=await stream.read();assert.equal(next.type,'auto-next');
      if(!next.sync){socket.end();return;}
      reused++;hello=await stream.read();
    }else throw Error('Automatic transfer opened a second connection instead of reusing its probe');
    assert.equal(hello.automatic,true);assert.equal(hello.wifiSync,1);
    // No reachable LAN: automatic operation must not request a temporary hotspot.
    stream.send({v:1,type:'wifi-offer',available:true});
    const choice=await stream.read();assert.equal(choice.use,false);assert.equal(choice.direct,false);
    if(interruptNext){interruptNext=false;interruptions++;socket.destroy();return;}
    stream.send({v:1,type:'changes',items:[],journalSync:2,assetSync:1});
    await stream.read();
    const bytes=Buffer.from(JSON.stringify({...phone,reviewSupport:1,source:hello.source}));
    stream.send({v:1,type:'journal-start',length:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});
    stream.send({v:1,type:'journal-part',index:0,data:bytes.toString('base64')});
    const header=await stream.read(),parts=[];let length=0;
    while(length<header.length){const part=await stream.read();const bytes=Buffer.from(part.data,'base64');length+=bytes.length;parts.push(bytes);}
    const response=JSON.parse(Buffer.concat(parts));
    if(response.status!=='pending-review'){phone={schema:2,base:response.entities,entities:response.entities,assets:response.assets};revision=String(Number(revision)+1);}
    transfers++;stream.send({v:1,type:'ack',source:hello.source});socket.end();
  }catch(error){serverErrors.push(String(error));socket.destroy();}
}
async function until(test,timeout=70000){const end=Date.now()+timeout;while(Date.now()<end){if(await test())return;await pause(200);}throw Error('Automatic sync timeout: '+JSON.stringify({transfers,probes,serverErrors,status:await page.locator('#j-auto-sync-status').textContent()}));}
(async()=>{try{
  server=net.createServer(handle);await new Promise(r=>server.listen(pipePath,r));await launch();
  const defaults=await page.evaluate(()=>window.journalNative.call('autoSyncSettings'));
  assert.equal(defaults.hours,1);
  await page.evaluate(()=>window.journalNative.call('setAutoSync',{peer:'000000000001',enabled:true,hours:2}));
  await until(()=>probes===1);
  const overlap=await page.evaluate(async()=>{try{await window.journalNative.call('bluetoothSync',{address:'000000000001',wifi:true});return '';}catch(e){return e.message;}});
  assert.match(overlap,/正在检查或同步/);assert.equal(connections,1);releaseProbe();
  cases.push('Manual synchronization cannot open a second connection while an automatic probe is pending');
  await until(()=>transfers===1);await until(async()=>!!(await page.evaluate(()=>window.journalNative.call('autoSyncSettings'))).lastSync);
  assert.match((await saved()).WidgetState.privateContent.edits['2034-03-14'].body,/PHONE AUTO/);
  cases.push('Enabling a trusted peer triggers a real native background merge without pressing Sync; unavailable LAN never requests hotspot');
  assert.equal(reused,1);cases.push('The due transfer reuses its authenticated probe connection');
  await pause(32000);assert.equal(transfers,1);assert.ok(probes>=3);
  cases.push('Availability polling does not repeat an unchanged successful transfer');
  const read=await api({op:'get_day',date:'2034-03-14'});
  interruptNext=true;
  const edited=await api({op:'add_idea',date:'2034-03-14',text:'DESKTOP AUTO CHANGE',revision:read.revision});assert.equal(edited.ok,true);
  await until(()=>interruptions===1);await until(()=>transfers===2,100000);await until(async()=>Object.values(phone.entities).some(v=>v.text==='DESKTOP AUTO CHANGE'));
  cases.push('An interrupted transport reconnects and finishes automatically without reopening the sync dialog');
  cases.push('A saved desktop change automatically reaches the peer after idle debounce');
  // Same record changed independently; do not allow automatic conflict resolution.
  phone.entities=structuredClone(phone.entities);phone.entities['note/2034-03-14'].text='PHONE CONFLICT';revision=String(Number(revision)+1);
  const journal=await saved();
  // Restore fixture through the UI load path, then make an isolated external concurrent change.
  journal.WidgetState.privateContent.edits['2034-03-14'].body='DESKTOP CONFLICT';
  fs.writeFileSync(file,JSON.stringify(journal));
  await page.reload();await page.waitForFunction(()=>window.journalReady);
  await until(()=>fs.existsSync(path.join(profile,'sync-review.json')));
  const pending=JSON.parse(fs.readFileSync(path.join(profile,'sync-review.json'),'utf8'));assert.equal(pending.approved,false);
  const before=fs.readFileSync(file,'utf8'),count=transfers;await pause(32000);
  assert.equal(transfers,count);assert.equal(fs.readFileSync(file,'utf8'),before);
  cases.push('Conflicting automatic changes persist a desktop review and stop later attempts without journal writes');
  await page.evaluate(()=>window.journalNative.call('setAutoSync',{peer:'000000000001',enabled:false,hours:2}));
  await exit();await launch();assert.equal((await page.evaluate(()=>window.journalNative.call('autoSyncSettings'))).enabled,false);
  cases.push('Pausing automatic sync survives a cold restart');
  await exit();assert.deepEqual(serverErrors,[]);assert.deepEqual(errors,[]);
  const report={passed:true,cases,transfers,probes,reused,interruptions,transport:'Real Windows app and WebView with paired-device protocol through isolated named pipe',physicalRadio:false};
  fs.writeFileSync(path.join(root,'artifacts/auto-sync-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();if(server)server.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
