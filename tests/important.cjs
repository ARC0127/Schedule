const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-important-")),
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
fixture.WidgetState.privateContent.edits[day].important = true;
fixture.WidgetState.privateContent.edits["2020-01-02"] = {
  title: "历史重要记录",
  body: "• 保留这条记录",
  important: true,
  files: [],
};
for (let i = 1; i <= 10; i++)
  fixture.WidgetState.privateContent.edits[
    `2024-03-${String(i).padStart(2, "0")}`
  ] = { title: `归档 ${i}`, body: "", important: true, files: [] };
fixture.Schedules["2030-01-12"] = {
  Title: "仅有日程",
  Time: "10:30",
  At: "2030-01-12T10:30:00",
  RemindMinutes: -1,
  Important: true,
  Status: "off",
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

const row = (d) => page.locator(`[data-important-date="${d}"]`);
const expanded = () =>
  page.locator("#journal-ui").getAttribute("data-day-expanded");
const back = () =>
  page.getByRole("button", { name: "返回重要事项", exact: true }).click();
(async () => {
  try {
    await launch();
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('[data-filter="important"]').click();
    assert.equal(
      await page.locator("#j-overview-title").textContent(),
      "重要事项",
      "Important must open a dedicated all-date overview",
    );
    assert.equal(await page.locator(".j-calendar-pane").isVisible(), false);
    assert.equal(await page.locator(".j-ideas-pane").isVisible(), true);
    assert.equal(await page.locator(".j-important-row").count(), 10);
    assert.ok(
      (await page.locator("#j-overview-summary").textContent()).startsWith(
        "13 个重要日期",
      ),
    );
    assert.equal(await row(other).count(), 0);
    assert.ok((await row("2030-01-12").innerText()).includes("仅有日程"));
    assert.ok(await row(day).isVisible());
    cases.push(
      "dedicated important overview across months and years, excluding unmarked days, including schedule-only dates",
    );
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "artifacts/important-overview.png"),
    });
    await row(day).focus();
    await page.keyboard.press("Enter");
    assert.equal(await expanded(), "true");
    assert.equal(
      await page.locator("#j-entry-title").inputValue(),
      "研究与整理",
    );
    assert.equal(
      await page.locator("#j-entry-body").evaluate((el) => el.value),
      body,
    );
    assert.equal(await page.locator("#j-entry-body img").count(), 1);
    await back();
    assert.ok(await row(day).isVisible());
    assert.equal(
      await row(day).evaluate((el) => el === document.activeElement),
      true,
    );
    await row("2030-01-12").click();
    assert.ok(
      (await page.locator("#j-schedule-list").innerText()).includes("仅有日程"),
    );
    await page.keyboard.press("Escape");
    assert.notEqual(await expanded(), "true");
    assert.ok(await row("2030-01-12").isVisible());
    cases.push(
      "mouse and keyboard open exact full day, including images and schedule; back and Escape restore list",
    );
    await page.locator('[data-action="idea-page-next"]').click();
    assert.equal(await page.locator(".j-important-row").count(), 3);
    await row("2020-01-02").click();
    const title = page.locator("#j-entry-title");
    assert.equal(await title.inputValue(), "历史重要记录");
    await title.fill("历史记录已修改");
    await page.evaluate(() => window.journalFlush());
    await back();
    assert.ok((await row("2020-01-02").innerText()).includes("历史记录已修改"));
    assert.ok(
      (await page.locator("#j-idea-pagination").innerText()).includes("2 / 2"),
    );
    await row("2020-01-02").click();
    await page.locator('[data-action="important"]').click();
    await page.evaluate(() => window.journalFlush());
    await back();
    assert.equal(await row("2020-01-02").count(), 0);
    assert.ok(
      (await page.locator("#j-overview-summary").innerText()).startsWith(
        "12 个重要日期",
      ),
    );
    assert.equal(await page.locator(".j-nav-count").textContent(), "12");
    cases.push(
      "pagination, dated editing and removing importance update list and count without deleting records",
    );
    await page.locator('[data-filter="a"]').click();
    assert.equal(
      await page.locator("#j-overview-title").textContent(),
      "研究笔记",
    );
    assert.equal(await page.locator(".j-important-row").count(), 0);
    await page.locator('[data-filter="important"]').click();
    assert.ok((await page.locator("#j-idea-pagination").innerText()).includes("2 / 2"));
    await page.locator('[data-action="idea-page-prev"]').click();
    await page.setViewportSize({ width: 800, height: 720 });
    await row(day).click();
    assert.equal(await expanded(), "true");
    await back();
    assert.ok(await row(day).isVisible());
    await page.screenshot({
      path: path.join(root, "artifacts/important-narrow.png"),
    });
    cases.push("project navigation and narrow-window list/detail return");
    await page.evaluate(() => window.journalFlush());
    await exit();
    let saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(
      saved.WidgetState.privateContent.edits["2020-01-02"].title,
      "历史记录已修改",
    );
    assert.equal(
      saved.WidgetState.privateContent.edits["2020-01-02"].important,
      false,
    );
    assert.equal(saved.WidgetState.privateContent.edits[day].body, body);
    await launch();
    await page.locator('[data-filter="important"]').click();
    assert.equal(await page.locator(".j-nav-count").textContent(), "12");
    await row(day).click();
    assert.equal(
      await page.locator("#j-entry-body").evaluate((el) => el.value),
      body,
    );
    await exit();
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const r of Object.values(saved.WidgetState.privateContent.edits))
      r.important = false;
    for (const r of Object.values(saved.Schedules)) r.Important = false;
    fs.writeFileSync(file, JSON.stringify(saved));
    await launch();
    await page.locator('[data-filter="important"]').click();
    assert.equal(await page.locator(".j-important-row").count(), 0);
    assert.ok(
      (await page.locator("#j-overview-list").innerText()).includes(
        "暂无重要事项",
      ),
    );
    assert.equal(await page.locator("#j-idea-pagination").isVisible(), false);
    await exit();
    assert.deepEqual(errors, []);
    cases.push(
      "cold restart preserves dates and marks; empty state offers marking instructions",
    );
    const report = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/important-test.json"),
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
