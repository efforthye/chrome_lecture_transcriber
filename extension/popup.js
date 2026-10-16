const $ = (id) => document.getElementById(id);

const PROVIDERS = {
  groq: { label: 'keyLabelGroq', link: 'https://console.groq.com/keys' },
  openai: { label: 'keyLabelOpenai', link: 'https://platform.openai.com/api-keys' },
};

const tr = t; // 탭 변수 t에 가려지는 곳에서 쓰는 별칭

// data-i18n 속성이 붙은 요소의 글자를 현재 언어로 채운다
function applyI18n() {
  document.documentElement.lang = LANG;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
}

function fmt(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = String(Math.floor(s / 3600)).padStart(2, '0');
  const m = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  return `${h}:${m}:${String(s % 60).padStart(2, '0')}`;
}

const mb = (n) => `${(n / 1048576).toFixed(0)}MB`;

// 시간순 정렬 + 겹치는 문장 제거
function cleanSegments(segments) {
  const sorted = [...segments].sort((a, b) => a.start - b.start);
  const kept = [];
  for (const s of sorted) {
    const prev = kept[kept.length - 1];
    if (prev) {
      const overlap = Math.min(prev.end, s.end) - Math.max(prev.start, s.start);
      if (overlap > 0.5 * Math.max(0.1, s.end - s.start)) continue;
    }
    kept.push(s);
  }
  return kept;
}

const toLines = (segments) => cleanSegments(segments).map((s) => `[${fmt(s.start)}] ${s.text}`);

// ---------- 내보내기 형식 ----------

const FORMATS = {
  txt: { ext: 'txt', label: 'fmtTxt' },
  plain: { ext: 'txt', label: 'fmtPlain' },
  srt: { ext: 'srt', label: 'fmtSrt' },
  vtt: { ext: 'vtt', label: 'fmtVtt' },
};

function cueTime(sec, sep) {
  const ms = Math.round(Math.max(0, sec) * 1000);
  const p = (n, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor((ms % 3_600_000) / 60_000))}:${p(Math.floor((ms % 60_000) / 1000))}${sep}${p(ms % 1000, 3)}`;
}

function buildText(job, segments, format) {
  const list = cleanSegments(segments);
  const cues = (sep) =>
    list.map((s, i) => {
      const next = list[i + 1];
      let end = Math.max(s.end || 0, s.start + 0.5);
      if (next && end > next.start) end = Math.max(next.start, s.start + 0.1);
      return { range: `${cueTime(s.start, sep)} --> ${cueTime(end, sep)}`, text: s.text };
    });
  if (format === 'srt') return cues(',').map((c, i) => `${i + 1}\n${c.range}\n${c.text}\n`).join('\n');
  if (format === 'vtt') return `WEBVTT\n\n${cues('.').map((c) => `${c.range}\n${c.text}\n`).join('\n')}`;
  const body = format === 'plain' ? list.map((s) => s.text) : toLines(segments);
  return [job.title, job.url, '', ...body, ''].join('\n');
}

async function getExportOptions() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const format = FORMATS[settings.exportFormat] ? settings.exportFormat : 'txt';
  return {
    format,
    // 자막 형식은 강의마다 시간이 0부터 시작해서 하나로 합칠 수 없다
    merge: !!settings.exportMerge && (format === 'txt' || format === 'plain'),
    name: settings.exportName || '',
    askWhere: !!settings.askWhere,
  };
}

async function jobText(job, format) {
  const key = `seg:${job.id}`;
  const { [key]: segs = [] } = await chrome.storage.local.get(key);
  return segs.length ? buildText(job, segs, format) : '';
}

const JOB_LABEL = { queued: 'jobQueued', working: 'jobWorking', done: 'jobDone', error: 'jobError', canceled: 'jobCanceled' };

let selectedId = null;
let lastData = {};
let targetUrls = new Map();

const targetIsYouTube = () => /^https?:\/\/(www\.|m\.|music\.)?youtube\.com\//i.test(targetUrls.get(Number($('target').value)) || '');

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

function progressText(p = {}) {
  const total = p.totalSec || 0;
  const parts = [];
  if (p.downloadedSec != null && total) parts.push(t('progExtract', { t: fmt(p.downloadedSec) }));
  else if (p.downloadedBytes != null) parts.push(t('progDownload', { a: mb(p.downloadedBytes), b: p.totalBytes ? `/${mb(p.totalBytes)}` : '' }));
  else parts.push(t('progLoading'));
  if (total) parts.push(t('progTranscribe', { a: fmt(p.transcribedSec || 0), b: fmt(total) }));
  return parts.join(' · ');
}

function jobCard(job, format = 'txt') {
  const p = job.progress || {};
  const total = p.totalSec || 0;
  const dl = total ? (p.downloadedSec || 0) / total : p.totalBytes ? (p.downloadedBytes || 0) / p.totalBytes : 0;
  const tx = total ? (p.transcribedSec || 0) / total : 0;

  const card = document.createElement('div');
  card.className = `job ${job.state}${job.id === selectedId ? ' selected' : ''}`;
  card.addEventListener('click', () => {
    selectedId = job.id;
    render(lastData);
  });

  const top = document.createElement('div');
  top.className = 'job-top';
  const title = document.createElement('span');
  title.className = 'job-title';
  title.textContent = job.title || job.url;
  const badge = document.createElement('span');
  badge.className = `job-badge ${job.state}`;
  badge.textContent = job.state === 'working' && total ? `${Math.floor(tx * 100)}%` : t(JOB_LABEL[job.state]);
  top.append(title, badge);
  card.append(top);

  if (job.state === 'working') {
    const bar = document.createElement('div');
    bar.className = 'bar';
    bar.innerHTML = `<div style="width:${Math.min(100, dl * 100)}%" class="dl"></div><div style="width:${Math.min(100, tx * 100)}%" class="tx"></div>`;
    const line = document.createElement('div');
    line.className = 'job-line';
    line.textContent = job.notice || progressText(p);
    card.append(bar, line);
  } else if (job.state === 'error') {
    const line = document.createElement('div');
    line.className = 'job-line err';
    line.textContent = job.error;
    card.append(line);
  }

  const actions = document.createElement('div');
  actions.className = 'job-actions';
  const btn = (label, onClick, cls = '') => {
    const b = document.createElement('button');
    b.textContent = label;
    if (cls) b.className = cls;
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick(b);
    });
    actions.append(b);
  };
  const count = document.createElement('span');
  count.className = 'job-count';
  count.textContent = job.count ? t('lines', { n: job.count }) : '';
  actions.append(count);
  if (job.count) {
    btn(t('copy'), (b) => copyJob(job, b));
    btn(`.${FORMATS[format].ext}`, () => downloadJobs([job]));
  }
  if (job.state === 'working' || job.state === 'queued') btn(t('stop'), () => send('cancel-job', { jobId: job.id }));
  if ((job.state === 'error' || job.state === 'canceled') && job.source) btn(t('retry'), () => send('retry-job', { jobId: job.id }));
  btn(t('remove'), () => {
    if (job.count && !confirm(t('confirmRemove', { title: job.title }))) return;
    if (selectedId === job.id) selectedId = null;
    send('remove-job', { jobId: job.id });
  }, 'danger');
  card.append(actions);
  return card;
}

async function render(data) {
  lastData = data;
  const status = data.status || { state: 'idle' };
  const jobs = data.jobs || [];
  const picking = status.state === 'picking';
  const working = jobs.filter((j) => j.state === 'working').length;
  const queued = jobs.filter((j) => j.state === 'queued').length;

  $('state').textContent = picking
    ? t('statePicking')
    : working
      ? t('stateWorking', { n: working }) + (queued ? t('stateQueued', { n: queued }) : '')
      : t('stateIdle');
  $('state').classList.toggle('recording', !!working);
  $('pick').hidden = picking;
  $('targetRow').hidden = picking;
  $('pickStop').hidden = !picking;
  const format = FORMATS[data.settings?.exportFormat] ? data.settings.exportFormat : 'txt';
  $('hint').textContent = picking
    ? t('hintPicking')
    : targetIsYouTube()
      ? t('hintYoutube')
      : jobs.length
        ? t('hintJobs')
        : t('hintEmpty');
  $('error').hidden = !status.error;
  $('error').textContent = status.error || '';

  // 최신 강의가 위로
  const ordered = [...jobs].reverse();
  if (!jobs.some((j) => j.id === selectedId)) {
    selectedId = (ordered.find((j) => j.state === 'working') || ordered[0])?.id ?? null;
  }
  $('jobs').replaceChildren(...ordered.map((j) => jobCard(j, format)));
  $('downloadAll').textContent = t('downloadAll', { ext: FORMATS[format].ext });

  // 선택한 강의 미리보기 (목록 바로 아래)
  const job = jobs.find((j) => j.id === selectedId);
  $('previewBox').hidden = !job;
  if (job) {
    const { [`seg:${job.id}`]: segs = [] } = await chrome.storage.local.get(`seg:${job.id}`);
    $('title').textContent = job.title || '';
    $('count').textContent = segs.length ? t('lines', { n: segs.length }) : '';
    const pre = $('preview');
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    pre.textContent = segs.length ? toLines(segs).join('\n') : t('noScript');
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
  $('downloadAll').disabled = !jobs.some((j) => j.state === 'done' && j.count);
}

const safeName = (s) => (s || 'transcript').replace(/[\\/:*?"<>|]/g, '_').trim();

const saveText = (text, filename, askWhere) =>
  chrome.downloads.download({
    url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
    filename,
    saveAs: askWhere,
    conflictAction: 'uniquify',
  });

// 선택한 형식으로 내려받는다. "하나로 합치기"를 켜면 파일 이름을 직접 정한 한 파일로 받는다.
async function downloadJobs(jobs) {
  const { format, merge, name, askWhere } = await getExportOptions();
  const { ext } = FORMATS[format];
  const texts = [];
  for (const job of jobs) {
    const text = await jobText(job, format);
    if (text) texts.push({ job, text });
  }
  if (!texts.length) return;
  if (merge && texts.length > 1) {
    await saveText(texts.map((t) => t.text).join('\n\n----------------------------------------\n\n'), `${safeName(name || 'transcripts')}.${ext}`, askWhere);
    return;
  }
  for (const { job, text } of texts) await saveText(text, `${safeName(job.title)}.${ext}`, askWhere);
}

async function copyJob(job, button) {
  const { format } = await getExportOptions();
  const text = await jobText(job, format);
  if (!text) return;
  await navigator.clipboard.writeText(text);
  const label = button.textContent;
  button.textContent = t('copied');
  setTimeout(() => (button.textContent = label), 1200);
}

// Groq 무료 한도 (모델별, 오디오 초). 실제 값은 console.groq.com/settings/limits 기준
const FREE_LIMITS = {
  'whisper-large-v3': { hour: 7200, day: 28800 },
  'whisper-large-v3-turbo': { hour: 7200, day: 28800 },
};

const hm = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}${t('unitH')}${m % 60}${t('unitM')}` : `${m}${t('unitM')}`;
};

// 3:05 형식 (칸이 좁은 표 안에서 사용)
const hmm = (sec) => {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

const timeOf = (ms) => new Date(ms).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });

function renderUsage(usage, settings) {
  const box = $('usage');
  if (settings.provider !== 'groq') return (box.hidden = true);
  const tails = [...new Set((settings.apiKeys?.groq || '').split(/[\s,]+/).filter(Boolean).map((k) => k.slice(-4)))];
  if (!tails.length) return (box.hidden = true);
  const now = Date.now();
  const log = (usage?.log || []).filter((e) => e.provider === 'groq');
  const sum = (key, model, ms) =>
    log
      .filter((e) => (e.key ?? tails[0]) === key && e.model === model && now - e.t < ms)
      .reduce((n, e) => n + e.sec, 0);

  const models = Object.entries(FREE_LIMITS);
  let used = 0;
  let total = 0;
  const cells = tails.map((key) => {
    const row = models.map(([model, lim]) => {
      const day = sum(key, model, 86_400_000);
      const hour = sum(key, model, 3_600_000);
      used += Math.min(day, lim.day);
      total += lim.day;
      const until = usage?.blocked?.[`${key}:${model}`] ?? (key === tails[0] ? usage?.blocked?.[model] : null);
      const blocked = until > now;
      const pct = Math.min(100, (100 * day) / lim.day);
      const title = t('usageTitle', { a: hm(hour), b: hm(lim.hour), c: hm(day), d: hm(lim.day) });
      return `<div class="cell${blocked ? ' blocked' : ''}" title="${title}">
        <div class="meter"><i style="width:${pct}%"></i></div>
        <span class="t">${blocked ? t('usageBlocked', { t: timeOf(until) }) : `${hmm(day)} / ${hmm(lim.day)}`}</span>
      </div>`;
    });
    return `<span class="key">…${key}</span>${row.join('')}`;
  });

  box.innerHTML = `
    <div class="usage-head"><span>${t('usageHead', { n: tails.length })}</span><b>${t('usageAbout', { t: hm(total - used) })}</b></div>
    <div class="meter usage-total"><i style="width:${(100 * used) / total}%"></i></div>
    <div class="usage-grid">
      <span class="th"></span><span class="th">large-v3</span><span class="th">turbo</span>
      ${cells.join('')}
    </div>
    <div class="note">${t('usageNote')} <a href="https://console.groq.com/dashboard/usage" target="_blank">Groq Usage</a>.</div>`;
  box.hidden = false;
}

async function refresh() {
  const data = await chrome.storage.local.get(['status', 'jobs', 'usage', 'settings']);
  await render(data);
  renderUsage(data.usage, { provider: 'groq', ...data.settings });
}

// 모든 창의 탭을 나열한다. 강의가 뜨는 새 창(툴바 없는 팝업 창)과 VOD 페이지를 맨 위에 둔다.
async function loadTargets() {
  const windows = await chrome.windows.getAll({ populate: true });
  const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
  const items = [];
  for (const w of windows) {
    for (const t of w.tabs) {
      if (!/^https?:/.test(t.url || '')) continue;
      const isPopup = w.type === 'popup';
      const score = (isPopup ? 4 : 0) + (/\/vod\/|video|lecture|viewer/i.test(t.url) ? 2 : 0) + (t.audible ? 1 : 0);
      items.push({ t, isPopup, score });
    }
  }
  items.sort((a, b) => b.score - a.score || (b.t.id === current?.id) - (a.t.id === current?.id));
  targetUrls = new Map(items.map(({ t }) => [t.id, t.url]));
  const select = $('target');
  select.replaceChildren(
    ...items.map(({ t, isPopup }) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${isPopup ? tr('targetNew') : t.id === current?.id ? tr('targetCurrent') : ''}${t.title || t.url}`;
      return o;
    })
  );
  $('pick').disabled = !items.length;
  render(lastData);
}

async function init() {
  await loadLang();
  applyI18n();
  loadTargets();
  let { settings = {} } = await chrome.storage.local.get('settings');
  settings = { provider: 'groq', apiKeys: {}, language: 'ko', uiLanguage: 'auto', ...settings };
  if (settings.apiKey) {
    // v0.1에서 저장한 OpenAI 키 옮기기
    settings.apiKeys.openai ||= settings.apiKey;
    delete settings.apiKey;
  }

  // 키는 저장할 때 줄바꿈으로 이어 붙인 문자열로 둔다 (background가 그대로 나눠 쓴다)
  const getKeys = () => (settings.apiKeys[settings.provider] || '').split(/[\s,]+/).filter(Boolean);
  const saveKeys = () => {
    const keys = [...$('keyList').querySelectorAll('input')].map((i) => i.value.trim()).filter(Boolean);
    settings.apiKeys[settings.provider] = keys.join('\n');
    save();
  };

  const addKeyRow = (value = '', focus = false) => {
    const row = document.createElement('div');
    row.className = 'key-row';
    const input = document.createElement('input');
    input.type = 'password';
    input.value = value;
    input.placeholder = settings.provider === 'groq' ? 'gsk_...' : 'sk-...';
    input.autocomplete = 'off';
    input.spellcheck = false;
    // 입력 중에만 키가 보이게
    input.addEventListener('focus', () => (input.type = 'text'));
    input.addEventListener('blur', () => (input.type = 'password'));
    input.addEventListener('input', saveKeys);
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.textContent = '−';
    remove.title = t('removeKey');
    remove.addEventListener('click', () => {
      row.remove();
      if (!$('keyList').children.length) addKeyRow();
      saveKeys();
    });
    row.append(input, remove);
    $('keyList').append(row);
    if (focus) input.focus();
  };

  const renderKeys = () => {
    $('keyList').replaceChildren();
    const keys = getKeys();
    (keys.length ? keys : ['']).forEach((k) => addKeyRow(k));
  };

  const save = () => chrome.storage.local.set({ settings });
  $('addKey').addEventListener('click', () => addKeyRow('', true));

  const showProvider = () => {
    const p = PROVIDERS[settings.provider];
    $('provider').value = settings.provider;
    $('keyLabel').textContent = t(p.label);
    $('keyLink').href = p.link;
    renderKeys();
  };
  showProvider();
  $('language').value = settings.language;
  if (!settings.apiKeys[settings.provider]) $('settings').open = true;

  $('provider').addEventListener('change', () => {
    settings.provider = $('provider').value;
    showProvider();
    save();
  });
  $('language').addEventListener('change', () => {
    settings.language = $('language').value;
    save();
  });

  // 인터페이스 언어: 바꾸면 바로 적용한다
  const fillLanguageSelects = () => {
    $('uiLanguage').replaceChildren(
      Object.assign(document.createElement('option'), { value: 'auto', textContent: t('uiAuto') }),
      ...Object.entries(LANGUAGES).map(([value, textContent]) => Object.assign(document.createElement('option'), { value, textContent }))
    );
    $('uiLanguage').value = settings.uiLanguage;
    const current = $('format').value;
    $('format').replaceChildren(
      ...Object.entries(FORMATS).map(([value, { label }]) => Object.assign(document.createElement('option'), { value, textContent: t(label) }))
    );
    $('format').value = current || (FORMATS[settings.exportFormat] ? settings.exportFormat : 'txt');
    $('keyLabel').textContent = t(PROVIDERS[settings.provider].label);
    $('keyList').querySelectorAll('.key-row button').forEach((b) => (b.title = t('removeKey')));
  };
  $('uiLanguage').addEventListener('change', async () => {
    settings.uiLanguage = $('uiLanguage').value;
    await save();
    setLang(settings.uiLanguage);
    applyI18n();
    fillLanguageSelects();
    loadTargets();
    refresh();
  });

  // 내보내기 설정
  fillLanguageSelects();
  $('format').value = FORMATS[settings.exportFormat] ? settings.exportFormat : 'txt';
  $('merge').checked = !!settings.exportMerge;
  $('bundleName').value = settings.exportName || '';
  $('askWhere').checked = !!settings.askWhere;
  const syncExport = () => {
    const mergeable = $('format').value === 'txt' || $('format').value === 'plain';
    $('merge').disabled = !mergeable;
    $('mergeNote').hidden = mergeable;
    $('bundleRow').hidden = !(mergeable && $('merge').checked);
  };
  syncExport();
  $('format').addEventListener('change', () => {
    settings.exportFormat = $('format').value;
    syncExport();
    save();
  });
  $('merge').addEventListener('change', () => {
    settings.exportMerge = $('merge').checked;
    syncExport();
    save();
  });
  $('bundleName').addEventListener('input', () => {
    settings.exportName = $('bundleName').value;
    save();
  });
  $('askWhere').addEventListener('change', () => {
    settings.askWhere = $('askWhere').checked;
    save();
  });
  $('target').addEventListener('change', () => render(lastData));
  $('copyPreview').addEventListener('click', async () => {
    const job = (lastData.jobs || []).find((j) => j.id === selectedId);
    if (job) await copyJob(job, $('copyPreview'));
  });

  $('pick').addEventListener('click', async () => {
    await save();
    $('pick').disabled = true;
    const tab = await chrome.tabs.get(Number($('target').value)).catch(() => null);
    if (!tab) {
      $('error').hidden = false;
      $('error').textContent = t('windowClosed');
      loadTargets();
      $('pick').disabled = false;
      return;
    }
    const youtube = targetIsYouTube();
    if (youtube) $('pick').textContent = t('fetchingCaptions');
    const res = await send('pick', { tabId: tab.id });
    $('pick').disabled = false;
    $('pick').textContent = t('add');
    if (!res?.ok) {
      $('error').hidden = false;
      $('error').textContent = res?.error || t('startFailed');
      return;
    }
    // 유튜브는 자막을 바로 가져와 목록에 추가되므로 창을 옮기지 않는다
    if (youtube) return;
    // 영상이 있는 창/탭으로 전환하고 팝업을 닫아 바로 영상을 클릭할 수 있게 한다
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true });
    window.close();
  });

  $('pickStop').addEventListener('click', () => send('pick-stop'));

  $('downloadAll').addEventListener('click', async () => {
    const { jobs = [] } = await chrome.storage.local.get('jobs');
    await downloadJobs(jobs.filter((j) => j.state === 'done' && j.count));
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (Object.keys(changes).some((k) => ['status', 'jobs', 'usage', 'settings'].includes(k) || k === `seg:${selectedId}`)) refresh();
  });
  refresh();
}

init();
