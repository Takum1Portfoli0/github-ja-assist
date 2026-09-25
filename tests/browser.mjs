// テスト用: 開発版（unpacked）拡張を読み込んだ Chrome for Testing を起動する。
// 市販版のGoogle Chromeは Chrome 137 以降コマンドラインから unpacked 拡張を読み込めないため、
// Playwright 同梱の Chromium（Chrome for Testing）を使う。
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXTENSION_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function launch({ extension = true, colorScheme = 'light', viewport = { width: 1280, height: 900 }, headless = true } = {}) {
  const args = extension ? [`--disable-extensions-except=${EXTENSION_DIR}`, `--load-extension=${EXTENSION_DIR}`] : [];
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless,
    colorScheme,
    viewport,
    locale: 'en-US',
    args
  });
  let extensionId = null;
  if (extension) {
    const page = await context.newPage();
    await page.goto('chrome://extensions/');
    extensionId = await page.locator('extensions-item').first().getAttribute('id');
    await page.close();
  }
  return { context, extensionId };
}

// 拡張の設定を書き換える（ポップアップと同じ chrome.storage.local に書く）
export async function setSettings(context, extensionId, values) {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/options.html`);
  await page.evaluate((v) => chrome.storage.local.set(v), values);
  await page.close();
}

// 注釈（学習モードの小さな日本語）が付いた要素の一覧
export function annotations(page, scope = 'body') {
  return page.evaluate((scopeSelector) => [...document.querySelector(scopeSelector).querySelectorAll('[data-ghja-src]')]
    .map((el) => ({ src: el.getAttribute('data-ghja-src'), ja: el.getAttribute('data-ghja'), text: el.textContent.trim() })), scope);
}
