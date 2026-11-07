/**
 * LiteMD — Raw Editor Backdrop Highlighter, Visual Soft-Wrap Gutter & Slash Command Engine
 *
 * Strictly obeys:
 * - spec.md Section 6: Intelligent Visual Soft-Wrapping (Zero Raw File Mutation) + Visual Continuation Cue (`↪`)
 * - spec.md Section 7.B: Subtle syntax-highlighting token colors for `#` headings, `*emphasis*`, and `$math$` regions
 * - spec.md Section 3: Quick slash commands (`/math`, `/matrix`, `/align`, `/table`, `/code`) with zero autocomplete popups
 */

import { escapeHtml } from './renderer';

/** Splices one inline-editor block while preserving every byte outside that block. */
export function replaceBlockSource(raw: string, startLine: number, endLine: number, replacement: string): string {
  const lineOffset = (line: number): number => {
    let offset = 0;
    for (let i = 0; i < line; i++) {
      const next = raw.indexOf('\n', offset);
      if (next < 0) return raw.length;
      offset = next + 1;
    }
    return offset;
  };
  const from = lineOffset(startLine);
  const to = lineOffset(endLine);
  const separator = to > from && raw[to - 1] === '\n'
    ? raw[to - 2] === '\r' ? '\r\n' : '\n'
    : '';
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const inserted = replacement.replace(/\r\n/g, '\n').replace(/\n/g, eol);
  return raw.slice(0, from) + inserted + separator + raw.slice(to);
}

/**
 * Highlights raw Markdown & LaTeX tokens for the synchronized `<pre class="litemd-editor-backdrop">` mirror.
 * Crucial invariant: Every character and newline in `raw` is preserved 1-to-1 so `<textarea>`
 * caret coordinates match the backdrop 100%.
 */
export function highlightRawMarkdownForBackdrop(raw: string): string {
  const escaped = escapeHtml(raw);

  // Single-pass token regex that never overlaps HTML entities or already-wrapped spans
  return escaped.replace(
    /(```[\s\S]*?```|`[^`\n]+`)|(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\\begin\{[a-zA-Z*]+\}[\s\S]*?\\end\{[a-zA-Z*]+\}|(?<!\\)\$[^\n$]+?(?<!\\)\$)|(^[ \t]*#{1,6}[ \t]+[^\n]*)|(\*\*[^*\n]+\*\*|(?<!\*)\*[^*\n]+\*(?!\*))/gm,
    (match, codeSpan, mathSpan, headingLine, emphasisSpan) => {
      if (codeSpan) {
        return `<span class="tok-code">${codeSpan}</span>`;
      }
      if (mathSpan) {
        return `<span class="tok-math">${mathSpan}</span>`;
      }
      if (headingLine) {
        return `<span class="tok-heading">${headingLine}</span>`;
      }
      if (emphasisSpan) {
        return `<span class="tok-emphasis">${emphasisSpan}</span>`;
      }
      return match;
    }
  ) + '\n';
}

/**
 * Computes how many visual lines a single logical line occupies under word-boundary
 * soft-wrapping (`white-space: pre-wrap; overflow-wrap: break-word`) for a given column width `maxCols`.
 */
export function estimateVisualWrappedRows(line: string, maxCols: number): number {
  if (maxCols <= 0 || line.length === 0) return 1;
  // Expand tabs (tab-size: 2) for accurate visual column count
  const expandedLen = line.includes('\t') ? line.replace(/\t/g, '  ').length : line.length;
  if (expandedLen <= maxCols) return 1;

  let rows = 1;
  let col = 0;
  const words = line.replace(/\t/g, '  ').split(/( +)/);

  for (let i = 0; i < words.length; i++) {
    const seg = words[i];
    if (seg.length === 0) continue;

    if (col + seg.length <= maxCols) {
      col += seg.length;
    } else if (seg.trim().length === 0) {
      // Trailing spaces that wrap onto next line
      rows++;
      col = 0;
    } else if (seg.length > maxCols) {
      // Word longer than full line width (`overflow-wrap: break-word`)
      if (col > 0) {
        rows++;
        col = 0;
      }
      const fullChunks = Math.floor(seg.length / maxCols);
      rows += fullChunks;
      col = seg.length % maxCols;
      if (col === 0 && fullChunks > 0) {
        rows--;
        col = maxCols;
      }
    } else {
      // Standard word-boundary wrap onto next visual row
      rows++;
      col = seg.length;
    }
  }

  return Math.max(1, rows);
}

/**
 * Builds per-line measurement blocks for `#editor-measurer` so the browser's native
 * text layout engine computes the exact visual wrapped row count for every logical line.
 */
export function buildLineMeasurerHtml(raw: string): string {
  const lines = raw.split('\n');
  const out = new Array<string>(lines.length);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    out[i] = `<div class="litemd-measure-row" dir="auto">${line.length > 0 ? escapeHtml(line) : '\u200b'}</div>`;
  }
  return out.join('');
}

/**
 * Generates the gutter HTML containing logical line numbers (`1`, `2`, ...) and
 * subtle visual soft-wrap continuation markers (`↪`) for wrapped display rows.
 */
export function buildSoftWrapGutterHtml(
  raw: string,
  softWrapEnabled: boolean,
  effectiveCols: number,
  measuredRowsPerLine?: number[]
): { html: string; logicalLines: number; visualWrappedExtraRows: number } {
  const lines = raw.split('\n');
  const logicalLines = lines.length;
  let visualWrappedExtraRows = 0;
  const parts: string[] = new Array(logicalLines);

  for (let i = 0; i < logicalLines; i++) {
    const lineNum = i + 1;
    let rows = 1;
    if (softWrapEnabled) {
      if (measuredRowsPerLine && measuredRowsPerLine[i] !== undefined && measuredRowsPerLine[i] > 0) {
        rows = measuredRowsPerLine[i];
      } else {
        rows = estimateVisualWrappedRows(lines[i], effectiveCols);
      }
    }

    if (rows <= 1) {
      parts[i] = `<div class="litemd-gutter-row">${lineNum}</div>`;
    } else {
      visualWrappedExtraRows += rows - 1;
      let chunk = `<div class="litemd-gutter-row">${lineNum}</div>`;
      for (let r = 1; r < rows; r++) {
        chunk += `<div class="litemd-gutter-row litemd-gutter-wrap-cue" title="Soft-wrapped visual continuation of line ${lineNum} (zero \\n in raw buffer)">↪</div>`;
      }
      parts[i] = chunk;
    }
  }

  return {
    html: parts.join(''),
    logicalLines,
    visualWrappedExtraRows,
  };
}

export interface SlashExpansion {
  replacement: string;
  cursorOffset: number;
}

const SLASH_SNIPPETS: Record<string, SlashExpansion> = {
  '/math': {
    replacement: '$$\n\\int_{-\\infty}^{\\infty} f(x) \\, dx\n$$',
    cursorOffset: 3,
  },
  '/matrix': {
    replacement:
      '$$\n\\begin{bmatrix}\na_{11} & a_{12} \\\\\na_{21} & a_{22}\n\\end{bmatrix}\n$$',
    cursorOffset: 19,
  },
  '/align': {
    replacement:
      '\\begin{align*}\nf(x) &= x^2 + 2x + 1 \\\\\n&= (x + 1)^2\n\\end{align*}',
    cursorOffset: 15,
  },
  '/table': {
    replacement:
      '| Column 1 | Formula | Bound |\n| :--- | :---: | ---: |\n| Item $x_1$ | $|x| + |y|$ | $\\le \\epsilon$ |',
    cursorOffset: 2,
  },
  '/code': {
    replacement: '```rust\n\n```',
    cursorOffset: 8,
  },
};

/**
 * Replaces a character range `[start, end)` inside a `<textarea>` while preserving
 * the browser's native `Ctrl+Z` / `Ctrl+Y` undo history stack.
 */
export function replaceTextareaRangeUndoable(
  textarea: HTMLTextAreaElement,
  start: number,
  end: number,
  replacement: string,
  newCursorStart?: number,
  newCursorEnd?: number
): void {
  const hadFocus = document.activeElement === textarea;
  if (!hadFocus) {
    textarea.focus({ preventScroll: true });
  }
  textarea.setSelectionRange(start, end);
  let insertedViaExec = false;
  try {
    if (typeof document.execCommand === 'function') {
      insertedViaExec = document.execCommand('insertText', false, replacement);
    }
  } catch {
    insertedViaExec = false;
  }
  if (!insertedViaExec) {
    textarea.setRangeText(replacement, start, end, 'end');
  }
  const finalStart = newCursorStart ?? start + replacement.length;
  const finalEnd = newCursorEnd ?? finalStart;
  textarea.setSelectionRange(finalStart, finalEnd);
}

/**
 * Checks if the token immediately preceding the cursor in `textarea` is a slash command
 * (`/math`, `/matrix`, `/align`, `/table`, `/code`) and expands it in-place when triggered,
 * preserving native `Ctrl+Z` undo history.
 */
export function tryExpandSlashCommand(
  textarea: HTMLTextAreaElement
): boolean {
  const pos = textarea.selectionStart;
  if (pos !== textarea.selectionEnd) return false;

  const val = textarea.value;
  const lineStart = val.lastIndexOf('\n', pos - 1) + 1;
  const linePrefix = val.slice(lineStart, pos);
  const match = linePrefix.match(/(?:^|\s)(\/(?:math|matrix|align|table|code))$/);
  if (!match) return false;

  const cmd = match[1];
  const snippet = SLASH_SNIPPETS[cmd];
  if (!snippet) return false;

  const cmdStart = pos - cmd.length;
  const nextCursor = cmdStart + snippet.cursorOffset;
  replaceTextareaRangeUndoable(
    textarea,
    cmdStart,
    pos,
    snippet.replacement,
    nextCursor,
    nextCursor
  );
  return true;
}
