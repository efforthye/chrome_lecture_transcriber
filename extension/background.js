// 서비스 워커: 세션 상태 관리, 영상 선택 → 오프스크린 문서(다운로드 + 변환) 실행, 메시지 중계

const OFFSCREEN_URL = 'offscreen.html';
const REFERER_RULE_ID = 1;

let writeChain = Promise.resolve();
const serialize = (fn) => (writeChain = writeChain.then(fn, fn));

async function getStatus() {
  const { status } = await chrome.storage.local.get('status');
  return status || { state: 'idle' };
}

// patch는 객체 또는 (현재 상태) => 객체
function setStatus(patch) {
  return serialize(async () => {
    const current = await getStatus();
    const status = { ...current, ...(typeof patch === 'function' ? patch(current) : patch) };
    await chrome.storage.local.set({ status });
    await updateBadge(status);
  });
}

async function updateBadge(status) {
  let text = '';
  let color = '#2563eb';
  if (status.state === 'picking') text = '선택';
  if (status.state === 'working') {
    const p = status.progress || {};
    text = p.totalSec ? `${Math.floor((100 * (p.transcribedSec || 0)) / p.totalSec)}%` : '…';
    color = '#d97706';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

async function cleanup() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const provider = settings.provider || 'groq';
  return { provider, apiKey: settings.apiKeys?.[provider] || '', language: settings.language || 'ko' };
}

async function start(tabId) {
  const settings = await getSettings();
  if (!settings.apiKey) throw new Error('설정에서 API 키를 먼저 입력해 주세요.');

  const status = await getStatus();
  if (status.state === 'working') throw new Error('이미 변환 중입니다. 중지 후 다시 시작해 주세요.');
  await cleanup();

  const tab = await chrome.tabs.get(tabId);
  // 모든 프레임(iframe 포함)에 영상 선택 스크립트 주입
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });

  await chrome.storage.local.set({
    session: { tabId, title: tab.title, url: tab.url, startedAt: Date.now(), segments: [] },
  });
  await setStatus({ state: 'picking', progress: null, error: null, notice: null });
  await chrome.tabs.sendMessage(tabId, { type: 'pick-start' });
}

async function onPicked(tabId, { source, frameUrl, duration }) {
  chrome.tabs.sendMessage(tabId, { type: 'pick-end' }).catch(() => {});
  if (!source) {
    await setStatus({
      state: 'idle',
      error: '영상 주소를 찾지 못했습니다. 영상을 한 번 재생한 뒤 다시 시도해 주세요.',
    });
    return;
  }

  // 확장 프로그램이 보내는 다운로드 요청에도 강의 페이지 Referer를 붙인다 (CDN이 Referer를 검사하는 경우 대비)
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [{ header: 'Referer', operation: 'set', value: frameUrl }],
        },
        condition: {
          tabIds: [chrome.tabs.TAB_ID_NONE],
          excludedRequestDomains: ['api.groq.com', 'api.openai.com'],
        },
      },
    ],
  });

  await serialize(async () => {
    const { session } = await chrome.storage.local.get('session');
    await chrome.storage.local.set({ session: { ...session, source } });
  });
  await setStatus({ state: 'working', progress: duration ? { totalSec: duration } : {} });

  await chrome.offscreen.createDocument({
    url: OFFSCREEN_URL,
    reasons: ['BLOBS'],
    justification: '강의 영상의 오디오를 내려받아 디코딩하고 음성인식 API로 보냅니다.',
  });
  chrome.runtime.sendMessage({ target: 'offscreen', type: 'run', source, settings: await getSettings() });
}

async function stop() {
  const { session } = await chrome.storage.local.get('session');
  if (session?.tabId != null) chrome.tabs.sendMessage(session.tabId, { type: 'pick-end' }).catch(() => {});
  if (await hasOffscreen()) {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel' }).catch(() => {});
  } else {
    await setStatus({ state: 'idle', notice: null });
  }
}

function appendSegments(segments) {
  return serialize(async () => {
    const { session } = await chrome.storage.local.get('session');
    if (!session) return;
    session.segments.push(...segments);
    await chrome.storage.local.set({ session });
  });
}

// 이 브라우저에서 보낸 오디오 양을 모델별로 기록한다 (무료 한도 확인용, 24시간 지난 기록은 버림)
function recordUsage({ type, provider, model, sec, until }) {
  return serialize(async () => {
    const { usage = { log: [], blocked: {} } } = await chrome.storage.local.get('usage');
    const now = Date.now();
    usage.log = usage.log.filter((e) => now - e.t < 86_400_000);
    if (type === 'usage') usage.log.push({ t: now, provider, model, sec });
    else usage.blocked[model] = until;
    await chrome.storage.local.set({ usage });
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;

  switch (msg.type) {
    case 'start':
      start(msg.tabId).then(
        () => sendResponse({ ok: true }),
        (e) => sendResponse({ ok: false, error: e.message })
      );
      return true;
    case 'stop':
      stop().then(() => sendResponse({ ok: true }));
      return true;
    case 'picked':
      onPicked(sender.tab.id, msg).catch((e) => setStatus({ state: 'idle', error: e.message }));
      break;
    case 'pick-cancel':
      stop();
      break;
    case 'segments':
      appendSegments(msg.segments);
      break;
    case 'progress':
      setStatus((s) => ({ progress: { ...s.progress, ...msg.progress } }));
      break;
    case 'usage':
    case 'usage-blocked':
      recordUsage(msg);
      break;
    case 'notice':
      setStatus({ notice: msg.message });
      break;
    case 'error':
      setStatus({ error: msg.message });
      break;
    case 'finished':
      cleanup().then(() => setStatus({ state: 'idle', notice: null }));
      break;
  }
});

// 강의가 툴바 없는 팝업 창으로 열리는 경우를 위해 단축키와 우클릭 메뉴로도 시작할 수 있게 한다
function startFromPage(tab) {
  if (!tab?.id) return;
  start(tab.id).catch((e) => setStatus({ state: 'idle', error: e.message }));
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'start-pick') startFromPage(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'start-pick') startFromPage(tab);
});

chrome.runtime.onStartup.addListener(() => setStatus({ state: 'idle', notice: null }));
chrome.runtime.onInstalled.addListener(() => {
  setStatus({ state: 'idle', notice: null });
  chrome.contextMenus.create({
    id: 'start-pick',
    title: '이 페이지 영상 스크립트 만들기',
    contexts: ['page', 'frame', 'video', 'selection', 'link', 'image'],
  });
});
