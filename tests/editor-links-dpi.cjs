const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-links-dpi-")),
  file = path.join(profile, "journal.json");
const now = new Date(),
  month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
  day = month + "-10",
  other = month + "-11";
const body =
  "• 整理今天的研究思路，补充实验记录。\n  保留多行说明和项目绑定。\n• 核对公式 \\(x_\\tau=(1-\\tau)\\epsilon+\\tau x.\\)\n• 参考图片 \uE000";
const ideas = [...body.matchAll(/^• /gm)].map((m, i) => ({
  id: `idea-${i}`,
  offset: m.index,
  done: i === 0,
  projectIds: ["a"],
}));
const resource = path.join(profile, "notes.txt");
fs.writeFileSync(resource, "Synthetic test resource");
const fixture = {
  WidgetState: {
    nativeImages: [
      [
        "\uE000",
        {
          name: "演示图片",
          status: "ready",
          src:
            "data:image/png;base64," +
            fs
              .readFileSync(path.join(root, "assets/schedule-icon.png"))
              .toString("base64"),
        },
      ],
    ],
    privateContent: {
      projects: [{ id: "a", name: "研究笔记", root: "" }],
      sidebar: "open",
      year: now.getFullYear(),
      month: now.getMonth(),
      selected: day,
      filter: "all",
      view: "month",
      edits: {
        [day]: {
          title: "研究与整理",
          body,
          ideas,
          files: [{ name: "notes.txt", path: resource, kind: "file" }],
        },
        [other]: {
          title: "下一天",
          body: "• 另一条记录",
          ideas: [{ id: "other", offset: 0, done: false, projectIds: [] }],
          files: [],
        },
      },
    },
  },
  Schedules: {
    [day]: {
      Title: "阶段讨论",
      Time: "14:30",
      At: day + "T14:30:00",
      RemindMinutes: -1,
      Important: false,
      Status: "off",
    },
  },
};
fixture.WidgetState.privateContent.edits["1999-01-02"] = {
  title: "历史检索",
  body: "• 跨年份检索词",
  files: [],
  ideas: [{ id: "historic", offset: 0, done: false, projectIds: ["a"] }],
};

const links='\n• 资料 https://example.org/paper?q=1&lang=zh。 [文档](https://example.org/docs) "C:\\研究资料\\paper.pdf"\n  \\(\\text{https://math.invalid}\\) [不安全](javascript:alert(1))';
fixture.WidgetState.privateContent.edits[day].body+=links;
fixture.WidgetState.privateContent.edits[day].ideas.push({id:'links',offset:body.length+1,done:false,projectIds:['a']});
fs.writeFileSync(file, JSON.stringify(fixture));
let app, browser, page;
const errors = [],
  cases = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function launch() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const port = server.address().port;
  await new Promise((r) => server.close(r));
  app = spawn(path.join(appDir, "Journal.exe"), [], {
    cwd: appDir,
    windowsHide: true,
    env: {
      ...process.env,
      SCHEDULE_TEST_DATA: profile,
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
}
async function exit() {
  const stopped = new Promise((r) => app.once("exit", r));
  spawn(path.join(appDir, "Journal.exe"), ["--exit"], {
    windowsHide: true,
    env: { ...process.env, SCHEDULE_TEST_DATA: profile },
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

async function api(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(appDir, "Schedule.Cli.exe"), [], {
      windowsHide: true,
      env: { ...process.env, SCHEDULE_TEST_DATA: profile },
    });
    let out = "",
      err = "";
    child.stdout.on("data", (b) => (out += b));
    child.stderr.on("data", (b) => (err += b));
    child.on("error", reject);
    child.on("exit", (code) => {
      try {
        resolve({ ...JSON.parse(out.replace(/^\uFEFF/, "")), exitCode: code });
      } catch (e) {
        reject(Error(out + " " + err));
      }
    });
    child.stdin.end(JSON.stringify(request));
  });
}
async function selectDay() {
  await page.locator('[data-filter="all"]').click();
  await page.evaluate(
    (date) =>
      window.dispatchEvent(
        new CustomEvent("journal:open-date", { detail: date }),
      ),
    day,
  );
}

const {execFileSync}=require('node:child_process');
const probe=(...args)=>JSON.parse(execFileSync(process.env.SCHEDULE_PYTHON||'python',[path.join(root,'tests/display_probe.py'),'--pid',String(app.pid),...args],{encoding:'utf8',windowsHide:true}));
async function caret(a,b=a){await page.locator('#j-entry-body').evaluate((el,[a,b])=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new KeyboardEvent('keyup'));},[a,b]);}
async function value(){return page.locator('#j-entry-body').evaluate(el=>el.value);}
(async()=>{
 try {
  await launch();
  await selectDay();await page.locator(`.j-calendar-pane [data-date="${day}"]`).dblclick();
  const original=fixture.WidgetState.privateContent.edits[day].body;
  assert.equal(await value(),original);
  assert.equal(await page.locator('#j-entry-body [data-editor-link="url"]').count(),2);
  assert.equal(await page.locator('#j-entry-body [data-editor-link="path"]').count(),1);
  assert.equal(await page.locator('[data-link-target="https://example.org/docs"]').innerText(),'文档');
  await page.evaluate(()=>{
    window.openRequests=[];const native=window.journalNative, original=native.call;
    native.call=function(method,payload,...args){if(['openExternal','openPath'].includes(method)){window.openRequests.push({method,payload});return Promise.resolve({});}return original.call(this,method,payload,...args);};
  });
  await page.locator('[data-link-target="https://example.org/docs"]').click();
  assert.equal(await page.evaluate(()=>window.openRequests.length),1);
  await caret(original.length);await page.keyboard.insertText(' https://example.net/live');
  await page.locator('[data-link-target="https://example.net/live"]').waitFor();
  assert.equal(await value(),original+' https://example.net/live');
  assert.ok((await page.locator('[data-link-target="https://example.org/docs"]').innerText()).startsWith('[文档]'));
  const link=page.locator('[data-link-target="https://example.net/live"]');
  await link.click();assert.equal(await page.evaluate(()=>window.openRequests.length),1);
  await link.click({modifiers:['Control']});
  assert.equal(await page.evaluate(()=>window.openRequests.length),2);
  await page.evaluate(()=>window.journalFlush());
  let saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal(saved.WidgetState.privateContent.edits[day].ideas.find(p=>p.id==='links').done,false);
  const text=await value(),start=text.indexOf('example.net');
  await caret(start,start+'example.net'.length);await page.keyboard.insertText('example.com');
  await page.locator('[data-link-target="https://example.com/live"]').waitFor();
  await caret(start,start+7);await page.keyboard.press('Control+b');
  await page.locator('#j-entry-title').focus();
  assert.equal(await value(),text.replace('example.net','example.com'));
  await page.locator('#j-entry-body [data-editor-link="path"]').click();
  assert.equal(await page.evaluate(()=>window.openRequests.at(-1).method),'openPath');
  assert.equal(await page.locator('[data-link-target="https://math.invalid"]').count(),0);
  assert.equal(await page.locator('#j-entry-body [href^="javascript:"]').count(),0);
  await page.locator('[data-link-target="https://example.org/docs"]').focus();await page.keyboard.press('Enter');
  assert.equal(await page.evaluate(()=>window.openRequests.at(-1).payload.url),'https://example.org/docs');
  const finalText=await value();await page.evaluate(()=>window.journalFlush());
  cases.push('Expanded and live editor render web/Markdown/local links; Ctrl-click opens during editing without completion; exact raw source, caret edits, formats and safe schemes preserved');
  const initial=probe();assert.ok(initial.window.perMonitorV2,JSON.stringify(initial));
  const transitions=[];
  for(const index of [...initial.monitors.keys(),0]) {
    const native=probe('--move-monitor',String(index));
    const expected=native.monitors[index].scale/100;
    await page.waitForFunction(expected=>Math.abs(devicePixelRatio-expected)<.02,expected);
    const web=await page.evaluate(()=>({dpr:devicePixelRatio,width:innerWidth,height:innerHeight,overflow:document.documentElement.scrollWidth>innerWidth}));
    assert.equal(native.window.dpi,Math.round(96*expected));assert.ok(native.window.perMonitorV2);assert.equal(web.overflow,false);
    assert.equal(await value(),finalText);
    transitions.push({monitor:index,scale:native.monitors[index].scale,native:native.window,web});
    await page.screenshot({path:path.join(root,`artifacts/editor-monitor-${index}.png`)});
  }
  cases.push('Actual isolated native window moves across available physical monitors and back; per-monitor V2, native DPI and WebView devicePixelRatio match without text changes');
  await exit();await launch();await selectDay();assert.equal(await value(),finalText);
  assert.equal(await page.locator('[data-link-target="https://example.com/live"]').count(),1);
  assert.equal(await page.locator('#j-entry-body img').count(),1);
  await page.evaluate(()=>window.journalFlush());saved=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.ok(saved.WidgetState.privateContent.edits[day].formats.some(r=>r.bold));
  assert.deepEqual(saved.WidgetState.nativeImages,fixture.WidgetState.nativeImages);
  const dockChecks=[];
  for (const index of initial.monitors.keys()) {
    await exit();
    const store=JSON.parse(fs.readFileSync(file,'utf8'));
    store.Dock={Monitor:initial.monitors[index].device,Edge:'left',Fraction:.2};fs.writeFileSync(file,JSON.stringify(store));
    await launch();await page.evaluate(()=>window.journalNative.call('minimize'));await pause(500);
    const dock=probe('--title','Schedule · Today'),scale=initial.monitors[index].scale/100;
    assert.ok(dock.window.perMonitorV2);assert.equal(dock.window.dpi,Math.round(96*scale));
    assert.ok([Math.round(44*scale),Math.round(320*scale)].includes(dock.window.width),JSON.stringify(dock));
    if(dock.window.width===Math.round(44*scale))assert.equal(dock.window.height,Math.round(52*scale));
    dockChecks.push({monitor:index,...dock.window});
  }
  cases.push('Floating icon/preview uses each saved physical monitor DPI and scaled dimensions');
  assert.deepEqual(errors,[]);cases.push('Native cold restart retains links, formulas, images, styles and idea IDs');
  const report={passed:true,cases,transitions,dockChecks,errors};fs.writeFileSync(path.join(root,'artifacts/editor-links-dpi-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } finally {if(app&&app.exitCode===null)await exit();}
})().catch(e=>{console.error(e);process.exitCode=1;});
