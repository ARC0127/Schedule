/* Tokenize display content without interpreting user-provided HTML. */
(function (root) {
  function ideaRanges(body) {
    const ideas = [];
    let offset = 0,
      active = null;
    for (const line of String(body || "").split("\n")) {
      if (/^•(?: |$)/.test(line)) {
        active = {
          offset,
          end: offset + line.length,
          text: line.slice(1).trimStart(),
        };
        ideas.push(active);
      } else if (active) {
        active.text += "\n" + (line.startsWith("  ") ? line.slice(2) : line);
        active.end = offset + line.length;
      }
      offset += line.length + 1;
    }
    return ideas;
  }
  function mathParts(text) {
    text = String(text);
    const result = [],
      openings = /\\\(|\\\[|\$\$/g;
    const escaped = (at) => {
      let slashes = 0;
      while (at > 0 && text[--at] === "\\") slashes++;
      return slashes % 2 === 1;
    };
    let end = 0;
    for (let match; (match = openings.exec(text)); ) {
      if (escaped(match.index)) continue;
      const close = { "\\(": "\\)", "\\[": "\\]", $$: "$$" }[match[0]];
      let at = text.indexOf(close, openings.lastIndex);
      while (at >= 0 && escaped(at))
        at = text.indexOf(close, at + close.length);
      if (at < 0) continue;
      const finish = at + close.length;
      if (match.index > end)
        result.push({ kind: "text", text: text.slice(end, match.index) });
      result.push({
        kind: "math",
        text: text.slice(match.index, finish),
        tex: text.slice(openings.lastIndex, at),
        display: match[0] !== "\\(",
      });
      end = finish;
      openings.lastIndex = finish;
    }
    if (end < text.length) result.push({ kind: "text", text: text.slice(end) });
    return result;
  }
  function textParts(text, withOffsets = false) {
    const result = [];
    const add = (part, start, end, textStart = start) =>
      result.push(withOffsets ? { ...part, start, end, textStart } : part);
    const pattern =
      /([\uE000-\uF8FF])|\[([^\]\n]+)\]\((https?:\/\/[^\s<>"]+)\)|"((?:[a-z]:[\\/]|\\\\)[^"\r\n]+)"|(https?:\/\/[^\s<>"\uE000-\uF8FF]+)|((?:[a-z]:[\\/]|\\\\)[^\s<>"\uE000-\uF8FF]+)/gi;
    let end = 0;
    for (const match of String(text).matchAll(pattern)) {
      if (match.index > end)
        add({ kind: "text", text: text.slice(end, match.index) }, end, match.index);
      end = match.index + match[0].length;
      if (match[1]) add({ kind: "image", token: match[1] }, match.index, end);
      else if (match[4] || match[6])
        add({ kind: "path", text: match[4] || match[6] }, match.index, end, match.index + (match[4] ? 1 : 0));
      else {
        let url = match[3] || match[5],
          suffix = "";
        if (!match[3]) {
          url = url.replace(/[.,!?;:，。！？；：、]+$/u, "");
          while (/[)\]}）】]$/.test(url)) {
            const close = url.at(-1),
              open = { ")": "(", "]": "[", "}": "{", "）": "（", "】": "【" }[
                close
              ];
            if (url.split(close).length <= url.split(open).length) break;
            url = url.slice(0, -1);
          }
          suffix = match[5].slice(url.length);
        }
        try {
          const parsed = new URL(url);
          if (
            !parsed.hostname ||
            !["http:", "https:"].includes(parsed.protocol)
          )
            throw Error("Invalid web URL");
          add({ kind: "url", text: match[2] || url, url }, match.index, end - suffix.length, match.index + (match[2] ? 1 : 0));
          if (suffix) add({ kind: "text", text: suffix }, end - suffix.length, end);
        } catch {
          add({ kind: "text", text: match[0] }, match.index, end);
        }
      }
    }
    if (end < text.length) add({ kind: "text", text: text.slice(end) }, end, text.length);
    return result;
  }
  const parts = (text, withOffsets = false) => {
    let offset = 0;
    return mathParts(text).flatMap((part) => {
      const result = part.kind === "math"
        ? [withOffsets ? { ...part, start: offset, end: offset + part.text.length, textStart: offset } : part]
        : textParts(part.text, withOffsets).map(p => withOffsets
          ? { ...p, start: p.start + offset, end: p.end + offset, textStart: p.textStart + offset }
          : p);
      offset += part.text.length;
      return result;
    });
  };
  const api = { parts, mathParts, ideaRanges };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ScheduleContent = api;
})(globalThis);
