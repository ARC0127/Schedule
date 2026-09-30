const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-math-"));
const file = path.join(profile, "journal.json"),
  today = new Date().toLocaleDateString("sv-SE");
const source = String.raw`Diffusion \(x_\tau=\alpha_\tau x+\sigma_\tau\epsilon,
\qquad
\epsilon\sim\mathcal N(0,I).\)
flow matching \(x_\tau=(1-\tau)\epsilon+\tau x.\)`;
const fixture = {
  WidgetState: {
    privateContent: {
      projects: [{ id: "math", name: "Math project", root: "" }],
      edits: {
        [today]: {
          title: "Multiline equations",
          body: "• ",
          files: [],
          ideas: [
            { id: "original", offset: 0, done: false, projectIds: ["math"] },
          ],
        },
      },
      selected: today,
      filter: "all",
      year: Number(today.slice(0, 4)),
      month: Number(today.slice(5, 7)) - 1,
    },
    nativeImages: [],
  },
  Schedules: {},
};
fs.writeFileSync(file, JSON.stringify(fixture));
let app, browser, page;
const errors = [],
  external = [],
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
      if (app.exitCode !== null) throw Error("App exited before readiness");
      await pause(100);
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("request", (r) => {
    if (
      /^https?:/.test(r.url()) &&
      !r.url().startsWith("https://journal.local/")
    )
      external.push(r.url());
  });
  await page.waitForFunction(() => window.journalReady);
}
async function exit() {
  const closed = new Promise((r) => app.once("exit", r));
  spawn(path.join(appDir, "Journal.exe"), ["--exit"], {
    windowsHide: true,
    env: { ...process.env, SCHEDULE_TEST_DATA: profile },
  });
  await Promise.race([
    closed,
    pause(10000).then(() => {
      throw Error("Exit timed out");
    }),
  ]);
  await browser.close();
  browser = null;
}
async function paste(text) {
  await page.locator("#j-entry-body").evaluate((el, text) => {
    const data = new DataTransfer();
    data.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        clipboardData: data,
        bubbles: true,
        cancelable: true,
      }),
    );
  }, text);
}
async function body() {
  return page.locator("#j-entry-body").evaluate((el) => el.value);
}
async function focusAt(position) {
  await page.locator("#j-entry-body").evaluate((el, p) => {
    el.focus();
    el.setSelectionRange(p, p);
  }, position);
}
(async () => {
  try {
    await launch();
    await focusAt(2);
    await paste(source);
    assert.equal(await body(), "• " + source);
    await page.evaluate(() => window.journalFlush());
    let saved = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState
      .privateContent.edits[today];
    assert.deepEqual(
      saved.ideas,
      fixture.WidgetState.privateContent.edits[today].ideas,
    );
    await page.keyboard.press("Control+z");
    assert.equal(await body(), "• ");
    await page.keyboard.press("Control+y");
    assert.equal(await body(), "• " + source);
    await page.locator('[data-filter="math"]').click();
    assert.equal(await page.locator(".j-overview-idea").count(), 1);
    assert.ok(
      (await page.locator(".j-idea-text").innerText()).includes(
        "flow matching",
      ),
    );
    assert.equal(await page.locator(".j-idea-text .katex").count(), 2);
    assert.ok(
      await page.locator(".j-idea-text br").count(),
      "Overview must preserve the line break between formulas",
    );
    assert.equal(await page.locator("#j-entry-body .katex").count(), 2);
    assert.equal(
      await body(),
      "• " + source,
      "Rendered DOM must serialize to unchanged TeX",
    );
    await page.waitForFunction(() => document.fonts.status === "loaded");
    assert.ok(
      await page.evaluate(() => document.fonts.check("16px KaTeX_Main")),
    );
    await page.locator("#j-entry-body .j-math").first().click();
    assert.equal(
      await page.locator("#j-entry-body .katex").count(),
      0,
      "Focus must expose editable TeX",
    );
    assert.equal(await body(), "• " + source);
    const copied = await page.locator("#j-entry-body").evaluate((el) => {
      el.setSelectionRange(0, el.value.length);
      const data = new DataTransfer();
      el.dispatchEvent(
        new ClipboardEvent("copy", {
          clipboardData: data,
          bubbles: true,
          cancelable: true,
        }),
      );
      return data.getData("text/plain");
    });
    assert.equal(copied, "• " + source);
    await focusAt(("• " + source).indexOf("flow matching") + 5);
    await page.keyboard.press("Control");
    await page.evaluate(() => window.journalFlush());
    saved = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent
      .edits[today];
    assert.equal(saved.ideas[0].done, true);
    assert.equal(saved.ideas[0].id, "original");
    assert.deepEqual(saved.ideas[0].projectIds, ["math"]);
    await focusAt((await body()).length);
    await page.keyboard.press("Enter");
    await page.keyboard.type("continued");
    assert.equal(await page.locator("#j-idea-count").innerText(), "1 个想法");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.type("Second idea");
    assert.equal(await page.locator("#j-idea-count").innerText(), "2 个想法");
    await paste(String.raw` \[\begin{matrix}a&b\\c&d\end{matrix}\]`);
    await page.locator("#j-entry-title").focus();
    assert.equal(await page.locator("#j-entry-body .katex").count(), 3);
    assert.equal(await page.locator("#j-entry-body .j-math-error").count(), 0);
    const stable = await body();
    await focusAt(stable.length);
    await paste(String.raw` \(\frac{\)`);
    await page.locator("#j-entry-title").focus();
    assert.equal(await page.locator("#j-entry-body .j-math-error").count(), 1);
    assert.ok((await body()).endsWith(String.raw`\(\frac{\)`));
    await focusAt((await body()).length);
    await page.keyboard.press("Control+z");
    assert.equal(await body(), stable);
    await paste(String.raw` \(\href{javascript:alert(1)}{unsafe}\)`);
    await page.locator("#j-entry-title").focus();
    assert.equal(await page.locator(".j-math a, .j-math img").count(), 0);
    await focusAt((await body()).length);
    await page.keyboard.press("Control+z");
    assert.equal(await body(), stable);
    await page.locator('[data-filter="unbound"]').click();
    assert.equal(await page.locator(".j-overview-idea").count(), 1);
    await page.locator('[data-filter="math"]').click();
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    await page.screenshot({ path: path.join(root, "artifacts/math-test.png") });
    await page.evaluate(() => window.journalFlush());
    const before = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState;
    await exit();
    await launch();
    assert.equal(await body(), stable);
    assert.equal(await page.locator("#j-entry-body .katex").count(), 3);
    assert.deepEqual(
      JSON.parse(fs.readFileSync(file, "utf8")).WidgetState,
      before,
    );
    await exit();
    assert.deepEqual(errors, []);
    assert.deepEqual(external, []);
    const report = {
      passed: true,
      cases: [
        "exact multiline Diffusion/flow matching paste",
        "one manual idea and full project overview",
        "offline formulas/fonts",
        "click to edit raw source",
        "copy and paste undo/redo",
        "completion and binding from unindented continuation",
        "Enter versus Shift+Enter",
        "matrix TeX before path parsing",
        "invalid TeX preserves source",
        "untrusted links blocked",
        "save and cold restart",
      ],
      errors,
      external,
    };
    fs.writeFileSync(
      path.join(root, "artifacts/math-test.json"),
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
