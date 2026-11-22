const { chromium } = require("playwright");
const assert = require("node:assert/strict"),
  fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(
    path.join(os.tmpdir(), "schedule-image-preview-"),
  ),
  file = path.join(profile, "journal.json");
const day = new Date().toLocaleDateString("sv-SE"),
  older = "2025-01-02";
function record(body, meta) {
  return {
    title: "项目关联验证",
    body,
    files: [],
    ideas: [...body.matchAll(/^• /gm)].map((m, i) => ({
      offset: m.index,
      done: false,
      ...meta[i],
    })),
  };
}
const fixture = {
  WidgetState: {
    privateContent: {
      projects: [
        { id: "a", name: "项目 A", root: "" },
        { id: "b", name: "项目 B", root: "" },
        { id: "c", name: "项目 C", root: "" },
        { id: "empty", name: "空项目", root: "" },
      ],
      newIdeaProjects: ["a"],
      sidebar: "open",
      filter: "all",
      view: "month",
      selected: day,
      edits: {
        [day]: record(
          "开头的普通文字\n• 第一条想法\n• 第二条已完成\n• 第三条普通笔记",
          [
            { id: "first", projectIds: ["a"] },
            { id: "second", projectIds: ["a"], done: true },
            { id: "third", projectIds: ["b"] },
          ],
        ),
        [older]: record("• 历史待办\n• 多项目普通笔记\n• 已完成\n• ", [
          { id: "historic", projectIds: ["b"], todo: true },
          { id: "shared", projectIds: ["b", "c"] },
          { id: "done", projectIds: ["c"], done: true },
          { id: "blank", projectIds: ["b"] },
        ]),
      },
    },
  },
  Schedules: {},
};
fs.writeFileSync(file, JSON.stringify(fixture));
let app, browser, page;
const errors = [],
  cases = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env, SCHEDULE_TEST_DATA: profile };
async function launch() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  app = spawn(path.join(appDir, "Journal.exe"), [], {
    cwd: appDir,
    windowsHide: true,
    env: {
      ...env,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port} --disable-features=CalculateNativeWinOcclusion`,
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
      break;
    } catch {
      if (app.exitCode !== null) throw Error("App exited");
      await pause(100);
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForFunction(() => window.journalReady);
  await page.setViewportSize({ width: 1440, height: 900 });
}
async function exit() {
  const stopped = new Promise((r) => app.once("exit", r));
  spawn(path.join(appDir, "Journal.exe"), ["--exit"], {
    windowsHide: true,
    env,
  });
  await Promise.race([
    stopped,
    pause(10000).then(() => {
      throw Error("Exit timed out");
    }),
  ]);
  await browser.close();
  browser = null;
}
async function saved() {
  await page.evaluate(() => window.journalFlush());
  return JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent;
}
async function pasteImage(field, bytes, name, type) {
  await field.evaluate((el, value) => {
    const dt = new DataTransfer();
    dt.items.add(new File([Uint8Array.from(atob(value.base64), c=>c.charCodeAt(0))],value.name,{type:value.type}));
    el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:dt,bubbles:true,cancelable:true}));
  }, {base64:bytes.toString('base64'),name,type});
  await page.waitForFunction(selector=>[...document.querySelectorAll(selector+' img')].every(img=>img.complete && img.naturalWidth>0), await field.getAttribute('id') ? '#'+await field.getAttribute('id') : '.j-inline-idea-editor');
  await saved();
}
function imageState(){return JSON.parse(fs.readFileSync(file,'utf8')).WidgetState.nativeImages;}
(async()=>{try{
  await launch();
  const raw=await page.evaluate(()=>{const c=document.createElement('canvas');c.width=2400;c.height=1600;const x=c.getContext('2d');x.fillStyle='#356b4c';x.fillRect(0,0,c.width,c.height);x.fillStyle='white';x.font='64px sans-serif';x.fillText('Original image 2400 × 1600',100,150);return c.toDataURL('image/jpeg',.91).split(',')[1];});
  const encoded=Buffer.from(raw,'base64'), extra=Buffer.from('Schedule original image metadata');
  const jpeg=Buffer.concat([encoded.subarray(0,2),Buffer.from([255,239,0,extra.length+2]),extra,encoded.subarray(2)]);
  const png=fs.readFileSync(path.join(root,'assets/schedule-icon.png'));
  await page.locator('[data-filter="empty"]').click();
  const composer=page.locator('#j-project-compose-body');await composer.click();await page.keyboard.insertText('原图记录 ');
  await pasteImage(composer,jpeg,'原图.jpg','image/jpeg');await page.keyboard.insertText(' 第二张 ');await pasteImage(composer,png,'原图.png','image/png');
  let assets=imageState();assert.equal(assets.length,2);
  for(const [name,bytes] of [['原图.jpg',jpeg],['原图.png',png]]){
    const asset=assets.find(([,a])=>a.name===name)[1];assert.deepEqual(Buffer.from(asset.src.split(',')[1],'base64'),bytes);
  }
  const jpegSource=assets.find(([,a])=>a.name==='原图.jpg')[1].src;
  const dialog=page.locator('#j-image-dialog'), full=page.locator('#j-image-full'), stage=page.locator('#j-image-stage');
  await composer.locator('img').first().click();await dialog.waitFor({state:'visible'});
  await page.waitForFunction(()=>document.querySelector('#j-image-full').naturalWidth===2400);
  assert.equal(await full.getAttribute('src'),jpegSource);
  const fit=await full.boundingBox(), viewport=await stage.boundingBox();assert.ok(fit.width<=viewport.width && fit.height<=viewport.height);
  assert.equal(await dialog.locator('button, .j-image-toolbar, .j-image-help').count(),0);
  await full.dblclick();assert.ok(Math.abs((await full.boundingBox()).width-fit.width)<.01);
  await full.hover();await page.mouse.wheel(0,-200);
  await page.waitForFunction(width=>document.querySelector('#j-image-full').getBoundingClientRect().width>width,fit.width);
  await page.mouse.wheel(0,-200);await page.mouse.wheel(0,-200);
  await page.waitForFunction(()=>document.querySelector('#j-image-full').getBoundingClientRect().width>document.querySelector('#j-image-stage').clientWidth);
  const b=await stage.boundingBox(),x=b.x+b.width/2,y=b.y+b.height/2;
  const beforePan=await stage.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));
  await page.mouse.move(x,y);await page.mouse.down();await page.mouse.move(x-120,y-80,{steps:5});await page.mouse.up();
  const afterPan=await stage.evaluate(el=>({left:el.scrollLeft,top:el.scrollTop}));assert.ok(afterPan.left>beforePan.left+100 && afterPan.top>beforePan.top+60);
  assert.ok(await dialog.isVisible());
  await page.mouse.click(5,5);await dialog.waitFor({state:'hidden'});
  await composer.locator('img').first().click();await dialog.waitFor({state:'visible'});
  await page.setViewportSize({width:600,height:500});
  await page.waitForFunction(()=>{const i=document.querySelector('#j-image-full').getBoundingClientRect(),s=document.querySelector('#j-image-stage').getBoundingClientRect();return i.width<=s.width && i.height<=s.height;});
  await stage.click({position:{x:3,y:3}});await dialog.waitFor({state:'hidden'});
  await composer.locator('img').first().click();await dialog.waitFor({state:'visible'});
  await page.setViewportSize({width:1440,height:900});
  await page.screenshot({path:path.join(root,'artifacts/image-preview.png')});
  await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await composer.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.press('Control+End');await page.keyboard.insertText(' 预览后继续写');await page.keyboard.press('Shift+Enter');
  cases.push('PNG and JPEG with custom metadata retain identical original bytes; minimal preview fits, has no toolbar or hints, ignores double-click zoom, supports wheel zoom and panning, closes on outside clicks and returns to writing');
  const overview=page.locator('.j-overview-idea').first();
  const recordBefore=(await saved()).edits[day];
  await overview.locator('.j-idea-image').first().click();await dialog.waitFor({state:'visible'});assert.equal(await page.locator('.j-inline-idea-editor').count(),0);
  await page.mouse.click(5,5);await dialog.waitFor({state:'hidden'});
  await overview.locator('.j-idea-image').first().focus();await page.keyboard.press('Enter');await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');
  assert.deepEqual((await saved()).edits[day],recordBefore);
  await overview.locator('.j-idea-open').first().dblclick();const inline=page.locator('.j-inline-idea-editor');await inline.waitFor();await page.keyboard.press('Control+End');
  await inline.locator('img').first().click();await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await inline.evaluate(el=>el===document.activeElement),true);
  await page.keyboard.insertText(' 原地继续');assert.ok((await saved()).edits[day].body.endsWith(' 原地继续'));
  await page.locator('.j-inline-idea-actions button').click();
  cases.push('Project image single-click opens preview without entering idea editing; keyboard preview works; inline preview restores caret and preserves original image bytes');
  await page.evaluate(date=>window.dispatchEvent(new CustomEvent('journal:open-date',{detail:date})),day);
  const daily=page.locator('#j-entry-body');await daily.focus();
  await daily.locator('img').first().click();await dialog.waitFor({state:'visible'});await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});
  assert.equal(await daily.evaluate(el=>el===document.activeElement),true);
  await daily.evaluate(el=>el.setSelectionRange(el.value.length,el.value.length));await pasteImage(daily,jpeg,'日历原图.jpg','image/jpeg');
  assets=imageState();assert.equal(assets.length,3);assert.deepEqual(Buffer.from(assets.find(([,a])=>a.name==='日历原图.jpg')[1].src.split(',')[1],'base64'),jpeg);
  const before=JSON.parse(fs.readFileSync(file,'utf8')).WidgetState;
  await exit();await launch();await saved();
  const after=JSON.parse(fs.readFileSync(file,'utf8')).WidgetState;assert.deepEqual(after.nativeImages,before.nativeImages);assert.deepEqual(after.privateContent.edits,before.privateContent.edits);
  await page.locator('#j-entry-body img').first().click();await page.locator('#j-image-dialog').waitFor({state:'visible'});assert.equal(await page.locator('#j-image-full').getAttribute('src'),jpegSource);await page.keyboard.press('Escape');
  cases.push('Daily editor preview and insertion preserve exact bytes; all images and records survive a cold native restart');
  await exit();assert.deepEqual(errors,[]);
  const report={passed:true,cases,errors};fs.writeFileSync(path.join(root,'artifacts/image-preview-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}})().catch(e=>{console.error(e);process.exitCode=1;});
