[English](CONTRIBUTING.md) | [日本語](CONTRIBUTING.ja.md)

# 貢献の手引き

GitHub 日本語アシストは、[GitHub UI Translator](https://github.com/nobuo-miura/github-ui-translator)（MIT License）を元に、英語の用語を残したまま日本語を添える機能を加えたものです。

## 日本語が付いていない文言を見つけたら

1. そのページを開いたまま、拡張機能のアイコンを押します。
2. **このページで日本語が付いていない文言をコピー** を押します。
3. このリポジトリの Issues で新しい Issue を作り、コピーした一覧を貼ってください（ページの文字が混ざることがあるので、貼る前に中身を確認してください）。

## 辞書を直す

- 日本語だけの画面文言と用語の説明は `dictionaries/glossary.ja.json` にあります。
  - `terms`: GitHub・Git の用語（`ja` が添える日本語、`description` が説明、`aliases` が別表記）
  - `labels`: 画面の文言（英語 → 日本語）
  - `pages`: ページガイドの文言
- キーは画面の英語と**完全一致**で照合します。
- 8 言語で件数をそろえている元の辞書（`dictionaries/ja.json` など）は、元のプロジェクトのものです。そちらへの追加は元のプロジェクトに提案してください。

## 確かめ方

```bash
npm install
npx playwright install chromium
npm run validate   # 辞書・グロッサリーの検証
npm test           # 模擬ページでの自動テスト
npm run test:live  # 実際の github.com でのテスト（公開ページ・未ログイン・読み取りのみ）
```

設計の考え方と、これまでの判断は [DESIGN.md](../DESIGN.md) にあります。
