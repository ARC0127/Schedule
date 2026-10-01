const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-core-")),
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
(async () => {
  try {
    await launch();
    await page.setViewportSize({ width: 1440, height: 960 });
    await selectDay();
    assert.equal(await page.locator(".j-event-row").count(), 1);
    await page.locator('[data-action="schedule"]').click();
    await page.locator("#j-schedule-title").fill("第二条安排");
    await page.locator("#j-schedule-time").fill("16:00");
    await page.locator("#j-remind").selectOption("-1");
    await page.locator("#j-schedule-important").check();
    await page.locator('[data-action="save-schedule"]').click();
    await page.waitForFunction(
      () => !document.querySelector("#j-schedule-dialog").open,
    );
    assert.equal(await page.locator(".j-event-row").count(), 2);
    await page
      .locator(".j-event-row")
      .last()
      .locator("[data-event-complete]")
      .click();
    await page.waitForFunction(
      () => document.querySelectorAll(".j-event-row.is-done").length === 1,
    );
    assert.equal(
      await page
        .locator(".j-event-row")
        .first()
        .locator("[data-event-complete]")
        .getAttribute("aria-pressed"),
      "false",
    );
    cases.push(
      "legacy event retained; second event and independent completion",
    );
    const editor = page.locator("#j-entry-body");
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(3, 3);
      el.dispatchEvent(new KeyboardEvent("keyup"));
    });
    await page.locator("#j-idea-menu-toggle").click();
    await page.locator("#j-idea-settings").click();
    await page.locator("#j-idea-important").check();
    await page.locator("#j-idea-due").fill("2030-01-05");
    await page.locator('[data-action="save-idea-settings"]').click();
    await page.waitForFunction(
      () => !document.querySelector("#j-idea-dialog").open,
    );
    await page.locator('[data-filter="a"]').click();
    assert.ok(
      (await page.locator("#j-overview-list").innerText()).includes(
        "2030-01-05",
      ),
    );
    await page.locator('[data-action="search"]').click();
    await page.locator("#j-search").fill("跨年份检索词");
    await page.locator('[data-search-date="1999-01-02"]').waitFor();
    await page.locator('[data-search-date="1999-01-02"]').click();
    assert.equal(await page.locator("#j-entry-title").inputValue(), "历史检索");
    assert.ok(
      (await editor.evaluate((el) => el.value)).includes("跨年份检索词"),
    );
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    assert.ok(
      await page.locator('[data-search-date="1999-01-02"]').isVisible(),
    );
    cases.push(
      "per-idea importance/deadline persists and global search opens exact historical idea",
    );
    await selectDay();
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(3, 7);
    });
    let response = await api({ op: "get_day", date: day });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(
      await editor.evaluate((el) => [
        el === document.activeElement,
        el.selectionStart,
        el.selectionEnd,
      ]),
      [true, 3, 7],
    );
    assert.equal(response.result.record.appointments.length, 2);
    assert.equal(response.result.record.ideas[0].dueDate, "2030-01-05");
    let revision = response.revision;
    await page.locator("#j-entry-title").fill("界面正在编辑");
    const conflict = await api({
      op: "add_idea",
      date: day,
      text: "不应写入",
      revision,
    });
    assert.equal(conflict.ok, false);
    assert.match(conflict.error, /CONFLICT/);
    response = await api({ op: "get_day", date: day });
    revision = response.revision;
    assert.equal(response.result.record.title, "界面正在编辑");
    const parallel = await Promise.all(
      ["Codex", "Claude Code"].map((name) =>
        api({
          op: "add_idea",
          date: day,
          text: name + " 写入测试",
          revision,
          projectIds: ["a"],
          important: true,
          dueDate: "2031-02-03",
        }),
      ),
    );
    assert.equal(
      parallel.filter((r) => r.ok).length,
      1,
      JSON.stringify(parallel),
    );
    assert.equal(
      parallel.filter((r) => !r.ok && /CONFLICT/.test(r.error)).length,
      1,
    );
    const added = parallel.find((r) => r.ok).result.idea;
    response = await api({ op: "get_day", date: day });
    const update = await api({
      op: "update_idea",
      date: day,
      id: added.id,
      text: "修改后内容",
      done: true,
      revision: response.revision,
    });
    assert.ok(update.ok, JSON.stringify(update));
    response = await api({ op: "get_day", date: day });
    assert.equal(
      response.result.record.ideas.find((p) => p.id === added.id).done,
      true,
    );
    assert.ok(response.result.record.body.includes("修改后内容"));
    const invalid = await api({
      op: "add_idea",
      date: day,
      text: "bad",
      projectIds: ["missing"],
      revision: response.revision,
    });
    assert.equal(invalid.ok, false);
    const afterInvalid = await api({ op: "get_day", date: day });
    assert.equal(afterInvalid.revision, response.revision);
    cases.push(
      "CLI reads live edits; stale revision rejected; two concurrent assistants permit exactly one write; stable IDs and rejected-input rollback",
    );
    response = await api({
      op: "save_event",
      date: day,
      revision: afterInvalid.revision,
      event: {
        title: "API 日程",
        time: "18:00",
        at: day + "T18:00:00",
        remindMinutes: -1,
        important: false,
        done: false,
      },
    });
    assert.ok(response.ok, JSON.stringify(response));
    const eventId = response.result.id;
    let read = await api({ op: "get_day", date: day });
    assert.equal(read.result.record.appointments.length, 3);
    const remove = await api({
      op: "delete_event",
      date: day,
      id: eventId,
      revision: read.revision,
    });
    assert.ok(remove.ok, JSON.stringify(remove));
    read = await api({ op: "get_project", id: "a" });
    assert.ok(read.result.ideas.some((r) => r.idea.id === added.id));
    read = await api({ op: "search", query: "跨年份检索词" });
    assert.ok(read.result.some((r) => r.id === "historic"));
    cases.push("CLI event create/delete, project query and global search");
    const run = async (command, args) =>
      new Promise((resolve, reject) => {
        const child = spawn(command, args, {
          windowsHide: true,
          env: { ...process.env, SCHEDULE_TEST_DATA: profile },
        });
        let out = "",
          err = "";
        child.stdout.on("data", (b) => (out += b));
        child.stderr.on("data", (b) => (err += b));
        child.on("error", reject);
        child.on("exit", (code) =>
          code === 0 ? resolve(out) : reject(Error(out + err)),
        );
      });
    await run("powershell", [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(appDir, "Install-AssistantSkills.ps1"),
      "-AppDirectory",
      appDir,
      "-CodexDirectory",
      path.join(profile, "codex"),
      "-ClaudeDirectory",
      path.join(profile, "claude"),
    ]);
    const requestFile = path.join(profile, "request.json");
    fs.writeFileSync(requestFile, JSON.stringify({ op: "get_day", date: day }));
    for (const client of ["codex", "claude"]) {
      const output = await run("powershell", [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        path.join(
          profile,
          client,
          "skills/schedule-local/scripts/schedule.ps1",
        ),
        "-RequestFile",
        requestFile,
      ]);
      const value = JSON.parse(output.replace(/^\uFEFF/, ""));
      assert.ok(value.ok);
      assert.equal(value.result.record.title, "界面正在编辑");
    }
    cases.push(
      "installed Codex and Claude Code skill helpers call the same live JSON API",
    );
    await page.locator('[data-action="data"]').click();
    await page.locator('[data-action="snapshot"]').click();
    await page.waitForFunction(() =>
      document
        .querySelector("#j-data-status")
        .textContent.includes("备份已保存"),
    );
    const historyId = await page
      .locator('[data-history^="manual-"]')
      .first()
      .getAttribute("data-history");
    await page.locator('[data-action="close-data"]').click();
    await page.locator("#j-entry-title").fill("恢复前的临时修改");
    await page.evaluate(() => window.journalFlush());
    await page.locator('[data-action="data"]').click();
    await page.locator(`[data-history="${historyId}"]`).click();
    await page.locator("#j-restore-history").waitFor();
    assert.ok(
      (await page.locator("#j-history-preview").textContent()).includes(
        "恢复前的临时修改",
      ),
    );
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "artifacts/core-history.png"),
    });
    await page.locator("#j-restore-history").click();
    await page.waitForEvent("load");
    await page.waitForFunction(() => window.journalReady);
    await selectDay();
    assert.equal(
      await page.locator("#j-entry-title").inputValue(),
      "界面正在编辑",
    );
    assert.ok(
      fs
        .readdirSync(path.join(profile, "history"))
        .some((n) => n.startsWith("before-restore-")),
    );
    assert.ok(
      fs
        .readdirSync(path.join(profile, "history"))
        .some((n) => n.startsWith("daily-")),
    );
    cases.push(
      "daily/manual history, actual diff preview, restore and pre-restore recovery copy",
    );
    await page.screenshot({ path: path.join(root, "artifacts/core-day.png") });
    await page.evaluate(() => window.journalFlush());
    await exit();
    await launch();
    await selectDay();
    response = await api({ op: "get_day", date: day });
    assert.ok(response.ok);
    assert.equal(response.result.record.appointments.length, 2);
    assert.equal(response.result.record.ideas[0].dueDate, "2030-01-05");
    assert.equal(
      response.result.record.ideas.find((p) => p.id === added.id).done,
      true,
    );
    assert.equal(await page.locator("#j-entry-body img").count(), 1);
    await exit();
    assert.deepEqual(errors, []);
    cases.push(
      "cold restart preserves multi-events, image, idea flags/deadlines and assistant edits",
    );
    const report = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/core-features-test.json"),
      JSON.stringify(report, null, 2),
    );
    console.log(JSON.stringify(report));
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode === null) app.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
