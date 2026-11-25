'use strict';

// Draft controls survive ordinary journal/sync updates, but are not submitted automatically.
let analysisProvider = 'codex', analysisScope = 'day', analysisQuestion = '';
function analysisSources(scope) {
  const sources = [], first = new Date(); first.setDate(first.getDate() - 6);
  const inScope = date => scope === 'day' ? date === day : scope === 'week' && date >= Journal.calendarDate(first) && date <= today();
  for (const [date, text] of Object.entries(state.days).sort(([a], [b]) => a.localeCompare(b)))
    if (inScope(date) && text.trim()) sources.push({key: 'day/' + date, label: date, text});
  for (const row of state.ideas)
    if (inScope(row.date) || scope.startsWith('project:') && row.projects.includes(scope.slice(8)))
      sources.push({key: 'idea/' + row.id, label: row.date + ' · ' + t('想法', 'Idea'), text: row.text});
  for (const row of events.events)
    if (inScope(row.key.slice(0, 10))) sources.push({key: 'event/' + row.key, label: row.key.slice(0, 10) + ' · ' + t('日程', 'Event'), text: row.time + ' ' + row.title});
  return sources;
}

function renderAnalysis() {
  screen.append(heading(t('分析与追问', 'Analysis & questions')));
  screen.append(node('p', t('手动选择文字，请电脑上已绑定的 Codex 或 Claude 分析。请求和结果随普通同步传递。图片和关联文件不发送，原记录不变。所选文字会发送至该助手服务，可能产生用量费用。',
    'Choose text manually for the Codex or Claude bound on your computer. Requests and results travel with normal sync. Images and linked files are excluded; original notes stay unchanged. Selected text is sent to the assistant service and may incur usage charges.'), 'muted analysis-description'));
  const form = node('div', undefined, 'card analysis-form');
  const provider = select([['codex', 'Codex'], ['claude', 'Claude Code']], analysisProvider);
  provider.onchange = () => { analysisProvider = provider.value; };
  const options = [['day', day], ['week', t('最近 7 天', 'Last 7 days')], ...state.projects.map(row => ['project:' + row.id, row.name])];
  if (!options.some(([key]) => key === analysisScope)) analysisScope = 'day';
  const scope = select(options, analysisScope);
  const question = node('textarea'); question.rows = 3; question.maxLength = 4000;
  question.value = analysisQuestion; question.placeholder = t('可选：这次想重点讨论什么？', 'Optional: what should we focus on?');
  question.oninput = () => { analysisQuestion = question.value; };
  const preview = node('details'), previewText = node('pre');
  preview.append(node('summary', t('查看将发送的文字', 'Preview shared text')), previewText);
  const updatePreview = () => { previewText.textContent = analysisSources(scope.value).map(row => row.label + ' [' + row.key + ']\n' + ScheduleAnalysis.clean(row.text)).join('\n\n') || t('没有文字记录', 'No text in this scope'); };
  scope.onchange = () => { analysisScope = scope.value; updatePreview(); }; updatePreview();
  form.append(field(t('助手 · xhigh', 'Assistant · xhigh'), provider), field(t('资料范围', 'Source scope'), scope), field(t('关注问题', 'Focus'), question), preview,
    button(t('分析与追问', 'Analyze & question'), () => {
      const request = ScheduleAnalysis.create(provider.value, scope.selectedOptions[0].textContent + ' · ' + t('分析与追问', 'Analysis & questions'), analysisSources(scope.value), question.value);
      save(next => { (next.analyses ||= {})[request.id] = request.row; });
      renderAnalysisPage(); notify(t('请求已保存，下次同步后由电脑处理。', 'Request saved. Your computer will process it after sync.'));
    }, 'primary'));
  screen.append(form);
  const labels = {queued: t('等待电脑处理', 'Waiting for computer'), running: t('分析中', 'Analyzing'), completed: t('已完成', 'Completed'), failed: t('未完成', 'Failed'), cancelled: t('已取消', 'Cancelled')};
  for (const [id, row] of Object.entries(state.analyses || {}).sort((a, b) => b[1].createdAt.localeCompare(a[1].createdAt))) {
    const card = node('details', undefined, 'card analysis-result');
    card.append(node('summary', row.title + ' · ' + labels[row.status]), node('p', row.provider + ' · ' + (row.model || t('执行时选择最新旗舰', 'Flagship selected at execution')) + ' · xhigh', 'muted'));
    const output = node('pre', row.result || row.error || t('请在电脑的“分析与追问”中绑定对应助手，保持 Schedule 运行并同步。', 'Bind this assistant in Analysis & questions on your computer, keep Schedule running and sync.'));
    const source = node('details'); source.append(node('summary', t('本次来源快照', 'Source snapshot')), node('pre', row.source));
    const actions = node('div', undefined, 'actions');
    actions.append(button(t('导出 Markdown', 'Export Markdown'), () => action('export', ScheduleAnalysis.exportText(row)), 'quiet'));
    if (['failed', 'cancelled'].includes(row.status)) actions.append(button(t('重新分析', 'Retry'), () => {
      const next = {...row, status: 'queued', createdAt: new Date().toISOString(), result: '', model: '', error: ''}, key = crypto.randomUUID();
      ScheduleAnalysis.validate(key, next); save(draft => { draft.analyses[key] = next; }); renderAnalysisPage();
    }, 'quiet'));
    if (['queued', 'running'].includes(row.status)) actions.append(button(t('取消', 'Cancel'), () => {
      save(draft => { draft.analyses[id].status = 'cancelled'; }); renderAnalysisPage();
      notify(t('已取消；正在电脑运行的请求会在下次同步后停止。', 'Cancelled; a running computer request stops after the next sync.'));
    }, 'quiet'));
    card.append(output, source, actions); screen.append(card);
  }
}
function renderAnalysisPage() { screen.replaceChildren(); renderAnalysis(); }
