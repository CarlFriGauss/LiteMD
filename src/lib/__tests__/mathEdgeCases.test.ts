import { describe, it, expect } from 'vitest';
import { normalizeMathAndCode } from '../mathNormalizer';
import { renderMarkdown, splitIntoLogicalBlocks } from '../renderer';
import {
  buildSoftWrapGutterHtml,
  estimateVisualWrappedRows,
  highlightRawMarkdownForBackdrop,
} from '../editorHelpers';
import { THEME_PRESETS, cloneTheme } from '../themeStudio';

describe('LiteMD Mandatory Math Edge-Case Test Suite (AGENT.md Phase 4 & spec.md Section 4)', () => {
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

  it('Test 6 (Code Protection, Standalone Environments & Fault-Tolerant Recovery): protects $ inside code and highlights incomplete math in amber', () => {
    const doc = [
      'Inline code `$not_math$` and fenced code:',
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
    expect(html).toContain('echo $COST_1 * $COST_2');
    expect(html).toContain('COST=$<span class="hl-number">100</span>');
    expect(html).toContain('class="katex-display"');
    expect(html).toContain('litemd-math-incomplete');
  });

  it('Test 7 (Intelligent Visual Soft-Wrapping & Studio Presets): computes ↪ gutter cues without mutating raw buffer newlines', () => {
    const longSingleParagraph =
      'This is a long continuous mathematical paragraph containing $x_1 + x_2 = y$ that exceeds a 40-character column threshold without any hard newline characters.';
    expect(longSingleParagraph.includes('\n')).toBe(false);

    const wrappedRows = estimateVisualWrappedRows(longSingleParagraph, 40);
    expect(wrappedRows).toBeGreaterThan(3);

    const gutter = buildSoftWrapGutterHtml(longSingleParagraph, true, 40);
    // Still 1 logical line in the raw buffer, with visual continuation cues (↪) in the gutter
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

    // Verify footnotes containing inline code (`.woff2`) and inline math (`$x_1$`) restore cleanly
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
