const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..'),appDir=process.env.SCHEDULE_TEST_BUILD||path.join(root,'dist/Schedule');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-analysis-ui-')),file=path.join(profile,'journal.json'),fake=path.join(profile,'FakeAssistant.exe');
const date=new Date().toLocaleDateString('sv-SE');
const body='• Synthetic idea for careful questions\n• Unrelated project';
const fixture={WidgetState:{privateContent:{projects:[{id:'p',name:'Synthetic project',root:''}],selected:date,filter:'all',sidebar:'open',edits:{[date]:{title:'Synthetic sources',body,files:[],ideas:[{id:'test',offset:0,projectIds:['p']},{id:'other',offset:body.lastIndexOf('•'),projectIds:[]}]}}},nativeImages:[]},Schedules:{}};
fs.writeFileSync(file,JSON.stringify(fixture));fs.writeFileSync(path.join(profile,'auto-sync.json'),JSON.stringify({enabled:false,peer:'',hours:1}));
assert.equal(spawnSync('C:/Windows/Microsoft.NET/Framework64/v4.0.30319/csc.exe',['/nologo','/utf8output','/target:exe','/reference:System.Web.Extensions.dll','/out:'+fake,path.join(root,'tests/FakeAssistant.cs')],{windowsHide:true}).status,0);
const env={...process.env,SCHEDULE_TEST_DATA:profile};let app,browser,page;const errors=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
async function launch(){
 const listener=net.createServer();await new Promise(r=>listener.listen(0,'127.0.0.1',r));const port=listener.address().port;await new Promise(r=>listener.close(r));
 app=spawn(path.join(appDir,'Journal.exe'),['--api-host'],{cwd:appDir,windowsHide:true,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion`}});
 for(let i=0;i<180;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{if(app.exitCode!==null)throw Error('App exited');await pause(100);}}
 assert.ok(browser);page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>window.journalReady);await page.setViewportSize({width:1200,height:900});
}
async function exit(){const end=new Promise(r=>app.once('exit',r));spawn(path.join(appDir,'Journal.exe'),['--exit'],{windowsHide:true,env});await Promise.race([end,pause(10000).then(()=>{if(app.exitCode===null)throw Error('Exit timeout');})]);await browser.close();browser=null;}
async function saved(){await page.evaluate(()=>window.journalFlush());return JSON.parse(fs.readFileSync(file,'utf8')).WidgetState.privateContent;}
async function api(request){return new Promise((resolve,reject)=>{const child=spawn(path.join(appDir,'Schedule.Cli.exe'),[],{windowsHide:true,env});let output='';child.stdout.on('data',data=>output+=data);child.on('error',reject);child.on('close',()=>{try{resolve(JSON.parse(output.replace(/^\uFEFF/,'')));}catch(error){reject(error);}});child.stdin.end(JSON.stringify(request));});}
(async()=>{try{
 await launch();assert.equal((await page.evaluate(()=>window.journalNative.call('assistantSettings'))).enabled,false);
 await page.evaluate(fake=>window.journalNative.call('setAssistant',{enabled:true,provider:'codex',executable:fake}),fake);
 await pause(5500);assert.equal(Object.keys((await saved()).analyses||{}).length,0);assert.ok(!fs.existsSync(path.join(profile,'analysis-project/requests')));
 await page.locator('#j-analysis-open').click();await page.locator('#j-analysis-scope').selectOption('project:p');
 const preview=await page.locator('#j-analysis-preview').textContent();assert.match(preview,/Synthetic idea/);assert.doesNotMatch(preview,/Unrelated/);
 await page.locator('#j-analysis-question').fill('What could disprove this?');await page.locator('#j-analysis-submit').click();
 await page.waitForFunction(()=>document.querySelector('#j-analysis-list').textContent.includes('已完成'),{},{timeout:30000});
 const pc=await saved(),id=Object.keys(pc.analyses)[0],row=pc.analyses[id];assert.equal(row.status,'completed');assert.match(row.result,/falsify/);assert.equal(pc.edits[date].body,body);
 assert.equal(fs.readFileSync(path.join(profile,'analysis-project/requests',id,'calls.txt'),'utf8').trim(),'call');
 await page.locator('#j-analysis-scope').selectOption('week');assert.match(await page.locator('#j-analysis-preview').textContent(),/Unrelated/);
 await exit();await launch();await pause(5500);const restored=await saved();assert.deepEqual(restored.analyses,pc.analyses);assert.equal(restored.edits[date].body,body);
 assert.equal(fs.readFileSync(path.join(profile,'analysis-project/requests',id,'calls.txt'),'utf8').trim(),'call');
 // Exercise the real native sync commit path for a phone-created manual request.
 await page.evaluate(()=>window.journalNative.call('setAssistant',{enabled:false,provider:'codex',executable:''}));
 const phoneRow={...row,status:'queued',result:'',error:'',model:'',title:'Phone manual request'};
 const response=await api({op:'sync_journal',peer:'000000000001',payload:{schema:2,base:{},entities:{'analysis/phone-manual':phoneRow},assets:{},reviewSupport:1}});
 assert.equal(response.ok,true,JSON.stringify(response));assert.equal(response.result.status,'complete');
 assert.equal((await saved()).analyses['phone-manual'].status,'queued');assert.equal((await saved()).edits[date].body,body);
 assert.equal(response.result.entities['analysis/'+id].result,row.result);
 await exit();await launch();assert.equal((await saved()).analyses['phone-manual'].status,'queued');await exit();assert.deepEqual(errors,[]);
 const report={passed:true,checks:['no auto request while bound','project scope and source preview','manual UI submit through real native host','fake provider result saved','original notes unchanged','recent-week scope','restart preserves result without duplicate invocation','phone request via native sync commit persists across restart','desktop completed result returned in sync payload'],physicalModel:false};fs.writeFileSync(path.join(root,'artifacts/analysis-ui.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}})().catch(error=>{console.error(error);process.exitCode=1;});
