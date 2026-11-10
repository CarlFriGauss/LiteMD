// CommonMark's own tag lexer is used only to retain balanced presentation blocks.
// This is block-boundary detection; security filtering happens in the native DOM parser.
import { HTML_TAG_RE } from 'markdown-it/lib/common/html_re.mjs';
export function presentationBlockEnd(lines: string[], start: number): number {
  const first = lines[start].trimStart();
  const opening = /^<(div|section|figure|style|table)(?:\s|>)/i.exec(first);
  if (!opening) return start;
  const name = opening[1].toLowerCase();
  let depth = 0, length = 0;
  for (let line = start; line < lines.length && length < 65536; line++) {
    const text = lines[line]; length += text.length;
    if (name === 'style') {
      if (/<\/style\s*>/i.test(text)) return line;
      continue;
    }
    for (let at = text.indexOf('<'); at >= 0;) {
      const token = HTML_TAG_RE.exec(text.slice(at));
      if (!token) { at = text.indexOf('<', at + 1); continue; }
      const tag = /^<(\/?)([A-Za-z][A-Za-z0-9-]*)/.exec(token[0]);
      if (tag && tag[2].toLowerCase() === name) {
        depth += tag[1] ? -1 : 1;
        if (depth === 0) return line;
      }
      at = text.indexOf('<', at + token[0].length);
    }
  }
  return start; // An incomplete tag must not absorb the rest of the document.
}
