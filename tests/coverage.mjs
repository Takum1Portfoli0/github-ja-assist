// 実際の github.com（公開ページ・未ログイン）で、日本語が付いていない画面文言を数える開発用ツール。
// ポップアップの「日本語が付いていない文言をコピー」と同じ集計（content.js の collectUntranslated）を使う。
// 使い方: node tests/coverage.mjs [出力ファイル]  → 各ページの件数と、足りない文言の一覧（多い順）
import fs from 'node:fs';
import path from 'node:path';
import { launch, REPO_DIR } from './browser.mjs';

const REPO = 'https://github.com/nobuo-miura/github-ui-translator';
const PAGES = [
  REPO, `${REPO}/blob/main/content.js`, `${REPO}/issues`, `${REPO}/issues/1`, `${REPO}/pulls`,
  `${REPO}/pull/87`, `${REPO}/pull/87/files`, `${REPO}/actions`, `${REPO}/security`, `${REPO}/pulse`,
  `${REPO}/commits/main`, `${REPO}/branches`, `${REPO}/releases`, `${REPO}/discussions`,
  'https://github.com/orgs/github/projects/4247', 'https://github.com/octocat', 'https://github.com/github',
  'https://github.com/search?q=translator&type=repositories'
];

const { context, extensionId } = await launch();
const control = await context.newPage();
await control.goto(`chrome-extension://${extensionId}/options.html`);

const results = [];
for (const url of PAGES) {
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(2500);
  await page.bringToFront();
  const result = await control.evaluate(async () => {
    const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return chrome.tabs.sendMessage(tab.id, { type: 'ghja:collect-untranslated' });
  });
  results.push({ url, ...result });
  console.log(`${String(result.annotated).padStart(4)} annotated  ${String(result.missing.length).padStart(4)} missing  ${url}`);
  await page.close();
}
await context.close();

const counts = new Map();
for (const r of results) {
  for (const { text, where } of r.missing) {
    const entry = counts.get(text) || { text, pages: 0, where };
    entry.pages += 1;
    counts.set(text, entry);
  }
}
const ranked = [...counts.values()].sort((a, b) => b.pages - a.pages || a.text.localeCompare(b.text));
const total = results.reduce((sum, r) => ({ annotated: sum.annotated + r.annotated, missing: sum.missing + r.missing.length }), { annotated: 0, missing: 0 });
console.log(`\ntotal: ${total.annotated} annotated, ${total.missing} missing (per page, not unique), ${ranked.length} unique missing strings`);
const out = process.argv[2] || path.join(REPO_DIR, 'tests/out/coverage.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ total, ranked, results }, null, 2));
console.log(`written: ${out}`);
