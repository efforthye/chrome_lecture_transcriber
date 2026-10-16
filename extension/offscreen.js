// 오프스크린 문서: 영상 원본(HLS/mp4)을 내려받아 오디오만 뽑고, 10분 단위로 잘라 Whisper API로 변환한다.
// 영상을 재생할 필요가 없고, 다운로드와 변환이 동시에 진행된다.

const SR = 16000; // Whisper 입력 샘플레이트
const CHUNK_SEC = 300; // 16kHz 16bit 모노 WAV 5분 ≈ 9.6MB (API 한도 25MB). 작을수록 한도 걸렸을 때 버리는 업로드가 적다
const REQUEST_TIMEOUT_MS = 180_000; // 응답 없는 요청은 끊고 다시 시도
const SEARCH_SEC = 30; // 조각 끝 30초 안에서 가장 조용한 지점에서 자른다
const HLS_BATCH_SEC = 300; // HLS 세그먼트를 이만큼씩 모아 디코딩
const FETCH_CONCURRENCY = 6;

const PROVIDERS = {
  // Groq 무료 한도는 모델별로 따로 잡히므로, 한 모델이 한도에 걸리면 다음 모델로 넘어간다
  groq: {
    url: 'https://api.groq.com/openai/v1/audio/transcriptions',
    models: ['whisper-large-v3', 'whisper-large-v3-turbo'],
  },
  openai: { url: 'https://api.openai.com/v1/audio/transcriptions', models: ['whisper-1'] },
};

const controllers = new Map(); // jobId → AbortController

const toBackground = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra }).catch(() => {});

// ---------- 공용 유틸 ----------

async function get(url, signal) {
  const res = await fetch(url, { credentials: 'include', signal });
  if (!res.ok) throw new Error(t('dlFailed', { status: res.status, url: url.slice(0, 120) }));
  return res;
}

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      results[idx] = await fn(items[idx], idx);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

// 압축 오디오 → 16kHz 모노 Float32
async function decode(bytes) {
  const ctx = new OfflineAudioContext(1, 1, SR);
  const buf = await ctx.decodeAudioData(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

function toWav(pcm) {
  const buf = new ArrayBuffer(44 + pcm.length * 2);
  const v = new DataView(buf);
  const str = (o, s) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + pcm.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, SR, true);
  v.setUint32(28, SR * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, pcm.length * 2, true);
  for (let i = 0; i < pcm.length; i++) {
    const s = Math.max(-1, Math.min(1, pcm[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

// ---------- 오디오 조각내기 ----------
// PCM을 이어 붙이다가 CHUNK_SEC가 차면, 끝부분에서 가장 조용한 지점을 찾아 잘라 내보낸다.

class Chunker {
  constructor(onChunk) {
    this.parts = [];
    this.len = 0;
    this.offset = 0;
    this.onChunk = onChunk;
  }

  merged() {
    if (this.parts.length > 1) this.parts = [concatF32(this.parts)];
    return this.parts[0] || new Float32Array(0);
  }

  cutPoint(pcm) {
    const end = CHUNK_SEC * SR;
    const win = SR / 10;
    let best = end;
    let bestEnergy = Infinity;
    for (let i = end - SEARCH_SEC * SR; i + win <= end; i += win) {
      let e = 0;
      for (let j = i; j < i + win; j++) e += pcm[j] * pcm[j];
      if (e < bestEnergy) {
        bestEnergy = e;
        best = i + win / 2;
      }
    }
    return best;
  }

  async push(pcm) {
    this.parts.push(pcm);
    this.len += pcm.length;
    while (this.len >= CHUNK_SEC * SR) {
      const all = this.merged();
      await this.emit(all, this.cutPoint(all));
    }
  }

  async flush() {
    if (this.len > SR) await this.emit(this.merged(), this.len);
  }

  async emit(all, n) {
    const chunk = { pcm: all.slice(0, n), start: this.offset / SR };
    this.parts = [all.slice(n)];
    this.len -= n;
    this.offset += n;
    await this.onChunk(chunk);
  }
}

function concatF32(parts) {
  const out = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

// ---------- HLS ----------

const attr = (line, name) => {
  const m = line.match(new RegExp(`${name}=("([^"]*)"|[^,]*)`));
  return m ? (m[2] ?? m[1]) : null;
};

async function loadMediaPlaylist(url, signal) {
  let text = await (await get(url, signal)).text();
  if (text.includes('#EXT-X-STREAM-INF')) {
    const lines = text.split(/\r?\n/);
    // 오디오 전용 트랙이 있으면 그걸, 없으면 가장 낮은 화질을 받는다 (오디오는 동일)
    const audio = lines.find((l) => l.startsWith('#EXT-X-MEDIA') && /TYPE=AUDIO/.test(l) && /URI=/.test(l));
    let next = audio && attr(audio, 'URI');
    if (!next) {
      let best = null;
      lines.forEach((l, i) => {
        if (!l.startsWith('#EXT-X-STREAM-INF')) return;
        const bw = Number(attr(l, 'BANDWIDTH')) || Infinity;
        const uri = lines.slice(i + 1).find((x) => x.trim() && !x.startsWith('#'));
        if (uri && (!best || bw < best.bw)) best = { bw, uri: uri.trim() };
      });
      next = best?.uri;
    }
    if (!next) throw new Error(t('hlsNoTrack'));
    url = new URL(next, url).href;
    text = await (await get(url, signal)).text();
  }

  const segments = [];
  let key = null;
  let map = null;
  let seq = 0;
  let dur = 0;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#EXT-X-MEDIA-SEQUENCE:')) seq = Number(line.split(':')[1]);
    else if (line.startsWith('#EXT-X-KEY:')) {
      const method = attr(line, 'METHOD');
      if (method === 'NONE') key = null;
      else if (method === 'AES-128') key = { uri: new URL(attr(line, 'URI'), url).href, iv: attr(line, 'IV') };
      else throw new Error(t('hlsBadCrypt', { method }));
    } else if (line.startsWith('#EXT-X-MAP:')) map = new URL(attr(line, 'URI'), url).href;
    else if (line.startsWith('#EXTINF:')) dur = parseFloat(line.slice(8));
    else if (!line.startsWith('#')) {
      segments.push({ url: new URL(line, url).href, dur, key, seq: seq++ });
    }
  }
  if (!segments.length) throw new Error(t('hlsEmpty'));
  return { segments, map };
}

const keyCache = new Map();
async function decryptSegment(bytes, key, seq, signal) {
  if (!keyCache.has(key.uri)) {
    const raw = await (await get(key.uri, signal)).arrayBuffer();
    keyCache.set(key.uri, await crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']));
  }
  let iv;
  if (key.iv) {
    const hex = key.iv.replace(/^0x/i, '').padStart(32, '0');
    iv = new Uint8Array(hex.match(/../g).map((h) => parseInt(h, 16)));
  } else {
    iv = new Uint8Array(16);
    new DataView(iv.buffer).setUint32(12, seq);
  }
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, keyCache.get(key.uri), bytes));
}

// MPEG-TS에서 오디오 PES만 뽑아 ADTS(AAC)/MP3 스트림으로 만든다
function tsToAudio(d) {
  if (d[0] !== 0x47) return stripId3(d); // 이미 오디오 전용(packed audio) 세그먼트
  const out = [];
  let pid = -1;
  for (let p = 0; p + 188 <= d.length; p += 188) {
    if (d[p] !== 0x47) continue;
    const pusi = d[p + 1] & 0x40;
    const id = ((d[p + 1] & 0x1f) << 8) | d[p + 2];
    const afc = (d[p + 3] >> 4) & 3;
    if (!(afc & 1)) continue;
    let o = p + 4;
    if (afc === 3) o += 1 + d[p + 4];
    if (o >= p + 188) continue;
    if (pusi && d[o] === 0 && d[o + 1] === 0 && d[o + 2] === 1) {
      const sid = d[o + 3];
      if (pid === -1 && sid >= 0xc0 && sid <= 0xdf) pid = id;
      if (id !== pid) continue;
      o += 9 + d[o + 8];
    } else if (id !== pid) continue;
    if (o < p + 188) out.push(d.subarray(o, p + 188));
  }
  return concat(out);
}

function stripId3(d) {
  if (d[0] === 0x49 && d[1] === 0x44 && d[2] === 0x33) {
    const size = ((d[6] & 0x7f) << 21) | ((d[7] & 0x7f) << 14) | ((d[8] & 0x7f) << 7) | (d[9] & 0x7f);
    return d.subarray(10 + size);
  }
  return d;
}

async function produceHls(url, signal, chunker, progress) {
  const { segments, map } = await loadMediaPlaylist(url, signal);
  progress({ totalSec: segments.reduce((n, s) => n + s.dur, 0) });
  const init = map ? new Uint8Array(await (await get(map, signal)).arrayBuffer()) : null;

  let done = 0;
  for (let i = 0; i < segments.length; ) {
    const batch = [];
    let batchDur = 0;
    while (i < segments.length && (batchDur < HLS_BATCH_SEC || !batch.length)) {
      batch.push(segments[i]);
      batchDur += segments[i++].dur;
    }
    const parts = await mapLimit(batch, FETCH_CONCURRENCY, async (s) => {
      let bytes = new Uint8Array(await (await get(s.url, signal)).arrayBuffer());
      if (s.key) bytes = await decryptSegment(bytes, s.key, s.seq, signal);
      return init ? bytes : tsToAudio(bytes);
    });
    const pcm = await decode(init ? concat([init, ...parts]) : concat(parts));
    done += batchDur;
    progress({ downloadedSec: done });
    await chunker.push(pcm);
  }
}

// ---------- 일반 영상 파일 (mp4 등) ----------

async function produceFile(url, signal, chunker, progress) {
  const res = await get(url, signal);
  const totalBytes = Number(res.headers.get('content-length')) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let bytes = 0;
  let last = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    bytes += value.length;
    if (Date.now() - last > 500) {
      last = Date.now();
      progress({ downloadedBytes: bytes, totalBytes });
    }
  }
  progress({ downloadedBytes: bytes, totalBytes });
  const pcm = await decode(concat(parts));
  parts.length = 0;
  progress({ totalSec: pcm.length / SR, downloadedSec: pcm.length / SR });
  await chunker.push(pcm);
}

// ---------- Whisper ----------

const clock = (sec) => new Date(sec * 1000).toISOString().slice(11, 19);

const blockedUntil = new Map(); // '키끝4자리:모델' → 한도가 풀리는 시각(ms)
const deadKeys = new Set(); // 401/403이 난 키

const sleep = (sec, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, sec * 1000);
    signal.addEventListener('abort', () => (clearTimeout(t), reject(signal.reason)), { once: true });
  });

// 키 끝 4자리. 사용량 기록/표시용이며 키 자체는 저장하지 않는다
const keyTail = (key) => key.slice(-4);

async function transcribe(chunk, { provider, apiKeys, language }, signal, job) {
  const { url, models } = PROVIDERS[provider];
  const { wav } = chunk;
  // (모델, 키) 조합. 좋은 모델을 모든 키에서 먼저 쓰고, 다 막히면 다음 모델로 넘어간다
  const slots = models.flatMap((model) => apiKeys.map((key) => ({ model, key, id: `${keyTail(key)}:${model}` })));

  let res = null;
  let slot = null;
  let failures = 0;
  for (;;) {
    if (apiKeys.every((k) => deadKeys.has(k))) throw new Error(t('allKeysDead'));
    // 한도에 안 걸린 조합 중 앞쪽 것을 쓰고, 전부 걸렸으면 가장 먼저 풀리는 조합을 기다린다
    const now = Date.now();
    const usable = slots.filter((s) => !deadKeys.has(s.key));
    slot = usable.find((s) => (blockedUntil.get(s.id) || 0) <= now);
    if (!slot) {
      const next = Math.min(...usable.map((s) => blockedUntil.get(s.id)));
      const until = new Date(next).toLocaleTimeString(t('locale'), { hour: '2-digit', minute: '2-digit' });
      toBackground('notice', { jobId: job.id, message: t('allKeysLimited', { t: until }) });
      await sleep(Math.max(1, (next - now) / 1000), signal);
      continue;
    }

    const form = new FormData();
    form.append('file', wav, 'audio.wav');
    form.append('model', slot.model);
    form.append('response_format', 'verbose_json');
    form.append('timestamp_granularities[]', 'segment');
    form.append('temperature', '0');
    if (language !== 'auto') form.append('language', language);
    if (job.prevText) form.append('prompt', job.prevText.slice(-200));

    try {
      const who = apiKeys.length > 1 ? t('keyTail', { k: keyTail(slot.key) }) : '';
      toBackground('notice', { jobId: job.id, message: t('transcribing', { t: clock(chunk.start), model: slot.model, who }) });
      res = await fetch(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${slot.key}` },
        body: form,
        signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
      });
    } catch (e) {
      if (signal.aborted) throw e;
      res = null;
    }
    if (res?.status === 429) {
      const wait = Math.min(Number(res.headers.get('retry-after')) || 60, 900);
      blockedUntil.set(slot.id, Date.now() + wait * 1000);
      toBackground('usage-blocked', { provider, model: slot.model, key: keyTail(slot.key), until: blockedUntil.get(slot.id) });
    } else if (res?.status === 401 || res?.status === 403) {
      // 잘못된 키는 빼고 나머지 키로 계속한다
      deadKeys.add(slot.key);
      toBackground('error', { message: t('keyInvalid', { k: keyTail(slot.key), status: res.status }) });
    } else if (!res || res.status >= 500) {
      if (++failures >= 6) break;
      toBackground('notice', { jobId: job.id, message: t('serverRetry', { n: failures }) });
      await sleep(5 * failures, signal);
    } else break;
  }
  const model = slot.model;
  toBackground('notice', { jobId: job.id, message: null });
  if (!res) throw new Error(t('apiConnect'));
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(t('apiError', { status: res.status, msg: body.error?.message || res.statusText }));
  }
  toBackground('usage', { provider, model, key: keyTail(slot.key), sec: chunk.sec });

  const data = await res.json();
  const segments = (data.segments || [])
    // 무음 구간에서 생기는 환각 문장 제거 (Whisper 자체 기준과 동일)
    .filter((s) => !(s.no_speech_prob > 0.6 && s.avg_logprob < -1))
    .map((s) => ({ start: chunk.start + s.start, end: chunk.start + s.end, text: s.text.trim() }))
    .filter((s) => s.text);
  if (segments.length) job.prevText = segments.map((s) => s.text).join(' ');
  return segments;
}

// ---------- 실행 ----------

// 동시에 몇 개까지 허용할지 정하는 관문. 기다리는 쪽은 먼저 추가된 강의(order가 작은 쪽)부터 들어간다.
class Gate {
  constructor(size) {
    this.free = size;
    this.waiting = [];
  }

  async acquire(order, signal, onWait) {
    if (this.free > 0 && !this.waiting.length) {
      this.free--;
      return;
    }
    onWait?.();
    await new Promise((resolve, reject) => {
      const w = { order, resolve };
      this.waiting.push(w);
      this.waiting.sort((a, b) => a.order - b.order);
      signal.addEventListener(
        'abort',
        () => {
          const i = this.waiting.indexOf(w);
          if (i >= 0) this.waiting.splice(i, 1), reject(signal.reason);
        },
        { once: true }
      );
    });
  }

  release() {
    const next = this.waiting.shift();
    if (next) next.resolve();
    else this.free++;
  }
}

// 강의는 추가하자마자 오디오를 받아 둔다(강의 창을 닫아도 되게). 음성인식 요청은 전체에서 2개씩만 보낸다.
const downloadGate = new Gate(3);
const requestGate = new Gate(2);

// 강의 하나를 처리한다. 여러 개가 동시에 돌 수 있고, 메시지마다 jobId를 붙여 보낸다.
async function run({ jobId, order = Date.now(), source, settings }) {
  setLang(settings.uiLanguage);
  const controller = new AbortController();
  controllers.set(jobId, controller);
  const { signal } = controller;
  const job = { id: jobId, prevText: '' };
  const state = {};
  const progress = (patch) => {
    Object.assign(state, patch);
    toBackground('progress', { jobId, progress: { ...state } });
  };

  // 다운로드와 변환을 동시에 돌린다. 받아 둔 조각은 WAV Blob으로 쌓아 두는데,
  // 크기가 커지면 크롬이 알아서 디스크로 내려 보내므로 메모리 걱정 없이 미리 받을 수 있다.
  const queue = [];
  const waiters = new Set();
  let producing = true;
  const notify = () => [...waiters].forEach((check) => check());
  const waitFor = (cond) =>
    new Promise((resolve) => {
      const check = () => {
        if (!cond()) return;
        waiters.delete(check);
        resolve();
      };
      waiters.add(check);
      check();
    });

  const chunker = new Chunker(async (chunk) => {
    queue.push({ wav: toWav(chunk.pcm), start: chunk.start, sec: chunk.pcm.length / SR });
    notify();
  });
  const notice = (message) => toBackground('notice', { jobId, message });

  const producer = (async () => {
    let acquired = false;
    try {
      await downloadGate.acquire(order, signal, () => notice(t('waitDownload')));
      acquired = true;
      notice(null);
      if (source.kind === 'hls') await produceHls(source.url, signal, chunker, progress);
      else await produceFile(source.url, signal, chunker, progress);
      await chunker.flush();
    } finally {
      if (acquired) downloadGate.release();
      producing = false;
      notify();
    }
  })();

  const consumer = (async () => {
    for (;;) {
      await waitFor(() => queue.length || !producing || signal.aborted);
      if (signal.aborted) return;
      if (!queue.length) return;
      const chunk = queue.shift();
      notify();
      await requestGate.acquire(order, signal, () => notice(t('waitTranscribe')));
      let segments;
      try {
        segments = await transcribe(chunk, settings, signal, job);
      } finally {
        requestGate.release();
      }
      if (segments.length) toBackground('segments', { jobId, segments });
      progress({ transcribedSec: chunk.start + chunk.sec });
    }
  })();

  // 한쪽이 실패하면 다른 쪽도 멈춘다
  const fail = (e) => {
    controller.abort();
    notify();
    throw e;
  };
  const results = await Promise.allSettled([producer.catch(fail), consumer.catch(fail)]);
  controllers.delete(jobId);
  const err = results.map((r) => r.reason).find((e) => e && e.name !== 'AbortError');
  if (err) throw err;
  return signal.aborted;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.target !== 'offscreen') return;
  if (msg.type === 'run') {
    run(msg).then(
      (canceled) => toBackground('job-finished', { jobId: msg.jobId, canceled }),
      (e) => toBackground('job-finished', { jobId: msg.jobId, error: e.message })
    );
  } else if (msg.type === 'cancel') {
    controllers.get(msg.jobId)?.abort();
  }
});
