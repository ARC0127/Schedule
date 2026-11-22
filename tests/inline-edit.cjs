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
    path.join(os.tmpdir(), "schedule-inline-edit-"),
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
        [older]: record("• 历史待办\n  第二行\n• 多项目普通笔记\n• 已完成\n• ", [
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
fixture.WidgetState.privateContent.edits[older].formats = [{start:2,end:6,bold:true}];
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
async function api(request) {
  return new Promise((resolve, reject) => {
    const child = spawn(path.join(appDir, 'Schedule.Cli.exe'), [], {cwd:appDir,windowsHide:true,env});
    let output = '', error = '';
    child.stdout.on('data', data => output += data);
    child.stderr.on('data', data => error += data);
    child.on('error', reject);
    child.on('close', () => {try {resolve(JSON.parse(output));} catch {reject(Error(error || output));}});
    child.stdin.end(JSON.stringify(request));
  });
}
(async () => {
  try {
    await launch();
    const original = (await saved()).edits;
    await page.locator('[data-filter="b"]').click();
    const row = id => page.locator(`[data-idea-id="${id}"]`);
    const dailyBefore = await page.locator('#j-entry-body').evaluate(el => el.value);
    await row('historic').locator('.j-idea-open').first().dblclick();
    const inline = page.locator('.j-inline-idea-editor');
    await inline.waitFor();
    assert.equal(await page.locator('#j-entry-body').evaluate(el => el.value), dailyBefore);
    assert.equal(await inline.evaluate(el => el === document.activeElement), true);
    assert.equal(await row('historic').locator('.j-idea-bindings').count(), 0);
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('Tab');
    let data = await saved();
    assert.ok(data.edits[older].body.startsWith('• \t历史待办'));
    assert.equal(data.edits[older].ideas.length, original[older].ideas.length);
    const bold = data.edits[older].formats.find(r=>r.bold);
    assert.equal(data.edits[older].body.slice(bold.start,bold.end).replace(/\t/g,''), '历史待办');
    await page.keyboard.press('Control+z');
    data = await saved();
    assert.equal(data.edits[older].body, original[older].body);
    assert.deepEqual(data.edits[older].formats, original[older].formats);
    await page.keyboard.press('Control+Shift+z');
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('结构化补充 https://example.com/notes \\(x_\\tau=1\\)');
    const image = fs.readFileSync(path.join(root, 'assets/schedule-icon.png')).toString('base64');
    await inline.evaluate((el, base64) => {
      const dt = new DataTransfer();
      dt.items.add(new File([Uint8Array.from(atob(base64), c => c.charCodeAt(0))], 'inline.png', {type:'image/png'}));
      el.dispatchEvent(new ClipboardEvent('paste', {clipboardData:dt,bubbles:true,cancelable:true}));
    }, image);
    await page.waitForFunction(()=>document.querySelector('.j-inline-idea-editor img')?.complete);
    await page.keyboard.insertText(' 图片后');
    await page.keyboard.press('Control+a');
    const beforeIndent = (await saved()).edits[older];
    await page.keyboard.press('Tab');
    assert.equal(await inline.evaluate(el => el === document.activeElement), true);
    await page.keyboard.press('Shift+Tab');
    data = await saved();
    assert.equal(data.edits[older].body, beforeIndent.body);
    assert.deepEqual(data.edits[older].formats, beforeIndent.formats);
    for (const meta of original[older].ideas) {
      const after = data.edits[older].ideas.find(p=>p.id===meta.id);
      assert.deepEqual({...after,offset:meta.offset}, meta);
    }
    assert.deepEqual(data.edits[day], original[day]);
    await page.keyboard.press('Control+End');
    await inline.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionstart',{bubbles:true})));
    await page.keyboard.insertText(' 中文确认');
    assert.match((await api({op:'capabilities'})).error, /BUSY/);
    assert.ok((await saved()).edits[older].body.includes('中文确认'));
    await inline.evaluate(el=>el.dispatchEvent(new CompositionEvent('compositionend',{bubbles:true,data:'中文确认'})));
    assert.equal((await api({op:'capabilities'})).ok, true);
    assert.equal(await inline.evaluate(el=>el===document.activeElement),true);
    await page.locator('.j-inline-idea-actions button').click();
    assert.equal(await inline.count(), 0);
    assert.equal(await row('historic').locator('img').count(), 1);
    assert.equal(await row('historic').locator('.katex').count(), 1);
    assert.equal(await row('historic').locator('[data-external-url]').count(), 1);
    cases.push('Double-click edits in place, preserves original date, ID, task status, other ideas, formats, links, math and images; Tab and undo work');
    // Multi-project identity and metadata survive editing and switching views.
    await row('shared').locator('.j-idea-open').dblclick();
    await page.keyboard.press('Control+End'); await page.keyboard.insertText(' 更新');
    await page.locator('[data-filter="c"]').click();
    assert.match(await row('shared').innerText(), /更新/);
    data = await saved();
    assert.deepEqual(data.edits[older].ideas.find(p=>p.id==='shared').projectIds, ['b','c']);
    assert.equal(data.edits[older].ideas.length, original[older].ideas.length);
    // The composer has the same indentation and undo behavior.
    await page.locator('[data-filter="empty"]').click();
    const composer = page.locator('#j-project-compose-body'); await composer.click();
    await page.keyboard.insertText('第一层'); await page.keyboard.press('Enter'); await page.keyboard.insertText('第二层');
    await page.keyboard.press('Control+a'); await page.keyboard.press('Tab');
    data = await saved(); assert.ok(data.edits[day].body.endsWith('• \t第一层\n\t第二层'));
    await page.keyboard.press('Control+z');
    assert.ok((await saved()).edits[day].body.endsWith('• 第一层\n第二层'));
    await page.keyboard.press('Control+y'); await page.keyboard.press('Shift+Tab');
    assert.ok((await saved()).edits[day].body.endsWith('• 第一层\n第二层'));
    await page.keyboard.press('Shift+Enter');
    cases.push('Project composer supports multiline Tab, Shift+Tab and undo/redo without creating extra ideas');
    // Daily editor preserves structural markers and metadata through indentation.
    await page.evaluate(date=>window.dispatchEvent(new CustomEvent('journal:open-date',{detail:date})), day);
    const daily = page.locator('#j-entry-body'); await daily.click();
    const beforeDaily = (await saved()).edits[day];
    await page.keyboard.press('Control+a'); await page.keyboard.press('Tab');
    data = await saved();
    assert.equal(data.edits[day].ideas.length, beforeDaily.ideas.length);
    assert.deepEqual(data.edits[day].ideas.map(p=>p.id), beforeDaily.ideas.map(p=>p.id));
    assert.ok(data.edits[day].body.includes('• \t第一条想法'));
    await page.keyboard.press('Control+z');
    data = await saved(); assert.equal(data.edits[day].body, beforeDaily.body); assert.deepEqual(data.edits[day].ideas,beforeDaily.ideas);
    await page.keyboard.press('Control+y'); await page.keyboard.press('Shift+Tab');
    assert.equal((await saved()).edits[day].body, beforeDaily.body);
    cases.push('Daily Tab preserves all idea markers, bindings and IDs, supports undo/redo and outdent');
    await page.locator('[data-filter="b"]').click();
    await row('historic').locator('.j-idea-open').first().dblclick();
    await page.screenshot({path:path.join(root,'artifacts/inline-edit.png')});
    await page.keyboard.press('Escape');
    const beforeRestart = JSON.parse(fs.readFileSync(file,'utf8')).WidgetState;
    await exit(); await launch();
    const afterRestart = (await saved());
    assert.deepEqual(afterRestart.edits[older], beforeRestart.privateContent.edits[older]);
    assert.deepEqual(afterRestart.edits[day], beforeRestart.privateContent.edits[day]);
    await page.locator('[data-filter="b"]').click();
    assert.equal(await row('historic').locator('img').count(),1);
    assert.equal(await row('historic').locator('.katex').count(),1);
    cases.push('Original dates, metadata, formatting, indentation and image assets survive a cold native restart');
    await exit(); assert.deepEqual(errors,[]);
    const report={passed:true,cases,errors};
    fs.writeFileSync(path.join(root,'artifacts/inline-edit-test.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify(report));
  } finally {if(browser) await browser.close(); if(app && app.exitCode===null) app.kill();}
})().catch(e=>{console.error(e);process.exitCode=1;});
