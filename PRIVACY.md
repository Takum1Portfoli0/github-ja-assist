# Privacy Policy — GitHub Japanese Assist

[English](PRIVACY.md) | [日本語](PRIVACY.ja.md)

Last updated: September 25, 2026

## Summary

**GitHub Japanese Assist does not collect, transmit or sell personal data, page content or credentials. It stores only its display settings, locally. When you use body translation, the translation is done on your device by Chrome's built-in translator; the extension sends nothing anywhere.**

## Details

### No data collection

The extension collects no personal data, browsing history, page content or usage data, and has no telemetry. It never accesses GitHub credentials (passwords, tokens, cookies).

### UI help uses bundled dictionaries only

The small Japanese labels, the concept tooltips and the page guide come only from the dictionaries bundled with the extension (`dictionaries/`). There are no calls to translation APIs, analytics or cloud services.

### Body translation (README / Issue / Pull request)

- It runs only when you press "本文を日本語で読む" (read in Japanese). Nothing is translated automatically.
- Translation uses Chrome's built-in Translator API and runs on your device. The extension never sends body text to an external server, including the content of private repositories.
- On first use, Chrome itself may download a translation model (language pack) from Google's servers. That is the browser fetching a model; it contains no page content.
- Translations are shown on the page temporarily and are never stored. They disappear when you navigate or reload.
- In browsers without the Translator API, the button is shown as unsupported and nothing is sent.
- To label the button, the page asks the browser whether en→ja translation is available (`Translator.availability()`). No page content is passed.

### Settings stay in your browser

All settings are stored locally with `chrome.storage.local` and are never transmitted:

- extension on/off, display mode, dictionary language, global header translation on/off
- on/off for the tooltips, the page guide and the body-translation button

### Permissions

- **storage**: only to store the settings above.
- **Content script on `https://github.com/*`**: needed to show the Japanese help on GitHub pages. It does not run on any other site.

No other permissions are requested.

### No third parties

No data leaves your device, so nothing is shared with, sold to or processed by third parties.

## Changes

Any change to this policy will be announced on this page before it takes effect.

## Based on

This extension is based on [GitHub UI Translator](https://github.com/nobuo-miura/github-ui-translator) (MIT License). This policy covers GitHub Japanese Assist.
