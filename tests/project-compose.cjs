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
    path.join(os.tmpdir(), "schedule-project-compose-"),
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
    const original = (await saved()).edits;
    await page.evaluate(
      (date) =>
        window.dispatchEvent(
          new CustomEvent("journal:open-date", { detail: date }),
        ),
      older,
    );
    await page.locator('[data-filter="empty"]').click();
    const editor = page.locator("#j-project-compose-body");
    assert.ok(await editor.isVisible());
    assert.equal(await page.locator("#j-overview-list").innerText(), "");
    await editor.click();
    await page.keyboard.insertText("项目内直接写");
    await page.keyboard.press("Enter");
    await page.keyboard.insertText("保留第二行");
    let data = await saved(),
      first = data.edits[day].ideas.find((x) => x.projectIds.includes("empty"));
    assert.ok(first);
    assert.equal(
      data.edits[day].body,
      original[day].body + "\n• 项目内直接写\n保留第二行",
    );
    assert.deepEqual(data.edits[older], original[older]);
    assert.equal(
      await editor.evaluate((el) => el === document.activeElement),
      true,
    );
    assert.equal(
      await page
        .locator('#j-project-nav [data-filter="empty"] .j-project-count')
        .textContent(),
      "(1)",
    );
    assert.match(
      await page.locator("#j-project-compose-label").textContent(),
      /空项目/,
    );
    cases.push(
      "Empty project accepts direct multiline writing, binds automatically, saves to today while an older day is selected, and preserves existing content",
    );
    await page.keyboard.press("Shift+Enter");
    assert.equal(await editor.innerText(), "");
    assert.equal(await page.locator(`[data-idea-id="${first.id}"]`).count(), 1);
    await page.keyboard.insertText("第二个想法 ");
    const image = fs
      .readFileSync(path.join(root, "assets/schedule-icon.png"))
      .toString("base64");
    await editor.evaluate((el, base64) => {
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0)),
        dt = new DataTransfer();
      dt.items.add(new File([bytes], "demo.png", { type: "image/png" }));
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    }, image);
    await page.waitForFunction(
      () => document.querySelector("#j-project-compose-body img")?.complete,
    );
    await page.keyboard.insertText(" 图片后的说明");
    data = await saved();
    const second = data.edits[day].ideas
      .filter((x) => x.projectIds.includes("empty"))
      .find((x) => x.id !== first.id);
    assert.ok(second);
    assert.equal(
      data.edits[day].ideas.filter((x) => x.projectIds.includes("empty"))
        .length,
      2,
    );
    assert.ok(/[\uE000-\uF8FF]/.test(data.edits[day].body));
    assert.ok(/[\uE000-\uF8FF] 图片后的说明$/.test(data.edits[day].body));
    assert.ok(
      JSON.parse(fs.readFileSync(file, "utf8")).WidgetState.nativeImages.some(
        ([, a]) => a.status === "ready",
      ),
    );
    cases.push(
      "Shift+Enter starts another idea; pasted images display inline and persist with the correct project",
    );
    await page.locator('[data-filter="b"]').click();
    await editor.click();
    await editor.evaluate((el) => {
      const dt = new DataTransfer();
      dt.setData(
        "text/plain",
        "Diffusion \\(x_\\tau=\\alpha_\\tau x\\)\nhttps://example.com/notes",
      );
      el.dispatchEvent(
        new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }),
      );
    });
    data = await saved();
    const added = data.edits[day].ideas.filter(
      (x) => !original[day].ideas.some((y) => y.id === x.id),
    );
    assert.equal(added.length, 3);
    assert.deepEqual(added[2].projectIds, ["b"]);
    assert.deepEqual(data.newIdeaProjects, ["a"]);
    assert.deepEqual(
      data.edits[day].ideas.slice(0, original[day].ideas.length),
      original[day].ideas,
    );
    await page.keyboard.press("Shift+Enter");
    assert.equal(
      await page.locator(`[data-idea-id="${added[2].id}"] .katex`).count(),
      1,
    );
    assert.equal(
      await page
        .locator(`[data-idea-id="${added[2].id}"] a[data-external-url]`)
        .count(),
      1,
    );
    await page.locator('[data-filter="unbound"]').click();
    await editor.click();
    await page.keyboard.insertText("无绑定记录");
    data = await saved();
    assert.deepEqual(data.edits[day].ideas.at(-1).projectIds, []);
    cases.push(
      "Switching projects captures the new binding without altering defaults or old ideas; unbound input remains unbound; completed entries render math and links",
    );
    // IME input is persisted without replacing the focused composing element.
    await editor.evaluate((el) => {
      el.dispatchEvent(
        new CompositionEvent("compositionstart", { bubbles: true }),
      );
      el.textContent = "中文输入确认";
      el.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertCompositionText",
          data: "中文输入确认",
          isComposing: true,
        }),
      );
      el.dispatchEvent(
        new CompositionEvent("compositionend", {
          bubbles: true,
          data: "中文输入确认",
        }),
      );
    });
    data = await saved();
    assert.ok(data.edits[day].body.endsWith("• 中文输入确认"));
    const before = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState;
    await page.locator('[data-filter="empty"]').click();
    await page.screenshot({
      path: path.join(root, "artifacts/project-compose.png"),
    });
    await exit();
    await launch();
    await page.locator('[data-filter="empty"]').click();
    const after = JSON.parse(fs.readFileSync(file, "utf8")).WidgetState;
    assert.equal(
      after.privateContent.edits[day].body,
      before.privateContent.edits[day].body,
    );
    assert.deepEqual(
      after.privateContent.edits[day].ideas,
      before.privateContent.edits[day].ideas,
    );
    assert.deepEqual(after.nativeImages, before.nativeImages);
    assert.equal(
      await page.locator(`[data-idea-id="${second.id}"] img`).count(),
      1,
    );
    cases.push(
      "Chinese composition, record/idea identity, bindings and images survive a full native restart",
    );
    await exit();
    assert.deepEqual(errors, []);
    const report = { passed: true, cases, errors };
    fs.writeFileSync(
      path.join(root, "artifacts/project-compose-test.json"),
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
