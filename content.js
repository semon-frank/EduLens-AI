(() => {
  const SUPPORTED_LANGUAGES = [
    { code: 'zh-CN', label: 'Chinese (简体)' },
    { code: 'ko', label: 'Korean (한국어)' },
    { code: 'ja', label: 'Japanese (日本語)' },
    { code: 'ar', label: 'Arabic (العربية)' },
    { code: 'es', label: 'Spanish (Español)' },
    { code: 'fr', label: 'French (Français)' },
    { code: 'de', label: 'German (Deutsch)' },
    { code: 'pt', label: 'Português' },
    { code: 'it', label: 'Italiano' },
    { code: 'ru', label: 'Russian (Русский)' },
    { code: 'la', label: 'Latin (Lingua Latīna)' }
  ];

  const TRANSLATION_API = {
    url: '',
    key: ''
  };

  const LOG_LEVEL = 'info';
  const STORAGE_PREFIX = 'coursera-translator';
  const VIDEO_WAIT_TIMEOUT = 45000;

  const wikiCache = new Map();
  const memoryCache = new Map();
  const cleanupPending = new Set();

  let overlay;
  let statusLine;
  let translationsContainer;
  let verificationLine;
  let termContainer;
  let currentVideoId;
  let lastHref = location.href;
  let primarySegments = [];
  let lastVerification = '';

  function log(level, ...args) {
    const levels = ['debug', 'info', 'warn', 'error'];
    if (levels.indexOf(level) < levels.indexOf(LOG_LEVEL)) {
      return;
    }
    console[level === 'debug' ? 'log' : level](...args);
  }

  function ensureOverlay() {
    overlay = document.getElementById('coursera-translate-overlay');
    if (overlay) {
      statusLine = overlay.querySelector('.cte-status');
      translationsContainer = overlay.querySelector('.cte-translations');
      verificationLine = overlay.querySelector('.cte-verification');
      termContainer = overlay.querySelector('.cte-terms');
      return overlay;
    }

    const container = document.createElement('div');
    container.id = 'coursera-translate-overlay';
    container.innerHTML = `
      <div class="cte-status">Initializing translator…</div>
      <div class="cte-translations"></div>
      <div class="cte-verification"></div>
      <div class="cte-terms"></div>
    `;

    const style = document.createElement('style');
    style.textContent = `
      #coursera-translate-overlay {
        position: fixed;
        bottom: 12px;
        left: 12px;
        right: 12px;
        z-index: 2147483646;
        box-shadow: 0 14px 40px rgba(0,0,0,.35);
        border-radius: 12px;
        backdrop-filter: blur(12px);
        background: rgba(4, 15, 29, 0.85);
        color: #f0f4ff;
        font-family: "Segoe UI", Roboto, sans-serif;
        font-size: 13px;
        pointer-events: none;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 6px;
        max-height: 200px;
        overflow: hidden;
      }

      #coursera-translate-overlay .cte-status {
        font-weight: 600;
        font-size: 14px;
        opacity: 0.8;
      }

      #coursera-translate-overlay .cte-translations {
        display: flex;
        gap: 10px;
        flex-wrap: wrap;
        overflow-x: auto;
        white-space: nowrap;
        max-width: 100%;
      }

      #coursera-translate-overlay .cte-language {
        flex: 1;
        min-width: 180px;
        background: rgba(255,255,255,0.04);
        padding: 8px;
        border-radius: 8px;
        pointer-events: auto;
      }

      #coursera-translate-overlay .cte-language label {
        font-size: 12px;
        font-weight: 700;
        letter-spacing: 0.02em;
        display: block;
        margin-bottom: 4px;
      }

      #coursera-translate-overlay .cte-language .cte-sample {
        font-size: 12px;
        line-height: 1.4;
        max-height: 3.5em;
        overflow: hidden;
        text-overflow: ellipsis;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
      }

      #coursera-translate-overlay .cte-verification {
        font-size: 11px;
        color: #9ec9f7;
        opacity: 0.9;
      }

      #coursera-translate-overlay .cte-terms {
        font-size: 12px;
        color: #e0e7ff;
        background: rgba(255,255,255,0.05);
        border-radius: 8px;
        padding: 8px;
        max-height: 80px;
        overflow-y: auto;
      }

      #coursera-translate-overlay .cte-terms ul {
        margin: 0;
        padding-left: 16px;
      }

      #coursera-translate-overlay .cte-terms li {
        margin-bottom: 4px;
      }
    `;

    document.head.appendChild(style);
    document.body.appendChild(container);
    overlay = container;
    statusLine = overlay.querySelector('.cte-status');
    translationsContainer = overlay.querySelector('.cte-translations');
    verificationLine = overlay.querySelector('.cte-verification');
    termContainer = overlay.querySelector('.cte-terms');
    return overlay;
  }

  function showStatus(message) {
    if (!ensureOverlay()) {
      return;
    }
    statusLine.textContent = message;
  }

  function updateOverlay(translations, termExplanations, verification) {
    ensureOverlay();
    const translationBlocks = SUPPORTED_LANGUAGES.map((lang) => {
      const items = translations?.[lang.code] || [];
      const preview = items
        .slice(0, 3)
        .map((entry) => entry.translated || '[pending]')
        .join(' · ');
      return `
        <div class="cte-language">
          <label>${lang.label}</label>
          <div class="cte-sample">${preview || '暂未翻译内容'}</div>
        </div>
      `;
    });

    translationsContainer.innerHTML = translationBlocks.join('');
    verificationLine.textContent = verification || '正在校验原句，确保翻译拼对。';

    if (Object.keys(termExplanations || {}).length === 0) {
      termContainer.innerHTML = '<em>暂无新专业术语。</em>';
      return;
    }

    const termLines = Object.entries(termExplanations).map(([term, summary]) => {
      const safeSummary = summary.length > 200 ? `${summary.slice(0, 200)}…` : summary;
      return `<li><strong>${term}</strong>: ${safeSummary}</li>`;
    });

    termContainer.innerHTML = `<ul>${termLines.join('')}</ul>`;
  }

  function storageKey(videoId) {
    return `${STORAGE_PREFIX}-${videoId}`;
  }

  function storageGet(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.get([key], (result) => {
          resolve(result[key]);
        });
      });
    }
    return Promise.resolve(memoryCache.get(key));
  }

  function storageSet(key, value) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.set({ [key]: value }, resolve);
      });
    }
    memoryCache.set(key, value);
    return Promise.resolve();
  }

  function storageRemove(key) {
    if (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local) {
      return new Promise((resolve) => {
        chrome.storage.local.remove([key], resolve);
      });
    }
    memoryCache.delete(key);
    return Promise.resolve();
  }

  function scheduleCacheClear(videoId) {
    if (!videoId || cleanupPending.has(videoId)) {
      return;
    }
    cleanupPending.add(videoId);
    setTimeout(async () => {
      await storageRemove(storageKey(videoId));
      memoryCache.delete(storageKey(videoId));
      cleanupPending.delete(videoId);
      log('info', 'Asynchronously cleared cache for', videoId);
    }, 0);
  }

  function pickPrimaryTrack(tracks) {
    if (!tracks) {
      return null;
    }
    const englishTrack = tracks.en || tracks['en-US'] || tracks['en-GB'];
    if (englishTrack) {
      return englishTrack;
    }
    const firstLang = Object.keys(tracks)[0];
    return tracks[firstLang];
  }

  function parseVtt(text) {
    const blocks = text.split(/\n\n+/).map((block) => block.trim());
    const segments = [];
    blocks.forEach((block) => {
      if (!block) {
        return;
      }
      const lines = block.split(/\r?\n/).filter((line) => line.trim());
      if (lines.length < 2) {
        return;
      }
      const timeLine = lines.find((line) => line.includes('-->'));
      const content = lines.slice(1).join(' ').trim();
      if (!timeLine || !content) {
        return;
      }
      const [start, end] = timeLine.split('-->').map((token) => token.trim());
      segments.push({
        start,
        end,
        text: content
      });
    });
    return segments;
  }

  async function fetchTrackText(trackUrl) {
    const resolvedUrl = new URL(trackUrl, location.origin).toString();
    const response = await fetch(resolvedUrl, { credentials: 'include' });
    if (!response.ok) {
      throw new Error(`Track fetch failed (${response.status})`);
    }
    return response.text();
  }

  async function preloadTracks() {
    const tracks = Array.from(document.querySelectorAll('video track[kind="subtitles"]'));
    const parsed = {};
    await Promise.all(
      tracks.map(async (track) => {
        const attrLang = track.getAttribute('srclang');
        const label = track.label || attrLang || 'unknown';
        const langKey = attrLang || label || 'unknown';
        const src = track.src || track.getAttribute('src');
        if (!src) {
          return;
        }
        try {
          const text = await fetchTrackText(src);
          const segments = parseVtt(text);
          if (segments.length) {
            parsed[langKey] = { label, segments };
          }
        } catch (error) {
          log('warn', 'Failed to preload subtitle', src, error);
        }
      })
    );
    return parsed;
  }

  async function callTranslationAPI(text, targetLanguage) {
    if (!text) {
      return '';
    }
    if (!TRANSLATION_API.url) {
      return `[${targetLanguage}] ${text}`;
    }
    try {
      const payload = {
        text,
        targetLanguage
      };
      const headers = {
        'Content-Type': 'application/json'
      };
      if (TRANSLATION_API.key) {
        headers.Authorization = `Bearer ${TRANSLATION_API.key}`;
      }
      const response = await fetch(TRANSLATION_API.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });
      if (!response.ok) {
        throw new Error(`Translation HTTP ${response.status}`);
      }
      const data = await response.json();
      return (
        data.translatedText ||
        data.translation ||
        (data.data && data.data.translation) ||
        data.result ||
        text
      );
    } catch (error) {
      log('warn', 'Translation API error:', error);
      return `[${targetLanguage}] ${text}`;
    }
  }

  async function translateSegments(segments, targetLanguage) {
    const translations = [];
    for (const segment of segments) {
      const translationResult = await callTranslationAPI(segment.text, targetLanguage);
      translations.push({
        start: segment.start,
        end: segment.end,
        original: segment.text,
        translated: translationResult
      });
    }
    return translations;
  }

  function extractTerms(segments) {
    const stopWords = new Set(['The', 'A', 'This', 'That', 'Your', 'Their', 'With', 'From', 'When']);
    const candidates = new Set();
    segments.forEach((segment) => {
      const words = segment.text.replace(/[^a-zA-Z ]/g, ' ').split(/\s+/);
      words.forEach((word) => {
        if (!word) {
          return;
        }
        if (word.length < 4 || stopWords.has(word)) {
          return;
        }
        if (word[0] !== word[0].toUpperCase()) {
          return;
        }
        candidates.add(word);
      });
    });
    return Array.from(candidates).slice(0, 12);
  }

  async function fetchWikipediaDefinition(term) {
    if (wikiCache.has(term)) {
      return wikiCache.get(term);
    }
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(term)}`;
    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json'
        }
      });
      if (!response.ok) {
        throw new Error(`Wikipedia ${response.status}`);
      }
      const payload = await response.json();
      if (payload.extract) {
        wikiCache.set(term, payload.extract);
        return payload.extract;
      }
    } catch (error) {
      log('debug', 'Wikipedia lookup failed for', term, error);
    }
    return null;
  }

  async function collectTermDefinitions(segments) {
    const candidates = extractTerms(segments);
    const definitions = {};
    await Promise.all(
      candidates.map(async (term) => {
        const summary = await fetchWikipediaDefinition(term);
        if (summary) {
          definitions[term] = summary;
        }
      })
    );
    return definitions;
  }

  function buildVerificationSnippet(primarySegments, translations) {
    if (!primarySegments?.length) {
      return '等待字幕校验数据。';
    }
    const snippetCount = Math.min(2, primarySegments.length);
    const lines = [];
    for (let i = 0; i < snippetCount; i++) {
      const base = primarySegments[i].text;
      const translationForLang = translations?.[SUPPORTED_LANGUAGES[0].code]?.[i];
      const translated = translationForLang?.translated || translationForLang?.original || '';
      lines.push(`${base} → ${translated}`);
    }
    return lines.join(' | ');
  }

  async function hydrateCache(videoId) {
    const stored = await storageGet(storageKey(videoId));
    if (stored) {
      primarySegments = stored.primarySegments || [];
      lastVerification = stored.verification || '';
      return stored;
    }
    return null;
  }

  async function persistCache(videoId, payload) {
    await storageSet(storageKey(videoId), payload);
  }

  async function processVideo(videoId) {
    currentVideoId = videoId;
    showStatus(`准备处理课程 ${videoId} 的字幕与翻译`);

    const cached = await hydrateCache(videoId);
    if (cached && cached.translations) {
      updateOverlay(cached.translations, cached.terms, cached.verification);
      showStatus(`已复用缓存的翻译与术语解释 (${videoId})`);
      return;
    }

    const tracks = await preloadTracks();
    const primary = pickPrimaryTrack(tracks);
    if (!primary) {
      showStatus('未找到任何字幕轨道，无法启动翻译。');
      return;
    }

    primarySegments = primary.segments;
    showStatus('字幕加载完成，开始翻译……');

    const translations = {};
    for (const language of SUPPORTED_LANGUAGES) {
      showStatus(`正在翻译为 ${language.label} …`);
      translations[language.code] = await translateSegments(primarySegments, language.code);
    }

    const verification = buildVerificationSnippet(primarySegments, translations);
    lastVerification = verification;

    showStatus('开始抓取专业术语解释…');
    const terms = await collectTermDefinitions(primarySegments);

    await persistCache(videoId, {
      primarySegments,
      translations,
      terms,
      verification
    });

    updateOverlay(translations, terms, verification);
    showStatus('翻译与术语解释准备就绪。');
  }

  function extractVideoId() {
    const snapshot = location.pathname.match(/lecture\/([^/?]+)/);
    if (snapshot && snapshot[1]) {
      return snapshot[1];
    }
    const segments = location.pathname.split('/').filter(Boolean);
    if (!segments.length) {
      return null;
    }
    return segments.slice(-2).join('-');
  }

  function startUrlWatcher() {
    setInterval(() => {
      if (location.href !== lastHref) {
        const previous = currentVideoId;
        lastHref = location.href;
        const newVideoId = extractVideoId();
        if (newVideoId && newVideoId !== previous) {
          scheduleCacheClear(previous);
          processVideo(newVideoId);
        }
      }
    }, 1600);
  }

  function monitorUnload() {
    window.addEventListener('beforeunload', () => {
      scheduleCacheClear(currentVideoId);
    });
  }

  function waitForVideo() {
    const video = document.querySelector('video');
    if (video) {
      return Promise.resolve(video);
    }
    return new Promise((resolve) => {
      const observer = new MutationObserver(() => {
        const nextVideo = document.querySelector('video');
        if (nextVideo) {
          clearTimeout(timeoutId);
          observer.disconnect();
          resolve(nextVideo);
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });
      const timeoutId = setTimeout(() => {
        observer.disconnect();
        log('warn', 'Video element still missing after', VIDEO_WAIT_TIMEOUT, 'ms');
        resolve(document.querySelector('video'));
      }, VIDEO_WAIT_TIMEOUT);
    });
  }

  async function run() {
    ensureOverlay();
    startUrlWatcher();
    monitorUnload();
    const videoElement = await waitForVideo();
    if (!videoElement) {
      showStatus('Coursera 视频加载缓慢，继续监听 DOM 变化…');
    }
    const videoId = extractVideoId();
    if (videoId) {
      processVideo(videoId);
    }
  }

  run().catch((error) => {
    log('error', 'Coursera translator failed', error);
    showStatus('出现异常，请打开控制台查看详情。');
  });
})();

