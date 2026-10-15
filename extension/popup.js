const $ = (id) => document.getElementById(id);

const PROVIDERS = {
  groq: { label: 'Groq API 키', link: 'https://console.groq.com/keys' },
  openai: { label: 'OpenAI API 키', link: 'https://platform.openai.com/api-keys' },
};

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

const JOB_LABEL = { queued: '대기', working: '변환 중', done: '완료', error: '실패', canceled: '중지됨' };

let selectedId = null;
let lastData = {};

const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra });

function progressText(p = {}) {
  const total = p.totalSec || 0;
  const parts = [];
  if (p.downloadedSec != null && total) parts.push(`추출 ${fmt(p.downloadedSec)}`);
  else if (p.downloadedBytes != null) parts.push(`다운로드 ${mb(p.downloadedBytes)}${p.totalBytes ? `/${mb(p.totalBytes)}` : ''}`);
  else parts.push('영상 정보 불러오는 중…');
  if (total) parts.push(`변환 ${fmt(p.transcribedSec || 0)} / ${fmt(total)}`);
  return parts.join(' · ');
}

function jobCard(job) {
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
  badge.textContent = job.state === 'working' && total ? `${Math.floor(tx * 100)}%` : JOB_LABEL[job.state];
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
      onClick();
    });
    actions.append(b);
  };
  const count = document.createElement('span');
  count.className = 'job-count';
  count.textContent = job.count ? `${job.count}문장` : '';
  actions.append(count);
  if (job.count) btn('.txt', () => downloadJobs([job]));
  if (job.state === 'working' || job.state === 'queued') btn('중지', () => send('cancel-job', { jobId: job.id }));
  if ((job.state === 'error' || job.state === 'canceled') && job.source) btn('다시', () => send('retry-job', { jobId: job.id }));
  btn('삭제', () => {
    if (job.count && !confirm(`"${job.title}" 스크립트를 지울까요?`)) return;
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

  $('state').textContent = picking ? '영상 선택 중' : working ? `변환 중 ${working}${queued ? ` · 대기 ${queued}` : ''}` : '대기';
  $('state').classList.toggle('recording', !!working);
  $('pick').hidden = picking;
  $('targetRow').hidden = picking;
  $('pickStop').hidden = !picking;
  $('hint').textContent = picking
    ? '강의 창에서 영상 위를 클릭하세요. (Esc로 취소)'
    : jobs.length
      ? '추가하면 바로 오디오를 받아 두니 강의 창은 닫아도 돼요. 변환은 2개씩 차례로 진행돼요.'
      : '창을 고르고 + 강의 추가를 누른 뒤, 그 창에서 영상을 클릭하세요.';
  $('error').hidden = !status.error;
  $('error').textContent = status.error || '';

  // 최신 강의가 위로
  const ordered = [...jobs].reverse();
  if (!jobs.some((j) => j.id === selectedId)) {
    selectedId = (ordered.find((j) => j.state === 'working') || ordered[0])?.id ?? null;
  }
  $('jobs').replaceChildren(...ordered.map(jobCard));

  // 선택한 강의 미리보기 (목록 바로 아래)
  const job = jobs.find((j) => j.id === selectedId);
  $('previewBox').hidden = !job;
  if (job) {
    const { [`seg:${job.id}`]: segs = [] } = await chrome.storage.local.get(`seg:${job.id}`);
    $('title').textContent = job.title || '';
    $('count').textContent = segs.length ? `${segs.length}문장` : '';
    const pre = $('preview');
    const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
    pre.textContent = segs.length ? toLines(segs).join('\n') : '아직 스크립트가 없습니다.';
    if (atBottom) pre.scrollTop = pre.scrollHeight;
  }
  $('downloadAll').disabled = !jobs.some((j) => j.state === 'done' && j.count);
}

const safeName = (s) => (s || 'transcript').replace(/[\\/:*?"<>|]/g, '_').trim();

async function downloadJobs(jobs) {
  for (const job of jobs) {
    const key = `seg:${job.id}`;
    const { [key]: segs = [] } = await chrome.storage.local.get(key);
    if (!segs.length) continue;
    const text = [job.title, job.url, '', ...toLines(segs), ''].join('\n');
    await chrome.downloads.download({
      url: `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`,
      filename: `${safeName(job.title)}.txt`,
      conflictAction: 'uniquify',
    });
  }
}

// Groq 무료 한도 (모델별, 오디오 초). 실제 값은 console.groq.com/settings/limits 기준
const FREE_LIMITS = {
  'whisper-large-v3': { hour: 7200, day: 28800 },
  'whisper-large-v3-turbo': { hour: 7200, day: 28800 },
};

const hm = (sec) => {
  const m = Math.round(sec / 60);
  return m >= 60 ? `${Math.floor(m / 60)}시간 ${m % 60}분` : `${m}분`;
};

// 3:05 형식 (칸이 좁은 표 안에서 사용)
const hmm = (sec) => {
  const m = Math.round(sec / 60);
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
};

const timeOf = (ms) => new Date(ms).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });

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
      const title = `최근 1시간 ${hm(hour)} / ${hm(lim.hour)}\n최근 24시간 ${hm(day)} / ${hm(lim.day)}`;
      return `<div class="cell${blocked ? ' blocked' : ''}" title="${title}">
        <div class="meter"><i style="width:${pct}%"></i></div>
        <span class="t">${blocked ? `한도 · ${timeOf(until)} 해제` : `${hmm(day)} / ${hmm(lim.day)}`}</span>
      </div>`;
    });
    return `<span class="key">…${key}</span>${row.join('')}`;
  });

  box.innerHTML = `
    <div class="usage-head"><span>남은 무료 사용량 · 키 ${tails.length}개</span><b>약 ${hm(total - used)}</b></div>
    <div class="meter usage-total"><i style="width:${(100 * used) / total}%"></i></div>
    <div class="usage-grid">
      <span class="th"></span><span class="th">large-v3</span><span class="th">turbo</span>
      ${cells.join('')}
    </div>
    <div class="note">최근 24시간 사용량 (추정). 마우스를 올리면 1시간 사용량이 보여요. 실제 사용량은 <a href="https://console.groq.com/dashboard/usage" target="_blank">Groq Usage</a>.</div>`;
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
  const select = $('target');
  select.replaceChildren(
    ...items.map(({ t, isPopup }) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${isPopup ? '[새 창] ' : t.id === current?.id ? '[현재 탭] ' : ''}${t.title || t.url}`;
      return o;
    })
  );
  $('pick').disabled = !items.length;
}

async function init() {
  loadTargets();
  let { settings = {} } = await chrome.storage.local.get('settings');
  settings = { provider: 'groq', apiKeys: {}, language: 'ko', ...settings };
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
    remove.title = '이 키 삭제';
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
    $('keyLabel').textContent = p.label;
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

  $('pick').addEventListener('click', async () => {
    await save();
    $('pick').disabled = true;
    const tab = await chrome.tabs.get(Number($('target').value)).catch(() => null);
    if (!tab) {
      $('error').hidden = false;
      $('error').textContent = '선택한 창이 닫혔습니다. 다시 골라 주세요.';
      loadTargets();
      $('pick').disabled = false;
      return;
    }
    const res = await send('pick', { tabId: tab.id });
    $('pick').disabled = false;
    if (!res?.ok) {
      $('error').hidden = false;
      $('error').textContent = res?.error || '시작하지 못했습니다.';
      return;
    }
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
