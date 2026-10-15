// 페이지의 모든 프레임에 주입된다. 영상 선택 모드를 띄우고, 클릭한 영상의 원본 주소(HLS/mp4)를 찾는다.
(() => {
  if (window.__lectureTranscriber) return;
  window.__lectureTranscriber = true;

  let picking = false;
  let overlay = null;

  function videoAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) {
      if (el instanceof HTMLVideoElement) return el;
    }
    // 컨트롤 레이어 등에 가려진 경우: 좌표를 포함하는 가장 큰 video
    let best = null;
    for (const v of document.querySelectorAll('video')) {
      const r = v.getBoundingClientRect();
      if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
        if (!best || r.width * r.height > best.r.width * best.r.height) best = { v, r };
      }
    }
    return best?.v || null;
  }

  // 영상 원본 주소 찾기. MSE(hls.js 등)로 재생하면 src가 blob:이라 네트워크 기록/HTML에서 m3u8을 찾는다.
  function findSource(video) {
    const classify = (url) => ({ kind: /\.m3u8(\?|#|$)/i.test(url) ? 'hls' : 'file', url });
    const isHttp = (u) => /^https?:/i.test(u || '');

    if (isHttp(video.currentSrc)) return classify(video.currentSrc);
    for (const s of video.querySelectorAll('source')) if (isHttp(s.src)) return classify(s.src);

    const loaded = performance.getEntriesByType('resource').map((e) => e.name);
    const m3u8 = loaded.filter((u) => /\.m3u8(\?|#|$)/i.test(u));
    // master(보통 playlist/master)가 먼저 요청되므로 첫 번째를 쓴다
    if (m3u8.length) return { kind: 'hls', url: m3u8[0] };

    const html = document.documentElement.innerHTML.replace(/\\\//g, '/');
    const m = html.match(/https?:\/\/[^"'\s<>\\]+?\.(m3u8|mp4)(\?[^"'\s<>\\]*)?/i);
    if (m) return classify(m[0].replace(/&amp;/g, '&'));
    return null;
  }

  function showOverlay(target) {
    if (!overlay) {
      overlay = document.createElement('div');
      Object.assign(overlay.style, {
        position: 'fixed',
        zIndex: 2147483647,
        pointerEvents: 'none',
        border: '3px solid #2563eb',
        background: 'rgba(37, 99, 235, 0.18)',
        borderRadius: '4px',
        alignItems: 'center',
        justifyContent: 'center',
        font: 'bold 18px system-ui, sans-serif',
        color: '#fff',
        textShadow: '0 1px 3px rgba(0,0,0,.7)',
      });
      overlay.textContent = '클릭해서 이 영상 스크립트 만들기 (Esc 취소)';
      document.documentElement.appendChild(overlay);
    }
    const r = target.getBoundingClientRect();
    Object.assign(overlay.style, {
      display: 'flex',
      left: `${r.left}px`,
      top: `${r.top}px`,
      width: `${r.width}px`,
      height: `${r.height}px`,
    });
  }

  function onMove(e) {
    const v = videoAt(e.clientX, e.clientY);
    if (v) showOverlay(v);
    else if (overlay) overlay.style.display = 'none';
  }

  function swallow(e) {
    if (videoAt(e.clientX, e.clientY)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }

  function onClick(e) {
    const v = videoAt(e.clientX, e.clientY);
    if (!v) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    stopPicking();
    chrome.runtime.sendMessage({
      type: 'picked',
      source: findSource(v),
      frameUrl: location.href,
      duration: Number.isFinite(v.duration) ? v.duration : null,
    });
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      stopPicking();
      chrome.runtime.sendMessage({ type: 'pick-cancel' });
    }
  }

  const listeners = [
    ['mousemove', onMove],
    ['mousedown', swallow],
    ['mouseup', swallow],
    ['click', onClick],
    ['keydown', onKey],
  ];

  function startPicking() {
    if (picking) return;
    picking = true;
    for (const [ev, fn] of listeners) window.addEventListener(ev, fn, true);
  }

  function stopPicking() {
    if (!picking) return;
    picking = false;
    for (const [ev, fn] of listeners) window.removeEventListener(ev, fn, true);
    overlay?.remove();
    overlay = null;
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'pick-start') startPicking();
    else if (msg.type === 'pick-end') stopPicking();
  });
})();
