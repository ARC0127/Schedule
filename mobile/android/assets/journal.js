/* Local journal and Markdown interchange. Event storage belongs to the native alarm scheduler. */
(function (root) {
  const datePattern = /^[0-9]{4}-[0-9]{2}-[0-9]{2}$/;
  function validDate(date) {
    if (!datePattern.test(date)) return false;
    const parsed = new Date(date + 'T00:00:00Z');
    return Number.isFinite(+parsed) && parsed.toISOString().slice(0, 10) === date;
  }

  function blank() { return { days: {}, ideas: [], projects: [], docs: {} }; }
  function key() { return crypto.randomUUID(); }
  function calendarDate(date = new Date()) {
    const two = number => String(number).padStart(2, '0');
    return date.getFullYear() + '-' + two(date.getMonth() + 1) + '-' + two(date.getDate());
  }
  function heat(count, maximum) { return count ? Math.min(4, Math.ceil(4 * count / Math.max(1, maximum))) : 0; }

  function attachments(text) {
    return text.replace(/!\[([^\]\n]*)\]\(schedule-image:[a-f0-9-]+\.[a-z]+\)/g, '![$1](<attachment>)')
      .replace(/\[([^\]\n]*)\]\(schedule-document:[a-f0-9-]+\)/g, '$1');
  }

  function ideaMetadata(idea, projects) {
    const names = (idea.projects || []).map(id => projects.find(project => project.id === id)?.name).filter(Boolean);
    if (!idea.important && !idea.due && !names.length) return '';
    const metadata = JSON.stringify({ important: !!idea.important, due: idea.due || '', projects: names });
    return '\n  <!-- schedule:' + encodeURIComponent(metadata).replaceAll('-', '%2D') + ' -->';
  }

  function exportMarkdown(state, events) {
    const dates = [...new Set([...Object.keys(state.days), ...state.ideas.map(i => i.date), ...events.map(e => e.key.slice(0, 10))])].sort();
    const output = ['# Schedule', ''];
    for (const date of dates) {
      output.push('## ' + date, '');
      if (state.days[date]) output.push(attachments(state.days[date]), '');
      for (const idea of state.ideas.filter(item => item.date === date)) {
        const prefix = { note: '• ', todo: '- [ ] ', done: '- [x] ' }[idea.state];
        output.push(prefix + attachments(idea.text).replaceAll('\n', '\n  ') + ideaMetadata(idea, state.projects));
      }
      const dailyEvents = events.filter(item => item.key.startsWith(date + '/'));
      if (dailyEvents.length) {
        output.push('', '### Events / 日程');
        for (const event of dailyEvents) output.push('- ' + event.time + ' ' + event.title.replaceAll('\n', ' '));
      }
      output.push('');
    }
    return output.join('\n') + '\n';
  }

  function parseMarkdown(text, destination) {
    const state = blank();
    let date = destination, current = null, inEvents = false, desktop = false;
    const note = {};
    for (const line of text.replace(/^\uFEFF/, '').replaceAll('\r\n', '\n').split('\n')) {
      if (/^# Schedule(?:\s.*)?$/i.test(line)) continue;
      const heading = /^(#{1,3})\s+(\d{4}-\d{2}-\d{2})(?:\s+·\s+.*)?\s*$/.exec(line);
      if (heading && validDate(heading[2])) {
        date = heading[2]; current = null; inEvents = false; desktop = heading[1] === '#'; continue;
      }
      if (/^#{2,3} (?:Events\b|日程)/.test(line)) {
        current = null; inEvents = true; continue;
      }
      if (inEvents && desktop && /^## /.test(line)) {
        inEvents = false;
        if (line === '## 记录') continue;
      }
      if (inEvents) continue;
      const metadata = current && /^  <!-- schedule:(\S+) -->$/.exec(line);
      if (metadata) {
        try {
          const input = JSON.parse(decodeURIComponent(metadata[1]));
          current.important = input.important === true;
          if (current.state !== 'note' && validDate(input.due)) current.due = input.due;
          if (Array.isArray(input.projects)) current.projects = [...new Set(input.projects.filter(name =>
            typeof name === 'string' && name.trim() && name.length <= 100))].map(name => {
              let project = state.projects.find(row => row.name === name);
              if (!project) { project = { id: key(), name }; state.projects.push(project); }
              return project.id;
            });
          continue;
        } catch { /* Preserve malformed metadata as text. */ }
      }
      const idea = (desktop ? /^(?:• |[-*] (?:\[([ xX])\]\s+)?)(.*)$/ : /^(?:• |[-*] \[([ xX])\]\s+)(.*)$/).exec(line);
      if (idea) {
        current = { id: key(), date, state: idea[1] === undefined ? 'note' : idea[1] === ' ' ? 'todo' : 'done',
          text: idea[2], important: false, due: '', projects: [] };
        state.ideas.push(current);
      } else if (current && /^  \S|^ {2,}$|^  \s/.test(line)) {
        current.text += '\n' + line.slice(2);
      } else {
        current = null;
        (note[date] ||= []).push(line);
      }
    }
    for (const [date, lines] of Object.entries(note)) {
      const body = lines.join('\n').trim();
      if (body) state.days[date] = body;
    }
    return state;
  }

  const api = { validDate, blank, key, calendarDate, heat, exportMarkdown, parseMarkdown };
  if (typeof module === 'object') module.exports = api;
  else root.Journal = api;
})(globalThis);

