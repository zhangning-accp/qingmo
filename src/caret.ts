import type { Node } from '@milkdown/kit/prose/model';

// Find the last start at or before the caret (including an empty final line).
function preceding<T>(entries: T[], position: number, start: (entry: T) => number): number {
  let low = 0, high = entries.length;
  while (low + 1 < high) {
    const mid = Math.floor((low + high) / 2);
    if (start(entries[mid]) <= position) low = mid;
    else high = mid;
  }
  return low;
}

class TextLines {
  readonly starts = [0];
  constructor(readonly text: string) {
    for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) this.starts.push(i + 1);
  }
  at(offset: number) {
    const row = preceding(this.starts, offset, n => n);
    const prefix = this.text.slice(this.starts[row], offset);
    const column = prefix.length - (prefix.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g)?.length ?? 0) + 1;
    return { line: row + 1, column };
  }
}

let lastSource: string | undefined;
let sourceIndex: TextLines;
export function sourceLines(source: string) {
  if (source !== lastSource) {
    // Textarea selection offsets use LF even for files saved with CRLF.
    sourceIndex = new TextLines(source.replace(/\r\n?/g, '\n'));
    lastSource = source;
  }
  return sourceIndex;
}

// Represent the typeset document as logical lines. Adjacent cells share a
// row, separated by one column. Store offsets so caret moves need no reparse.
type Span = { position: number; offset: number; length: number };
const richCache = new WeakMap<Node, { lines: TextLines; spans: Span[] }>();
export function layoutCaret(doc: Node, head: number) {
  let index = richCache.get(doc);
  if (!index) {
    const chunks: string[] = [];
    const spans: Span[] = [];
    let offset = 0, blocks = 0;
    let row: Node | undefined, lastRow: Node | undefined;
    const append = (text: string) => { chunks.push(text); offset += text.length; };
    function walk(node: Node, pos: number) {
      const previous = row;
      if (node.type.name === 'table_row' || node.type.name === 'table_header_row') row = node;
      if (node.isTextblock || (node.isBlock && node.isLeaf)) {
        if (blocks++) append(row && row === lastRow ? '\t' : '\n');
        lastRow = row;
        spans.push({ position: pos + (node.isLeaf ? 0 : 1), offset, length: 0 });
        node.forEach((child, relative) => {
          const position = pos + 1 + relative;
          const text = child.text ?? (child.type.name === 'hardbreak' ? '\n' : '\uFFFC');
          // The Chinese-label compatibility marker is invisible in layout.
          let start = 0;
          for (const match of text.matchAll(/\u200B/g)) {
            const end = match.index!;
            spans.push({ position: position + start, offset, length: end - start });
            append(text.slice(start, end));
            start = end + 1;
          }
          spans.push({ position: position + start, offset, length: text.length - start });
          append(text.slice(start));
        });
      } else node.forEach((child, relative) => walk(child, pos + 1 + relative));
      row = previous;
    }
    walk(doc, -1);
    index = { spans, lines: new TextLines(chunks.join('')) };
    richCache.set(doc, index);
  }
  const span = index.spans[preceding(index.spans, head, item => item.position)];
  const offset = span ? span.offset + Math.max(0, Math.min(span.length, head - span.position)) : 0;
  return { ...index.lines.at(offset), total: index.lines.starts.length };
}
