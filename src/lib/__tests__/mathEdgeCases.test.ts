import { describe, it, expect } from 'vitest';
import { normalizeMathAndCode } from '../mathNormalizer';
import {
  renderMarkdown,
  splitIntoLogicalBlocks,
  getBlockCacheStats,
  resetBlockCacheStats,
} from '../renderer';
import {
  buildSoftWrapGutterHtml,
  estimateVisualWrappedRows,
  replaceBlockSource,
  highlightRawMarkdownForBackdrop,
} from '../editorHelpers';
import { THEME_PRESETS, cloneTheme } from '../themeStudio';

describe('LiteMD Mandatory Math Edge-Case & Security Test Suite', () => {
  it('preserves blank lines, trailing newlines, and CRLF outside an edited inline block', () => {
    expect(replaceBlockSource('first\n\n\nsecond\n\nlast\n', 3, 4, 'changed\nline'))
      .toBe('first\n\n\nchanged\nline\n\nlast\n');
    expect(replaceBlockSource('first\r\n\r\nsecond\r\n', 2, 3, 'changed\nline'))
      .toBe('first\r\n\r\nchanged\r\nline\r\n');
    expect(replaceBlockSource('last', 0, 1, 'changed')).toBe('changed');
  });
  it('escapes HTML inside an unfinished fenced code block', () => {
    const html = renderMarkdown('```html\n<img src=x onerror="alert(1)">\n<script>alert(1)</script>');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img');
  });

  it('preserves source line numbers after an empty fenced block', () => {
    const html = renderMarkdown('```rust\n```\n\nFollowing paragraph');
    expect(html).toContain('data-line="3"');
    expect(html).not.toContain('LITEMDCODEBLOCK');
  });
  it('Test 1 (Subscripts & Asterisks in Inline Math): does not corrupt _ or * into Markdown italics/emphasis', () => {
    const input = 'Let $x_1, x_2, \\dots, x_n$ and $A^* A = I$.';
    const norm = normalizeMathAndCode(input);

    // Placeholders must be strictly alphanumeric (zero underscores or asterisks)
    expect(norm.mathTokens).toHaveLength(2);
    for (const token of norm.mathTokens) {
      expect(token.placeholder).toMatch(/^[A-Z0-9]+$/);
      expect(token.placeholder).not.toContain('_');
      expect(token.placeholder).not.toContain('*');
    }

    const html = renderMarkdown(input);
    // Must contain rendered KaTeX output and ZERO <em> or <i> tags caused by _1, x_ or *
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('<em>1, x</em>');
    expect(html).not.toContain('<em>');
    expect(html).not.toContain('katex-error');
  });

  it('Test 2 (LaTeX Bracket Delimiters): renders both \\( ... \\) inline and \\[ ... \\] display math cleanly', () => {
    const inlineInput = 'Evaluate \\( \\lim_{x \\to \\infty} f(x) \\) as the limit converges.';
    const displayInput = '\\[ \\int_{-\\infty}^{\\infty} e^{-x^2} dx = \\sqrt{\\pi} \\]';

    const inlineHtml = renderMarkdown(inlineInput);
    const displayHtml = renderMarkdown(displayInput);

    expect(inlineHtml).toContain('class="litemd-math-inline"');
    expect(inlineHtml).toContain('class="katex"');
    expect(inlineHtml).not.toContain('katex-error');

    expect(displayHtml).toContain('class="litemd-math-block"');
    expect(displayHtml).toContain('class="katex-display"');
    expect(displayHtml).not.toContain('katex-error');
  });

  it('Test 3 (Whitespace-Padded Dollars): renders "$ \\alpha + \\beta = \\gamma $" identically to "$\\alpha + \\beta = \\gamma$"', () => {
    const padded = '$ \\alpha + \\beta = \\gamma $';
    const tight = '$\\alpha + \\beta = \\gamma$';

    const normPadded = normalizeMathAndCode(padded);
    const normTight = normalizeMathAndCode(tight);
    expect(normPadded.mathTokens[0].latex).toBe(normTight.mathTokens[0].latex);

    const htmlPadded = renderMarkdown(padded);
    const htmlTight = renderMarkdown(tight);
    expect(htmlPadded).toBe(htmlTight);
    expect(htmlPadded).toContain('class="katex"');
    expect(htmlPadded).not.toContain('katex-error');
  });

  it('Test 4 (Multi-Line Matrices & Blank Lines in Display Math): preserves \\\\ row breaks and blank lines inside $$ blocks', () => {
    const matrixInput = [
      '$$',
      '\\begin{bmatrix}',
      'a_{11} & a_{12} \\\\',
      '',
      'a_{21} & a_{22}',
      '\\end{bmatrix}',
      '$$',
    ].join('\n');

    // Logical block splitter must keep the entire multi-line $$ block together despite the inner blank line
    const blocks = splitIntoLogicalBlocks(matrixInput);
    expect(blocks).toHaveLength(1);

    const html = renderMarkdown(matrixInput);
    expect(html).toContain('class="litemd-math-block"');
    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain('katex-error');
    // Both rows of the matrix must be present in the rendered output
    expect(html).toContain('11');
    expect(html).toContain('12');
    expect(html).toContain('21');
    expect(html).toContain('22');
  });

  it('Test 5 (Math with Absolute Value Bars Inside Markdown Tables): renders $|x| + |y|$ inside GFM table cells without breaking table columns', () => {
    const tableMd = [
      '| Norm Name | Formula | Domain |',
      '| :--- | :---: | ---: |',
      '| Manhattan $L_1$ | $|x| + |y|$ | $\\mathbb{R}^2$ |',
      '| Triangle Inequality | $|x - y| \\le \\epsilon$ | Metric Space |',
    ].join('\n');

    const html = renderMarkdown(tableMd);
    expect(html).toContain('<table');
    expect(html).toContain('<thead>');
    expect(html).toContain('<tbody>');

    // Each body row must have exactly 3 <td> cells (not broken into 5+ cells by |x| or |y|)
    const tdMatches = html.match(/<td[\s>]/g) || [];
    expect(tdMatches).toHaveLength(6);
    expect(html).toContain('class="katex"');
    expect(html).not.toContain('katex-error');
  });

  it('Test 6 (Code Protection, Single-Line Fenced Blocks, Apostrophes & Lifetimes): renders 0-line, 1-line, and multi-line code blocks without placeholder leaks or &#39; comment corruption', () => {
    const doc = [
      'Inline code `$not_math$` and fenced code:',
      '',
      '```rust',
      "fn borrow<'a>(s: &'a str) -> &'a str { s } // don't break on apostrophes",
      '```',
      '',
      '```python',
      '```',
      '',
      '```bash',
      'export COST=$100',
      'echo $COST_1 * $COST_2',
      '```',
      '',
      '\\begin{align*}',
      'f(x) &= x^2 + 2x + 1 \\\\',
      '&= (x + 1)^2',
      '\\end{align*}',
      '',
      'Incomplete math while typing: $\\frac{a}$',
    ].join('\n');

    const html = renderMarkdown(doc);
    expect(html).toContain('<code>$not_math$</code>');
    // Must NEVER leak LITEMDCODEBLOCK0END on single-line or empty code blocks
    expect(html).not.toContain('LITEMDCODEBLOCK');
    expect(html).not.toContain('LITEMDCODEINLINE');
    // Rust lifetime 'a and contraction don't must NOT be eaten by the # comment highlighter
    expect(html).toContain("borrow&lt;&#39;a&gt;");
    expect(html).not.toContain('&amp;#39;');
    expect(html).not.toContain('<span class="hl-comment">#39;');
    expect(html).toContain('<span class="hl-comment">// don&#39;t break on apostrophes</span>');
    expect(html).toContain('echo $COST_1 * $COST_2');
    expect(html).toContain('COST=$<span class="hl-number">100</span>');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('litemd-math-incomplete');
  });

  it('Test 7 (Block Splitter Resilience): inline code `$$` or `\\[` and escaped \\[not math] do not merge the rest of the document into 1 block', () => {
    const paragraphs: string[] = [
      'Paragraph 1 mentions inline `$$` and `\\[` and a Markdown escaped bracket \\[not math] and lone \\[.',
    ];
    for (let i = 2; i <= 51; i++) {
      paragraphs.push(`Paragraph ${i} with $x_${i} = ${i}$.`);
    }
    const doc = paragraphs.join('\n\n');

    const blocks = splitIntoLogicalBlocks(doc);
    expect(blocks).toHaveLength(51);

    const html = renderMarkdown(doc);
    expect(html).toContain('<code>$$</code>');
    expect(html).toContain('<code>\\[</code>');
    expect(html).toContain('[not math]');
  });

  it('Test 8 (Security Hardening): neutralizes raw HTML <img onerror>, <script>, javascript: links, and KaTeX \\href{javascript:...}', () => {
    const maliciousMd = [
      '<img src=x onerror="window.__pwned=1">',
      '<script>alert("xss")</script>',
      '[Click me](javascript:alert(1))',
      '$\\href{javascript:alert(1)}{\\text{malicious math link}}$',
    ].join('\n\n');

    const html = renderMarkdown(maliciousMd);
    // Raw HTML tags must be escaped, never emitted as live DOM elements
    expect(html).not.toContain('<img');
    expect(html).not.toContain('<script');
    expect(html).toContain('&lt;img src=x onerror=');
    expect(html).toContain('&lt;script&gt;');
    // javascript: URLs must be rejected by both markdown-it and KaTeX (trust: false)
    expect(html).not.toContain('href="javascript:');
  });

  it('Test 9 (Line-Number-Independent Block Cache & BiDi dir Attributes): hits cache for all unchanged blocks when inserting lines at top of document', () => {
    const blocksList: string[] = [];
    for (let i = 0; i < 40; i++) {
      blocksList.push(`Paragraph ${i}: $\\int_0^1 x^{${i}} dx = \\frac{1}{${i + 1}}$`);
    }
    const initialDoc = blocksList.join('\n\n');
    renderMarkdown(initialDoc);

    resetBlockCacheStats();
    // Insert a new paragraph at the very top (shifting every subsequent block's startLine by +2)
    const shiftedDoc = `New top paragraph!\n\n${initialDoc}`;
    const shiftedHtml = renderMarkdown(shiftedDoc);
    const stats = getBlockCacheStats();

    // All 40 existing blocks must be cache hits and only the 1 new block is a miss
    expect(stats.hits).toBe(40);
    expect(stats.misses).toBe(1);
    // Shifted blocks must have updated data-line attributes and dir="auto" / dir="ltr"
    expect(shiftedHtml).toContain('data-line="2"');
    expect(shiftedHtml).toContain('dir="auto"');
    expect(shiftedHtml).toContain('dir="ltr"');
  });

  it('Test 10 (Intelligent Visual Soft-Wrapping & Studio Presets): computes ↪ gutter cues without mutating raw buffer newlines', () => {
    const longSingleParagraph =
      'This is a long continuous mathematical paragraph containing $x_1 + x_2 = y$ that exceeds a 40-character column threshold without any hard newline characters.';
    expect(longSingleParagraph.includes('\n')).toBe(false);

    const wrappedRows = estimateVisualWrappedRows(longSingleParagraph, 40);
    expect(wrappedRows).toBeGreaterThan(3);

    const gutter = buildSoftWrapGutterHtml(longSingleParagraph, true, 40);
    expect(gutter.logicalLines).toBe(1);
    expect(gutter.visualWrappedExtraRows).toBe(wrappedRows - 1);
    expect(gutter.html).toContain('↪');
    expect(longSingleParagraph.includes('\n')).toBe(false);

    const backdrop = highlightRawMarkdownForBackdrop('# Heading\nMath $x_1$ and **bold**');
    expect(backdrop).toContain('tok-heading');
    expect(backdrop).toContain('tok-math');
    expect(backdrop).toContain('tok-emphasis');

    expect(Object.keys(THEME_PRESETS)).toEqual([
      'latex-academic',
      'warm-sepia',
      'dark-oled',
      'high-contrast-blueprint',
    ]);
    const cloned = cloneTheme(THEME_PRESETS['latex-academic']);
    expect(cloned.name).toBe('LaTeX Academic Paper');

    const fnDoc = [
      'Standalone math environments render automatically[^1].',
      '',
      '[^1]: All KaTeX scripts, stylesheets, and `.woff2` fonts ($x_1$) are bundled 100% locally.',
    ].join('\n');
    const fnHtml = renderMarkdown(fnDoc);
    expect(fnHtml).toContain('<code>.woff2</code>');
    expect(fnHtml).not.toContain('LITEMDCODEINLINE');
    expect(fnHtml).not.toContain('LITEMDMATHINLINE');
  });
});
