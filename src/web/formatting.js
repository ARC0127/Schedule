/* Formatting uses UTF-16 offsets into the unchanged plain-text journal body. */
(function (root) {
  const sizes = [12, 13, 14, 16, 18, 20, 24, 28, 32];
  const colors = [
    "#657060",
    "#252a2b",
    "#286746",
    "#b34848",
    "#356ca1",
    "#805b99",
  ];
  function style(value) {
    const result = {};
    if (!value || typeof value !== "object") return result;
    for (const key of ["bold", "italic", "underline"])
      if (value[key] === true) result[key] = true;
    if (sizes.includes(value.size)) result.size = value.size;
    if (colors.includes(value.color)) result.color = value.color;
    return result;
  }
  const same = (a, b) => JSON.stringify(style(a)) === JSON.stringify(style(b));
  function normalize(runs, length) {
    const clean = [];
    for (const run of Array.isArray(runs) ? runs : []) {
      if (!run || !Number.isInteger(run.start) || !Number.isInteger(run.end))
        continue;
      const start = Math.max(0, Math.min(length, run.start));
      const end = Math.max(start, Math.min(length, run.end));
      const value = style(run);
      if (end > start && Object.keys(value).length)
        clean.push({ start, end, ...value });
    }
    clean.sort((a, b) => a.start - b.start || a.end - b.end);
    const result = [];
    for (const run of clean) {
      const last = result.at(-1);
      // Persisted runs are non-overlapping. Malformed overlaps never grow text.
      const start = Math.max(run.start, last?.end || 0);
      if (start >= run.end) continue;
      if (last && last.end === start && same(last, run)) last.end = run.end;
      else result.push({ ...run, start });
    }
    return result;
  }
  function at(runs, position, preferLeft = false) {
    if (preferLeft && position > 0) position--;
    return style(
      (runs || []).find((r) => r.start <= position && position < r.end),
    );
  }
  function slice(runs, start, end) {
    return normalize(runs, end)
      .filter((r) => r.end > start && r.start < end)
      .map((r) => ({
        ...r,
        start: Math.max(start, r.start) - start,
        end: Math.min(end, r.end) - start,
      }));
  }
  function segments(text, runs, offset = 0) {
    const clean = slice(runs, offset, offset + text.length),
      result = [];
    let cursor = 0;
    for (const run of clean) {
      if (run.start > cursor)
        result.push({ text: text.slice(cursor, run.start), style: {} });
      result.push({ text: text.slice(run.start, run.end), style: style(run) });
      cursor = run.end;
    }
    if (cursor < text.length)
      result.push({ text: text.slice(cursor), style: {} });
    return result;
  }
  function apply(runs, length, start, end, patch) {
    const clean = normalize(runs, length),
      boundaries = new Set([0, length, start, end]);
    for (const r of clean) {
      boundaries.add(r.start);
      boundaries.add(r.end);
    }
    const points = [...boundaries]
        .filter((x) => x >= 0 && x <= length)
        .sort((a, b) => a - b),
      result = [];
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i],
        b = points[i + 1];
      let value = at(clean, a);
      if (a >= start && b <= end)
        value = patch === null ? {} : style({ ...value, ...patch });
      result.push({ start: a, end: b, ...value });
    }
    return normalize(result, length);
  }
  function mutation(before, after, edit) {
    if (
      edit &&
      before.slice(0, edit.start) === after.slice(0, edit.start) &&
      before.slice(edit.end) === after.slice(edit.newEnd)
    )
      return edit;
    let start = 0,
      end = before.length,
      newEnd = after.length;
    while (start < end && start < newEnd && before[start] === after[start])
      start++;
    while (
      end > start &&
      newEnd > start &&
      before[end - 1] === after[newEnd - 1]
    ) {
      end--;
      newEnd--;
    }
    return { start, end, newEnd };
  }
  function replace(runs, before, after, edit, typing, inserted) {
    const clean = normalize(runs, before.length),
      { start, end, newEnd } = mutation(before, after, edit),
      delta = newEnd - end;
    const result = [];
    for (const r of clean) {
      if (r.start < start) result.push({ ...r, end: Math.min(r.end, start) });
      if (r.end > end)
        result.push({
          ...r,
          start: Math.max(r.start, end) + delta,
          end: r.end + delta,
        });
    }
    if (newEnd > start) {
      if (Array.isArray(inserted))
        result.push(
          ...normalize(inserted, newEnd - start).map((r) => ({
            ...r,
            start: r.start + start,
            end: r.end + start,
          })),
        );
      else
        result.push({
          start,
          end: newEnd,
          ...style(typing ?? at(clean, start, start === end)),
        });
    }
    return normalize(result, after.length);
  }
  function css(value) {
    const s = style(value),
      rules = [];
    if (s.bold) rules.push("font-weight:700");
    if (s.italic) rules.push("font-style:italic");
    if (s.underline) rules.push("text-decoration:underline");
    if (s.size) rules.push(`font-size:${s.size}px`);
    if (s.color) rules.push(`color:${s.color}`);
    return rules.join(";");
  }
  function forIdea(body, idea, runs) {
    let text = "",
      formats = [],
      raw = idea.offset;
    body
      .slice(idea.offset, idea.end)
      .split("\n")
      .forEach((line, i) => {
        const shown =
          i === 0
            ? line.slice(1).trimStart()
            : line.startsWith("  ")
              ? line.slice(2)
              : line;
        if (i) text += "\n";
        const start = raw + line.length - shown.length,
          offset = text.length;
        formats.push(
          ...slice(runs, start, raw + line.length).map((r) => ({
            ...r,
            start: r.start + offset,
            end: r.end + offset,
          })),
        );
        text += shown;
        raw += line.length + 1;
      });
    return { text, formats };
  }
  const api = {
    sizes,
    colors,
    style,
    normalize,
    at,
    slice,
    segments,
    apply,
    mutation,
    replace,
    css,
    forIdea,
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScheduleFormatting = api;
})(globalThis);
