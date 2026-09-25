// 実際の github.com（公開リポジトリ・未ログイン）で拡張を動かすテスト。読み取りのみで、
// 何かを作成・変更する操作はしない。ネットワークとGitHubの画面に依存するので、
// GitHub側の変更で落ちることがある（そのときは tests/out/live/ のスクリーンショットを見る）。
import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, setSettings, REPO_DIR } from './browser.mjs';

const glossary = JSON.parse(fs.readFileSync(path.join(REPO_DIR, 'dictionaries/glossary.ja.json'), 'utf8'));
const OUT = path.join(REPO_DIR, 'tests/out/live');
fs.mkdirSync(OUT, { recursive: true });

const REPO = 'https://github.com/nobuo-miura/github-ui-translator';
const PAGES = [
  // [名前, URL, ページガイドの種別, 注釈が付くはずの語]
  ['repository-root', REPO, 'code', ['Code', 'Issues', 'Pull requests', 'Actions']],
  ['code-file', `${REPO}/blob/main/content.js`, 'file', ['Code', 'Issues']],
  ['issues', `${REPO}/issues`, 'issues', ['Issues', 'Pull requests']],
  ['issue-detail', `${REPO}/issues/1`, 'issue', ['Issues']],
  ['pull-requests', `${REPO}/pulls`, 'pulls', ['Pull requests']],
  ['pull-request-detail', `${REPO}/pull/87`, 'pull', ['Pull requests', 'Conversation', 'Files changed']],
  ['pull-request-files', `${REPO}/pull/87/files`, 'pull', ['Pull requests', 'Files changed']],
  ['actions', `${REPO}/actions`, 'actions', ['Actions']],
  // GitHub 公式の公開ロードマップ（Projects）。リポジトリ側の /projects は未ログインでは404
  ['projects', 'https://github.com/orgs/github/projects/4247', 'projects', []],
  ['security', `${REPO}/security`, 'security', ['Code']],
  ['insights', `${REPO}/pulse`, 'insights', ['Insights']],
  ['profile', 'https://github.com/octocat', 'profile', []],
  ['organization', 'https://github.com/github', 'org', []]
];

async function visit(context, url, { settle = 2500 } = {}) {
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error' && /GitHub UI Translator|日本語アシスト|ghja/.test(m.text())) errors.push(m.text()); });
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(settle);
  page.extensionErrors = errors;
  return page;
}

const guideTitle = (page) => page.evaluate(() => {
  const guide = document.querySelector('ghja-assist')?.shadowRoot.querySelector('.guide');
  return guide && !guide.hidden ? guide.firstChild?.textContent : null;
});

// 拡張が付けた注釈のうち、画面に表示されているもの
const visibleAnnotations = (page) => page.$$eval('[data-ghja-src]', (els) => els
  .filter((el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== 'hidden')
  .map((el) => ({ src: el.getAttribute('data-ghja-src'), ja: el.getAttribute('data-ghja'), own: [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.nodeValue.replace(/\s+/g, ' ').trim()) })));

// コード・差分・本文として比較する部分（拡張が変えてはいけない）
const protectedText = (page) => page.evaluate(() => {
  const parts = [];
  for (const el of document.querySelectorAll('.markdown-body, pre, textarea#read-only-cursor-text-area, [class*="diff-text"], .blob-code-inner, table.diff-table')) {
    if (el.parentElement?.closest('.markdown-body, pre, [class*="diff-text"], table.diff-table')) continue;
    parts.push(el.tagName === 'TEXTAREA' ? el.value : el.textContent);
  }
  return parts;
});

describe('learning mode on real GitHub pages', () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(() => browser.context.close());

  for (const [name, url, pageKey, terms] of PAGES) {
    test(name, async () => {
      const page = await visit(browser.context, url);
      await page.screenshot({ path: path.join(OUT, `${name}-learn-light.png`) });
      const found = await visibleAnnotations(page);
      assert.ok(found.length > 0, 'at least one GitHub label gets Japanese help');
      // 英語はそのまま残っていて、注釈はその英語と対応している
      for (const a of found) assert.ok(a.own.includes(a.src), `annotation ${a.src} is attached to its own English text`);
      for (const term of terms) {
        assert.ok(found.some((a) => a.src === term), `${term} is annotated (found: ${[...new Set(found.map((a) => a.src))].join(', ')})`);
      }
      assert.equal(await guideTitle(page), glossary.pages[pageKey].title);
      assert.deepEqual(page.extensionErrors, []);
      // 読み込み後、拡張の注釈が書き換わり続けていない（無限ループが無い）
      const churn = await page.evaluate(() => new Promise((resolve) => {
        let n = 0;
        const observer = new MutationObserver((records) => { n += records.filter((r) => r.attributeName?.startsWith('data-ghja')).length; });
        observer.observe(document.documentElement, { subtree: true, attributes: true });
        setTimeout(() => { observer.disconnect(); resolve(n); }, 2000);
      }));
      assert.equal(churn, 0, 'no annotation churn while the page is idle');
      await page.close();
    });
  }

  test('settings (repository) — needs a signed-in admin', (t) => {
    t.skip('BLOCKED: the repository Settings tab only exists for a signed-in user with admin rights; this suite never signs in. Covered by the fixture test /octo/demo/settings.');
  });
});

describe('code, diff and README are never changed', () => {
  // 置き換えを行う「日本語優先」モードで、拡張なしの表示と一字一句比べる（最も厳しい条件）
  let plain;
  let assisted;
  before(async () => {
    plain = await launch({ extension: false });
    assisted = await launch();
    await setSettings(assisted.context, assisted.extensionId, { mode: 'ja' });
  });
  after(async () => {
    await plain.context.close();
    await assisted.context.close();
  });

  for (const [name, url] of [['README', REPO], ['code file', `${REPO}/blob/main/content.js`], ['pull request diff', `${REPO}/pull/87/files`], ['issue body and comments', `${REPO}/issues/1`]]) {
    test(name, async () => {
      const a = await visit(plain.context, url, { settle: 4000 });
      const b = await visit(assisted.context, url, { settle: 4000 });
      const before = await protectedText(a);
      const afterText = await protectedText(b);
      assert.ok(before.length > 0 && before.join('').length > 50, `found protected content (${before.length} parts)`);
      assert.deepEqual(afterText, before);
      await a.close();
      await b.close();
    });
  }
});

describe('SPA navigation', () => {
  let browser;
  before(async () => { browser = await launch(); });
  after(() => browser.context.close());

  test('clicking repository tabs keeps the help without a full reload, and Back works', async () => {
    const page = await visit(browser.context, REPO);
    await page.evaluate(() => { window.__noReload = true; });
    await page.click('nav[aria-label="Repository"] a[href$="/issues"]');
    await page.waitForURL(/\/issues$/);
    await page.waitForFunction(() => document.querySelector('ghja-assist')?.shadowRoot.querySelector('.guide')?.firstChild?.textContent === 'Issues', null, { timeout: 15000 });
    assert.equal(await page.evaluate(() => window.__noReload), true, 'GitHub navigated without a full page load');
    await page.waitForTimeout(1500);
    const onIssues = await visibleAnnotations(page);
    assert.ok(onIssues.some((a) => a.src === 'Pull requests'));
    await page.screenshot({ path: path.join(OUT, 'spa-issues.png') });

    await page.click('nav[aria-label="Repository"] a[href$="/pulls"]');
    await page.waitForURL(/\/pulls$/);
    await page.waitForFunction(() => document.querySelector('ghja-assist')?.shadowRoot.querySelector('.guide')?.firstChild?.textContent === 'Pull requests', null, { timeout: 15000 });

    await page.goBack();
    await page.waitForURL(/\/issues$/);
    await page.waitForFunction(() => document.querySelector('ghja-assist')?.shadowRoot.querySelector('.guide')?.firstChild?.textContent === 'Issues', null, { timeout: 15000 });
    await page.waitForTimeout(1000);
    // 同じ要素に二重の注釈は付かない（属性なので構造上1つ）。同じ語が重複表示されていないことも確認
    const counts = {};
    for (const a of await visibleAnnotations(page)) counts[a.src] = (counts[a.src] || 0) + 1;
    assert.ok((counts['Pull requests'] || 0) <= 2, `Pull requests annotated ${counts['Pull requests']} times`);
    assert.deepEqual(page.extensionErrors, []);
  });
});

describe("GitHub's own controls still work", () => {
  // 'none' は拡張なし。同じ手順が拡張なしで通ることを確かめ、テスト自体の誤りと区別する
  for (const mode of ['none', 'learn', 'ja']) {
    describe(`${mode === 'none' ? 'without the extension' : `${mode} mode`}`, () => {
      let browser;
      before(async () => {
        browser = await launch({ extension: mode !== 'none' });
        if (mode !== 'none') await setSettings(browser.context, browser.extensionId, { mode });
      });
      after(() => browser.context.close());

      test('search opens with "/" and runs a query', async () => {
        const page = await visit(browser.context, REPO);
        await page.keyboard.press('/');
        const input = page.locator('[role="dialog"] input[role="combobox"], #query-builder-test').first();
        await input.waitFor({ state: 'visible', timeout: 10000 });
        await input.fill('translator');
        await page.keyboard.press('Enter');
        await page.waitForURL(/\/search\?/, { timeout: 20000 });
        assert.match(page.url(), /q=/);
        await page.close();
      });

      test('the Code dropdown opens with clone options', async () => {
        const page = await visit(browser.context, REPO);
        // 緑の「Code」ボタン（日本語優先モードでは表示が「コード」になるので属性で探す）
        await page.locator('button[data-variant="primary"][aria-haspopup="true"]').first().click();
        // 日本語優先モードでは項目名も日本語になる
        await page.getByText(/^(Download ZIP|ZIPで取得)$/).first().waitFor({ state: 'visible', timeout: 10000 });
        await page.screenshot({ path: path.join(OUT, `code-dropdown-${mode}.png`) });
        await page.keyboard.press('Escape');
        await page.close();
      });

      test('the keyboard shortcuts dialog opens with "?"', async () => {
        const page = await visit(browser.context, REPO);
        await page.keyboard.press('Shift+Slash');
        const dialog = page.getByRole('dialog').filter({ hasText: /Keyboard shortcuts|キーボードショートカット/ });
        await dialog.first().waitFor({ state: 'visible', timeout: 10000 });
        await page.screenshot({ path: path.join(OUT, `shortcuts-dialog-${mode}.png`) });
        await page.keyboard.press('Escape');
        await page.close();
      });
    });
  }
});

describe('themes, zoom and narrow screens', () => {
  // 小さい文字（10〜11px）なのでWCAG AAの 4.5:1 を要求する
  const contrast = (page) => page.$$eval('[data-ghja]', (els) => {
    const parse = (c) => (c.match(/[\d.]+/g) || []).map(Number);
    const lum = ([r, g, b]) => {
      const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const bgOf = (el) => {
      for (let e = el; e; e = e.parentElement) {
        const c = parse(getComputedStyle(e).backgroundColor);
        if (c.length === 3 || (c.length === 4 && c[3] > 0.5)) return c.slice(0, 3);
      }
      return [255, 255, 255];
    };
    return els.filter((el) => el.getClientRects().length > 0).map((el) => {
      const after = getComputedStyle(el, '::after');
      const fg = parse(after.color).slice(0, 3);
      const alpha = Number(after.opacity);
      const bg = bgOf(el);
      const mixed = fg.map((v, i) => v * alpha + bg[i] * (1 - alpha));
      const [l1, l2] = [lum(mixed), lum(bg)].sort((x, y) => y - x);
      return { src: el.getAttribute('data-ghja-src'), ratio: (l1 + 0.05) / (l2 + 0.05) };
    });
  });

  for (const colorScheme of ['light', 'dark']) {
    test(`${colorScheme} theme: annotations are readable`, async () => {
      const browser = await launch({ colorScheme });
      try {
        const page = await visit(browser.context, REPO);
        await page.screenshot({ path: path.join(OUT, `repository-root-learn-${colorScheme}.png`) });
        const ratios = await contrast(page);
        const worst = ratios.reduce((w, r) => (r.ratio < w.ratio ? r : w), { ratio: Infinity });
        console.log(`${colorScheme}: ${ratios.length} annotations, lowest contrast ${worst.ratio.toFixed(2)} (${worst.src})`);
        assert.ok(ratios.length > 5);
        assert.ok(worst.ratio >= 4.5, `lowest contrast ${worst.ratio.toFixed(2)} on ${worst.src}`);
      } finally {
        await browser.context.close();
      }
    });
  }

  // 200%ズーム相当（1280px幅の画面を2倍に拡大）とスマートフォン幅
  for (const [label, viewport] of [['200% zoom', { width: 640, height: 450 }], ['narrow 390px', { width: 390, height: 844 }], ['desktop 1280px', { width: 1280, height: 900 }]]) {
    test(`${label}: no horizontal overflow and no repository tab pushed out (learn and ja modes)`, async () => {
      const measure = async (mode) => {
        const browser = await launch({ extension: Boolean(mode), viewport });
        try {
          if (mode) await setSettings(browser.context, browser.extensionId, { mode });
          const page = await visit(browser.context, REPO);
          if (mode) await page.screenshot({ path: path.join(OUT, `repository-root-${mode}-${label.replace(/\W+/g, '-')}.png`) });
          return await page.evaluate(() => ({
            overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
            tabs: [...document.querySelectorAll('nav[aria-label="Repository"] a')].filter((a) => {
              const r = a.getBoundingClientRect();
              return r.width > 0 && r.right <= document.documentElement.clientWidth && getComputedStyle(a).visibility !== 'hidden';
            }).length
          }));
        } finally {
          await browser.context.close();
        }
      };
      const base = await measure(null);
      for (const mode of ['learn', 'ja']) {
        const ext = await measure(mode);
        console.log(`${label}: baseline ${JSON.stringify(base)}, ${mode} ${JSON.stringify(ext)}`);
        assert.ok(ext.overflow <= Math.max(base.overflow, 0), `${mode}: no new horizontal scroll`);
        // 学習モードは英語を残して下に小さく足すだけなので、見えるタブの数は元と同じでなければならない。
        // 日本語優先モードは上流と同じくラベル自体を日本語に置き換えるため文字幅が広がり（例: Pull requests
        // 121px → 変更の取り込み依頼 166px）、狭い幅では GitHub 自身が1つを「…」メニューへ移すことがある。
        // タブが消えるわけではないので、そのモードに限り1つまで許す（README の既知の制限に記載）
        const allowed = mode === 'ja' ? 1 : 0;
        assert.ok(ext.tabs >= base.tabs - allowed, `${mode}: visible repository tabs ${ext.tabs} vs ${base.tabs}`);
      }
    });
  }
});
