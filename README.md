# GitHub Japanese Assist (development build)

[English](README.md) | [日本語](README.ja.md)

A Chrome extension that makes GitHub.com easier for Japanese speakers **without hiding GitHub's English terms**. It adds small Japanese labels next to the English ones, concept tooltips, a page guide, and an opt-in, on-device translation of README / Issue / Pull request bodies.

![Repository page with small Japanese labels under and beside the English ones](docs/images/learn-light.png)

## Features

- **Learning mode (default)**: `Pull requests` stays in English and gets a small "変更の取り込み依頼" under it. The Japanese is drawn with CSS `::after` and empty alt text, so GitHub's text, `aria-label`s and accessible names are unchanged, and no nodes are inserted into React-managed DOM. The one exception is placeholder text: the Japanese is appended to it (`Find a repository… （リポジトリを検索）`), so an input whose accessible name comes from its placeholder is announced with the Japanese after the English.
- **Japanese-first mode**: the upstream behaviour (text replaced with Japanese), with the English term kept as a small label (up to 40 characters; longer English, such as descriptions, appears in the tooltip).
- **English-only mode**: GitHub unchanged; the page guide and body translation button remain available.
- **Concept tooltips** on hover or keyboard focus, e.g. what a Fork, a Pull request or Actions actually is.
- **Page guide**: a small panel naming the current page (Issues, Actions, Settings, …) with a one-line explanation.
- **Body translation on request**: "本文を日本語で読む" uses Chrome's built-in Translator API (on device) and places each translation below its paragraph. Code blocks are never sent; inline code stays code. Unsupported browsers show the button as unsupported.
- **Report missing Japanese**: the popup button "このページで日本語が付いていない文言をコピー" copies the visible labels on the current page that still have no Japanese (one per line, with where they are) and the page type as GitHub itself records it with names hidden (e.g. `/<user-name>/<repo-name>/issues`), so they can be added to the dictionary. It only copies to the clipboard; nothing is sent. The same exclusions as the annotations apply, but page text can still slip in, so check it before sending.
- In learning mode, headings, links, table headers, GitHub's own tooltips and placeholders are annotated on every page (text is never rewritten, so a false match only adds a label). Japanese-first mode, which rewrites text, keeps upstream's per-page scope (the exclusions added in this fork only make it touch less). Links whose text is the user or repository name they point to (repository lists, search results), topic links and search highlights are treated as user content.
- Never touched: code, diffs, file/directory/repository/user/branch names, tags, commit hashes, URLs, and user-written bodies unless you ask.

## Install (unpacked)

1. Download `github-ja-assist-v0.3.0.zip` from this repository's [Releases](../../releases/latest) and unzip it, or build it (below).
2. Open `chrome://extensions`, enable **Developer mode**.
3. **Load unpacked** → select the folder containing `manifest.json`.
4. Reload any open GitHub tab.

## Privacy

No data collection, no telemetry, no network calls. Only the `storage` permission; the content scripts run on `https://github.com/*` only. Body translation runs on-device through Chrome; on first use Chrome may download a language model. See [PRIVACY.md](PRIVACY.md).

## Browser support

| Browser | UI help | Body translation | Verified |
|---|---|---|---|
| Chrome 138+ desktop | yes | yes (Translator API) | UI help: automated tests in Chrome for Testing 153. **Real translation not verified** — see limitations |
| Microsoft Edge | yes | shown as unsupported where en→ja is unavailable | automated test on Edge 148 |
| Firefox | inherited manifest settings | expected: unsupported | **not tested** |

## Known limitations

- Only exact-match fixed UI strings from the dictionary are annotated; strings with numbers or dates ("3 commits", "Commits on Aug 1, 2026"), relative times and user-created text are not. Paragraph text (`<p>`) is left alone. Placeholders can be clipped in narrow inputs.
- GitHub DOM changes can make labels disappear, or rarely attach to user content (the same structural limit as upstream).
- Automated tests run logged out on public pages. Logged-in-only screens (e.g. repository Settings) are covered by the fixture page only.
- **Actual on-device translation was not observed in this environment**: Chrome for Testing is not served translation models, and Edge 148 reports en→ja as unavailable. The DOM insertion is tested with a fake translator; cancel and unsupported paths are tested in real browsers. A manual check in branded Chrome 138+ is still owed.
- Translation is English→Japanese only; links are not clickable inside translations.
- Inline labels are limited to 16 characters of Japanese (40 of English in Japanese-first mode). Longer ones, and header items that cannot stack a label underneath, show it in the tooltip only, so buttons and the header keep their width.
- To label the button as available or unsupported, the page asks the browser whether en→ja translation is available (`Translator.availability()`; no content is passed). The translator is created, and text translated, only on click.
- Tooltips are visual aids and are not announced by screen readers. They stay open while hovered and close with Esc.
- Closing the page guide returns keyboard focus to the page as a whole.
- While the pointer rests on a tooltip, the first click only closes it.
- In Japanese-first mode the tab labels are wider than the English ones, so at narrow widths (e.g. 200% zoom) GitHub may move one more repository tab into its "…" menu. The default mode keeps the tab count unchanged.
- On narrow screens the page guide can overlap bottom content; close it or turn it off.

## Development

```bash
npm install && npx playwright install chromium
npm run validate     # dictionaries, glossary, locales
npm test             # fixture tests: the real extension on GitHub-like pages, all non-github.com requests blocked
npm run test:live    # real github.com, public pages, logged out, read-only
npm run build        # dist/github-ja-assist + zip
```

To test the packaged build: `GHJA_EXTENSION_DIR=dist/github-ja-assist npm test`.

Design decisions, the prior-art survey and the fork rationale: [DESIGN.md](DESIGN.md).

## License and credits

[MIT](LICENSE). Forked from [nobuo-miura/github-ui-translator](https://github.com/nobuo-miura/github-ui-translator) 0.1.10 (MIT, © 2026 Nobuo Miura), whose translation engine and UI dictionaries this extension uses. The learning mode, glossary (`dictionaries/glossary.ja.json`), tooltips, page guide and body translation were added in this fork.
