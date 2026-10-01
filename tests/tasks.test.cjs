const test=require('node:test'),assert=require('node:assert/strict');
const {taskState,setTaskState,upgrade}=require('../src/web/state.js');
const {todos,markdown,importMarkdown}=require('../src/web/features.js');
test('legacy done/deadlines normalize without turning notes into tasks; transitions preserve identity',()=>{
 const source={privateContent:{edits:{'2026-10-01':{body:'unchanged',ideas:[{id:'a',done:true,projectIds:['p']},{id:'b',dueDate:'2026-10-02'},{id:'c',done:false}]}}}};
 const result=upgrade(source),ideas=result.privateContent.edits['2026-10-01'].ideas;
 assert.deepEqual(ideas.map(taskState),['done','todo','note']);assert.deepEqual(upgrade(result),result);assert.equal(source.privateContent.edits['2026-10-01'].ideas[0].todo,undefined);
 const note=ideas[2];setTaskState(note,'done');assert.equal(taskState(note),'done');setTaskState(note,'todo');assert.equal(taskState(note),'todo');note.dueDate='2026-10-02';setTaskState(note,'note');assert.equal(note.dueDate,'');assert.equal(note.id,'c');
});
test('linked reminders yield one task, completed history includes legacy Ctrl ideas, priority filters have metadata',()=>{
 const records={'2026-10-01':{body:'• note\n• task\n• old done',ideas:[{id:'n',offset:0},{id:'t',offset:7,todo:true,important:true},{id:'d',offset:14,done:true}]},'2026-10-02':{appointments:[{id:'l',ideaDate:'2026-10-01',ideaId:'t',title:'reminder',time:'09:00'},{id:'e',title:'meeting',time:'10:00'}]}};
 const pending=todos(records,'2026-10-01');assert.deepEqual(pending.map(r=>r.id),['t','e']);assert.equal(pending[0].scheduled,true);assert.equal(pending[0].important,true);
 assert.deepEqual(todos(records,'2026-10-01',true).map(r=>r.id),['d']);records['2026-10-01'].ideas[1].done=true;
 assert.deepEqual(todos(records,'2026-10-01').map(r=>r.id),['e']);assert.equal(todos(records,'2026-10-01',true).filter(r=>r.id==='t').length,1);
});
test('Markdown preserves ordinary versus pending versus completed ideas',()=>{
 const imported=importMarkdown('- note\n- [ ] task\n- [x] done');assert.deepEqual(imported.tasks,[false,true,true]);assert.deepEqual(imported.flags,[false,false,true]);
 const out=markdown({'2026-10-01':{body:imported.body,ideas:[{offset:0},{offset:7,todo:true},{offset:14,done:true}]}},[],new Map());
 assert.match(out.documents[0].text,/- note\n- \[ \] task\n- \[x\] done/);
});
