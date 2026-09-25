// 決定的なテスト: 実物の拡張を Chrome for Testing に読み込み、https://github.com/... の
// リクエストを tests/fixtures の擬似ページで応答する。github.com 以外へのリクエストは
// すべて記録して遮断する（=拡張が外部へ何も送らないことの確認を兼ねる）。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';
import { launch, setSettings, EXTENSION_DIR, REPO_DIR } from './browser.mjs';

const TEMPLATE = fs.readFileSync(path.join(REPO_DIR, 'tests/fixtures/repo.html'), 'utf8');
const glossary = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'dictionaries/glossary.ja.json'), 'utf8'));
const BASE = 'https://github.com';

// GitHub が meta[name="analytics-location"] に入れる値を、パスから作る
function analyticsFor(pathname) {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return '/dashboard';
  if (segments.length === 1) return segments[0] === 'acme' ? '/<org-login>' : '/<user-name>';
  if (['features', 'search'].includes(segments[0])) return `/${segments[0]}`;
  return `/<user-name>/<repo-name>${segments.length > 2 ? `/${segments.slice(2).join('/')}` : ''}`;
}

async function fixtureBrowser(options = {}) {
  const { context, extensionId } = await launch(options);
  const external = [];
  await context.route('**/*', (route) => {
    const url = new URL(route.request().url());
    // 拡張自身の同梱ファイル（辞書）は通す。外部への送信ではない
    if (url.protocol === 'chrome-extension:') return route.continue();
    if (url.origin === BASE) {
      return route.fulfill({
        status: 200,
        contentType: 'text/html; charset=utf-8',
        body: TEMPLATE.replace('{{ANALYTICS_LOCATION}}', analyticsFor(url.pathname))
      });
    }
    external.push(url.href);
    return route.abort();
  });
  return { context, extensionId, external };
}

async function open(context, pathname = '/octo/demo') {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(BASE + pathname);
  // 拡張の初回処理（辞書読み込み → 注釈）を待つ
  await page.waitForTimeout(600);
  page.extensionErrors = errors;
  return page;
}

const snapshot = (page) => page.evaluate(() => ({
  userContent: document.querySelector('#user-content').innerHTML,
  // ダイアログの見出しは固定UIなので注釈・翻訳の対象。キー表記（kbd）の行は変えてはいけない
  dialogKeys: document.querySelector('#shortcuts-dialog p').innerHTML,
  header: document.querySelector('#global-header').innerHTML,
  starLabel: document.querySelector('#star-button').getAttribute('aria-label'),
  afterContent: getComputedStyle(document.querySelector('#uses-after-label'), '::after').content
}));

const navTexts = (page) => page.$$eval('#repo-nav a > span[data-content]', (els) => els.map((el) => el.textContent));

// 拡張なしの同じページ（比較の基準）
let baseline;
before(async () => {
  const { context } = await fixtureBrowser({ extension: false });
  const page = await open(context);
  baseline = {
    ...(await snapshot(page)),
    navAria: await page.locator('#repo-nav').ariaSnapshot(),
    actionsAria: await page.locator('#pagehead-actions').ariaSnapshot(),
    readme: await page.$eval('#readme', (el) => el.innerHTML)
  };
  await context.close();
});

describe('learning mode (default)', () => {
  let browser;
  let page;
  before(async () => {
    browser = await fixtureBrowser();
    page = await open(browser.context);
  });
  after(() => browser.context.close());

  test('keeps the English label and adds the glossary Japanese once per element', async () => {
    assert.deepEqual(await navTexts(page), ['Code', 'Issues', 'Pull requests', 'Actions', 'Projects', 'Security', 'Insights', 'Settings']);
    const annotated = await page.$$eval('#repo-nav [data-ghja-src]', (els) => els.map((el) => [el.getAttribute('data-ghja-src'), el.getAttribute('data-ghja')]));
    assert.deepEqual(annotated, [
      ['Code', glossary.terms.Code.ja],
      ['Issues', glossary.terms.Issues.ja],
      ['Pull requests', glossary.terms['Pull requests'].ja],
      ['Actions', glossary.terms.Actions.ja],
      ['Projects', glossary.terms.Projects.ja],
      ['Security', glossary.terms.Security.ja],
      ['Insights', glossary.terms.Insights.ja],
      ['Settings', glossary.terms.Settings.ja]
    ]);
    // 画面に描かれている ::after の中身が注釈そのもの
    const rendered = await page.$eval('#repo-nav span[data-content="Pull requests"]', (el) => getComputedStyle(el, '::after').content);
    assert.match(rendered, /変更の取り込み依頼/);
  });

  test('annotates the fixed Pull request tabs, but not a PR title with the same words', async () => {
    assert.deepEqual(await page.$$eval('#pr-tabs [data-ghja-src]', (els) => els.map((el) => el.getAttribute('data-ghja-src'))), ['Conversation', 'Files changed']);
    assert.deepEqual(await page.$$eval('#pr-nav [data-ghja-src]', (els) => els.map((el) => el.getAttribute('data-ghja-src'))), ['Checks']);
    assert.equal(await page.$eval('#pr-title-link', (el) => el.hasAttribute('data-ghja-src')), false);
  });

  test('annotates the Fork and Watch buttons', async () => {
    assert.equal(await page.$eval('#fork-button', (el) => el.getAttribute('data-ghja')), glossary.terms.Fork.ja);
    assert.equal(await page.$eval('#watch-label', (el) => el.getAttribute('data-ghja')), glossary.terms.Watch.ja);
  });

  test('every annotation belongs to a text node of its own element (no duplicates, no stray labels)', async () => {
    const problems = await page.$$eval('[data-ghja-src]', (els) => els.filter((el) => {
      const own = [...el.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.nodeValue.replace(/\s+/g, ' ').trim());
      return !own.includes(el.getAttribute('data-ghja-src')) || el.querySelector('[data-ghja-src]') && el.querySelector('[data-ghja-src]').getAttribute('data-ghja-src') === el.getAttribute('data-ghja-src');
    }).map((el) => el.outerHTML));
    assert.deepEqual(problems, []);
  });

  test('does not override an ::after that GitHub already uses', async () => {
    const snap = await snapshot(page);
    assert.equal(snap.afterContent, baseline.afterContent);
    assert.equal(await page.$eval('#uses-after-label', (el) => el.hasAttribute('data-ghja')), false);
  });

  test('header items that cannot stack the label get the tooltip only (keeps the header within the viewport)', async () => {
    assert.equal(await page.$eval('#header-flex', (el) => el.getAttribute('data-ghja-src')), 'Explore');
    assert.equal(await page.$eval('#header-flex', (el) => el.hasAttribute('data-ghja')), false);
  });

  test('never touches user content, code, diff, dialogs or the search button', async () => {
    const snap = await snapshot(page);
    assert.equal(snap.userContent, baseline.userContent);
    assert.equal(snap.dialogKeys, baseline.dialogKeys);
    assert.equal(snap.header.replace(/ data-ghja(-src|-tip)?="[^"]*"/g, ''), baseline.header);
    assert.equal(await page.$$eval('#user-content [data-ghja-src], #search-button [data-ghja-src]', (els) => els.length), 0);
  });

  test('keeps accessible names and aria-labels exactly as GitHub wrote them', async () => {
    assert.equal(await page.locator('#repo-nav').ariaSnapshot(), baseline.navAria);
    assert.equal(await page.locator('#pagehead-actions').ariaSnapshot(), baseline.actionsAria);
    assert.equal((await snapshot(page)).starLabel, baseline.starLabel);
  });

  test('does not translate README by default', async () => {
    assert.equal(await page.$eval('#readme', (el) => el.innerHTML), baseline.readme);
    assert.equal(await page.$$eval('.ghja-tr', (els) => els.length), 0);
  });

  test('sends nothing outside github.com and throws no page errors', () => {
    assert.deepEqual(browser.external, []);
    assert.deepEqual(page.extensionErrors, []);
  });
});

describe('Japanese-first mode', () => {
  let browser;
  let page;
  before(async () => {
    browser = await fixtureBrowser();
    await setSettings(browser.context, browser.extensionId, { mode: 'ja' });
    page = await open(browser.context);
  });
  after(() => browser.context.close());

  test('replaces fixed UI with Japanese and keeps the English term visible', async () => {
    const texts = await navTexts(page);
    assert.equal(texts[2], glossary.terms['Pull requests'].ja);
    assert.equal(await page.$eval('#repo-nav span[data-content="Pull requests"]', (el) => el.getAttribute('data-ghja')), 'Pull requests');
    // 16文字を超える英語ラベルも添える（"Security and quality" のようなタブ名を落とさない）
    assert.equal(await page.$eval('#long-label span', (el) => el.textContent), glossary.terms['Merge pull request'].ja);
    assert.equal(await page.$eval('#long-label span', (el) => el.getAttribute('data-ghja')), 'Merge pull request');
  });

  test('user content, code and diff stay byte-for-byte identical even in the replacing mode', async () => {
    const snap = await snapshot(page);
    assert.equal(snap.userContent, baseline.userContent);
    assert.equal(snap.dialogKeys, baseline.dialogKeys);
    assert.equal(await page.$eval('#readme', (el) => el.innerHTML), baseline.readme);
  });

  test('converges: its own writes do not cause further mutations', async () => {
    const count = await page.evaluate(() => new Promise((resolve) => {
      let n = 0;
      const observer = new MutationObserver((records) => { n += records.length; });
      observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
      setTimeout(() => { observer.disconnect(); resolve(n); }, 1500);
    }));
    assert.equal(count, 0);
  });
});

describe('English-only mode', () => {
  test('leaves the page untouched but keeps the page guide', async () => {
    const browser = await fixtureBrowser();
    try {
      await setSettings(browser.context, browser.extensionId, { mode: 'original' });
      const page = await open(browser.context);
      assert.equal(await page.$$eval('[data-ghja-src]', (els) => els.length), 0);
      assert.deepEqual(await navTexts(page), ['Code', 'Issues', 'Pull requests', 'Actions', 'Projects', 'Security', 'Insights', 'Settings']);
      assert.match(await page.locator('ghja-assist .guide').textContent(), /Code/);
    } finally {
      await browser.context.close();
    }
  });
});

describe('dynamic DOM and SPA navigation', () => {
  let browser;
  let page;
  before(async () => {
    browser = await fixtureBrowser();
    page = await open(browser.context);
  });
  after(() => browser.context.close());

  test('annotates labels that appear later', async () => {
    await page.evaluate(() => {
      const a = document.createElement('a');
      a.href = '/octo/demo/wiki';
      a.innerHTML = '<span data-content="Wiki" id="late">Wiki</span>';
      document.querySelector('#repo-nav').append(a);
    });
    await page.waitForFunction(() => document.querySelector('#late')?.getAttribute('data-ghja'));
    assert.equal(await page.$eval('#late', (el) => el.getAttribute('data-ghja')), glossary.terms.Wiki.ja);
  });

  test('follows a label whose text changes, and drops a stale annotation', async () => {
    await page.evaluate(() => { document.querySelector('#watch-label').firstChild.nodeValue = 'Unwatch'; });
    await page.waitForFunction(() => document.querySelector('#watch-label').getAttribute('data-ghja-src') === 'Unwatch');
    assert.equal(await page.$eval('#watch-label', (el) => el.getAttribute('data-ghja')), 'ウォッチ解除');
    await page.evaluate(() => { document.querySelector('#watch-label').firstChild.nodeValue = 'octo/some-user-thing'; });
    await page.waitForFunction(() => !document.querySelector('#watch-label').hasAttribute('data-ghja-src'));
    assert.equal(await page.$eval('#watch-label', (el) => el.hasAttribute('data-ghja')), false);
  });

  test('drops a label when GitHub replaces, wraps or removes its text node', async () => {
    await page.waitForFunction(() => ['#stale-replace span', '#stale-wrap span', '#stale-remove'].every((s) => document.querySelector(s).hasAttribute('data-ghja')));
    await page.evaluate(() => {
      document.querySelector('#stale-replace span').replaceChildren(document.createTextNode('octo/some-user-thing'));
      const inner = document.createElement('span');
      inner.id = 'stale-wrap-inner';
      inner.textContent = 'Unwatch';
      document.querySelector('#stale-wrap span').replaceChildren(inner);
      document.querySelector('#stale-remove').firstChild.remove();
    });
    await page.waitForFunction(() => document.querySelector('#stale-wrap-inner')?.hasAttribute('data-ghja-src'));
    const state = await page.evaluate(() => ({
      replaced: document.querySelector('#stale-replace span').hasAttribute('data-ghja-src'),
      wrappedOuter: document.querySelector('#stale-wrap > span').hasAttribute('data-ghja-src'),
      wrappedInner: document.querySelector('#stale-wrap-inner').getAttribute('data-ghja-src'),
      removed: document.querySelector('#stale-remove').hasAttribute('data-ghja-src')
    }));
    assert.deepEqual(state, { replaced: false, wrappedOuter: false, wrappedInner: 'Unwatch', removed: false });
  });

  test('an element holding two dictionary words keeps one stable label', async () => {
    const result = await page.evaluate(async () => {
      const el = document.querySelector('#two-terms');
      let writes = 0;
      const observer = new MutationObserver((records) => { writes += records.length; });
      observer.observe(el, { attributes: true, attributeFilter: ['data-ghja-src', 'data-ghja', 'data-ghja-tip'] });
      for (let i = 0; i < 5; i++) {
        // 同じ値の再代入でも characterData の変化になり、この要素が再走査される
        el.lastChild.nodeValue = 'Issues';
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }
      observer.disconnect();
      return { writes, src: el.getAttribute('data-ghja-src') };
    });
    assert.deepEqual(result, { writes: 0, src: 'Code' });
  });

  test('survives a Turbo-style <body> replacement and a pushState navigation', async () => {
    await page.evaluate(() => {
      const body = document.createElement('body');
      body.innerHTML = '<nav aria-label="Repository"><a href="/octo/demo/issues"><span data-content="Issues" id="after-swap">Issues</span></a></nav>';
      document.body.replaceWith(body);
      history.pushState({}, '', '/octo/demo/issues');
    });
    await page.waitForFunction(() => document.querySelector('#after-swap')?.getAttribute('data-ghja'));
    await page.waitForFunction(() => document.querySelector('ghja-assist')?.shadowRoot.querySelector('.guide')?.textContent.startsWith('Issues'));
    // 同じ要素に二重に付かない
    assert.equal(await page.$$eval('[data-ghja-src="Issues"]', (els) => els.length), 1);
  });

  test('a burst of mutations is absorbed without a feedback loop', async () => {
    const result = await page.evaluate(async () => {
      const words = ['Code', 'Issues', 'Pull requests', 'Actions', 'Fork', 'Star', 'Watch', 'Unwatch', 'not-a-term', 'Settings'];
      const nav = document.createElement('nav');
      nav.id = 'storm';
      document.body.append(nav);
      const start = performance.now();
      for (let frame = 0; frame < 60; frame++) {
        for (let i = 0; i < 40; i++) {
          const b = document.createElement('button');
          b.textContent = words[(frame + i) % words.length];
          nav.append(b);
          if (nav.children.length > 200) nav.firstElementChild.remove();
          const t = nav.children[(frame * 7 + i) % nav.children.length].firstChild;
          if (t) t.nodeValue = words[(frame * 3 + i) % words.length];
        }
        await new Promise(requestAnimationFrame);
      }
      const stormMs = performance.now() - start;
      await new Promise((r) => setTimeout(r, 500));
      // 嵐が止んだ後、拡張自身の書き込みで変化が続いていないこと
      const quiet = await new Promise((resolve) => {
        let n = 0;
        const observer = new MutationObserver((records) => { n += records.length; });
        observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true });
        setTimeout(() => { observer.disconnect(); resolve(n); }, 1500);
      });
      const wrong = [...nav.querySelectorAll('button')].filter((b) => {
        const src = b.getAttribute('data-ghja-src');
        return src !== null && src !== b.textContent;
      }).length;
      const unannotated = [...nav.querySelectorAll('button')].filter((b) => b.textContent !== 'not-a-term' && !b.hasAttribute('data-ghja-src')).length;
      return { stormMs, quiet, wrong, unannotated, buttons: nav.children.length };
    });
    console.log('mutation storm:', JSON.stringify(result));
    assert.equal(result.quiet, 0);
    assert.equal(result.wrong, 0);
    assert.equal(result.unannotated, 0);
  });
});

describe('concept tooltips', () => {
  let browser;
  let page;
  before(async () => {
    browser = await fixtureBrowser();
    page = await open(browser.context);
  });
  after(() => browser.context.close());

  const tip = () => page.locator('ghja-assist .tip');

  test('hovering a GitHub term explains the concept', async () => {
    await page.hover('#repo-nav span[data-content="Pull requests"]');
    await page.waitForTimeout(600);
    assert.equal(await tip().isVisible(), true);
    assert.match(await tip().textContent(), /Pull requests/);
    assert.match(await tip().textContent(), /Branch/);
    // ツールチップの上へポインタを移しても閉じない（WCAG 1.4.13）
    const box = await tip().boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 5 });
    await page.waitForTimeout(500);
    assert.equal(await tip().isVisible(), true);
    // 右端には注釈の付いた要素が無い（固定UIのリンクやボタンはすべて左寄せ）
    assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(1270, 5)?.closest('[data-ghja-src], ghja-assist'))), false);
    await page.mouse.move(1270, 5);
    await page.waitForTimeout(500);
    assert.equal(await tip().isVisible(), false);
  });

  test('keyboard focus shows it, Escape hides it and still reaches GitHub', async () => {
    await page.focus('#repo-nav a[href="/octo/demo/actions"]');
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);
    assert.equal(await tip().isVisible(), true);
    assert.match(await tip().textContent(), /Actions/);
    await page.keyboard.press('Escape');
    assert.equal(await tip().isVisible(), false);
    assert.ok((await page.evaluate(() => window.__keys)).includes('Escape'));
  });

  test('can be switched off without reloading', async () => {
    await setSettings(browser.context, browser.extensionId, { tooltips: false });
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => document.documentElement.hasAttribute('data-ghja-tips')), false);
    await page.hover('#repo-nav span[data-content="Issues"]');
    await page.waitForTimeout(600);
    assert.equal(await tip().isVisible(), false);
    await setSettings(browser.context, browser.extensionId, { tooltips: true });
  });
});

describe('page guide', () => {
  let browser;
  before(async () => { browser = await fixtureBrowser(); });
  after(() => browser.context.close());

  const cases = [
    ['/octo/demo', 'code'],
    ['/octo/demo/tree/main/src', 'code'],
    ['/octo/demo/blob/main/README.md', 'file'],
    ['/octo/demo/issues', 'issues'],
    ['/octo/demo/issues/1', 'issue'],
    ['/octo/demo/pulls', 'pulls'],
    ['/octo/demo/pull/2/files', 'pull'],
    ['/octo/demo/actions', 'actions'],
    ['/octo/demo/projects', 'projects'],
    ['/octo/demo/security', 'security'],
    ['/octo/demo/pulse', 'insights'],
    ['/octo/demo/settings', 'settings'],
    ['/octo/demo/commits/main', 'commits'],
    ['/orgs/acme/projects/7', 'projects'],
    ['/octo', 'profile'],
    ['/acme', 'org'],
    ['/search?q=test', 'search']
  ];
  for (const [pathname, key] of cases) {
    test(`${pathname} → ${key}`, async () => {
      const page = await open(browser.context, pathname);
      const text = await page.locator('ghja-assist .guide').textContent();
      assert.equal(text, `${glossary.pages[key].title} ${glossary.pages[key].ja}`);
      await page.close();
    });
  }

  test('marketing pages that look like /owner/repo get no guide', async () => {
    const page = await open(browser.context, '/features/copilot');
    assert.equal(await page.locator('ghja-assist .guide').isVisible(), false);
    await page.close();
  });

  test('expands to a description, and closes for the tab', async () => {
    const page = await open(browser.context, '/octo/demo/actions');
    await page.click('ghja-assist .guide');
    assert.equal(await page.locator('ghja-assist .desc').textContent(), glossary.pages.actions.description);
    assert.equal(await page.locator('ghja-assist .guide').getAttribute('aria-expanded'), 'true');
    await page.click('ghja-assist .close');
    assert.equal(await page.locator('ghja-assist .panel').isVisible(), false);
    await page.close();
  });
});

describe('README / Issue / PR body translation', () => {
  let browser;
  let page;
  before(async () => {
    browser = await fixtureBrowser();
    page = await open(browser.context);
    // 翻訳のDOM処理を、偽の翻訳器で検証するためにページ側にも読み込む（拡張本体とは別の実行環境）
    await page.addScriptTag({ path: path.join(EXTENSION_DIR, 'content-translate.js') });
  });
  after(() => browser.context.close());

  test('adds translations next to the original, never inside code, and removes them cleanly', async () => {
    const result = await page.evaluate(async () => {
      const readme = document.querySelector('#readme');
      const before = readme.innerHTML;
      const seen = [];
      const fake = {
        async translate(text) {
          seen.push(text);
          return `訳:${text}`;
        }
      };
      const count = await window.GitHubJaContentTranslate.translateBodies(fake);
      const translations = [...readme.querySelectorAll('.ghja-tr')].map((d) => ({
        text: d.textContent,
        codes: [...d.querySelectorAll('code')].map((c) => c.textContent),
        after: d.previousElementSibling?.tagName || d.parentElement.tagName,
        lang: d.lang,
        translate: d.getAttribute('translate')
      }));
      const preUnchanged = [...readme.querySelectorAll('pre')].every((pre) => !pre.querySelector('.ghja-tr'));
      const again = await window.GitHubJaContentTranslate.translateBodies(fake);
      window.GitHubJaContentTranslate.removeTranslations();
      return { count, again, seen, translations, preUnchanged, restored: readme.innerHTML === before };
    });
    assert.equal(result.count, 5);
    assert.equal(result.again, 0, 'pressing twice must not duplicate translations');
    assert.ok(result.seen.includes('Press the `Fork` button, then run `npm install` and open a Pull request.'));
    assert.ok(!result.seen.some((t) => t.includes('must never change')), 'code blocks are not sent to the translator');
    assert.ok(!result.seen.some((t) => t.includes('日本語')), 'Japanese paragraphs are skipped');
    const inline = result.translations.find((t) => t.codes.length);
    assert.deepEqual(inline.codes, ['Fork', 'npm install']);
    assert.ok(result.translations.every((t) => t.lang === 'ja' && t.translate === 'no'));
    assert.equal(result.preUnchanged, true);
    assert.equal(result.restored, true);
  });

  // 「クリックしたときだけ」はここでは示せない（CfT にはモデルが無いので自動翻訳しても何も起きない）。
  // それは source hygiene の静的検査で確かめる。ここで示すのはクリック後の準備と中止
  test('clicking the button starts model preparation and can be cancelled', async () => {
    const button = page.locator('ghja-assist button', { hasText: /本文/ });
    assert.equal(await button.textContent(), '本文を日本語で読む');
    await button.click();
    // Chrome for Testing には翻訳モデルが配信されないので create() は終わらない。中止できることを確かめる
    await page.waitForFunction(() => document.querySelector('ghja-assist').shadowRoot.querySelector('.status').textContent.includes('翻訳モデル'));
    const cancel = page.locator('ghja-assist button', { hasText: '翻訳を中止' });
    await cancel.click();
    await page.waitForFunction(() => document.querySelector('ghja-assist').shadowRoot.querySelector('.status').textContent.includes('中止'));
    assert.equal(await page.$$eval('.ghja-tr', (els) => els.length), 0);
    assert.deepEqual(browser.external, []);
  });
});

describe('popup settings', () => {
  test('defaults to the learning mode and stores every setting', async () => {
    const { context, extensionId } = await launch();
    try {
      const page = await context.newPage();
      await page.goto(`chrome-extension://${extensionId}/popup.html`);
      // ポップアップは言語一覧を読み込んでから設定を反映する。反映を待つ
      await page.waitForFunction(() => document.querySelector('input[name="mode"]:checked'));
      assert.equal(await page.isChecked('input[name="mode"][value="learn"]'), true);
      for (const id of ['#toggle', '#tooltips-toggle', '#page-guide-toggle', '#content-translation-toggle']) {
        assert.equal(await page.isChecked(id), true, id);
      }
      await page.check('input[name="mode"][value="ja"]');
      // チェックボックス本体は見た目上隠れている（上流のスイッチ表示）。利用者と同じくラベルを押す
      await page.click('label[for="page-guide-toggle"]');
      await page.waitForTimeout(200);
      const stored = await page.evaluate(() => chrome.storage.local.get(null));
      assert.equal(stored.mode, 'ja');
      assert.equal(stored.pageGuide, false);
      // すべての入力にラベルが付いている
      const unlabelled = await page.$$eval('input', (inputs) => inputs.filter((i) => !i.labels?.length && !i.getAttribute('aria-label')).map((i) => i.id || i.name));
      assert.deepEqual(unlabelled, []);
    } finally {
      await context.close();
    }
  });
});

describe('Edge (built-in translator unavailable for en→ja)', () => {
  test('shows the body-translation button as unsupported instead of failing', async (t) => {
    let context;
    try {
      context = await chromium.launchPersistentContext('', {
        channel: 'msedge',
        headless: true,
        args: [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`]
      });
    } catch (e) {
      t.skip(`Microsoft Edge is not available: ${e.message.split('\n')[0]}`);
      return;
    }
    try {
      const external = [];
      await context.route('**/*', (route) => {
        const url = new URL(route.request().url());
        if (url.protocol === 'chrome-extension:') return route.continue();
        if (url.origin === BASE) return route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8', body: TEMPLATE.replace('{{ANALYTICS_LOCATION}}', analyticsFor(url.pathname)) });
        external.push(url.href);
        return route.abort();
      });
      const page = await open(context);
      const availability = await page.evaluate(() => self.Translator ? Translator.availability({ sourceLanguage: 'en', targetLanguage: 'ja' }) : 'missing');
      if (availability !== 'unavailable' && availability !== 'missing') {
        t.skip(`this Edge reports ${availability} for en→ja, so the unsupported path cannot be exercised here`);
        return;
      }
      const button = page.locator('ghja-assist button', { hasText: /本文/ });
      assert.equal(await button.textContent(), '本文翻訳: 非対応');
      assert.equal(await button.getAttribute('aria-disabled'), 'true');
      // aria-disabled でも押せる（押すと理由を表示する）ようにしてある。Playwright は aria-disabled を押さないので force
      await button.click({ force: true });
      assert.match(await page.locator('ghja-assist .status').textContent(), /Translator API/);
      assert.equal(await page.$$eval('.ghja-tr', (els) => els.length), 0);
      assert.deepEqual(external, []);
    } finally {
      await context.close();
    }
  });
});

describe('source hygiene', () => {
  const read = (file) => fs.readFileSync(path.join(EXTENSION_DIR, file), 'utf8');

  test('manifest asks for storage only', () => {
    const manifest = JSON.parse(read('manifest.json'));
    assert.deepEqual(manifest.permissions, ['storage']);
    assert.equal(manifest.host_permissions, undefined);
    assert.equal(manifest.background, undefined);
    assert.equal(manifest.externally_connectable, undefined);
    assert.deepEqual(manifest.content_scripts[0].matches, ['https://github.com/*']);
  });

  test('the translator is created and bodies are translated only inside the button click handler', () => {
    const source = read('assist.js');
    const start = source.indexOf("translateButton.addEventListener('click'");
    const end = source.indexOf('// ---- SPA遷移', start);
    assert.ok(start > 0 && end > start, 'click handler found');
    for (const call of [/Translator\.create\(/g, /translateBodies\(/g]) {
      const positions = [...source.matchAll(call)].map((m) => m.index);
      assert.ok(positions.length > 0, `${call} is used`);
      assert.ok(positions.every((p) => p > start && p < end), `${call} appears only inside the click handler`);
    }
    for (const file of ['content.js', 'shared.js', 'popup.js', 'options.js', 'content-translate.js']) {
      assert.doesNotMatch(read(file), /Translator\.create\(/, file);
    }
    // content-translate.js は translateBodies を定義するだけで、自分では呼ばない
    assert.equal([...read('content-translate.js').matchAll(/translateBodies\(/g)].length, 1);
  });

  test('no HTML injection APIs and no network calls except bundled files', () => {
    for (const file of ['content.js', 'content-translate.js', 'assist.js', 'shared.js', 'popup.js', 'options.js']) {
      const source = read(file);
      assert.doesNotMatch(source, /\.innerHTML\s*\+?=|outerHTML\s*\+?=|insertAdjacentHTML|setHTMLUnsafe|createContextualFragment|parseFromString|document\.write|\beval\(|new Function/, file);
      assert.doesNotMatch(source, /XMLHttpRequest|WebSocket|sendBeacon|EventSource/, file);
      for (const match of source.matchAll(/fetch\(([^)]*)\)/g)) {
        assert.match(match[1], /chrome\.runtime\.getURL|^url$/, `${file}: ${match[0]}`);
      }
    }
  });
});
