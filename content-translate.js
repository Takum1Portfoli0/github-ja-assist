// GitHub 日本語アシスト - README / Issue / Pull request 本文の翻訳（ユーザー操作時のみ）
//
// - 原文には一切触れず、各段落の直後（リスト項目・表のセル等では内側の末尾）に訳文を別要素で足す
// - 訳文は textContent と <code> 要素だけで組み立てる（innerHTML は使わない）
// - コードブロック（pre）は訳さない。インラインコードはバッククォートで囲んで翻訳器に渡し、
//   訳文側で <code> に戻す
// - 翻訳器（Chrome の Translator API のインスタンス）は呼び出し側が渡す。ここは通信しない
(() => {
  const BLOCK = 'p, li, h1, h2, h3, h4, h5, h6, td, th, dt, dd, summary';
  // ブロックの文章を集めるとき、ここに当たる子孫は別ブロックとして扱い中に入らない
  const NESTED = 'p, ul, ol, pre, table, blockquote, div, h1, h2, h3, h4, h5, h6, details, dl, hr, .ghja-tr';
  const SKIP = 'pre, code, .ghja-tr, textarea, [contenteditable="true"], .notranslate, [translate="no"]';
  const INLINE_CODE = 'code, kbd, samp';
  const IGNORED = 'img, svg, button, input, select, textarea, script, style, template, [aria-hidden="true"]';
  // 訳文を中に入れるブロック（それ以外は直後の兄弟として入れる）
  const INSIDE = new Set(['LI', 'TD', 'TH', 'DT', 'DD', 'SUMMARY']);

  function blockText(block) {
    let text = '';
    const walk = (node) => {
      for (const child of node.childNodes) {
        if (child.nodeType === Node.TEXT_NODE) {
          text += child.nodeValue;
        } else if (child.nodeType === Node.ELEMENT_NODE) {
          if (child.matches(NESTED) || child.matches(IGNORED)) continue;
          if (child.matches(INLINE_CODE)) text += `\`${child.textContent}\``;
          else walk(child);
        }
      }
    };
    walk(block);
    return text.replace(/\s+/g, ' ').trim();
  }

  // 英語（ラテン文字）が主体の文だけを訳す。日本語・中国語・韓国語が主体の文や、
  // コードとURLしかない文は対象外
  function isTranslatable(text) {
    const prose = text.replace(/`[^`]*`/g, ' ').replace(/https?:\/\/\S+/g, ' ');
    const latin = (prose.match(/[A-Za-z]/g) || []).length;
    const cjk = (prose.match(/[぀-ヿ㐀-鿿가-힯]/g) || []).length;
    return latin >= 2 && cjk * 3 < latin;
  }

  function hasTranslation(block) {
    return INSIDE.has(block.tagName)
      ? Boolean(block.querySelector(':scope > .ghja-tr'))
      : Boolean(block.nextElementSibling?.classList.contains('ghja-tr'));
  }

  function collectBlocks(doc = document) {
    const blocks = [];
    // .markdown-body が入れ子になっていても同じ段落を2回訳さない
    const seen = new Set();
    for (const body of doc.querySelectorAll('.markdown-body')) {
      // 非表示の本文（編集フォームのプレビュー枠など）と入力中の欄は対象外
      if (body.closest(SKIP) || body.getClientRects().length === 0) continue;
      for (const block of body.querySelectorAll(BLOCK)) {
        if (seen.has(block) || block.closest(SKIP) || hasTranslation(block)) continue;
        seen.add(block);
        const text = blockText(block);
        if (isTranslatable(text)) blocks.push({ block, text });
      }
    }
    return blocks;
  }

  function renderTranslation(text) {
    const div = document.createElement('div');
    div.className = 'ghja-tr';
    div.lang = 'ja';
    // ブラウザのページ翻訳が訳文をさらに訳さないようにする
    div.setAttribute('translate', 'no');
    text.split(/`([^`\n]+)`/).forEach((part, i) => {
      if (i % 2 === 1) {
        const code = document.createElement('code');
        code.textContent = part;
        div.append(code);
      } else if (part) {
        div.append(part);
      }
    });
    return div;
  }

  function place(block, node) {
    if (!INSIDE.has(block.tagName)) {
      block.after(node);
      return;
    }
    // 入れ子のリストがある項目では、項目自身の文の直後（入れ子の前）に入れる
    const nested = [...block.children].find((child) => child.matches('ul, ol, dl, table, pre, div'));
    block.insertBefore(node, nested || null);
  }

  async function translateBodies(translator, { onProgress, signal } = {}) {
    const blocks = collectBlocks();
    let done = 0;
    for (const { block, text } of blocks) {
      if (signal?.aborted) break;
      if (!block.isConnected || hasTranslation(block)) continue;
      const translated = await translator.translate(text, signal ? { signal } : undefined);
      // 待っている間に元の段落が消えたり、二重に押されたりした場合は入れない
      if (!block.isConnected || hasTranslation(block)) continue;
      place(block, renderTranslation(translated));
      done += 1;
      onProgress?.(done, blocks.length);
    }
    return done;
  }

  function removeTranslations(doc = document) {
    doc.querySelectorAll('.ghja-tr').forEach((node) => node.remove());
  }

  globalThis.GitHubJaContentTranslate = {
    collectBlocks,
    isTranslatable,
    removeTranslations,
    translateBodies
  };
})();
