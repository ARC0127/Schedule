// One-way compatibility: preserve IDs, body, images, completion and project bindings.
(function (root) {
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
    }
    p.schemaVersion = 2;
    return copy;
  }
  root.ScheduleState = { upgrade };
  if (typeof module !== "undefined") module.exports = { upgrade };
})(globalThis);
