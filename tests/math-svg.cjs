const { chromium } = require("playwright");
const assert = require("node:assert/strict");
const fs = require("node:fs"),
  os = require("node:os"),
  path = require("node:path"),
  net = require("node:net");
const { spawn } = require("node:child_process");
const root = path.resolve(__dirname, ".."),
  appDir = process.env.SCHEDULE_TEST_BUILD || path.join(root, "dist/Schedule");
const profile = fs.mkdtempSync(path.join(os.tmpdir(), "schedule-math-svg-"));
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

const accentSource = String.raw`• \[
\widehat\varphi_u(\omega)
=
\frac1B\sum_{b=1}^{B}
e^{i\omega u^\top z_b}
\]
\(\sqrt{x^2+y^2}\quad\overrightarrow{AB}\quad\widetilde{abcdef}\)
\[\underbrace{a+b+c}_{n}\quad\xrightarrow{long label}y\]`;
fixture.WidgetState.privateContent.edits[today].body = accentSource;
fixture.WidgetState.privateContent.sidebar = 'open';
fs.writeFileSync(file, JSON.stringify(fixture));
(async () => {
  try {
    await launch();
    await page.locator(`[data-date="${today}"]`).first().dblclick();
    await page.waitForFunction(() => document.fonts.status === 'loaded');
    const measurements = [];
    async function verify(selector, label) {
      const host = page.locator(selector);
      assert.equal(await host.locator('.j-math-error').count(), 0);
      assert.ok(await host.locator('.katex svg').count() >= 6);
      // Compare with the same KaTeX markup outside the application's CSS scope.
      const rows = await host.evaluate(el => {
        const result = [];
        for (const formula of el.querySelectorAll('.j-math')) {
          const reference = document.createElement('div');
          reference.style.cssText = `position:absolute;left:0;top:0;visibility:hidden;font-size:${getComputedStyle(formula).fontSize}`;
          reference.innerHTML = formula.innerHTML;
          document.body.append(reference);
          const actual = [...formula.querySelectorAll('svg')];
          const expected = [...reference.querySelectorAll('svg')];
          actual.forEach((svg, index) => {
            const rect = svg.getBoundingClientRect(), ref = expected[index].getBoundingClientRect();
            result.push({width:rect.width,height:rect.height,expectedWidth:ref.width,expectedHeight:ref.height,stroke:getComputedStyle(svg).strokeWidth,expectedStroke:getComputedStyle(expected[index]).strokeWidth});
          });
          reference.remove();
        }
        return result;
      });
      const overflow = await host.locator('.j-math').evaluateAll(nodes => nodes.map(el => ({width:el.clientWidth,scrollWidth:el.scrollWidth})));
      measurements.push({label, rows, overflow});
      for(const row of overflow) assert.equal(row.scrollWidth,row.width,'Short formulas should not show a rounding-overflow scrollbar');
      fs.mkdirSync(path.join(root, 'artifacts'), {recursive:true});
      await host.screenshot({path:path.join(root, `artifacts/math-svg-${label}.png`)});
      fs.writeFileSync(path.join(root, 'artifacts/math-svg-measurements.json'), JSON.stringify(measurements,null,2));
      for (const row of rows) {
        assert.ok(Math.abs(row.width-row.expectedWidth)<.2, `${label} SVG width overridden: ${JSON.stringify(row)}`);
        assert.ok(Math.abs(row.height-row.expectedHeight)<.2, `${label} SVG height overridden: ${JSON.stringify(row)}`);
        assert.equal(row.stroke,row.expectedStroke);
      }
      assert.equal(await body(), accentSource);
    }
    await verify('#j-entry-body','expanded');
    assert.equal(await page.locator('.j-brand svg').first().evaluate(el=>getComputedStyle(el).width), '17px');
    if(!await page.locator('[data-filter="math"]').isVisible()) await page.locator('[data-action="sidebar"]').click();
    await page.locator('[data-filter="math"]').click();
    await verify('.j-idea-text','overview');
    await page.locator('#j-entry-body .j-math').first().click();
    assert.equal(await body(),accentSource);
    assert.equal(await page.locator('#j-entry-body .katex').count(),0);
    await page.locator('#j-entry-title').focus();
    await verify('#j-entry-body','blur');
    await page.evaluate(()=>window.journalFlush());
    await exit(); await launch();
    await verify('#j-entry-body','restart');
    await exit();
    assert.deepEqual(errors,[]); assert.deepEqual(external,[]);
    const report={passed:true,cases:['Widehat, square root, vector, tilde, underbrace and extensible arrow SVG geometry matches unscoped KaTeX in expanded editor and project overview','Toolbar icons retain 17px size; exact TeX survives focus, blur, save and cold restart'],measurements,errors,external};
    fs.writeFileSync(path.join(root,'artifacts/math-svg-test.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({passed:report.passed,cases:report.cases}));
  } finally {
    if(browser) await browser.close();
    if(app && app.exitCode===null) app.kill();
  }
})().catch(e=>{console.error(e);process.exitCode=1;});
