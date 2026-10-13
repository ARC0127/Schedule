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
    path.join(os.tmpdir(), "schedule-editor-width-"),
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
(async () => {
  try {
    await launch();
    const baseline = (await saved()).edits;
    const handle = page.locator("#j-editor-resizer"),
      pane = page.locator(".j-editor");
    const width = async () => Math.round((await pane.boundingBox()).width);
    async function drag(delta) {
      const b = await handle.boundingBox();
      await page.mouse.move(b.x + b.width / 2, b.y + 150);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width / 2 + delta, b.y + 150, {
        steps: 12,
      });
      await page.mouse.up();
    }
    async function near(expected) {
      await page.waitForFunction(
        (n) =>
          Math.abs(
            document.querySelector(".j-editor").getBoundingClientRect().width -
              n,
          ) < 2,
        expected,
      );
    }
    await near(306);
    await drag(-200);
    await near(506);
    assert.equal((await saved()).editorWidth, 506);
    const boundary = await handle.boundingBox(),
      editor = await pane.boundingBox();
    assert.ok(Math.abs(boundary.x + 5 - editor.x) < 2);
    assert.equal((await saved()).sidebarWidth, 200);
    assert.deepEqual((await saved()).edits, baseline);
    cases.push(
      "Mouse drag resizes the right editor at the actual divider without changing sidebar width or journal content",
    );
    await page.locator('[data-filter="b"]').click();
    await near(506);
    await drag(-80);
    await near(586);
    await page.locator('[data-action="sidebar"]').click();
    await near(586);
    assert.ok(await handle.isVisible());
    await handle.focus();
    await page.keyboard.press("End");
    assert.equal(await width(), 1140);
    await page.locator('[data-action="sidebar"]').click();
    await near(940);
    assert.equal((await saved()).editorWidth, 1140);
    await page.setViewportSize({ width: 800, height: 850 });
    await near(500);
    await page.setViewportSize({ width: 1440, height: 900 });
    await near(940);
    await handle.dblclick();
    await near(306);
    assert.equal((await saved()).editorWidth, 306);
    await handle.focus();
    await page.keyboard.press("ArrowLeft");
    await near(322);
    await page.keyboard.press("ArrowRight");
    await near(306);
    await page.keyboard.press("Home");
    await near(290);
    cases.push(
      "Project views, sidebar toggling, keyboard limits and double-click reset work; smaller windows clamp display without losing preferred width",
    );
    await page.locator('[data-filter="all"]').click();
    await page.locator(`[data-date="${day}"]`).dblclick();
    assert.equal(await handle.isVisible(), false);
    assert.ok((await width()) > 1000);
    await page.locator(".j-back").click();
    assert.ok(await handle.isVisible());
    await near(290);
    await page.setViewportSize({ width: 640, height: 800 });
    assert.equal(await handle.isVisible(), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await drag(-240);
    await near(530);
    await saved();
    await page.screenshot({
      path: path.join(root, "artifacts/editor-width.png"),
    });
    await exit();
    await launch();
    await near(530);
    assert.equal((await saved()).editorWidth, 530);
    assert.deepEqual((await saved()).edits, baseline);
    cases.push(
      "Expanded-day and single-column layouts hide the divider; chosen width and all records survive cold restart",
    );
    await exit();
    assert.deepEqual(errors, []);
    const report = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/editor-width-test.json"),
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
