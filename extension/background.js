// 서비스 워커: 영상 선택, 변환 대기열(여러 강의) 관리, 오프스크린 문서 실행, 메시지 중계
//
// storage.local
//   status   선택 모드 상태 { state: 'idle' | 'picking', tabId, error }
//   jobs     강의 목록 [{ id, title, url, source, frameUrl, state, progress, notice, error, count, createdAt }]
//            state: 'queued' | 'working' | 'done' | 'error' | 'canceled'
//   seg:<id> 그 강의의 문장 목록 [{ start, end, text }]

const OFFSCREEN_URL = 'offscreen.html';
const REFERER_RULE_ID = 1;
const MAX_PARALLEL = 30; // 추가하자마자 바로 시작한다. 실제 동시 다운로드/변환 수는 오프스크린이 조절한다

let writeChain = Promise.resolve();
const serialize = (fn) => (writeChain = writeChain.then(fn, fn));

// ---------- 상태 ----------

async function getStatus() {
  const { status } = await chrome.storage.local.get('status');
  return status || { state: 'idle' };
}

function setStatus(patch) {
  return serialize(async () => {
    const status = { ...(await getStatus()), ...patch };
    await chrome.storage.local.set({ status });
    await updateBadge(status);
  });
}

async function getJobs() {
  const { jobs = [] } = await chrome.storage.local.get('jobs');
  return jobs;
}

// fn(jobs)가 목록을 직접 고친다. fn의 반환값을 돌려준다.
function updateJobs(fn) {
  return serialize(async () => {
    const jobs = await getJobs();
    const result = await fn(jobs);
    await chrome.storage.local.set({ jobs });
    await updateBadge(await getStatus(), jobs);
    return result;
  });
}

function patchJob(id, patch) {
  return updateJobs((jobs) => {
    const job = jobs.find((j) => j.id === id);
    if (job) Object.assign(job, typeof patch === 'function' ? patch(job) : patch);
  });
}

async function updateBadge(status, jobs) {
  jobs ??= await getJobs();
  const left = jobs.filter((j) => j.state === 'queued' || j.state === 'working').length;
  let text = left ? String(left) : '';
  let color = '#d97706';
  if (status.state === 'picking') {
    text = '선택';
    color = '#2563eb';
  }
  await chrome.action.setBadgeText({ text });
  await chrome.action.setBadgeBackgroundColor({ color });
}

async function getSettings() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  const provider = settings.provider || 'groq';
  // 키는 여러 개 넣을 수 있다 (줄바꿈으로 구분해 저장)
  const apiKeys = [...new Set((settings.apiKeys?.[provider] || '').split(/[\s,]+/).filter(Boolean))];
  return { provider, apiKeys, language: settings.language || 'ko' };
}

// ---------- 오프스크린 문서 ----------

async function hasOffscreen() {
  const contexts = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  return contexts.length > 0;
}

let creating = null;
async function ensureOffscreen() {
  if (await hasOffscreen()) return;
  creating ??= chrome.offscreen
    .createDocument({
      url: OFFSCREEN_URL,
      reasons: ['BLOBS'],
      justification: '강의 영상의 오디오를 내려받아 디코딩하고 음성인식 API로 보냅니다.',
    })
    .finally(() => (creating = null));
  await creating;
}

async function closeOffscreen() {
  if (await hasOffscreen()) await chrome.offscreen.closeDocument();
  await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [REFERER_RULE_ID] });
}

// 확장 프로그램이 보내는 다운로드 요청에도 강의 페이지 Referer를 붙인다 (CDN이 Referer를 검사하는 경우 대비)
async function setReferer(frameUrl) {
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [REFERER_RULE_ID],
    addRules: [
      {
        id: REFERER_RULE_ID,
        priority: 1,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: frameUrl }] },
        condition: { tabIds: [chrome.tabs.TAB_ID_NONE], excludedRequestDomains: ['api.groq.com', 'api.openai.com'] },
      },
    ],
  });
}

// ---------- 대기열 ----------

// 빈 자리가 있으면 대기 중인 강의를 시작하고, 돌릴 게 없으면 오프스크린을 닫는다
let scheduleChain = Promise.resolve();
const schedule = () => (scheduleChain = scheduleChain.then(doSchedule, doSchedule));

async function doSchedule() {
  const toStart = await updateJobs((jobs) => {
    const free = MAX_PARALLEL - jobs.filter((j) => j.state === 'working').length;
    const next = jobs.filter((j) => j.state === 'queued').slice(0, Math.max(0, free));
    for (const j of next) Object.assign(j, { state: 'working', startedAt: Date.now() });
    return next;
  });
  const working = (await getJobs()).some((j) => j.state === 'working');
  if (!working) return closeOffscreen();
  if (!toStart.length) return;

  const settings = await getSettings();
  if (toStart.at(-1).frameUrl) await setReferer(toStart.at(-1).frameUrl);
  await ensureOffscreen();
  for (const job of toStart) {
    chrome.runtime.sendMessage({
      target: 'offscreen',
      type: 'run',
      jobId: job.id,
      order: job.createdAt,
      source: job.source,
      settings,
    });
  }
}

async function startPick(tabId) {
  const settings = await getSettings();
  if (!settings.apiKeys.length) throw new Error('키 설정에서 API 키를 먼저 입력해 주세요.');
  // 모든 프레임(iframe 포함)에 영상 선택 스크립트 주입
  await chrome.scripting.executeScript({ target: { tabId, allFrames: true }, files: ['content.js'] });
  await setStatus({ state: 'picking', tabId, error: null });
  await chrome.tabs.sendMessage(tabId, { type: 'pick-start' });
}

async function cancelPick() {
  const status = await getStatus();
  if (status.tabId != null) chrome.tabs.sendMessage(status.tabId, { type: 'pick-end' }).catch(() => {});
  await setStatus({ state: 'idle' });
}

async function onPicked(tab, { source, frameUrl, duration }) {
  chrome.tabs.sendMessage(tab.id, { type: 'pick-end' }).catch(() => {});
  if (!source) {
    await setStatus({ state: 'idle', error: '영상 주소를 찾지 못했습니다. 영상을 한 번 재생한 뒤 다시 시도해 주세요.' });
    return;
  }
  const duplicate = await updateJobs((jobs) => {
    const same = jobs.find((j) => j.source?.url === source.url && j.state !== 'error' && j.state !== 'canceled');
    if (same) return same;
    jobs.push({
      id: crypto.randomUUID(),
      title: tab.title,
      url: tab.url,
      source,
      frameUrl,
      state: 'queued',
      progress: duration ? { totalSec: duration } : {},
      count: 0,
      createdAt: Date.now(),
    });
  });
  await setStatus({
    state: 'idle',
    error: duplicate ? `"${duplicate.title}"은(는) 이미 목록에 있습니다.` : null,
  });
  schedule();
}

async function cancelJob(id) {
  const job = (await getJobs()).find((j) => j.id === id);
  if (job?.state === 'working') {
    chrome.runtime.sendMessage({ target: 'offscreen', type: 'cancel', jobId: id }).catch(() => {});
  } else if (job?.state === 'queued') {
    await patchJob(id, { state: 'canceled' });
  }
}

async function removeJob(id) {
  // 변환 중이면 먼저 멈추고, 끝났다는 신호(job-finished)가 오면 지운다
  const job = (await getJobs()).find((j) => j.id === id);
  if (job?.state === 'working') {
    await patchJob(id, { removeAfter: true });
    await cancelJob(id);
    return;
  }
  await updateJobs((jobs) => {
    const i = jobs.findIndex((j) => j.id === id && j.state !== 'working');
    if (i >= 0) jobs.splice(i, 1);
  });
  await chrome.storage.local.remove(`seg:${id}`);
}

async function retryJob(id) {
  await chrome.storage.local.remove(`seg:${id}`);
  await patchJob(id, (j) => ({
    state: 'queued',
    error: null,
    notice: null,
    count: 0,
    progress: j.progress?.totalSec ? { totalSec: j.progress.totalSec } : {},
  }));
  schedule();
}

function appendSegments(id, segments) {
  return serialize(async () => {
    const key = `seg:${id}`;
    const { [key]: list = [] } = await chrome.storage.local.get(key);
    list.push(...segments);
    await chrome.storage.local.set({ [key]: list });
    const jobs = await getJobs();
    const job = jobs.find((j) => j.id === id);
    if (job) {
      job.count = list.length;
      await chrome.storage.local.set({ jobs });
    }
  });
}

// 이 브라우저에서 보낸 오디오 양을 키·모델별로 기록한다 (무료 한도 확인용, 24시간 지난 기록은 버림)
function recordUsage({ type, provider, model, key, sec, until }) {
  return serialize(async () => {
    const { usage = { log: [], blocked: {} } } = await chrome.storage.local.get('usage');
    const now = Date.now();
    usage.log = usage.log.filter((e) => now - e.t < 86_400_000);
    if (type === 'usage') usage.log.push({ t: now, provider, model, key, sec });
    else usage.blocked[`${key}:${model}`] = until;
    await chrome.storage.local.set({ usage });
  });
}

// ---------- 메시지 ----------

const reply = (promise, sendResponse) =>
  promise.then(
    () => sendResponse({ ok: true }),
    (e) => sendResponse({ ok: false, error: e.message })
  );

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.target === 'offscreen') return;

  switch (msg.type) {
    // 팝업
    case 'pick':
      reply(startPick(msg.tabId), sendResponse);
      return true;
    case 'pick-stop':
      reply(cancelPick(), sendResponse);
      return true;
    case 'cancel-job':
      reply(cancelJob(msg.jobId), sendResponse);
      return true;
    case 'remove-job':
      reply(removeJob(msg.jobId), sendResponse);
      return true;
    case 'retry-job':
      reply(retryJob(msg.jobId), sendResponse);
      return true;

    // 콘텐츠 스크립트
    case 'picked':
      onPicked(sender.tab, msg).catch((e) => setStatus({ state: 'idle', error: e.message }));
      break;
    case 'pick-cancel':
      cancelPick();
      break;

    // 오프스크린
    case 'segments':
      appendSegments(msg.jobId, msg.segments);
      break;
    case 'progress':
      patchJob(msg.jobId, (j) => ({ progress: { ...j.progress, ...msg.progress } }));
      break;
    case 'notice':
      patchJob(msg.jobId, { notice: msg.message });
      break;
    case 'error':
      setStatus({ error: msg.message });
      break;
    case 'usage':
    case 'usage-blocked':
      recordUsage(msg);
      break;
    case 'job-finished':
      patchJob(msg.jobId, {
        state: msg.error ? 'error' : msg.canceled ? 'canceled' : 'done',
        error: msg.error || null,
        notice: null,
        finishedAt: Date.now(),
      })
        .then(async () => {
          const job = (await getJobs()).find((j) => j.id === msg.jobId);
          if (job?.removeAfter) await removeJob(job.id);
        })
        .then(schedule);
      break;
  }
});

// 강의가 툴바 없는 팝업 창으로 열리는 경우를 위해 단축키와 우클릭 메뉴로도 추가할 수 있게 한다
function startFromPage(tab) {
  if (!tab?.id) return;
  startPick(tab.id).catch((e) => setStatus({ state: 'idle', error: e.message }));
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'start-pick') startFromPage(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'start-pick') startFromPage(tab);
});

// 브라우저가 꺼졌다 켜지거나 확장이 업데이트되면, 하던 변환은 처음부터 다시 대기열에 넣는다
async function recover() {
  await setStatus({ state: 'idle', error: null });
  await migrate();
  const stale = await updateJobs((jobs) => {
    const list = jobs.filter((j) => j.state === 'working');
    for (const j of list) Object.assign(j, { state: 'queued', count: 0, notice: null, progress: {} });
    return list;
  });
  await chrome.storage.local.remove(stale.map((j) => `seg:${j.id}`));
  schedule();
}

// v0.5 이전의 단일 세션(session)을 목록으로 옮긴다
async function migrate() {
  const { session } = await chrome.storage.local.get('session');
  if (!session) return;
  if (session.segments?.length) {
    const id = crypto.randomUUID();
    await chrome.storage.local.set({ [`seg:${id}`]: session.segments });
    await updateJobs((jobs) => {
      jobs.unshift({
        id,
        title: session.title,
        url: session.url,
        source: session.source || null,
        state: 'done',
        progress: {},
        count: session.segments.length,
        createdAt: session.startedAt || Date.now(),
      });
    });
  }
  await chrome.storage.local.remove('session');
}

chrome.runtime.onStartup.addListener(recover);
chrome.runtime.onInstalled.addListener(() => {
  recover();
  chrome.contextMenus.create({
    id: 'start-pick',
    title: '이 페이지 영상 스크립트 만들기',
    contexts: ['page', 'frame', 'video', 'selection', 'link', 'image'],
  });
});
