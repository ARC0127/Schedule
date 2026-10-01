(async () => {
  const root = document.getElementById("journal-ui");
  if (window.journalNative) {
    root.inert = true;
    const status = document.createElement("div");
    status.className = "j-load-status";
    status.setAttribute("role", "status");
    status.textContent = "正在读取本机记录…";
    root.before(status);
    try {
      const boot = await window.journalNative.call("loadState");
      window.__journalBoot = boot;
      window.openai.widgetState = boot.widgetState;
      window.journalNative.schedules = boot.schedules || {};
    } catch (error) {
      status.setAttribute("role", "alert");
      status.textContent = `记录读取失败，未保存空白界面。${error.message} 请退出后重试。`;
      return;
    }
  }
  const $ = (s) => root.querySelector(s),
    $$ = (s) => Array.from(root.querySelectorAll(s));
  const esc = (s) =>
    String(s ?? "").replace(
      /[&<>"']/g,
      (c) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          '"': "&quot;",
          "'": "&#39;",
        })[c],
    );
  let today = new Date().toLocaleDateString("sv-SE");
  const names = [
    "一月",
    "二月",
    "三月",
    "四月",
    "五月",
    "六月",
    "七月",
    "八月",
    "九月",
    "十月",
    "十一月",
    "十二月",
  ];
  const empty = () => ({
    title: "",
    body: "",
    project: "",
    source: "手动记录",
    important: false,
    files: [],
    schedule: "",
    kind: "journal",
  });
  const records = {};
  let projects = [];
  const projectById = (id) => projects.find((p) => p.id === id);
  const legacyProjectIds = (r) =>
    Array.isArray(r?.projectIds)
      ? r.projectIds.filter((id) => projectById(id))
      : projects.filter((p) => p.name === r?.project).map((p) => p.id);
  const entryProjectIds = (r) =>
    Array.isArray(r?.ideas)
      ? [...new Set(r.ideas.flatMap((p) => p.projectIds || []))].filter((id) =>
          projectById(id),
        )
      : legacyProjectIds(r);
  const entryProjectNames = (r) =>
    entryProjectIds(r)
      .map((id) => projectById(id).name)
      .join(" · ");
  const cleanPath = (p) => {
    const value = String(p || "")
      .trim()
      .replace(/^"|"$/g, "");
    if (/^[a-z]:[\\/]$/i.test(value)) return value.slice(0, 2) + "\\";
    if (value === "/") return value;
    return value.replace(/[\\/]+$/, "");
  };
  const pathKey = (p) => {
    const s = cleanPath(p);
    return /^(?:[a-z]:|\\\\)/i.test(s)
      ? s.replace(/\//g, "\\").toLowerCase()
      : s;
  };
  const resourcePath = (f) =>
    f.projectId && projectById(f.projectId)
      ? projectById(f.projectId).root +
        (f.relativePath
          ? (/[\\/]$/.test(projectById(f.projectId).root)
              ? ""
              : projectById(f.projectId).root.startsWith("/")
                ? "/"
                : "\\") + f.relativePath
          : "")
      : f.path || "";
  function projectForPath(path) {
    if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path)) return null;
    const key = pathKey(path);
    return (
      projects
        .filter(
          (p) =>
            p.root &&
            (key === pathKey(p.root) ||
              key.startsWith(
                pathKey(p.root).replace(/[\\/]+$/, "") +
                  (/^(?:[a-z]:|\\\\)/i.test(p.root) ? "\\" : "/"),
              )),
        )
        .sort((a, b) => b.root.length - a.root.length)[0] || null
    );
  }
  let projectDialog = { id: null, link: false };
  let newIdeaProjects = [],
    pickerTarget = null,
    overviewPage = 0;
  const makeIdeaId = () =>
    "idea-" +
    Array.from(crypto.getRandomValues(new Uint32Array(3)), (n) =>
      n.toString(16),
    ).join("-");
  const copyIdeas = (ideas) =>
    (ideas || []).map((p) => window.ScheduleState.normalizeIdea({
      id: p.id,
      offset: p.offset,
      done: !!p.done,
      ...(p.todo !== undefined ? {todo: !!p.todo} : {}),
      ...(p.important !== undefined ? {important: !!p.important} : {}),
      ...(p.dueDate !== undefined ? {dueDate: p.dueDate || ""} : {}),
      projectIds: [...(p.projectIds || [])],
    }));
  const ideaRanges = window.ScheduleContent.ideaRanges;
  function migrateIdeas(r, key) {
    const old = Array.isArray(r.ideas) ? r.ideas : null,
      used = new Set();
    r.ideas = ideaRanges(r.body).map((p, i) => {
      const saved = old?.find(
        (x) =>
          x.offset === p.offset && typeof x.id === "string" && !used.has(x.id),
      );
      const id = saved?.id || `${key}-idea-${i}`;
      used.add(id);
      return window.ScheduleState.normalizeIdea({
        id,
        offset: p.offset,
        done: !!saved?.done,
        ...(saved?.todo !== undefined ? {todo: !!saved.todo} : {}),
        ...(saved?.important !== undefined ? {important: !!saved.important} : {}),
        ...(saved?.dueDate !== undefined ? {dueDate: saved.dueDate || ""} : {}),
        projectIds: [
          ...new Set(
            (saved?.projectIds || (old ? [] : legacyProjectIds(r))).filter(
              (id) => projectById(id),
            ),
          ),
        ],
      });
    });
  }
  function reconcileIdeas(record, body, edit) {
    const old = String(record.body || ""),
      previous = copyIdeas(record.ideas);
    if (old === body) return previous;
    let a = 0;
    while (a < old.length && a < body.length && old[a] === body[a]) a++;
    let b = old.length,
      c = body.length;
    while (b > a && c > a && old[b - 1] === body[c - 1]) {
      b--;
      c--;
    }
    if (edit) {
      a = edit.start;
      b = edit.end;
      c = edit.newEnd;
    }
    const delta = c - b,
      mapped = new Map();
    for (const p of previous) {
      const pos =
        p.offset < a ? p.offset : p.offset >= b ? p.offset + delta : -1;
      if (pos >= 0) mapped.set(pos, p);
    }
    const ranges = ideaRanges(body),
      next = ranges.map((p) => {
        const prior = mapped.get(p.offset);
        return prior
          ? { ...prior, offset: p.offset }
          : {
              id: makeIdeaId(),
              offset: p.offset,
              done: false,
              projectIds: [...newIdeaProjects],
            };
      });
    for (const oldRange of ideaRanges(old)) {
      if (oldRange.offset < a || oldRange.offset >= b || oldRange.end <= b)
        continue;
      const source = previous.find((p) => p.offset === oldRange.offset),
        index = ranges.findIndex((p) => p.offset <= c && p.end >= c);
      if (source && index >= 0) {
        next[index].projectIds = [
          ...new Set([...next[index].projectIds, ...source.projectIds]),
        ];
        next[index].done = !!next[index].done && !!source.done;
      }
    }
    return next;
  }
  function ideaAtCaret() {
    const start = ideaContext().ideaStart;
    return current().ideas?.find((p) => p.offset === start) || null;
  }
  function inputMutation(before, body, type) {
    if (!before) return null;
    let start = before.start,
      end = before.end;
    const delta = body.length - before.body.length;
    if (start === end && delta < 0) {
      if (type === "deleteContentBackward") start += delta;
      else if (type === "deleteContentForward") end -= delta;
      else return null;
    }
    const newEnd = end + delta;
    if (
      start < 0 ||
      newEnd < start ||
      body.slice(0, start) !== before.body.slice(0, start) ||
      body.slice(newEnd) !== before.body.slice(end)
    )
      return null;
    return { start, end, newEnd };
  }
  function visibleIdeas(r) {
    if (!r || r.kind === "schedule") return [];
    const meta = new Map((r.ideas || []).map((p) => [p.offset, p]));
    return ideaRanges(r.body)
      .filter((p) => p.text.trim())
      .map((p) => ({
        ...p,
        ...meta.get(p.offset),
        projectIds: meta.get(p.offset)?.projectIds || [],
      }));
  }
  let state = {
    year: Number(today.slice(0, 4)),
    month: Number(today.slice(5, 7)) - 1,
    selected: today,
    view: "month",
    filter: "all",
    query: "",
    edits: {},
    sidebar: null,
    sidebarWidth: 200,
    navigation: {},
    dayExpanded: false,
    sidebarScroll: 0,
  };
  let composing = false,
    saveTimer,
    frame,
    toastTimer;
  const bodyHistory = new Map();
  let beforeEdit = null,
    compositionStart = null;
  const key = (y, m, d) =>
    `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const parse = (k) => k.split("-").map(Number);
  const current = () => records[state.selected] || empty();
  const eventsFor = (r) => r?.appointments || (r?.appointment ? [r.appointment] : []);
  const isImportant = (r) => !!r && (!!r.important || eventsFor(r).some(s => s.important) || (r.ideas || []).some(p => p.important));
  const icons = () => {
    $$("button").forEach((b) => b.classList.add("cursor-interaction"));
    if (globalThis.lucide)
      lucide.createIcons({ attrs: { width: 16, height: 16 } });
  };
  function matches(r) {
    return (
      !!r &&
      (state.filter === "all" ||
        (state.filter === "important" && isImportant(r)) ||
        entryProjectIds(r).includes(state.filter)) &&
      (state.filter !== "search" || !state.query ||
        [
          r.title,
          r.body,
          entryProjectNames(r),
          ...r.files.map((f) => f.name + " " + resourcePath(f)),
        ]
          .join(" ")
          .toLowerCase()
          .includes(state.query.toLowerCase()))
    );
  }
  const ideaCount = (body) =>
    ideaRanges(body).filter((p) => p.text.trim()).length;
  const hasContent = (r) =>
    !!r &&
    (!!r.title.trim() || !!r.body.trim() || r.files.length > 0 || !!r.schedule);
  const score = (r) => (r && r.kind !== "schedule" ? ideaCount(r.body) : 0);
  function maximum() {
    let m = 0;
    for (const [k, r] of Object.entries(records)) {
      const [y, mo] = parse(k);
      if (
        y === state.year &&
        (state.view === "year" || mo === state.month + 1) &&
        matches(r)
      )
        m = Math.max(m, score(r));
    }
    return m;
  }
  const level = (r, max) =>
    !matches(r) || !score(r) || !max
      ? 0
      : Math.min(5, Math.ceil((5 * score(r)) / max));
  const bodyField = () => $("#j-entry-body");
  const textFormats = window.ScheduleFormatting;
  let typingFormat = null, typingPosition = null, toolbarSelection = null, formatOpen = false;
  function resetTypingFormat() {
    typingFormat = null;
    typingPosition = null;
    toolbarSelection = null;
  }
  function selectionStyle() {
    const { start, end } = editorSelection(), runs = current().formats || [];
    if (start === end) return typingFormat ?? textFormats.at(runs, start, true);
    const styles = textFormats.segments(bodyField().value.slice(start, end), runs, start).map(p => p.style);
    const value = {};
    for (const name of ["bold", "italic", "underline", "size", "color"])
      if (styles.length && styles.every(s => s[name] === styles[0][name])) value[name] = styles[0][name];
    return textFormats.style(value);
  }
  function updateFormatToolbar() {
    const selection = editorSelection();
    if (!composing && typingPosition && (typingPosition.date !== state.selected ||
        selection.start !== typingPosition.at || selection.start !== selection.end)) resetTypingFormat();
    const value = selectionStyle();
    const show = formatOpen || (selection.start !== selection.end && (document.activeElement === bodyField() || $(".j-format-tools").contains(document.activeElement)));
    $(".j-format-tools").hidden = !show;
    $('[data-action="toggle-format"]').setAttribute("aria-expanded", String(show));
    $$("[data-format]").forEach(b => {
      if (b.dataset.format !== "clear") b.setAttribute("aria-pressed", String(!!value[b.dataset.format]));
    });
    $("#j-font-size").value = value.size || "";
    $("#j-text-color").value = value.color || "";
  }
  function applyTextFormat(patch) {
    if (composing) return;
    const t = bodyField(), selection = toolbarSelection || editorSelection();
    toolbarSelection = null;
    historyFor().lastType = "";
    t.focus({ preventScroll: true });
    setBodySelection(selection.start, selection.end);
    if (selection.start === selection.end) {
      typingFormat = patch === null ? {} : textFormats.style({ ...selectionStyle(), ...patch });
      typingPosition = { date: state.selected, at: selection.start };
    } else {
      const h = historyFor();
      h.undo.push(bodySnapshot()); h.redo = []; h.lastType = "";
      resetTypingFormat();
      changeRecord({ formats: textFormats.apply(current().formats, t.value.length, selection.start, selection.end, patch) });
    }
    beforeEdit = null;
    updateFormatToolbar();
  }
  $(".j-format-tools").addEventListener("pointerdown", e => {
    toolbarSelection = editorSelection();
    if (e.target.closest("button")) e.preventDefault();
  });
  for (const tools of $$(".j-writing-tools, .j-idea-menu")) tools.addEventListener("pointerdown", e => {
    // Keep the editor selection and prevent formula blur rendering from moving the clicked control.
    if (e.target.closest("button")) e.preventDefault();
  });
  $(".j-format-tools").addEventListener("click", e => {
    const b = e.target.closest("[data-format]");
    if (!b) return;
    const name = b.dataset.format;
    applyTextFormat(name === "clear" ? null : { [name]: !selectionStyle()[name] });
  });
  $("#j-font-size").addEventListener("change", e => applyTextFormat({ size: Number(e.target.value) || null }));
  $("#j-text-color").addEventListener("change", e => applyTextFormat({ color: e.target.value || null }));
  function formattedText(text, runs, offset = 0) {
    return textFormats.segments(text, runs, offset).map(part => {
      const css = textFormats.css(part.style), value = esc(part.text);
      return css ? `<span data-text-format="true" style="${css}">${value}</span>` : value;
    }).join("");
  }
  // Native image bytes are persisted with the journal; browser demo state excludes them.
  const imageLoads = new Set();
  function trackImage(p) {
    imageLoads.add(p);
    p.finally(() => imageLoads.delete(p));
    return p;
  }
  const imageAssets = new Map();
  let nextImage = 0xe000,
    lastBodySelection = { start: 0, end: 0 };
  const imagePattern = /[\uE000-\uF8FF]/g;
  function serializeEditor(node) {
    if (node.nodeType === 3) return node.data.replace(/\r/g, "");
    if (node.nodeType === 1 && node.dataset.mathSource !== undefined)
      return node.dataset.mathSource;
    if (node.nodeType === 1 && node.dataset.linkSource !== undefined)
      return node.dataset.linkSource;
    if (node.nodeType === 1 && node.dataset.ideaMarker) return "•";
    if (node.nodeType === 1 && node.dataset.imageToken)
      return node.dataset.imageToken;
    if (node.nodeName === "BR") return node.dataset.caretEnd ? "" : "\n";
    let result = "";
    for (const child of node.childNodes) {
      if (
        ["DIV", "P", "LI"].includes(child.nodeName) &&
        result &&
        !result.endsWith("\n")
      )
        result += "\n";
      result += serializeEditor(child);
    }
    return result;
  }
  function editorSelection() {
    const t = bodyField(),
      s = window.getSelection();
    if (s?.rangeCount && t.contains(s.anchorNode) && t.contains(s.focusNode)) {
      const r = s.getRangeAt(0),
        a = document.createRange(),
        b = document.createRange();
      a.selectNodeContents(t);
      a.setEnd(r.startContainer, r.startOffset);
      b.selectNodeContents(t);
      b.setEnd(r.endContainer, r.endOffset);
      lastBodySelection = {
        start: serializeEditor(a.cloneContents()).length,
        end: serializeEditor(b.cloneContents()).length,
      };
    }
    const size = serializeEditor(t).length;
    return {
      start: Math.min(size, lastBodySelection.start),
      end: Math.min(size, lastBodySelection.end),
    };
  }
  function mathMarkup(part) {
    try {
      return window.katex.renderToString(part.tex, {
        displayMode: part.display,
        throwOnError: true,
        trust: false,
        maxExpand: 1000,
        maxSize: 20,
      });
    } catch {
      return `<span class="j-math-error" title="公式无法解析，已保留原文。点击编辑。">${esc(part.text)}</span>`;
    }
  }
  function drawBody(value) {
    const t = bodyField(),
      fragment = document.createDocumentFragment();
    const appendStyledText = (text, offset, host = fragment) => {
      for (const part of textFormats.segments(text, current().formats, offset)) {
        const css = textFormats.css(part.style);
        if (!css) host.append(document.createTextNode(part.text));
        else {
          const node = document.createElement("span");
          node.dataset.textFormat = "true";
          node.style.cssText = css;
          node.textContent = part.text;
          host.append(node);
        }
      }
    };
    const editing = document.activeElement === t;
    const appendText = (text, offset) => {
      for (const part of window.ScheduleContent.parts(text, true)) {
        const source = text.slice(part.start, part.end);
        if (part.kind !== "url" && part.kind !== "path") {
          appendStyledText(source, offset + part.start); continue;
        }
        const node = document.createElement("a");
        node.className = "j-editor-link";
        node.dataset.editorLink = part.kind;
        node.dataset.linkTarget = part.url || part.text;
        node.href = part.kind === "url" ? part.url : "#";
        node.title = editing ? "Ctrl + 单击打开；直接点击编辑" : "点击打开";
        if (!editing && source !== part.text) {
          node.dataset.linkSource = source;
          node.contentEditable = "false";
          appendStyledText(part.text, offset + part.textStart, node);
        } else appendStyledText(source, offset + part.start, node);
        fragment.append(node);
      }
    };
    let offset = 0,
      lineStart = true;
    const runs = window.ScheduleContent.mathParts(value);
    for (const run of runs) {
      if (run.kind === "math") {
        if (editing) {
          // Keep TeX editable and avoid treating backslashes or URLs inside math as links.
          const lines = run.text.split("\n");
          let sourceOffset = offset;
          lines.forEach((line, i) => { if (i) { fragment.append(document.createElement("br")); sourceOffset++; } appendStyledText(line, sourceOffset); sourceOffset += line.length; });
          offset += run.text.length; lineStart = run.text.endsWith("\n"); continue;
        }
        const node = document.createElement("span");
        node.className = `j-math${run.display ? " is-display" : ""}`;
        node.dataset.mathSource = run.text;
        node.contentEditable = "false";
        node.title = "点击编辑公式";
        node.style.cssText = textFormats.css(textFormats.at(current().formats, offset));
        node.innerHTML = mathMarkup(run);
        fragment.append(node);
        offset += run.text.length;
        lineStart = false;
        continue;
      }
      for (const part of run.text.split(/([\uE000-\uF8FF]|\n)/)) {
        if (!part) continue;
        if (part === "\n") {
          fragment.append(document.createElement("br"));
          offset++;
          lineStart = true;
          continue;
        }
        if (/^[\uE000-\uF8FF]$/.test(part)) {
          const asset = imageAssets.get(part);
          let node;
          if (asset?.src) {
            node = document.createElement("img");
            node.src = asset.src;
            node.alt = asset.name || "粘贴的图片";
            node.draggable = false;
          } else {
            node = document.createElement("span");
            node.className = "j-image-placeholder";
            node.contentEditable = "false";
            node.textContent =
              asset?.status === "loading"
                ? "正在插入图片…"
                : asset?.status === "failed"
                  ? "图片读取失败，请重新粘贴"
                  : "图片数据不可用，请重新粘贴";
          }
          node.dataset.imageToken = part;
          fragment.append(node);
        } else if (lineStart && /^•(?: |$)/.test(part)) {
          const marker = document.createElement("span");
          marker.dataset.ideaMarker = "true";
          marker.dataset.ideaOffset = String(offset);
          marker.className = "j-completion-marker";
          marker.contentEditable = "false";
          marker.textContent = "•";
          fragment.append(marker);
          appendText(part.slice(1), offset + 1);
        } else appendText(part, offset);
        offset += part.length;
        lineStart = false;
      }
    }
    if (value.endsWith("\n")) {
      const end = document.createElement("br");
      end.dataset.caretEnd = "true";
      fragment.append(end);
    }
    t.replaceChildren(fragment);
    updateCompletionMarkers();
  }
  function updateCompletionMarkers() {
    const ideas = current().ideas || [];
    for (const marker of bodyField().querySelectorAll("[data-idea-marker]")) {
      const idea = ideas.find(
          (p) => p.offset === Number(marker.dataset.ideaOffset),
        ),
        done = !!idea?.done;
      marker.textContent = done ? "✓" : window.ScheduleState.taskState(idea) === "todo" ? "☐" : "•";
      marker.classList.toggle("is-done", done);
      marker.setAttribute("aria-label", done ? "已完成" : window.ScheduleState.taskState(idea) === "todo" ? "待办" : "普通想法");
    }
    const idea = ideaAtCaret(),
      button = $("#j-complete-idea");
    button.hidden = !idea;
    button.setAttribute("aria-pressed", String(!!idea?.done));
    button.querySelector("span").textContent = idea?.done ? "已完成" : "完成";
  }

  function setBodySelection(start, end = start) {
    const t = bodyField(),
      length = t.value.length;
    start = Math.max(0, Math.min(start, length));
    end = Math.max(start, Math.min(end, length));
    const locate = (position, container = t) => {
      let used = 0;
      for (let i = 0; i < container.childNodes.length; i++) {
        const n = container.childNodes[i],
          size = serializeEditor(n).length;
        if (n.nodeType === 3 && position <= used + size)
          return [n, position - used];
        if (n.nodeType === 1 && (n.dataset.textFormat || n.dataset.editorLink && n.dataset.linkSource === undefined) && position <= used + size)
          return locate(position - used, n);
        if (position === used) return [container, i];
        if (position <= used + size) return [container, i + 1];
        used += size;
      }
      return [container, container.childNodes.length];
    };
    const [a, ao] = locate(start),
      [b, bo] = locate(end),
      r = document.createRange();
    r.setStart(a, ao);
    r.setEnd(b, bo);
    const s = window.getSelection();
    s.removeAllRanges();
    s.addRange(r);
    lastBodySelection = { start, end };
  }
  Object.defineProperties(bodyField(), {
    value: {
      get() {
        return serializeEditor(this);
      },
      set(value) {
        drawBody(String(value));
        lastBodySelection = { start: 0, end: 0 };
      },
    },
    selectionStart: {
      get() {
        return editorSelection().start;
      },
    },
    selectionEnd: {
      get() {
        return editorSelection().end;
      },
    },
  });
  bodyField().setSelectionRange = setBodySelection;
  bodyField().addEventListener("focus", () => {
    if (!bodyField().querySelector("[data-math-source], [data-editor-link]")) return;
    const selection = editorSelection();
    drawBody(bodyField().value);
    setBodySelection(selection.start, selection.end);
  });
  bodyField().addEventListener("blur", () => {
    if (!composing) drawBody(bodyField().value);
  });
  bodyField().addEventListener("pointerdown", (e) => {
    const link = e.target.closest("[data-editor-link]");
    if (link && (document.activeElement !== bodyField() || e.ctrlKey || e.metaKey)) {
      e.preventDefault(); completionCtrlTap = false; return;
    }
    const formula = e.target.closest("[data-math-source]");
    if (!formula || e.button !== 0 || e.ctrlKey) return;
    e.preventDefault();
    const range = document.createRange();
    range.selectNodeContents(bodyField());
    range.setEndBefore(formula);
    const start = serializeEditor(range.cloneContents()).length;
    bodyField().focus({ preventScroll: true });
    setBodySelection(start, start + formula.dataset.mathSource.length);
  });
  document.addEventListener("selectionchange", () => {
    if (document.activeElement === bodyField()) {
      editorSelection();
      updateIdeaUI();
    }
  });
  function canonicalizeBody() {
    const t = bodyField(),
      selection = editorSelection(),
      value = t.value;
    drawBody(value);
    setBodySelection(selection.start, selection.end);
  }
  function allocateImage(name) {
    while (
      nextImage <= 0xf8ff &&
      Object.values(records).some((r) =>
        r.body.includes(String.fromCharCode(nextImage)),
      )
    )
      nextImage++;
    if (nextImage > 0xf8ff) throw Error("图片容量已达上限");
    const token = String.fromCharCode(nextImage++);
    imageAssets.set(token, { name, status: "loading" });
    return token;
  }
  function repaintImages() {
    renderIdeaOverview();
    if (composing) return;
    const t = bodyField(),
      focused = document.activeElement === t,
      selection = editorSelection();
    drawBody(t.value);
    if (focused) setBodySelection(selection.start, selection.end);
  }
  function decodeImage(src) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(src);
      image.onerror = () => reject(Error("图片读取失败"));
      image.src = src;
    });
  }
  async function loadImage(token, file) {
    try {
      if (file.size > 12 * 1024 * 1024)
        throw Error("支持单张 12 MB 以内的图片");
      const src = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(Error("图片读取失败"));
        reader.readAsDataURL(file);
      });
      await decodeImage(src);
      Object.assign(imageAssets.get(token), { src, status: "ready" });
    } catch (error) {
      imageAssets.get(token).status = "failed";
      notify(error.message);
    }
    repaintImages();
    if (window.journalNative) persist();
  }
  function insertImages(files) {
    const accepted = files.filter((f) =>
      /^image\/(png|jpeg|gif|webp|bmp|avif)$/i.test(f.type),
    );
    if (!accepted.length) {
      notify("请粘贴 PNG、JPEG、GIF 或 WebP 图片。");
      return;
    }
    const tokens = accepted.map((f) => allocateImage(f.name || "粘贴的图片")),
      t = bodyField();
    editBody(t.selectionStart, t.selectionEnd, tokens.join(""));
    accepted.forEach((file, index) =>
      trackImage(loadImage(tokens[index], file)),
    );
    $("#j-paste-hint").textContent = window.journalNative
      ? "图片随日志保存到本机"
      : "图片暂存于当前预览";
  }
  function copyEditor(e, cut = false) {
    const t = bodyField(),
      a = t.selectionStart,
      b = t.selectionEnd;
    if (a === b) return;
    const value = t.value.slice(a, b);
    e.preventDefault();
    e.clipboardData.setData(
      "text/plain",
      value.replace(imagePattern, "[图片]"),
    );
    const formats = textFormats.slice(current().formats, a, b);
    let offset = 0;
    const html = value
      .split(/([\uE000-\uF8FF])/)
      .map((part) => {
        const result = imageAssets.get(part)?.src
          ? `<img data-journal-image="${part}" src="${imageAssets.get(part).src}" alt="${esc(imageAssets.get(part).name)}">`
          : formattedText(part, formats, offset).replace(/\n/g, "<br>");
        offset += part.length;
        return result;
      })
      .join("");
    e.clipboardData.setData(
      "text/html",
      `<div data-journal-clipboard="true" data-journal-formats="${esc(JSON.stringify(formats))}">${html}</div>`,
    );
    if (cut) editBody(a, b, "");
  }
  bodyField().addEventListener("copy", (e) => copyEditor(e));
  bodyField().addEventListener("cut", (e) => copyEditor(e, true));
  bodyField().addEventListener("paste", (e) => {
    if (composing) return;
    e.preventDefault();
    const data = e.clipboardData,
      t = bodyField(),
      html = data.getData("text/html");
    if (html) {
      const template = document.createElement("template");
      template.innerHTML = html;
      const own = template.content.querySelector("[data-journal-clipboard]");
      if (own) {
        let failed = false;
        const visit = (node) => {
          if (node.nodeType === 3) return node.textContent;
          if (node.nodeName === "BR") return "\n";
          if (node.nodeName === "IMG") {
            const token = node.getAttribute("data-journal-image");
            if (imageAssets.get(token)?.src) return token;
            const src = node.getAttribute("src") || "";
            if (
              /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(src) &&
              src.length < 17 * 1024 * 1024
            ) {
              const next = allocateImage(
                node.getAttribute("alt") || "粘贴的图片",
              );
              trackImage(
                decodeImage(src)
                  .then(() => {
                    Object.assign(imageAssets.get(next), {
                      src,
                      status: "ready",
                    });
                    repaintImages();
                    if (window.journalNative) persist();
                  })
                  .catch(() => {
                    imageAssets.get(next).status = "failed";
                    repaintImages();
                    notify("图片读取失败，请重新粘贴。");
                  }),
              );
              return next;
            }
            failed = true;
            return "";
          }
          return Array.from(node.childNodes, visit).join("");
        };
        const value = visit(own);
        let formats;
        try {
          if (!failed && own.hasAttribute("data-journal-formats"))
            formats = textFormats.normalize(JSON.parse(own.getAttribute("data-journal-formats")), value.length);
        } catch { formats = []; }
        editBody(t.selectionStart, t.selectionEnd, value, undefined, undefined, formats);
        if (failed) notify("部分图片未能读取，请重新复制图片粘贴。");
        return;
      }
    }
    const images = Array.from(data.files || []).filter((f) =>
      f.type.startsWith("image/"),
    );
    if (images.length) {
      insertImages(images);
      return;
    }
    const text = data.getData("text/plain");
    if (text) {
      editBody(t.selectionStart, t.selectionEnd, text.replace(/\r\n?/g, "\n"));
      return;
    }
    notify("没有可粘贴的文字或图片，请复制图片本身后重试。");
  });
  function toggleCompletion(date, id) {
    const record = records[date],
      idea = record?.ideas?.find((p) => p.id === id);
    if (!idea || composing) return;
    const previousDone = !!idea.done, previousTodo = idea.todo;
    const ideas = copyIdeas(record.ideas);
    window.ScheduleState.setTaskState(ideas.find((p) => p.id === id), idea.done ? "todo" : "done");
    if (date === state.selected) {
      const h = historyFor();
      h.undo.push(bodySnapshot());
      h.redo = [];
      h.lastType = "";
      changeRecord({ ideas });
    } else {
      record.ideas = ideas;
      state.edits[date] = record;
      persist();
      renderCalendar();
    }
    updateCompletionMarkers();
    offerIdeaUndo(date, id, {done: previousDone, todo: previousTodo}, {done: !previousDone, todo: true}, previousDone ? "已回到待办" : "已完成");
  }
  let completionCtrlTap = false;
  bodyField().addEventListener("keydown", (e) => {
    if (
      e.key === "Control" &&
      !e.repeat &&
      !e.altKey &&
      !e.metaKey &&
      !e.shiftKey &&
      !composing
    )
      completionCtrlTap = true;
    else completionCtrlTap = false;
  });
  bodyField().addEventListener("keyup", (e) => {
    if (e.key !== "Control") return;
    if (completionCtrlTap && !composing) {
      const idea = ideaAtCaret();
      if (idea) toggleCompletion(state.selected, idea.id);
    }
    completionCtrlTap = false;
  });
  window.addEventListener("blur", () => (completionCtrlTap = false));
  bodyField().addEventListener("blur", () => (completionCtrlTap = false));
  root.addEventListener("pointerdown", () => (completionCtrlTap = false), true);
  bodyField().addEventListener("click", (e) => {
    if (!e.ctrlKey || composing) return;
    if (e.target.closest("[data-editor-link]")) { completionCtrlTap = false; return; }
    e.preventDefault();
    completionCtrlTap = false;
    const marker = e.target.closest("[data-idea-marker]");
    let offset = marker ? Number(marker.dataset.ideaOffset) : null;
    if (offset === null) {
      const caret = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (!caret || !bodyField().contains(caret.startContainer)) return;
      const range = document.createRange();
      range.selectNodeContents(bodyField());
      range.setEnd(caret.startContainer, caret.startOffset);
      offset = serializeEditor(range.cloneContents()).length;
    }
    const range = ideaRanges(current().body).find(
        (p) => offset >= p.offset && offset <= p.end,
      ),
      idea = range && current().ideas?.find((p) => p.offset === range.offset);
    if (idea) toggleCompletion(state.selected, idea.id);
  });
  root.addEventListener("click", (e) => {
    const b = e.target.closest("button");
    if (!b) return;
    if (b.dataset.action === "complete-idea") {
      const p = ideaAtCaret();
      if (p) toggleCompletion(state.selected, p.id);
    }
    if (b.dataset.completeId)
      toggleCompletion(b.dataset.ideaDay, b.dataset.completeId);
    if (b.dataset.action === "dock" && window.journalNative)
      window
        .journalFlush()
        .then(() => window.journalNative.call("minimize"))
        .catch(() => {});
  });

  const bodySnapshot = () => ({
    body: bodyField().value,
    start: bodyField().selectionStart,
    end: bodyField().selectionEnd,
    ideas: copyIdeas(current().ideas),
    formats: textFormats.normalize(current().formats, bodyField().value.length),
  });
  function historyFor() {
    if (!bodyHistory.has(state.selected))
      bodyHistory.set(state.selected, {
        undo: [],
        redo: [],
        lastType: "",
        lastTime: 0,
        after: null,
      });
    return bodyHistory.get(state.selected);
  }
  function rememberBody(before, type) {
    const after = bodySnapshot();
    if (before.body === after.body) return;
    const h = historyFor(),
      now = Date.now();
    const typing = [
      "insertText",
      "deleteContentBackward",
      "deleteContentForward",
    ].includes(type);
    const join =
      typing &&
      h.lastType === type &&
      now - h.lastTime < 700 &&
      h.after?.body === before.body &&
      h.after.end === before.start &&
      before.start === before.end;
    if (!join) h.undo.push(before);
    h.redo = [];
    h.lastType = type;
    h.lastTime = now;
    h.after = after;
  }
  function ideaContext() {
    const t = bodyField(),
      value = t.value,
      pos = t.selectionStart,
      start = value.lastIndexOf("\n", pos - 1) + 1;
    let end = value.indexOf("\n", pos);
    if (end < 0) end = value.length;
    const line = value.slice(start, end);
    const ideaStart =
      ideaRanges(value).find((p) => pos >= p.offset && pos <= p.end)?.offset ??
      -1;
    return { start, end, line, ideaStart };
  }
  function updateIdeaUI() {
    updateFormatToolbar();
    updateCompletionMarkers();
    $("#j-idea-count").textContent = `${ideaCount(bodyField().value)} 个想法`;
    $('[data-action="idea"]').setAttribute(
      "aria-pressed",
      String(ideaContext().ideaStart >= 0),
    );
    $("#j-paste-hint").textContent = /[\uE000-\uF8FF]/.test(bodyField().value)
      ? window.journalNative
        ? "图片随日志保存到本机"
        : "图片暂存于当前预览"
      : "Ctrl + V 粘贴文字或图片";
    const p = ideaAtCaret(),
      hint = $("#j-project-link-hint");
    $("#j-idea-settings").hidden = !p;
    $("#j-idea-settings span").textContent = p?.important || p?.dueDate ? `${p.important ? "★ " : ""}${p.dueDate || "重要"}` : "待办、重要与截止日期";
    $("#j-idea-menu-toggle").hidden = !p;
    $('[data-action="bind-active-idea"]').textContent = "项目 · " + (p?.projectIds.map(id => projectById(id)?.name).filter(Boolean).join("、") || "未绑定");
    hint.hidden = true;
    if (!p) closeIdeaMenu();
  }
  function editBody(
    start,
    end,
    replacement,
    selectionStart,
    selectionEnd = selectionStart,
    insertedFormats,
  ) {
    const t = bodyField(),
      before = bodySnapshot();
    t.value = t.value.slice(0, start) + replacement + t.value.slice(end);
    const caret = selectionStart ?? start + replacement.length;
    t.focus({ preventScroll: true });
    t.setSelectionRange(caret, selectionEnd ?? caret);
    rememberBody(before, "structure");
    beforeEdit = null;
    const edit = { start, end, newEnd: start + replacement.length };
    changeRecord({ body: t.value, formats: textFormats.replace(
      before.formats, before.body, t.value, edit, typingFormat, insertedFormats,
    ) }, edit);
  }
  function undoBody(redo = false) {
    resetTypingFormat();
    const h = historyFor(),
      from = redo ? h.redo : h.undo,
      to = redo ? h.undo : h.redo;
    if (!from.length) return;
    to.push(bodySnapshot());
    const target = from.pop(),
      t = bodyField();
    t.value = target.body;
    t.focus({ preventScroll: true });
    t.setSelectionRange(target.start, target.end);
    h.lastType = "";
    h.after = bodySnapshot();
    beforeEdit = null;
    changeRecord({ body: t.value, ideas: copyIdeas(target.ideas), formats: target.formats || [] });
  }
  function toggleIdea() {
    if (composing) return;
    const t = bodyField(),
      a = t.selectionStart,
      b = t.selectionEnd,
      c = ideaContext();
    if (a !== b && t.value.slice(a, b).includes("\n")) {
      const end =
        b > 0 && t.value[b - 1] === "\n"
          ? b - 1
          : t.value.indexOf("\n", b) < 0
            ? t.value.length
            : t.value.indexOf("\n", b);
      const lines = t.value.slice(c.start, end).split("\n"),
        filled = lines.filter((x) => x.trim()),
        remove = filled.length > 0 && filled.every((x) => /^•(?: |$)/.test(x));
      const next = lines
        .map((line) =>
          !line.trim()
            ? line
            : remove
              ? line.replace(/^• ?/, "")
              : /^•(?: |$)/.test(line)
                ? line
                : "• " + line,
        )
        .join("\n");
      editBody(c.start, end, next, c.start, c.start + next.length);
      return;
    }
    if (c.ideaStart >= 0) {
      const n = t.value[c.ideaStart + 1] === " " ? 2 : 1;
      editBody(
        c.ideaStart,
        c.ideaStart + n,
        "",
        Math.max(c.ideaStart, a - n),
        Math.max(c.ideaStart, b - n),
      );
    } else editBody(c.start, c.start, "• ", a + 2, b + 2);
  }
  let pendingUndo = null;
  function notify(message) {
    pendingUndo = null;
    clearTimeout(toastTimer);
    $("#j-toast").textContent = message;
    $("#j-toast").hidden = false;
    toastTimer = setTimeout(() => ($("#j-toast").hidden = true), 3000);
  }
  function closeIdeaMenu() {
    $("#j-idea-menu").hidden = true;
    $("#j-idea-menu-toggle").setAttribute("aria-expanded", "false");
  }
  function offerUndo(message, action) {
    notify(message);
    pendingUndo = action;
    const button = document.createElement("button");
    button.type = "button"; button.dataset.action = "undo-action"; button.textContent = "撤销";
    $("#j-toast").append(button);
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { pendingUndo = null; $("#j-toast").hidden = true; }, 10000);
  }
  async function performUndo() {
    if (!pendingUndo || apiBusy || scheduleBusy || composing) return;
    const action = pendingUndo; pendingUndo = null;
    clearTimeout(toastTimer);
    try { await action(); notify("已撤销"); }
    catch (error) { notify(error.message); }
  }
  function offerIdeaUndo(date, id, before, after, message) {
    offerUndo(message, async () => {
      const r = records[date], idea = r?.ideas.find(p => p.id === id);
      if (!idea || Object.keys(after).some(k => JSON.stringify(idea[k]) !== JSON.stringify(after[k])))
        throw Error("这条想法已发生新修改，未覆盖当前内容。");
      const ideas = copyIdeas(r.ideas), target = ideas.find(p => p.id === id);
      for (const [k,v] of Object.entries(before)) {
        if (v === undefined) delete target[k]; else target[k] = structuredClone(v);
      }
      if (date === state.selected) changeRecord({ideas});
      else { r.ideas = ideas; state.edits[date] = r; }
      await persist(); renderCalendar(); updateIdeaUI();
    });
  }
  function deleteActiveIdea() {
    const p = ideaAtCaret(), date = state.selected;
    if (!p || composing) return;
    const r = current(), range = ideaRanges(r.body).find(x => x.offset === p.offset);
    const fields = r => ({body:r.body, ideas:copyIdeas(r.ideas), formats:r.formats || []});
    const before = fields(r);
    let end = range.end;
    if (r.body[end] === "\n") end++;
    editBody(range.offset, end, "", range.offset);
    const after = fields(current());
    closeIdeaMenu();
    offerUndo("已删除想法", async () => {
      const target = records[date];
      if (!target || JSON.stringify(fields(target)) !== JSON.stringify(after))
        throw Error("当天内容已有新修改，请使用编辑器撤销或历史备份，未覆盖新内容。");
      if (date === state.selected) {
        bodyField().value = before.body;
        changeRecord(before);
      } else { Object.assign(target, before); state.edits[date] = target; }
      bodyHistory.delete(date);
      await persist(); renderCalendar(); updateIdeaUI();
    });
  }
  let todoCompleted = false, todoCategory = "all";
  function renderTodoOverview() {
    const rows = window.ScheduleFeatures.todos(records, today, todoCompleted).filter(r => todoCategory === "all" || (todoCategory === "important" ? r.important : todoCategory === "scheduled" ? r.scheduled : !r.important && !r.scheduled));
    $(".j-ideas-pane").setAttribute("aria-label", "待办事项");
    $("#j-overview-eyebrow").textContent = "待办 · 全部日期";
    $("#j-overview-title").textContent = "待办";
    $("#j-overview-summary").textContent = `${rows.length} 项${todoCompleted ? "已完成" : "待办"} · 普通笔记不计入`;
    $("#j-overview-tools").innerHTML = `<div class="j-task-filters"><div class="j-segment" aria-label="任务状态"><button type="button" data-todo-status="pending" aria-pressed="${!todoCompleted}">待办</button><button type="button" data-todo-status="done" aria-pressed="${todoCompleted}">已完成</button></div><select id="j-todo-category" aria-label="筛选待办类型">${[["all","全部"],["basic","普通"],["important","重要"],["scheduled","日程"]].map(([value,label])=>`<option value="${value}" ${todoCategory===value?"selected":""}>${label}</option>`).join("")}</select></div>`;
    $("#j-idea-pagination").hidden = true;
    const labels = ["已逾期", "今天", "之后", "无日期"];
    $("#j-overview-list").innerHTML = labels.map((label, group) => {
      const items = rows.filter(r => r.group === group);
      if (!items.length) return "";
      return `<section class="j-todo-group"><h3>${todoCompleted ? ["较早","今天","之后","无日期"][group] : label}<small>${items.length}</small></h3>${items.map(r => `<article class="j-todo-row ${r.important?"is-important":""}" data-todo-id="${esc(r.id)}"><button type="button" class="j-overview-check" ${r.kind === "event" ? `data-event-complete="${esc(r.id)}" data-event-date="${r.date}"` : `data-complete-id="${esc(r.id)}" data-idea-day="${r.date}"`} aria-label="${r.done?"回到待办":"标记完成"}" aria-pressed="${r.done}">${r.done?"✓":"☐"}</button><button type="button" class="j-todo-open" data-todo-date="${r.date}" ${r.kind === "idea" ? `data-todo-idea="${esc(r.id)}"` : ""}><span>${esc(r.text.replace(/[\uE000-\uF8FF]/g, "[图片]"))}</span><small>${esc([r.important?"★ 重要":"", r.scheduled?"日程":"", r.due || "无截止日期", r.time, r.kind === "event" ? "独立日程" : (r.projectIds.map(id => projectById(id)?.name).filter(Boolean).join(" · ") || "想法")].filter(Boolean).join(" · "))}</small></button></article>`).join("")}</section>`;
    }).join("") || `<div class="j-empty-ideas">${todoCompleted?"没有符合筛选的已完成事项。":"没有符合筛选的待办。可在想法操作菜单中设置，或添加日程。"}</div>`;
    icons();
  }
  root.addEventListener("change",e=>{if(e.target.id==="j-todo-category"){todoCategory=e.target.value;renderTodoOverview();}});
  root.addEventListener("click",e=>{const button=e.target.closest("[data-todo-status]");if(button){todoCompleted=button.dataset.todoStatus==="done";renderTodoOverview();}});
  function rememberView() {
    if (root.dataset.dayExpanded !== "true") {
      const pane = state.filter === "all" ? $(".j-calendar-pane") : $(".j-ideas-pane");
      state.navigation[state.filter] = { page: overviewPage, scroll: pane.scrollTop };
    }
    state.sidebarScroll = $(".j-sidebar").scrollTop;
  }
  function restoreViewPosition() {
    const filter = state.filter;
    requestAnimationFrame(() => {
      if (filter !== state.filter || root.dataset.dayExpanded === "true") return;
      const pane = filter === "all" ? $(".j-calendar-pane") : $(".j-ideas-pane");
      pane.scrollTop = state.navigation[filter]?.scroll || 0;
    });
  }
  function switchView(filter) {
    rememberView();
    root.dataset.dayExpanded = "false"; state.dayExpanded = false;
    state.filter = filter;
    overviewPage = state.navigation[filter]?.page || 0;
    root.dataset.mobileDetail = "false";
    renderCalendar(); restoreViewPosition();
    if (root.clientWidth < 881) root.dataset.sidebar = "closed";
    persist();
  }
  function projectIdeaRows(filter = state.filter) {
    const rows = [];
    for (const [date, r] of Object.entries(records)) {
      for (const p of visibleIdeas(r)) {
        if (
          filter === "unbound"
            ? p.projectIds.length === 0
            : p.projectIds.includes(filter)
        )
          rows.push({ date, idea: p });
      }
    }
    return rows.sort(
      (a, b) => b.date.localeCompare(a.date) || a.idea.offset - b.idea.offset,
    );
  }
  function renderSearchOverview() {
    const rows = window.ScheduleFeatures.search(records, projects, state.query);
    const pages = Math.max(1, Math.ceil(rows.length / 10));
    overviewPage = Math.min(overviewPage, pages - 1);
    $(".j-ideas-pane").setAttribute("aria-label", "全局搜索结果");
    $("#j-overview-eyebrow").textContent = "搜索 · 全部日期与项目";
    $("#j-overview-title").textContent = "搜索结果";
    $("#j-overview-tools").innerHTML = "";
    $("#j-overview-summary").textContent = state.query.trim() ? `${rows.length} 条结果` : "搜索正文、日程、资料、项目或截止日期";
    $("#j-overview-list").innerHTML = rows.slice(overviewPage*10,overviewPage*10+10).map(r => `<button type="button" class="j-important-row" data-search-date="${r.date}" ${r.id?`data-search-idea="${esc(r.id)}"`:""}><span class="j-important-date">${r.date}</span><span class="j-important-content"><strong>${esc(r.title)} · ${r.type}</strong><span>${esc(r.text.replace(/[\uE000-\uF8FF]/g,"[图片]").slice(0,240))}</span></span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`).join("") || `<div class="j-empty-ideas">${state.query.trim()?"没有找到匹配内容":"输入关键词开始查找"}</div>`;
    $("#j-idea-pagination").hidden=pages<=1;
    $("#j-idea-pagination").innerHTML=`<button type="button" class="j-text-button" data-action="idea-page-prev" ${overviewPage===0?"disabled":""}>上一页</button><span>${overviewPage+1} / ${pages}</span><button type="button" class="j-text-button" data-action="idea-page-next" ${overviewPage===pages-1?"disabled":""}>下一页</button>`;
    icons();
  }
  let ideaSettingsTarget = null;
  function openIdeaSettings(date, id) {
    const r=records[date], idea=r?.ideas.find(p=>p.id===id);
    if(!idea)return;
    ideaSettingsTarget={date,id};
    closeIdeaMenu();
    $("#j-idea-state").value=window.ScheduleState.taskState(idea);
    $("#j-idea-important").checked=!!idea.important;
    $("#j-idea-due").value=idea.dueDate || "";
    $("#j-idea-dialog-preview").textContent=visibleIdeas(r).find(p=>p.id===id)?.text.slice(0,180) || "当前想法";
    $("#j-idea-dialog").showModal();
  }
  async function saveIdeaSettings() {
    const {date,id}=ideaSettingsTarget, r=records[date];
    const ideas=copyIdeas(r.ideas), idea=ideas.find(p=>p.id===id);
    if(!idea)throw Error("想法已不存在，请重新选择。");
    const nextState=$("#j-idea-state").value;
    idea.important=$("#j-idea-important").checked;
    idea.dueDate=$("#j-idea-due").value;
    window.ScheduleState.setTaskState(idea,nextState);
    if(date===state.selected)changeRecord({ideas});
    else {r.ideas=ideas;state.edits[date]=r;}
    await persist();renderCalendar();updateIdeaUI();
    $("#j-idea-dialog").close();
  }
  $("#j-idea-due").addEventListener("change",()=>{if($("#j-idea-due").value && $("#j-idea-state").value==="note")$("#j-idea-state").value="todo";});
  const ideaBadge = p => [p.important?"★ 重要":"", p.dueDate?`${!p.done&&p.dueDate<today?"逾期":"截止"} ${p.dueDate}`:""].filter(Boolean).join(" · ");
  let restoreToken=null, dataBusy=false;
  async function refreshHistory() {
    const history=await window.journalNative.call("listHistory");
    $("#j-history-list").innerHTML=history.map(h=>`<button type="button" class="j-history-row" data-history="${esc(h.id)}"><span>${esc(h.at)}</span><span>${h.id.startsWith("daily-")?"每日快照":h.id.startsWith("before-restore-")?"恢复前备份":"手动备份"} · ${Math.ceil(h.bytes/1024)} KB</span><span>预览</span></button>`).join("") || '<p>暂无历史版本。可以点击“立即备份”。</p>';
  }
  function showHistoryPreview(preview) {
    if(preview.cancelled)return;
    restoreToken=preview.token;
    const host=$("#j-history-preview");host.hidden=false;
    const description=r=>r?`${r.title || "无标题"}\n${r.body || ""}`:"（无记录）";
    host.innerHTML=`<h3>恢复预览</h3><p>日期记录 ${preview.recordsBefore} → ${preview.recordsAfter} · 日程 ${preview.schedulesBefore} → ${preview.schedulesAfter}</p>`+
      `<details><summary>项目与日程对比</summary><div class="j-history-diff"><pre>当前项目：${esc((preview.projectsBefore||[]).join("、"))}\n${esc((preview.eventsBefore||[]).join("\n"))}</pre><pre>备份项目：${esc((preview.projectsAfter||[]).join("、"))}\n${esc((preview.eventsAfter||[]).join("\n"))}</pre></div></details>`+
      preview.dates.map(d=>`<details><summary>${d.date} · ${d.status}</summary><div class="j-history-diff"><div><strong>当前</strong><pre>${esc(description(d.before))}</pre></div><div><strong>备份</strong><pre>${esc(description(d.after))}</pre></div></div></details>`).join("");
    $("#j-restore-history").hidden=false;
    $("#j-data-status").textContent="恢复会替换全部数据，并先备份当前版本。项目、图片和格式也随备份恢复。";
  }
  root.addEventListener("click", async e=>{
    const button=e.target.closest("button");if(!button)return;
    const action=button.dataset.action;
    if(action==="idea-settings") {const p=ideaAtCaret();if(p)openIdeaSettings(state.selected,p.id);return;}
    if(button.dataset.ideaSettings) {openIdeaSettings(button.dataset.ideaDay,button.dataset.ideaSettings);return;}
    if(action==="cancel-idea-settings") {$("#j-idea-dialog").close();return;}
    if(action==="save-idea-settings") {try {await saveIdeaSettings();}catch(error){notify(error.message);}return;}
    if(action==="close-data") {if(!dataBusy)$("#j-data-dialog").close();return;}
    if(!["data","snapshot","export-backup","export-markdown","import-backup","import-markdown","restore-history"].includes(action)&&!button.dataset.history)return;
    if(!window.journalNative){notify("请在桌面版管理本地数据。");return;}
    if(dataBusy)return;
    dataBusy=true;button.disabled=true;
    try {
      await window.journalFlush();
      if(action==="data") {
        restoreToken=null;$("#j-history-preview").hidden=true;$("#j-restore-history").hidden=true;$("#j-data-status").textContent="";
        $("#j-data-dialog").showModal();await refreshHistory();
      } else if(action==="snapshot") {await window.journalNative.call("snapshot");await refreshHistory();$("#j-data-status").textContent="备份已保存。";}
      else if(button.dataset.history)showHistoryPreview(await window.journalNative.call("previewHistory",{id:button.dataset.history}));
      else if(action==="import-backup")showHistoryPreview(await window.journalNative.call("importBackup"));
      else if(action==="restore-history") {const result=await window.journalNative.call("restoreHistory",{token:restoreToken});if(result.warning)sessionStorage.setItem("restoreWarning",result.warning);location.reload();}
      else if(action==="export-backup"||action==="export-markdown") {
        const result=await window.journalNative.call("exportData",{format:action==="export-backup"?"backup":"markdown",...(action==="export-markdown"?window.ScheduleFeatures.markdown(records,projects,imageAssets):{})});
        if(!result.cancelled)$("#j-data-status").textContent="已导出："+result.path;
      } else if(action==="import-markdown") {
        const result=await window.journalNative.call("importMarkdown");if(result.cancelled)return;
        let text=result.text;
        for(const image of result.images || []) {
          const token=allocateImage(image.name);imageAssets.set(token,{name:image.name,src:image.src,status:"ready"});
          text=text.split(image.markdown).join(token);
        }
        const imported=window.ScheduleFeatures.importMarkdown(text), old=current().body;
        editBody(old.length,old.length,(old&&!old.endsWith("\n")?"\n":"")+imported.body);
        const added=current().ideas.filter(p=>p.offset>=old.length);
        added.forEach((p,i)=>window.ScheduleState.setTaskState(p,imported.flags[i]?"done":imported.tasks[i]?"todo":"note"));
        await persist();renderEditor();renderCalendar();$("#j-data-status").textContent=`已追加到 ${state.selected}。`;
      }
    } catch(error) {$("#j-data-status").textContent=error.message;notify(error.message);}
    finally {dataBusy=false;button.disabled=false;}
  });
  $("#j-data-dialog").addEventListener("cancel",e=>{if(dataBusy)e.preventDefault();});
  function renderIdeaOverview() {
    const important = state.filter === "important";
    const searching = state.filter === "search";
    const active = state.filter === "todo" || searching || important || state.filter === "unbound" || !!projectById(state.filter);
    root.dataset.screen = active ? "ideas" : "calendar";
    const searchRow = $(".j-search-row"), searchHost = searching ? $(".j-ideas-pane") : $(".j-calendar-pane");
    if (searchRow.parentElement !== searchHost) searchHost.prepend(searchRow);
    searchRow.hidden = !searching;
    if (!active) return;
    if (state.filter === "todo") { renderTodoOverview(); return; }
    if (searching) { renderSearchOverview(); return; }
    $(".j-ideas-pane").setAttribute("aria-label", important ? "重要事项总览" : "项目想法总览");
    $("#j-overview-eyebrow").textContent = important ? "重要事项 · 全部日期" : "想法总览 · 全部日期";
    if (important) {
      renderImportantOverview();
      return;
    }
    const project = projectById(state.filter),
      rows = projectIdeaRows(),
      pages = Math.max(1, Math.ceil(rows.length / 10));
    overviewPage = Math.min(overviewPage, pages - 1);
    const shown = rows.slice(overviewPage * 10, overviewPage * 10 + 10);
    const pagination = $("#j-idea-pagination");
    pagination.hidden = pages <= 1;
    pagination.innerHTML = `<button type="button" class="j-text-button" data-action="idea-page-prev" ${overviewPage === 0 ? "disabled" : ""}>较新</button><span>${overviewPage + 1} / ${pages}</span><button type="button" class="j-text-button" data-action="idea-page-next" ${overviewPage === pages - 1 ? "disabled" : ""}>更早</button>`;
    $("#j-overview-title").textContent = project?.name || "未绑定";
    $("#j-overview-summary").textContent =
      `${rows.length} 个想法 · ${new Set(rows.map((r) => r.date)).size} 天${project?.root ? " · " + project.root : ""}`;
    $("#j-overview-tools").innerHTML = project
      ? `<button type="button" class="j-icon" data-project-open="${esc(project.id)}" aria-label="打开项目文件夹" ${project.root ? "" : "disabled"}><i data-lucide="folder-open" aria-hidden="true"></i></button><button type="button" class="j-icon" data-project-edit="${esc(project.id)}" aria-label="编辑项目"><i data-lucide="settings-2" aria-hidden="true"></i></button>`
      : "";
    let html = "",
      lastDate = "";
    for (const { date, idea: p } of shown) {
      if (date !== lastDate) {
        if (lastDate) html += overviewResources(lastDate) + "</section>";
        html += `<section class="j-idea-day"><div class="j-idea-day-heading">${esc(date.replace(/-/g, " / "))}</div>`;
        lastDate = date;
      }
      const names = p.projectIds
        .map((id) => projectById(id)?.name)
        .filter(Boolean);
      if (ideaBadge(p)) html += `<button type="button" class="j-idea-badge" data-idea-settings="${esc(p.id)}" data-idea-day="${date}">${esc(ideaBadge(p))}</button>`;
      html += `<article class="j-overview-idea ${p.done ? "is-done" : ""}" data-idea-id="${esc(p.id)}" data-idea-date="${date}"><button type="button" class="j-overview-check" data-complete-id="${esc(p.id)}" data-idea-day="${date}" aria-label="${p.done ? "取消完成" : "标记完成"}" aria-pressed="${!!p.done}">${p.done ? "✓" : window.ScheduleState.taskState(p) === "todo" ? "☐" : "•"}</button><div class="j-idea-content"><div class="j-idea-text">${overviewContent(p, date)}</div><div class="j-idea-bindings">${esc(names.join(" · ") || "未绑定项目")}</div></div><button type="button" class="j-binding-button" data-bind-idea="${esc(p.id)}" data-idea-day="${date}" aria-label="修改此想法的项目">${names.length ? "项目" : "绑定"}</button></article>`;
    }
    if (lastDate) html += overviewResources(lastDate) + "</section>";
    $("#j-overview-list").innerHTML =
      html ||
      `<div class="j-empty-ideas">${project ? "这个项目还没有想法" : "所有想法都已整理好"}<br>${project ? "先在右侧选择新想法的项目，再开始记录。" : "新建未绑定的想法会出现在这里。"}</div>`;
    icons();
  }
  function overviewContent(idea, date) {
    const open = `data-open-idea="${esc(idea.id)}" data-idea-day="${date}"`;
    const record = records[date],
      display = textFormats.forIdea(record.body, idea, record.formats);
    return window.ScheduleContent.parts(display.text, true)
      .map((part) => {
        if (part.kind === "math")
          return `<button type="button" class="j-idea-open j-math${part.display ? " is-display" : ""}" ${open} title="编辑公式" style="${textFormats.css(textFormats.at(display.formats, part.start))}">${mathMarkup(part)}</button>`;
        if (part.kind === "image") {
          const asset = imageAssets.get(part.token);
          if (
            asset?.src &&
            /^data:image\/(png|jpeg|gif|webp|bmp|avif);base64,/i.test(asset.src)
          )
            return `<button type="button" class="j-idea-image" ${open} aria-label="查看图片所在想法"><img src="${esc(asset.src)}" alt="${esc(asset.name || "粘贴的图片")}" loading="lazy"></button>`;
          const status =
            asset?.status === "loading"
              ? "正在插入图片…"
              : asset?.status === "failed"
                ? "图片读取失败，请重新粘贴"
                : "图片数据不可用，请重新粘贴";
          return `<button type="button" class="j-image-placeholder" ${open}>${status}</button>`;
        }
        if (part.kind === "url")
          return `<a class="j-idea-link" href="${esc(part.url)}" data-external-url="${esc(part.url)}" target="_blank" rel="noopener noreferrer">${formattedText(part.text, display.formats, part.textStart)}</a>`;
        if (part.kind === "path")
          return `<button type="button" class="j-idea-link" data-inline-path="${esc(part.text)}" title="打开本地路径">${formattedText(part.text, display.formats, part.textStart)}</button>`;
        let offset = part.textStart;
        return part.text
          .split("\n")
          .map((line) => {
            const result = line ? `<button type="button" class="j-idea-open" ${open}>${formattedText(line, display.formats, offset)}</button>` : "";
            offset += line.length + 1;
            return result;
          })
          .join("<br>");
      })
      .join("");
  }
  function renderImportantOverview() {
    const days = Object.entries(records)
      .filter(([, record]) => isImportant(record))
      .sort(([a], [b]) => b.localeCompare(a));
    const pages = Math.max(1, Math.ceil(days.length / 10));
    overviewPage = Math.min(overviewPage, pages - 1);
    $("#j-overview-title").textContent = "重要事项";
    $("#j-overview-summary").textContent = `${days.length} 个重要日期 · 点击查看当天安排`;
    $("#j-overview-tools").innerHTML = "";
    const pagination = $("#j-idea-pagination");
    pagination.hidden = pages <= 1;
    pagination.innerHTML = `<button type="button" class="j-text-button" data-action="idea-page-prev" ${overviewPage === 0 ? "disabled" : ""}>较新</button><span>${overviewPage + 1} / ${pages}</span><button type="button" class="j-text-button" data-action="idea-page-next" ${overviewPage === pages - 1 ? "disabled" : ""}>更早</button>`;
    $("#j-overview-list").innerHTML = days.slice(overviewPage * 10, overviewPage * 10 + 10)
      .map(([date, record]) => {
        const schedule = scheduleData(record);
        const title = record.title || schedule?.title || "重要记录";
        const details = [schedule ? `${schedule.time} · ${schedule.title}` : "", `${score(record)} 个想法`].filter(Boolean).join(" · ");
        return `<button type="button" class="j-important-row" data-important-date="${date}" aria-label="查看 ${date} ${esc(title)}"><span class="j-important-date">${esc(date.replace(/-/g, " / "))}</span><span class="j-important-content"><strong>${esc(title)}</strong><span>${esc(details)}</span></span><i data-lucide="chevron-right" aria-hidden="true"></i></button>`;
      }).join("") || '<div class="j-empty-ideas">暂无重要事项<br>点击当天日期旁的星标，或在日程中勾选“标为重要”。</div>';
    icons();
  }
  function resourceMarkup(file, index, date) {
    return `<button type="button" class="j-resource" data-resource="${index}" data-resource-date="${date}" aria-label="打开${esc(file.name)}"><span class="j-resource-icon"><i data-lucide="${file.kind === "folder" ? "folder" : "file-text"}" aria-hidden="true"></i></span><span class="j-resource-info"><span class="j-resource-name">${esc(file.name)}</span><span class="j-resource-path">${esc(resourcePath(file) || "未关联有效路径")}</span></span><i data-lucide="arrow-up-right" aria-hidden="true"></i></button>`;
  }
  function overviewResources(date) {
    const files = records[date].files;
    return files.length
      ? `<div class="j-overview-resources"><div class="j-idea-bindings" title="这一天记录的关联资料">当天资料</div>${files.map((f, i) => resourceMarkup(f, i, date)).join("")}</div>`
      : "";
  }
  function selectedBindingIds() {
    if (!pickerTarget) return newIdeaProjects;
    return (
      records[pickerTarget.date]?.ideas?.find((p) => p.id === pickerTarget.id)
        ?.projectIds || []
    );
  }
  function renderProjects() {
    $("#j-project-nav").innerHTML = projects
      .map(
        (p) =>
          `<button type="button" class="j-nav j-project ${state.filter === p.id ? "is-active" : ""}" data-filter="${esc(p.id)}"><span class="j-project-dot"></span><span>${esc(p.name)}</span></button>`,
      )
      .join("");
    $(".j-unbound-count").textContent = projectIdeaRows("unbound").length;
    const ids = selectedBindingIds();
    $("#j-entry-project").textContent =
      "新想法：" +
      (newIdeaProjects
        .map((id) => projectById(id)?.name)
        .filter(Boolean)
        .join("、") || "未绑定") +
      " ▾";
    $("#j-picker-title").textContent = pickerTarget
      ? "这个想法的项目"
      : "新想法的项目";
    $("#j-project-options").innerHTML = projects
      .map(
        (p) =>
          `<label class="j-project-choice"><input type="checkbox" data-link-project="${esc(p.id)}" ${ids.includes(p.id) ? "checked" : ""}><span>${esc(p.name)}<small>${esc(p.root || "暂未关联文件夹")}</small></span></label>`,
      )
      .join("");
    $("#j-project-context").hidden = true;
    renderIdeaOverview();
    icons();
  }
  function setBindingIds(ids) {
    ids = [...new Set(ids)].filter((id) => projectById(id));
    if (pickerTarget) {
      const target = records[pickerTarget.date],
        p = target?.ideas?.find((p) => p.id === pickerTarget.id);
      if (!p) {
        $("#j-project-picker").hidden = true;
        pickerTarget = null;
        return;
      }
      const undoDate = pickerTarget.date, undoId = p.id, previousIds = [...p.projectIds];
      const ideas = copyIdeas(target.ideas);
      ideas.find((x) => x.id === p.id).projectIds = ids;
      if (pickerTarget.date === state.selected) changeRecord({ ideas });
      else {
        target.ideas = ideas;
        state.edits[pickerTarget.date] = target;
        persist();
      }
      offerIdeaUndo(undoDate, undoId, {projectIds: previousIds}, {projectIds: ids}, "已更新项目关联");
    } else {
      newIdeaProjects = ids;
      persist();
    }
    renderProjects();
    updateIdeaUI();
    renderResources();
  }
  function linkProject(id, checked) {
    const ids = selectedBindingIds();
    setBindingIds(checked ? [...ids, id] : ids.filter((x) => x !== id));
  }
  function openBindingPicker(target = null) {
    pickerTarget = target;
    $("#j-project-picker").hidden = false;
    $("#j-entry-project").setAttribute("aria-expanded", "true");
    renderProjects();
  }
  function openIdea(date, id, bind = false) {
    select(date);
    const p = current().ideas?.find((p) => p.id === id),
      range =
        p && ideaRanges(current().body).find((x) => x.offset === p.offset);
    if (!p || !range) return;
    bodyField().focus({ preventScroll: true });
    bodyField().setSelectionRange(range.offset + 2, range.end);
    updateIdeaUI();
    if (bind) openBindingPicker({ date, id });
  }

  function openProjectDialog(id = null, link = false) {
    const p = projectById(id);
    projectDialog = { id: p?.id || null, link };
    $("#j-project-dialog-title").textContent = p ? "编辑项目" : "新建项目";
    $("#j-project-name").value = p?.name || "";
    $("#j-project-root").value = p?.root || "";
    $("#j-project-submit").textContent = p
      ? "保存修改"
      : link
        ? "创建并关联"
        : "创建项目";
    $("#j-project-error").textContent = "";
    $("#j-project-dialog").showModal();
    $("#j-project-name").focus();
  }
  function pathSuggestion() {
    const p = projectForPath($("#j-path-input").value),
      label = $("#j-path-project");
    label.hidden = !p;
    label.textContent = p ? `资料位于「${p.name}」，不改变想法绑定` : "";
    $('[data-action="confirm-attach"]').textContent = "关联资料";
  }
  $("#j-path-input").addEventListener("input", pathSuggestion);
  $("#j-project-options").addEventListener("change", (e) => {
    const id = e.target.dataset.linkProject;
    if (id) linkProject(id, e.target.checked);
  });
  function saveProject() {
    const name = $("#j-project-name").value.trim(),
      rootPath = cleanPath($("#j-project-root").value),
      error = $("#j-project-error");
    if (!name) {
      error.textContent = "请输入项目名称。";
      return;
    }
    if (
      projects.some(
        (p) =>
          p.id !== projectDialog.id &&
          p.name.toLowerCase() === name.toLowerCase(),
      )
    ) {
      error.textContent = "已有同名项目，请选择其他名称。";
      return;
    }
    if (
      rootPath &&
      !(
        /^[a-z]:[\\/]/i.test(rootPath) ||
        /^\\\\[^\\]+\\[^\\]+/.test(rootPath) ||
        rootPath.startsWith("/")
      )
    ) {
      error.textContent = "请输入完整的本地文件夹路径。";
      return;
    }
    if (rootPath && /(?:^|[\\/])\.\.(?:[\\/]|$)/.test(rootPath)) {
      error.textContent = "请填写不含上级目录跳转的完整路径。";
      return;
    }
    if (
      rootPath &&
      projects.some(
        (p) =>
          p.id !== projectDialog.id &&
          p.root &&
          pathKey(p.root) === pathKey(rootPath),
      )
    ) {
      error.textContent = "此文件夹已经关联到其他项目。";
      return;
    }
    const existing = projectById(projectDialog.id),
      project = existing || {
        id:
          "project-" +
          Array.from(crypto.getRandomValues(new Uint32Array(4)), (n) =>
            n.toString(16),
          ).join("-"),
      };
    Object.assign(project, { name, root: rootPath });
    if (!existing) projects.push(project);
    if (projectDialog.link) linkProject(project.id, true);
    $("#j-project-dialog").close();
    renderProjects();
    renderCalendar();
    renderResources();
    persist();
  }
  $("#j-project-form").addEventListener("submit", (e) => {
    e.preventDefault();
    saveProject();
  });
  $("#j-project-form").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.target.tagName === "INPUT") {
      e.preventDefault();
      saveProject();
    }
  });
  function persist() {
    const privateContent = {
      schemaVersion: 2,
      year: state.year,
      month: state.month,
      selected: state.selected,
      view: state.view,
      filter: state.filter,
      query: state.query,
      sidebar: state.sidebar,
      sidebarWidth: state.sidebarWidth,
      navigation: state.navigation,
      dayExpanded: state.dayExpanded,
      sidebarScroll: state.sidebarScroll,
      projects,
      newIdeaProjects,
      edits: state.edits,
    };
    if (window.journalNative) {
      return window.journalNative
        .call("saveState", { privateContent, nativeImages: [...imageAssets] })
        .then((result) => {
          $("#j-save-status").textContent = "已保存到本机";
          if (result?.schedules && applyScheduleProjection(result.schedules)) {
            window.journalNative.schedules=result.schedules;
            renderCalendar();renderSchedule();
            const failed=Object.values(result.schedules).find(s=>s.Status==="error");
            if(failed)notify("记录已保存，但关联日程提醒未同步："+failed.Error);
          }
        })
        .catch((e) => {
          $("#j-save-status").textContent = "保存失败";
          notify(e.message);
          throw e;
        });
    }
    if (new TextEncoder().encode(JSON.stringify(privateContent)).length > 14500)
      privateContent.edits = {};
    if (
      new TextEncoder().encode(JSON.stringify(privateContent)).length > 14500
    ) {
      notify("预览状态较大，项目仅保留在本次预览中。");
      return;
    }
    if (window.openai?.setWidgetState)
      window.openai
        .setWidgetState({
          modelContent: {
            selectedDate: state.selected,
            calendarView: state.view,
            filter: state.filter,
          },
          privateContent,
        })
        .catch(() => {});
  }
  function restore(saved) {
    saved = window.ScheduleState.upgrade(saved);
    if (!saved || typeof saved !== "object") return;
    if (window.journalNative && Array.isArray(saved.nativeImages)) {
      for (const [token, asset] of saved.nativeImages)
        imageAssets.set(token, asset);
    }
    const p = saved.privateContent;
    if (!p || typeof p !== "object") return;
    if (Array.isArray(p.projects)) {
      const ids = new Set(),
        valid = p.projects.every(
          (x) =>
            x &&
            typeof x.id === "string" &&
            typeof x.name === "string" &&
            typeof x.root === "string" &&
            !ids.has(x.id) &&
            ids.add(x.id),
        );
      if (valid)
        projects = p.projects.map((x) => ({
          id: x.id,
          name: x.name,
          root: x.root,
        }));
    }
    if (Number.isInteger(p.year) && p.year > 1900 && p.year < 2200)
      state.year = p.year;
    if (Number.isInteger(p.month) && p.month >= 0 && p.month < 12)
      state.month = p.month;
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.selected || ""))
      state.selected = p.selected;
    if (["month", "year"].includes(p.view)) state.view = p.view;
    const filter =
      projects.find((x) => x.id === p.filter || x.name === p.filter)?.id ||
      p.filter;
    if (["all", "important", "unbound", "search", "todo"].includes(filter) || projectById(filter))
      state.filter = filter;
    newIdeaProjects = Array.isArray(p.newIdeaProjects)
      ? p.newIdeaProjects.filter((id) => projectById(id))
      : [];
    state.query = String(p.query || "");
    state.sidebar = p.sidebar;
    state.dayExpanded = p.dayExpanded === true;
    state.sidebarScroll = Math.max(0, Number(p.sidebarScroll) || 0);
    for (const [filter, value] of Object.entries(p.navigation || {})) {
      if (!["all","important","unbound","search","todo"].includes(filter) && !projectById(filter)) continue;
      state.navigation[filter] = {page: Math.max(0, Math.floor(Number(value?.page) || 0)), scroll: Math.max(0, Number(value?.scroll) || 0)};
    }
    overviewPage = state.navigation[state.filter]?.page || 0;
    if (Number.isFinite(p.sidebarWidth))
      state.sidebarWidth = Math.max(160, Math.min(420, p.sidebarWidth));
    if (p.edits && typeof p.edits === "object") {
      for (const [k, r] of Object.entries(p.edits)) {
        if (
          /^\d{4}-\d{2}-\d{2}$/.test(k) &&
          r &&
          typeof r.body === "string" &&
          Array.isArray(r.files)
        ) {
          records[k] = { ...empty(), ...r };
          migrateIdeas(records[k], k);
          state.edits[k] = records[k];
        }
      }
    }
  }
  function renderCalendar() {
    renderProjects();
    $("#j-todo-count").textContent = window.ScheduleFeatures.todos(records, today).length || "";
    queueMicrotask(() =>
      $$("button").forEach((b) => b.classList.add("cursor-interaction")),
    );
    $(".j-nav-count").textContent = Object.values(records).filter(
      (r) => isImportant(r),
    ).length;
    $("#j-write-label").textContent = hasContent(current())
      ? "继续记录"
      : "写一条记录";
    const max = maximum(),
      start = (new Date(state.year, state.month, 1).getDay() + 6) % 7,
      total = new Date(state.year, state.month + 1, 0).getDate();
    $("#j-year-label").textContent =
      state.view === "year" ? "年度概览" : String(state.year);
    $("#j-month-label").textContent =
      state.view === "year" ? String(state.year) : names[state.month];
    $("#j-month-note").textContent = state.filter === "search" && state.query
      ? `搜索：${state.query}`
      : state.filter === "all"
        ? "日常记录，慢慢累积"
        : state.filter === "important"
          ? "重要事项与日程"
          : projectById(state.filter)?.name || "日常记录";
    $("#j-month-calendar").hidden = state.view !== "month";
    $("#j-year-grid").hidden = state.view !== "year";
    root.dataset.view = state.view;
    $$(".j-segment button[data-view]").forEach((b) =>
      b.setAttribute("aria-pressed", String(b.dataset.view === state.view)),
    );
    $$(".j-nav[data-filter]").forEach((b) =>
      b.classList.toggle("is-active", b.dataset.filter === state.filter),
    );
    $('[data-action="previous"]').setAttribute(
      "aria-label",
      state.view === "year" ? "上一年" : "上一个月",
    );
    $('[data-action="next"]').setAttribute(
      "aria-label",
      state.view === "year" ? "下一年" : "下一个月",
    );
    let count = 0;
    for (const [k, r] of Object.entries(records)) {
      const [y, m] = parse(k);
      if (
        y === state.year &&
        (state.view === "year" || m === state.month + 1) &&
        matches(r) &&
        hasContent(r)
      )
        count++;
    }
    $("#j-bottom-count").textContent = count
      ? `${count} 天留下了记录`
      : "从一条记录开始";
    if (state.view === "month") {
      $("#j-year-grid").innerHTML = "";
      let html = "";
      const cells = Math.ceil((start + total) / 7) * 7;
      for (let i = 0; i < cells; i++) {
        const d = i - start + 1;
        if (d < 1 || d > total) {
          const out = new Date(state.year, state.month, d);
          const k = key(out.getFullYear(), out.getMonth(), out.getDate());
          html += `<button type="button" class="j-day j-outside" data-date="${k}" aria-label="${out.getFullYear()}年${out.getMonth() + 1}月${out.getDate()}日，切换到该月" aria-pressed="${state.selected === k}"><span class="j-day-number">${out.getDate()}</span></button>`;
          continue;
        }
        const k = key(state.year, state.month, d),
          r = records[k],
          l = level(r, max),
          show = matches(r),
          imp = show && (isImportant(r) || r.schedule),
          title = show ? r.title || scheduleData(r)?.title || "" : "",
          desc = `${state.year}年${state.month + 1}月${d}日${title ? "，" + title : ""}${show && isImportant(r) ? "，重要事项" : ""}${show && r.schedule ? "，有日程" : ""}，${show ? score(r) : 0} 个想法，深浅${l}级`;
        html += `<button type="button" class="j-day ${state.selected === k ? "is-selected " : ""}${k === today ? "is-today " : ""}${r && !show ? "no-match" : ""}" data-date="${k}" data-level="${l}" aria-label="${esc(desc)}" aria-pressed="${state.selected === k}"><span class="j-day-top"><span class="j-day-number">${d}</span>${imp ? `<span class="j-day-marker ${isImportant(r) ? "" : "is-normal"}" aria-hidden="true">${r.schedule ? "◷" : "•"}</span>` : ""}</span>${title ? `<span class="j-day-preview">${esc(title)}</span>` : ""}</button>`;
      }
      $("#j-days").innerHTML = html;
    } else {
      $("#j-days").innerHTML = "";
      let html = "";
      for (let m = 0; m < 12; m++) {
        html += `<section class="j-mini-month"><button type="button" data-month="${m}">${names[m]}</button><div class="j-mini-days">`;
        const offset = (new Date(state.year, m, 1).getDay() + 6) % 7;
        for (let i = 0; i < offset; i++)
          html += '<span class="j-mini-spacer"></span>';
        for (let d = 1; d <= new Date(state.year, m + 1, 0).getDate(); d++) {
          const k = key(state.year, m, d),
            r = records[k],
            l = level(r, max);
          html += `<button type="button" data-date="${k}" data-level="${l}" class="${state.selected === k ? "is-selected " : ""}${matches(r) && isImportant(r) ? "has-important " : ""}${matches(r) && r.schedule ? "has-schedule" : ""}" aria-label="${m + 1}月${d}日，${matches(r) ? score(r) : 0} 个想法，深浅${l}级" data-tooltip="${m + 1}月${d}日${r ? " · " + esc(r.title) : ""}"></button>`;
        }
        html += "</div></section>";
      }
      $("#j-year-grid").innerHTML = html;
    }
  }
  function scheduleData(r = current()) {
    if (r.appointment) return r.appointment;
    if (!r.schedule) return null;
    const [time, ...title] = r.schedule.split(" · ");
    return {
      title: title.join(" · ") || r.title,
      time: /^\d{2}:\d{2}$/.test(time) ? time : "09:00",
      remindMinutes: -1,
      status: "off",
    };
  }
  function reminderLabel(s) {
    if (s.remindMinutes < 0) return "不提醒";
    if (!window.journalNative) return "预览 · 未接入 Windows";
    if (s.status === "error") return "提醒未启用";
    if (
      s.status === "elapsed" ||
      (s.at && new Date(s.at).getTime() - s.remindMinutes * 60000 <= Date.now())
    )
      return "提醒时间已过";
    return s.status === "scheduled" ? "Windows 已排程" : "尚未确认排程";
  }
  function renderSchedule() {
    const events = eventsFor(current()).slice().sort((a,b) => a.time.localeCompare(b.time));
    const b = $("#j-schedule");
    b.classList.remove("is-important", "has-schedule");
    b.querySelector("span").textContent = "添加日程";
    $("#j-schedule-status").hidden = true;
    $("#j-schedule-list").innerHTML = events.map(s => `<div class="j-event-row ${s.done ? "is-done" : ""} ${s.important ? "is-important" : ""}"><button type="button" class="j-icon" data-event-complete="${esc(s.id)}" aria-label="${s.done ? "取消完成日程" : "完成日程"}" aria-pressed="${!!s.done}">${s.done ? "✓" : "○"}</button><button type="button" class="j-event-open" data-event-edit="${esc(s.id)}"><span>${esc(s.time)} · ${esc(s.title)}</span><small>${esc(s.done ? "已完成" : reminderLabel(s))}</small></button></div>`).join("");
  }
  function setDayEvents(date, events) {
    const r = records[date] || empty();
    r.appointments = events.slice().sort((a,b) => a.time.localeCompare(b.time));
    r.appointment = r.appointments[0] || null;
    r.schedule = r.appointments.map(s => `${s.time} · ${s.title}`).join("；");
    r.kind = "journal";
    records[date] = r; state.edits[date] = r;
  }
  function applyScheduleProjection(schedules) {
    const byDate = new Map();
    for (const [key, value] of Object.entries(schedules)) {
      const event = normalizeSchedule(value), date = event.date || key.split("/")[0];
      event.id ||= "legacy-" + date;
      if (!byDate.has(date)) byDate.set(date, []);
      byDate.get(date).push(event);
    }
    let changed = false;
    for (const date of new Set([...Object.keys(records), ...byDate.keys()])) {
      const events = (byDate.get(date) || []).sort((a,b) => a.time.localeCompare(b.time));
      if (JSON.stringify(eventsFor(records[date])) !== JSON.stringify(events)) {setDayEvents(date, events);changed = true;}
    }
    return changed;
  }
  function scheduleIdeaSelection() {
    const value = $("#j-schedule-idea").value;
    return value ? {date:value.slice(0,10),id:value.slice(11)} : null;
  }
  function updateScheduleLink() {
    const link = scheduleIdeaSelection(), idea = link && records[link.date]?.ideas.find(p=>p.id===link.id);
    $("#j-schedule-done").disabled = !!idea;
    if (idea) $("#j-schedule-done").checked = !!idea.done;
    $("#j-schedule-done-label").textContent = idea ? "完成状态跟随关联想法" : "已完成（取消提醒）";
  }
  $("#j-schedule-idea").addEventListener("change", updateScheduleLink);
  let scheduleDate = null, scheduleId = null,
    scheduleBusy = false;
  async function openSchedule(id = null, ideaLink = null) {
    scheduleDate = state.selected;
    scheduleId = id;
    const s = eventsFor(current()).find(s => s.id === id), r = current();
    $("#j-schedule-date").textContent = state.selected.replace(/-/g, " / ");
    $("#j-schedule-title").value = s?.title || "";
    $("#j-schedule-time").value = s?.time || "09:00";
    $("#j-remind").value = String(s?.remindMinutes ?? 15);
    $("#j-schedule-important").checked = !!s?.important;
    $("#j-schedule-done").checked = !!s?.done;
    const link = ideaLink || (s?.ideaId ? {date:s.ideaDate,id:s.ideaId} : null);
    $("#j-schedule-idea").innerHTML = '<option value="">独立日程</option>' + Object.entries(records).sort((a,b)=>b[0].localeCompare(a[0])).flatMap(([date, record]) => visibleIdeas(record).map(idea => `<option value="${esc(date + "/" + idea.id)}">${esc(date + " · " + idea.text.slice(0,80))}</option>`)).join("");
    $("#j-schedule-idea").value = link ? link.date + "/" + link.id : "";
    if (ideaLink) $("#j-schedule-title").value = visibleIdeas(records[ideaLink.date]).find(p=>p.id===ideaLink.id)?.text.slice(0,100) || "";
    updateScheduleLink();
    $("#j-schedule-delete").hidden = !s;
    $("#j-schedule-error").textContent = s?.error || "";
    $("#j-notification-status").textContent = window.journalNative
      ? "正在检查 Windows 通知…"
      : "当前为交互预览，系统提醒请在桌面版设置。";
    $("#j-notification-actions").hidden = !window.journalNative;
    $("#j-schedule-dialog").showModal();
    if (window.journalNative) {
      try {
        const result = await window.journalNative.call("notificationStatus");
        $("#j-notification-status").textContent =
          result.setting === "Enabled"
            ? "Windows 通知已允许"
            : "Windows 通知已关闭，请在系统设置中开启。";
      } catch (e) {
        $("#j-notification-status").textContent = e.message;
      }
    }
  }
  function normalizeSchedule(s) {
    const result = {};
    for (const [k, v] of Object.entries(s))
      result[k[0].toLowerCase() + k.slice(1)] = v;
    return result;
  }
  async function saveSchedule(remove = false) {
    if (scheduleBusy) return;
    const error = $("#j-schedule-error");
    error.textContent = "";
    let s = null;
    if (!remove) {
      const title = $("#j-schedule-title").value.trim(),
        time = $("#j-schedule-time").value,
        remindMinutes = Number($("#j-remind").value),
        date = new Date(`${scheduleDate}T${time}:00`);
      if (
        !title ||
        !/^\d{2}:\d{2}$/.test(time) ||
        !Number.isFinite(date.getTime())
      ) {
        error.textContent = "请输入日程名称和有效时间。";
        return;
      }
      if (
        !$("#j-schedule-done").checked && remindMinutes >= 0 &&
        date.getTime() - remindMinutes * 60000 <= Date.now()
      ) {
        error.textContent = "提醒时间已过，请改为未来时间，或选择“不提醒”。";
        return;
      }
      s = {
        title,
        time,
        at: date.toISOString(),
        remindMinutes,
        important: $("#j-schedule-important").checked,
        done: $("#j-schedule-done").checked,
        status: window.journalNative ? "pending" : "preview",
      };
      const link = scheduleIdeaSelection();
      if (link) {s.ideaDate=link.date;s.ideaId=link.id;}
    }
    scheduleBusy = true;
    $("#j-schedule-save").disabled = true;
    $("#j-schedule-delete").disabled = true;
    try {
      if (s?.ideaId) {
        const record=records[s.ideaDate], idea=record?.ideas.find(p=>p.id===s.ideaId);
        if(!idea)throw Error("关联想法已不存在。");
        idea.todo=true;state.edits[s.ideaDate]=record;s.done=!!idea.done;
      }
      await persist();
      if (window.journalNative) {
        const result = await window.journalNative.call("saveSchedule", {
          date: scheduleDate,
          id: scheduleId,
          schedule: s,
        });
        if (s) s = normalizeSchedule(result);
      }
      if (s && !s.id) s.id = scheduleId || crypto.randomUUID();
      const events = eventsFor(records[scheduleDate]).filter(x => x.id !== scheduleId);
      if (s) events.push(s);
      setDayEvents(scheduleDate, events);
      const r = records[scheduleDate];
      await persist();
      renderCalendar();
      if (state.selected === scheduleDate) {
        renderSchedule();
        $(".j-important").setAttribute("aria-pressed", String(r.important));
      }
      if (s?.status === "error") {
        error.textContent = "日程已保存，但提醒未启用：" + s.error;
        return;
      }
      $("#j-schedule-dialog").close();
      notify(
        remove
          ? "日程已移除，提醒已取消"
          : s.remindMinutes < 0
            ? "日程已保存"
            : window.journalNative
              ? "已加入 Windows 提醒队列"
              : "已保存到预览，系统提醒需使用桌面版",
      );
    } catch (e) {
      error.textContent = e.message;
    } finally {
      scheduleBusy = false;
      $("#j-schedule-save").disabled = false;
      $("#j-schedule-delete").disabled = false;
    }
  }
  root.addEventListener("click", async (e) => {
    const action = e.target.closest("button")?.dataset.action;
    const editId = e.target.closest("[data-event-edit]")?.dataset.eventEdit;
    const completeId = e.target.closest("[data-event-complete]")?.dataset.eventComplete;
    if (editId) openSchedule(editId);
    else if (completeId) {
      if (scheduleBusy || apiBusy) return;
      scheduleBusy = true;
      try {
        const date = e.target.closest("[data-event-date]")?.dataset.eventDate || state.selected, previous = eventsFor(records[date]).find(s => s.id === completeId);
        if (!previous) return;
        if (previous.ideaId) {toggleCompletion(previous.ideaDate, previous.ideaId);return;}
        const candidate = { ...previous, done: !previous.done };
        if (!candidate.done && new Date(candidate.at).getTime() - candidate.remindMinutes * 60000 <= Date.now()) candidate.remindMinutes = -1;
        const saved = window.journalNative ? normalizeSchedule(await window.journalNative.call("saveSchedule", {date, id: completeId, schedule:candidate})) : candidate;
        setDayEvents(date, eventsFor(records[date]).map(s => s.id === completeId ? saved : s));
        await persist(); renderCalendar(); renderSchedule();
        offerUndo(candidate.done ? "日程已完成" : "已取消完成", async () => {
          const currentEvent = eventsFor(records[date]).find(s => s.id === completeId);
          if (JSON.stringify(currentEvent) !== JSON.stringify(saved)) throw Error("日程已有新修改，未覆盖当前内容。");
          scheduleBusy = true;
          try {
            const restore = {...previous};
            if (!restore.done && new Date(restore.at).getTime() - restore.remindMinutes * 60000 <= Date.now()) restore.remindMinutes = -1;
            const restored = window.journalNative ? normalizeSchedule(await window.journalNative.call("saveSchedule", {date,id:completeId,schedule:restore})) : restore;
            setDayEvents(date, eventsFor(records[date]).map(s => s.id === completeId ? restored : s));
            await persist(); renderCalendar(); renderSchedule();
          } finally { scheduleBusy = false; }
        });
      } catch(error) { notify(error.message); }
      finally { scheduleBusy = false; }
    }
    else if (action === "schedule") openSchedule();
    else if (action === "idea-reminder") {
      const idea=ideaAtCaret();if(idea){closeIdeaMenu();openSchedule(null,{date:state.selected,id:idea.id});}
    }
    else if (action === "cancel-schedule" && !scheduleBusy)
      $("#j-schedule-dialog").close();
    else if (action === "save-schedule") saveSchedule();
    else if (action === "delete-schedule") saveSchedule(true);
    else if (action === "notification-settings") {
      try {
        await window.journalNative.call("notificationSettings");
      } catch (e) {
        $("#j-schedule-error").textContent = e.message;
      }
    } else if (action === "test-notification") {
      try {
        await window.journalNative.call("testNotification");
        $("#j-notification-status").textContent =
          "测试已交给 Windows。免打扰可能隐藏横幅，可查看通知中心。";
      } catch (e) {
        $("#j-notification-status").textContent = e.message;
      }
    }
  });
  $("#j-schedule-dialog").addEventListener("cancel", (e) => {
    if (scheduleBusy) e.preventDefault();
  });
  $("#j-schedule-dialog").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.isComposing && e.target.tagName === "INPUT") {
      e.preventDefault();
      saveSchedule();
    }
  });
  window.addEventListener("journal:open-date", (e) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(e.detail)) {
      refreshToday(false);
      select(e.detail);
    }
  });
  window.addEventListener("journal:resume", () => refreshToday());
  window.addEventListener("journal:toggle-idea", (e) => {
    const d = e.detail;
    if (d && typeof d.date === "string" && typeof d.id === "string")
      if(apiBusy)notify("正在同步，请稍后再修改。");else toggleCompletion(d.date, d.id);
  });
  window.journalFlush = async () => {
    await Promise.all([...imageLoads, ...pathLoads]);
    if (composing) changeRecord({ body: bodyField().value });
    clearTimeout(saveTimer);
    return persist();
  };
  let apiBusy = false;
  const apiSnapshot = () => JSON.stringify({records,projects,images:[...imageAssets]});
  async function apiRevision() {
    const digest=await crypto.subtle.digest("SHA-256",new TextEncoder().encode(apiSnapshot()));
    return Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,"0")).join("");
  }
  function apiDate(value) {
    if(typeof value!=="string"||!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+"T12:00:00").toLocaleDateString("sv-SE")!==value)throw Error("INVALID_DATE: expected YYYY-MM-DD");
    return value;
  }
  function apiText(value,name,max=200000) {
    if(typeof value!=="string"||!value.trim()||value.length>max)throw Error(`INVALID_INPUT: ${name}`);
    return value;
  }
  async function executeApi(request) {
    if(!request || typeof request!=="object")throw Error("INVALID_REQUEST");
    const operations=["capabilities","list_projects","get_day","get_project","search","add_idea","update_idea","create_project","save_event","delete_event"];
    if(!operations.includes(request.op))throw Error("UNKNOWN_OPERATION");
    if(apiBusy||composing||scheduleBusy||dataBusy||root.querySelector("dialog[open]"))throw Error("BUSY: finish the current edit or dialog before calling the API");
    const activeElement=document.activeElement, activeSelection=editorSelection();
    apiBusy=true;root.inert=true;
    let rollback=null;
    try {
      await window.journalFlush();
      const revision=await apiRevision();
      const write=["add_idea","update_idea","create_project","save_event","delete_event"].includes(request.op);
      if(write && request.revision!==revision)throw Error("CONFLICT: read current state and reapply the intended change");
      let result;
      if(request.op==="capabilities")result={version:1,operations,processId:window.__journalBoot.processId,appDirectory:window.__journalBoot.appDirectory,dataDirectory:window.__journalBoot.dataDirectory,writeRule:"Read, then send the returned revision. A conflict requires a fresh read; never overwrite journal.json.",transport:"same-user Windows named pipe"};
      else if(request.op==="list_projects")result=projects;
      else if(request.op==="get_day") {
        const date=apiDate(request.date), record=records[date] || empty();
        result={date,record,ideas:visibleIdeas(record)};
      } else if(request.op==="get_project") {
        if(request.id!=="unbound"&&!projectById(request.id))throw Error("NOT_FOUND: project");
        result={project:projectById(request.id)||null,ideas:projectIdeaRows(request.id)};
      } else if(request.op==="search")result=window.ScheduleFeatures.search(records,projects,apiText(request.query,"query",1000));
      else {
        rollback=JSON.parse(JSON.stringify({records,projects,edits:state.edits}));
        if(request.op==="create_project") {
          const name=apiText(request.name,"name",100).trim();
          if(request.root!==undefined&&typeof request.root!=="string")throw Error("INVALID_INPUT: root");
          const project={id:"project-"+crypto.randomUUID(),name,root:request.root||""};projects.push(project);result=project;
        } else {
          const date=apiDate(request.date), r=records[date] || empty();
          if(request.op==="add_idea"||request.op==="update_idea") {
            const ids=request.projectIds;
            if(ids!==undefined&&(!Array.isArray(ids)||ids.some(id=>!projectById(id))))throw Error("INVALID_INPUT: projectIds");
            if(request.important!==undefined&&typeof request.important!=="boolean"||request.done!==undefined&&typeof request.done!=="boolean")throw Error("INVALID_INPUT: important/done");
            if(request.dueDate!==undefined&&typeof request.dueDate!=="string")throw Error("INVALID_INPUT: dueDate");
            if(request.todo!==undefined&&typeof request.todo!=="boolean")throw Error("INVALID_INPUT: todo");
            if(request.taskState!==undefined&&!["note","todo","done"].includes(request.taskState))throw Error("INVALID_INPUT: taskState");
            if(request.taskState!==undefined&&(request.done!==undefined||request.todo!==undefined))throw Error("INVALID_INPUT: use taskState or legacy done/todo fields, not both");
            if((request.taskState==="note"||request.todo===false)&&request.dueDate)throw Error("INVALID_INPUT: ordinary notes cannot have a deadline");
            if(request.dueDate)apiDate(request.dueDate);
            let idea;
            if(request.op==="add_idea") {
              const text=apiText(request.text,"text").replace(/\r\n?/g,"\n");
              if(/^•(?: |$)/m.test(text))throw Error("INVALID_INPUT: add one idea per request; do not include manual bullet markers");
              const prefix=r.body && !r.body.endsWith("\n")?"\n":"";
              idea={id:makeIdeaId(),offset:r.body.length+prefix.length,done:false,important:false,dueDate:"",projectIds:[]};
              r.body+=prefix+"• "+text;r.ideas=[...copyIdeas(r.ideas),idea];
            } else {
              r.ideas=copyIdeas(r.ideas);idea=r.ideas.find(p=>p.id===request.id);
              if(!idea)throw Error("NOT_FOUND: idea");
              if(request.text!==undefined) {
                const text=apiText(request.text,"text").replace(/\r\n?/g,"\n");
                if(/^•(?: |$)/m.test(text))throw Error("INVALID_INPUT: update one idea per request");
                const range=ideaRanges(r.body).find(p=>p.offset===idea.offset), start=range.offset+2;
                let end=range.end;while(end>start&&r.body[end-1]==="\n")end--;
                const after=r.body.slice(0,start)+text+r.body.slice(end), mutation={start,end,newEnd:start+text.length};
                r.formats=textFormats.replace(r.formats,r.body,after,mutation);
                for(const other of r.ideas)if(other.offset>=end)other.offset+=text.length-(end-start);
                r.body=after;
              }
            }
            if(ids!==undefined)idea.projectIds=[...new Set(ids)];
            const wasDone=!!idea.done;
            if(request.done!==undefined)idea.done=request.done;
            if(request.todo!==undefined)idea.todo=request.todo;
            if(request.important!==undefined)idea.important=request.important;
            if(request.dueDate!==undefined)idea.dueDate=request.dueDate||"";
            if(request.taskState!==undefined)window.ScheduleState.setTaskState(idea,request.taskState);
            else if(request.todo===false&&!request.done)window.ScheduleState.setTaskState(idea,"note");
            else if(request.done===false&&wasDone)window.ScheduleState.setTaskState(idea,"todo");
            window.ScheduleState.normalizeIdea(idea);
            r.kind="journal";records[date]=r;state.edits[date]=r;bodyHistory.delete(date);result={date,idea};
          } else {
            const id=request.id || null;
            if(request.op==="delete_event"&&!eventsFor(r).some(s=>s.id===id))throw Error("NOT_FOUND: event");
            const event=request.op==="delete_event"?null:request.event;
            if(event!==null&&(!event||typeof event!=="object"))throw Error("INVALID_INPUT: event");
            const value=await window.journalNative.call("saveSchedule",{date,id,schedule:event});
            const events=eventsFor(r).filter(s=>s.id!==id);
            if(event)events.push(normalizeSchedule(value));
            setDayEvents(date,events);result=event?normalizeSchedule(value):{removed:true};
            // Native event writes are already durable. Preserve them if the following UI save fails.
            rollback=null;
          }
        }
        await persist();rollback=null;
        renderCalendar();renderEditor();
      }
      return {ok:true,revision:write?await apiRevision():revision,result};
    } catch(error) {
      if(rollback) {
        for(const date of Object.keys(records))delete records[date];Object.assign(records,rollback.records);
        projects=rollback.projects;state.edits=rollback.edits;renderCalendar();renderEditor();
      }
      throw error;
    } finally {
      apiBusy=false;root.inert=false;
      if(activeElement?.isConnected) {
        activeElement.focus({preventScroll:true});
        if(activeElement===bodyField())setBodySelection(activeSelection.start,activeSelection.end);
      }
    }
  }
  window.addEventListener("journal:api",async e=>{
    const {requestId,request}=e.detail;let response;
    try {response=await executeApi(request);}catch(error){response={ok:false,error:error.message};}
    await window.journalNative.call("apiResult",{requestId,response});
  });

  const sidebarHandle = $("#j-sidebar-resizer");
  let sidebarDrag = null;
  function sidebarLimit() {
    return Math.max(
      160,
      Math.min(
        420,
        root.clientWidth < 881 ? root.clientWidth - 48 : root.clientWidth - 606,
      ),
    );
  }
  function applySidebarWidth() {
    const width = Math.round(
      Math.max(160, Math.min(state.sidebarWidth, sidebarLimit())),
    );
    root.style.setProperty("--j-sidebar-width", width + "px");
    sidebarHandle.setAttribute("aria-valuenow", String(width));
    sidebarHandle.setAttribute("aria-valuemax", String(sidebarLimit()));
  }
  sidebarHandle.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    sidebarDrag = {
      pointer: e.pointerId,
      start: e.clientX,
      width: Number(sidebarHandle.getAttribute("aria-valuenow")),
      saved: state.sidebarWidth,
    };
    sidebarHandle.setPointerCapture(e.pointerId);
    root.dataset.resizing = "true";
  });
  sidebarHandle.addEventListener("pointermove", (e) => {
    if (!sidebarDrag || e.pointerId !== sidebarDrag.pointer) return;
    state.sidebarWidth = Math.round(
      Math.max(
        160,
        Math.min(
          sidebarLimit(),
          sidebarDrag.width + e.clientX - sidebarDrag.start,
        ),
      ),
    );
    applySidebarWidth();
  });
  function finishSidebarDrag(e) {
    if (!sidebarDrag || e.pointerId !== sidebarDrag.pointer) return;
    if (e.type === "pointercancel") state.sidebarWidth = sidebarDrag.saved;
    sidebarDrag = null;
    delete root.dataset.resizing;
    applySidebarWidth();
    persist();
  }
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"])
    sidebarHandle.addEventListener(event, finishSidebarDrag);
  sidebarHandle.addEventListener("keydown", (e) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) return;
    e.preventDefault();
    const width = Number(sidebarHandle.getAttribute("aria-valuenow"));
    state.sidebarWidth =
      e.key === "Home"
        ? 160
        : e.key === "End"
          ? sidebarLimit()
          : Math.max(
              160,
              Math.min(
                sidebarLimit(),
                width + (e.key === "ArrowRight" ? 16 : -16),
              ),
            );
    applySidebarWidth();
    persist();
  });
  sidebarHandle.addEventListener("dblclick", () => {
    state.sidebarWidth = 200;
    applySidebarWidth();
    persist();
  });
  new ResizeObserver(applySidebarWidth).observe(root);

  const pathLoads = new Set();
  function trackPath(task) {
    pathLoads.add(task);
    task.then(
      () => pathLoads.delete(task),
      () => pathLoads.delete(task),
    );
    return task;
  }
  async function openLocalPath(path) {
    if (!window.journalNative) {
      notify("预览中无法打开本地路径，请在 Schedule 桌面版使用。");
      return;
    }
    try {
      const result = await window.journalNative.call("openPath", { path });
      if (result.revealed) notify("已在文件夹中选中该文件。");
    } catch (e) {
      notify(e.message);
    }
  }
  async function attachLocalFiles(files, date) {
    const r = records[date] || empty(),
      next = [...r.files];
    let added = 0;
    for (const source of files) {
      if (next.some((f) => pathKey(resourcePath(f)) === pathKey(source.path)))
        continue;
      const file = { ...source },
        p = projectForPath(file.path);
      if (p) {
        file.projectId = p.id;
        file.relativePath = cleanPath(file.path)
          .slice(p.root.length)
          .replace(/^[\\/]+/, "");
      }
      next.push(file);
      added++;
    }
    if (!added) {
      notify("这条记录已经关联了该路径。");
      return;
    }
    if (date === state.selected) {
      changeRecord({ files: next });
      renderResources();
    } else {
      records[date] = { ...r, files: next };
      state.edits[date] = records[date];
    }
    clearTimeout(saveTimer);
    await persist();
    renderIdeaOverview();
    notify(`已关联 ${added} 项资料。`);
  }
  function renderResources() {
    const r = current(),
      linked = entryProjectIds(r)
        .map(projectById)
        .filter((p) => p.root);
    const roots = linked
      .map(
        (p) =>
          `<button type="button" class="j-resource" data-project-open="${esc(p.id)}" aria-label="打开项目 ${esc(p.name)}"><span class="j-resource-icon"><i data-lucide="folder" aria-hidden="true"></i></span><span class="j-resource-info"><span class="j-resource-name">${esc(p.name)} · 项目目录</span><span class="j-resource-path">${esc(p.root)}</span></span><i data-lucide="arrow-up-right" aria-hidden="true"></i></button>`,
      )
      .join("");
    $("#j-resources").innerHTML =
      roots +
      r.files
        .map((f, i) =>
          linked.some((p) => pathKey(p.root) === pathKey(resourcePath(f)))
            ? ""
            : resourceMarkup(f, i, state.selected),
        )
        .join("");
    icons();
  }
  function renderSelectedWeekday() {
    const [y, m, d] = parse(state.selected),
      date = new Date(y, m - 1, d);
    $("#j-selected-weekday").textContent =
      ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"][
        date.getDay()
      ] + (state.selected === today ? " · 今天" : "");
  }
  function renderEditor() {
    resetTypingFormat();
    formatOpen = false; closeIdeaMenu();
    const [, m, d] = parse(state.selected),
      r = current();
    renderSelectedWeekday();
    $("#j-selected-date").textContent = `${m} 月 ${d} 日`;
    $("#j-entry-title").value = r.title;
    $("#j-entry-body").value = r.body;
    pickerTarget = null;
    $("#j-project-picker").hidden = true;
    $("#j-entry-project").setAttribute("aria-expanded", "false");
    $("#j-entry-source").textContent =
      r.title || r.body ? r.source : "新的一天";
    $(".j-important").setAttribute("aria-pressed", String(r.important));
    $(".j-important").setAttribute(
      "aria-label",
      r.important ? "取消重要标记" : "标记为重要",
    );
    renderSchedule();
    updateIdeaUI();
    beforeEdit = null;
    $("#j-save-status").textContent = state.edits[state.selected]
      ? window.journalNative
        ? "已保存到本机"
        : "已保存到预览"
      : records[state.selected]
        ? "示例记录"
        : "尚未记录";
    $(".j-attach-form").hidden = true;
    renderProjects();
    renderResources();
  }
  function render() {
    applySidebarWidth();
    renderCalendar();
    renderEditor();
    $("#j-search").value = state.query;
    $(".j-search-row").hidden = !state.query;
    if (state.sidebar) root.dataset.sidebar = state.sidebar;
    root.dataset.dayExpanded = String(state.dayExpanded);
    if (state.dayExpanded) expandDay();
    restoreViewPosition();
    requestAnimationFrame(() => { $(".j-sidebar").scrollTop = state.sidebarScroll; });
    icons();
  }
  function select(k, keepView = false) {
    rememberView();
    const previousYear = state.year,
      previousMonth = state.month,
      previousView = state.view;
    clearTimeout(saveTimer);
    state.selected = k;
    const [y, m] = parse(k);
    state.year = y;
    state.month = m - 1;
    if (!keepView && state.view === "year") state.view = "month";
    root.dataset.mobileDetail = "true";
    if (
      root.dataset.screen !== "ideas" &&
      previousYear === state.year && previousView === state.view &&
      (state.view === "year" || previousMonth === state.month)
    ) {
      // Keep date buttons alive so the second click can produce a real dblclick.
      $$(".j-calendar-pane [data-date]").forEach((button) => {
        button.classList.toggle("is-selected", button.dataset.date === k);
        button.classList.toggle("is-today", button.dataset.date === today);
        button.setAttribute("aria-pressed", String(button.dataset.date === k));
      });
      $("#j-write-label").textContent = hasContent(current()) ? "继续记录" : "写一条记录";
    } else renderCalendar();
    renderEditor();
    $(".j-editor").scrollTop = 0;
    if (!matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const pane = $(".j-editor");
      pane.getAnimations().forEach((a) => a.cancel());
      pane.animate(
        [
          { opacity: 0.7, transform: "translateY(3px)" },
          { opacity: 1, transform: "translateY(0)" },
        ],
        { duration: 120, easing: "ease-out" },
      );
    }
    persist();
  }
  function expandDay() {
    state.dayExpanded = true;
    root.dataset.dayExpanded = "true";
    root.dataset.mobileDetail = "true";
    if (root.clientWidth < 881) root.dataset.sidebar = "closed";
    const label = state.filter === "todo" ? "返回待办" : projectById(state.filter) || state.filter === "unbound" ? "返回想法总览" : state.filter === "search" ? "返回搜索结果" : state.filter === "important" ? "返回重要事项" : "返回日历";
    $(".j-back").setAttribute("aria-label", label);
    $(".j-back").title = label;
    $(".j-back").focus({ preventScroll: true });
    if (window.journalReady) persist();
  }
  function collapseDay() {
    state.dayExpanded = false;
    root.dataset.dayExpanded = "false";
    root.dataset.mobileDetail = "false";
    restoreViewPosition();
    persist();
  }
  root.addEventListener("dblclick", (e) => {
    const date = e.target.closest(".j-calendar-pane button[data-date]");
    if (!date || !root.contains(date)) return;
    e.preventDefault();
    if (state.selected !== date.dataset.date) select(date.dataset.date, true);
    expandDay();
  });
  let dayTimer;
  function refreshToday(follow = true) {
    const now = new Date(),
      next = now.toLocaleDateString("sv-SE");
    clearTimeout(dayTimer);
    // Check at local midnight, and recover from clock changes or suspended timers.
    dayTimer = setTimeout(
      refreshToday,
      Math.min(
        60000,
        new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1) - now + 25,
      ),
    );
    if (next === today) return;
    const previous = today,
      [year, month] = parse(previous),
      editing = composing || root.querySelector("dialog[open]") ||
        (root.contains(document.activeElement) &&
          document.activeElement.closest(
            'input, textarea, [contenteditable="true"]',
          ));
    today = next;
    if (
      follow && !editing && state.selected === previous &&
      state.year === year && state.month === month - 1
    ) {
      const mobileDetail = root.dataset.mobileDetail;
      select(today, true);
      root.dataset.mobileDetail = mobileDetail;
    } else {
      renderCalendar();
      renderSelectedWeekday();
    }
  }
  function changeRecord(patch, edit) {
    const existing = current(),
      ideas = patch.ideas
        ? copyIdeas(patch.ideas)
        : typeof patch.body === "string"
          ? reconcileIdeas(existing, patch.body, edit)
          : copyIdeas(existing.ideas);
    const bodyChanged = typeof patch.body === "string";
    const mutation = bodyChanged ? textFormats.mutation(existing.body, patch.body, edit) : null;
    const formats = patch.formats !== undefined
      ? textFormats.normalize(patch.formats, patch.body?.length ?? existing.body.length)
      : bodyChanged ? textFormats.replace(existing.formats, existing.body, patch.body, mutation, typingFormat)
        : existing.formats;
    const r = {
      ...existing,
      ...patch,
      ideas,
      projectIds: [],
      source: "手动记录",
      files: patch.files || existing.files,
    };
    if (formats !== undefined) r.formats = formats;
    records[state.selected] = r;
    state.edits[state.selected] = r;
    if (bodyChanged && typingPosition) typingPosition.at = mutation.newEnd;
    if ((bodyChanged || patch.formats !== undefined) && !composing) {
      const selection = editorSelection(), focused = document.activeElement === bodyField();
      drawBody(r.body);
      if (focused) setBodySelection(selection.start, selection.end);
    }
    if (
      pickerTarget?.date === state.selected &&
      !r.ideas.some((p) => p.id === pickerTarget.id)
    ) {
      pickerTarget = null;
      $("#j-project-picker").hidden = true;
    }
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderCalendar);
    updateIdeaUI();
    $("#j-save-status").textContent = window.journalNative
      ? "正在保存…"
      : "正在更新预览…";
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!window.journalNative)
        $("#j-save-status").textContent = "已保存到预览";
      persist();
    }, 350);
  }
  root.addEventListener("click", (e) => {
    const editorLink = e.target.closest("[data-editor-link]");
    if (editorLink && root.contains(editorLink)) {
      e.preventDefault();
      if (document.activeElement === bodyField() && !e.ctrlKey && !e.metaKey) return;
      if (editorLink.dataset.editorLink === "path") openLocalPath(editorLink.dataset.linkTarget);
      else if (window.journalNative) window.journalNative.call("openExternal", {url:editorLink.dataset.linkTarget}).catch(error => notify(error.message));
      else window.open(editorLink.dataset.linkTarget, "_blank", "noopener,noreferrer");
      return;
    }
    const link = e.target.closest("[data-external-url]");
    if (link && root.contains(link)) {
      e.preventDefault();
      if (window.journalNative)
        window.journalNative
          .call("openExternal", { url: link.dataset.externalUrl })
          .catch((error) => notify(error.message));
      else
        window.open(link.dataset.externalUrl, "_blank", "noopener,noreferrer");
      return;
    }
    const b = e.target.closest("button");
    if (!b || !root.contains(b)) return;
    if (b.dataset.inlinePath) {
      openLocalPath(b.dataset.inlinePath);
      return;
    }
    if (b.dataset.projectOpen) {
      const p = projectById(b.dataset.projectOpen);
      if (p) openLocalPath(p.root);
      return;
    }
    if (b.dataset.projectEdit) {
      openProjectDialog(b.dataset.projectEdit);
      return;
    }
    if (b.dataset.bindCurrent) {
      openBindingPicker({ date: state.selected, id: b.dataset.bindCurrent });
      return;
    }
    if (b.dataset.openIdea) {
      openIdea(b.dataset.ideaDay, b.dataset.openIdea);
      return;
    }
    if (b.dataset.bindIdea) {
      openIdea(b.dataset.ideaDay, b.dataset.bindIdea, true);
      return;
    }
    if (b.dataset.importantDate) {
      select(b.dataset.importantDate);
      expandDay();
      return;
    }
    if (b.dataset.searchDate) {
      if (b.dataset.searchIdea) openIdea(b.dataset.searchDate, b.dataset.searchIdea);
      else select(b.dataset.searchDate);
      expandDay();
      return;
    }
    if (b.dataset.date) {
      select(b.dataset.date, !!b.closest(".j-calendar-pane"));
      return;
    }
    if (b.dataset.month !== undefined) {
      state.month = Number(b.dataset.month);
      state.view = "month";
      renderCalendar();
      persist();
      return;
    }
    if (b.dataset.filter) {
      switchView(b.dataset.filter);
      return;
    }
    if (b.dataset.view) {
      state.view = b.dataset.view;
      root.dataset.mobileDetail = "false";
      renderCalendar();
      persist();
      return;
    }
    if (b.dataset.resource !== undefined) {
      const f =
        records[b.dataset.resourceDate]?.files[Number(b.dataset.resource)];
      if (f) openLocalPath(resourcePath(f));
      return;
    }
    if (b.dataset.todoDate) {
      if (b.dataset.todoIdea) openIdea(b.dataset.todoDate, b.dataset.todoIdea);
      else select(b.dataset.todoDate);
      expandDay(); return;
    }
    const action = b.dataset.action;
    if (action === "undo-action") { performUndo(); return; }
    if (action === "toggle-format") { formatOpen = !formatOpen; updateFormatToolbar(); return; }
    if (action === "idea-menu") {
      const menu = $("#j-idea-menu"); menu.hidden = !menu.hidden;
      b.setAttribute("aria-expanded", String(!menu.hidden)); return;
    }
    if (action === "bind-active-idea") {
      const idea = ideaAtCaret(); closeIdeaMenu();
      if (idea) openBindingPicker({date:state.selected,id:idea.id}); return;
    }
    if (action === "delete-idea") { deleteActiveIdea(); return; }
    if (action === "creator") {
      if (window.journalNative)
        window.journalNative
          .call("openCreatorPage")
          .catch((e) => notify(e.message));
      else window.open("https://arc0127.github.io/", "_blank", "noopener");
      return;
    }
    if (action === "idea") {
      toggleIdea();
      return;
    }
    if (action === "idea-page-prev" || action === "idea-page-next") {
      overviewPage = Math.max(
        0,
        overviewPage + (action === "idea-page-next" ? 1 : -1),
      );
      renderIdeaOverview();
      $(".j-ideas-pane").scrollTop = 0; rememberView(); persist();
      return;
    }
    if (action === "choose-project") {
      if (!$("#j-project-picker").hidden && !pickerTarget) {
        $("#j-project-picker").hidden = true;
        $("#j-entry-project").setAttribute("aria-expanded", "false");
      } else openBindingPicker();
      return;
    }
    if (action === "unbind-projects") {
      setBindingIds([]);
      return;
    }
    if (action === "close-project-picker") {
      $("#j-project-picker").hidden = true;
      $("#j-entry-project").setAttribute("aria-expanded", "false");
      return;
    }
    if (action === "create-project" || action === "create-linked-project") {
      openProjectDialog(null, action === "create-linked-project");
      return;
    }
    if (action === "save-project") {
      saveProject();
      return;
    }
    if (action === "cancel-project") {
      $("#j-project-dialog").close();
      return;
    }
    if (action === "previous" || action === "next") {
      const step = action === "next" ? 1 : -1;
      if (state.view === "year") state.year += step;
      else {
        const dt = new Date(state.year, state.month + step, 1);
        state.year = dt.getFullYear();
        state.month = dt.getMonth();
      }
      renderCalendar();
      persist();
    } else if (action === "today") {
      refreshToday(false);
      state.view = "month";
      select(today);
      root.dataset.mobileDetail = "false";
    } else if (action === "important") {
      changeRecord({ important: !current().important });
      renderSchedule();
      $(".j-important").setAttribute(
        "aria-pressed",
        String(current().important),
      );
      $(".j-important").setAttribute(
        "aria-label",
        current().important ? "取消重要标记" : "标记为重要",
      );
    } else if (action === "new") {
      root.dataset.mobileDetail = "true";
      $("#j-entry-body").focus();
      if (current().body)
        notify("可直接继续编辑当天记录，或选择一个空白日期开始。");
    } else if (action === "back") {
      collapseDay();
      const target = state.filter === "important"
        ? root.querySelector(`[data-important-date="${state.selected}"]`) || $('[data-filter="important"]')
        : state.filter === "search" ? root.querySelector(`[data-search-date="${state.selected}"]`) || $("#j-search")
        : root.querySelector(`.j-calendar-pane [data-date="${state.selected}"]`);
      target?.focus({ preventScroll: true });
    } else if (action === "sidebar") {
      const isClosed =
        root.dataset.sidebar === "closed" ||
        (!root.dataset.sidebar && root.clientWidth < 881);
      state.sidebar = isClosed ? "open" : "closed";
      root.dataset.sidebar = state.sidebar;
      persist();
    } else if (action === "search") {
      switchView("search");
      $(".j-search-row").hidden = false;
      root.dataset.mobileDetail = "false";
      $("#j-search").focus();
    } else if (action === "close-search") {
      state.query = "";
      switchView("all");
      $("#j-search").value = "";
      $(".j-search-row").hidden = true;
      renderCalendar();
      persist();
    } else if (action === "attach") {
      $(".j-attach-form").hidden = false;
      pathSuggestion();
      $("#j-path-input").focus();
    } else if (action === "cancel-attach") {
      $(".j-attach-form").hidden = true;
    } else if (action === "confirm-attach") {
      const path = $("#j-path-input").value.trim(),
        date = state.selected;
      if (!path) {
        $("#j-path-input").focus();
        return;
      }
      if (!window.journalNative) {
        notify("请在 Schedule 桌面版关联本地路径。");
        return;
      }
      b.disabled = true;
      trackPath(
        window.journalNative
          .call("inspectPath", { path })
          .then(async (file) => {
            await attachLocalFiles([file], date);
            if (state.selected === date) {
              $(".j-attach-form").hidden = true;
              $("#j-path-input").value = "";
            }
          }),
      )
        .catch((e) => notify(e.message))
        .finally(() => {
          b.disabled = false;
        });
    }
  });
  bodyField().addEventListener("compositionstart", () => {
    composing = true;
    compositionStart = bodySnapshot();
  });
  bodyField().addEventListener("compositionend", () => {
    composing = false;
    canonicalizeBody();
    const edit = inputMutation(
      compositionStart,
      bodyField().value,
      "insertCompositionText",
    );
    rememberBody(
      compositionStart || { ...bodySnapshot(), body: current().body },
      "composition",
    );
    compositionStart = null;
    beforeEdit = null;
    changeRecord({ body: bodyField().value }, edit);
  });
  bodyField().addEventListener("beforeinput", (e) => {
    const t = bodyField();
    if (
      !composing &&
      t.selectionStart !== t.selectionEnd &&
      (e.inputType.startsWith("delete") ||
        (e.inputType === "insertText" && e.data !== null))
    ) {
      e.preventDefault();
      editBody(
        t.selectionStart,
        t.selectionEnd,
        e.inputType.startsWith("delete") ? "" : e.data,
      );
      return;
    }
    if (e.inputType === "historyUndo" || e.inputType === "historyRedo") {
      e.preventDefault();
      undoBody(e.inputType === "historyRedo");
      return;
    }
    if (e.inputType.startsWith("format")) {
      e.preventDefault();
      return;
    }
    if (
      !composing &&
      ["insertParagraph", "insertLineBreak"].includes(e.inputType)
    ) {
      e.preventDefault();
      const t = bodyField();
      editBody(
        t.selectionStart,
        t.selectionEnd,
        ideaContext().ideaStart >= 0 &&
          t.selectionStart !== ideaContext().ideaStart
          ? "\n  "
          : "\n",
      );
      return;
    }
    if (!composing) beforeEdit = bodySnapshot();
  });
  bodyField().addEventListener("input", (e) => {
    if (composing || e.isComposing) return;
    const before = beforeEdit || { ...bodySnapshot(), body: current().body };
    canonicalizeBody();
    const edit = inputMutation(beforeEdit, bodyField().value, e.inputType);
    rememberBody(before, e.inputType || "input");
    beforeEdit = null;
    changeRecord({ body: bodyField().value }, edit);
  });
  bodyField().addEventListener("click", (e) => {
    if (e.target.dataset.imageToken) {
      const r = document.createRange();
      r.selectNode(e.target);
      const s = window.getSelection();
      s.removeAllRanges();
      s.addRange(r);
      editorSelection();
    }
  });
  for (const type of ["click", "keyup", "select", "focus"])
    bodyField().addEventListener(type, updateIdeaUI);
  bodyField().addEventListener("keydown", (e) => {
    if (composing || e.isComposing || e.keyCode === 229) return;
    if (e.target.closest("[data-editor-link]") && document.activeElement !== bodyField()) return;
    if ((e.ctrlKey || e.metaKey) && !e.altKey && ["b", "i", "u"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      const name = { b: "bold", i: "italic", u: "underline" }[e.key.toLowerCase()];
      applyTextFormat({ [name]: !selectionStyle()[name] });
      return;
    }
    if ((e.ctrlKey || e.metaKey) && ["z", "y"].includes(e.key.toLowerCase())) {
      e.preventDefault();
      e.stopPropagation();
      undoBody(e.key.toLowerCase() === "y" || e.shiftKey);
      return;
    }
    const t = bodyField(),
      c = ideaContext();
    if (e.key === "Enter" && e.shiftKey) {
      e.preventDefault();
      if (!c.line.trim()) {
        editBody(c.start, c.end, "• ");
        return;
      }
      if (
        t.selectionStart === t.selectionEnd &&
        t.selectionStart === c.ideaStart
      ) {
        editBody(
          t.selectionStart,
          t.selectionEnd,
          "• \n",
          t.selectionStart + 2,
        );
        return;
      }
      editBody(t.selectionStart, t.selectionEnd, "\n• ");
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      editBody(
        t.selectionStart,
        t.selectionEnd,
        c.ideaStart >= 0 && t.selectionStart !== c.ideaStart ? "\n  " : "\n",
      );
      return;
    }
    if (
      e.key === "Backspace" &&
      t.selectionStart === t.selectionEnd &&
      t.selectionStart === c.start + 2 &&
      (/^• /.test(c.line) || /^ {2}/.test(c.line))
    ) {
      e.preventDefault();
      editBody(c.start ? c.start - 1 : c.start, c.start + 2, "");
      return;
    }
    if (
      e.key === "Delete" &&
      t.selectionStart === t.selectionEnd &&
      t.selectionStart === c.end &&
      /^(?:• | {2})/.test(t.value.slice(c.end + 1))
    ) {
      e.preventDefault();
      editBody(c.end, c.end + 3, "");
    }
  });
  $("#j-entry-title").addEventListener("input", (e) => {
    if (!e.isComposing) changeRecord({ title: $("#j-entry-title").value });
  });
  $("#j-search").addEventListener("input", () => {
    state.query = $("#j-search").value;
    overviewPage = 0;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(renderCalendar);
    persist();
  });
  root.addEventListener("keydown", (e) => {
    const link = e.target.closest("[data-editor-link]");
    if (e.key === "Enter" && link && document.activeElement !== bodyField()) {
      e.preventDefault(); link.click(); return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (composing) return;
      persist();
      if (!window.journalNative)
        $("#j-save-status").textContent = "已保存到预览";
    }
    if (e.key === "Escape") {
      if (root.querySelector("dialog[open]")) return;
      if (!$("#j-idea-menu").hidden || formatOpen) { closeIdeaMenu(); formatOpen = false; updateFormatToolbar(); return; }
      pickerTarget = null;
      $(".j-attach-form").hidden = true;
      $("#j-project-picker").hidden = true;
      $("#j-entry-project").setAttribute("aria-expanded", "false");
      root.dataset.mobileDetail = "false";
      collapseDay();
    }
    const date = e.target.dataset.date;
    if (
      date &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)
    ) {
      e.preventDefault();
      const [y, m, d] = parse(date),
        dt = new Date(
          y,
          m - 1,
          d +
            { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key],
        );
      const k = key(dt.getFullYear(), dt.getMonth(), dt.getDate());
      select(k);
      root.querySelector(`[data-date="${k}"]`)?.focus();
    }
  });
  $(".j-editor").addEventListener("dragover", (e) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    $(".j-editor").classList.add("is-dragging");
  });
  $(".j-editor").addEventListener("dragleave", (e) => {
    if (!$(".j-editor").contains(e.relatedTarget))
      $(".j-editor").classList.remove("is-dragging");
  });
  $(".j-editor").addEventListener("drop", async (e) => {
    if (!Array.from(e.dataTransfer.types).includes("Files")) return;
    e.preventDefault();
    $(".j-editor").classList.remove("is-dragging");
    const files = Array.from(e.dataTransfer.files),
      date = state.selected;
    if (!window.journalNative) {
      notify("请在 Schedule 桌面版拖入本地文件或文件夹。");
      return;
    }
    try {
      await trackPath(
        window.journalNative
          .call("droppedPaths", null, files)
          .then((entries) => attachLocalFiles(entries, date)),
      );
    } catch (error) {
      notify(error.message);
    }
  });
  let navigationTimer;
  for (const pane of $$(".j-sidebar, .j-calendar-pane, .j-ideas-pane")) pane.addEventListener("scroll", () => {
    if (!window.journalReady || root.dataset.dayExpanded === "true" || pane.clientHeight === 0) return;
    rememberView(); clearTimeout(navigationTimer);
    navigationTimer = setTimeout(() => persist(), 300);
  });
  root.addEventListener("pointerdown", e => {
    if (!e.target.closest("#j-idea-menu, #j-idea-menu-toggle")) closeIdeaMenu();
  });
  restore(
    window.journalNative
      ? window.__journalBoot?.widgetState
      : window.openai?.widgetState,
  );
  if (window.journalNative) {
    // A cold launch starts at today's date; opening a dated reminder overrides it.
    state.selected = today;
    state.year = Number(today.slice(0, 4));
    state.month = Number(today.slice(5, 7)) - 1;
    for (const r of Object.values(records)) { r.appointments = []; r.appointment = null; r.schedule = ""; }
    for (const [eventKey, value] of Object.entries(window.journalNative.schedules)) {
      const event = normalizeSchedule(value), date = event.date || eventKey.split("/")[0];
      event.id ||= "legacy-" + date;
      setDayEvents(date, [...eventsFor(records[date]), event]);
    }
    $(".j-preview").hidden = true;
    $("[data-action=dock]").hidden = false;
  }
  render();
  if (window.journalNative) await window.journalNative.call("uiReady");
  window.journalReady = true;
  document.querySelector(".j-load-status")?.remove();
  root.inert = false;
  const restoreWarning=sessionStorage.getItem("restoreWarning");
  if(restoreWarning){sessionStorage.removeItem("restoreWarning");notify("数据已恢复。"+restoreWarning);}
  refreshToday();
  window.addEventListener("focus", () => refreshToday());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshToday();
  });
  window.addEventListener("openai:set_globals", (e) => {
    if (window.journalNative) return;
    const s = e.detail?.globals?.widgetState;
    if (!s || root.contains(document.activeElement)) return;
    restore(s);
    render();
  });
})().catch((error) => {
  const root = document.getElementById("journal-ui");
  if (!window.journalNative) throw error;
  root.inert = true;
  const status =
    document.querySelector(".j-load-status") || document.createElement("div");
  status.className = "j-load-status";
  status.setAttribute("role", "alert");
  status.textContent = `记录加载未完成，未保存空白界面。${error.message} 请退出后重试。`;
  if (!status.isConnected) root.before(status);
});
