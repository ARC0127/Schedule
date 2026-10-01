// Capture the real desktop UI with synthetic data in an isolated test profile.
// Run after building: node scripts/capture_screenshots.cjs
const { chromium } = require('playwright');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),net=require('node:net');
const {spawn}=require('node:child_process');
const root=path.resolve(__dirname,'..'), appDir=path.join(root,'dist/Schedule');
const profile=fs.mkdtempSync(path.join(os.tmpdir(),'schedule-screenshots-'));
const day='2026-09-24',today=new Date().toLocaleDateString('sv-SE');
const projects=[{id:'research',name:'研究笔记',root:''},{id:'product',name:'产品设计',root:''},{id:'reading',name:'阅读与灵感',root:''}];
const edits={};
function entry(date,title,lines,meta=[]) {
 const body=lines.map(s=>'• '+s).join('\n');
 edits[date]={title,body,files:[],ideas:[...body.matchAll(/^• /gm)].map((m,i)=>({id:date+'-'+i,offset:m.index,projectIds:['research'],done:false,...meta[i]}))};
}
for(const d of [1,2,3,5,7,8,9,10,11,14,15,16,17,18,21,22,23]) {
 entry(`2026-09-${String(d).padStart(2,'0')}`,['记录与思考','留一点时间给阅读','推进一个小目标'][d%3],Array.from({length:1+d%5},(_,i)=>['阅读并整理关键问题','记录实验中的观察','完善本周的设计草稿','把灵感整理为下一步行动','补充参考资料'][i]),Array.from({length:1+d%5},()=>({projectIds:[projects[d%3].id]})));
}
entry(day,'让想法慢慢成形',[
 '梳理研究问题，写下今天最值得继续探索的一步。',
 '整理实验记录，补充关键结论。',
 '下午讨论原型的交互细节。',
 '阅读笔记：\\(x_\\tau=(1-\\tau)\\epsilon+\\tau x\\)。\n  从一个简单的公式开始理解。',
 '把灵感留在这里，下次接着写。\n  [Schedule 开源仓库](https://github.com/ARC0127/Schedule)'
],[{projectIds:['research','reading']},{todo:true,done:true},{todo:true,important:true,projectIds:['product']},{projectIds:['research']},{projectIds:['reading']}]);
edits[day].important=true;
entry(today,'今天，专注几件小事', ['完成原型的交互走查','整理本周阅读笔记','分享实验进展','给下一次讨论留一份提纲'],[{todo:true,important:true,dueDate:today,projectIds:['product']},{todo:true,dueDate:today,projectIds:['reading']},{todo:true,projectIds:['research']},{projectIds:[]}]);
const future=new Date();future.setDate(future.getDate()+2);const later=future.toLocaleDateString('sv-SE');
entry(later,'下一步', ['整理参考资料与项目文件','完善第二版界面草稿'],[{todo:true,dueDate:later,projectIds:['research']},{todo:true,projectIds:['product']}]);
const schedules={
 demo:{Id:'demo',Date:day,Title:'原型讨论',Time:'14:30',At:day+'T14:30:00',RemindMinutes:-1,Important:true,Status:'off',IdeaDate:day,IdeaId:day+'-2'},
 today:{Id:'today',Date:today,Title:'分享实验进展',Time:'15:00',At:today+'T15:00:00',RemindMinutes:-1,Status:'off',IdeaDate:today,IdeaId:today+'-2'}
};
fs.writeFileSync(path.join(profile,'journal.json'),JSON.stringify({WidgetState:{privateContent:{projects,edits,selected:day,year:2026,month:8,filter:'all',view:'month',sidebar:'open',newIdeaProjects:['research']}},Schedules:schedules}));
let app,browser;const pause=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{try{
 const server=net.createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));const port=server.address().port;await new Promise(r=>server.close(r));
 const env={...process.env,SCHEDULE_TEST_DATA:profile,WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS:`--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion`};
 app=spawn(path.join(appDir,'Journal.exe'),[],{cwd:appDir,windowsHide:true,env});
 for(let i=0;i<150;i++){try{browser=await chromium.connectOverCDP(`http://127.0.0.1:${port}`);break;}catch{if(app.exitCode!==null)throw Error('Desktop app exited');await pause(100);}}
 if(!browser)throw Error('WebView2 did not start');
 const page=browser.contexts()[0].pages()[0];await page.waitForFunction(()=>window.journalReady);await page.setViewportSize({width:1440,height:940});
 await page.evaluate(date=>window.dispatchEvent(new CustomEvent('journal:open-date',{detail:date})),day);
 await page.locator('#j-entry-title').waitFor();await page.evaluate(()=>document.fonts.ready);await pause(600);
 fs.mkdirSync(path.join(root,'docs/images'),{recursive:true});
 await page.screenshot({path:path.join(root,'docs/images/home.png')});
 await page.locator('[data-filter="todo"]').click();await page.locator('[data-todo-status="pending"]').click();await page.locator('#j-todo-category').selectOption('all');await pause(400);
 await page.screenshot({path:path.join(root,'docs/images/tasks.png')});
 const stopped=new Promise(r=>app.once('exit',r));spawn(path.join(appDir,'Journal.exe'),['--exit'],{windowsHide:true,env});await Promise.race([stopped,pause(10000).then(()=>{throw Error('Exit timed out');})]);
 console.log(JSON.stringify({screenshots:['docs/images/home.png','docs/images/tasks.png'],syntheticData:true,profile}));
 }finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
