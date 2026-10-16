# Chrome Web Store listing material

Copy-paste material for the Chrome Web Store developer dashboard. Fees and form fields may change, so double-check against the dashboard.

- Privacy policy URL: https://github.com/efforthye/chrome_lecture_transcriber/blob/main/docs/PRIVACY.md
- Support / homepage: https://github.com/efforthye/chrome_lecture_transcriber
- Category: Education (or Productivity)
- Package: zip the **contents** of the `extension/` folder (so `manifest.json` is at the zip root).

## Images (`docs/store/ko/` and `docs/store/en/`)

| File | Use |
|---|---|
| `extension/icons/icon128.png` | Store icon (128×128) |
| `promo-small-440x280.png` | Small promo tile (required) |
| `promo-marquee-1400x560.png` | Marquee promo tile (optional) |
| `1-queue.png`, `2-youtube.png`, `3-export.png`, `4-keys.png` | Screenshots, 1280×800 |

Each folder has the same set in Korean and English; upload the set that matches the listing language. The screenshots are the real popup UI rendered with demo data (no real user data, real video titles or real API keys). Screenshot 4 shows several keys registered. Replace them with real captures if you prefer.

## Short description (max 132 characters)

**English**
> Turn lecture videos into timestamped transcripts with Whisper. YouTube captions in seconds. Export .txt, .srt, .vtt.

**한국어**
> 강의 영상을 타임스탬프 스크립트로. Whisper 변환, 유튜브는 자막을 바로 가져옵니다. .txt·.srt·.vtt 내보내기.

## Detailed description

### English

Lecture Transcriber turns lecture videos into timestamped transcripts.

★ One click
Click the video on a lecture page. The extension downloads the video's audio (HLS or mp4), transcribes it with Whisper and gives you a transcript with video-based timestamps. The video does not need to play, and you can close the lecture window as soon as you add it.

★ YouTube
On YouTube it fetches the video's existing captions in seconds, with no API key. (Videos without captions are not supported.)

★ Many lectures at once
Add as many lectures as you like. Audio is downloaded immediately and transcribed in the order added.

★ Export your way
.txt with timestamps, text only, .srt or .vtt. Copy to the clipboard, or merge finished lectures into one file with a name you choose.

★ Free to start, private by design
Use your own Groq key (generous free tier, no card) or an OpenAI key. API keys and transcripts are stored only in your browser. There is no developer server and no analytics. Audio is sent only to the speech-to-text provider you choose.

How to use
1. Open the extension, add your Groq or OpenAI API key (not needed for YouTube).
2. Open the lecture page, pick it in the extension and press "+ Add lecture", then click the video. On YouTube, play the video once and press "+ Add lecture".
3. Copy or download the transcript.

Notes
• DRM-protected videos cannot be downloaded.
• YouTube auto-captions are less accurate than Whisper, especially for names and numbers.
• Use for personal study. You are responsible for following the terms of service and copyright of the sites you use.
• The interface is available in Korean and English (Key settings → Interface language).

### 한국어

Lecture Transcriber는 강의 영상을 타임스탬프가 붙은 스크립트로 만들어 줍니다.

★ 클릭 한 번
강의 페이지에서 영상을 클릭하면 영상의 오디오(HLS·mp4)를 받아 Whisper로 변환하고, 영상 기준 타임스탬프가 붙은 스크립트를 만들어 줍니다. 영상을 재생하지 않아도 되고, 추가하자마자 강의 창을 닫아도 됩니다.

★ 유튜브 지원
유튜브는 영상에 이미 있는 자막을 몇 초 만에 가져옵니다. API 키도 필요 없습니다. (자막이 없는 영상은 지원하지 않습니다.)

★ 여러 강의를 한꺼번에
강의를 얼마든지 추가하세요. 오디오는 바로 받아 두고 추가한 순서대로 변환합니다.

★ 원하는 형식으로 내보내기
타임스탬프가 있는 .txt, 텍스트만, .srt, .vtt. 클립보드 복사, 완료된 강의를 이름을 정해 하나의 파일로 합치기까지.

★ 무료로 시작, 내 데이터는 내 브라우저에
Groq 키(넉넉한 무료 한도, 카드 불필요)나 OpenAI 키를 직접 사용합니다. API 키와 스크립트는 내 브라우저에만 저장되고, 개발자 서버나 분석 도구는 없습니다. 오디오는 내가 고른 음성인식 서비스로만 전송됩니다.

사용법
1. 확장 아이콘을 눌러 Groq 또는 OpenAI API 키를 넣습니다. (유튜브는 필요 없음)
2. 강의 페이지를 열고 확장에서 그 창을 골라 "+ 강의 추가"를 누른 뒤 영상을 클릭합니다. 유튜브는 영상을 한 번 재생한 뒤 "+ 강의 추가"만 누르면 됩니다.
3. 스크립트를 복사하거나 다운로드합니다.

참고
• DRM이 걸린 영상은 받을 수 없습니다.
• 유튜브 자동 자막은 Whisper보다 정확도가 낮아 고유명사·숫자에서 오인식이 있을 수 있습니다.
• 개인 학습 용도로만 사용하세요. 이용하는 사이트의 약관과 저작권을 지킬 책임은 사용자에게 있습니다.
• 인터페이스는 한국어와 English를 지원합니다 (키 설정 → 인터페이스 언어).

## Single purpose (단일 목적)

> Create a text transcript from the audio of a lecture video the user selects (or from a YouTube video's existing captions), and let the user copy or export it.

## Permission justifications (권한 사유)

| Permission | Justification |
|---|---|
| Host permissions `<all_urls>` | Lecture videos are served from many unrelated sites and CDNs. The extension must download the media file the user selects from whichever site hosts it, and read the selected tab to find the video's source URL. It only acts after the user presses "Add lecture". |
| `scripting` | Injects the "pick a video" overlay into the tab the user chooses, and reads YouTube's caption data on a YouTube tab after the user presses "Add lecture". |
| `activeTab` | Lets the extension act on the tab the user invoked it from (button, shortcut or context menu). |
| `offscreen` | Downloading, decoding (Web Audio) and chunking audio needs a DOM/audio context that a service worker does not have. |
| `storage` | Stores settings, the user's API key(s), the lecture list and transcripts locally. |
| `downloads` | Saves exported transcript files (.txt/.srt/.vtt). |
| `declarativeNetRequestWithHostAccess` | Adds the lecture page's `Referer` header to the extension's own media download requests, which some CDNs require. |
| `contextMenus` | Adds the right-click "Create transcript for this page's video" entry. |

Remote code: none. All code is bundled in the package.

## Data usage disclosure (개인정보 보호 관행 탭)

- Data handled: **website content** (the audio/captions of the video the user picks) and **authentication information** (the user's own API key, kept locally).
- Is the data sold? **No.** Used for purposes unrelated to the single purpose? **No.** Used for creditworthiness/lending? **No.**
- Audio is transferred to the user-selected speech-to-text provider (Groq or OpenAI) solely to produce the transcript the user requested. API keys are stored locally and sent only to that provider for authentication.
- Certify the three Limited Use statements in the dashboard accordingly.

## Review notes

- `<all_urls>` triggers an in-depth review. The justification above explains why it is needed.
- YouTube features read captions from the YouTube page the user has open; no audio is downloaded from YouTube.
- A reviewer test: install, open any YouTube video that has captions, play it once, press the toolbar icon → "+ Add lecture". A transcript appears within seconds without any API key.
