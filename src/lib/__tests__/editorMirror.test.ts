import { afterEach, describe, expect, it, vi } from 'vitest';
import { EditorMirror } from '../editorMirror';
import { highlightRawMarkdownForBackdrop } from '../editorHelpers';

// Only the DOM storage operations used by the mirror, without adding a browser dependency.
class ElementStub {
  children: ElementStub[] = [];
  parent: ElementStub | null = null;
  textContent = '';
  writes = 0;
  private html = '';
  get innerHTML(): string { return this.html; }
  set innerHTML(value: string) {
    this.html = value;
    this.writes++;
    this.children = [...value.matchAll(/<div\b[^>]*>(.*?)<\/div>/g)].map(match => {
      const child = new ElementStub();
      child.textContent = match[1];
      child.parent = this;
      return child;
    });
  }
  get childElementCount(): number { return this.children.length; }
  get firstElementChild(): ElementStub | null { return this.children[0] ?? null; }
  get lastElementChild(): ElementStub | null { return this.children.at(-1) ?? null; }
  appendChild(child: ElementStub): void { child.parent = this; this.children.push(child); }
  remove(): void { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); }
}

function fixture() {
  vi.stubGlobal('document', { createElement: () => new ElementStub() });
  const backdrop = new ElementStub();
  const gutter = new ElementStub();
  const mirror = new EditorMirror(backdrop as unknown as HTMLElement, gutter as unknown as HTMLElement);
  return { mirror, backdrop, gutter };
}

afterEach(() => vi.unstubAllGlobals());

describe('Incremental editor mirror', () => {
  it('preserves all raw characters and blank lines across code and math blocks', () => {
    const { mirror, backdrop } = fixture();
    const raw = '# Heading\n\n\nFirst $x_1$.\n\n```rust\nfn main() {}\n```\n\nLast.\n';
    const result = mirror.update(raw);
    expect(backdrop.children.map(el => el.innerHTML).join('')).toBe(highlightRawMarkdownForBackdrop(raw));
    expect(result.words).toBe(raw.trim().split(/\s+/).length);
    expect(mirror.cursor(raw.indexOf('First'))).toEqual({ line: 4, col: 1 });
  });

  it('updates one highlight span when editing one paragraph of a 1,500-paragraph document', () => {
    const { mirror, backdrop } = fixture();
    const paragraphs = Array.from({ length: 1500 }, (_, i) => `Paragraph ${i} with $x_${i}$.`);
    mirror.update(paragraphs.join('\n\n'));
    const previous = [...backdrop.children];
    const writes = previous.map(el => el.writes);
    paragraphs[750] = 'Edited paragraph with $y_1$.';
    mirror.update(paragraphs.join('\n\n'));
    expect(backdrop.children).toEqual(previous);
    expect(backdrop.children.filter((el, i) => el.writes !== writes[i])).toHaveLength(1);
  });

  it('keeps unchanged gutter DOM and only patches the line whose wrap count changes', () => {
    const { mirror, gutter } = fixture();
    mirror.update('first\nsecond\nthird');
    expect(mirror.updateGutter(true, 80, [1, 3, 1])).toBe(2);
    const previous = [...gutter.children];
    const writes = previous.map(el => el.writes);
    mirror.updateGutter(true, 80, [1, 3, 1]);
    expect(gutter.children.map(el => el.writes)).toEqual(writes);
    expect(mirror.updateGutter(true, 80, [1, 2, 1])).toBe(1);
    expect(gutter.children[0]).toBe(previous[0]);
    expect(gutter.children[0].writes).toBe(writes[0]);
    expect(gutter.children[1].writes).toBe(writes[1] + 1);
  });
});
