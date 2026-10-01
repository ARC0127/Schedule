/* Shared, deterministic search and portable Markdown projection. */
(function (root) {
  const content =
    typeof module !== "undefined"
      ? require("./content.js")
      : root.ScheduleContent;
  function search(records, projects, query) {
    const q = String(query || "")
      .trim()
      .toLocaleLowerCase();
    if (!q) return [];
    const names = (ids) =>
      (ids || [])
        .map((id) => projects.find((p) => p.id === id)?.name || "")
        .join(" ");
    const result = [];
    for (const [date, r] of Object.entries(records)) {
      const ranges = content.ideaRanges(r.body || "");
      const ideas = ranges.map((range) => ({
        ...range,
        ...(r.ideas || []).find((p) => p.offset === range.offset),
      }));
      for (const idea of ideas)
        if (
          `${date} ${idea.text} ${names(idea.projectIds)} ${idea.dueDate || ""}`
            .toLocaleLowerCase()
            .includes(q)
        )
          result.push({
            date,
            id: idea.id || null,
            type: "想法",
            title: r.title || date,
            text: idea.text,
            offset: idea.offset,
          });
      const meta = [
        date,
        r.title,
        ...(r.files || []).map((f) => `${f.name} ${f.path || f.target || ""}`),
        ...(r.appointments || (r.appointment ? [r.appointment] : [])).map(
          (s) => `${s.time} ${s.title}`,
        ),
        !ranges.length ? r.body : "",
      ]
        .filter(Boolean)
        .join(" · ");
      if (meta.toLocaleLowerCase().includes(q))
        result.push({
          date,
          id: null,
          type: "日期 / 日程 / 资料",
          title: r.title || date,
          text: meta,
          offset: -1,
        });
    }
    return result.sort(
      (a, b) => b.date.localeCompare(a.date) || a.offset - b.offset,
    );
  }
  function markdown(records, projects, assets) {
    const images = [],
      tokens = new Map();
    for (const [token, asset] of assets) {
      const match =
        /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,(.+)$/s.exec(
          asset.src || "",
        );
      if (!match) continue;
      const name = `image-${token.charCodeAt(0).toString(16)}.${match[1] === "jpeg" ? "jpg" : match[1]}`;
      tokens.set(
        token,
        `![${(asset.name || "图片").replace(/[\[\]\r\n]/g, "")}](images/${name})`,
      );
      images.push({ name, base64: match[2] });
    }
    const documents = Object.entries(records)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, r]) => {
        const lines = [`# ${date}${r.title ? " · " + r.title : ""}`, ""];
        const events = r.appointments || (r.appointment ? [r.appointment] : []);
        if (events.length)
          lines.push(
            "## 日程",
            "",
            ...events.map(
              (s) =>
                `- [${s.done ? "x" : " "}] ${s.time} ${s.title}${s.important ? " ★" : ""}`,
            ),
            "",
            "## 记录",
            "",
          );
        let offset = 0;
        const body = (r.body || "")
          .split("\n")
          .map((line) => {
            const idea = (r.ideas || []).find((p) => p.offset === offset);
            offset += line.length + 1;
            if (idea && /^•(?: |$)/.test(line)) {
              const projectsText = (idea.projectIds || [])
                .map((id) => projects.find((p) => p.id === id)?.name)
                .filter(Boolean)
                .join("、");
              const meta = [
                idea.important ? "★" : "",
                idea.dueDate ? "截止 " + idea.dueDate : "",
                projectsText ? "项目：" + projectsText : "",
              ]
                .filter(Boolean)
                .join(" · ");
              const task = idea.done || idea.todo || idea.dueDate;
              line = `- ${task ? `[${idea.done ? "x" : " "}] ` : ""}${line.replace(/^• ?/, "")}${meta ? " 〔" + meta + "〕" : ""}`;
            }
            return line.replace(
              /[\uE000-\uF8FF]/g,
              (t) => tokens.get(t) || "[图片缺失]",
            );
          })
          .join("\n");
        lines.push(body);
        if (r.files?.length)
          lines.push(
            "",
            "## 关联资料",
            "",
            ...r.files.map((f) => `- ${f.name}: ${f.path || f.target || ""}`),
          );
        return { name: date + ".md", text: lines.join("\n") };
      });
    return { documents, images };
  }
  function importMarkdown(text) {
    const flags = [], tasks = [];
    const body = String(text)
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .map((line) => {
        const match = /^[-*] (?:\[([ xX])\] )?(.*)$/.exec(line);
        if (!match) return line;
        flags.push(!!match[1] && match[1].toLowerCase() === "x");
        tasks.push(match[1] !== undefined);
        return "• " + match[2];
      })
      .join("\n");
    return { body, flags, tasks };
  }
  function todos(records, today, completed = false) {
    const rows = [];
    const linked = new Map();
    for (const [date, r] of Object.entries(records)) {
      for (const event of r.appointments || (r.appointment ? [r.appointment] : [])) {
        if (event.ideaId && records[event.ideaDate]?.ideas?.some(p => p.id === event.ideaId)) {
          const key = event.ideaDate + "/" + event.ideaId;
          const previous = linked.get(key);
          if (!previous || (date + event.time) < (previous.date + previous.time)) linked.set(key, {...event, date});
        }
      }
    }
    for (const [date, r] of Object.entries(records)) {
      for (const s of r.appointments || (r.appointment ? [r.appointment] : [])) {
        if (s.ideaId && records[s.ideaDate]?.ideas?.some(p => p.id === s.ideaId)) continue;
        if (!!s.done === completed) rows.push({ date, id: s.id, kind: "event", due: date, text: s.title, time: s.time || "", done: !!s.done, important: !!s.important, scheduled: true });
      }
      const ranges = new Map(content.ideaRanges(r.body || "").map(p => [p.offset, p]));
      for (const idea of r.ideas || []) {
        const event = linked.get(date + "/" + idea.id);
        if (!!idea.done !== completed || (!idea.done && !idea.todo && !idea.dueDate && !event)) continue;
        const range = ranges.get(idea.offset);
        if (range?.text.trim()) rows.push({ date, id: idea.id, kind: "idea", due: idea.dueDate || event?.date || "", time: event?.time || "", text: range.text, projectIds: idea.projectIds || [], done: !!idea.done, important: !!idea.important || !!event?.important, scheduled: !!event });
      }
    }
    return rows.map(r => ({ ...r, group: !r.due ? 3 : r.due < today ? 0 : r.due === today ? 1 : 2 }))
      .sort((a,b) => a.group-b.group || Number(b.important)-Number(a.important) || a.due.localeCompare(b.due) || (a.time || "").localeCompare(b.time || "") || a.date.localeCompare(b.date));
  }
  const api = { search, markdown, importMarkdown, todos };
  if (typeof module !== "undefined") module.exports = api;
  else root.ScheduleFeatures = api;
})(globalThis);
