// GitHub 日本語アシスト - 用語の説明ツールチップ・ページガイド・本文翻訳ボタン
//
// - 画面に足すUIは1つのShadow DOMに閉じ込め、GitHubのCSSと互いに干渉させない
// - GitHubのDOMは読むだけ。ツールチップの対象は content.js が付けた data-ghja-src 属性
// - 本文翻訳はボタンを押したときだけ、Chrome内蔵の Translator API（端末内処理）で行う。
//   外部へは何も送らない。APIが無い・使えない環境では非対応と表示するだけ
(() => {
  const { isReservedTopLevel, loadGlossary } = globalThis.GitHubUITranslator;
  const { collectBlocks, removeTranslations, translateBodies } = globalThis.GitHubJaContentTranslate;

  const DEFAULTS = {
    enabled: true,
    language: 'ja',
    mode: 'learn',
    tooltips: true,
    pageGuide: true,
    contentTranslation: true
  };
  const TIP_DELAY_MS = 400;
  // 翻訳モデルの準備（ダウンロード）が進まないまま、これ以上は待たない
  const MODEL_STALL_MS = 60000;

  // どのURLがどのページか。説明文は dictionaries/glossary.ja.json の pages にある
  const SITE_PAGES = [
    [/^\/search(\/|$)/, 'search'],
    [/^\/notifications(\/|$)/, 'notifications'],
    [/^\/settings(\/|$)/, 'user-settings'],
    [/^\/new$/, 'new-repo'],
    [/^\/(orgs|users)\/[^/]+\/projects(\/|$)/, 'projects'],
    [/^\/orgs\/[^/]+(\/|$)/, 'org']
  ];
  // リポジトリ内のパス（/owner/repo より後ろ）
  const REPO_PAGES = [
    [/^\/?$/, 'code'],
    [/^\/tree\//, 'code'],
    [/^\/blob\//, 'file'],
    [/^\/commits(\/|$)/, 'commits'],
    [/^\/commit\//, 'commit'],
    [/^\/branches(\/|$)/, 'branches'],
    [/^\/(releases|tags)(\/|$)/, 'releases'],
    [/^\/issues\/\d+/, 'issue'],
    [/^\/issues(\/|$)/, 'issues'],
    [/^\/pull\/\d+/, 'pull'],
    [/^\/pulls(\/|$)/, 'pulls'],
    [/^\/compare(\/|$)/, 'compare'],
    [/^\/actions(\/|$)/, 'actions'],
    [/^\/projects(\/|$)/, 'projects'],
    [/^\/security(\/|$)/, 'security'],
    [/^\/(pulse|graphs|network|community|forks)(\/|$)/, 'insights'],
    [/^\/settings(\/|$)/, 'settings'],
    [/^\/discussions(\/|$)/, 'discussions'],
    [/^\/wiki(\/|$)/, 'wiki'],
    [/^\/fork$/, 'fork']
  ];
  // README・Issue・PR等の本文が出うるページ（本文翻訳ボタンを出す）
  const BODY_PAGES = new Set(['code', 'file', 'issue', 'pull', 'releases', 'discussions', 'wiki', 'profile', 'org']);

  function detectPage() {
    // 存在しないページ（404）には説明を出さない
    if (document.title.startsWith('Page not found')) return null;
    const path = location.pathname.replace(/\/+$/, '') || '/';
    if (path === '/') return document.body?.classList.contains('logged-in') ? 'dashboard' : null;
    for (const [pattern, key] of SITE_PAGES) if (pattern.test(path)) return key;
    const segments = path.split('/').filter(Boolean);
    if (isReservedTopLevel(segments[0])) return null;
    // GitHubがページ種別を載せている meta（例: "/<user-name>/<repo-name>/issues"）
    const analyticsLocation = document.querySelector('meta[name="analytics-location"]')?.content || '';
    if (segments.length === 1) {
      if (analyticsLocation.includes('<org-login>')) return 'org';
      return analyticsLocation.includes('<user-name>') ? 'profile' : null;
    }
    if (analyticsLocation && !analyticsLocation.includes('<repo-name>')) return null;
    const rest = `/${segments.slice(2).join('/')}`;
    for (const [pattern, key] of REPO_PAGES) if (pattern.test(rest)) return key;
    return null;
  }

  let settings = { ...DEFAULTS };
  let glossary = { terms: Object.create(null), pages: Object.create(null) };

  // ---- Shadow DOM ----
  const host = document.createElement('ghja-assist');
  const shadow = host.attachShadow({ mode: 'open' });
  const style = document.createElement('style');
  // 色はGitHubのCSS変数（Shadow DOMにも継承される）を使い、ライト/ダーク両方に追従する
  style.textContent = `
    :host { all: initial; }
    .tip, .panel {
      font: 12px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans JP", "Hiragino Sans", Meiryo, sans-serif;
      color: var(--fgColor-default, #1f2328);
      background: var(--overlay-bgColor, var(--bgColor-default, #ffffff));
      border: 1px solid var(--borderColor-default, #d1d9e0);
      box-shadow: var(--shadow-floating-small, 0 1px 3px rgba(31, 35, 40, 0.12));
      box-sizing: border-box;
    }
    [hidden] { display: none !important; }
    .tip {
      position: fixed;
      z-index: 2147483647;
      max-width: min(340px, calc(100vw - 16px));
      padding: 8px 10px;
      border-radius: 6px;
    }
    .tip p { margin: 4px 0 0; }
    .muted { color: var(--fgColor-muted, #59636e); }
    .ja { margin-inline-start: 6px; }
    .panel {
      position: fixed;
      left: 16px;
      bottom: 16px;
      z-index: 2147483646;
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: 2px 4px;
      max-width: min(380px, calc(100vw - 32px));
      padding: 3px;
      border-radius: 8px;
    }
    button {
      font: inherit;
      color: inherit;
      background: none;
      border: 0;
      border-radius: 6px;
      padding: 3px 8px;
      cursor: pointer;
    }
    button:hover { background: var(--bgColor-neutral-muted, rgba(175, 184, 193, 0.2)); }
    button:focus-visible { outline: 2px solid var(--focus-outlineColor, #0969da); outline-offset: 1px; }
    button[aria-disabled="true"] { cursor: default; color: var(--fgColor-muted, #59636e); }
    .guide { font-weight: 600; }
    .close { color: var(--fgColor-muted, #59636e); padding: 3px 6px; }
    .desc, .status { flex-basis: 100%; margin: 0; padding: 0 8px 4px; }
  `;

  const tip = document.createElement('div');
  tip.className = 'tip';
  // 視覚的な補助。GitHub本来のアクセシブルネーム・説明には関連付けない
  tip.setAttribute('aria-hidden', 'true');
  tip.hidden = true;

  const panel = document.createElement('div');
  panel.className = 'panel';
  panel.setAttribute('role', 'region');
  panel.setAttribute('aria-label', 'GitHub 日本語アシスト');
  panel.hidden = true;
  const guideButton = document.createElement('button');
  guideButton.type = 'button';
  guideButton.className = 'guide';
  guideButton.setAttribute('aria-expanded', 'false');
  const translateButton = document.createElement('button');
  translateButton.type = 'button';
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'close';
  closeButton.textContent = '×';
  closeButton.setAttribute('aria-label', 'このタブではアシストを閉じる');
  const desc = document.createElement('p');
  desc.className = 'desc muted';
  desc.hidden = true;
  const status = document.createElement('p');
  status.className = 'status muted';
  status.setAttribute('role', 'status');
  status.hidden = true;
  panel.append(guideButton, translateButton, closeButton, desc, status);
  shadow.append(style, tip, panel);

  // ---- ツールチップ ----
  let tipTimer = 0;
  let hideTimer = 0;
  let tipTarget = null;

  function hideTip() {
    clearTimeout(tipTimer);
    clearTimeout(hideTimer);
    tipTarget = null;
    tip.hidden = true;
  }

  function githubTooltipOpen() {
    try {
      return Boolean(document.querySelector('[role="tooltip"]:popover-open'));
    } catch {
      return false;
    }
  }

  function showTip(target) {
    // GitHub 自身のツールチップや、開いているメニュー（ヘッダーのメガメニュー等）の上には重ねない
    if (!target.isConnected || githubTooltipOpen() || target.closest('[aria-expanded="true"]')) return;
    const src = target.getAttribute('data-ghja-src');
    const term = glossary.terms[src];
    const label = term?.ja || globalThis.GitHubUITranslator.lookup?.(src) || '';
    const inlineShown = target.hasAttribute('data-ghja');
    // 画面に出ていない情報（説明、または横に出しきれなかった長い訳）があるときだけ出す
    if (!term?.description && (inlineShown || !label || label === src)) return;

    tip.replaceChildren();
    const title = document.createElement('div');
    const strong = document.createElement('b');
    strong.textContent = src;
    title.append(strong);
    if (label && label !== src) {
      const ja = document.createElement('span');
      ja.className = 'ja muted';
      ja.textContent = label;
      title.append(ja);
    }
    tip.append(title);
    if (term?.description) {
      const p = document.createElement('p');
      p.textContent = term.description;
      tip.append(p);
    }

    tip.style.visibility = 'hidden';
    tip.hidden = false;
    const rect = target.getBoundingClientRect();
    const { width, height } = tip.getBoundingClientRect();
    const below = rect.bottom + 6;
    const top = below + height <= window.innerHeight - 8 ? below : Math.max(8, rect.top - 6 - height);
    const left = Math.min(Math.max(8, rect.left), window.innerWidth - width - 8);
    tip.style.top = `${top}px`;
    tip.style.left = `${Math.max(8, left)}px`;
    tip.style.visibility = '';
  }

  function scheduleTip(target) {
    if (target === tipTarget) return;
    hideTip();
    if (!target || !settings.tooltips) return;
    tipTarget = target;
    tipTimer = setTimeout(() => showTip(target), TIP_DELAY_MS);
  }

  document.addEventListener('mouseover', (event) => {
    // ポインタをツールチップの上へ移しても閉じない（WCAG 1.4.13）。Shadow DOM 内の
    // イベントは host 要素から来たものとして届く
    if (event.target === host) {
      clearTimeout(hideTimer);
      return;
    }
    const target = event.target instanceof Element ? event.target.closest('[data-ghja-src]') : null;
    if (target && target === tipTarget) {
      clearTimeout(hideTimer);
      return;
    }
    if (!target && !tip.hidden) {
      // 用語からツールチップへ移る途中の隙間で閉じてしまわないよう、少し待ってから閉じる
      clearTimeout(hideTimer);
      hideTimer = setTimeout(hideTip, 300);
      return;
    }
    scheduleTip(target);
  }, { passive: true });

  // キーボードで移動したときも、フォーカスしたリンクやボタンの説明を出す
  document.addEventListener('focusin', (event) => {
    const el = event.target;
    if (!(el instanceof Element) || !settings.tooltips) return;
    if (!el.matches(':focus-visible') || !el.matches('a, button, summary, [role="tab"], [role="menuitem"], [role="button"]')) return;
    const target = el.matches('[data-ghja-src]') ? el : el.querySelector('[data-ghja-src]');
    if (!target) return;
    hideTip();
    tipTarget = target;
    showTip(target);
  });
  document.addEventListener('focusout', hideTip);
  // Escapeは閉じるだけで、GitHub側のショートカット処理には渡したままにする
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') hideTip();
  }, { passive: true });
  document.addEventListener('pointerdown', hideTip, { passive: true, capture: true });
  window.addEventListener('scroll', hideTip, { passive: true, capture: true });

  // ---- ページガイドと本文翻訳ボタン ----
  let dismissed = false;
  let expanded = false;
  let running = null;
  let availability = null;

  function translatorAvailability() {
    if (!('Translator' in self)) return Promise.resolve('unsupported');
    availability ||= Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' })
      .catch(() => 'unavailable');
    return availability;
  }

  function setStatus(text) {
    status.textContent = text || '';
    status.hidden = !text;
  }

  async function renderPanel() {
    const pageKey = detectPage();
    const page = settings.pageGuide && pageKey ? glossary.pages[pageKey] : null;
    const wantsTranslate = settings.contentTranslation &&
      (BODY_PAGES.has(pageKey) || Boolean(document.querySelector('.markdown-body')));

    if (!settings.enabled || dismissed || (!page && !wantsTranslate)) {
      panel.hidden = true;
      return;
    }

    guideButton.hidden = !page;
    if (page) {
      guideButton.replaceChildren();
      const title = document.createElement('span');
      title.textContent = page.title;
      const ja = document.createElement('span');
      ja.className = 'ja muted';
      ja.textContent = page.ja;
      // 間に空白を入れる（読み上げが "Codeコード" と続けて読まないように）
      guideButton.append(title, ' ', ja);
      guideButton.setAttribute('aria-expanded', String(expanded));
      desc.textContent = page.description;
      desc.hidden = !expanded;
    } else {
      desc.hidden = true;
    }

    translateButton.hidden = !wantsTranslate;
    if (wantsTranslate) {
      if (running) {
        translateButton.textContent = '翻訳を中止';
        translateButton.removeAttribute('aria-disabled');
      } else if (document.querySelector('.ghja-tr')) {
        translateButton.textContent = '訳を消す';
        translateButton.removeAttribute('aria-disabled');
      } else {
        const state = await translatorAvailability();
        const unsupported = state === 'unsupported' || state === 'unavailable';
        translateButton.textContent = unsupported ? '本文翻訳: 非対応' : '本文を日本語で読む';
        if (unsupported) translateButton.setAttribute('aria-disabled', 'true');
        else translateButton.removeAttribute('aria-disabled');
      }
    }
    panel.hidden = false;
  }

  let renderScheduled = false;
  function scheduleRender() {
    if (renderScheduled) return;
    renderScheduled = true;
    requestAnimationFrame(() => {
      renderScheduled = false;
      renderPanel();
    });
  }

  // 開閉は即座に反映する（aria-expanded を次のフレームまで待たせない）
  guideButton.addEventListener('click', () => {
    expanded = !expanded;
    guideButton.setAttribute('aria-expanded', String(expanded));
    desc.hidden = !expanded;
  });

  closeButton.addEventListener('click', () => {
    dismissed = true;
    hideTip();
    panel.hidden = true;
  });

  translateButton.addEventListener('click', async () => {
    if (running) {
      running.abort();
      return;
    }
    if (document.querySelector('.ghja-tr')) {
      removeTranslations();
      setStatus('');
      scheduleRender();
      return;
    }
    if (translateButton.getAttribute('aria-disabled') === 'true') {
      setStatus('このブラウザでは端末内翻訳（Chrome の Translator API、Chrome 138 以降のデスクトップ版）が使えないため、本文翻訳はできません。');
      return;
    }
    if (collectBlocks().length === 0) {
      setStatus('このページには翻訳できる英語の本文が見つかりませんでした。');
      return;
    }

    const controller = new AbortController();
    running = controller;
    let stall = setTimeout(() => controller.abort(), MODEL_STALL_MS);
    scheduleRender();
    let translator = null;
    try {
      setStatus('翻訳モデルを準備しています…');
      // create() はクリック直後（ユーザー操作の有効期間内）に呼ぶ。初回はモデルのダウンロードを伴う
      translator = await Translator.create({
        sourceLanguage: 'en',
        targetLanguage: 'ja',
        signal: controller.signal,
        monitor(monitor) {
          monitor.addEventListener('downloadprogress', (event) => {
            clearTimeout(stall);
            stall = setTimeout(() => controller.abort(), MODEL_STALL_MS);
            setStatus(`翻訳モデルをダウンロードしています… ${Math.round(event.loaded * 100)}%`);
          });
        }
      });
      clearTimeout(stall);
      const count = await translateBodies(translator, {
        signal: controller.signal,
        onProgress: (done, total) => setStatus(`翻訳しています… ${done} / ${total}`)
      });
      setStatus(controller.signal.aborted ? '翻訳を中止しました。' : `${count} 段落を翻訳しました（端末内で処理）。`);
    } catch (e) {
      setStatus(controller.signal.aborted
        ? '翻訳を中止しました（翻訳モデルの準備が進まない場合は、Chrome を最新版にしてから再度お試しください）。'
        : `翻訳できませんでした: ${e.message}`);
    } finally {
      // 中止・失敗のときも翻訳器を解放する
      translator?.destroy?.();
      clearTimeout(stall);
      running = null;
      scheduleRender();
    }
  });

  // ---- SPA遷移・設定変更への追従 ----
  let lastUrl = location.href;
  function onNavigate() {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      expanded = false;
      setStatus('');
    }
    hideTip();
    scheduleRender();
  }
  for (const type of ['turbo:load', 'turbo:render', 'soft-nav:end', 'soft-nav:react-done']) {
    document.addEventListener(type, onNavigate);
  }
  window.addEventListener('popstate', onNavigate);
  window.addEventListener('pageshow', onNavigate);
  if (self.navigation) navigation.addEventListener('currententrychange', onNavigate);

  function applySettings() {
    document.documentElement.toggleAttribute('data-ghja-tips', settings.enabled && settings.tooltips);
    if (!settings.tooltips) hideTip();
    scheduleRender();
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    for (const [key, { newValue }] of Object.entries(changes)) {
      if (key in DEFAULTS) settings[key] = newValue ?? DEFAULTS[key];
    }
    applySettings();
  });

  (async () => {
    settings = await chrome.storage.local.get(DEFAULTS);
    // 日本語以外の辞書を選んでいるときは、日本語の学習補助（説明・ガイド・本文翻訳）は出さない
    if (!settings.enabled || settings.language !== 'ja') return;
    try {
      glossary = await loadGlossary();
    } catch (e) {
      console.error('[GitHub 日本語アシスト] グロッサリーの読み込みに失敗しました', e);
    }
    document.documentElement.append(host);
    applySettings();
  })();
})();
