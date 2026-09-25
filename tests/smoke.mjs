// 手元確認用: 実際のGitHubページを開いてスクリーンショットを撮る（node tests/smoke.mjs [url] [mode] [dark]）
import { launch, setSettings, annotations } from './browser.mjs';
const url = process.argv[2] || 'https://github.com/nobuo-miura/github-ui-translator';
const mode = process.argv[3] || 'learn';
const colorScheme = process.argv[4] === 'dark' ? 'dark' : 'light';
const { context, extensionId } = await launch({ colorScheme });
await setSettings(context, extensionId, { mode });
const page = await context.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.goto(url, { waitUntil: 'load' });
await page.waitForTimeout(3000);
const list = await annotations(page);
console.log('extensionId', extensionId, 'annotations', list.length);
console.table(list.slice(0, 60));
await page.screenshot({ path: `tests/out/smoke-${mode}-${colorScheme}.png` });
console.log('errors', errors.filter(e => /ghja|GitHub UI Translator|日本語アシスト/.test(e)));
await context.close();
