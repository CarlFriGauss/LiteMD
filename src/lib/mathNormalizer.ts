/**
 * LiteMD — Stage 1 & Stage 2 Math-First Pre-Parser & Token Normalizer
 *
 * Strictly adheres to AGENT.md Phase 2 & spec.md Section 4:
 * - Step 1: Protect fenced code blocks and inline code spans before math extraction.
 * - Step 2: Extract and normalize all display & inline math variants into pure
 *   alphanumeric placeholders (`LITEMDMATHBLOCK0END`, `LITEMDMATHINLINE1END`)
 *   containing ZERO underscores (`_`), asterisks (`*`), backslashes (`\`), or pipes (`|`).
 */

export interface ExtractedMathToken {
  id: number;
  placeholder: string;
  latex: string;
  rawSource: string;
  displayMode: boolean;
  incomplete?: boolean;
}

export interface ExtractedCodeToken {
  id: number;
  placeholder: string;
  code: string;
  lang: string;
  isBlock: boolean;
}

export interface NormalizationResult {
  /** Markdown text with code contents and all math expressions replaced by alphanumeric tokens */
  normalizedMarkdown: string;
  /** Extracted math tokens in order of extraction */
  mathTokens: ExtractedMathToken[];
  /** Extracted code tokens in order of extraction */
  codeTokens: ExtractedCodeToken[];
}

const RAW_ENV_REGEX =
  /\\begin\{(equation\*?|align\*?|aligned|gather\*?|gathered|bmatrix|pmatrix|vmatrix|Bmatrix|Vmatrix|matrix|cases|split|multline\*?)\}([\s\S]*?)\\end\{\1\}/g;

const DISPLAY_BRACKET_REGEX = /\\\[([\s\S]*?)\\\]/g;

const INLINE_PAREN_REGEX = /\\\(([\s\S]*?)\\\)/g;

/**
 * Counts newline characters in a string without allocating an array.
 */
export function countNewlines(str: string, start = 0, end = str.length): number {
  let count = 0;
  for (let i = start; i < end; i++) {
    if (str.charCodeAt(i) === 10) count++;
  }
  return count;
}

/**
 * Step 1: Protect fenced code blocks (``` or ~~~) and inline code spans (`...`)
 * so that `$`, `\`, `_`, `*`, and `|` inside code examples are completely ignored
 * by the math extractor and GFM pipe table parser, while preserving line counts
 * for accurate `data-line` scroll synchronization.
 */
export function protectCodeBlocks(
  input: string,
  codeTokens: ExtractedCodeToken[]
): string {
  // 1A. Protect fenced code blocks: ```lang ... ``` or ~~~lang ... ~~~
  let out = input.replace(
    /(^|\n)([ \t]*)(`{3,}|~{3,})([^\n]*)\n([\s\S]*?)(\n[ \t]*\3[ \t]*(?=\n|$))/g,
    (_full, prefix: string, indent: string, fence: string, info: string, body: string, closing: string) => {
      const id = codeTokens.length;
      const placeholder = `LITEMDCODEBLOCK${id}END`;
      codeTokens.push({
        id,
        placeholder,
        code: body,
        lang: info.trim(),
        isBlock: true,
      });
      // Preserve exact newline count inside the fenced block so markdown-it's
      // line mapping (token.map -> data-line) remains 100% exact for all following blocks.
      const nlCount = countNewlines(body);
      const newlinePad = nlCount > 0 ? '\n'.repeat(nlCount) : '';
      return `${prefix}${indent}${fence}${info}\n${placeholder}${newlinePad}${closing}`;
    }
  );

  // 1B. Protect inline code spans: `...` or ``...`` (not crossing blank lines)
  out = out.replace(/(`+)([^`\n]|(?!\1)`|\n(?!\n))+?\1/g, (fullMatch, ticks: string) => {
    const inner = fullMatch.slice(ticks.length, fullMatch.length - ticks.length);
    const id = codeTokens.length;
    const placeholder = `LITEMDCODEINLINE${id}END`;
    codeTokens.push({
      id,
      placeholder,
      code: inner,
      lang: '',
      isBlock: false,
    });
    return `${ticks}${placeholder}${ticks}`;
  });

  return out;
}

/**
 * Normalizes LaTeX environments that KaTeX expects in aligned/gathered form
 * or cleans excessive outer whitespace while keeping internal matrix/align line breaks intact.
 */
export function normalizeLatexPayload(rawLatex: string): { latex: string; incomplete: boolean } {
  const trimmed = rawLatex.trim();
  let incomplete = false;

  // Check for unbalanced curly braces (ignoring escaped \{ and \})
  let braceDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed.charCodeAt(i);
    if (ch === 92 /* '\\' */) {
      i++; // Skip escaped char
      continue;
    }
    if (ch === 123 /* '{' */) braceDepth++;
    else if (ch === 125 /* '}' */) braceDepth--;
  }
  if (braceDepth !== 0) {
    incomplete = true;
  }

  // Check for trailing bare `\frac` or `\sqrt` or unclosed `\begin{...}`
  if (/\\(frac|sqrt|binom|overset|underset|textcolor)\s*$/.test(trimmed)) {
    incomplete = true;
  }
  if (/\\frac\s*\{[^{}]*\}\s*$/.test(trimmed)) {
    incomplete = true;
  }
  const beginCount = (trimmed.match(/\\begin\{[^}]+\}/g) || []).length;
  const endCount = (trimmed.match(/\\end\{[^}]+\}/g) || []).length;
  if (beginCount !== endCount) {
    incomplete = true;
  }

  return { latex: trimmed, incomplete };
}

/**
 * Extracts multi-line and single-line `$$ ... $$` display math blocks.
 * Respects escaped `\$` and allows arbitrary blank lines inside `$$ ... $$`.
 */
function extractDoubleDollarDisplayMath(
  input: string,
  mathTokens: ExtractedMathToken[]
): string {
  const len = input.length;
  let result = '';
  let cursor = 0;

  while (cursor < len) {
    // Find next unescaped `$$`
    let openIdx = -1;
    for (let i = cursor; i < len - 1; i++) {
      if (input.charCodeAt(i) === 92 /* '\\' */) {
        i++; // skip escaped character
        continue;
      }
      if (input.charCodeAt(i) === 36 /* '$' */ && input.charCodeAt(i + 1) === 36 /* '$' */) {
        openIdx = i;
        break;
      }
    }

    if (openIdx === -1) {
      result += input.slice(cursor);
      break;
    }

    result += input.slice(cursor, openIdx);

    // Search for closing unescaped `$$`
    let closeIdx = -1;
    for (let j = openIdx + 2; j < len - 1; j++) {
      if (input.charCodeAt(j) === 92 /* '\\' */) {
        j++;
        continue;
      }
      if (input.charCodeAt(j) === 36 /* '$' */ && input.charCodeAt(j + 1) === 36 /* '$' */) {
        closeIdx = j;
        break;
      }
    }

    if (closeIdx === -1) {
      // Fault-tolerant recovery (Rule 5): unclosed `$$` block at end of text
      const rawSource = input.slice(openIdx);
      const innerRaw = input.slice(openIdx + 2);
      const id = mathTokens.length;
      const placeholder = `LITEMDMATHBLOCK${id}END`;
      mathTokens.push({
        id,
        placeholder,
        latex: innerRaw.trim(),
        rawSource,
        displayMode: true,
        incomplete: true,
      });
      result += placeholder;
      cursor = len;
      break;
    }

    const rawSource = input.slice(openIdx, closeIdx + 2);
    const innerRaw = input.slice(openIdx + 2, closeIdx);
    const { latex, incomplete } = normalizeLatexPayload(innerRaw);
    const id = mathTokens.length;
    const placeholder = `LITEMDMATHBLOCK${id}END`;
    mathTokens.push({
      id,
      placeholder,
      latex,
      rawSource,
      displayMode: true,
      incomplete,
    });

    result += placeholder;
    cursor = closeIdx + 2;
  }

  return result;
}

/**
 * Extracts single-dollar `$ ... $` inline math expressions.
 * - Allows optional leading/trailing spaces inside the dollars (`$ \alpha + \beta = \gamma $`).
 * - Supports `|` inside absolute values (`$|x - y| \le \epsilon$` and `$|x| + |y|$`) even inside GFM tables.
 * - Avoids false positives on currency like `$50 and $100`.
 */
function extractSingleDollarInlineMath(
  input: string,
  mathTokens: ExtractedMathToken[]
): string {
  const len = input.length;
  let result = '';
  let cursor = 0;

  while (cursor < len) {
    let openIdx = -1;
    for (let i = cursor; i < len; i++) {
      const ch = input.charCodeAt(i);
      if (ch === 92 /* '\\' */) {
        i++; // skip escaped character (`\$`)
        continue;
      }
      if (ch === 36 /* '$' */) {
        // Ensure it's not `$$`
        if (i + 1 < len && input.charCodeAt(i + 1) === 36) {
          i++;
          continue;
        }
        openIdx = i;
        break;
      }
    }

    if (openIdx === -1) {
      result += input.slice(cursor);
      break;
    }

    // Search for matching closing `$` on the same paragraph (no `\n\n` blank line break)
    let closeIdx = -1;
    for (let j = openIdx + 1; j < len; j++) {
      const ch = input.charCodeAt(j);
      if (ch === 92 /* '\\' */) {
        j++; // skip escaped char inside math (e.g. `\$`, `\\`, `\|`)
        continue;
      }
      // Do not allow inline `$ ... $` to cross a blank line (`\n\n`)
      if (ch === 10 /* '\n' */ && j + 1 < len && input.charCodeAt(j + 1) === 10) {
        break;
      }
      // Also do not allow inline `$ ... $` to cross lines if the line looks like a table row boundary
      if (ch === 10 /* '\n' */) {
        // Inline `$ ... $` should stay within a single logical line unless it's tightly wrapped prose
        break;
      }
      if (ch === 36 /* '$' */) {
        closeIdx = j;
        break;
      }
    }

    if (closeIdx === -1) {
      // No closing `$` on this line: treat this `$` as a literal dollar sign (e.g. "costs $50 today")
      result += input.slice(cursor, openIdx + 1);
      cursor = openIdx + 1;
      continue;
    }

    const innerRaw = input.slice(openIdx + 1, closeIdx);
    const trimmed = innerRaw.trim();

    // Empty `$ $` or `$$` is not valid inline math
    if (trimmed.length === 0) {
      result += input.slice(cursor, closeIdx + 1);
      cursor = closeIdx + 1;
      continue;
    }

    // Currency false-positive filter (`$50 and $100`):
    // If opening `$` is immediately followed by a digit (e.g. `$50`), AND the content
    // ends with spaces/words followed by a closing `$` that is immediately followed by a digit (`$100`),
    // then both `$` are currency symbols rather than math delimiters.
    const nextCharAfterClose = closeIdx + 1 < len ? input.charCodeAt(closeIdx + 1) : 0;
    const firstInnerChar = innerRaw.charCodeAt(0);
    const lastInnerChar = innerRaw.charCodeAt(innerRaw.length - 1);
    const startsWithDigit = firstInnerChar >= 48 && firstInnerChar <= 57;
    const endsWithSpace = lastInnerChar === 32 || lastInnerChar === 9;
    const followedByDigit = nextCharAfterClose >= 48 && nextCharAfterClose <= 57;

    if (
      startsWithDigit &&
      (followedByDigit || (endsWithSpace && !/[\\^_{}=<>+\-*/|]/.test(innerRaw)))
    ) {
      // Advance past the first currency `$` so the second `$100` is also evaluated as currency
      result += input.slice(cursor, openIdx + 1);
      cursor = openIdx + 1;
      continue;
    }

    result += input.slice(cursor, openIdx);

    const rawSource = input.slice(openIdx, closeIdx + 1);
    const { latex, incomplete } = normalizeLatexPayload(trimmed);
    const id = mathTokens.length;
    const placeholder = `LITEMDMATHINLINE${id}END`;
    mathTokens.push({
      id,
      placeholder,
      latex,
      rawSource,
      displayMode: false,
      incomplete,
    });

    result += placeholder;
    cursor = closeIdx + 1;
  }

  return result;
}

/**
 * Runs Step 1 (Code Protection) and Step 2 (Universal Math Extraction & Normalization).
 */
export function normalizeMathAndCode(markdown: string): NormalizationResult {
  const codeTokens: ExtractedCodeToken[] = [];
  const mathTokens: ExtractedMathToken[] = [];

  // Step 1: Protect fenced code blocks & inline code spans
  let text = protectCodeBlocks(markdown, codeTokens);

  // Step 2A: Display math `$$ ... $$` (single-line and multi-line, including blank lines)
  text = extractDoubleDollarDisplayMath(text, mathTokens);

  // Step 2B: Display math `\[ ... \]` (single-line and multi-line, including blank lines)
  text = text.replace(DISPLAY_BRACKET_REGEX, (rawSource, inner: string) => {
    const { latex, incomplete } = normalizeLatexPayload(inner);
    const id = mathTokens.length;
    const placeholder = `LITEMDMATHBLOCK${id}END`;
    mathTokens.push({
      id,
      placeholder,
      latex,
      rawSource,
      displayMode: true,
      incomplete,
    });
    return placeholder;
  });

  // Step 2C: Standalone LaTeX environments `\begin{env} ... \end{env}` not already wrapped in `$$` or `\[...\]`
  text = text.replace(RAW_ENV_REGEX, (rawSource) => {
    const { latex, incomplete } = normalizeLatexPayload(rawSource);
    const id = mathTokens.length;
    const placeholder = `LITEMDMATHBLOCK${id}END`;
    mathTokens.push({
      id,
      placeholder,
      latex,
      rawSource,
      displayMode: true,
      incomplete,
    });
    return placeholder;
  });

  // Step 2D: Inline math `\( ... \)`
  text = text.replace(INLINE_PAREN_REGEX, (rawSource, inner: string) => {
    const { latex, incomplete } = normalizeLatexPayload(inner);
    const id = mathTokens.length;
    const placeholder = `LITEMDMATHINLINE${id}END`;
    mathTokens.push({
      id,
      placeholder,
      latex,
      rawSource,
      displayMode: false,
      incomplete,
    });
    return placeholder;
  });

  // Step 2E: Inline math `$ ... $` (supports optional inner whitespace and `|` inside GFM table cells)
  text = extractSingleDollarInlineMath(text, mathTokens);

  return {
    normalizedMarkdown: text,
    mathTokens,
    codeTokens,
  };
}
