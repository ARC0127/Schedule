const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parts, ideaRanges, mathParts } = require("../src/web/content.js");
const formulas = String.raw`Diffusion \(x_\tau=\alpha_\tau x+\sigma_\tau\epsilon,
\qquad
\epsilon\sim\mathcal N(0,I).\)
flow matching \(x_\tau=(1-\tau)\epsilon+\tau x.\)`;
test("multiline pasted formulas belong to one manual idea until the next bullet", () => {
  const body = "• " + formulas + "\n\nUnindented continuation\n• Next idea";
  const ranges = ideaRanges(body);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].text, formulas + "\n\nUnindented continuation");
  assert.equal(
    body.slice(ranges[0].offset, ranges[0].end),
    "• " + ranges[0].text,
  );
  assert.equal(ranges[1].offset, body.indexOf("• Next"));
  assert.equal(
    ideaRanges("• \nUnindented content")[0].text.trim(),
    "Unindented content",
  );
  assert.equal(
    ideaRanges("Intro\n• Kept\n  legacy continuation")[0].text,
    "Kept\nlegacy continuation",
  );
});
test("math delimiters retain complete multiline source before path/link tokenization", () => {
  const math = parts(formulas).filter((x) => x.kind === "math");
  assert.equal(math.length, 2);
  assert.ok(math[0].tex.includes("\\epsilon\\sim\\mathcal N(0,I)."));
  assert.equal(
    mathParts(formulas)
      .map((x) => x.text)
      .join(""),
    formulas,
  );
  const matrix = String.raw`\[\begin{matrix}a&b\\c&d\end{matrix}\]`;
  assert.deepEqual(
    parts(matrix).map((x) => x.kind),
    ["math"],
  );
  assert.equal(parts("$$x^2$$")[0].display, true);
  assert.deepEqual(mathParts(String.raw`literal \\(x\) and unfinished \(x`), [
    { kind: "text", text: String.raw`literal \\(x\) and unfinished \(x` },
  ]);
});
test("images retain their exact positions among text and links", () => {
  assert.deepEqual(parts("Before \uE000 after"), [
    { kind: "text", text: "Before " },
    { kind: "image", token: "\uE000" },
    { kind: "text", text: " after" },
  ]);
});
test("HTTP links preserve query strings, labels and balanced parentheses", () => {
  const tokens = parts(
    "https://example.com/a?q=1&b=2。 [Guide](https://example.com/docs) (https://example.com/wiki/Test_(one))",
  );
  assert.deepEqual(
    tokens.filter((x) => x.kind === "url").map((x) => [x.text, x.url]),
    [
      ["https://example.com/a?q=1&b=2", "https://example.com/a?q=1&b=2"],
      ["Guide", "https://example.com/docs"],
      [
        "https://example.com/wiki/Test_(one)",
        "https://example.com/wiki/Test_(one)",
      ],
    ],
  );
});
test("quoted local paths preserve spaces; UNC and drive paths are recognized", () => {
  assert.deepEqual(
    parts(
      String.raw`"C:\My Files\note.txt" C:\notes\a.md \\server\share\file.pdf`,
    )
      .filter((x) => x.kind === "path")
      .map((x) => x.text),
    [
      String.raw`C:\My Files\note.txt`,
      String.raw`C:\notes\a.md`,
      String.raw`\\server\share\file.pdf`,
    ],
  );
});
test("markup and non-web schemes do not become external links", () => {
  const text =
    "<img src=x onerror=alert(1)> javascript:alert(1) data:text/html,test ms-settings:notifications";
  assert.deepEqual(parts(text), [{ kind: "text", text }]);
});
