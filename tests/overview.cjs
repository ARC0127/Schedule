const { chromium } = require("playwright");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const assert = require("node:assert/strict"),
  { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const appDir =
  process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-overview-"));
assert.notEqual(
  profile,
  path.join(process.env.LOCALAPPDATA || "", "CodexJournal"),
);
const today = new Date().toLocaleDateString("sv-SE"),
  older = "2025-01-02";
const todayFile = path.join(profile, "current.txt"),
  oldFolder = path.join(profile, "older folder");
fs.mkdirSync(oldFolder);
const oldFile = path.join(oldFolder, "old file.txt");
fs.writeFileSync(todayFile, "today");
fs.writeFileSync(oldFile, "older");
const missing = path.join(profile, "missing.txt");
const lines = [
  "\uE000",
  "Mixed image \uE001",
  'Visit https://example.com/docs?q=1&lang=zh。\n  [Guide](https://example.com/guide)\n  "' +
    oldFile +
    '"',
  "Unbound \uE000",
  "Missing image \uE002",
  "<img src=x onerror=alert(1)> javascript:alert(1)",
];
let offset = 0;
const ideas = lines.map((text, i) => {
  const item = {
    id: "media-" + i,
    offset,
    done: i === 0,
    projectIds: i === 3 ? [] : ["a", "b"],
  };
  offset += text.length + 3;
  return item;
});
const icon =
  "data:image/png;base64," +
  fs
    .readFileSync(path.join(root, "assets/schedule-icon.png"))
    .toString("base64");
fs.writeFileSync(
  path.join(profile, "journal.json"),
  JSON.stringify({
    WidgetState: {
      nativeImages: [
        ["\uE000", { name: "Only image", src: icon, status: "ready" }],
        ["\uE001", { name: "Mixed image", src: icon, status: "ready" }],
      ],
      privateContent: {
        schemaVersion: 2,
        year: Number(today.slice(0, 4)),
        month: Number(today.slice(5, 7)) - 1,
        selected: today,
        filter: "a",
        view: "month",
        sidebar: "open",
        projects: [
          { id: "a", name: "Project A", root: profile },
          { id: "b", name: "Project B", root: "" },
        ],
        newIdeaProjects: ["a"],
        edits: {
          [today]: {
            title: "Media fixture",
            body: lines.map((x) => "• " + x).join("\n"),
            ideas,
            files: [{ name: "current.txt", path: todayFile, kind: "file" }],
          },
          [older]: {
            title: "Older fixture",
            body: "• Older resources",
            ideas: [
              { id: "older-idea", offset: 0, done: false, projectIds: ["a"] },
            ],
            files: [
              { name: "old file.txt", path: oldFile, kind: "file" },
              { name: "older folder", path: oldFolder, kind: "folder" },
              { name: "missing.txt", path: missing, kind: "file" },
            ],
          },
        },
      },
    },
    Schedules: {},
  }),
);
let app, browser, page;
const errors = [];
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
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
      if (app.exitCode !== null) throw Error("App exited before ready");
      await pause(100);
    }
  }
  assert.ok(browser);
  page = browser.contexts()[0].pages()[0];
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.waitForURL("https://journal.local/index.html");
  await page.locator("#j-entry-body").waitFor();
  if (!process.env.SCHEDULE_TEST_BUILD)
    await page.waitForFunction(() => window.journalReady);
}
async function save() {
  await page.evaluate(() => window.journalFlush());
  return JSON.parse(fs.readFileSync(path.join(profile, "journal.json"), "utf8"))
    .WidgetState;
}
async function close() {
  await save();
  const done = new Promise((r) => app.once("exit", r));
  await page
    .evaluate(() => window.journalNative.call("closeWindow"))
    .catch(() => {});
  await done;
  await browser.close();
  browser = null;
}
(async () => {
  try {
    await launch();
    assert.equal(
      await page.locator('[data-idea-id="media-0"]').count(),
      1,
      "Image-only ideas must appear in project overview",
    );
    await page.waitForFunction(() => {
      const imgs = [...document.querySelectorAll("#j-overview-list img")];
      return (
        imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0)
      );
    });
    assert.equal(await page.locator("#j-idea-count").innerText(), "6 个想法");
    assert.equal(
      await page
        .locator('[data-idea-id="media-0"] .j-overview-check')
        .getAttribute("aria-pressed"),
      "true",
    );
    assert.match(
      await page.locator('[data-idea-id="media-4"]').innerText(),
      /图片数据不可用/,
    );
    assert.equal(
      await page.locator('[data-idea-id="media-5"] img').count(),
      0,
      "User HTML must stay text",
    );
    assert.equal(await page.locator("#j-overview-list a").count(), 2);
    assert.equal(
      await page
        .locator("#j-overview-list [data-inline-path]")
        .getAttribute("data-inline-path"),
      oldFile,
    );
    assert.equal(
      await page.locator('[data-resource-date="' + older + '"]').count(),
      3,
    );
    assert.equal(
      await page
        .locator('#j-overview-list [data-resource-date="' + today + '"]')
        .count(),
      1,
    );
    // Inspect real native paths; capture shell dispatch to avoid opening personal desktop apps.
    assert.equal(
      (
        await page.evaluate(
          (p) => window.journalNative.call("inspectPath", { path: p }),
          oldFile,
        )
      ).kind,
      "file",
    );
    assert.equal(
      (
        await page.evaluate(
          (p) => window.journalNative.call("inspectPath", { path: p }),
          oldFolder,
        )
      ).kind,
      "folder",
    );
    await page.evaluate(() => {
      const call = window.journalNative.call;
      window.mediaCalls = [];
      window.journalNative.call = (method, payload, ...rest) => {
        if (method === "openExternal" || method === "openPath") {
          window.mediaCalls.push({ method, payload });
          return Promise.resolve({ opened: true });
        }
        return call(method, payload, ...rest);
      };
      window.originalNativeCall = call;
    });
    await page.locator("#j-overview-list a").first().click();
    await page.locator("[data-inline-path]").click();
    await page
      .locator('[data-resource-date="' + older + '"][data-resource="0"]')
      .click();
    await page
      .locator('[data-resource-date="' + older + '"][data-resource="1"]')
      .click();
    const calls = await page.evaluate(() => window.mediaCalls);
    assert.deepEqual(
      calls.map((x) => x.method),
      ["openExternal", "openPath", "openPath", "openPath"],
    );
    assert.equal(calls[0].payload.url, "https://example.com/docs?q=1&lang=zh");
    assert.equal(calls[1].payload.path, oldFile);
    assert.equal(calls[2].payload.path, oldFile);
    assert.equal(calls[3].payload.path, oldFolder);
    assert.equal(page.url(), "https://journal.local/index.html");
    await page.evaluate(() => {
      window.journalNative.call = window.originalNativeCall;
    });
    await page
      .locator('[data-resource-date="' + older + '"][data-resource="2"]')
      .click();
    await page.waitForFunction(() =>
      document.querySelector("#j-toast").textContent.includes("路径不存在"),
    );
    for (const url of [
      "javascript:alert(1)",
      "file:///C:/Windows/notepad.exe",
      "ms-settings:notifications",
    ]) {
      assert.match(
        await page.evaluate(async (url) => {
          try {
            await window.journalNative.call("openExternal", { url });
            return "unexpected success";
          } catch (e) {
            return e.message;
          }
        }, url),
        /HTTP/,
      );
    }
    await page.locator('[data-filter="b"]').click();
    assert.equal(await page.locator('[data-idea-id="media-0"] img').count(), 1);
    await page.locator('[data-filter="unbound"]').click();
    assert.equal(await page.locator('[data-idea-id="media-3"] img').count(), 1);
    await page.locator('[data-filter="a"]').click();
    await page
      .locator('[data-idea-id="media-0"] [data-open-idea]')
      .first()
      .click();
    await page
      .locator("#j-entry-body")
      .evaluate((e) => e.setSelectionRange(3, 3));
    await page.locator("#j-entry-body").evaluate(async (e) => {
      const c = document.createElement("canvas");
      c.width = 12;
      c.height = 12;
      c.getContext("2d").fillRect(0, 0, 12, 12);
      const blob = await new Promise((r) => c.toBlob(r));
      const data = new DataTransfer();
      data.items.add(new File([blob], "pasted.png", { type: "image/png" }));
      e.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: data,
        }),
      );
    });
    await page.waitForFunction(() => {
      const imgs = [
        ...document.querySelectorAll('[data-idea-id="media-0"] img'),
      ];
      return (
        imgs.length === 2 && imgs.every((i) => i.complete && i.naturalWidth > 0)
      );
    });
    const newFile = path.join(profile, "new attachment.txt");
    fs.writeFileSync(newFile, "new attachment");
    await page.locator('[data-action="attach"]').click();
    await page.locator("#j-path-input").fill(newFile);
    await page.locator('[data-action="confirm-attach"]').click();
    await page
      .locator('[data-action="confirm-attach"]')
      .waitFor({ state: "hidden" });
    await page.waitForFunction(
      (date) =>
        document.querySelectorAll(
          `#j-overview-list [data-resource-date="${date}"]`,
        ).length === 2,
      today,
    );
    const before = await save();
    assert.equal(before.nativeImages.length, 3);
    await close();
    await launch();
    assert.deepEqual(
      (await save()).privateContent.edits,
      before.privateContent.edits,
    );
    await page.waitForFunction(
      () =>
        [...document.querySelectorAll('[data-idea-id="media-0"] img')].filter(
          (i) => i.complete && i.naturalWidth > 0,
        ).length === 2,
    );
    const artifacts = path.join(root, "artifacts");
    fs.mkdirSync(artifacts, { recursive: true });
    await page.screenshot({ path: path.join(artifacts, "overview-media.png") });
    await close();
    assert.deepEqual(errors, []);
    const result = {
      passed: true,
      cases: [
        "image-only idea and count",
        "mixed images",
        "missing image placeholder",
        "safe HTML",
        "web link routing",
        "inline path",
        "date-specific files and folder routing",
        "real native path inspection",
        "missing file error",
        "blocked non-web schemes",
        "multiple projects and unbound",
        "live paste refresh",
        "live attachment refresh",
        "save/restart media",
      ],
      shellDispatch: "captured; no external application launched",
      errors,
    };
    fs.writeFileSync(
      path.join(artifacts, "overview-test.json"),
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
