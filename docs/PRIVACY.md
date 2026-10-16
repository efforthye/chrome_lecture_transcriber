# Privacy Policy — Lecture Transcriber

[한국어](PRIVACY.ko.md) · **English**

_Last updated: 2026-10-16_

Lecture Transcriber ("the extension") turns lecture videos into text transcripts. This policy explains what data the extension handles. In short: **the extension has no server of its own, collects no analytics, and does not sell or share your data.** Everything it stores stays in your browser, and audio is sent only to the speech-to-text service you choose.

## What the extension handles

| Data | Why | Where it goes |
|---|---|---|
| **Video audio** from a video you pick | To transcribe it | Sent to the speech-to-text API you selected (**Groq** or **OpenAI**) using your own API key. The extension downloads the audio directly from the video's own server; it is not sent to the developer. |
| **Your API key(s)** | To authenticate with the speech-to-text API | Stored in `chrome.storage.local` on your device. Sent only to the provider you selected (as an authorization header). Never sent to the developer. |
| **Transcripts, lecture titles and page URLs** | To show and export your results | Stored in `chrome.storage.local` on your device until you delete them or uninstall the extension. |
| **Settings and usage counters** (provider, language, export options, how much audio you sent) | To remember your preferences and estimate free-tier usage | Stored in `chrome.storage.local` on your device. |
| **YouTube captions** | To build a transcript for a YouTube video | Read from the YouTube page open in your tab (and from YouTube's own caption endpoints, using your browser session). Not sent anywhere else. |
| **Page content of the tab you pick** | Only to find the video's source URL (the `<video>` element, network history and HTML of that page) after you click "add" | Processed locally. Not stored beyond the source URL and page title/URL shown in your list. |

The extension does **not** collect your name, email, browsing history, or any data for advertising, analytics or profiling. It only looks at a page when you actively press "+ Add lecture" (or use the shortcut / context menu).

## Third parties

When you transcribe audio, it is processed by the provider you chose. Their handling of that data is governed by their own policies:

- Groq: https://groq.com/privacy-policy/
- OpenAI: https://openai.com/policies/privacy-policy/

Downloads of the video itself happen between your browser and the site that hosts the video (your school's LMS, YouTube, etc.).

## Permissions, and why they are needed

- **Access to all sites** (`<all_urls>`): lecture videos are hosted on many different sites and CDNs; the extension has to download the media file from whichever site you use and read the page you pick.
- **scripting / activeTab**: to run the "pick a video" overlay and read the video's source in the tab you choose.
- **offscreen**: to download, decode and transcribe audio in a background document.
- **storage**: to keep your settings, API keys and transcripts locally.
- **downloads**: to save transcript files you export.
- **declarativeNetRequestWithHostAccess**: to attach the lecture page's `Referer` to the extension's own media download requests, which some CDNs require.
- **contextMenus**: the right-click "create transcript" entry.

## Retention and deletion

Data stays on your device until you remove it. You can delete any lecture from the popup (this removes its transcript), or remove everything by uninstalling the extension or clearing the extension's data in Chrome. Because we hold no copy, there is nothing to delete on our side. Data already sent to Groq or OpenAI is subject to their retention policies.

## Children

The extension is not directed to children under 13 and does not knowingly collect their data.

## Changes

If this policy changes, the new version will be published at this address with an updated date.

## Contact

Questions or requests: open an issue at https://github.com/efforthye/chrome_lecture_transcriber/issues
