// 配布用の unpacked フォルダ（dist/github-ja-assist）と zip を作る。
// 使い方: node scripts/build.mjs
// Chrome の「パッケージ化されていない拡張機能を読み込む」で dist/github-ja-assist を選べばそのまま動く。
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const outDir = path.join(root, 'dist', 'github-ja-assist');
const zipPath = path.join(root, 'dist', `github-ja-assist-v${manifest.version}.zip`);

// 拡張の実行に必要なものだけ（テスト・開発用ファイルは含めない）。LICENSE は MIT の表示義務のため同梱
const FILES = [
  'manifest.json',
  'shared.js', 'content.js', 'content-translate.js', 'assist.js', 'assist.css',
  'popup.html', 'popup.js', 'options.html', 'options.js',
  'languages.json', '_locales', 'dictionaries', 'icons',
  'LICENSE', 'PRIVACY.md', 'PRIVACY.ja.md'
];

fs.rmSync(path.join(root, 'dist'), { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });
for (const file of FILES) {
  fs.cpSync(path.join(root, file), path.join(outDir, file), { recursive: true });
}

// zip は OS 付属のツールで作る（Windows 10 以降の tar.exe は -a で zip を書ける）
const zip = process.platform === 'win32'
  ? spawnSync(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zipPath, '-C', outDir, '.'], { stdio: 'inherit' })
  : spawnSync('zip', ['-r', '-q', zipPath, '.'], { cwd: outDir, stdio: 'inherit' });
if (zip.status !== 0) {
  console.error(`zip failed (${zip.error?.message || `exit ${zip.status}`}); the unpacked folder is still usable: ${outDir}`);
  process.exit(1);
}

console.log(`Unpacked: ${path.relative(root, outDir)}`);
console.log(`Zip:      ${path.relative(root, zipPath)} (${fs.statSync(zipPath).size} bytes)`);
