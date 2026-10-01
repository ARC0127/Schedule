const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-usability-")),
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

for(let i=1;i<=24;i++) {
  const date=`1998-01-${String(i).padStart(2,'0')}`;
  fixture.WidgetState.privateContent.edits[date]={title:'旧记录 '+i,body:'• 查找记录 '+i+'\n  '+('详细说明 '.repeat(35)),files:[],ideas:[{id:'old-'+i,offset:0,projectIds:['a'],done:false}]};
}
fixture.WidgetState.privateContent.edits[other].ideas[0].todo=true;
fixture.WidgetState.privateContent.edits['1999-01-02'].ideas[0].dueDate='1999-01-03';
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
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${port}`,
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
  page.on("pageerror", (e) => {errors.push(String(e));console.error('PAGE',String(e));});
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

async function caret(start,end=start) {
  await page.locator('#j-entry-body').evaluate((el,[a,b])=>{el.focus();el.setSelectionRange(a,b);el.dispatchEvent(new KeyboardEvent('keyup'));},[start,end]);
}
async function flush() { await page.evaluate(()=>window.journalFlush()); }
async function menu() { await page.locator('#j-idea-menu-toggle').click(); }
async function saved() {await flush();return JSON.parse(fs.readFileSync(file,'utf8')).WidgetState.privateContent;}
(async()=>{
 try {
  await launch();await page.setViewportSize({width:1440,height:800});await selectDay();
  assert.equal(await page.locator('.j-format-tools').isVisible(),false);
  await caret(3,8);assert.ok(await page.locator('.j-format-tools').isVisible());
  await page.locator('[data-format="bold"]').click();
  await caret(8);assert.equal(await page.locator('.j-format-tools').isVisible(),false);
  await page.locator('[data-action="toggle-format"]').click();
  await page.locator('#j-font-size').selectOption('20');
  await page.locator('#j-entry-body').press('Q');
  assert.ok((await saved()).edits[day].formats.some(r=>r.size===20));
  await page.locator('[data-action="toggle-format"]').click();
  await caret(4);await menu();await page.locator('#j-idea-settings').click();
  await page.locator('#j-idea-state').selectOption('done');await page.locator('[data-action="save-idea-settings"]').click();
  await page.waitForFunction(()=>!document.querySelector('#j-idea-dialog').open);
  assert.equal((await saved()).edits[day].ideas[0].todo,true);
  cases.push('Contextual formatting, explicit typing format, compact idea menu and explicit todo flag');

  await page.locator('[data-filter="todo"]').click();
  assert.equal(await page.locator('.j-todo-row').count(),3); // done idea excluded, one event, two ideas
  assert.ok((await page.locator('#j-overview-list').innerText()).includes('已逾期'));
  assert.ok((await page.locator('#j-overview-list').innerText()).includes('无日期'));
  assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),0);
  await page.locator('[data-todo-id="other"] [data-complete-id]').click();
  await page.waitForFunction(()=>!document.querySelector('[data-todo-id="other"]'));
  await page.locator('[data-action="undo-action"]').click();
  await page.locator('[data-todo-id="other"]').waitFor();
  await page.locator('[data-todo-id="other"] .j-todo-open').click();
  assert.equal(await page.locator('#journal-ui').getAttribute('data-day-expanded'),'true');
  assert.ok((await page.locator('#j-entry-body').innerText()).includes('另一条记录'));
  await page.getByRole('button',{name:'返回待办',exact:true}).click();
  const eventButton=page.locator('.j-todo-row [data-event-complete]');
  await page.evaluate(()=>{
    const native=window.journalNative;window.originalCall=native.call;window.eventSaves=0;
    native.call=async function(...args){if(args[0]==='saveSchedule'){window.eventSaves++;await new Promise(r=>setTimeout(r,150));}return window.originalCall.apply(this,args);};
    const b=document.querySelector('.j-todo-row [data-event-complete]');b.click();b.click();b.click();
  });
  await page.waitForFunction(()=>!document.querySelector('.j-todo-row [data-event-complete]'));
  assert.equal(await page.evaluate(()=>window.eventSaves),1);
  await page.evaluate(()=>{window.journalNative.call=window.originalCall;delete window.originalCall;});
  await page.locator('[data-action="undo-action"]').click();
  await page.locator('.j-todo-row [data-event-complete]').waitFor();
  cases.push('Todo groups exclude ordinary/completed notes; cross-day event and idea completion support undo and exact navigation');

  await selectDay();await caret(4);await menu();
  await page.locator('[data-action="bind-active-idea"]').click();
  await page.locator('[data-link-project="a"]').uncheck();
  assert.deepEqual((await saved()).edits[day].ideas[0].projectIds,[]);
  await page.locator('[data-action="undo-action"]').click();
  assert.deepEqual((await saved()).edits[day].ideas[0].projectIds,['a']);
  await page.locator('[data-action="close-project-picker"]').click();
  await caret(4);await menu();const before=(await saved()).edits[day];
  await page.locator('[data-action="delete-idea"]').click();
  assert.equal((await saved()).edits[day].ideas.length,before.ideas.length-1);
  await page.locator('#j-entry-title').fill('删除之后的新标题');
  await page.locator('[data-action="undo-action"]').click();
  let record=(await saved()).edits[day];
  assert.equal(record.body,before.body);assert.deepEqual(record.ideas,before.ideas);assert.deepEqual(record.formats,before.formats);
  assert.equal(record.title,'删除之后的新标题');
  for (const text of ['核对公式','参考图片']) {
    const prior=(await saved()).edits[day];
    await caret(prior.body.indexOf(text)+1);await menu();
    await page.locator('[data-action="delete-idea"]').click();
    assert.equal((await saved()).edits[day].body.includes(text),false);
    await page.locator('[data-action="undo-action"]').click();
    const restored=(await saved()).edits[day];
    assert.equal(restored.body,prior.body);assert.deepEqual(restored.ideas,prior.ideas);assert.deepEqual(restored.formats,prior.formats);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(file,'utf8')).WidgetState.nativeImages,fixture.WidgetState.nativeImages);
  await caret(4);await menu();await page.locator('[data-action="delete-idea"]').click();
  const snapshot=await api({op:'get_day',date:day});
  const added=await api({op:'add_idea',date:day,text:'后来由助手添加',todo:true,revision:snapshot.revision});assert.ok(added.ok,JSON.stringify(added));
  assert.equal(added.result.idea.todo,true);
  await page.locator('[data-action="undo-action"]').click();
  assert.ok((await page.locator('#j-toast').innerText()).includes('未覆盖新内容'));
  record=(await saved()).edits[day];assert.ok(record.body.includes('后来由助手添加'));
  cases.push('Undo restores idea metadata, formats, TeX and images; preserves unrelated title; refuses to overwrite newer assistant content; API supports explicit todo');

  await page.locator('[data-filter="a"]').click();
  await page.locator('[data-action="idea-page-next"]').click();
  const pageText=await page.locator('#j-idea-pagination').innerText();
  await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop=350);await pause(400);
  const projectScroll=await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop);assert.ok(projectScroll>200);
  await page.locator('[data-filter="important"]').click();await page.locator('[data-filter="a"]').click();await pause(100);
  assert.equal(await page.locator('#j-idea-pagination').innerText(),pageText);
  assert.ok(Math.abs(await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop)-projectScroll)<3);
  await page.locator('[data-action="search"]').click();await page.locator('#j-search').fill('查找记录');
  await page.waitForFunction(()=>document.querySelectorAll('[data-search-date]').length===10);
  await page.locator('[data-action="idea-page-next"]').click();
  const searchPage=await page.locator('#j-idea-pagination').innerText();
  await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop=200);await pause(400);
  // Choose a visible row to avoid test-driver auto-scroll changing the expected user position.
  const target=await page.locator('[data-search-date]').evaluateAll(rows=>rows.find(el=>{const r=el.getBoundingClientRect();return r.top>80&&r.bottom<700;})?.dataset.searchDate);
  assert.ok(target);const searchScroll=await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop);
  await page.locator(`[data-search-date="${target}"]`).click();
  await page.getByRole('button',{name:'返回搜索结果',exact:true}).click();await pause(100);
  assert.equal(await page.locator('#j-idea-pagination').innerText(),searchPage);
  assert.ok(Math.abs(await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop)-searchScroll)<3);
  await page.locator('#j-sidebar-resizer').focus();await page.keyboard.press('ArrowRight');
  const width=(await saved()).sidebarWidth;
  await page.screenshot({path:path.join(root,'artifacts/usability-search.png')});
  await page.locator(`[data-search-date="${target}"]`).click();await flush();
  await exit();app=null;await launch();await page.setViewportSize({width:1440,height:800});
  assert.equal(await page.locator('#journal-ui').getAttribute('data-day-expanded'),'true');
  assert.equal((await saved()).sidebarWidth,width);
  await page.getByRole('button',{name:'返回搜索结果',exact:true}).click();await pause(100);
  assert.equal(await page.locator('#j-idea-pagination').innerText(),searchPage);
  assert.ok(Math.abs(await page.locator('.j-ideas-pane').evaluate(el=>el.scrollTop)-searchScroll)<3);
  assert.ok((await saved()).edits[other].ideas[0].todo);
  if(!await page.locator('[data-filter="todo"]').isVisible())await page.locator('[data-action="sidebar"]').click();
  await page.locator('[data-filter="todo"]').click();await page.screenshot({path:path.join(root,'artifacts/usability-todo.png')});
  await page.setViewportSize({width:780,height:720});
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  cases.push('Per-view pagination/scroll restored on back and view switches; width and expansion preserved across cold restart; narrow layout fits');
  assert.deepEqual(errors,[]);
  const report={passed:true,cases,errors};fs.writeFileSync(path.join(root,'artifacts/usability-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 } catch(error) {
   if(page) {await page.screenshot({path:path.join(root,'artifacts/usability-failure.png')}).catch(()=>{});console.error('STATE',await page.evaluate(()=>({body:document.querySelector('#j-entry-body').value,selection:[document.querySelector('#j-entry-body').selectionStart,document.querySelector('#j-entry-body').selectionEnd]})).catch(()=>null));}
   throw error;
 } finally {if(app&&app.exitCode===null)await exit();}
})().catch(e=>{console.error(e);process.exitCode=1;});
