'use strict';

const $ = selector => document.querySelector(selector);
const settings = () => call('settings');
const screen = $('#screen'), editor = $('#editor'), preview = $('#preview');
const defaultLocale = navigator.language.startsWith('zh');
let zh = defaultLocale;
const t = (cn, en) => zh ? cn : en;
const today = () => Journal.calendarDate();
let day = today(), month = day.slice(0, 7), tab = 'day', project = null;
let calendarExpanded = false;
let renderVersion = 0, motionRunning = false;
const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const pageOrder = ['day', 'tasks', 'projects', 'sync'];
let state, events, permissions, activeDraft, inlineEditor;
let toastTimer;
const action = (name, value = '') => NativeSchedule.action(name, value);

function call(name, ...parameters) {
  const reply = JSON.parse(NativeSchedule[name](...parameters));
  if (!reply.ok) throw new Error(reply.error || 'Schedule');
  return reply.value;
}

function node(tag, text, className) {
  const item = document.createElement(tag);
  if (text !== undefined) item.textContent = text;
  if (className) item.className = className;
  return item;
}

function button(label, click, className = '') {
  const result = node('button', label, className);
  result.type = 'button';
  result.addEventListener('click', () => {
    try { click(result); } catch (error) { notify(error.message); }
  });
  return result;
}

const paths = {
  day: 'M4 5h16v16H4z M4 9h16 M8 3v4 M16 3v4 M8 13h.01 M12 13h.01 M16 13h.01 M8 17h.01 M12 17h.01',
  tasks: 'M5 4h14v16H5z M8 12l3 3 5-6',
  projects: 'M3 7h7l2 2h9v10H3z M3 7V5h7l2 2h8',
  sync: 'M12 2v20l6-5-12-10 M12 2l6 5-12 10',
  edit: 'M5 15l10-10 4 4-10 10H5z M13 7l4 4',
  checked: 'M5 5h14v14H5z M8 12l3 3 5-6',
  check: 'M5 5h14v14H5z',
  dot: 'M11 12h2'
};

function icon(name) {
  const namespace = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(namespace, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('class', 'icon');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(namespace, 'path');
  path.setAttribute('d', paths[name]);
  svg.append(path);
  return svg;
}

function iconButton(name, label, click, className) {
  const result = button('', click, className);
  result.setAttribute('aria-label', label);
  result.title = label;
  result.append(icon(name));
  return result;
}

function notify(text) {
  const toast = $('#toast');
  toast.textContent = text;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 4200);
}

function save(mutation) {
  const next = JSON.parse(JSON.stringify(state));
  mutation(next);
  call('save', JSON.stringify(next));
  state = next;
}

function heading(text, ...controls) {
  const bar = node('div', undefined, 'section-title');
  const actions = node('div', undefined, 'actions');
  actions.append(...controls);
  bar.append(node('h2', text), actions);
  return bar;
}

function selectTab(value) {
  closeEditor();
  if (tab === 'sync' && value !== 'sync') action('stop');
  tab = value;
  if (tab !== 'projects') project = null;
  render(false);
}

function changeDay(value) {
  if (!Journal.validDate(value)) return;
  day = value; month = day.slice(0, 7);
  selectTab('day');
}

function render(keepScroll = true) {
  renderVersion++;
  const scroll = keepScroll ? screen.scrollTop : 0;
  document.documentElement.lang = zh ? 'zh-CN' : 'en';
  const tabLabels = { day: t('日历', 'Calendar'), tasks: t('待办', 'Tasks'), projects: t('项目', 'Projects'), sync: t('同步', 'Sync') };
  $('#tabs').replaceChildren(...Object.entries(tabLabels).map(([id, label]) => {
    const item = button('', () => switchTab(id));
    item.append(icon(id), node('span', label));
    if (tab === id) item.setAttribute('aria-current', 'page');
    return item;
  }));
  $('#today-label').textContent = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
    month: 'long', day: 'numeric', weekday: 'short'
  }).format(new Date());
  screen.replaceChildren();
  ({ day: renderDay, tasks: renderTasks, projects: renderProjects, sync: renderSync })[tab]();
  screen.scrollTop = scroll;
}

function empty(text) { return node('div', text, 'card empty'); }

function clearMotion(surface) {
  if (!surface) return;
  surface.style.removeProperty('transform');
  surface.style.removeProperty('opacity');
  surface.style.removeProperty('--drag-offset');
  surface.classList.remove('motion-surface');
}

function settleGesture(gesture) {
  if (gesture?.calendarElement) {
    delete gesture.calendarElement.dataset.pull;
    gesture.calendarElement.style.removeProperty('--pull-shift');
  }
  const surface = gesture?.surface;
  if (!surface) return;
  const start = { transform: surface.style.transform || 'translate3d(0,0,0)', opacity: surface.style.opacity || 1 };
  clearMotion(surface);
  if (!reducedMotion()) surface.animate([start, { transform: 'translate3d(0,0,0)', opacity: 1 }],
    { duration: 240, easing: 'cubic-bezier(.2,.8,.2,1)' });
}

async function transitionView(selector, update, direction) {
  if (motionRunning) return;
  const surface = $(selector);
  if (!surface || reducedMotion() || activeDraft || inlineEditor || editor.open) {
    clearMotion(surface); update(); return;
  }
  motionRunning = true;
  const version = renderVersion;
  surface.classList.add('motion-surface');
  try {
    const offset = Math.abs(parseFloat(surface.style.getPropertyValue('--drag-offset')) || 0) + 24;
    const outgoing = surface.animate([
      { transform: surface.style.transform || 'translate3d(0,0,0)', opacity: surface.style.opacity || 1 },
      { transform: `translate3d(${-direction * offset}px,0,0)`, opacity: 0 }
    ], { duration: 110, easing: 'cubic-bezier(.4,0,1,1)', fill: 'forwards' });
    await outgoing.finished;
    clearMotion(surface); outgoing.cancel();
    // A native update or Back action during the animation supersedes this navigation.
    if (renderVersion !== version) return;
    update();
    const incoming = $(selector);
    if (incoming) {
      incoming.classList.add('motion-surface');
      const entering = incoming.animate([
        { transform: `translate3d(${direction * 28}px,0,0)`, opacity: 0 },
        { transform: 'translate3d(0,0,0)', opacity: 1 }
      ], { duration: 240, easing: 'cubic-bezier(.16,1,.3,1)' });
      try { await entering.finished; } finally { clearMotion(incoming); }
    }
  } catch (error) {
    if (error.name !== 'AbortError') notify(error.message);
  } finally {
    clearMotion(surface);
    surface.style.removeProperty('--drag-offset');
    motionRunning = false;
  }
}

function switchTab(value) {
  if (value === tab) return;
  return transitionView('#screen', () => selectTab(value), Math.sign(pageOrder.indexOf(value) - pageOrder.indexOf(tab)));
}

function switchMonth(amount) {
  return transitionView('.month', () => moveMonth(amount), Math.sign(amount));
}

function moveMonth(amount) {
  const date = new Date(month + '-01T12:00:00');
  date.setMonth(date.getMonth() + amount);
  month = Journal.calendarDate(date).slice(0, 7);
  render();
}

function expandCalendar(value) {
  if (calendarExpanded === value) return;
  const height = $('.calendar')?.getBoundingClientRect().height;
  calendarExpanded = value;
  render();
  const calendar = $('.calendar');
  if (height && calendar && !reducedMotion()) {
    calendar.animate([{ height: height + 'px' }, { height: calendar.offsetHeight + 'px' }],
      { duration: 320, easing: 'cubic-bezier(.22,1,.36,1)' });
    calendar.querySelector('.month').animate([{ opacity: .25 }, { opacity: 1 }],
      { duration: 240, easing: 'ease-out' });
  }
}

// Lock each gesture to its starting region. Editors, selected text, images and
// horizontally scrolling formulas keep their native touch behavior.
let swipe, ignoreClickUntil = 0;
const calendarPullReady = gesture => {
  const distance = Math.abs(gesture.dy);
  return (!gesture.expanded || gesture.collapseControl) && (gesture.dy > 0) !== gesture.expanded &&
    (distance >= 34 || (distance >= 18 && distance / Math.max(1, gesture.elapsed) >= .35));
};
const navigationBusy = () => motionRunning || activeDraft || inlineEditor || editor.open || preview.open || $('#application').inert;
screen.addEventListener('touchstart', event => {
  settleGesture(swipe);
  swipe = null;
  if (event.touches.length !== 1 || navigationBusy() || String(getSelection()).length) return;
  if (event.target.closest('input, textarea, select, [contenteditable], a, .inline-link, .note-image, .katex-display')) return;
  const touch = event.touches[0];
  let calendarElement = event.target.closest('.calendar');
  // Collapsing animates the card height. Its temporarily empty area is not a
  // date/header hit and must not steal the next page swipe.
  if (calendarElement === event.target && calendarElement.getAnimations().length) calendarElement = null;
  swipe = { x: touch.clientX, y: touch.clientY, dx: 0, dy: 0, started: event.timeStamp, elapsed: 0,
    expanded: calendarExpanded, calendar: !!calendarElement, calendarElement,
    collapseControl: !!event.target.closest('.calendar header, .calendar-toggle'), axis: null };
}, { passive: true });
screen.addEventListener('touchmove', event => {
  if (!swipe) return;
  if (event.touches.length !== 1 || navigationBusy()) { settleGesture(swipe); swipe = null; return; }
  swipe.dx = event.touches[0].clientX - swipe.x;
  swipe.dy = event.touches[0].clientY - swipe.y;
  swipe.elapsed = event.timeStamp - swipe.started;
  const x = Math.abs(swipe.dx), y = Math.abs(swipe.dy);
  if (!swipe.axis && Math.max(x, y) >= (swipe.calendar ? 6 : 12)) {
    if (swipe.calendar) {
      // Claim calendar pulls on the first meaningful move, before WebView starts
      // native scrolling. Diagonal pulls favor vertical; clear sideways swipes own months.
      if (x > y * 1.25) swipe.axis = 'horizontal';
      // Once expanded, date cells belong to native scrolling. Only the explicit
      // header/handle can collapse the calendar, never a content-browsing swipe.
      else swipe.axis = (!swipe.expanded || swipe.collapseControl) &&
        (swipe.dy > 0) !== swipe.expanded ? 'calendar' : 'scroll';
    } else if (x > y * 1.35) swipe.axis = 'horizontal';
    else if (y > x * 1.35) swipe.axis = 'scroll';
  }
  if (swipe.axis === 'horizontal' || swipe.axis === 'calendar') {
    if (event.cancelable) event.preventDefault();
    else { settleGesture(swipe); swipe = null; return; }
    if (swipe.axis === 'calendar' && !reducedMotion() && !swipe.frame) {
      const gesture = swipe;
      gesture.frame = requestAnimationFrame(() => {
        gesture.frame = null;
        if (swipe !== gesture) return;
        gesture.calendarElement.dataset.pull = calendarPullReady(gesture) ? 'ready' : 'tracking';
        gesture.calendarElement.style.setProperty('--pull-shift', `${Math.max(-6, Math.min(6, gesture.dy * .16))}px`);
      });
    }
    if (swipe.axis === 'horizontal' && !reducedMotion()) {
      const gesture = swipe;
      if (!gesture.surface) {
        gesture.surface = gesture.calendar ? $('.month') : screen;
        gesture.surface.getAnimations().forEach(animation => animation.cancel());
        gesture.surface.classList.add('motion-surface');
      }
      if (!gesture.frame) gesture.frame = requestAnimationFrame(() => {
        gesture.frame = null;
        if (swipe !== gesture) return;
        const shift = Math.sign(gesture.dx) * Math.min(84, Math.abs(gesture.dx) * .32);
        gesture.surface.style.transform = `translate3d(${shift}px,0,0)`;
        gesture.surface.style.opacity = String(1 - Math.min(.18, Math.abs(shift) / 460));
        gesture.surface.style.setProperty('--drag-offset', shift);
      });
    }
  }
}, { passive: false });
screen.addEventListener('touchcancel', () => { settleGesture(swipe); swipe = null; });
screen.addEventListener('touchend', event => {
  const gesture = swipe; swipe = null;
  if (!gesture || navigationBusy() || event.touches.length) { settleGesture(gesture); return; }
  if (gesture.axis !== 'horizontal' && gesture.axis !== 'calendar') return;
  // Prevent a completed drag from also clicking a date or project row.
  ignoreClickUntil = performance.now() + 450;
  if (event.cancelable) event.preventDefault();
  if (gesture.axis === 'calendar') {
    const last = event.changedTouches[0];
    if (last) gesture.dy = last.clientY - gesture.y;
    gesture.elapsed = event.timeStamp - gesture.started;
    settleGesture(gesture);
    if (calendarPullReady(gesture)) expandCalendar(gesture.dy > 0);
  } else if (Math.abs(gesture.dx) >= 56) {
    const direction = gesture.dx < 0 ? 1 : -1;
    if (gesture.calendar) switchMonth(direction);
    else {
      const next = pageOrder[pageOrder.indexOf(tab) + direction];
      if (next) switchTab(next);
      else settleGesture(gesture);
    }
  } else settleGesture(gesture);
}, { passive: false });
screen.addEventListener('click', event => {
  if (event.detail && performance.now() < ignoreClickUntil) {
    event.preventDefault(); event.stopImmediatePropagation();
  }
}, true);

function calendarItems() {
  const days = new Map();
  const add = (date, item) => {
    if (!days.has(date)) days.set(date, []);
    days.get(date).push(item);
  };
  const excerpt = text => text.replace(/!\[[^\]]*\]\([^)]+\)/g, t('图片', 'Image'))
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[*#`~]/g, '').replace(/\s+/g, ' ').trim();
  for (const event of events.events) add(event.key.slice(0, 10), {
    title: event.title, time: event.time, kind: 'event', done: event.done, important: event.important
  });
  for (const idea of state.ideas) add(idea.state !== 'note' && idea.due ? idea.due : idea.date, {
    title: excerpt(idea.text), time: '', kind: idea.state === 'note' ? 'idea' : 'task',
    done: idea.state === 'done', important: idea.important
  });
  for (const [date, text] of Object.entries(state.days)) {
    if (text.trim()) add(date, { title: excerpt(text), time: '', kind: 'note', done: false, important: false });
  }
  const order = { event: 0, task: 1, idea: 2, note: 3 };
  for (const items of days.values()) items.sort((a, b) => Number(a.done) - Number(b.done) ||
    Number(b.important) - Number(a.important) || order[a.kind] - order[b.kind] || a.time.localeCompare(b.time));
  return days;
}

function renderCalendar() {
  const calendar = node('section', undefined, 'calendar card');
  calendar.classList.toggle('is-expanded', calendarExpanded);
  const bar = node('header');
  const monthDate = new Date(month + '-01T12:00:00');
  const previous = button('‹', () => switchMonth(-1), 'quiet');
  previous.setAttribute('aria-label', t('上个月', 'Previous month'));
  const next = button('›', () => switchMonth(1), 'quiet');
  next.setAttribute('aria-label', t('下个月', 'Next month'));
  const title = button('', () => expandCalendar(!calendarExpanded), 'calendar-title quiet');
  title.setAttribute('aria-expanded', String(calendarExpanded));
  title.setAttribute('aria-controls', 'calendar-dates');
  title.setAttribute('aria-label', calendarExpanded ? t('收起日历', 'Collapse calendar') : t('展开日历', 'Expand calendar'));
  title.append(node('h2', new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
    month: 'long', year: 'numeric'
  }).format(monthDate)), node('span', undefined, 'calendar-chevron'));
  bar.append(previous, title, next);
  const grid = node('div', undefined, 'month');
  grid.id = 'calendar-dates';
  for (const name of t('一 二 三 四 五 六 日', 'M T W T F S S').split(' ')) grid.append(node('span', name, 'week'));
  const counts = {};
  for (const item of state.ideas) counts[item.date] = (counts[item.date] || 0) + 1;
  const maximum = Math.max(0, ...Object.entries(counts).filter(([date]) => date.startsWith(month)).map(([, count]) => count));
  const datesWithEvents = new Set(events.events.map(event => event.key.slice(0, 10)));
  const days = new Date(monthDate.getFullYear(), monthDate.getMonth() + 1, 0).getDate();
  const start = calendarExpanded ? monthDate : new Date((day.startsWith(month) ? day : month + '-01') + 'T12:00:00');
  const offset = (start.getDay() + 6) % 7;
  const cells = calendarExpanded ? Math.ceil((days + offset) / 7) * 7 : 7;
  grid.style.setProperty('--weeks', cells / 7);
  const entries = calendarExpanded ? calendarItems() : new Map();
  start.setDate(start.getDate() - offset);
  for (let i = 0; i < cells; i++) {
    const date = Journal.calendarDate(start);
    const count = counts[date] || 0;
    const cell = button('', () => {
      day = date; month = date.slice(0, 7); render();
      if (calendarExpanded) $('#day-details').scrollIntoView({ block: 'start',
        behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, 'cell');
    cell.append(node('span', String(start.getDate()), 'day-number'));
    if (!date.startsWith(month)) cell.classList.add('outside-month');
    cell.dataset.date = date;
    if (date === today()) cell.classList.add('today');
    cell.setAttribute('aria-pressed', String(date === day));
    cell.setAttribute('aria-label', t(date + '，' + count + ' 条想法', date + ', ' + count + ' ideas'));
    cell.dataset.heat = Journal.heat(count, maximum);
    if (calendarExpanded) {
      const items = entries.get(date) || [];
      const summary = node('span', undefined, 'day-summary');
      for (const item of items.slice(0, 2)) {
        const row = node('span', undefined, 'calendar-entry ' + item.kind + (item.done ? ' done' : '') + (item.important ? ' important' : ''));
        if (item.time) row.append(node('span', item.time, 'entry-time'));
        row.append(node('span', item.title, 'entry-title'));
        summary.append(row);
      }
      if (items.length > 2) summary.append(node('span', '+' + (items.length - 2), 'calendar-more'));
      cell.append(summary);
      cell.setAttribute('aria-label', date + t('，', ', ') + (items.length
        ? items.map(item => [item.time, item.title, item.done ? t('已完成', 'Done') : ''].filter(Boolean).join(' ')).join(t('；', '; '))
        : t('暂无事项', 'No items')));
    } else if (datesWithEvents.has(date)) cell.append(node('i'));
    grid.append(cell);
    start.setDate(start.getDate() + 1);
  }
  const toggle = button('', () => expandCalendar(!calendarExpanded), 'calendar-toggle quiet');
  toggle.setAttribute('aria-expanded', String(calendarExpanded));
  toggle.setAttribute('aria-controls', grid.id);
  toggle.setAttribute('aria-label', calendarExpanded ? t('收起日历', 'Collapse calendar') : t('展开日历', 'Expand calendar'));
  toggle.append(node('span', undefined, 'calendar-grip'));
  calendar.append(bar, grid, toggle);
  return calendar;
}

function renderDay() {
  screen.append(renderCalendar());
  const selected = new Intl.DateTimeFormat(zh ? 'zh-CN' : 'en', {
    month: 'long', day: 'numeric', weekday: 'short'
  }).format(new Date(day + 'T12:00:00'));
  const detailHeading = heading(selected,
    button(t('记笔记', 'Note'), openDaily),
    button(t('＋ 想法', '+ Idea'), () => openIdea(null), 'primary'));
  detailHeading.id = 'day-details';
  screen.append(detailHeading);
  const text = state.days[day];
  if (text) {
    const card = node('div', undefined, 'card item');
    const body = node('div', undefined, 'item-content');
    rich(body, text);
    card.append(body, iconButton('edit', t('编辑当天笔记', 'Edit day note'), openDaily, 'quiet'));
    screen.append(card);
  }
  const local = state.ideas.filter(item => item.date === day || (item.state !== 'note' && item.due === day));
  for (const item of local) screen.append(ideaCard(item, item.date !== day));
  if (!text && !local.length) screen.append(empty(t('选中的日期还没有记录。', 'No notes for this date.')));
  screen.append(heading(t('日程', 'Events'), button(t('＋ 日程', '+ Event'), () => openEvent(null))));
  const rows = events.events.filter(event => event.key.startsWith(day + '/')).sort((a, b) => a.at - b.at);
  for (const event of rows) screen.append(eventCard(event));
  if (!rows.length) screen.append(empty(t('这一天没有日程。', 'No events for this date.')));
}

function meta(parent, text, danger = false) {
  parent.append(node('span', text, 'tag' + (danger ? ' warn' : '')));
}

function ideaCard(item, showDate) {
  const card = node('article', undefined, 'card item' + (item.state === 'done' ? ' complete' : ''));
  const content = node('div', undefined, 'item-content');
  const body = node('div', undefined, 'body');
  rich(body, item.text);
  content.append(body);
  const badges = node('div', undefined, 'meta');
  if (showDate) badges.append(button(item.date, () => changeDay(item.date), 'inline-link'));
  if (item.important) meta(badges, t('重要', 'Important'));
  if (item.due) meta(badges, t('截止 ', 'Due ') + item.due, item.due < today() && item.state !== 'done');
  for (const id of item.projects) {
    const p = state.projects.find(project => project.id === id);
    if (p) meta(badges, p.name);
  }
  if (badges.childNodes.length) content.append(badges);
  const tools = node('div', undefined, 'item-tools');
  tools.append(iconButton('edit', t('编辑想法', 'Edit idea'), () => openIdea(item, card), 'quiet'));
  if (item.state !== 'note') {
    card.append(iconButton(item.state === 'done' ? 'checked' : 'check',
      item.state === 'done' ? t('重新打开待办', 'Reopen task') : t('完成待办', 'Complete task'), () => {
        save(next => {
          const row = next.ideas.find(idea => idea.id === item.id);
          row.state = row.state === 'done' ? 'todo' : 'done';
        });
        render();
      }, 'check quiet'));
  }
  card.append(content, tools);
  return card;
}

function eventCard(event) {
  const card = node('article', undefined, 'card item' + (event.done ? ' complete' : ''));
  const detail = node('div', undefined, 'item-content');
  const title = node('div', undefined, 'body');
  title.append(node('span', event.time + '  ', 'event-time'), document.createTextNode(event.title));
  const badges = node('div', undefined, 'meta');
  if (event.important) meta(badges, t('重要', 'Important'));
  if (event.minutes >= 0 && !event.done) meta(badges, event.minutes === 0 ? t('准时提醒', 'At start') : t('提前 ', '') + event.minutes + t(' 分钟', ' min early'));
  if (event.pending) meta(badges, t('待同步', 'Pending'));
  if (event.locked) meta(badges, t('在 Windows 编辑', 'Edit in Windows'));
  detail.append(title);
  if (badges.childNodes.length) detail.append(badges);
  card.append(detail);
  if (!event.locked) {
    const tools = node('div', undefined, 'item-tools');
    tools.append(iconButton('edit', t('编辑日程', 'Edit event'), () => openEvent(event), 'quiet'));
    card.append(tools);
  }
  return card;
}

function renderTasks() {
  const list = state.ideas.filter(item => item.state !== 'note').sort((a, b) =>
    Number(a.state === 'done') - Number(b.state === 'done') ||
    Number(b.important) - Number(a.important) ||
    (a.due || '9999').localeCompare(b.due || '9999') || b.date.localeCompare(a.date));
  screen.append(heading(t('待办', 'Tasks'), button(t('＋ 待办', '+ Task'), () => openIdea(null, null, true), 'primary')));
  for (const item of list) screen.append(ideaCard(item, true));
  if (!list.length) screen.append(empty(t('还没有待办。', 'No tasks yet.')));
}

function projectItems(id) {
  return state.ideas.filter(item => id === 'unbound' ? !item.projects.length : item.projects.includes(id));
}

function renderProjects() {
  const name = project === 'unbound' ? t('未绑定', 'Unassigned') : state.projects.find(p => p.id === project)?.name;
  if (name) {
    const controls = [button(t('‹ 项目', '‹ Projects'), () => { closeEditor(); project = null; render(false); }, 'quiet'),
      button(t('＋ 想法', '+ Idea'), () => openIdea(null), 'primary')];
    if (project !== 'unbound') controls.splice(1, 0, button(t('编辑', 'Edit'), () => editProject(project), 'quiet'));
    screen.append(heading(name, ...controls));
    const items = projectItems(project).sort((a, b) => b.date.localeCompare(a.date));
    for (const item of items) screen.append(ideaCard(item, true));
    if (!items.length) screen.append(empty(t('还没有绑定的想法。', 'No linked ideas yet.')));
    return;
  }
  screen.append(heading(t('项目', 'Projects'), button(t('＋ 项目', '+ Project'), () => editProject(null), 'primary')));
  const remaining = id => projectItems(id).filter(item => item.state === 'todo').length;
  const list = [...state.projects].sort((a, b) => remaining(b.id) - remaining(a.id) || a.name.localeCompare(b.name));
  list.push({ id: 'unbound', name: t('未绑定', 'Unassigned') });
  for (const row of list) {
    const open = button('', () => { project = row.id; render(false); }, 'project-row');
    open.append(node('strong', row.name), node('small', remaining(row.id) + t(' 项待办  ›', ' open tasks  ›')));
    screen.append(open);
  }
}

const imagePattern = /^(?:[a-f0-9-]{36}|[a-f0-9]{64})\.(png|jpeg|gif|webp|avif|bmp|heic|heif)$/;
const referencePattern = /!\[([^\]\n]*)\]\(schedule-image:([a-f0-9-]+\.[a-z]+)\)|\[([^\]\n]*)\]\(schedule-document:([a-f0-9-]+)\)/g;
function rich(parent, text) {
  let end = 0;
  for (const match of text.matchAll(referencePattern)) {
    markup(parent, text.slice(end, match.index));
    end = match.index + match[0].length;
    if (match[2] && imagePattern.test(match[2])) {
      const show = button('', () => showImage(match[2]), 'note-image');
      show.setAttribute('aria-label', t('查看图片', 'View image'));
      const image = node('img');
      image.src = '/image/' + match[2];
      image.alt = match[1] || t('图片', 'Image');
      image.loading = 'lazy';
      show.append(image);
      parent.append(show);
    } else if (state.docs[match[4]]) {
      const ref = state.docs[match[4]];
      parent.append(button(ref.name, () => action('reference', ref.uri), 'inline-link'));
    } else parent.append(document.createTextNode(match[0]));
  }
  markup(parent, text.slice(end));
}

function markup(parent, text) {
  for (const part of window.ScheduleContent.parts(text)) {
    if (part.kind === 'math' && window.katex) {
      const span = node('span');
      try {
        katex.render(part.tex, span, { displayMode: part.display, throwOnError: false, trust: false, maxExpand: 500, maxSize: 15 });
        parent.append(span);
      } catch { parent.append(document.createTextNode(part.text)); }
    } else if (part.kind === 'url') {
      parent.append(button(part.text, () => action('link', part.url), 'inline-link'));
    } else if (part.kind === 'image') {
      parent.append(document.createTextNode('▧'));
    } else {
      const value = part.text;
      const tokens = /\*\*([^*\n]+)\*\*|~~([^~\n]+)~~|`([^`\n]+)`|\*([^*\n]+)\*/g;
      let end = 0;
      for (const match of value.matchAll(tokens)) {
        parent.append(document.createTextNode(value.slice(end, match.index)));
        const index = match.slice(1).findIndex(chunk => chunk !== undefined);
        parent.append(node(['strong', 's', 'code', 'em'][index], match[index + 1]));
        end = match.index + match[0].length;
      }
      parent.append(document.createTextNode(value.slice(end)));
    }
  }
}

function showImage(id) {
  const image = node('img');
  image.src = '/image/' + id;
  image.alt = '';
  preview.replaceChildren(image);
  preview.showModal();
  const touches = new Map();
  let scale = 1, x = 0, y = 0, moved = false;
  const transform = () => {
    const maxX = Math.max(0, (image.offsetWidth * scale - preview.clientWidth) / 2);
    const maxY = Math.max(0, (image.offsetHeight * scale - preview.clientHeight) / 2);
    x = Math.max(-maxX, Math.min(maxX, x));
    y = Math.max(-maxY, Math.min(maxY, y));
    image.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + scale + ')';
  };
  const measure = points => points.length === 2
    ? [(points[0][0] + points[1][0]) / 2, (points[0][1] + points[1][1]) / 2,
      Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1])]
    : [...points[0], 0];
  preview.onpointerdown = event => {
    if (!touches.size) moved = false;
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    if (touches.size > 1) moved = true;
    event.target.setPointerCapture(event.pointerId);
  };
  preview.onpointermove = event => {
    if (!touches.has(event.pointerId)) return;
    const before = measure([...touches.values()].slice(0, 2));
    touches.set(event.pointerId, [event.clientX, event.clientY]);
    const after = measure([...touches.values()].slice(0, 2));
    if (Math.hypot(after[0] - before[0], after[1] - before[1]) > 2 || touches.size > 1) moved = true;
    if (touches.size >= 2 && before[2] > 0) {
      const target = Math.max(1, Math.min(8, scale * after[2] / before[2]));
      const ratio = target / scale;
      const midX = preview.clientWidth / 2, midY = preview.clientHeight / 2;
      x = after[0] - midX - ratio * (before[0] - midX - x);
      y = after[1] - midY - ratio * (before[1] - midY - y);
      scale = target;
    } else { x += after[0] - before[0]; y += after[1] - before[1]; }
    transform();
  };
  preview.onpointerup = event => {
    touches.delete(event.pointerId);
    if (!moved && !touches.size && event.target === preview) preview.close();
  };
  preview.onpointercancel = event => { touches.delete(event.pointerId); moved = true; };
}

function field(label, input) {
  const outer = node('label', undefined, 'field');
  outer.append(node('span', label), input);
  return outer;
}

function input(type, value, attributes = {}) {
  const element = node('input');
  element.type = type;
  element.value = value;
  for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
  return element;
}

function select(options, current) {
  const element = node('select');
  for (const [key, label] of options) {
    const option = node('option', label);
    option.value = key;
    element.append(option);
  }
  element.value = String(current);
  return element;
}

function tick(label, checked) {
  const toggle = input('checkbox', '1');
  toggle.checked = checked;
  const wrapper = node('label', undefined, 'tick');
  wrapper.append(toggle, node('span', label));
  return [wrapper, toggle];
}

function closeEditor() {
  activeDraft = null;
  if (editor.open) editor.close();
  if (inlineEditor) { inlineEditor = null; render(); }
}

function form(title, fields, onSave, onDelete, inline) {
  closeEditor();
  const content = node('form');
  const error = node('div', undefined, 'error');
  error.setAttribute('role', 'alert');
  const controls = node('div', undefined, 'editor-actions');
  if (onDelete) controls.append(button(t('删除', 'Delete'), () => {
    if (!window.confirm(t('删除这条记录？', 'Delete this entry?'))) return;
    try { onDelete(); closeEditor(); render(); } catch (failure) { error.textContent = failure.message; }
  }, 'danger'));
  controls.append(button(t('取消', 'Cancel'), closeEditor, 'quiet'));
  const submit = node('button', t('保存', 'Save'), 'primary');
  submit.type = 'submit'; controls.append(submit);
  content.append(...fields, error, controls);
  content.addEventListener('submit', event => {
    event.preventDefault();
    try { onSave(); closeEditor(); render(); } catch (failure) { error.textContent = failure.message; }
  });
  if (inline && inline.isConnected) {
    inlineEditor = inline;
    inline.classList.remove('item', 'complete');
    inline.replaceChildren(node('h3', title), content);
    inline.scrollIntoView({ block: 'nearest' });
  } else {
    editor.replaceChildren(node('h2', title), content);
    editor.showModal();
  }
}

function textEditor(text) {
  const area = node('textarea');
  area.value = text;
  area.rows = 5;
  const insert = text => {
    area.setRangeText(text, area.selectionStart, area.selectionEnd, 'end');
    area.focus();
  };
  const toolbar = node('div', undefined, 'toolbar');
  const wrap = marker => {
    const content = area.value.slice(area.selectionStart, area.selectionEnd);
    insert(marker + content + marker);
  };
  const shift = out => {
    const edit = ScheduleContent.indent(area.value, area.selectionStart, area.selectionEnd, out);
    for (const change of [...edit.edits].reverse()) area.setRangeText(change.text, change.start, change.end);
    area.focus();
    area.setSelectionRange(edit.start, edit.end);
  };
  toolbar.append(button(t('粗体', 'Bold'), () => wrap('**')),
    button(t('斜体', 'Italic'), () => wrap('*')),
    button('TeX', () => {
      const content = area.value.slice(area.selectionStart, area.selectionEnd);
      insert('\\(' + content + '\\)');
    }),
    button(t('缩进', 'Indent'), () => shift(false)),
    button(t('减少缩进', 'Outdent'), () => shift(true)),
    button(t('图片', 'Image'), () => action('image')),
    button(t('粘贴图', 'Paste image'), () => action('pasteImage')),
    button(t('关联文件', 'Link file'), () => action('file')),
    button(t('关联目录', 'Link folder'), () => action('folder')));
  const refs = node('div', undefined, 'row');
  for (const match of text.matchAll(referencePattern)) {
    if (match[2] && imagePattern.test(match[2])) refs.append(button(t('另存原图', 'Save original image'), () => action('saveImage', match[2]), 'quiet'));
  }
  area.addEventListener('paste', event => {
    const item = Array.from(event.clipboardData?.items || []).find(item => item.kind === 'file' && item.type.startsWith('image/'));
    if (!item) return;
    const file = item.getAsFile();
    if (!file) return;
    event.preventDefault();
    if (file.size > 64 * 1024 * 1024) { notify(t('图片超过 64 MiB。', 'Image exceeds 64 MiB.')); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try { attachImage(call('pasteBytes', reader.result.split(',')[1], file.type)); }
      catch (error) { notify(error.message); }
    };
    reader.readAsDataURL(file);
  });
  return { area, fields: [field(t('正文', 'Text'), area), toolbar, refs], insert, docs: {} };
}

function attachImage(id) {
  if (!activeDraft || !imagePattern.test(id)) return;
  activeDraft.insert('\n![' + t('图片', 'Image') + '](schedule-image:' + id + ')\n');
}

function openDaily() {
  const draft = textEditor(state.days[day] || '');
  form(t('当天笔记', 'Day note'), draft.fields, () => {
    save(next => {
      const value = draft.area.value.trim();
      if (value) next.days[day] = value; else delete next.days[day];
      Object.assign(next.docs, draft.docs);
    });
  });
  activeDraft = draft;
  draft.area.focus();
}

function openIdea(item, inline, task = false) {
  const date = item?.date || day;
  const draft = textEditor(item?.text || '');
  draft.area.required = true;
  const stateSelect = select([['note', t('想法', 'Idea')], ['todo', t('待办', 'Task')], ['done', t('已完成', 'Done')]],
    item?.state || (task ? 'todo' : 'note'));
  const [importance, important] = tick(t('重要', 'Important'), !!item?.important);
  const due = input('date', item?.due || '');
  const dueField = field(t('截止日期', 'Due date'), due);
  dueField.hidden = stateSelect.value === 'note';
  stateSelect.addEventListener('change', () => { dueField.hidden = stateSelect.value === 'note'; });
  const binding = node('fieldset');
  binding.append(node('legend', t('绑定项目', 'Projects')));
  const checkboxes = state.projects.map(p => {
    const [label, check] = tick(p.name, item ? item.projects.includes(p.id) : project === p.id);
    binding.append(label);
    return [p.id, check];
  });
  form(item ? t('编辑想法', 'Edit idea') : task ? t('新待办', 'New task') : t('新想法', 'New idea'),
    [...draft.fields, field(t('类型', 'Type'), stateSelect), importance, dueField, ...(checkboxes.length ? [binding] : [])], () => {
      const text = draft.area.value.trim();
      if (!text) throw new Error(t('请输入正文。', 'Enter some text.'));
      const record = { id: item?.id || Journal.key(), date, text, state: stateSelect.value, important: important.checked,
        due: stateSelect.value === 'note' ? '' : due.value, projects: checkboxes.filter(([, check]) => check.checked).map(([id]) => id) };
      save(next => {
        const index = next.ideas.findIndex(idea => idea.id === record.id);
        if (index >= 0) next.ideas[index] = record; else next.ideas.push(record);
        Object.assign(next.docs, draft.docs);
      });
    }, item ? () => { save(next => { next.ideas = next.ideas.filter(idea => idea.id !== item.id); }); } : undefined, inline);
  activeDraft = draft;
  draft.area.focus();
}

function editProject(id) {
  const item = state.projects.find(p => p.id === id);
  const name = input('text', item?.name || '', { required: '', maxlength: '100' });
  form(item ? t('编辑项目', 'Edit project') : t('新项目', 'New project'), [field(t('名称', 'Name'), name)], () => {
    const title = name.value.trim();
    if (!title) throw new Error(t('请输入项目名称。', 'Enter a project name.'));
    save(next => {
      if (item) next.projects.find(p => p.id === id).name = title;
      else next.projects.push({ id: Journal.key(), name: title });
    });
  }, item ? () => {
    save(next => {
      next.projects = next.projects.filter(p => p.id !== id);
      for (const idea of next.ideas) idea.projects = idea.projects.filter(value => value !== id);
    });
    project = null;
  } : undefined);
  name.focus();
}

function openEvent(event) {
  const date = event?.key.slice(0, 10) || day;
  const key = event?.key || date + '/android-' + Journal.key();
  const title = input('text', event?.title || '', { required: '', maxlength: '100' });
  const time = input('time', event?.time || '09:00', { required: '' });
  const reminders = select([[-1, t('不提醒', 'Off')], [0, t('准时', 'At start')],
    ...[5, 15, 30, 60].map(min => [min, t('提前 ' + min + ' 分钟', min + ' min early')])], event?.minutes ?? -1);
  const [importantLabel, important] = tick(t('重要', 'Important'), !!event?.important);
  const [doneLabel, done] = tick(t('已完成', 'Done'), !!event?.done);
  const scopes = select([['local', t('仅此手机', 'This phone')], ['remote', t('同步到 Windows', 'Sync to Windows')]],
    event?.scope || (events.source ? 'remote' : 'local'));
  const fields = [field(t('名称', 'Title'), title), field(date, time),
    field(t('提醒', 'Reminder'), reminders), importantLabel, doneLabel];
  if (!state._sync && !event && events.source) fields.push(field(t('保存到', 'Save to'), scopes));
  form(event ? t('编辑日程', 'Edit event') : t('新日程', 'New event'), fields, () => {
    const value = title.value.trim();
    if (!value) throw new Error(t('请输入日程名称。', 'Enter an event title.'));
    const local = new Date(date + 'T' + time.value + ':00');
    const at = event?.time === time.value ? event.at : +local;
    if (!Number.isFinite(at) || (event?.time !== time.value &&
        (local.getHours() !== Number(time.value.slice(0, 2)) || local.getMinutes() !== Number(time.value.slice(3))))) {
      throw new Error(t('此时间在当前时区无效。', 'This time is invalid in the current time zone.'));
    }
    const minutes = Number(reminders.value);
    if (!done.checked && minutes >= 0 && at - minutes * 60000 <= Date.now()
        && (!event || event.at !== at || event.minutes !== minutes || event.done)) {
      throw new Error(t('请选择未来的提醒时间，或关闭提醒。', 'Choose a future reminder time or turn it off.'));
    }
    const update = { key, title: value, time: time.value, at, minutes, important: important.checked, done: done.checked, locked: false };
    events = call('event', event?.scope || scopes.value, key, JSON.stringify(update));
  }, event ? () => { events = call('event', event.scope, key, ''); } : undefined);
  title.focus();
}

function renderSync() {
  permissions = settings();
  screen.append(heading(t('蓝牙同步', 'Bluetooth sync')));
  const sync = node('section', undefined, 'card');
  sync.append(node('p', t('双向同步笔记、想法、项目名称与绑定、原图及全部日程。外部文件与文件夹留在原设备。', 'Sync notes, ideas, project names and bindings, original images and all events in both directions. External files and folders stay on their device.'), 'muted'));
  const stateLabel = permissions.status || 'idle';
  const connected = !['idle'].includes(stateLabel) && !stateLabel.startsWith('error:');
  const ports = permissions.paired || [];
  const paired = select([['', t('选择已配对的电脑', 'Choose a paired PC')],
    ...ports.map(device => [device.address, device.name || device.address])], '');
  try { paired.value = sessionStorage.getItem('peer') || ''; } catch {}
  const connect = button(t('等待电脑连接', 'Wait for Windows'), () => {
    if (!paired.value) { notify(t('请选择电脑。', 'Choose a computer.')); return; }
    try { sessionStorage.setItem('peer', paired.value); } catch {}
    action('sync', paired.value);
  }, 'primary');
  if (!permissions.bluetoothPermission) sync.append(button(t('允许附近设备', 'Allow Nearby devices'), () => action('bluetoothPermission'), 'primary'));
  else if (permissions.bluetooth) sync.append(field(t('电脑', 'Computer'), paired), connected ? button(t('停止等待', 'Stop listening'), () => action('stop')) : connect);
  else sync.append(node('p', t('蓝牙不可用或未开启。', 'Bluetooth is unavailable or turned off.')));
  sync.append(button(t('系统蓝牙设置', 'Bluetooth settings'), () => action('bluetoothSettings'), 'quiet'));
  if(!permissions.wifiPermission)sync.append(button(t('允许 Wi-Fi 直连加速', 'Allow direct Wi-Fi transfer'),()=>action('wifiPermission'),'quiet'));
  sync.append(node('p',t('蓝牙自动交换连接信息，优先使用局域网，必要时建立临时热点。电脑会暂时切换 Wi-Fi，结束后恢复。原图只补传缺失部分。','Bluetooth exchanges connection details automatically. Use LAN when reachable, otherwise a temporary hotspot. The PC may temporarily switch Wi-Fi and restore it afterward. Only missing original images are transferred.'),'muted'));
  const status = {
    starting: t('正在打开蓝牙服务…', 'Opening Bluetooth service…'),
    waiting: t('已在等待，请在 Windows 端点击「双向同步」。', 'Waiting. Click Two-way sync on Windows.'),
    syncing: t('正在同步…', 'Syncing…'),
    'wifi-setup':t('正在建立临时 Wi-Fi 直连…','Creating a temporary direct Wi-Fi connection…'),
    'wifi-transfer':t('正在通过加密 Wi-Fi 同步…','Syncing over encrypted Wi-Fi…'),
    'bluetooth-transfer':t('Wi-Fi 不可用，继续通过蓝牙同步。','Wi-Fi unavailable. Continuing over Bluetooth.'),
    synced: t('已同步，可继续接收下一次同步。', 'Synced. Ready for another sync.'),
    review: t('同步已暂停，两端数据未修改。请在电脑确认冲突，然后继续同步。', 'Sync paused. Both devices are unchanged. Review conflicts on Windows, then resume sync.'),
    legacy: t('电脑为旧版：仅共享日程已同步，笔记和手机本地日程尚未同步。', 'Older Windows app: shared events only. Notes and phone-only events were not synced.'),
    idle: t('先在系统设置配对。在此选择电脑后，再用 Windows 配套程序发起同步。', 'Pair in system settings, select the PC here, and start sync from the Windows companion.')
  };
  const imageProgress=/^images-(send|receive):([^:]+):(\d+)\/(\d+)$/.exec(stateLabel);
  const progressText=imageProgress?`${imageProgress[1]==='send'?t('发送原图','Sending originals'):t('接收原图','Receiving originals')} ${imageProgress[2]} · ${(Number(imageProgress[3])/1048576).toFixed(1)}/${(Number(imageProgress[4])/1048576).toFixed(1)} MiB`:null;
  sync.append(node('p', progressText || status[stateLabel] || stateLabel.replace(/^error:/,''), stateLabel.startsWith('error:') ? 'error' : 'muted'));
  if (events.lastSync) sync.append(node('p', t('上次同步 ', 'Last sync ') + new Date(events.lastSync).toLocaleString()));
  if (events.pending) sync.append(node('p', t('手机待同步改动 ', 'Pending phone changes ') + events.pending));
  if (events.retry) sync.append(node('p', t('上次未写入 ', 'Last unapplied change ') + events.retry, 'muted'));
  if (!state._sync && events.source && !events.pending) sync.append(button(t('解除日程来源关联', 'Unlink Windows source'), () => {
    if (!window.confirm(t('移除此手机上的 Windows 日程及其提醒？', 'Remove Windows events and their reminders from this phone?'))) return;
    action('stop'); events = call('unlink'); render();
  }, 'quiet'));
  screen.append(sync);
  for (const [key, conflict] of Object.entries(state._sync?.conflicts || {})) {
    const card=node('section',undefined,'card');
    const describe=value=>value===null?t('已删除','Deleted'):value.text||value.title||value.name||key;
    card.append(node('strong',t('两端都修改过，选择保留版本','Changed on both devices — choose a version')),
      node('p',key),node('p',t('手机：','Phone: ')+describe(conflict.phone)),node('p',t('电脑：','Windows: ')+describe(conflict.desktop)),
      button(t('保留手机版本','Keep phone version'),()=>resolveJournalConflict(key,false)),
      button(t('采用电脑版本','Use Windows version'),()=>resolveJournalConflict(key,true)));
    screen.append(card);
  }
  for (const conflict of events.conflicts) {
    const item = node('div', undefined, 'card');
    item.append(node('strong', t('需要处理的日程改动', 'Event conflict')),
      node('p', t('手机 ', 'Phone ') + (conflict.value ? conflict.value.time + ' · ' + conflict.value.title : t('删除', 'Delete'))),
      node('p', t('Windows ', 'Windows ') + (conflict.windows ? conflict.windows.time + ' · ' + conflict.windows.title : t('已删除', 'Deleted'))),
      node('p', conflict.problem, 'muted'),
      button(t('采用 Windows 版本', 'Use Windows version'), () => { events = call('discard', conflict.key); render(); }),
      ...(conflict.value ? [button(t('保留为手机副本', 'Keep a phone copy'), () => {
        events = call('keepCopy', conflict.key); render();
      })] : []));
    screen.append(item);
  }
  screen.append(heading(t('提醒权限', 'Reminder permissions')));
  const options = node('div', undefined, 'card');
  options.append(node('p', permissions.notify ? t('已允许提醒通知。', 'Notifications are allowed.') : t('请允许通知以显示日程提醒。', 'Allow notifications to see event reminders.')),
    button(t('通知设置', 'Notification settings'), () => action('notification'), 'outline'),
    node('p', permissions.exact ? t('已允许准时提醒。', 'Exact alarms are allowed.') : t('未启用准时提醒，系统可能延后通知。', 'Reminders may be delayed without exact alarm access.')));
  if (!permissions.exact) options.append(button(t('允许准时提醒', 'Allow exact alarms'), () => action('exact'), 'outline'));
  screen.append(options, heading(t('本地数据', 'Local data')));
  const transfer = node('div', undefined, 'card actions');
  transfer.append(button(t('导入 Markdown', 'Import Markdown'), () => action('import')),
    button(t('导出 Markdown', 'Export Markdown'), () => action('export', Journal.exportMarkdown(state, events.events))),
    button(t('完整备份（含原图）','Complete backup (original images)'),()=>action('backup')),
    button(t('恢复完整备份','Restore complete backup'),()=>action('restore')));
  screen.append(transfer);
}

window.receive = (kind, value) => {
  try {
    switch (kind) {
      case 'journal': state=Object.assign(Journal.blank(),call('load'));events=call('entries');$('#application').inert=false;render();break;
      case 'day': changeDay(value); break;
      case 'events': events = call('entries'); if (!activeDraft && !editor.open) render(); break;
      case 'status':
      case 'permissions': if (tab === 'sync' && !editor.open) render(); break;
      case 'error': notify(value); break;
      case 'image': attachImage(value); break;
      case 'reference': {
        if (!activeDraft) break;
        const id = Journal.key();
        activeDraft.docs[id] = value;
        const label = value.name.replace(/[\[\]\r\n]/g, ' ');
        activeDraft.insert('\n[' + label + '](schedule-document:' + id + ')\n');
        break;
      }
      case 'markdown': {
        const imported = Journal.parseMarkdown(value, day);
        const count = imported.ideas.length;
        if (!Object.keys(imported.days).length && count === 0) { notify(t('文件中没有可导入的内容。', 'Nothing to import.')); break; }
        if (!window.confirm(t('将 Markdown 内容追加到本地笔记和想法？', 'Append Markdown to local notes and ideas?'))) break;
        save(next => {
          for (const [date, text] of Object.entries(imported.days))
            next.days[date] = [next.days[date], text].filter(Boolean).join('\n\n');
          const ids = new Map(imported.projects.map(source => {
            const existing = next.projects.find(row => row.name === source.name);
            if (existing) return [source.id, existing.id];
            next.projects.push(source);
            return [source.id, source.id];
          }));
          for (const idea of imported.ideas) idea.projects = idea.projects.map(id => ids.get(id));
          next.ideas.push(...imported.ideas);
        });
        notify(t('已导入 Markdown。', 'Markdown imported.')); render();
        break;
      }
      case 'exported': notify(t('已保存文件。', 'File saved.')); break;
    }
  } catch (error) { notify(error.message); }
};

window.back = () => {
  if (preview.open) { preview.close(); return true; }
  if (editor.open || inlineEditor) { closeEditor(); return true; }
  if (project) { project = null; render(false); return true; }
  if (tab !== 'day') { selectTab('day'); return true; }
  return false;
};

editor.addEventListener('close', () => { if (!editor.open && !inlineEditor) activeDraft = null; });
const syncEvents = entities => Object.entries(entities).filter(([key])=>key.startsWith('event/')).map(([,value])=>value);
window.syncRequest = async (id, operation, payload) => {
  try {
    $('#application').inert=true;
    const model=ScheduleSyncModel;let value;
    if(operation==='export') {
      if(activeDraft||editor.open||inlineEditor)throw Error(t('请先保存当前编辑。','Save the current edit first.'));
      state=Object.assign(Journal.blank(),call('load'));events=call('entries');
      if(state._sync?.source&&state._sync.source!==payload.source)throw Error('This journal is linked to another computer');
      const exported=await model.phoneExport(state,events.events,id=>call(payload.batched?'imageDescriptor':'imageData',id));
      const base=model.copy(state._sync?.base||{});
      if(!state._sync) {
        const raw=call('syncState');
        for(const [key,event] of Object.entries(raw.remote))base['event/'+key]=event;
        for(const [key,change] of Object.entries(raw.outbox)) {
          if(change.base)base['event/'+key]=change.base;else delete base['event/'+key];
        }
      }
      value={schema:2,source:payload.source,base,...exported};
    } else if(operation==='apply') {
      const {sent,response}=payload;
      if(response.schema!==2||response.source!==sent.source)throw Error('Journal source mismatch');
      model.validate(response.entities);await model.validateAssets(response.assets,response.entities);
      const accepted=model.accept(sent.base,sent.entities,response);
      const journal=model.phoneImport(accepted.entities,state,{source:sent.source,base:accepted.base,conflicts:accepted.conflicts});
      value={journal,events:syncEvents(accepted.entities)};
    } else throw Error('Unsupported journal operation');
    NativeSchedule.syncReply(id,JSON.stringify({ok:true,value}));
  } catch(error) {NativeSchedule.syncReply(id,JSON.stringify({ok:false,error:error.message}));}
};
async function resolveJournalConflict(key, useDesktop) {
  try {
    const model=ScheduleSyncModel, conflict=state._sync.conflicts[key];if(!conflict)return;
    const exported=await model.phoneExport(state,events.events,id=>call('imageDescriptor',id));
    const sync=model.copy(state._sync);
    if(conflict.desktop)sync.base[key]=conflict.desktop;else delete sync.base[key];
    if(useDesktop) {if(conflict.desktop)exported.entities[key]=conflict.desktop;else delete exported.entities[key];}
    else if(conflict.phone===null) {
      if(key.startsWith('project/')&&Object.values(exported.entities).some(item=>(item.projects||[]).includes(key.slice(8))))
        throw Error(t('项目仍有关联想法，请先调整绑定再删除。','This project is still linked to ideas. Update their bindings before deleting it.'));
      delete exported.entities[key];
    }
    delete sync.conflicts[key];
    const journal=model.phoneImport(exported.entities,state,sync);
    call('resolveSync',JSON.stringify({journal,events:syncEvents(exported.entities)}));
    state=journal;events=call('entries');render();
    notify(t('已保留所选版本，下次同步写入电脑。','Version kept. Sync again to send it to Windows.'));
  } catch(error){notify(error.message);}
}
$('#today').addEventListener('click', () => changeDay(today()));
try {
  permissions = settings();
  zh = permissions.language === 'zh';
  $('#today').textContent = t('今天', 'Today');
  state = Object.assign(Journal.blank(), call('load'));
  events = call('entries');
  render();
} catch (error) {
  screen.append(empty(error.message));
}

