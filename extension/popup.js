const $ = (id) => document.getElementById(id);

const PROVIDERS = {
  groq: { label: 'Groq API 키 (gsk_...)', link: 'https://console.groq.com/keys' },
  openai: { label: 'OpenAI API 키 (sk-...)', link: 'https://platform.openai.com/api-keys' },
};

const STATE_LABEL = { idle: '대기', picking: '영상 선택 중', working: '변환 중' };

const STATE_HINT = {
  idle: '창을 고르고 시작을 누른 뒤, 그 창에서 영상을 클릭하세요.',
  picking: '페이지에서 영상 위를 클릭하세요. (Esc로 취소)',
  working: '영상을 재생하지 않아도 됩니다. 팝업을 닫아도 계속 진행돼요.',
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

function renderProgress(state, p) {
  $('progress').hidden = state !== 'working';
  if (state !== 'working' || !p) return;
  const total = p.totalSec || 0;
  const dl = total ? (p.downloadedSec || 0) / total : p.totalBytes ? (p.downloadedBytes || 0) / p.totalBytes : 0;
  const tx = total ? (p.transcribedSec || 0) / total : 0;
  $('barDl').style.width = `${Math.min(100, dl * 100)}%`;
  $('barTx').style.width = `${Math.min(100, tx * 100)}%`;

  const parts = [];
  if (p.downloadedSec != null && total) parts.push(`오디오 추출 ${fmt(p.downloadedSec)} / ${fmt(total)}`);
  else if (p.downloadedBytes != null)
    parts.push(`영상 다운로드 ${mb(p.downloadedBytes)}${p.totalBytes ? ` / ${mb(p.totalBytes)}` : ''}`);
  else parts.push('영상 정보를 불러오는 중…');
  if (total) parts.push(`변환 ${fmt(p.transcribedSec || 0)} / ${fmt(total)}`);
  $('progressText').textContent = parts.join(' · ');
}

function render({ status = { state: 'idle' }, session }) {
  const state = status.state || 'idle';
  $('state').textContent = STATE_LABEL[state];
  $('state').classList.toggle('recording', state === 'working');
  $('hint').textContent = status.notice || STATE_HINT[state];
  $('start').hidden = state !== 'idle';
  $('targetRow').hidden = state !== 'idle';
  $('stop').hidden = state === 'idle';
  $('error').hidden = !status.error;
  $('error').textContent = status.error || '';
  renderProgress(state, status.progress);

  const segs = session?.segments || [];
  $('title').textContent = session?.title || '';
  $('count').textContent = segs.length ? `${segs.length}문장` : '';
  const pre = $('preview');
  const atBottom = pre.scrollTop + pre.clientHeight >= pre.scrollHeight - 4;
  pre.textContent = segs.length ? toLines(segs).join('\n') : '아직 스크립트가 없습니다.';
  if (atBottom) pre.scrollTop = pre.scrollHeight;
  $('download').disabled = !segs.length;
  $('clear').disabled = !segs.length || state !== 'idle';
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

function renderUsage(usage, settings) {
  const box = $('usage');
  if (settings.provider !== 'groq') return (box.hidden = true);
  const now = Date.now();
  const log = (usage?.log || []).filter((e) => e.provider === 'groq');
  const rows = Object.entries(FREE_LIMITS).map(([model, lim]) => {
    const day = log.filter((e) => e.model === model && now - e.t < 86_400_000).reduce((n, e) => n + e.sec, 0);
    const hour = log.filter((e) => e.model === model && now - e.t < 3_600_000).reduce((n, e) => n + e.sec, 0);
    const until = usage?.blocked?.[model];
    const name = model.endsWith('turbo') ? 'turbo' : 'large-v3';
    const blocked =
      until > now
        ? ` <span class="blocked">한도 도달 · ${new Date(until).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })} 해제</span>`
        : '';
    return { day, lim, html: `<div class="row"><span>${name}${blocked}</span><span>최근 1시간 ${hm(hour)}/${hm(lim.hour)} · 24시간 ${hm(day)}/${hm(lim.day)}</span></div>` };
  });
  const left = rows.reduce((n, r) => n + Math.max(0, r.lim.day - r.day), 0);
  box.innerHTML =
    `<div class="row"><span>남은 무료 사용량 (추정)</span><b>약 ${hm(left)}</b></div>${rows.map((r) => r.html).join('')}` +
    `<div class="note">이 브라우저에서 v0.4 설치 후 변환한 양만 셉니다. 실제 사용량은 <a href="https://console.groq.com/dashboard/usage" target="_blank">Groq Usage</a>에서 확인하세요.</div>`;
  box.hidden = false;
}

async function refresh() {
  const data = await chrome.storage.local.get(['status', 'session', 'usage', 'settings']);
  render(data);
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
  $('start').disabled = !items.length;
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

  const showProvider = () => {
    const p = PROVIDERS[settings.provider];
    $('provider').value = settings.provider;
    $('keyLabel').textContent = p.label;
    $('keyLink').href = p.link;
    $('apiKey').value = settings.apiKeys[settings.provider] || '';
  };
  showProvider();
  $('language').value = settings.language;
  if (!settings.apiKeys[settings.provider]) $('settings').open = true;

  const save = () => chrome.storage.local.set({ settings });
  $('provider').addEventListener('change', () => {
    settings.provider = $('provider').value;
    showProvider();
    save();
  });
  $('apiKey').addEventListener('input', () => {
    settings.apiKeys[settings.provider] = $('apiKey').value.trim();
    save();
  });
  $('language').addEventListener('change', () => {
    settings.language = $('language').value;
    save();
  });

  $('start').addEventListener('click', async () => {
    await save();
    const { session } = await chrome.storage.local.get('session');
    if (session?.segments?.length && !confirm('새로 시작하면 기존 스크립트가 지워집니다. 먼저 다운로드하셨나요?')) return;
    $('start').disabled = true;
    const tab = await chrome.tabs.get(Number($('target').value)).catch(() => null);
    if (!tab) {
      $('error').hidden = false;
      $('error').textContent = '선택한 창이 닫혔습니다. 다시 골라 주세요.';
      loadTargets();
      $('start').disabled = false;
      return;
    }
    const res = await chrome.runtime.sendMessage({ type: 'start', tabId: tab.id });
    $('start').disabled = false;
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

  $('stop').addEventListener('click', () => chrome.runtime.sendMessage({ type: 'stop' }));

  $('download').addEventListener('click', async () => {
    const { session } = await chrome.storage.local.get('session');
    if (!session) return;
    const text = [session.title, session.url, '', ...toLines(session.segments), ''].join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
    a.download = `${(session.title || 'transcript').replace(/[\\/:*?"<>|]/g, '_')}.txt`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });

  $('clear').addEventListener('click', async () => {
    if (confirm('스크립트를 지울까요?')) await chrome.storage.local.remove('session');
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && (changes.status || changes.session || changes.usage || changes.settings)) refresh();
  });
  refresh();
}

init();
