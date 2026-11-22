'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const model = require('../android/assets/sync');
const blank = () => ({ days: {}, ideas: [], projects: [], docs: {} });
const idea = projects => ({ date: '2034-03-12', text: 'linked idea', projects,
  formats: [], state: 'todo', important: false, due: '', order: 0 });

test('phone project creation and multi-binding merge with desktop project rename', async () => {
  const base = { 'project/a': { name: 'Original' }, 'idea/i': idea(['a']) };
  const phone = model.phoneImport(base, blank(), { base });
  phone.projects.push({ id: 'b', name: '手机新增' });
  phone.ideas[0].projects.push('b');
  const exported = await model.phoneExport(phone, [], () => { throw Error('unexpected image'); });
  const desktop = model.copy(base); desktop['project/a'].name = '电脑改名';
  const merged = model.merge(base, desktop, exported.entities);
  assert.deepEqual(Object.keys(merged.conflicts), []);
  assert.equal(merged.entities['project/b'].name, '手机新增');
  const result = model.phoneImport(merged.entities, phone, { base: merged.entities });
  assert.equal(result.projects.find(p => p.id === 'a').name, '电脑改名');
  assert.deepEqual(result.ideas[0].projects, ['a', 'b']);
  const replay = await model.phoneExport(result, [], () => {});
  assert.deepEqual(model.merge(merged.entities, merged.entities, replay.entities).entities, merged.entities);
});

test('project deletion unbinds ideas only when that deletion is uncontested', () => {
  const base = { 'project/a': { name: 'A' }, 'project/b': { name: 'B' }, 'idea/i': idea(['a', 'b']) };
  const phone = model.copy(base); delete phone['project/a']; phone['idea/i'].projects = ['b'];
  const merged = model.merge(base, base, phone);
  assert.ok(!merged.entities['project/a']); assert.deepEqual(merged.entities['idea/i'].projects, ['b']);
  const desktop = model.copy(base); desktop['project/a'].name = 'Renamed';
  const conflict = model.merge(base, desktop, phone);
  assert.equal(conflict.conflicts['project/a'].desktop.name, 'Renamed');
  assert.equal(conflict.conflicts['project/a'].phone, null);
});

test('simultaneous project renames keep both versions and stable bindings', () => {
  const base = { 'project/a': { name: 'A' }, 'idea/i': idea(['a']) };
  const phone = model.copy(base), desktop = model.copy(base);
  phone['project/a'].name = 'Phone'; desktop['project/a'].name = 'Desktop';
  const merged = model.merge(base, desktop, phone);
  const accepted = model.accept(base, phone, merged);
  assert.equal(accepted.entities['project/a'].name, 'Phone');
  assert.equal(accepted.conflicts['project/a'].desktop.name, 'Desktop');
  assert.deepEqual(accepted.entities['idea/i'].projects, ['a']);
});
