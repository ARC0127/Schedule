const {chromium}=require('playwright');
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'),appDir=process.env.SCHEDULE_TEST_BUILD||path.join(root,'dist/Schedule');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-project-bindings-')),file=path.join(profile,'journal.json');
const day=new Date().toLocaleDateString('sv-SE'),older='2025-01-02';
function record(body,meta){return {title:'项目关联验证',body,files:[],ideas:[...body.matchAll(/^• /gm)].map((m,i)=>({offset:m.index,done:false,...meta[i]}))};}
const fixture={WidgetState:{privateContent:{projects:[{id:'a',name:'项目 A',root:''},{id:'b',name:'项目 B',root:''},{id:'c',name:'项目 C',root:''},{id:'empty',name:'空项目',root:''}],newIdeaProjects:['a'],sidebar:'open',filter:'all',view:'month',selected:day,edits:{
 [day]:record('开头的普通文字\n• 第一条想法\n• 第二条已完成\n• 第三条普通笔记',[{id:'first',projectIds:['a']},{id:'second',projectIds:['a'],done:true},{id:'third',projectIds:['b']}]),
 [older]:record('• 历史待办\n• 多项目普通笔记\n• 已完成\n• ',[{id:'historic',projectIds:['b'],todo:true},{id:'shared',projectIds:['b','c']},{id:'done',projectIds:['c'],done:true},{id:'blank',projectIds:['b']}])
}}},Schedules:{}};
fs.writeFileSync(file,JSON.stringify(fixture));
let app,browser,page;const errors=[],cases=[],pause=ms=>new Promise(r=>setTimeout(r,ms));
const env={...process.env,SCHEDULE_TEST_DATA:profile};
async function launch(){
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 app=spawn(path.join(appDir,'Journal.exe'),[],{cwd:appDir,windowsHide:true,env:{...env,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion`}});
 for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{if(app.exitCode!==null)throw Error('App exited');await pause(100);}}
 assert.ok(browser);page=browser.contexts()[0].pages()[0];page.on('pageerror',e=>errors.push(String(e)));await page.waitForFunction(()=>window.journalReady);await page.setViewportSize({width:1440,height:900});
}
async function exit(){const stopped=new Promise(r=>app.once('exit',r));spawn(path.join(appDir,'Journal.exe'),['--exit'],{windowsHide:true,env});await Promise.race([stopped,pause(10000).then(()=>{throw Error('Exit timed out');})]);await browser.close();browser=null;}
async function saved(){await page.evaluate(()=>window.journalFlush());return JSON.parse(fs.readFileSync(file,'utf8')).WidgetState.privateContent;}
async function caret(id){const r=(await saved()).edits[day],pos=id?r.ideas.find(x=>x.id===id).offset+3:0;await page.locator('#j-entry-body').evaluate((el,pos)=>{el.focus();el.setSelectionRange(pos,pos);el.dispatchEvent(new KeyboardEvent('keyup'));},pos);}
async function order(expected){await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('#j-project-nav [data-filter]')].map(x=>x.dataset.filter))===JSON.stringify(expected),expected);}
async function counts(expected){for(const [id,total]of Object.entries(expected))assert.equal(await page.locator(`#j-project-nav [data-filter="${id}"] .j-project-count`).textContent(),`(${total})`);}
const checkbox=id=>page.locator(`[data-link-project="${id}"]`);
async function ids(id){return (await saved()).edits[day].ideas.find(x=>x.id===id).projectIds;}
(async()=>{try{
 await launch();await order(['b','a','c','empty']);await counts({a:2,b:3,c:2,empty:0});
 cases.push('Totals count visible ideas across dates, include completed notes and multiple bindings, exclude empty bullets; unfinished notes sort descending with stable ties');
 const original=(await saved()).edits[day];
 await caret('first');await page.locator('#j-entry-project').click();
 assert.equal(await page.locator('#j-picker-title').textContent(),'这个想法的项目');assert.ok(await checkbox('a').isChecked());
 await checkbox('a').uncheck();assert.deepEqual(await ids('first'),[]);
 await checkbox('c').check();assert.deepEqual(await ids('first'),['c']);await order(['b','c','a','empty']);await counts({a:1,b:3,c:3});
 await checkbox('b').check();assert.deepEqual(await ids('first'),['c','b']);
 assert.match(await page.locator('#j-entry-project').textContent(),/当前想法：项目 C、项目 B/);
 await page.locator('[data-action="unbind-projects"]').click();assert.deepEqual(await ids('first'),[]);
 await page.locator('[data-action="undo-action"]').click();assert.deepEqual(await ids('first'),['c','b']);
 assert.equal((await saved()).edits[day].body,original.body);assert.deepEqual((await saved()).edits[day].ideas.map(x=>x.id),original.ideas.map(x=>x.id));
 cases.push('Existing idea binds, unbinds, changes and adds projects immediately without a new line; undo retains body and IDs');
 await caret('second');assert.ok(await checkbox('a').isChecked());assert.equal(await checkbox('b').isChecked(),false);
 await checkbox('c').check();assert.deepEqual(await ids('second'),['a','c']);assert.deepEqual(await ids('first'),['c','b']);
 // With no idea at the caret, this same control still selects defaults for future ideas.
 await caret(null);assert.equal(await page.locator('#j-picker-title').textContent(),'新想法的项目');
 await checkbox('a').uncheck();await checkbox('b').check();assert.deepEqual((await saved()).newIdeaProjects,['b']);assert.deepEqual(await ids('second'),['a','c']);
 await page.locator('[data-action="close-project-picker"]').click();
 cases.push('Open picker follows the active idea; ordinary text retains preselection for future ideas without rebinding existing ones');
 await page.locator('[data-filter="b"]').click();
 for(const id of ['first','third','historic','shared'])await page.locator(`[data-complete-id="${id}"]`).click();
 await order(['a','b','c','empty']);await counts({a:1,b:4,c:4,empty:0});
 assert.ok(await page.locator('#j-project-nav [data-filter="b"]').evaluate(el=>el.classList.contains('is-active')));
 await page.locator('[data-complete-id="shared"]').click();await order(['b','c','a','empty']);
 cases.push('Completion and reopening immediately reorder projects without changing totals or the selected project');
 await page.locator('[data-filter="unbound"]').click();
 await saved();await exit();await launch();await order(['b','c','a','empty']);await counts({a:1,b:4,c:4,empty:0});
 assert.deepEqual(await ids('first'),['c','b']);assert.equal((await saved()).edits[day].body,original.body);
 cases.push('Bindings, totals and ordering survive a full desktop restart');
 await page.locator('[data-filter="b"]').click();await page.screenshot({path:path.join(root,'artifacts/project-bindings.png')});await exit();assert.deepEqual(errors,[]);
 const report={passed:true,cases,errors};fs.writeFileSync(path.join(root,'artifacts/project-bindings-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
