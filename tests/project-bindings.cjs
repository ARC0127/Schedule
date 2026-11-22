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
const extraProjects=Array.from({length:8},(_,i)=>({id:`extra-${i}`,name:`更多项目 ${i} · 很长的项目名称用于检查省略显示`,root:'C:\\Projects\\Long project folder\\Research notes'}));
fixture.WidgetState.privateContent.projects.push(...extraProjects);
fixture.WidgetState.privateContent.edits[day].body+='\n'+Array.from({length:65},(_,i)=>`长记录第 ${i+1} 行：继续整理思路与资料。`).join('\n');
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
async function order(expected){await page.waitForFunction(expected=>JSON.stringify([...document.querySelectorAll('#j-project-nav [data-filter]')].map(x=>x.dataset.filter))===JSON.stringify(expected),[...expected,...extraProjects.map(p=>p.id)]);}
async function counts(expected){for(const [id,total]of Object.entries(expected))assert.equal(await page.locator(`#j-project-nav [data-filter="${id}"] .j-project-count`).textContent(),`(${total})`);}
const checkbox=id=>page.locator(`[data-link-project="${id}"]`);
async function ids(id){return (await saved()).edits[day].ideas.find(x=>x.id===id).projectIds;}
(async()=>{try{
 await launch();await order(['b','a','c','empty']);await counts({a:2,b:3,c:2,empty:0});
 cases.push('Totals count visible ideas across dates, include completed notes and multiple bindings, exclude empty bullets; unfinished notes sort descending with stable ties');
 const original=(await saved()).edits[day];
 const pane=page.locator('.j-editor'),dock=page.locator('.j-project-dock');
 async function scrollToIdea(){
  await caret('third');await pane.evaluate(el=>{el.scrollTop=600;});
  await page.waitForFunction(()=>{
   const pane=document.querySelector('.j-editor'),dock=document.querySelector('.j-project-dock');
   return Math.abs(dock.getBoundingClientRect().top-pane.getBoundingClientRect().top-parseFloat(getComputedStyle(pane).paddingTop)-parseFloat(getComputedStyle(dock).top))<2;
  }).catch(async error=>{
   console.error(await page.evaluate(()=>{const pane=document.querySelector('.j-editor'),dock=document.querySelector('.j-project-dock');return {scroll:pane.scrollTop,scrollHeight:pane.scrollHeight,pane:pane.getBoundingClientRect().toJSON(),dock:dock.getBoundingClientRect().toJSON(),top:getComputedStyle(dock).top,position:getComputedStyle(dock).position,offset:getComputedStyle(pane).getPropertyValue('--j-project-dock-top')};}));
   await page.screenshot({path:path.join(root,'artifacts/project-dock-failure.png')});throw error;
  });
 }
 await scrollToIdea();
 const scrollBefore=await pane.evaluate(el=>el.scrollTop);
 await page.locator('#j-entry-project').click();await checkbox('c').check();
 assert.deepEqual(await ids('third'),['b','c']);
 assert.equal(await pane.evaluate(el=>el.scrollTop),scrollBefore);
 await checkbox('c').uncheck();await page.locator('[data-action="close-project-picker"]').click();
 assert.equal(await pane.evaluate(el=>el.scrollTop),scrollBefore);
 await page.screenshot({path:path.join(root,'artifacts/project-dock.png')});
 await page.locator(`[data-date="${day}"]`).dblclick();
 await scrollToIdea();
 const heading=await page.locator('.j-editor-heading').boundingBox(),bar=await dock.boundingBox();
 assert.ok(bar.y>=heading.y+heading.height-1);
 await page.locator('#j-entry-project').click();
 const popup=await page.locator('#j-project-picker').boundingBox();
 assert.ok(popup.y>=bar.y+bar.height);assert.ok(popup.y+popup.height<=(await pane.boundingBox()).y+(await pane.boundingBox()).height);
 await checkbox('c').check();assert.deepEqual(await ids('third'),['b','c']);await checkbox('c').uncheck();
 await page.locator('[data-action="close-project-picker"]').click();
 await page.setViewportSize({width:800,height:520});
 await page.locator('[data-action="sidebar"]').click();await scrollToIdea();
 await page.locator('#j-entry-project').click();
 const smallPopup=await page.locator('#j-project-picker').boundingBox(),smallPane=await pane.boundingBox();
 assert.ok(smallPopup.y+smallPopup.height<=smallPane.y+smallPane.height);
 assert.ok(await page.locator('[data-action="unbind-projects"]').isVisible());
 await page.locator('[data-action="close-project-picker"]').click();
 await page.setViewportSize({width:1440,height:900});
 await page.locator('[data-action="sidebar"]').click();await page.locator('.j-back').click();
 assert.equal((await saved()).edits[day].body,original.body);
 await pane.evaluate(el=>{el.scrollTop=0;});
 cases.push('Project control sticks at the top of long records; binding does not move the scroll position or change text; expanded-day header and small-window dropdown stay visible without overlap');
 await caret('first');await page.locator('#j-entry-project').click();
 assert.equal(await page.locator('#j-picker-title').textContent(),'这个想法的项目');assert.ok(await checkbox('a').isChecked());
 const options=page.locator('#j-project-options');
 const optionIds=()=>options.locator('input').evaluateAll(nodes=>nodes.map(n=>n.dataset.linkProject));
 const initialOptions=['a','b','c','empty',...extraProjects.map(p=>p.id)];
 assert.deepEqual(await optionIds(),initialOptions);
 const dimensions=await options.evaluate(el=>({height:el.clientHeight,content:el.scrollHeight,row:el.firstElementChild.getBoundingClientRect().height}));
 assert.equal(dimensions.height,6*dimensions.row);assert.ok(dimensions.content>dimensions.height);
 await options.hover();await page.mouse.wheel(0,500);
 await page.waitForFunction(()=>document.querySelector('#j-project-options').scrollTop>0);
 await checkbox('extra-7').check();
 assert.deepEqual(await ids('first'),['a','extra-7']);assert.deepEqual(await optionIds(),initialOptions);
 const scroll=await options.evaluate(el=>el.scrollTop);
 assert.ok(await checkbox('extra-7').evaluate(el=>el===document.activeElement));
 await page.keyboard.press('Space');assert.deepEqual(await ids('first'),['a']);
 assert.equal(await options.evaluate(el=>el.scrollTop),scroll);
 await checkbox('extra-7').check();
 await page.locator('[data-action="close-project-picker"]').click();
 await page.locator('#j-entry-project').click();
 assert.deepEqual((await optionIds()).slice(0,4),['a','extra-7','b','c']);
 assert.equal(await options.evaluate(el=>el.scrollTop),0);
 await checkbox('extra-7').uncheck();
 await page.setViewportSize({width:800,height:600});
 await page.waitForFunction(()=>document.querySelector('#j-project-options').getBoundingClientRect().height<=271);
 assert.ok(await options.evaluate(el=>el.scrollWidth===el.clientWidth));
 assert.ok(await page.locator('[data-action="unbind-projects"]').isVisible());
 await page.setViewportSize({width:1440,height:900});
 await page.screenshot({path:path.join(root,'artifacts/project-picker.png')});
 cases.push('Picker shows six rows with wheel scrolling; selected projects precede recent and frequent projects; multi-select preserves order, scroll and keyboard focus; reopening re-ranks; narrow windows stay contained');
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
 await caret(null);assert.equal(await page.locator('#j-picker-title').textContent(),'下一条想法的项目');
 assert.equal(await checkbox('a').isChecked(),false);await checkbox('b').check();assert.deepEqual((await saved()).newIdeaProjects,[]);assert.deepEqual(await ids('second'),['a','c']);
 await page.locator('[data-action="close-project-picker"]').click();
 cases.push('Open picker follows the active idea; legacy defaults are ignored and manual preselection is not persisted or applied to existing ideas');
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
 await page.locator('[data-filter="all"]').click();
 const noteDay=day.slice(0,8)+(day.endsWith('01')?'02':'01');
 await page.locator(`[data-date="${noteDay}"]`).click();
 const body=page.locator('#j-entry-body');
 await body.click();await page.keyboard.insertText('当天随手记录');
 let note=(await saved()).edits[noteDay];assert.equal(note.ideas.length,0);
 assert.equal(await page.locator(`[data-date="${noteDay}"]`).getAttribute('data-level'),'0');
 await page.locator('#j-entry-project').click();await checkbox('b').check();
 await page.locator('[data-action="close-project-picker"]').click();
 await body.evaluate(el=>{el.focus();el.setSelectionRange(el.value.length,el.value.length);});
 await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('手动选择的项目');
 note=(await saved()).edits[noteDay];assert.deepEqual(note.ideas[0].projectIds,['b']);
 await page.keyboard.press('Shift+Enter');await page.keyboard.insertText('默认不绑定');
 note=(await saved()).edits[noteDay];assert.deepEqual(note.ideas.map(x=>x.projectIds),[['b'],[]]);
 // Splitting a bound idea preserves its original binding without leaking to the new fragment.
 await body.evaluate((el,pos)=>{el.focus();el.setSelectionRange(pos,pos);},note.ideas[0].offset+5);
 await page.keyboard.press('Shift+Enter');
 note=(await saved()).edits[noteDay];assert.deepEqual(note.ideas.map(x=>x.projectIds),[['b'],[],[]]);
 await body.evaluate(el=>{el.focus();el.setSelectionRange(0,0);el.dispatchEvent(new KeyboardEvent('keyup'));});
 await page.locator('#j-entry-project').click();await checkbox('c').check();
 await saved();await exit();await launch();
 assert.deepEqual((await saved()).edits[noteDay].ideas.map(x=>x.projectIds),[['b'],[],[]]);
 await caret(null);await page.locator('#j-entry-project').click();
 assert.equal(await checkbox('c').isChecked(),false);
 cases.push('Plain daily notes stay outside heat counts; manual project choice applies once, subsequent and split ideas remain unbound, and restart clears unused preselection without losing saved bindings');
 await page.locator('[data-action="close-project-picker"]').click();
 const preserved=(await saved()).edits;
 const activeFilter=(await saved()).filter;
 const navB=page.locator('#j-project-nav [data-filter="b"]'),dialog=page.locator('#j-project-dialog');
 await navB.click({button:'right'});assert.ok(await dialog.isVisible());
 assert.equal((await saved()).filter,activeFilter);
 assert.equal(await page.locator('#j-project-name').inputValue(),'项目 B');
 assert.ok(await page.locator('#j-project-name').evaluate(el=>el.selectionStart===0&&el.selectionEnd===el.value.length));
 await page.locator('#j-project-name').fill('项目 A');await page.locator('#j-project-submit').click();
 assert.match(await page.locator('#j-project-error').textContent(),/同名/);assert.ok(await dialog.isVisible());
 const folder=path.join(profile,'项目资料');fs.mkdirSync(folder);
 await page.locator('#j-project-name').fill('项目 B 已更新');await page.locator('#j-project-root').fill(folder);
 await page.locator('#j-project-submit').click();await dialog.waitFor({state:'hidden'});
 assert.equal((await saved()).projects.find(p=>p.id==='b').name,'项目 B 已更新');
 assert.equal(path.normalize((await saved()).projects.find(p=>p.id==='b').root),folder);
 assert.deepEqual((await saved()).edits,preserved);
 await page.waitForFunction(()=>document.activeElement?.dataset.filter==='b');
 await page.keyboard.press('F2');assert.ok(await dialog.isVisible());
 await page.locator('#j-project-root').fill('');await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 assert.equal(path.normalize((await saved()).projects.find(p=>p.id==='b').root),folder);
 await navB.focus();await page.keyboard.press('Shift+F10');assert.ok(await dialog.isVisible());
 await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
 await saved();await exit();await launch();
 assert.equal((await saved()).projects.find(p=>p.id==='b').name,'项目 B 已更新');
 assert.equal(path.normalize((await saved()).projects.find(p=>p.id==='b').root),folder);
 assert.deepEqual((await saved()).edits,preserved);
 await page.locator('#j-project-nav [data-filter="b"]').click();assert.equal((await saved()).filter,'b');
 cases.push('Right-click edits the intended sidebar project without navigating; duplicate names are rejected, rename/folder changes preserve all idea bindings across restart, cancel discards edits, and keyboard shortcuts retain focus');
 await page.screenshot({path:path.join(root,'artifacts/project-bindings.png')});await exit();assert.deepEqual(errors,[]);
 const report={passed:true,cases,errors};fs.writeFileSync(path.join(root,'artifacts/project-bindings-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
