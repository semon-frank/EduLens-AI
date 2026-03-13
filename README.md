# Coursera Translation Overlay

Provides a light Chrome/Edge extension that preloads Coursera subtitles, translates them into the requested languages, explains professional terminology with Wikipedia, and renders the verified translation summary at the bottom of the page without blocking playback.

## Features
- **Full-track caching**: reads every `<track>` subtitle from Coursera’s video player, parses WebVTT blocks, and keeps them in memory so later lookups (context validation, repeated replay) do not need to re-request the server.
- **Multi-language translation**: translates the cached transcript into Chinese, Korean, Japanese, and Arabic in configurable batches, then reuses the translations to verify previously played sentences.
- **Language coverage**: also prepares Latin plus mainstream European languages (Spanish, French, German, Portuguese, Italian, Russian) so the overlay can reuse the same pipeline for those locales.
- **Terminology explanation**: heuristically extracts likely technical terms from the transcript, fetches concise definitions via the public Wikipedia REST summary API, and displays the simplified explanation in the blank area beneath the translation overlay.
- **Asynchronous cache cleanup**: when the user navigates to the next Coursera video or closes the tab, the previous video's translation/term cache is cleared asynchronously so the new video can load without waiting and the Wikipedia cache stays fresh for new terms.
- **Rewatch support**: a persistent cache keyed by Coursera video identifier lets the user rewind or replay the same lecture without re-translating everything; the overlay simply reuses the stored translations and terminology explanations.

## Installation
1. Load the directory as an unpacked extension in Chrome/Edge (Developer mode > Load unpacked).
2. Make sure the `manifest.json` hosts include `https://www.coursera.org/*` and `https://en.wikipedia.org/*`, plus any translation provider domains you will call (e.g., translation.googleapis.com) so the browser will let the API requests through.
3. Configure the `TRANSLATION_API` constants in `src/content.js` with your preferred translation service endpoint and API key, then reload the extension.

## Configuration
- `TRANSLATION_API.url` should point at your translation endpoint supporting POST requests containing `text` and `targetLanguage`. The script falls back to an annotate-only stub if no endpoint is provided.
- `TRANSLATION_API.key` is applied if the endpoint requires an Authorization header.
- `SUPPORTED_LANGUAGES` lists the four target locales; edit if you need to add more.
- Logging and verbosity can be tuned via `LOG_LEVEL`.

## Playback behavior
1. The script watches for new Coursera video `src`/path changes (lecture switches or sidebar navigation). On each change it caches the new video ID, prefetches all subtitle tracks, and starts the translation pipeline while leaving the overlay visible. It waits up to 45 seconds for the `<video>` element to render and keeps listening to DOM mutations so slow pages or Coursera DOM changes don’t leave the overlay stuck during initialization.
2. A bottom-aligned overlay shows: the aggregated translation per language, a verification line quoting the original sentence to show the mapping, and a “Term explanations” section that shows the Wikipedia-sourced ●simplified● note.
3. When the player reaches the end or the user opens the next lecture, the prior video’s `chrome.storage.local` entry and in-memory map are cleared asynchronously so the next video startup remains responsive.

## Development notes
- The overlay is injected via `src/content.js`; it is pure DOM/CSS so it works on top of Coursera’s own controls.
- The translation function supports batching segments to reduce API calls and automatically falls back to annotation mode if the service is unreachable.
- All caches (subtitle segments, translations per language, term definitions) are stored per video ID so they can be reused when the user rewinds or revisits the same lecture.

## Next steps
1. Plug in a real translation engine (e.g., Google Translate, Azure Translator, OpenAI) and update `TRANSLATION_API`.
2. Add per-language toggle buttons to the overlay if the UI becomes too tall.
3. Replace the heuristic term extractor with an NLP-based classifier if the domain grows beyond the current Coursera course.
