'use strict';
const assert = require('node:assert/strict');
const { webcrypto } = require('node:crypto');
globalThis.crypto ||= webcrypto;
const journal = require('../android/assets/journal');
const content = require('../android/assets/content');
const date = '2026-11-19';
assert.equal(journal.validDate('2026-02-30'), false);
assert.deepEqual([0, 1, 4, 8].map(count => journal.heat(count, 8)), [0, 1, 2, 4]);
const sample = journal.blank();
sample.days[date] = 'Day notes';
sample.projects.push({ id: 'p', name: '项目 / Project' });
sample.ideas.push(
  { id: '1', date, text: 'Idea\nSecond line', state: 'note' },
  { id: '2', date, text: 'Task', state: 'todo', important: true, due: '2026-11-25', projects: ['p'] },
  { id: '3', date, text: 'Finished', state: 'done' });
const plain = journal.exportMarkdown(sample, []);
const parsed = journal.parseMarkdown(plain, date);
assert.deepEqual(parsed.days, sample.days);
assert.deepEqual(parsed.ideas.map(({ text, state }) => [text, state]), [
  ['Idea\nSecond line', 'note'], ['Task', 'todo'], ['Finished', 'done']]);
assert.equal(parsed.ideas[1].important, true);
assert.equal(parsed.ideas[1].due, '2026-11-25');
assert.deepEqual(parsed.ideas[1].projects, [parsed.projects[0].id]);
assert.equal(parsed.projects[0].name, '项目 / Project');
const desktop = journal.parseMarkdown('# 2026-11-19 · Test\n## 日程\n- [ ] 10:00 Event\n## 记录\n- An idea\n- [x] A task', date);
assert.deepEqual(desktop.ideas.map(item => item.text), ['An idea', 'A task']);
const mixed = content.parts('See [link](https://example.org/) and \\(x^2\\).');
assert.equal(mixed.find(part => part.kind === 'math').tex, 'x^2');
assert.equal(mixed.find(part => part.kind === 'url').url, 'https://example.org/');
console.log('Journal/Markdown, heat normalization, TeX and links passed.');

