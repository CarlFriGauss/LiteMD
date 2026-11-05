/**
 * LiteMD — Raw Editor Backdrop Highlighter, Visual Soft-Wrap Gutter & Slash Command Engine
 *
 * Strictly obeys:
 * - spec.md Section 6: Intelligent Visual Soft-Wrapping (Zero Raw File Mutation) + Visual Continuation Cue (`↪`)
 * - spec.md Section 7.B: Subtle syntax-highlighting token colors for `#` headings, `*emphasis*`, and `$math$` regions
 * - spec.md Section 3: Quick slash commands (`/math`, `/matrix`, `/align`, `/table`, `/code`) with zero autocomplete popups
 */

import { escapeHtml } from './renderer';

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
 * Generates the gutter HTML containing logical line numbers (`1`, `2`, ...) and
 * subtle visual soft-wrap continuation markers (`↪`) for wrapped display rows.
 */
export function buildSoftWrapGutterHtml(
  raw: string,
  softWrapEnabled: boolean,
  effectiveCols: number
): { html: string; logicalLines: number; visualWrappedExtraRows: number } {
  const lines = raw.split('\n');
  const logicalLines = lines.length;
  let visualWrappedExtraRows = 0;
  const parts: string[] = new Array(logicalLines);

  for (let i = 0; i < logicalLines; i++) {
    const lineNum = i + 1;
    const rows = softWrapEnabled
      ? estimateVisualWrappedRows(lines[i], effectiveCols)
      : 1;

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
 * Checks if the token immediately preceding the cursor in `textarea` is a slash command
 * (`/math`, `/matrix`, `/align`, `/table`, `/code`) and expands it in-place when triggered.
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
  textarea.value =
    val.slice(0, cmdStart) + snippet.replacement + val.slice(pos);
  const nextCursor = cmdStart + snippet.cursorOffset;
  textarea.setSelectionRange(nextCursor, nextCursor);
  return true;
}
