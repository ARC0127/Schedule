const { test } = require("node:test");
const assert = require("node:assert/strict");
const features = require("../src/web/features.js");
test("search spans historical ideas, project names, events and linked paths", () => {
  const records = {
    "2000-01-02": {
      title: "旧笔记",
      body: "• 模型实验\n第二行",
      ideas: [{ id: "i", offset: 0, projectIds: ["p"] }],
      files: [{ name: "source", path: "C:\\Research\\code" }],
      appointments: [{ title: "讨论", time: "14:00" }],
    },
  };
  const projects = [{ id: "p", name: "JEPA" }];
  assert.equal(features.search(records, projects, "JEPA")[0].id, "i");
  assert.equal(
    features.search(records, projects, "第二行")[0].date,
    "2000-01-02",
  );
  assert.equal(
    features.search(records, projects, "讨论")[0].type,
    "日期 / 日程 / 资料",
  );
  assert.equal(
    features.search(records, projects, "Research")[0].date,
    "2000-01-02",
  );
  assert.deepEqual(features.search(records, projects, "unmatched"), []);
});
test("Markdown export includes image files, original TeX, event state, project and idea metadata", () => {
  const records = {
    "2026-10-01": {
      title: "Notebook",
      body: "• Diffusion \\(x_\\tau=x\\)\n\uE000",
      ideas: [
        {
          id: "i",
          offset: 0,
          done: true,
          important: true,
          dueDate: "2026-10-03",
          projectIds: ["p"],
        },
      ],
      files: [],
      appointments: [{ title: "Review", time: "15:00", done: true }],
    },
  };
  const output = features.markdown(
    records,
    [{ id: "p", name: "Research" }],
    [["\uE000", { name: "demo", src: "data:image/png;base64,AA==" }]],
  );
  assert.equal(output.documents[0].name, "2026-10-01.md");
  assert.ok(output.documents[0].text.includes("\\(x_\\tau=x\\)"));
  assert.ok(output.documents[0].text.includes("- [x] 15:00 Review"));
  assert.ok(output.documents[0].text.includes("截止 2026-10-03"));
  assert.ok(output.documents[0].text.includes("项目：Research"));
  assert.ok(output.documents[0].text.includes("images/image-e000.png"));
  assert.deepEqual(output.images, [{ name: "image-e000.png", base64: "AA==" }]);
});
test("Markdown import keeps multiline TeX and translates explicit bullets only", () => {
  const imported = features.importMarkdown(
    "- [x] First\r\n\\(x_\\tau\r\n= x\\)\r\n- Second",
  );
  assert.equal(imported.body, "• First\n\\(x_\\tau\n= x\\)\n• Second");
  assert.deepEqual(imported.flags, [true, false]);
});
test("todos include only explicit tasks, deadlines and incomplete events", () => {
  const {todos}=require('../src/web/features.js');
  const rows=todos({'2026-10-01':{body:'• 普通\n• 待办\n• 逾期\n• 完成',ideas:[{id:'note',offset:0},{id:'task',offset:5,todo:true},{id:'late',offset:10,dueDate:'2026-09-30'},{id:'done',offset:15,todo:true,done:true}],appointments:[{id:'event',title:'今天安排'},{id:'finished',done:true}]}},'2026-10-01');
  assert.deepEqual(rows.map(r=>[r.id,r.group]),[['late',0],['event',1],['task',3]]);
});
