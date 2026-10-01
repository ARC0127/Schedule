const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-calendar-")),
  file = path.join(profile, "journal.json");
const entry = {
  title: "Yesterday",
  body: "• preserved idea",
  files: [],
  ideas: [{ id: "stable", offset: 0, projectIds: ["project"], done: true }],
};
fs.writeFileSync(
  file,
  JSON.stringify({
    WidgetState: {
      privateContent: {
        projects: [{ id: "project", name: "Calendar test", root: "" }],
        selected: "2026-09-30",
        year: 2026,
        month: 8,
        view: "month",
        filter: "all",
        edits: { "2026-09-30": entry },
      },
    },
    Schedules: {},
  }),
);
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
let app, browser, page;
const errors = [],
  cases = [];
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
async function bootAt(time) {
  await page.clock.setSystemTime(new Date(time));
  // Settle the 300 ms navigation-scroll debounce before replacing the document.
  await page.clock.runFor(350);
  await page.evaluate(() => window.journalFlush());
  await page.reload();
  await page.waitForFunction(() => window.journalReady);
  await page.evaluate(() => document.activeElement?.blur());
}
const selected = () => page.locator("#j-selected-date").innerText();
const todayLabel = () => page.locator("#j-selected-weekday").innerText();
async function expectDate(label) {
  assert.equal(await selected(), label);
}
async function signal(name) {
  await page.evaluate((name) => window.dispatchEvent(new Event(name)), name);
}
async function exit() {
  const exited = new Promise((r) => app.once("exit", r));
  spawn(path.join(appDir, "Journal.exe"), ["--exit"], {
    windowsHide: true,
    env: { ...process.env, SCHEDULE_TEST_DATA: profile },
  });
  await Promise.race([
    exited,
    pause(10000).then(() => {
      throw Error("Exit timed out");
    }),
  ]);
  await browser.close();
  browser = null;
}
(async () => {
  try {
    await launch();
    await page.clock.install({ time: new Date("2026-09-30T23:59:50+08:00") });
    for (const [start, target, monthLabel] of [
      ["2026-09-15", "2026-08-31", "八月"],
      ["2026-09-30", "2026-10-01", "十月"],
      ["2026-12-15", "2027-01-01", "一月"],
      ["2027-01-15", "2026-12-31", "十二月"],
      ["2028-03-15", "2028-02-29", "二月"],
    ]) {
      await bootAt(`${start}T12:00:00+08:00`);
      const outside = page.locator(`button.j-outside[data-date="${target}"]`);
      assert.equal(await outside.count(), 1);
      assert.ok((await outside.getAttribute("aria-label")).includes("切换到该月"));
      await outside.click();
      const [year, month, day] = target.split("-").map(Number);
      await expectDate(`${month} 月 ${day} 日`);
      assert.equal(await page.locator("#j-month-label").innerText(), monthLabel);
      assert.equal(await page.locator("#j-year-label").innerText(), String(year));
      assert.equal(await page.locator(`.j-day.is-selected:not(.j-outside)`).getAttribute("data-date"), target);
      await page.evaluate(() => window.journalFlush());
      const content = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent;
      assert.equal(content.selected, target);
      assert.equal(content.month, month - 1);
      assert.equal(content.year, year);
      for (const [field, value] of Object.entries(entry))
        assert.deepEqual(content.edits["2026-09-30"][field], value);
    }
    cases.push("adjacent dates navigate backward/forward across months, years and leap February without altering records");
    await page.locator('.j-day.is-selected').dblclick();
    assert.equal(await page.locator('#journal-ui').getAttribute('data-day-expanded'), 'true');
    await page.locator('.j-back').click();
    assert.equal(await page.locator('#journal-ui').getAttribute('data-day-expanded'), 'false');
    cases.push("selected day still expands on double-click after switching month");
    await bootAt("2026-09-30T23:59:50+08:00");
    await expectDate("9 月 30 日");
    await page.clock.runFor(10100);
    await expectDate("10 月 1 日");
    assert.ok((await todayLabel()).includes("今天"));
    assert.equal(
      await page.locator(".j-day.is-today").getAttribute("data-date"),
      "2026-10-01",
    );
    cases.push("midnight switches day and month");

    await bootAt("2026-09-30T23:59:50+08:00");
    const editor = page.locator("#j-entry-body");
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(5, 9);
    });
    const selection = await editor.evaluate((el) => [
      el.selectionStart,
      el.selectionEnd,
    ]);
    await page.clock.runFor(10100);
    await expectDate("9 月 30 日");
    assert.ok(!(await todayLabel()).includes("今天"));
    assert.deepEqual(
      await editor.evaluate((el) => [el.selectionStart, el.selectionEnd]),
      selection,
    );
    assert.equal(await editor.evaluate((el) => el.value), entry.body);
    await page.keyboard.type("edited");
    await page.evaluate(() => window.journalFlush());
    let saved = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent;
    assert.ok(saved.edits["2026-09-30"].body.includes("edited"));
    assert.deepEqual(saved.edits["2026-09-30"].ideas, entry.ideas);
    assert.ok(!saved.edits["2026-10-01"]);
    cases.push(
      "active editing retains date, selection, idea metadata and save target",
    );

    // A clock jump without firing timers models sleep and stale hidden pages.
    await bootAt("2026-09-30T12:00:00+08:00");
    await page.clock.setSystemTime(new Date("2026-10-02T12:00:00+08:00"));
    await page.locator('[data-action="today"]').click();
    await expectDate("10 月 2 日");
    cases.push("Today button reads the clock immediately");

    for (const name of ["focus", "visibilitychange"]) {
      await bootAt("2026-09-30T12:00:00+08:00");
      await page.clock.setSystemTime(new Date("2026-10-01T12:00:00+08:00"));
      if (name === "visibilitychange")
        await page.evaluate(() =>
          document.dispatchEvent(new Event("visibilitychange")),
        );
      else await signal(name);
      await expectDate("10 月 1 日");
      cases.push(name + " catches suspended midnight");
    }

    await bootAt("2026-09-30T12:00:00+08:00");
    await page.evaluate(() => {
      window.resumeEvents = 0;
      window.addEventListener("journal:resume", () => window.resumeEvents++);
      return window.journalNative.call("hideToTray");
    });
    await page.clock.setSystemTime(new Date("2026-10-01T12:00:00+08:00"));
    await page.evaluate(() => window.journalNative.call("restoreWindow"));
    await page.waitForFunction(() => window.resumeEvents > 0);
    await expectDate("10 月 1 日");
    cases.push("actual native tray restore refreshes today");

    await bootAt("2026-09-30T23:59:50+08:00");
    await page.locator('[data-date="2026-09-15"]').click();
    await page.clock.runFor(10100);
    await expectDate("9 月 15 日");
    cases.push("historical date browsing is preserved");

    await bootAt("2026-09-30T23:59:50+08:00");
    await page.locator('[data-action="next"]').click();
    await page.clock.runFor(10100);
    await expectDate("9 月 30 日");
    assert.equal(
      await page.locator(".j-day.is-today").getAttribute("data-date"),
      "2026-10-01",
    );
    cases.push("browsing another month does not force selection");

    for (const [start, expected] of [
      ["2026-12-31T23:59:50+08:00", "1 月 1 日"],
      ["2028-02-28T23:59:50+08:00", "2 月 29 日"],
    ]) {
      await bootAt(start);
      await page.clock.runFor(10100);
      await expectDate(expected);
    }
    cases.push("year rollover and leap day");

    await bootAt("2026-12-31T23:59:50+08:00");
    await page.locator('[data-view="year"]').click();
    await page.clock.runFor(10100);
    await expectDate("1 月 1 日");
    await page.evaluate(() => window.journalFlush());
    assert.equal(
      JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent.view,
      "year",
    );
    cases.push("year view remains selected and persists");

    await bootAt("2026-10-01T10:00:00+08:00");
    await page.evaluate(() =>
      window.dispatchEvent(
        new CustomEvent("journal:open-date", { detail: "2026-09-30" }),
      ),
    );
    await expectDate("9 月 30 日");
    assert.ok(!(await todayLabel()).includes("今天"));
    await page.evaluate(() => window.journalFlush());
    const before = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent;
    await exit();
    await launch();
    const actual = new Date()
      .toLocaleDateString("sv-SE")
      .split("-")
      .map(Number);
    await expectDate(`${actual[1]} 月 ${actual[2]} 日`);
    const after = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent;
    assert.deepEqual(after.edits, before.edits);
    assert.deepEqual(after.projects, before.projects);
    cases.push(
      "dated activation and cold restart keep records while opening today",
    );
    await exit();
    assert.deepEqual(errors, []);
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    const result = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/calendar-test.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode === null) app.kill();
  }
})().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
