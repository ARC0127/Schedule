const { test } = require("node:test"),
  assert = require("node:assert/strict");
const f = require("../src/web/formatting.js"),
  { parts, ideaRanges } = require("../src/web/content.js");
test("formatting changes only a selected range and merges compatible runs", () => {
  let runs = f.apply([], 10, 2, 8, { bold: true });
  runs = f.apply(runs, 10, 4, 6, { color: "#b34848", size: 20 });
  assert.deepEqual(runs, [
    { start: 2, end: 4, bold: true },
    { start: 4, end: 6, bold: true, size: 20, color: "#b34848" },
    { start: 6, end: 8, bold: true },
  ]);
  assert.deepEqual(f.apply(runs, 10, 4, 6, null), [
    { start: 2, end: 4, bold: true },
    { start: 6, end: 8, bold: true },
  ]);
  assert.deepEqual(f.apply(runs, 10, 2, 8, { color: null, size: null }), [
    { start: 2, end: 8, bold: true },
  ]);
});
test("insertions, replacements and deletions preserve unaffected style offsets", () => {
  const runs = [{ start: 2, end: 6, bold: true }];
  assert.deepEqual(
    f.replace(
      runs,
      "abcdefgh",
      "abXXcdefgh",
      { start: 2, end: 2, newEnd: 4 },
      { color: "#286746" },
    ),
    [
      { start: 2, end: 4, color: "#286746" },
      { start: 4, end: 8, bold: true },
    ],
  );
  assert.deepEqual(
    f.replace(runs, "abcdefgh", "abefgh", { start: 2, end: 4, newEnd: 2 }),
    [{ start: 2, end: 4, bold: true }],
  );
  assert.deepEqual(
    f.replace(
      runs,
      "abcdefgh",
      "abcZZfgh",
      { start: 3, end: 5, newEnd: 5 },
      { italic: true },
    ),
    [
      { start: 2, end: 3, bold: true },
      { start: 3, end: 5, italic: true },
      { start: 5, end: 6, bold: true },
    ],
  );
  assert.deepEqual(
    f.replace(
      runs,
      "abcdefgh",
      "abcdef!gh",
      { start: 6, end: 6, newEnd: 7 },
      {},
    ),
    runs,
  );
});
test("explicit edits disambiguate repeated text and preserve UTF-16 offsets", () => {
  assert.deepEqual(
    f.replace(
      [{ start: 1, end: 2, bold: true }],
      "aaa",
      "aaaa",
      { start: 1, end: 1, newEnd: 2 },
      {},
    ),
    [{ start: 2, end: 3, bold: true }],
  );
  const text = "• 中文😀内容";
  const runs = f.apply([], text.length, 2, 6, { underline: true });
  assert.equal(
    f
      .segments(text, runs)
      .filter((s) => s.style.underline)
      .map((s) => s.text)
      .join(""),
    "中文😀",
  );
});
test("clipboard ranges preserve plain gaps and sanitize untrusted style values", () => {
  const runs = [
    { start: 0, end: 2, bold: true },
    { start: 4, end: 6, color: "#356ca1" },
  ];
  const copied = f.slice(runs, 1, 5);
  assert.deepEqual(
    f.replace(
      [],
      "X",
      "Xbcde",
      { start: 1, end: 1, newEnd: 5 },
      { italic: true },
      copied,
    ),
    [
      { start: 1, end: 2, bold: true },
      { start: 4, end: 5, color: "#356ca1" },
    ],
  );
  assert.deepEqual(
    f.normalize(
      [
        {
          start: 0,
          end: 99,
          bold: "true",
          size: 1000,
          color: "red; background:url(https://example.com)",
          italic: true,
        },
      ],
      5,
    ),
    [{ start: 0, end: 5, italic: true }],
  );
  assert.equal(
    f.css({ color: '" onmouseover="alert(1)', size: "20px", bold: true }),
    "font-weight:700",
  );
});
test("project overview styles follow stripped bullet and legacy indentation", () => {
  const body = "• first\n  second\nthird";
  const start = body.indexOf("second");
  const view = f.forIdea(body, ideaRanges(body)[0], [
    { start, end: start + 6, bold: true },
  ]);
  assert.equal(view.text, "first\nsecond\nthird");
  assert.deepEqual(view.formats, [{ start: 6, end: 12, bold: true }]);
});
test("token source offsets survive link labels, quoted paths, math and punctuation", () => {
  const text = String.raw`[link](https://example.com)) "C:\My Files\note.txt" \(x^2\) after`;
  for (const part of parts(text, true)) {
    if (part.kind !== "image")
      assert.equal(
        text.slice(part.textStart, part.textStart + part.text.length),
        part.text,
      );
  }
});
