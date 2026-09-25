[English](CONTRIBUTING.md) | [日本語](CONTRIBUTING.ja.md)

# Contributing

GitHub Japanese Assist is based on [GitHub UI Translator](https://github.com/nobuo-miura/github-ui-translator) (MIT License) and adds Japanese help that keeps GitHub's English terms visible.

## Found a label without Japanese?

1. With the page open, click the extension icon.
2. Press **このページで日本語が付いていない文言をコピー** ("copy untranslated text on this page").
3. Open a new issue in this repository and paste the list (check it first: page text can slip in).

## Editing the dictionaries

- Japanese-only UI strings and concept descriptions live in `dictionaries/glossary.ja.json`:
  - `terms`: GitHub/Git terms (`ja` is the small Japanese label, `description` the tooltip, `aliases` other spellings)
  - `labels`: plain UI strings (English → Japanese)
  - `pages`: page-guide text
- Keys are matched **exactly** against the English on screen.
- The multi-language dictionaries (`dictionaries/ja.json` etc., kept in sync across 8 languages) come from the original project; propose changes to them there.

## Checking your change

```bash
npm install
npx playwright install chromium
npm run validate   # dictionaries and glossary
npm test           # fixture tests
npm run test:live  # real github.com (public pages, logged out, read-only)
```

Design decisions are recorded in [DESIGN.md](../DESIGN.md).
