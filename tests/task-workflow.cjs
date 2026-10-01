const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-task-workflow-")),
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

async function setIdea(id, values) {
 const current=await api({op:'get_day',date:day});assert.ok(current.ok,JSON.stringify(current));
 const result=await api({op:'update_idea',date:day,id,revision:current.revision,...values});assert.ok(result.ok,JSON.stringify(result));return result;
}
async function todo(status='pending', category='all') {
 if(!await page.locator('[data-filter="todo"]').isVisible())await page.locator('[data-action="sidebar"]').click();
 await page.locator('[data-filter="todo"]').click();
 await page.locator(`[data-todo-status="${status}"]`).click();
 await page.locator('#j-todo-category').selectOption(category);
}
async function record(){return (await saved()).edits[day];}
async function idea(id){return (await record()).ideas.find(p=>p.id===id);}
(async()=>{
 try {
  await launch();await page.setViewportSize({width:1440,height:850});await selectDay();
  assert.equal((await idea('idea-0')).todo,true,'Legacy completed idea belongs to completed tasks');
  assert.equal((await idea('idea-1')).todo,undefined,'Ordinary note remains ordinary');
  const originalBody=(await record()).body, originalImage=fixture.WidgetState.nativeImages;
  await caret((await idea('idea-1')).offset+3);await page.keyboard.press('Control');
  assert.equal((await idea('idea-1')).done,true);assert.equal((await idea('idea-1')).todo,true);
  await todo('done');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);
  await page.locator('[data-todo-id="idea-1"] [data-complete-id]').click();
  await flush();assert.equal((await idea('idea-1')).done,false);assert.equal((await idea('idea-1')).todo,true);
  await todo();assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);
  await selectDay();await caret((await idea('idea-1')).offset+3);await menu();await page.locator('#j-idea-settings').click();
  await page.locator('#j-idea-state').selectOption('todo');await page.locator('#j-idea-important').check();await page.locator('#j-idea-due').fill(other);
  await page.locator('[data-action="save-idea-settings"]').click();await page.waitForFunction(()=>!document.querySelector('#j-idea-dialog').open);
  await todo('pending','important');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);assert.equal(await page.locator('[data-todo-id="other"]').count(),0);
  await todo('pending','basic');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),0);assert.equal(await page.locator('[data-todo-id="other"]').count(),1);
  cases.push('Legacy Ctrl completion, note/done/todo transitions, completed tab, priority filters and preserved content');

  // Create a linked reminder through the actual dialog, including its source-of-truth hint.
  await selectDay();await caret((await idea('idea-1')).offset+3);await menu();await page.locator('[data-action="idea-reminder"]').click();
  assert.equal(await page.locator('#j-schedule-idea').inputValue(),day+'/idea-1');
  assert.equal(await page.locator('#j-schedule-done').isDisabled(),true);
  await page.locator('#j-schedule-title').fill('Linked reminder');await page.locator('#j-remind').selectOption('-1');
  await page.locator('[data-action="save-schedule"]').click();await page.waitForFunction(()=>!document.querySelector('#j-schedule-dialog').open);
  await flush();let events=(await record()).appointments, linked=events.find(s=>s.ideaId==='idea-1');assert.ok(linked);assert.equal(linked.done,false);
  await todo('pending','scheduled');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);assert.equal(await page.locator(`[data-todo-id="${linked.id}"]`).count(),0);
  await selectDay();await page.locator(`[data-event-complete="${linked.id}"]`).click();await flush();
  assert.equal((await idea('idea-1')).done,true);assert.equal((await record()).appointments.find(s=>s.id===linked.id).done,true);
  let disk=JSON.parse(fs.readFileSync(file,'utf8'));assert.equal(Object.values(disk.Schedules).find(s=>s.Id===linked.id).Done,true);assert.equal(Object.values(disk.Schedules).find(s=>s.Id===linked.id).Status,'off');
  await page.locator('[data-action="undo-action"]').click();await flush();assert.equal((await idea('idea-1')).done,false);assert.equal((await record()).appointments.find(s=>s.id===linked.id).done,false);
  cases.push('Dialog links idea; event completion and undo share one idea state; reminder turns off; no duplicate task row');

  // The shared CLI must obey the same state transition and completion owner.
  await setIdea('idea-1',{taskState:'done'});
  assert.equal((await record()).appointments.find(s=>s.id===linked.id).done,true);
  let snapshot=await api({op:'get_day',date:day});
  let denied=await api({op:'save_event',date:day,id:linked.id,event:{...linked,done:false},revision:snapshot.revision});assert.equal(denied.ok,false);
  assert.equal((await idea('idea-1')).done,true);
  await setIdea('idea-1',{done:false});assert.equal((await idea('idea-1')).todo,true);
  await setIdea('idea-1',{taskState:'note'});
  const note=await idea('idea-1');assert.equal(note.done,false);assert.equal(note.todo,false);assert.equal(note.dueDate,'');
  assert.ok(!(await record()).appointments.find(s=>s.id===linked.id).ideaId,'Converting to note detaches but preserves standalone event');
  await todo();assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),0);assert.equal(await page.locator(`[data-todo-id="${linked.id}"]`).count(),1);
  cases.push('Codex/Claude CLI supports taskState and legacy fields; linked event cannot override completion; note conversion preserves standalone event');

  await setIdea('idea-1',{taskState:'todo'});
  snapshot=await api({op:'get_day',date:day});
  const cross=await api({op:'save_event',date:other,event:{title:'Cross-day reminder',time:'09:00',at:new Date(other+'T09:00:00').toISOString(),remindMinutes:-1,done:false,ideaDate:day,ideaId:'idea-1'},revision:snapshot.revision});assert.ok(cross.ok,JSON.stringify(cross));
  await setIdea('idea-1',{taskState:'done'});await todo('done','scheduled');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);
  await flush();assert.equal(await page.locator('[data-todo-status="done"]').getAttribute('aria-pressed'),'true');
  await flush();const before=JSON.parse(fs.readFileSync(file,'utf8'));
  assert.equal((await record()).body,originalBody);assert.deepEqual(before.WidgetState.nativeImages,originalImage);
  await exit();await launch();await page.setViewportSize({width:1440,height:850});await selectDay();
  assert.equal((await idea('idea-1')).done,true);assert.equal((await record()).body,originalBody);
  const after=JSON.parse(fs.readFileSync(file,'utf8'));assert.deepEqual(after.WidgetState.nativeImages,originalImage);
  assert.equal(Object.values(after.Schedules).find(s=>s.Id===cross.result.id).Done,true);
  await todo('done','scheduled');assert.equal(await page.locator('[data-todo-id="idea-1"]').count(),1);
  await page.screenshot({path:path.join(root,'artifacts/task-workflow.png')});
  await exit();assert.deepEqual(errors,[]);
  cases.push('Cross-day links, completed view, body/TeX/images/projects and native cold restart preserved');
  fs.writeFileSync(path.join(root,'artifacts/task-workflow-test.json'),JSON.stringify({passed:true,cases,errors},null,2));console.log(JSON.stringify({passed:true,cases,errors}));
 } finally {if(browser)await browser.close();if(app&&app.exitCode===null)app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
