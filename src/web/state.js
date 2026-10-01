// One-way compatibility: preserve IDs, body, images, completion and project bindings.
(function (root) {
  const taskState = idea => idea?.done ? "done" : idea?.todo || idea?.dueDate ? "todo" : "note";
  function setTaskState(idea, state) {
    if (!["note", "todo", "done"].includes(state)) throw Error("Invalid task state");
    idea.done = state === "done";
    idea.todo = state !== "note";
    if (state === "note") idea.dueDate = "";
    return idea;
  }
  function normalizeIdea(idea) {
    if (idea.done || idea.dueDate) idea.todo = true;
    return idea;
  }
  function upgrade(saved) {
    if (!saved || typeof saved !== "object") return saved;
    const copy = JSON.parse(JSON.stringify(saved)),
      p = copy.privateContent;
    if (!p || typeof p !== "object") return copy;
    if (!Array.isArray(p.newIdeaProjects) && Array.isArray(p.newPointProjects))
      p.newIdeaProjects = p.newPointProjects;
    delete p.newPointProjects;
    for (const entry of Object.values(p.edits || {})) {
      if (!entry || typeof entry !== "object") continue;
      if (!Array.isArray(entry.ideas) && Array.isArray(entry.points))
        entry.ideas = entry.points;
      delete entry.points;
      for (const idea of entry.ideas || []) normalizeIdea(idea);
    }
    p.schemaVersion = 2;
    return copy;
  }
  root.ScheduleState = { upgrade, taskState, setTaskState, normalizeIdea };
  if (typeof module !== "undefined") module.exports = root.ScheduleState;
})(globalThis);
