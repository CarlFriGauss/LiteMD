import { highlightRawMarkdownForBackdrop, estimateVisualWrappedRows } from './editorHelpers';
import { splitIntoLogicalBlocks } from './renderer';

/** Reuses unchanged highlight spans and gutter rows instead of rebuilding both DOM trees. */
export class EditorMirror {
  private raw: string | null = null;
  private lines = [''];
  private lineStarts = [0];
  private words = 0;
  private chunks: string[] = [];
  private readonly wordCache = new Map<string, number>();
  private readonly highlightCache = new Map<string, string>();

  constructor(private readonly backdrop: HTMLElement, private readonly gutter: HTMLElement) {}

  update(raw: string): { lines: string[]; words: number } {
    if (raw === this.raw) return { lines: this.lines, words: this.words };
    this.raw = raw;
    this.lines = raw.split('\n');
    this.lineStarts = new Array(this.lines.length);
    this.words = 0;
    let offset = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const line = this.lines[i];
      this.lineStarts[i] = offset;
      offset += line.length + 1;
      let count = this.wordCache.get(line);
      if (count === undefined) {
        count = 0;
        const pattern = /\S+/g;
        while (pattern.exec(line)) count++;
        if (this.wordCache.size >= 4096) this.wordCache.clear();
        this.wordCache.set(line, count);
      }
      this.words += count;
    }

    const starts = [0];
    for (const block of splitIntoLogicalBlocks(raw)) {
      const start = this.lineStarts[block.startLine];
      if (start > starts[starts.length - 1]) starts.push(start);
    }
    const nextChunks = new Array<string>(starts.length);
    for (let i = 0; i < starts.length; i++) {
      const chunk = raw.slice(starts[i], starts[i + 1] ?? raw.length);
      nextChunks[i] = chunk;
      let element = this.backdrop.children[i] as HTMLElement | undefined;
      if (!element) {
        element = document.createElement('span');
        this.backdrop.appendChild(element);
      }
      // The last span owns the extra mirror newline used to align the textarea's final row.
      if (chunk !== this.chunks[i] || (i === starts.length - 1) !== (i === this.chunks.length - 1)) {
        let html = this.highlightCache.get(chunk);
        if (html === undefined) {
          html = highlightRawMarkdownForBackdrop(chunk).slice(0, -1);
          if (this.highlightCache.size >= 2048) this.highlightCache.clear();
          this.highlightCache.set(chunk, html);
        }
        element.innerHTML = html + (i === starts.length - 1 ? '\n' : '');
      }
    }
    while (this.backdrop.children.length > starts.length) this.backdrop.lastElementChild!.remove();
    this.chunks = nextChunks;
    return { lines: this.lines, words: this.words };
  }

  updateGutter(wrap: boolean, cols: number, measured?: number[]): number {
    let extra = 0;
    for (let i = 0; i < this.lines.length; i++) {
      const rows = wrap ? measured?.[i] ?? estimateVisualWrappedRows(this.lines[i], cols) : 1;
      extra += rows - 1;
      let group = this.gutter.children[i] as HTMLElement | undefined;
      if (!group) {
        group = document.createElement('div');
        this.gutter.appendChild(group);
      }
      if (group.childElementCount !== rows) {
        let html = `<div class="litemd-gutter-row">${i + 1}</div>`;
        for (let row = 1; row < rows; row++) html += '<div class="litemd-gutter-row litemd-gutter-wrap-cue" title="Soft-wrapped continuation (no newline added)">↪</div>';
        group.innerHTML = html;
      } else if (group.firstElementChild!.textContent !== String(i + 1)) {
        group.firstElementChild!.textContent = String(i + 1);
      }
    }
    while (this.gutter.children.length > this.lines.length) this.gutter.lastElementChild!.remove();
    return extra;
  }

  cursor(offset: number): { line: number; col: number } {
    let low = 0;
    let high = this.lineStarts.length;
    while (low + 1 < high) {
      const mid = (low + high) >>> 1;
      if (this.lineStarts[mid] <= offset) low = mid;
      else high = mid;
    }
    return { line: low + 1, col: offset - this.lineStarts[low] + 1 };
  }
}
