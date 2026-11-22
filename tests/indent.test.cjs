const test = require('node:test');
const assert = require('node:assert/strict');
const content = require('../src/web/content.js');
const formatting = require('../src/web/formatting.js');
function apply(text, result) {
  for (const e of result.edits.toReversed()) text = text.slice(0, e.start) + e.text + text.slice(e.end);
  return text;
}
test('indent/outdent a selected set of lines without including the next line', () => {
  const text = 'alpha\nbeta\ngamma', result = content.indent(text, 0, 11);
  assert.equal(apply(text, result), '\talpha\n\tbeta\ngamma');
  assert.deepEqual([result.start, result.end], [1, 13]);
  const indented = apply(text, result);
  assert.equal(apply(indented, content.indent(indented, result.start, result.end, true)), text);
});
test('daily indentation preserves idea boundaries and legacy continuation padding', () => {
  const text = '• parent\n  child\n• next', change = content.indent(text, 0, text.length, false, true);
  const after = apply(text, change), ranges = content.ideaRanges(after);
  assert.equal(after, '• \tparent\n  \tchild\n• \tnext');
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0].text, '\tparent\n\tchild');
  assert.equal(apply(after, content.indent(after, 0, after.length, true, true)), text);
  assert.equal(content.ideaRanges(apply('•', content.indent('•',1,1,false,true))).length, 1);
});
test('outdent clamps at zero and empty leading lines can be indented', () => {
  assert.deepEqual(content.indent('plain', 2, 2, true).edits, []);
  assert.equal(apply('\nnext', content.indent('\nnext', 0, 0)), '\t\nnext');
  assert.equal(apply('  two', content.indent('  two', 1, 1, true)), 'two');
});
test('display preserves user indentation and style offsets', () => {
  const body = '• \tbold\n  \tchild', range = content.ideaRanges(body)[0];
  const display = formatting.forIdea(body, range, [{start:3,end:7,bold:true}]);
  assert.equal(display.text, '\tbold\n\tchild');
  assert.deepEqual(display.formats, [{start:1,end:5,bold:true}]);
});
