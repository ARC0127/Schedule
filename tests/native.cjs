const { chromium } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const assert = require("node:assert/strict"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-test-"));
assert.notEqual(
  profile,
  path.join(process.env.LOCALAPPDATA || "", "CodexJournal"),
);
assert.notEqual(profile, path.join(os.homedir(), ".schedule"));
const today = new Date().toLocaleDateString("sv-SE"),
  body = "• First idea\n  continuation\n• Second idea";
const ideas = [
  { id: "legacy-point-a", offset: 0, done: true, projectIds: ["a", "b"] },
  {
    id: "legacy-point-b",
    offset: body.indexOf("• Second"),
    done: false,
    projectIds: [],
  },
];
const projects = [
  { id: "a", name: "Example A", root: profile },
  { id: "b", name: "Example B", root: "" },
];
fs.writeFileSync(
  path.join(profile, "journal.json"),
  JSON.stringify({
    WidgetState: {
      privateContent: {
        projects,
        newPointProjects: ["b"],
        selected: today,
        year: Number(today.slice(0, 4)),
        month: Number(today.slice(5, 7)) - 1,
        view: "month",
        filter: "all",
        sidebar: "open",
        edits: {
          [today]: {
            title: "Migration fixture",
            body,
            files: [],
            points: ideas,
          },
        },
      },
    },
    Schedules: {},
  }),
);
let app, browser, page;
const errors = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function port() {
  const server = net.createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const p = server.address().port;
  await new Promise((r) => server.close(r));
  return p;
}
async function launch() {
  const p = await port();
  app = spawn(path.join(appDir, "Journal.exe"), [], {
    cwd: appDir,
    windowsHide: true,
    env: {
      ...process.env,
      SCHEDULE_TEST_DATA: profile,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${p}`,
    },
  });
  for (let i = 0; i < 150; i++) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${p}`);
      break;
    } catch {
      if (app.exitCode !== null) throw Error("Native app exited before ready");
      await pause(100);
    }
  }
  assert.ok(browser, "WebView2 did not start");
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForURL("https://journal.local/index.html");
  await page.locator("#j-entry-body").waitFor();
  if (!process.env.SCHEDULE_TEST_BUILD)
    await page.waitForFunction(() => window.journalReady);
}
async function saved() {
  await page.evaluate(() => window.journalFlush());
  return JSON.parse(fs.readFileSync(path.join(profile, "journal.json"), "utf8"))
    .WidgetState;
}
async function close() {
  await saved();
  const exited = new Promise((r) => app.once("exit", r));
  await page
    .evaluate(() => window.journalNative.call("closeWindow"))
    .catch(() => {});
  await exited;
  await browser.close();
  browser = null;
}
(async () => {
  try {
    await launch();
    assert.equal(await page.locator("#j-idea-count").innerText(), "2 个想法");
    assert.match(await page.locator(".j-creator").innerText(), /ARCLIGHT/);
    const layout = await page.locator(".j-creator").evaluate((e) => {
      const r = e.getBoundingClientRect(),
        s = e.closest("aside").getBoundingClientRect();
      return { left: r.left >= s.left, bottom: s.bottom - r.bottom };
    });
    assert.ok(layout.left && layout.bottom < 35);
    let state = await saved();
    assert.deepEqual(state.privateContent.edits[today].ideas, ideas);
    assert.ok(!("points" in state.privateContent.edits[today]));
    assert.deepEqual(state.privateContent.newIdeaProjects, ["b"]);
    await page.locator("#j-entry-body").focus();
    await page
      .locator("#j-entry-body")
      .evaluate((e) => e.setSelectionRange(e.value.length, e.value.length));
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("more detail");
    assert.equal(await page.locator("#j-idea-count").innerText(), "2 个想法");
    await page.keyboard.press("Shift+Enter");
    await page.keyboard.insertText("Third idea");
    await page.keyboard.press("Control");
    state = await saved();
    assert.equal(state.privateContent.edits[today].ideas.length, 3);
    assert.equal(state.privateContent.edits[today].ideas[2].done, true);
    assert.deepEqual(state.privateContent.edits[today].ideas[2].projectIds, [
      "b",
    ]);
    await page.keyboard.press("Control+c");
    assert.equal(
      (await saved()).privateContent.edits[today].ideas[2].done,
      true,
    );
    await page.locator('[data-filter="a"]').click();
    assert.equal(
      await page.locator('[data-idea-id="legacy-point-a"]').count(),
      1,
    );
    await page.locator('[data-filter="unbound"]').click();
    assert.equal(
      await page.locator('[data-idea-id="legacy-point-b"]').count(),
      1,
    );
    await page.locator('[data-bind-idea="legacy-point-b"]').click();
    await page.locator('[data-link-project="a"]').check();
    await page.locator('[data-action="close-project-picker"]').click();
    assert.deepEqual(
      (await saved()).privateContent.edits[today].ideas[1].projectIds,
      ["a"],
    );
    const file = path.join(profile, "example.txt");
    fs.writeFileSync(file, "fixture");
    await page.locator('[data-action="attach"]').click();
    await page.locator("#j-path-input").fill(file);
    await page.locator('[data-action="confirm-attach"]').click();
    await page.waitForFunction(
      () => document.querySelector(".j-attach-form").hidden,
    );
    assert.equal(
      (await saved()).privateContent.edits[today].files[0].path,
      file,
    );
    await page.locator("#j-entry-body").evaluate(async (e) => {
      const c = document.createElement("canvas");
      c.width = 16;
      c.height = 16;
      c.getContext("2d").fillRect(0, 0, 16, 16);
      const blob = await new Promise((r) => c.toBlob(r)),
        data = new DataTransfer();
      data.items.add(new File([blob], "fixture.png", { type: "image/png" }));
      e.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await page.locator("#j-entry-body img").waitFor();
    state = await saved();
    assert.equal(state.nativeImages.length, 1);
    const before = state.privateContent.edits[today];
    await close();
    await launch();
    state = await saved();
    assert.deepEqual(state.privateContent.edits[today], before);
    assert.equal(await page.locator("#j-entry-body img").count(), 1);
    assert.deepEqual(state.privateContent.projects, projects);
    const artifacts = path.join(root, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "native-ui.png") });
    await close();
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      cases: [
        "legacy migration",
        "stable IDs, completion and bindings",
        "ideas labels",
        "creator footer position",
        "Enter versus Shift+Enter",
        "Ctrl completion and Ctrl+C",
        "project and unbound overview",
        "late binding",
        "native attachment",
        "image paste",
        "save and restart",
      ],
      errors,
    };
    fs.writeFileSync(
      path.join(artifacts, "native-test.json"),
      JSON.stringify(result, null, 2),
    );
    console.log(JSON.stringify(result));
  } finally {
    if (browser) await browser.close();
    if (app && app.exitCode === null) app.kill();
    console.log("Isolated test profile:", profile);
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
