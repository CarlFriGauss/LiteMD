/**
 * LiteMD — 5-Stage Bulletproof Math + Markdown Rendering Pipeline & Dirty-Block Engine
 *
 * Implements AGENT.md Phase 2 & Section 0 Law #3 (Incremental "Dirty-Region" Execution):
 *   Step 1: Protect Code Blocks & Inline Code
 *   Step 2: Extract & Normalize All Math Variants (`mathNormalizer.ts`)
 *   Step 3: Parse Markdown (`markdown-it` with GFM tables, task lists, footnotes, `data-line` & `data-source-line`)
 *   Step 4: Restore & Render Math with KaTeX (`throwOnError: false, trust: true`) + Memoization Cache
 *   Step 5: Restore Fenced & Inline Code Blocks
 */

import MarkdownIt from 'markdown-it';
import katex from 'katex';
import {
  normalizeMathAndCode,
  ExtractedMathToken,
  ExtractedCodeToken,
} from './mathNormalizer';

export interface LogicalBlock {
  index: number;
  startLine: number;
  endLine: number;
  raw: string;
  hash: string;
  html: string;
}

/**
 * Fast 32-bit FNV-1a hash for dirty-block & expression caching.
 * Zero heap allocations beyond the short base36 string return.
 */
export function fnv1aHash(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/**
 * Fast HTML entity escaper for code block restoration.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Ultra-fast, zero-dependency syntax highlighter for fenced code blocks.
 * Highlights comments, strings, numbers, and common keywords without pulling in 500KB of Prism/Highlight.js.
 */
function highlightCodeSyntax(rawCode: string, lang: string): string {
  const escaped = escapeHtml(rawCode);
  if (!lang || lang === 'text' || lang === 'plain' || lang === 'plaintext') {
    return escaped;
  }
  return escaped.replace(
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|(&quot;(?:\\.|[^&])*?&quot;|&#39;(?:\\.|[^&])*?&#39;|`(?:\\.|[^`])*?`)|\b(function|return|const|let|var|if|else|for|while|match|fn|pub|struct|enum|impl|use|mod|async|await|import|export|from|class|interface|type|def|lambda|yield|True|False|None|true|false|null|undefined|mut|ref|where|in|as)\b|\b(\d+(?:\.\d+)?)\b/g,
    (match, comment, strLit, kw, num) => {
      if (comment) return `<span class="hl-comment">${comment}</span>`;
      if (strLit) return `<span class="hl-string">${strLit}</span>`;
      if (kw) return `<span class="hl-keyword">${kw}</span>`;
      if (num) return `<span class="hl-number">${num}</span>`;
      return match;
    }
  );
}

// Level-1 Memoization Cache: KaTeX expression -> rendered HTML
const katexMemoCache = new Map<string, { html: string; hasError: boolean }>();
const MAX_KATEX_CACHE_ENTRIES = 4096;

// Level-2 Dirty-Block Cache: Block FNV-1a hash -> rendered HTML (relative to line 0, patched on output)
const blockMemoCache = new Map<string, string>();
const MAX_BLOCK_CACHE_ENTRIES = 2048;

/**
 * Renders a single normalized LaTeX string through KaTeX with memoization and
 * fault-tolerant amber highlighting for incomplete expressions (spec.md Rule 5).
 */
export function renderKatexCached(token: ExtractedMathToken): string {
  const cacheKey = `${token.displayMode ? 'D' : 'I'}:${token.incomplete ? '1' : '0'}:${token.latex}`;
  let cached = katexMemoCache.get(cacheKey);

  if (!cached) {
    let html = '';
    let hasError = Boolean(token.incomplete);
    try {
      html = katex.renderToString(token.latex, {
        displayMode: token.displayMode,
        throwOnError: false,
        errorColor: '#d97706',
        trust: true,
        strict: false,
      });
      if (html.includes('katex-error')) {
        hasError = true;
      }
    } catch {
      hasError = true;
      html = `<span class="katex-error">${escapeHtml(token.rawSource)}</span>`;
    }

    if (katexMemoCache.size >= MAX_KATEX_CACHE_ENTRIES) {
      const firstKey = katexMemoCache.keys().next().value;
      if (firstKey !== undefined) katexMemoCache.delete(firstKey);
    }
    cached = { html, hasError };
    katexMemoCache.set(cacheKey, cached);
  }

  const incompleteClass = cached.hasError ? ' litemd-math-incomplete' : '';
  if (token.displayMode) {
    return `<div class="litemd-math-block${incompleteClass}" data-math-display="true">${cached.html}</div>`;
  }
  return `<span class="litemd-math-inline${incompleteClass}" data-math-inline="true">${cached.html}</span>`;
}

/**
 * Create and configure the singleton `markdown-it` parser instance.
 */
function createMarkdownItEngine(): MarkdownIt {
  const md = new MarkdownIt({
    html: true,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  // Enable GFM tables and strikethrough explicitly
  md.enable(['table', 'strikethrough']);

  // Inject `data-line` and `data-source-line` attributes on block-level openings
  const blockRules = [
    'paragraph_open',
    'heading_open',
    'table_open',
    'blockquote_open',
    'bullet_list_open',
    'ordered_list_open',
    'list_item_open',
  ];

  for (const ruleName of blockRules) {
    const original = md.renderer.rules[ruleName];
    md.renderer.rules[ruleName] = (tokens, idx, options, env, self) => {
      const token = tokens[idx];
      if (token.map && token.map.length >= 2) {
        const lineOffset = typeof env?.lineOffset === 'number' ? env.lineOffset : 0;
        const startLine = token.map[0] + lineOffset;
        const endLine = token.map[1] + lineOffset;
        token.attrSet('data-line', String(startLine));
        token.attrSet('data-source-line', String(startLine));
        token.attrSet('data-line-end', String(endLine));
      }
      if (original) {
        return original(tokens, idx, options, env, self);
      }
      return self.renderToken(tokens, idx, options);
    };
  }

  // Ensure fenced code blocks also carry `data-line` and `data-source-line`
  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const lineOffset = typeof env?.lineOffset === 'number' ? env.lineOffset : 0;
    const startLine = token.map ? token.map[0] + lineOffset : lineOffset;
    const info = token.info ? token.info.trim() : '';
    const langClass = info ? ` class="language-${escapeHtml(info)}"` : '';
    const langLabel = info ? ` data-lang="${escapeHtml(info)}"` : '';
    return `<pre class="litemd-code-block" data-line="${startLine}" data-source-line="${startLine}"${langLabel}><code${langClass}>${token.content}</code></pre>\n`;
  };

  return md;
}

const mdEngine = createMarkdownItEngine();

/**
 * Post-processes GFM task list items (`- [ ]` and `- [x]`) and footnotes (`[^id]`).
 */
function enhanceGfmTaskListsAndFootnotes(
  html: string,
  footnotesMap: Map<string, string>
): string {
  // 1. Convert `<li>[ ] ...` or `<li><p>[ ] ...` into interactive GFM task list checkboxes
  let processed = html.replace(
    /(<li[^>]*>\s*(?:<p[^>]*>)?)\s*\[([ xX])\]\s+/g,
    (_m, liOpen: string, state: string) => {
      const checked = state.toLowerCase() === 'x';
      const liTagged = liOpen.replace('<li', '<li class="litemd-task-item"');
      return `${liTagged}<input type="checkbox" class="litemd-task-checkbox" ${
        checked ? 'checked' : ''
      } /> `;
    }
  );

  // 2. Replace inline footnote references `[^id]` with superscript links
  if (footnotesMap.size > 0) {
    processed = processed.replace(/\[\^([^\]]+)\]/g, (full, id: string) => {
      if (!footnotesMap.has(id)) return full;
      const safeId = escapeHtml(id);
      return `<sup class="litemd-footnote-ref"><a href="#fn-${safeId}" id="fnref-${safeId}">[${safeId}]</a></sup>`;
    });
  }

  return processed;
}

/**
 * Extracts footnote definitions `[^id]: content` prior to block parsing so they
 * can be rendered at the bottom of the document while references link to them.
 */
function extractFootnoteDefinitions(
  markdown: string,
  footnotesMap: Map<string, string>
): string {
  return markdown.replace(
    /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm,
    (_full, id: string, body: string) => {
      footnotesMap.set(id.trim(), body.trim());
      return '';
    }
  );
}

/**
 * Restores Step 4 (Math placeholders -> KaTeX HTML) and Step 5 (Code placeholders -> Escaped/Highlighted Code).
 */
function restoreMathAndCodePlaceholders(
  html: string,
  mathTokens: ExtractedMathToken[],
  codeTokens: ExtractedCodeToken[]
): string {
  let out = html;

  // Step 4A: Unwrap `<p ...>LITEMDMATHBLOCK{id}END</p>` directly into `<div ... class="litemd-math-block">`
  // so block math is never nested illegally inside a `<p>` tag and preserves `data-line` attributes!
  if (mathTokens.length > 0) {
    out = out.replace(
      /<p([^>]*)>\s*LITEMDMATHBLOCK(\d+)END\s*<\/p>/g,
      (full, pAttrs: string, idStr: string) => {
        const token = mathTokens[Number(idStr)];
        if (!token) return full;
        const rendered = renderKatexCached(token);
        // Inject the paragraph's `data-line` and `data-source-line` attributes onto the math block div
        return rendered.replace(
          /^<div class="([^"]+)"/,
          `<div class="$1"${pAttrs}`
        );
      }
    );

    // Step 4B: Replace any remaining `LITEMDMATHBLOCK{id}END` or `LITEMDMATHINLINE{id}END`
    out = out.replace(
      /LITEMDMATH(?:BLOCK|INLINE)(\d+)END/g,
      (full, idStr: string) => {
        const token = mathTokens[Number(idStr)];
        if (!token) return full;
        return renderKatexCached(token);
      }
    );
  }

  // Step 5: Restore fenced code blocks & inline code spans
  if (codeTokens.length > 0) {
    out = out.replace(
      /LITEMDCODEBLOCK(\d+)END\n*/g,
      (full, idStr: string) => {
        const token = codeTokens[Number(idStr)];
        if (!token) return full;
        return highlightCodeSyntax(token.code, token.lang);
      }
    );

    out = out.replace(
      /LITEMDCODEINLINE(\d+)END/g,
      (full, idStr: string) => {
        const token = codeTokens[Number(idStr)];
        if (!token) return full;
        return escapeHtml(token.code);
      }
    );
  }

  return out;
}

/**
 * Renders a single chunk of Markdown through the 5-stage pipeline.
 */
function renderSingleChunk(
  rawChunk: string,
  lineOffset: number,
  footnotesMap: Map<string, string>
): string {
  // Strip footnote definitions before normalizing so `footnotesMap` retains raw un-tokenized Markdown
  const chunkWithoutFootnoteDefs = rawChunk.replace(
    /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm,
    ''
  );
  if (chunkWithoutFootnoteDefs.trim().length === 0) {
    return '';
  }

  // Steps 1 & 2: Protect Code Blocks + Extract & Normalize Math
  const { normalizedMarkdown, mathTokens, codeTokens } =
    normalizeMathAndCode(chunkWithoutFootnoteDefs);

  // Step 3: Parse Markdown via markdown-it with `lineOffset` injected into `data-line`
  let html = mdEngine.render(normalizedMarkdown, { lineOffset });

  // Enhance GFM task lists and footnote references
  html = enhanceGfmTaskListsAndFootnotes(html, footnotesMap);

  // Steps 4 & 5: Restore & Render Math with KaTeX + Restore Code Blocks
  html = restoreMathAndCodePlaceholders(html, mathTokens, codeTokens);

  return html;
}

/**
 * Splits a full Markdown document into top-level logical blocks (paragraphs, headings,
 * tables, fenced code blocks, and multi-line display math blocks `$$...$$`, `\[...\]`, `\begin{...}...\end{...}`).
 *
 * CRITICAL: Never splits inside a fenced code block or inside a multi-line display math block,
 * even when that display math block contains blank lines (`\n\n`)!
 */
export function splitIntoLogicalBlocks(
  markdown: string
): Array<{ startLine: number; endLine: number; raw: string; hash: string }> {
  const normalized = markdown.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  const blocks: Array<{
    startLine: number;
    endLine: number;
    raw: string;
    hash: string;
  }> = [];

  let currentLines: string[] = [];
  let blockStartLine = 0;

  let inFence = false;
  let fenceMarker = '';
  let inDollarBlock = false;
  let inBracketBlock = false;
  let activeEnvName: string | null = null;

  const flushBlock = (endLineIdx: number) => {
    if (currentLines.length === 0) return;
    const raw = currentLines.join('\n');
    if (raw.trim().length > 0) {
      blocks.push({
        startLine: blockStartLine,
        endLine: endLineIdx,
        raw,
        hash: fnv1aHash(raw),
      });
    }
    currentLines = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (currentLines.length === 0) {
      if (trimmed.length === 0) {
        continue; // Skip blank lines between blocks
      }
      blockStartLine = i;
    }

    currentLines.push(line);

    // Track fenced code block state (` ``` ` or ` ~~~ `)
    if (!inDollarBlock && !inBracketBlock && !activeEnvName) {
      const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);
      if (fenceMatch) {
        if (!inFence) {
          inFence = true;
          fenceMarker = fenceMatch[1][0];
          continue;
        } else if (trimmed.startsWith(fenceMarker.repeat(3))) {
          inFence = false;
          fenceMarker = '';
          continue;
        }
      }
    }

    if (inFence) continue;

    // Track multi-line `$$ ... $$` state (count unescaped `$$` tokens on this line)
    const dollarMatches = line.match(/(?<!\\)\$\$/g);
    if (dollarMatches && dollarMatches.length % 2 === 1) {
      inDollarBlock = !inDollarBlock;
    }

    // Track multi-line `\[ ... \]` state
    if (!inDollarBlock) {
      if (line.includes('\\[') && !line.includes('\\]')) {
        inBracketBlock = true;
      } else if (inBracketBlock && line.includes('\\]')) {
        inBracketBlock = false;
      }
    }

    // Track standalone `\begin{env} ... \end{env}` state
    if (!inDollarBlock && !inBracketBlock) {
      if (!activeEnvName) {
        const beginMatch = line.match(
          /\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|bmatrix|pmatrix|vmatrix|Bmatrix|Vmatrix|matrix|cases|split|multline\*?)\}/
        );
        if (beginMatch && !line.includes(`\\end{${beginMatch[1]}}`)) {
          activeEnvName = beginMatch[1];
        }
      } else if (line.includes(`\\end{${activeEnvName}}`)) {
        activeEnvName = null;
      }
    }

    const insideMultilineMath =
      inDollarBlock || inBracketBlock || activeEnvName !== null;

    // If we are not inside fenced code or multi-line math, a blank line on `i + 1` ends the block
    if (!insideMultilineMath && i + 1 < lines.length && lines[i + 1].trim().length === 0) {
      flushBlock(i + 1);
    }
  }

  flushBlock(lines.length);
  return blocks;
}

/**
 * Full 5-stage Markdown + Math renderer with Dirty-Block Memoization.
 * Used by both Engine A, Engine B, and automated test suites.
 */
export function renderMarkdown(markdown: string): string {
  if (!markdown || markdown.trim().length === 0) {
    return '';
  }

  // If the document contains footnote definitions (`[^id]:`), render in a unified pass
  // or share the footnote map across blocks.
  const hasFootnotes = /^\[\^[^\]]+\]:/m.test(markdown);
  const footnotesMap = new Map<string, string>();
  if (hasFootnotes) {
    extractFootnoteDefinitions(markdown, footnotesMap);
  }

  const rawBlocks = splitIntoLogicalBlocks(markdown);
  const htmlParts: string[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const blk = rawBlocks[i];
    const cacheKey = `${blk.hash}:${blk.startLine}:${hasFootnotes ? footnotesMap.size : 0}`;
    let blockHtml = blockMemoCache.get(cacheKey);

    if (blockHtml === undefined) {
      blockHtml = renderSingleChunk(blk.raw, blk.startLine, footnotesMap);
      if (blockMemoCache.size >= MAX_BLOCK_CACHE_ENTRIES) {
        const firstKey = blockMemoCache.keys().next().value;
        if (firstKey !== undefined) blockMemoCache.delete(firstKey);
      }
      blockMemoCache.set(cacheKey, blockHtml);
    }

    if (blockHtml.trim().length > 0) {
      htmlParts.push(blockHtml);
    }
  }

  if (footnotesMap.size > 0) {
    const items: string[] = [];
    footnotesMap.forEach((body, id) => {
      const safeId = escapeHtml(id);
      const renderedBody = renderSingleChunk(body, 0, new Map());
      items.push(
        `<li id="fn-${safeId}" class="litemd-footnote-item">${renderedBody} <a href="#fnref-${safeId}" class="litemd-footnote-backref">↩</a></li>`
      );
    });
    htmlParts.push(
      `<section class="litemd-footnotes"><hr /><ol>${items.join('')}</ol></section>`
    );
  }

  return htmlParts.join('\n');
}

/**
 * Incremental "Dirty-Region" DOM Updater for Engine A Live Preview (`AGENT.md` Law #3).
 *
 * Hashes each logical block in the document and patches ONLY the `<div class="litemd-preview-block">`
 * nodes whose content hash or line offset actually mutated. Unchanged blocks and equations
 * remain completely untouched in the DOM—zero layout thrashing, zero flicker!
 */
export function renderIncrementalPreview(
  container: HTMLElement,
  markdown: string
): LogicalBlock[] {
  const hasFootnotes = /^\[\^[^\]]+\]:/m.test(markdown);
  const footnotesMap = new Map<string, string>();
  if (hasFootnotes) {
    extractFootnoteDefinitions(markdown, footnotesMap);
  }

  const rawBlocks = splitIntoLogicalBlocks(markdown);
  const resultBlocks: LogicalBlock[] = new Array(rawBlocks.length);

  for (let i = 0; i < rawBlocks.length; i++) {
    const blk = rawBlocks[i];
    const cacheKey = `${blk.hash}:${blk.startLine}:${hasFootnotes ? footnotesMap.size : 0}`;
    let blockHtml = blockMemoCache.get(cacheKey);

    if (blockHtml === undefined) {
      blockHtml = renderSingleChunk(blk.raw, blk.startLine, footnotesMap);
      if (blockMemoCache.size >= MAX_BLOCK_CACHE_ENTRIES) {
        const firstKey = blockMemoCache.keys().next().value;
        if (firstKey !== undefined) blockMemoCache.delete(firstKey);
      }
      blockMemoCache.set(cacheKey, blockHtml);
    }

    resultBlocks[i] = {
      index: i,
      startLine: blk.startLine,
      endLine: blk.endLine,
      raw: blk.raw,
      hash: cacheKey,
      html: blockHtml,
    };
  }

  // Append footnotes block if present
  if (footnotesMap.size > 0) {
    const items: string[] = [];
    footnotesMap.forEach((body, id) => {
      const safeId = escapeHtml(id);
      const renderedBody = renderSingleChunk(body, 0, new Map());
      items.push(
        `<li id="fn-${safeId}" class="litemd-footnote-item">${renderedBody} <a href="#fnref-${safeId}" class="litemd-footnote-backref">↩</a></li>`
      );
    });
    const fnHtml = `<section class="litemd-footnotes"><hr /><ol>${items.join('')}</ol></section>`;
    const lastLine =
      rawBlocks.length > 0 ? rawBlocks[rawBlocks.length - 1].endLine : 0;
    resultBlocks.push({
      index: resultBlocks.length,
      startLine: lastLine,
      endLine: lastLine + 1,
      raw: '',
      hash: `fn:${fnv1aHash(fnHtml)}`,
      html: fnHtml,
    });
  }

  // Surgical Dirty-Region DOM Reconciliation
  const existingChildren = container.children;

  for (let i = 0; i < resultBlocks.length; i++) {
    const blk = resultBlocks[i];
    const existingEl = existingChildren[i] as HTMLElement | undefined;

    if (!existingEl) {
      const wrapper = document.createElement('div');
      wrapper.className = 'litemd-preview-block';
      wrapper.setAttribute('data-block-hash', blk.hash);
      wrapper.setAttribute('data-line', String(blk.startLine));
      wrapper.setAttribute('data-source-line', String(blk.startLine));
      wrapper.setAttribute('data-line-end', String(blk.endLine));
      wrapper.innerHTML = blk.html;
      container.appendChild(wrapper);
    } else if (existingEl.getAttribute('data-block-hash') !== blk.hash) {
      existingEl.setAttribute('data-block-hash', blk.hash);
      existingEl.setAttribute('data-line', String(blk.startLine));
      existingEl.setAttribute('data-source-line', String(blk.startLine));
      existingEl.setAttribute('data-line-end', String(blk.endLine));
      existingEl.innerHTML = blk.html;
    }
  }

  // Remove any stale trailing DOM blocks if the document shrank
  while (container.children.length > resultBlocks.length) {
    container.removeChild(container.lastElementChild!);
  }

  return resultBlocks;
}
