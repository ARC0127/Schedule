const test = require("node:test");
const assert = require("node:assert/strict");
const { upgrade } = require("../src/web/state.js");

test("legacy fields migrate without losing identity, content, completion or bindings", () => {
  const idea = {
    id: "legacy-point-1",
    offset: 0,
    done: true,
    projectIds: ["project-a", "project-b"],
  };
  const old = {
    privateContent: {
      projects: [{ id: "project-a", name: "Example", root: "" }],
      newPointProjects: ["project-b"],
      edits: {
        "2026-01-02": {
          title: "Example",
          body: "• A\n  continued",
          points: [idea],
          files: [],
        },
      },
    },
    nativeImages: [["token", { src: "data:image/png;base64,fixture" }]],
  };
  const before = JSON.stringify(old),
    next = upgrade(old);
  assert.equal(JSON.stringify(old), before);
  assert.deepEqual(next.privateContent.edits["2026-01-02"].ideas, [{...idea,todo:true}]);
  assert.equal(
    next.privateContent.edits["2026-01-02"].body,
    old.privateContent.edits["2026-01-02"].body,
  );
  assert.deepEqual(next.nativeImages, old.nativeImages);
  assert.deepEqual(next.privateContent.newIdeaProjects, ["project-b"]);
  assert.ok(!("points" in next.privateContent.edits["2026-01-02"]));
  assert.ok(!("newPointProjects" in next.privateContent));
  assert.deepEqual(upgrade(next), next);
});
test("new-format data wins over obsolete aliases", () => {
  const s = upgrade({
    privateContent: {
      newIdeaProjects: [],
      newPointProjects: ["old"],
      edits: { x: { ideas: [], points: [{ id: "old" }] } },
    },
  });
  assert.deepEqual(s.privateContent.newIdeaProjects, []);
  assert.deepEqual(s.privateContent.edits.x.ideas, []);
});
test("empty installations are valid", () => {
  assert.equal(upgrade(null), null);
  assert.deepEqual(upgrade({}), {});
});
