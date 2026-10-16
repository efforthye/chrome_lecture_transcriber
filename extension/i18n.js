// 인터페이스 번역. 팝업, 서비스 워커(importScripts), 오프스크린 문서가 함께 쓴다.
// 설정의 "인터페이스 언어"(auto | ko | en)에 따라 고르고, auto면 브라우저 언어를 따른다.
// 새 언어를 넣으려면 I18N에 같은 키를 가진 항목을 추가하고 LANGUAGES에 이름을 적으면 된다.

const LANGUAGES = { ko: '한국어', en: 'English' };

const I18N = {
  ko: {
    // 상태·배지
    stateIdle: '대기',
    statePicking: '영상 선택 중',
    stateWorking: '변환 중 {n}',
    stateQueued: ' · 대기 {n}',
    badgePick: '선택',
    jobQueued: '대기',
    jobWorking: '변환 중',
    jobDone: '완료',
    jobError: '실패',
    jobCanceled: '중지됨',

    // 설정
    keySettings: '키 설정',
    provider: '음성인식 서비스',
    providerGroq: 'Groq (무료)',
    providerOpenai: 'OpenAI (유료, 분당 $0.006)',
    keyLabelGroq: 'Groq API 키',
    keyLabelOpenai: 'OpenAI API 키',
    getKey: '발급받기',
    addKey: '+ 키 추가',
    removeKey: '이 키 삭제',
    audioLanguage: '영상 언어',
    langKo: '한국어',
    langEn: '영어',
    langAuto: '자동 감지',
    uiLanguage: '인터페이스 언어',
    uiAuto: '자동 (브라우저 설정)',

    // 메인
    targetLabel: '영상이 있는 창',
    targetNew: '[새 창] ',
    targetCurrent: '[현재 탭] ',
    add: '+ 강의 추가',
    fetchingCaptions: '자막 가져오는 중…',
    cancelPick: '선택 취소',
    hintPicking: '강의 창에서 영상 위를 클릭하세요. (Esc로 취소)',
    hintYoutube: '유튜브는 영상을 한 번 재생(클릭)한 뒤 + 강의 추가를 누르세요. 자막을 바로 가져오니 API 키도 필요 없어요.',
    hintJobs: '추가하면 바로 오디오를 받아 두니 강의 창은 닫아도 돼요. 변환은 2개씩 차례로 진행돼요.',
    hintEmpty: '창을 고르고 + 강의 추가를 누른 뒤, 그 창에서 영상을 클릭하세요.',
    pickPrompt: '강의 창에서 영상 위를 클릭하세요. (Esc로 취소)',
    overlay: '클릭해서 이 영상 스크립트 만들기 (Esc 취소)',
    windowClosed: '선택한 창이 닫혔습니다. 다시 골라 주세요.',
    startFailed: '시작하지 못했습니다.',

    // 목록
    lines: '{n}문장',
    copy: '복사',
    copied: '복사됨',
    stop: '중지',
    retry: '다시',
    remove: '삭제',
    confirmRemove: '"{title}" 스크립트를 지울까요?',
    noScript: '아직 스크립트가 없습니다.',
    progExtract: '추출 {t}',
    progDownload: '다운로드 {a}{b}',
    progLoading: '영상 정보 불러오는 중…',
    progTranscribe: '변환 {a} / {b}',

    // 내보내기
    exportSettings: '내보내기 설정',
    format: '형식',
    fmtTxt: '.txt (타임스탬프)',
    fmtPlain: '.txt (텍스트만)',
    fmtSrt: '.srt (자막 파일)',
    fmtVtt: '.vtt (웹 자막)',
    merge: '완료된 강의를 하나의 파일로 합치기',
    mergeNote: '자막 형식(.srt/.vtt)은 강의마다 시간이 0부터 시작해서 합칠 수 없어요.',
    bundleName: '합친 파일 이름',
    askWhere: '저장할 때마다 위치·이름 묻기',
    downloadAll: '완료된 강의 모두 .{ext} 다운로드',

    // 사용량
    usageHead: '남은 무료 사용량 · 키 {n}개',
    usageAbout: '약 {t}',
    usageBlocked: '한도 · {t} 해제',
    usageTitle: '최근 1시간 {a} / {b}\n최근 24시간 {c} / {d}',
    usageNote: '최근 24시간 사용량 (추정). 마우스를 올리면 1시간 사용량이 보여요. 실제 사용량은',
    unitH: '시간',
    unitM: '분',
    locale: 'ko-KR',

    // 서비스 워커
    needKey: '키 설정에서 API 키를 먼저 입력해 주세요.',
    srcNotFound: '영상 주소를 찾지 못했습니다. 영상을 한 번 재생한 뒤 다시 시도해 주세요.',
    duplicate: '"{title}"은(는) 이미 목록에 있습니다.',
    menuTitle: '이 페이지 영상 스크립트 만들기',
    offscreenWhy: '강의 영상의 오디오를 내려받아 디코딩하고 음성인식 API로 보냅니다.',
    ytNotVideo: '유튜브 영상 페이지(youtube.com/watch…)를 연 탭에서 시도해 주세요.',
    ytLive: '라이브 방송은 지원하지 않습니다. 방송이 끝난 뒤 다시 시도해 주세요.',
    ytUnavailable: '유튜브에서 재생할 수 없는 영상입니다 (비공개·멤버십·연령 제한 등).',
    ytNoCaptions: '이 영상에는 자막이 없어서 스크립트를 만들 수 없습니다.',
    ytNotReady: '영상 정보를 아직 불러오지 못했습니다. 영상을 한 번 재생(클릭)한 뒤 다시 시도해 주세요.',
    ytBlocked: '자막을 가져오지 못했습니다. 유튜브가 요청을 막은 것 같습니다. 영상을 한 번 재생한 뒤 잠시 후 다시 시도해 주세요.',
    ytFailed: '자막을 가져오지 못했습니다.',

    // 오프스크린
    dlFailed: '다운로드 실패 ({status}): {url}',
    hlsNoTrack: 'HLS 재생목록에서 영상 트랙을 찾지 못했습니다.',
    hlsBadCrypt: '지원하지 않는 암호화 방식입니다 ({method}).',
    hlsEmpty: 'HLS 재생목록이 비어 있습니다.',
    allKeysDead: '등록된 API 키가 모두 유효하지 않습니다. 설정에서 키를 확인해 주세요.',
    allKeysLimited: '모든 키가 무료 사용 한도에 걸려 기다리는 중… {t}쯤 이어서 변환합니다.',
    transcribing: '{t}부터 5분 분량 변환 중… ({model}{who})',
    keyTail: ' · 키 …{k}',
    keyInvalid: '키 …{k}가 유효하지 않아 건너뜁니다 ({status}).',
    serverRetry: '서버 응답이 없어 다시 시도 중… ({n}/5)',
    apiConnect: '음성인식 API에 연결하지 못했습니다.',
    apiError: '음성인식 API 오류 ({status}): {msg}',
    waitDownload: '다른 강의 다운로드가 끝나길 기다리는 중…',
    waitTranscribe: '오디오 받아 두는 중 · 앞 강의 변환이 끝나면 이어서 변환해요',
  },

  en: {
    stateIdle: 'Idle',
    statePicking: 'Picking video',
    stateWorking: 'Working {n}',
    stateQueued: ' · Queued {n}',
    badgePick: 'Pick',
    jobQueued: 'Queued',
    jobWorking: 'Working',
    jobDone: 'Done',
    jobError: 'Failed',
    jobCanceled: 'Stopped',

    keySettings: 'Key settings',
    provider: 'Speech-to-text service',
    providerGroq: 'Groq (free)',
    providerOpenai: 'OpenAI (paid, $0.006/min)',
    keyLabelGroq: 'Groq API key',
    keyLabelOpenai: 'OpenAI API key',
    getKey: 'Get a key',
    addKey: '+ Add key',
    removeKey: 'Remove this key',
    audioLanguage: 'Video language',
    langKo: 'Korean',
    langEn: 'English',
    langAuto: 'Auto-detect',
    uiLanguage: 'Interface language',
    uiAuto: 'Auto (browser setting)',

    targetLabel: 'Window with the video',
    targetNew: '[New window] ',
    targetCurrent: '[Current tab] ',
    add: '+ Add lecture',
    fetchingCaptions: 'Fetching captions…',
    cancelPick: 'Cancel',
    hintPicking: 'Click the video in the lecture window. (Esc to cancel)',
    hintYoutube: 'On YouTube, play the video once, then press + Add lecture. Captions are fetched directly, so no API key is needed.',
    hintJobs: 'Audio is downloaded as soon as you add a lecture, so you can close the lecture window. Two lectures are transcribed at a time.',
    hintEmpty: 'Pick a window, press + Add lecture, then click the video in that window.',
    pickPrompt: 'Click the video in the lecture window. (Esc to cancel)',
    overlay: 'Click to create a transcript of this video (Esc to cancel)',
    windowClosed: 'The selected window was closed. Please pick again.',
    startFailed: 'Could not start.',

    lines: '{n} lines',
    copy: 'Copy',
    copied: 'Copied',
    stop: 'Stop',
    retry: 'Retry',
    remove: 'Delete',
    confirmRemove: 'Delete the transcript of "{title}"?',
    noScript: 'No transcript yet.',
    progExtract: 'Extracted {t}',
    progDownload: 'Downloaded {a}{b}',
    progLoading: 'Loading video info…',
    progTranscribe: 'Transcribed {a} / {b}',

    exportSettings: 'Export settings',
    format: 'Format',
    fmtTxt: '.txt (timestamps)',
    fmtPlain: '.txt (text only)',
    fmtSrt: '.srt (subtitle file)',
    fmtVtt: '.vtt (web subtitles)',
    merge: 'Merge finished lectures into one file',
    mergeNote: 'Subtitle formats (.srt/.vtt) cannot be merged because each lecture starts at 0.',
    bundleName: 'Merged file name',
    askWhere: 'Ask where to save each time',
    downloadAll: 'Download all finished lectures (.{ext})',

    usageHead: 'Free quota left · {n} key(s)',
    usageAbout: '~{t}',
    usageBlocked: 'Limit · resets {t}',
    usageTitle: 'Last 1 hour {a} / {b}\nLast 24 hours {c} / {d}',
    usageNote: 'Usage over the last 24 hours (estimate). Hover for the 1-hour figure. Actual usage:',
    unitH: 'h ',
    unitM: 'm',
    locale: 'en-US',

    needKey: 'Please enter an API key in Key settings first.',
    srcNotFound: 'Could not find the video URL. Play the video once and try again.',
    duplicate: '"{title}" is already in the list.',
    menuTitle: 'Create transcript for this page\'s video',
    offscreenWhy: 'Downloads and decodes the lecture audio and sends it to the speech-to-text API.',
    ytNotVideo: 'Please try from a tab with a YouTube video page (youtube.com/watch…).',
    ytLive: 'Live streams are not supported. Try again after the stream has ended.',
    ytUnavailable: 'This video can\'t be played on YouTube (private, members-only, age-restricted, etc.).',
    ytNoCaptions: 'This video has no captions, so a transcript can\'t be created.',
    ytNotReady: 'Video info hasn\'t loaded yet. Play (click) the video once and try again.',
    ytBlocked: 'Could not fetch the captions. YouTube seems to have blocked the request. Play the video once and try again in a moment.',
    ytFailed: 'Could not fetch the captions.',

    dlFailed: 'Download failed ({status}): {url}',
    hlsNoTrack: 'No video track found in the HLS playlist.',
    hlsBadCrypt: 'Unsupported encryption method ({method}).',
    hlsEmpty: 'The HLS playlist is empty.',
    allKeysDead: 'None of the registered API keys are valid. Please check them in settings.',
    allKeysLimited: 'All keys hit the free usage limit; waiting… will resume around {t}.',
    transcribing: 'Transcribing 5 min from {t}… ({model}{who})',
    keyTail: ' · key …{k}',
    keyInvalid: 'Key …{k} is invalid and was skipped ({status}).',
    serverRetry: 'No response from the server, retrying… ({n}/5)',
    apiConnect: 'Could not connect to the speech-to-text API.',
    apiError: 'Speech-to-text API error ({status}): {msg}',
    waitDownload: 'Waiting for other lectures to finish downloading…',
    waitTranscribe: 'Downloading audio · transcription continues after earlier lectures finish',
  },
};

let LANG = 'ko';

function resolveLang(pref) {
  if (pref && I18N[pref]) return pref;
  const ui = (globalThis.chrome?.i18n?.getUILanguage?.() || globalThis.navigator?.language || 'ko').toLowerCase();
  return ui.startsWith('ko') ? 'ko' : 'en';
}

function setLang(pref) {
  LANG = resolveLang(pref);
  return LANG;
}

function t(key, params) {
  let s = I18N[LANG]?.[key] ?? I18N.ko[key] ?? key;
  if (params) s = s.replace(/\{(\w+)\}/g, (_, k) => params[k] ?? '');
  return s;
}

// 저장된 설정에서 인터페이스 언어를 읽어 적용한다
async function loadLang() {
  const { settings = {} } = await chrome.storage.local.get('settings');
  return setLang(settings.uiLanguage);
}
