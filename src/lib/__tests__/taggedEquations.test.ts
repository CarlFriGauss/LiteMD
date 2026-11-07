import { describe, expect, it } from 'vitest';
import katex from 'katex';
import { normalizeMathAndCode } from '../mathNormalizer';
import { renderMarkdown, splitIntoLogicalBlocks } from '../renderer';

const taggedBoxedAligned = String.raw`\[
\boxed{
\begin{aligned}
&\prod_{k=1}^{M}
\left(1-\frac{x^2}{k^2\pi^2}\right)\\[4pt]
&=
\underbrace{
\left[
\prod_{k=1}^{L}
\left(1-\frac{x^2}{k^2\pi^2}\right)
\right]
}_{\text{First }L\text{ factors}}\\[6pt]
&\quad\times
\underbrace{
\left[
\prod_{k=L+1}^{M}
\left(1-\frac{x^2}{k^2\pi^2}\right)
\right]
}_{\text{Remaining }M-L\text{ factors}}.
\end{aligned}
}
\tag{11.4.3}
\]`;

function expectCompleteTaggedEquation(source: string): void {
  const payload = source.slice(2, -2).trim();
  // Validate the source independently of LiteMD's extraction, including the equation tag.
  expect(katex.renderToString(payload, {
    displayMode: true, throwOnError: true, trust: false, strict: false,
  })).toContain('class="tag"');

  const normalized = normalizeMathAndCode(source);
  expect(normalized.mathTokens).toHaveLength(1);
  expect(normalized.mathTokens[0]).toMatchObject({
    latex: payload, rawSource: source, displayMode: true, incomplete: false,
  });
  expect(normalized.normalizedMarkdown).toBe(normalized.mathTokens[0].placeholder);
  expect(splitIntoLogicalBlocks(source)).toHaveLength(1);

  const html = renderMarkdown(source);
  expect(html).toContain('class="tag"');
  expect(html).toContain('class="boxpad"');
  // KaTeX intentionally retains the LaTeX in a hidden accessibility annotation.
  const visibleHtml = html.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, '');
  expect(visibleHtml).not.toContain(String.raw`\tag{11.4.3}`);
  expect(visibleHtml).not.toContain(String.raw`\boxed`);
  expect(html).not.toContain('katex-error');
  expect(html).not.toContain('litemd-math-incomplete');
}

describe('Tagged boxed equations and escaped math delimiters', () => {
  it('renders the complete reported boxed/aligned equation with its tag and row spacing', () => {
    expectCompleteTaggedEquation(taggedBoxedAligned);
  });

  it.each(['0pt', '4pt', '-2pt', '1.5ex'])('preserves aligned row spacing [%s]', spacing => {
    expectCompleteTaggedEquation(taggedBoxedAligned.replace('[4pt]', `[${spacing}]`).replace('[6pt]', `[${spacing}]`));
  });

  it('keeps blank lines inside the outer display equation', () => {
    expectCompleteTaggedEquation(taggedBoxedAligned.replace('&=', '\n&='));
  });

  it('recovers from an earlier unfinished opener without swallowing a later complete equation', () => {
    const prefix = String.raw`An unfinished \[ bracket in prose.` + '\n\n';
    const normalized = normalizeMathAndCode(prefix + taggedBoxedAligned);
    expect(normalized.mathTokens).toHaveLength(1);
    expect(normalized.mathTokens[0].rawSource).toBe(taggedBoxedAligned);
    expect(normalized.normalizedMarkdown).toBe(prefix + normalized.mathTokens[0].placeholder);
  });

  it('does not mistake an escaped closing bracket for the end of display math', () => {
    const source = String.raw`\[\begin{aligned}a&=b\\] &= c\end{aligned}\tag{11.4.3}\]`;
    const normalized = normalizeMathAndCode(source);
    expect(normalized.mathTokens).toHaveLength(1);
    expect(normalized.mathTokens[0].rawSource).toBe(source);
    expect(normalized.mathTokens[0].latex).toContain(String.raw`\\]`);
    expect(renderMarkdown(source)).toContain('class="tag"');
  });

  it('extracts a parenthesized aligned expression before its inner standalone environment', () => {
    const source = String.raw`\(\begin{aligned}a&=b\\[4pt]c&=d\end{aligned}\)`;
    const normalized = normalizeMathAndCode(source);
    expect(normalized.mathTokens).toHaveLength(1);
    expect(normalized.mathTokens[0]).toMatchObject({ rawSource: source, displayMode: false });
    const html = renderMarkdown(source);
    expect(html).toContain('class="litemd-math-inline"');
    expect(html).not.toContain('litemd-math-block');
    expect(html).not.toContain('katex-error');
    expect(html).not.toContain('LITEMDMATH');
  });

  it.each([0, 1, 2, 3, 4, 5, 6])('recognizes an opener after %i backslashes using escape parity', count => {
    const source = '\\'.repeat(count) + String.raw`[x+1\]`;
    const normalized = normalizeMathAndCode(source);
    expect(normalized.mathTokens).toHaveLength(count % 2);
    if (count % 2) expect(normalized.mathTokens[0].latex).toBe('x+1');
  });
});
