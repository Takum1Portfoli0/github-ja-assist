# DESIGN — GitHub 日本語アシスト

この文書は、何を作り、なぜその作り方を選んだかの記録です。数値はすべて 2026-09-25 に実行したテストの出力から取っています（`tests/out/` に保存。リポジトリには含めない）。

## 1. 目的とスコープ

GitHub.com を、日本語ネイティブが英語 UI で迷わず、かつ Git / GitHub 本来の英語用語を覚えられるようにするブラウザ拡張。

- 作るのは **GitHub.com 上で動く拡張機能だけ**。GitHub クローン、Git クライアント、独自フロントエンド、GitHub API を大量に使う別サービスは作らない。
- 認証情報・PAT・Private リポジトリの内容を外部へ送らない。拡張機能は通信を一切しない（本文翻訳も端末内の Chrome 内蔵 API）。
- 既存 OSS のコードは LICENSE を確認したものだけを使う。ライセンス不明のコードはコピーしない。

## 2. 既存のプロジェクトの調査（2026-09-25）

| プロジェクト | ライセンス / 状態 | やり方 | 判断 |
|---|---|---|---|
| [nobuo-miura/github-ui-translator](https://github.com/nobuo-miura/github-ui-translator) | **MIT**。0.1.10、最終コミット 2026-09-09。Chrome ウェブストア 514 ユーザー。Issue/PR #1〜#87 はすべて作者本人 | MV3。許可リスト（nav/header/button/role/aria-label）内のテキストを辞書の完全一致で**日本語に置き換える**。ユーザー作成内容の除外ルールが多数（実バグから積み上げたもの）。`react-partial:not(.loaded)` で React の hydration 完了を待つ。MutationObserver を `<html>` に張り（Turbo の body 置き換え対策）rAF でまとめる。辞書 ja 1,588 語、8 言語 | **fork の土台に採用**。英語を残す表示・用語の説明・ページガイド・本文翻訳が無い（Issue にも要望なし） |
| 「GitHub Translate」（tauleap、[ストア](https://chromewebstore.google.com/detail/github-translate/ignplaeoffkjaffgbhclflhmegllfipm)） | **ソース非公開・ライセンス表記なし**。1.3.0（2026-09-24） | 英語の後ろに `<span aria-hidden>` を挿入して小さな日本語を表示。400ms 遅延のツールチップ、GitHub 自身のツールチップが出ているときは黙る。説明文 約280件 | **設計の参考のみ**（コードは読まない・使わない）。目標 UX に最も近い |
| 「GitHub Translate」（j4rviscmd、[gh-translate-chrome-extension](https://github.com/j4rviscmd/gh-translate-chrome-extension)） | ソース公開だが **LICENSE なし** | Translator API で本文・タイトルを**その場で置き換え**、WeakMap で原文を保持。`pre`/`code` を飛ばす。API が無いと「not available」と表示 | **設計の参考のみ**。本拡張は置き換えず原文の下に訳を足す方式にした |
| [maboloshi/github-chinese](https://github.com/maboloshi/github-chinese) | **GPL-3.0** | userscript。ページ種別ごとの辞書、`turbo:load`、無視セレクタ一覧 | 考え方だけ参考。コード・辞書は使わない（取り込むと GPL になる） |
| [k1995/github-i18n-plugin](https://github.com/k1995/github-i18n-plugin) | リポジトリに LICENSE なし（userscript のヘッダーのみ MIT と記載） | jQuery、変化のたびに body 全体を再走査、リポジトリ説明文を外部サイトへ送って翻訳 | 不採用（ライセンス不明確・外部送信・性能） |
| [52cik/github-hans](https://github.com/52cik/github-hans) | MIT、2022 年に放棄 | GitHub の旧 jQuery フック | 不採用（現在の GitHub では動かない） |
| [refined-github](https://github.com/refined-github/refined-github) | MIT | `turbo:render` / `soft-nav:react-done` での再実行、CSS アニメーションを使った要素監視、[github-url-detection](https://github.com/refined-github/github-url-detection) | イベント名だけ参考（ページガイドの再描画）。github-url-detection はバンドラが必要になるため不採用。26 種のページ判定は正規表現の表で足りる |
| Immersive Translate、RepoLingo など | 商用・ライセンス不明 / 中国語向け | 原文と訳の併記 | UX の参考のみ |
| Chrome Translator API / Language Detector API | Chrome 138 で安定版 | 端末内翻訳。モデル未取得時の `create()` はユーザー操作が必要 | **本文翻訳に採用**。コンテンツスクリプトから使えることを実測（`typeof Translator === 'function'`、Chrome for Testing 153 で en→ja は `downloadable`） |
| GitHub Docs 日本語版 | — | 用語の表記が不統一（「プル要求」「プルリクエスト」、Issue/「問題」/「課題」が混在） | 公式の表記として採用しない。用語の説明文は独自に書いた |

## 3. 既存を使うか、fork か、新規か

| 選択肢 | 評価 |
|---|---|
| 1. 既存拡張をそのまま使う | 目標を満たすものが無い。github-ui-translator は英語を消す。tauleap 版は目標に近いがソース非公開・ライセンス不明で、改良も検証もできない |
| **2. 既存 OSS を fork する** | **採用**。github-ui-translator の価値は「どこを訳してはいけないか」の除外ルールと、React / Turbo への対処にある。これは GitHub 上で実際に壊れた箇所から積み上がったもので、作り直すと同じ失敗を繰り返す。MIT なので条件は著作権表示だけ |
| 3. 設計だけ参考に新規実装 | 除外ルールの再発見が最大のコストで、利点が無い |
| 4. 別の拡張（companion）を足す | 2 つの拡張が同じテキストノードを同時に書き換えると、互いの MutationObserver が反応し合い、表示の順序も決まらない。エンジンを重ねて持つことにもなる |

判断軸ごと: 実装量（最小）、保守性（上流の `content.js` と `dictionaries/*.json` の変更を小さく保ち、上流の辞書更新を取り込めるようにした）、ライセンス（MIT、表示を LICENSE に残した）、GitHub の UI 変更への耐性（上流の除外ルールを継承）、セキュリティ・プライバシー（権限は `storage` のみ、通信なし）、ストア公開の可能性（MV3・最小権限・リモートコードなし）、Edge/Firefox 移植（上流の manifest 設定を継承。Firefox は未検証）、テスト容易性（Playwright で実拡張をそのまま読み込める）。

## 4. 構成

```
manifest.json            MV3。permissions は storage のみ。github.com/* にだけ注入
shared.js                （上流）+ グロッサリー読み込み（loadGlossary）
content.js               （上流のエンジン）+ 表示モード・注釈・固定タブの扱い
content-translate.js     本文翻訳の DOM 処理（通信しない。翻訳器は引数で受け取る）
assist.js                ツールチップ・ページガイド・本文翻訳ボタン（Shadow DOM）
assist.css               注釈（::after）と訳文ブロックのスタイル
dictionaries/ja.json     （上流）画面文言の辞書 1,588 語。変更していない
dictionaries/glossary.ja.json  学習用グロッサリー: 81 語（別表記込み 93）、26 ページ
popup.html / popup.js    表示モードと各機能の ON/OFF
scripts/validate.mjs     （上流）+ グロッサリーの検証
scripts/build.mjs        dist/ と zip
tests/                   fixture（模擬ページ）と live（実際の github.com）
```

## 5. 英語を残して日本語を添える方法（最重要の判断）

候補は 2 つあった。

| | A. `<span>` を挿入（tauleap 版の方式） | **B. 親要素に属性を付け、CSS の `::after` で描く（採用）** |
|---|---|---|
| React の hydration / 差分検出 | hydration 前に挿入すると不一致で描き直しになる。React が text を消すと span が取り残される | DOM ノードを挿入しない。属性は React の hydration の比較対象外 |
| アクセシビリティ | `aria-hidden` が必要 | `content: attr(data-ghja) / ""` で代替テキストを空にし、アクセシブルネームに入らない |
| コピー・検索 | 選択範囲に日本語が混ざる | 疑似要素なので混ざらない |
| ツールチップの的 | 日本語部分だけにできる | 要素全体（GitHub 自身のツールチップが出ている間は出さない） |
| 自分の書き込みによる再走査 | childList の変化になり、監視に再び拾われる | 属性の変化。上流の監視は属性を見ないのでループしない |

**B を採用**。裏付けとして次を実測した。

- アクセシブルネーム: 拡張なしとタブ・ボタンの ARIA スナップショットが一致（fixture テスト）。**対照実験**として `/ ""` を外すと `link "Code コード"` になり、テストが落ちることを確認した。
- GitHub がすでに `::after` を使っている要素は上書きしない（読み取り時に `getComputedStyle(el, '::after')` を確認し、該当要素には注釈を付けない。fixture の `.uses-after` で確認）。
- 読み取りをまとめてから書き込む（`flushAnnotations`）。交互にすると要素数ぶんスタイル再計算が走るため。

見た目の調整（実画面のスクリーンショットで確認して決めた）:

- タブ（UnderlineNav。英語ラベルに `data-content` が付く）とグローバルヘッダーでは、日本語を英語の**下**に重ねる。横に並べたら 1280px 幅でタブが画面からはみ出し、ヘッダーが 126px 横にはみ出した（live テストで検出）。
- 色は要素自身の文字色をそのまま使い、大きさ（75%）で控えめにする。最初は `opacity: 0.72` で薄くしたが、緑の「Code」ボタン上でコントラストが 3.12:1 に落ちた（WCAG AA は 4.5:1）。今は最小 4.52:1（ライト）/ 4.63:1（ダーク）で、これは GitHub 自身の緑ボタンの値。
- 横に出す訳は 16 文字まで。長い訳（説明文など）はツールチップでだけ見せる。

表示モード:

| モード | 画面の英語 | aria-label | 添える文字 |
|---|---|---|---|
| `learn`（既定） | 変えない | 変えない | 日本語（グロッサリー優先、無ければ辞書） |
| `ja` | 日本語に置き換え（上流と同じ） | 日本語に置き換え（上流と同じ。タブ列の目印 3 つを除く） | 元の英語 |
| `original` | 変えない（エンジンを動かさない） | 変えない | なし。ページガイドと本文翻訳ボタンは使える |

完全な「日本語だけ」モードは作らなかった。上流の置き換え方式（`ja` モード）から英語の添え字を除くだけで作れるが、目標が「英語用語も学習できること」なので必要性が低い。

## 6. 辞書の設計

- 上流の `dictionaries/ja.json`（キー = 画面の英語、値 = 日本語）は**そのまま使い、変更しない**。上流の辞書更新を取り込みやすくするため。
- 学習用の情報は別ファイル `dictionaries/glossary.ja.json` にした。

```json
"Pull requests": {
  "ja": "変更の取り込み依頼",
  "description": "あるBranchで行った変更を、別のBranch（Fork元のRepositoryを含む）へ取り込んでもらうための依頼です。…",
  "aliases": ["Pull request"]
}
```

- `ja` は逐語訳より操作の意味を優先した短い日本語（`Fork` → 自分側へ複製、`Clone` → PCへ複製）。省略すると上流の辞書の訳を使う。説明文は手順ではなく概念を書き、GitHub 固有の語（Branch、Commit など）は英語のまま使う。
- `contexts`（画面ごとの訳し分け）は入れていない。「Code」タブと緑の「Code」ボタンのように同じ語が別の場所に出ても、1 つの説明で両方を扱えた。実際に訳し分けが必要な衝突が出たら追加する。
- `pages` はページガイドの文言。どの URL がどのページかは `assist.js` の表で決める（ロジックはコード、文言はデータ）。
- 検証（`npm run validate`）: キーの前後空白、`ja`/`description` の型、別表記の重複、**`ja` が英語のキーと一致しないこと**（`ja` モードで再翻訳の連鎖＝上流 #55 と同種の無限ループになるため）、`assist.js` が返すページ種別がすべて `pages` にあること。対照として、ページを 1 つ消し `Fork` の `ja` を `"Code"` にすると 2 件のエラーで失敗することを確認した。

## 7. 動的な DOM と SPA 遷移

上流の仕組みをそのまま使っている: `<html>` への MutationObserver（childList + characterData）、rAF で 1 フレームにまとめる、`react-partial` の `loaded` を待つ、bfcache 復元時の `pageshow`。

追加したもの:

- 注釈は属性だけなので、自分の書き込みが監視に拾われない。
- テキストが変わったら注釈も追従し（`Watch` → `Unwatch`）、辞書に無い文字列になったら注釈を外す（`clearStaleAnnotation`）。
- ページガイドは `turbo:load` / `turbo:render` / `soft-nav:end` / `soft-nav:react-done` / `popstate` / `pageshow` / Navigation API の `currententrychange` で描き直す。どれも rAF で 1 回にまとめる。
- ページ判定は URL と `meta[name="analytics-location"]`（`/<user-name>` と `/<org-login>` の区別に使用）。`/features/...` のような GitHub 自身のページは除外表で弾く。404 ページには出さない。

実測:

- 変化の嵐（fixture）: 60 フレームで 2,400 回の追加・削除・文字変更。停止後 1.5 秒間の変化は **0 件**（自分の書き込みでループしていない）。誤った注釈 0、付け漏れ 0。
- 実 GitHub の 13 画面で、読み込み後 2 秒間の注釈属性の書き換えは **0 件**。
- 実 GitHub でタブをクリックして遷移（全体の再読み込みなし）→ ガイドと注釈が付く → 戻るでも付く。

## 8. ユーザー作成内容と GitHub 本来の操作を壊さない

- 除外は上流のルール（`.markdown-body`、`pre`、`code`、`bdi`、ユーザー/リポジトリのホバーカード、ファイルツリー、ブランチ・ラベル・マイルストーンの候補、Issue/PR へのリンクなど）をそのまま使う。
- 上流のルールで固定 UI まで除外されていた 2 か所を直した: リポジトリのタブの「Wiki」（`/wiki` へのリンクが Wiki のページ名扱いだった）と、Pull request のタブ（Conversation / Commits / Checks / Files changed。`/pull/N` へのリンクが PR タイトル扱いだった）。これらのタブ列（`nav[aria-label="Repository" | "Pull request tabs" | "Pull request navigation"]`）には固定の項目しかない。fixture には同じ文字列の PR タイトルや Wiki ページ名も置き、そちらに付かないことを確認している。
- キー操作: 拡張が登録するのはツールチップを閉じる Escape だけで、`preventDefault` しない（GitHub 側にも届くことを fixture で確認）。検索（`/`）、Code メニュー、ショートカット一覧（`?`）は実 GitHub で、拡張なし・`learn`・`ja` の 3 通りで動作を確認した。
- 本文翻訳の訳文は `.markdown-body` の中に足すが、上流の除外により再走査されない。

## 9. 本文翻訳

- ボタンを押したときだけ。`Translator.create()` はクリック直後に呼ぶ（モデル取得にユーザー操作が必要なため）。ダウンロードの進み具合を表示し、60 秒進まなければ中止する。翻訳中にもう一度押すと中止。
- 対象は表示中の `.markdown-body` 内の段落・見出し・リスト項目・表のセルなど。入れ子のブロックは別々に訳す。`pre` は送らない。インラインコードはバッククォートで囲んで渡し、訳文側で `<code>` に戻す。
- 英語（ラテン文字）が主の文だけを訳す。日本語・中国語・韓国語が主の段落、URL やコードだけの段落は飛ばす。言語判定 API は使っていない（Chrome for Testing では `unavailable` で、英語→日本語の用途には文字種の判定で足りる）。
- 訳文は原文の後ろ（リスト項目・セルの中では末尾）に `lang="ja" translate="no"` の要素として足す。`textContent` と `<code>` だけで組み立て、`innerHTML` は使わない（ソースの静的検査もある）。「訳を消す」で消すと、元の HTML と完全に一致することをテストしている。
- Translator API が無い・`unavailable` のときは「本文翻訳: 非対応」と表示し、押すと理由を出す。

## 10. 上流からの変更点（上流 2159f92 = 0.1.10 との差）

- `content.js`: 表示モード、注釈（`queueAnnotation` / `flushAnnotations` / `clearStaleAnnotation`）、グロッサリー優先の `lookup`、Fork ボタン（`#fork-button`）を許可リストに追加、固定タブ列の扱い。上流の除外ルールは変えていない。
- `shared.js`: `loadGlossary`。`popup.*`: 表示モードと 3 つのトグル。`manifest.json`: 名前・版・読み込むファイル、Firefox 用 ID を上流と衝突しないものに変更。
- 削除: 上流の配布用ワークフロー（上流の各ストアへ公開するもの）、7 言語分のポップアップ文言と README（上流の製品を説明していたため）、`build.sh`（`scripts/build.mjs` に置き換え）。辞書は 8 言語とも残している（`learn` モードは他言語の辞書でも動く。用語の説明・ガイド・本文翻訳は日本語のときだけ）。
- 上流の変更を取り込むときは、上流の `dictionaries/*.json` をそのまま持ってきて `npm run validate` と `npm test` を通す。`content.js` は上記の追加部分以外は上流と同じ形を保っている。

## 11. テストと結果（2026-09-25）

| スイート | 内容 | 結果 |
|---|---|---|
| `npm run validate` | 上流の辞書検証 + グロッサリー検証 | passed（上流由来の自己マッピング警告のみ） |
| `npm test`（`tests/fixture.test.mjs`） | 実物の拡張を Chrome for Testing 153 に読み込み、`https://github.com/...` を模擬ページで応答。github.com 以外へのリクエストはすべて記録して遮断 | **45 / 45 pass** |
| 同上を配布用ビルドで（`GHJA_EXTENSION_DIR=dist/github-ja-assist`） | zip に入る中身そのものを試験 | **45 / 45 pass** |
| `npm run test:live`（`tests/live.test.mjs`） | 実際の github.com、未ログイン、読み取りのみ。13 画面（リポジトリ、コード、Issues、Issue 詳細、PR 一覧・詳細・差分、Actions、Projects、Security、Insights、プロフィール、Organization） | **32 pass / 0 fail / 1 skip** |

fixture で確かめていること: 英語が残り日本語が 1 要素 1 回だけ付く、Fork・Watch・PR タブ、既存の `::after` を上書きしない、ユーザー作成内容・コード・差分・ダイアログのキー表記・README が拡張なしと 1 バイトも違わない（**置き換えを行う `ja` モードでも**）、アクセシブルネームが変わらない、README を既定で訳さない、外部リクエスト 0、自分の書き込みで収束する、後から現れた要素・文字の変化・body の置き換え・pushState への追従、変化の嵐、ツールチップ（マウス・キーボード・Escape・OFF）、ページガイド 18 パターン、本文翻訳（模擬翻訳器で配置・コード保護・二重防止・完全な復元、実ブラウザで中止）、ポップアップの既定値と保存とラベル、Edge 148 での「非対応」表示、権限と危険な API の静的検査。

live で確かめていること: 13 画面で注釈が英語に正しく対応し期待の語に付く、ページガイドの種別、拡張由来のエラーなし、読み込み後に注釈が書き換わり続けない、README・コードファイル・PR 差分・Issue 本文が拡張なしと完全一致（`ja` モード）、SPA 遷移と戻る、検索・Code メニュー・ショートカット一覧（拡張なし / learn / ja）、ライト・ダークのコントラスト、200% ズーム・390px・1280px で横スクロールが増えずタブが押し出されない。

### 確認できていないこと（BLOCKED）

- **リポジトリの Settings 画面（実物）**: 管理者でのログインが必要。本テストはログインしない方針なので skip。模擬ページ（`/octo/demo/settings`）でのみ確認。
- **本文の実際の翻訳結果**: Chrome for Testing には翻訳モデルが配信されない（`chrome://components` の TranslateKit が 0.0.0.0 のまま「最新」）。Edge 148 は en→ja が `unavailable`。この PC に通常版の Chrome は無い。通常版 Chrome 138 以降で「本文を日本語で読む」を押して訳が出ることは、人が確かめる必要がある。
- **ログイン後の画面全般**、**Firefox**: 自動テストしていない。

## 12. 残っている課題と改善候補

- 通常版 Chrome での本文翻訳の目視確認（上記）。
- ログイン後の画面（ダッシュボード、通知、ユーザー設定、リポジトリ Settings）での注釈とはみ出しの確認。
- 狭い画面ではページガイドが下端の内容に重なる。折りたたみ表示（アイコンのみ）にする余地がある。
- ツールチップはスクリーンリーダーに読まれない。`aria-describedby` で結ぶと GitHub 本来の説明を上書きしうるため見送った。
- 本文翻訳: Issue/PR のタイトル、後から読み込まれたコメントの自動追従（今は「訳を消す」→ 再度押す）、英語以外の本文（Language Detector が使える環境での対応）。
- グロッサリーの拡充（Discussions のカテゴリ、Codespaces、Copilot 関連など）。
- 上流への提案: Wiki タブ・PR タブが除外されている件は上流でも同じ問題なので、Issue として報告できる（本作業では外部への投稿はしていない）。
