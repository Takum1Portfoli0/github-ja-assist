// 拡張機能内で共有する辞書・言語・UIローカライズ処理
(() => {
  function stripJsonComments(text) {
    return text
      .split('\n')
      .filter((line) => !/^\s*\/\//.test(line))
      .join('\n');
  }

  async function loadLanguages() {
    const url = chrome.runtime.getURL('languages.json');
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to load languages: ${res.status}`);

    const data = await res.json();
    if (!Array.isArray(data.languages)) throw new Error('Invalid languages.json');
    return data.languages;
  }

  // 学習用グロッサリー（日本語のみ）。aliases は同じ項目への別表記として展開する。
  // content.js と assist.js の両方から呼ばれるので、読み込みは1回に共有する
  let glossaryPromise = null;
  function loadGlossary() {
    glossaryPromise ||= (async () => {
      const res = await fetch(chrome.runtime.getURL('dictionaries/glossary.ja.json'));
      if (!res.ok) throw new Error(`Failed to load glossary: ${res.status}`);
      const data = await res.json();
      // プロトタイプなしにする（"toString" 等の画面上の文字列を誤ってヒットさせない）
      const terms = Object.create(null);
      for (const [key, term] of Object.entries(data.terms || {})) {
        for (const name of [key, ...(term.aliases || [])]) {
          terms[name] = { src: key, ja: term.ja, description: term.description };
        }
      }
      return {
        terms,
        pages: Object.assign(Object.create(null), data.pages),
        labels: Object.assign(Object.create(null), data.labels)
      };
    })();
    return glossaryPromise;
  }

  // /owner や /owner/repo の形に見えるが、ユーザーやリポジトリではない GitHub 自身のページの先頭部分。
  // 漏れても「その固定リンクに日本語が付かない」だけで、安全側に倒れる
  const RESERVED_TOP_LEVEL = new Set([
    'about', 'accelerator', 'account', 'achievements', 'advisories', 'ai', 'apps', 'codespaces', 'collections', 'contact',
    'copilot', 'customer-stories', 'dashboard', 'discussions', 'enterprise', 'enterprises', 'events',
    'education', 'explore', 'features', 'github-copilot', 'home', 'issues', 'join', 'login', 'logout', 'marketplace',
    'mcp', 'mobile', 'models', 'new', 'newsroom', 'nonprofit', 'notifications', 'open-source', 'organizations', 'orgs', 'partners',
    'password_reset', 'premium-support', 'pricing', 'pulls', 'readme', 'repos', 'resources', 'search',
    'security', 'sessions', 'settings', 'signup', 'site', 'solutions', 'sponsors', 'stars', 'team',
    'topics', 'trending', 'users', 'watching', 'why-github'
  ]);

  function isReservedTopLevel(segment) {
    return RESERVED_TOP_LEVEL.has(String(segment).toLowerCase());
  }

  function getMessage(key, substitutions) {
    return chrome.i18n.getMessage(key, substitutions) || key;
  }

  function localizeDocument() {
    const uiLanguage = chrome.i18n.getUILanguage();
    document.documentElement.lang = uiLanguage ? uiLanguage.split('-')[0] : 'en';

    document.querySelectorAll('[data-i18n]').forEach((el) => {
      el.textContent = getMessage(el.dataset.i18n);
    });
    document.querySelectorAll('[data-i18n-aria-label]').forEach((el) => {
      el.setAttribute('aria-label', getMessage(el.dataset.i18nAriaLabel));
    });
  }

  globalThis.GitHubUITranslator = {
    getMessage,
    isReservedTopLevel,
    loadGlossary,
    loadLanguages,
    localizeDocument,
    stripJsonComments
  };
})();
