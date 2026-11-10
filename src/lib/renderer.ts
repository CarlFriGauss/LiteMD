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
import { hasPresentation, imageMarkup, imageSource, IMAGE_FEATURE, sanitizePresentation } from './presentation';
import { presentationBlockEnd } from './htmlBlocks';
import { bindBlockPresentation, documentResources, prepareDocumentRoot, releaseBlockPresentation, type BlockPresentation, type RenderDocument } from './documentResources';
import {
  normalizeMathAndCode,
  ExtractedMathToken,
  ExtractedCodeToken,
} from './mathNormalizer';

export interface LogicalBlock extends BlockPresentation {
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
 * Tokenizes raw unescaped code first and escapes each slice so HTML entities like `&#39;`
 * never collide with `#` comment rules or corrupt Rust lifetimes (`'a`) and contractions (`don't`).
 */
export function highlightCodeSyntax(rawCode: string, lang: string): string {
  if (!lang || lang === 'text' || lang === 'plain' || lang === 'plaintext') {
    return escapeHtml(rawCode);
  }

  const tokenRegex =
    /(\/\/[^\n]*|#[^\n]*|\/\*[\s\S]*?\*\/)|("(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n]){0,1}'|`(?:\\.|[^`\\])*`)|(\b(?:function|return|const|let|var|if|else|for|while|match|fn|pub|struct|enum|impl|use|mod|async|await|import|export|from|class|interface|type|def|lambda|yield|True|False|None|true|false|null|undefined|mut|ref|where|in|as)\b)|(\b\d+(?:\.\d+)?\b)/g;

  let out = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = tokenRegex.exec(rawCode)) !== null) {
    if (match.index > lastIndex) {
      out += escapeHtml(rawCode.slice(lastIndex, match.index));
    }
    const [full, comment, strLit, kw, num] = match;
    const escapedToken = escapeHtml(full);
    if (comment) {
      out += `<span class="hl-comment">${escapedToken}</span>`;
    } else if (strLit) {
      out += `<span class="hl-string">${escapedToken}</span>`;
    } else if (kw) {
      out += `<span class="hl-keyword">${escapedToken}</span>`;
    } else if (num) {
      out += `<span class="hl-number">${escapedToken}</span>`;
    } else {
      out += escapedToken;
    }
    lastIndex = tokenRegex.lastIndex;
  }

  if (lastIndex < rawCode.length) {
    out += escapeHtml(rawCode.slice(lastIndex));
  }

  return out;
}

// Level-1 Memoization Cache: KaTeX expression -> rendered HTML
const katexMemoCache = new Map<string, { html: string; hasError: boolean }>();
const MAX_KATEX_CACHE_ENTRIES = 4096;

// Level-2 Dirty-Block Cache: Block FNV-1a hash (relative to line 0) -> rendered HTML
interface RenderedChunk extends BlockPresentation { html: string }
const blockMemoCache = new Map<string, RenderedChunk>();
const MAX_BLOCK_CACHE_ENTRIES = 2048;

let blockCacheHits = 0;
let blockCacheMisses = 0;

export function getBlockCacheStats(): { hits: number; misses: number } {
  return { hits: blockCacheHits, misses: blockCacheMisses };
}

export function resetBlockCacheStats(): void {
  blockCacheHits = 0;
  blockCacheMisses = 0;
}

/**
 * Shifts relative (`lineOffset = 0`) line attributes (`data-line`, `data-source-line`, `data-line-end`)
 * by `lineOffset` so cached block HTML remains 100% valid when lines are inserted/deleted above it.
 */
function shiftHtmlLineOffsets(relativeHtml: string, lineOffset: number): string {
  if (lineOffset === 0) return relativeHtml;
  return relativeHtml.replace(
    /\b(data-(?:source-)?line(?:-end)?)="(\d+)"/g,
    (_m, attr: string, numStr: string) => `${attr}="${Number(numStr) + lineOffset}"`
  );
}

/**
 * Renders a single normalized LaTeX string through KaTeX with memoization,
 * `trust: false` security hardening, and fault-tolerant amber highlighting (spec.md Rule 5).
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
        trust: false,
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
    return `<div class="litemd-math-block${incompleteClass}" dir="ltr" data-math-display="true">${cached.html}</div>`;
  }
  return `<span class="litemd-math-inline${incompleteClass}" dir="ltr" data-math-inline="true">${cached.html}</span>`;
}

/**
 * Create and configure the singleton `markdown-it` parser instance.
 * Hardened with `html: false` and strict link protocol validation to prevent XSS/RCE.
 */
function createMarkdownItEngine(): MarkdownIt {
  const md = new MarkdownIt({
    html: false,
    linkify: true,
    typographer: false,
    breaks: false,
  });

  // Strictly block `javascript:`, `vbscript:`, `data:`, and `file:` URLs
  md.validateLink = (url: string): boolean => {
    const clean = url.trim().toLowerCase();
    if (
      clean.startsWith('javascript:') ||
      clean.startsWith('vbscript:') ||
      clean.startsWith('data:') ||
      clean.startsWith('file:')
    ) {
      return false;
    }
    return true;
  };

  // Enable GFM tables and strikethrough explicitly
  md.enable(['table', 'strikethrough']);

  function attributeRestore(value: string, env: { mathTokens?: ExtractedMathToken[]; codeTokens?: ExtractedCodeToken[] }): string {
    return value.replace(/LITEMD(MATH|CODE)(?:BLOCK|INLINE)(\d+)END/g, (token, kind: string, id: string) =>
      (kind === 'MATH' ? env.mathTokens?.[Number(id)]?.rawSource : env.codeTokens?.[Number(id)]?.code) ?? token);
  }
  md.renderer.rules.image = (tokens, idx, options, env, renderer) => {
    const token = tokens[idx], source = attributeRestore(token.attrGet('src') || '', env);
    env.features |= IMAGE_FEATURE;
    if (imageSource(source) === 'local') (env.images ??= []).push(source);
    const children = token.children || [];
    const alt = children.some(child => child.type === 'code_inline')
      ? children.map(child => child.type === 'code_inline' ? child.content : renderer.renderInlineAsText([child], options, env)).join('')
      : renderer.renderInlineAsText(children, options, env);
    return imageMarkup(source, alt, token.attrGet('title') || '', value => attributeRestore(value, env));
  };
  for (const type of ['html_block', 'html_inline']) {
    md.renderer.rules[type] = (tokens, idx, _options, env) => {
      const result = sanitizePresentation(tokens[idx].content, type === 'html_inline', value => attributeRestore(value, env));
      env.features |= result.features;
      if (result.images?.length) (env.images ??= []).push(...result.images);
      return result.html;
    };
  }
  // Compatibility extension for relative image filenames with unbracketed spaces.
  // Standard destinations/titles continue through markdown-it's existing image rule.
  md.inline.ruler.before('image', 'litemd_image_spaces', (state, silent) => {
    const start = state.pos;
    if (state.src.slice(start, start + 2) !== '![') return false;
    const labelEnd = state.md.helpers.parseLinkLabel(state, start + 1, false);
    if (labelEnd < 0 || state.src[labelEnd + 1] !== '(') return false;
    let end = labelEnd + 2, depth = 1;
    for (; end < state.posMax && end - start < 4096; end++) {
      const char = state.src[end];
      if (char === '\n') return false;
      if (char === '\\') { end++; continue; }
      if (char === '(') depth++;
      if (char === ')' && --depth === 0) break;
    }
    if (depth || end >= state.posMax) return false;
    const source = state.src.slice(labelEnd + 2, end).trim();
    if (!source.includes(' ') || /\s+["'(]/.test(source) || imageSource(source) !== 'local') return false;
    if (!silent) {
      const token = state.push('image', 'img', 0);
      token.attrs = [['src', state.md.normalizeLink(source)], ['alt', '']];
      token.children = [];
      token.content = state.src.slice(start + 2, labelEnd);
      state.md.inline.parse(token.content, state.md, state.env, token.children);
    }
    state.pos = end + 1;
    return true;
  });

  // Inject `dir="auto"`, `data-line`, and `data-source-line` attributes on block-level openings
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
      token.attrSet('dir', 'auto');
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

  // Ensure fenced code blocks carry `dir="ltr"`, `data-line`, and `data-source-line`
  md.renderer.rules.fence = (tokens, idx, _options, env) => {
    const token = tokens[idx];
    const lineOffset = typeof env?.lineOffset === 'number' ? env.lineOffset : 0;
    const startLine = token.map ? token.map[0] + lineOffset : lineOffset;
    const info = token.info ? token.info.trim() : '';
    const langClass = info ? ` class="language-${escapeHtml(info)}"` : '';
    const langLabel = info ? ` data-lang="${escapeHtml(info)}"` : '';
    return `<pre class="litemd-code-block" dir="ltr" data-line="${startLine}" data-source-line="${startLine}"${langLabel}><code${langClass}>${escapeHtml(token.content)}</code></pre>\n`;
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
      // Author HTML lists are presentation; only Markdown list items are interactive tasks.
      if (liOpen.includes('data-litemd-presentation')) return _m;
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
): RenderedChunk {
  // Strip footnote definitions before normalizing so `footnotesMap` retains raw un-tokenized Markdown
  const chunkWithoutFootnoteDefs = rawChunk.replace(
    /^\[\^([^\]]+)\]:[ \t]*(.+)$/gm,
    ''
  );
  if (chunkWithoutFootnoteDefs.trim().length === 0) {
    return { html: '', features: 0 };
  }

  // Steps 1 & 2: Protect Code Blocks + Extract & Normalize Math
  const { normalizedMarkdown, mathTokens, codeTokens } =
    normalizeMathAndCode(chunkWithoutFootnoteDefs);

  // Step 3: Parse Markdown via markdown-it with `lineOffset` injected into `data-line`
  const env = { lineOffset, features: 0, images: undefined as string[] | undefined, mathTokens, codeTokens };
  mdEngine.options.html = hasPresentation(normalizedMarkdown);
  let html: string;
  try { html = mdEngine.render(normalizedMarkdown, env); }
  finally { mdEngine.options.html = false; }

  // Enhance GFM task lists and footnote references
  html = enhanceGfmTaskListsAndFootnotes(html, footnotesMap);

  // Steps 4 & 5: Restore & Render Math with KaTeX + Restore Code Blocks
  html = restoreMathAndCodePlaceholders(html, mathTokens, codeTokens);

  return { html, features: env.features, images: env.images };
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
  let htmlEnd = -1;

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
    if (!inDollarBlock && !inBracketBlock && !activeEnvName && i > htmlEnd && trimmed.startsWith('<')) {
      htmlEnd = presentationBlockEnd(lines, i);
    }
    if (i < htmlEnd) continue;

    // Strip inline code spans (`...`) and same-line Markdown escaped brackets (`\[text]`)
    // before checking math block delimiters so `` `$$` ``, `` `\[` ``, or `\[text]` never flips block state!
    const lineNoCode = line
      .replace(/(`+)[^`]*?\1/g, '')
      .replace(/(?<!\\)\\\[[^\[\]\n]*?(?<!\\)\]/g, '');

    // Track multi-line `$$ ... $$` state (count unescaped `$$` tokens outside inline code)
    const dollarMatches = lineNoCode.match(/(?<!\\)\$\$/g);
    if (dollarMatches && dollarMatches.length % 2 === 1) {
      if (!inDollarBlock) {
        // Only enter multi-line dollar mode if a closing `$$` actually exists later in the document
        let hasClosingDollar = false;
        for (let k = i + 1; k < lines.length; k++) {
          const futureNoCode = lines[k].replace(/(`+)[^`]*?\1/g, '');
          if (/(?<!\\)\$\$/.test(futureNoCode)) {
            hasClosingDollar = true;
            break;
          }
        }
        if (hasClosingDollar) inDollarBlock = true;
      } else {
        inDollarBlock = false;
      }
    }

    // Track multi-line `\[ ... \]` state (ignoring escaped `\\[` and Markdown `\[text]`)
    if (!inDollarBlock) {
      const openBrackets = (lineNoCode.match(/(?<!\\)\\\[/g) || []).length;
      const closeBrackets = (lineNoCode.match(/(?<!\\)\\\]/g) || []).length;
      if (!inBracketBlock && openBrackets > closeBrackets) {
        // Only enter multi-line bracket mode if a closing `\]` exists before any next `\[`
        let hasClosingBracket = false;
        for (let k = i + 1; k < lines.length; k++) {
          const futureNoCode = lines[k]
            .replace(/(`+)[^`]*?\1/g, '')
            .replace(/(?<!\\)\\\[[^\[\]\n]*?(?<!\\)\]/g, '');
          if (/(?<!\\)\\\]/.test(futureNoCode)) {
            hasClosingBracket = true;
            break;
          }
          if (/(?<!\\)\\\[/.test(futureNoCode)) {
            break;
          }
        }
        if (hasClosingBracket) inBracketBlock = true;
      } else if (inBracketBlock && closeBrackets > openBrackets) {
        inBracketBlock = false;
      }
    }

    // Track standalone `\begin{env} ... \end{env}` state outside inline code
    if (!inDollarBlock && !inBracketBlock) {
      if (!activeEnvName) {
        const beginMatch = lineNoCode.match(
          /\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|bmatrix|pmatrix|vmatrix|Bmatrix|Vmatrix|matrix|cases|split|multline\*?)\}/
        );
        if (beginMatch && !lineNoCode.includes(`\\end{${beginMatch[1]}}`)) {
          activeEnvName = beginMatch[1];
        }
      } else if (lineNoCode.includes(`\\end{${activeEnvName}}`)) {
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
 * Renders a logical block using the line-number-independent `blockMemoCache`
 * and shifts `data-line` / `data-source-line` attributes to `blk.startLine`.
 */
function renderBlockCached(
  blk: { startLine: number; endLine: number; raw: string; hash: string },
  footnotesMap: Map<string, string>,
  footnotesSig: string
): RenderedChunk & { contentKey: string } {
  const contentKey = `${blk.hash}:${footnotesSig}`;
  let relativeHtml = blockMemoCache.get(contentKey);

  if (relativeHtml === undefined) {
    blockCacheMisses++;
    relativeHtml = renderSingleChunk(blk.raw, 0, footnotesMap);
    if (blockMemoCache.size >= MAX_BLOCK_CACHE_ENTRIES) {
      const firstKey = blockMemoCache.keys().next().value;
      if (firstKey !== undefined) blockMemoCache.delete(firstKey);
    }
    blockMemoCache.set(contentKey, relativeHtml);
  } else {
    blockCacheHits++;
  }

  return {
    contentKey,
    html: shiftHtmlLineOffsets(relativeHtml.html, blk.startLine),
    features: relativeHtml.features,
    images: relativeHtml.images,
  };
}

/**
 * Full 5-stage Markdown + Math renderer with Line-Number-Independent Dirty-Block Memoization.
 * Used by both Engine A, Engine B, and automated test suites.
 */
export function renderMarkdown(markdown: string, metadata?: BlockPresentation, lineOffset = 0): string {
  if (!markdown || markdown.trim().length === 0) {
    return '';
  }

  const hasFootnotes = /^\[\^[^\]]+\]:/m.test(markdown);
  const footnotesMap = new Map<string, string>();
  let footnotesSig = '0';
  if (hasFootnotes) {
    extractFootnoteDefinitions(markdown, footnotesMap);
    footnotesSig = Array.from(footnotesMap.keys()).join(',');
  }

  const rawBlocks = splitIntoLogicalBlocks(markdown);
  const htmlParts: string[] = [];

  for (let i = 0; i < rawBlocks.length; i++) {
    const { html: blockHtml, features, images } = renderBlockCached(
      rawBlocks[i],
      footnotesMap,
      footnotesSig
    );
    if (metadata) {
      metadata.features |= features;
      if (images?.length) (metadata.images ??= []).push(...images);
    }
    if (blockHtml.trim().length > 0) {
      htmlParts.push(shiftHtmlLineOffsets(blockHtml, lineOffset));
    }
  }

  if (footnotesMap.size > 0) {
    const items: string[] = [];
    footnotesMap.forEach((body, id) => {
      const safeId = escapeHtml(id);
      const rendered = renderSingleChunk(body, 0, new Map());
      const renderedBody = rendered.html;
      if (metadata) {
        metadata.features |= rendered.features;
        if (rendered.images?.length) (metadata.images ??= []).push(...rendered.images);
      }
      items.push(
        `<li id="fn-${safeId}" class="litemd-footnote-item" dir="auto">${renderedBody} <a href="#fnref-${safeId}" class="litemd-footnote-backref">↩</a></li>`
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
 * Keys the block cache strictly on block content hash (independent of `startLine`),
 * so inserting or deleting lines at the top of a 1,500-paragraph document never
 * re-parses Markdown or re-renders KaTeX for unchanged blocks below!
 */
export function renderIncrementalPreview(
  container: HTMLElement,
  markdown: string,
  documentContext?: RenderDocument
): LogicalBlock[] {
  if (documentContext) prepareDocumentRoot(container, documentContext);
  const hasFootnotes = /^\[\^[^\]]+\]:/m.test(markdown);
  const footnotesMap = new Map<string, string>();
  let footnotesSig = '0';
  if (hasFootnotes) {
    extractFootnoteDefinitions(markdown, footnotesMap);
    footnotesSig = Array.from(footnotesMap.keys()).join(',');
  }

  const rawBlocks = splitIntoLogicalBlocks(markdown);
  const resultBlocks: LogicalBlock[] = new Array(rawBlocks.length);

  for (let i = 0; i < rawBlocks.length; i++) {
    const blk = rawBlocks[i];
    const { contentKey, html: blockHtml, features, images } = renderBlockCached(
      blk,
      footnotesMap,
      footnotesSig
    );

    resultBlocks[i] = {
      index: i,
      startLine: blk.startLine,
      endLine: blk.endLine,
      raw: blk.raw,
      hash: documentContext && features ? contentKey + ':' + documentResources(documentContext).domKey : contentKey,
      html: blockHtml,
      features,
      images,
    };
  }

  // Append footnotes block if present
  if (footnotesMap.size > 0) {
    const items: string[] = [];
    let features = 0;
    let images: string[] | undefined;
    footnotesMap.forEach((body, id) => {
      const safeId = escapeHtml(id);
      const rendered = renderSingleChunk(body, 0, new Map());
      const renderedBody = rendered.html;
      features |= rendered.features;
      if (rendered.images?.length) (images ??= []).push(...rendered.images);
      items.push(
        `<li id="fn-${safeId}" class="litemd-footnote-item" dir="auto">${renderedBody} <a href="#fnref-${safeId}" class="litemd-footnote-backref">↩</a></li>`
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
      hash: `fn:${fnv1aHash(fnHtml)}` + (documentContext && features ? ':' + documentResources(documentContext).domKey : ''),
      html: fnHtml,
      features,
      images,
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
      if (documentContext && blk.features) bindBlockPresentation(wrapper, documentContext, blk);
    } else if (existingEl.getAttribute('data-block-hash') !== blk.hash) {
      existingEl.setAttribute('data-block-hash', blk.hash);
      existingEl.setAttribute('data-line', String(blk.startLine));
      existingEl.setAttribute('data-source-line', String(blk.startLine));
      existingEl.setAttribute('data-line-end', String(blk.endLine));
      const previous = releaseBlockPresentation(existingEl);
      existingEl.innerHTML = blk.html;
      if (documentContext && blk.features) bindBlockPresentation(existingEl, documentContext, blk, previous);
    } else if (existingEl.getAttribute('data-line') !== String(blk.startLine)) {
      // Content hash is 100% identical; only line offset shifted (e.g. Enter pressed above).
      // Update wrapper line attributes and inner child line attributes without rebuilding DOM/KaTeX!
      const oldStart = Number(existingEl.getAttribute('data-line') || 0);
      const delta = blk.startLine - oldStart;
      existingEl.setAttribute('data-line', String(blk.startLine));
      existingEl.setAttribute('data-source-line', String(blk.startLine));
      existingEl.setAttribute('data-line-end', String(blk.endLine));
      if (delta !== 0) {
        const innerLineEls = existingEl.querySelectorAll<HTMLElement>('[data-line]');
        for (let j = 0; j < innerLineEls.length; j++) {
          const el = innerLineEls[j];
          const prevLn = Number(el.getAttribute('data-line') || 0);
          el.setAttribute('data-line', String(prevLn + delta));
          el.setAttribute('data-source-line', String(prevLn + delta));
          const prevEnd = el.getAttribute('data-line-end');
          if (prevEnd !== null) {
            el.setAttribute('data-line-end', String(Number(prevEnd) + delta));
          }
        }
      }
    }
  }

  // Remove any stale trailing DOM blocks if the document shrank
  while (container.children.length > resultBlocks.length) {
    releaseBlockPresentation(container.lastElementChild as HTMLElement);
    container.removeChild(container.lastElementChild!);
  }

  return resultBlocks;
}
