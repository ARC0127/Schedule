const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parts } = require("../src/web/content.js");
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
