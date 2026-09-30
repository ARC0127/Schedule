const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, "..");
const appDir =
  process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-restart-"));
const file = path.join(profile, "journal.json"),
  today = new Date().toLocaleDateString("sv-SE");
const body = "• Saved idea \uE000";
const fixture = {
  privateContent: {
    projects: [{ id: "kept", name: "Retained project", root: profile }],
    edits: {
      [today]: {
        title: "Retained day",
        body,
        files: [
          {
            name: "file.txt",
            path: path.join(profile, "file.txt"),
            kind: "file",
          },
        ],
        ideas: [
          { id: "stable-id", offset: 0, done: true, projectIds: ["kept"] },
        ],
      },
    },
    selected: today,
    filter: "all",
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
  },
  nativeImages: [
    [
      "\uE000",
      {
        name: "Saved image",
        status: "ready",
        src:
          "data:image/png;base64," +
          fs
            .readFileSync(path.join(root, "assets/schedule-icon.png"))
            .toString("base64"),
      },
    ],
  ],
};
let app, browser, page;
const errors = [],
  pause = (ms) => new Promise((r) => setTimeout(r, ms));
async function ready() {
  await page.waitForURL("https://journal.local/index.html");
  await page.waitForFunction(
    () =>
      window.journalReady ||
      (!document.querySelector("#journal-ui").inert &&
        document.querySelectorAll(".j-day").length),
  );
}
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
  await ready();
}
async function exit(flush = true) {
  if (flush) await page.evaluate(() => window.journalFlush());
  const done = new Promise((r) => app.once("exit", r));
  // Exercise the real --exit path, including the native flush handshake.
  if (flush)
    spawn(path.join(appDir, "Journal.exe"), ["--exit"], {
      windowsHide: true,
      env: { ...process.env, SCHEDULE_TEST_DATA: profile },
    });
  else
    await page
      .evaluate(() => window.journalNative.call("closeWindow"))
      .catch(() => {});
  await Promise.race([
    done,
    pause(10000).then(() => {
      throw Error("Exit did not finish");
    }),
  ]);
  await browser.close();
  browser = null;
}
async function verify() {
  assert.equal(
    await page.locator("#j-project-nav .j-project").count(),
    1,
    "Reload must read the latest saved projects, not the empty startup snapshot",
  );
  assert.equal(
    await page.locator("#j-entry-body").evaluate((el) => el.value),
    body,
  );
  await page.waitForFunction(() =>
    [...document.querySelectorAll("#j-entry-body img")].some(
      (i) => i.complete && i.naturalWidth,
    ),
  );
  const stored = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState;
  assert.deepEqual(
    stored.privateContent.edits[today].ideas,
    fixture.privateContent.edits[today].ideas,
  );
  assert.deepEqual(stored.nativeImages, fixture.nativeImages);
}
(async () => {
  try {
    await launch();
    assert.equal(await page.locator("#j-project-nav .j-project").count(), 0);
    await page.evaluate(
      (s) => window.journalNative.call("saveState", s),
      fixture,
    );
    await page.reload();
    await ready();
    await verify();
    await page
      .locator("#j-entry-title")
      .fill("Close button saves pending edits");
    await new Promise((resolve, reject) => {
      const child = spawn(
        "powershell",
        [
          "-NoProfile",
          "-Command",
          `[Diagnostics.Process]::GetProcessById(${app.pid}).CloseMainWindow()`,
        ],
        { windowsHide: true },
      );
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Close button request failed")),
      );
    });
    for (let i = 0; i < 50; i++) {
      try {
        if (JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent
          .edits[today].title === "Close button saves pending edits") break;
      } catch (error) {
        // Windows can briefly lock the file during the atomic close-time save.
        if (error.code !== "EBUSY") throw error;
      }
      await pause(100);
    }
    assert.equal(
      app.exitCode,
      null,
      "Close button should keep Schedule in the tray",
    );
    assert.equal(
      JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.privateContent
        .edits[today].title,
      "Close button saves pending edits",
    );
    await new Promise((resolve, reject) => {
      const child = spawn(path.join(appDir, "Journal.exe"), [], {
        windowsHide: true,
        env: { ...process.env, SCHEDULE_TEST_DATA: profile },
      });
      child.once("exit", (code) =>
        code === 0 ? resolve() : reject(Error("Reopen failed")),
      );
    });
    await pause(700);
    await verify();
    await exit();
    await launch();
    await verify();
    await page.evaluate(() => window.journalFlush());
    const before = JSON.parse(fs.readFileSync(file, "utf8"));
    const changed = JSON.parse(JSON.stringify(before));
    changed.WidgetState.privateContent.projects[0].name =
      "Externally recovered project";
    fs.writeFileSync(file, JSON.stringify(changed));
    const conflict = await page.evaluate(async () => {
      try {
        await window.journalFlush();
        return null;
      } catch (e) {
        return e.message;
      }
    });
    assert.match(
      conflict || "",
      /未覆盖磁盘内容/,
      "A stale in-memory state must not overwrite a changed file",
    );
    assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), changed);
    await page.reload();
    await ready();
    assert.match(
      await page.locator("#j-project-nav").innerText(),
      /Externally recovered project/,
    );
    await page.evaluate(() => window.journalFlush());
    const valid = fs.readFileSync(file);
    fs.writeFileSync(file, "{broken");
    await page.reload();
    await page.locator('.j-load-status[role="alert"]').waitFor();
    assert.equal(
      await page.locator("#journal-ui").evaluate((el) => el.inert),
      true,
    );
    assert.equal(
      fs.readFileSync(file, "utf8"),
      "{broken",
      "Failed load must never save an empty UI",
    );
    fs.writeFileSync(file, valid);
    await page.reload();
    await ready();
    await verify();
    await exit();
    assert.deepEqual(errors, []);
    const report = {
      passed: true,
      cases: [
        "fresh empty profile",
        "save then document reload",
        "Windows close button flushes edits to tray",
        "second launch restores tray window",
        "real exit and process restart",
        "project/body/image/ID/completion/binding preservation",
        "stale disk write rejected",
        "reload latest external state",
        "failed load blocks editing and preserves source",
        "retry valid data",
      ],
      errors,
    };
    fs.mkdirSync(path.join(root, "artifacts"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "artifacts/restart-test.json"),
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
