const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule"),
  profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-day-view-")),
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
const dateButton = (d) => page.locator(`.j-calendar-pane [data-date="${d}"]`);
const expanded = () =>
  page.locator("#journal-ui").getAttribute("data-day-expanded");
const value = () => page.locator("#j-entry-body").evaluate((el) => el.value);
async function width(selector) {
  return (await page.locator(selector).boundingBox()).width;
}
(async () => {
  try {
    await launch();
    await page.setViewportSize({ width: 1440, height: 960 });
    await dateButton(other).click();
    assert.equal(await page.locator("#j-entry-title").inputValue(), "下一天");
    assert.notEqual(await expanded(), "true");
    const calendarWidth = await width(".j-calendar-pane"),
      editorWidth = await width(".j-editor");
    await dateButton(day).dblclick();
    assert.equal(await expanded(), "true");
    assert.equal(await page.locator(".j-calendar-pane").isVisible(), false);
    assert.equal(await page.locator(".j-back").isVisible(), true);
    assert.ok((await width(".j-editor")) >= calendarWidth + editorWidth - 2);
    assert.equal(await page.locator(".j-sidebar").isVisible(), true);
    assert.equal(await value(), body);
    assert.ok(
      (await page.locator("#j-schedule-list").innerText()).includes("阶段讨论"),
    );
    assert.equal(await page.locator("#j-entry-body img").count(), 1);
    assert.equal(await page.locator("#j-entry-body .katex").count(), 1);
    assert.ok(
      (await page.locator("#j-resources").innerText()).includes("notes.txt"),
    );
    cases.push(
      "single click selects; real double click merges calendar/editor with all day content",
    );
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page.screenshot({
      path: path.join(root, "artifacts/day-view-expanded.png"),
    });
    await page.locator(".j-back").click();
    assert.notEqual(await expanded(), "true");
    assert.ok(await page.locator(".j-calendar-pane").isVisible());
    assert.ok(Math.abs((await width(".j-editor")) - editorWidth) < 2);
    assert.equal(await dateButton(day).getAttribute("aria-pressed"), "true");
    assert.equal(await value(), body);
    cases.push("back restores calendar layout and selection");
    await dateButton(day).dblclick();
    const editor = page.locator("#j-entry-body");
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    await page.keyboard.type(" saved in expanded view");
    let changed = await value();
    await page.locator(".j-back").click();
    assert.equal(await value(), changed);
    await page.evaluate(() => window.journalFlush());
    let saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.equal(saved.WidgetState.privateContent.edits[day].body, changed);
    assert.deepEqual(saved.WidgetState.privateContent.edits[day].ideas, ideas);
    await dateButton(other).click();
    await dateButton(day).dblclick();
    assert.equal(await value(), changed);
    cases.push(
      "expanded editing keeps save date, idea IDs, completion and bindings",
    );
    const selectText = async (start, end = start) =>
      editor.evaluate(
        (el, [a, b]) => {
          el.focus();
          el.setSelectionRange(a, b);
        },
        [start, end],
      );
    await selectText(2, 10);
    await page.locator('[data-format="bold"]').click();
    await page.locator("#j-font-size").selectOption("20");
    await page.locator("#j-text-color").selectOption("#b34848");
    assert.equal(
      await value(),
      changed,
      "Formatting must not alter body source",
    );
    assert.deepEqual(
      await editor.evaluate((el) => [el.selectionStart, el.selectionEnd]),
      [2, 10],
    );
    let styled = await editor
      .locator("[data-text-format]")
      .first()
      .evaluate((el) => ({
        text: el.textContent,
        bold: getComputedStyle(el).fontWeight,
        size: getComputedStyle(el).fontSize,
        color: getComputedStyle(el).color,
      }));
    assert.deepEqual(styled, {
      text: changed.slice(2, 10),
      bold: "700",
      size: "20px",
      color: "rgb(179, 72, 72)",
    });
    await page.keyboard.press("Control+i");
    await page.keyboard.press("Control+u");
    await page.evaluate(() => window.journalFlush());
    let formats = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent.edits[day].formats;
    assert.deepEqual(formats, [
      {
        start: 2,
        end: 10,
        bold: true,
        italic: true,
        underline: true,
        size: 20,
        color: "#b34848",
      },
    ]);
    const clipboard = await editor.evaluate((el) => {
      const data = new DataTransfer();
      el.dispatchEvent(
        new ClipboardEvent("copy", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return {
        text: data.getData("text/plain"),
        html: data.getData("text/html"),
      };
    });
    assert.equal(clipboard.text, changed.slice(2, 10));
    cases.push(
      "selected text supports size, bold, italic, underline and color with exact source/selection",
    );
    await selectText(changed.length);
    await page.locator('[data-action="toggle-format"]').click();
    await page.locator('[data-format="bold"]').click();
    await page.locator("#j-font-size").selectOption("18");
    await page.locator("#j-text-color").selectOption("#356ca1");
    const insertAt = changed.length;
    await page.keyboard.insertText(" 新的强调文字");
    changed = await value();
    await page.locator('[data-format="clear"]').click();
    await page.keyboard.insertText(" 普通文字");
    await page.keyboard.press("Control+z");
    assert.equal(await value(), changed);
    await page.keyboard.press("Control+y");
    changed = await value();
    await page.evaluate(() => window.journalFlush());
    formats = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent.edits[day].formats;
    assert.ok(
      formats.some(
        (r) =>
          r.start === insertAt &&
          r.end === insertAt + 7 &&
          r.bold &&
          r.size === 18 &&
          r.color === "#356ca1",
      ),
    );
    assert.ok(!formats.some((r) => r.end > insertAt + 7));
    cases.push(
      "caret formatting applies to future typing; clear format and undo/redo preserve runs",
    );
    await selectText(2, 10);
    await page.locator('[data-format="clear"]').click();
    await page.keyboard.press("Control+z");
    await page.locator(".j-back").click();
    await dateButton(other).click();
    await editor.evaluate((el) => {
      el.focus();
      el.setSelectionRange(el.value.length, el.value.length);
    });
    const otherLength = (await value()).length;
    await editor.evaluate((el, copy) => {
      const data = new DataTransfer();
      data.setData("text/plain", copy.text);
      data.setData("text/html", copy.html);
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, clipboard);
    await page.evaluate(() => window.journalFlush());
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(saved.WidgetState.privateContent.edits[other].formats, [
      {
        start: otherLength,
        end: otherLength + 8,
        bold: true,
        italic: true,
        underline: true,
        size: 20,
        color: "#b34848",
      },
    ]);
    await dateButton(day).dblclick();
    await selectText(changed.length);
    await page.locator('[data-action="toggle-format"]').click();
    await page.locator('[data-format="bold"]').click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.imeSetComposition", {
      text: "中文",
      selectionStart: 2,
      selectionEnd: 2,
    });
    await cdp.send("Input.insertText", { text: "中文" });
    await cdp.detach();
    assert.equal(await value(), changed + "中文");
    changed = await value();
    await page.evaluate(() => window.journalFlush());
    formats = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent.edits[day].formats;
    assert.ok(formats.some((r) => r.end === changed.length && r.bold));
    cases.push(
      "formatted clipboard, clear-format undo and native Chinese composition",
    );
    await page.locator('[data-filter="a"]').click();
    styled = await page
      .locator('.j-overview-idea[data-idea-id="idea-0"] [data-text-format]')
      .first()
      .evaluate((el) => ({
        text: el.textContent,
        bold: getComputedStyle(el).fontWeight,
        size: getComputedStyle(el).fontSize,
        color: getComputedStyle(el).color,
      }));
    assert.equal(styled.text, changed.slice(2, 10));
    assert.equal(styled.color, "rgb(179, 72, 72)");
    assert.equal(styled.size, "20px");
    await page.locator('[data-filter="all"]').click();
    await dateButton(day).dblclick();
    await page.screenshot({
      path: path.join(root, "artifacts/day-view-formatted.png"),
    });
    cases.push("project overview and expanded view display saved formats");
    await page.keyboard.press("Escape");
    assert.notEqual(await expanded(), "true");
    await page.locator('[data-view="year"]').click();
    await dateButton(other).click();
    assert.equal(
      await page.locator("#journal-ui").getAttribute("data-view"),
      "year",
    );
    await dateButton(day).dblclick();
    assert.equal(await expanded(), "true");
    await page.locator(".j-back").click();
    assert.equal(
      await page.locator("#journal-ui").getAttribute("data-view"),
      "year",
    );
    cases.push("year-grid double click and Escape/back preserve overview");
    await page.locator('[data-view="month"]').click();
    await dateButton(day).dblclick();
    await page.locator('[data-filter="a"]').click();
    assert.notEqual(await expanded(), "true");
    assert.ok(await page.locator(".j-ideas-pane").isVisible());
    await page.locator('[data-filter="all"]').click();
    await dateButton(day).dblclick();
    await page.locator('[data-action="search"]').click();
    assert.notEqual(await expanded(), "true");
    assert.ok(await page.locator("#j-search").isVisible());
    await page.locator('[data-action="close-search"]').click();
    cases.push("sidebar projects and search exit expanded mode");
    await dateButton(day).dblclick();
    await page.locator('[data-action="sidebar"]').click();
    assert.ok((await width(".j-editor")) >= 1438);
    await page.locator('[data-action="sidebar"]').click();
    const resizer = page.locator("#j-sidebar-resizer");
    await resizer.focus();
    await page.keyboard.press("ArrowRight");
    assert.ok((await width(".j-editor")) > 1000);
    cases.push("sidebar toggle and resize continue working");
    await page.locator(".j-back").click();
    await page.setViewportSize({ width: 800, height: 720 });
    await page.locator('[data-action="sidebar"]').click();
    await dateButton(day).dblclick();
    assert.ok((await width(".j-editor")) >= 798);
    assert.ok(await page.locator(".j-back").isVisible());
    await page.screenshot({
      path: path.join(root, "artifacts/day-view-narrow.png"),
    });
    await page.locator(".j-back").click();
    assert.ok(await page.locator(".j-calendar-pane").isVisible());
    cases.push("narrow desktop uses full available width and returns");
    await page.evaluate(() => window.journalFlush());
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    await exit();
    await launch();
    await dateButton(day).dblclick();
    assert.equal(await expanded(), "true");
    assert.equal(await value(), changed);
    saved = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.deepEqual(
      saved.WidgetState.privateContent.edits,
      before.WidgetState.privateContent.edits,
    );
    assert.deepEqual(
      saved.WidgetState.nativeImages,
      before.WidgetState.nativeImages,
    );
    await exit();
    assert.deepEqual(errors, []);
    cases.push("native save and cold restart preserve text and images");
    const report = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/day-view-test.json"),
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
