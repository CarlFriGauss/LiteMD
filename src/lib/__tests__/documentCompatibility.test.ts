import { describe, expect, it } from 'vitest';
import { normalizeMathAndCode } from '../mathNormalizer';
import { renderMarkdown, splitIntoLogicalBlocks } from '../renderer';
import { attributeText, imageSource } from '../presentation';

describe('presentation compatibility without widening access', () => {
  it('recognizes relative filenames and blocks native, executable, and application URL schemes', () => {
    for (const path of ['./plot.svg', 'figures/plot with spaces.svg', 'figures/גרף.png']) expect(imageSource(path)).toBe('local');
    expect(imageSource('https://example.com/image.png')).toBe('remote');
    for (const path of ['file:///D:/secret.png','javascript:alert(1)','data:image/svg+xml,x','//server/share.png','http://litemd-image.localhost/key','http://ipc.localhost/x']) expect(imageSource(path)).toBe('blocked');
  });
  it('keeps generated math HTML out of alt/title attributes', () => {
    expect(attributeText('LITEMDMATHINLINE0END')).not.toContain('LITEMDMATHINLINE0END');
    const html = renderMarkdown('![An equation $x^2$](./plot.svg)');
    expect(html).toContain('alt="An equation $x^2$"');
    expect(html).not.toContain('alt="An equation <span');
  });
  it('accepts image filenames containing unbracketed spaces without changing normal links', () => {
    expect(renderMarkdown('![Plot](./figures/plot with spaces.svg)')).toContain('data-litemd-image="./figures/plot%20with%20spaces.svg"');
    expect(renderMarkdown('[ordinary link](https://example.com "Title")')).toContain('title="Title"');
    expect(renderMarkdown('![Plot](plot.svg "Title")')).toContain('title="Title"');
  });
  it('retains local-image bindings inside footnotes', () => {
    const metadata = { features:0, images:[] as string[] };
    renderMarkdown('Reference[^plot].\n\n[^plot]: ![Plot](./plot.svg)', metadata);
    expect(metadata.images).toContain('./plot.svg');
    expect(metadata.features & 1).toBe(1);
  });
  it('keeps footnote expansions out of image attributes', () => {
    const html = renderMarkdown('![See [^x]](plot.svg)\n\n[^x]: Note.');
    expect(html).toContain('alt="See &#91;^x]"');
    expect(html).not.toContain('alt="See <sup');
  });
  it('restores inline code in image alt text as escaped literal text', () => {
    const html = renderMarkdown('![Use `foo("x")`](https://example.com/plot.png)');
    expect(html).toContain('alt="Use foo(&quot;x&quot;)"');
    expect(html).not.toContain('LITEMDCODE');
  });
  it('preserves ordinary Markdown task-list controls', () => {
    expect(renderMarkdown('- [ ] Task')).toContain('class="litemd-task-checkbox"');
  });
  it('retains balanced HTML/style blocks including blank lines without combining unrelated blocks', () => {
    const source = '<style>\n.banner { color:red; }\n\n.banner h1 { font-size:28px; }\n</style>\n\n<div class="banner">\n<h1>Title</h1>\n\n<small>Caption</small>\n</div>\n\nOrdinary paragraph.';
    const blocks = splitIntoLogicalBlocks(source);
    expect(blocks).toHaveLength(3);
    expect(blocks[0].raw).toContain('</style>');
    expect(blocks[1].raw).toContain('</div>');
    expect(blocks[2].raw).toBe('Ordinary paragraph.');
    expect(blocks[2].startLine).toBe(12);
  });
});
describe('quoted display mathematics', () => {
  it.each([
    '> START\n>\n> \\[\nf\'\'(x)=\\lim_{u\\to0}\\frac{f\'(x+u)-f\'(x)}{u}\n\\]\n>\n> END',
    '> START\n>\n> \\[\n> x > y\n> \\]\n>\n> END',
    '> $$\n> x > y\n> $$',
    '> \\begin{aligned}\n> x&=1\\\\[4pt]\n> y&=2\n> \\end{aligned}',
    '> > \\[\n> > x > y\n> > \\]',
  ])('preserves quote structure and strips only quote markers from math payloads', source => {
    const result = normalizeMathAndCode(source);
    expect(result.mathTokens.length).toBe(1);
    expect(result.mathTokens[0].latex).not.toMatch(/\n\s*>/);
    expect(renderMarkdown(source)).not.toContain('katex-error');
    expect(renderMarkdown(source)).toContain('<blockquote');
  });
  it('retains a genuine greater-than relation in unquoted math', () => {
    expect(normalizeMathAndCode('\\[x > y\\]').mathTokens[0].latex).toBe('x > y');
  });
});
