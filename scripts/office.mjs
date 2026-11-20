// Reads Word, Excel, PowerPoint and OpenDocument files. Each is a zip archive of XML parts, so the reading needs
// nothing beyond Node: the archive's directory is parsed here and the parts are inflated with zlib.

import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { inflateRawSync } from 'node:zlib';

const OFFICE = new Set(['.docx', '.docm', '.xlsx', '.xlsm', '.pptx', '.pptm', '.odt', '.ods', '.odp']);
const IMAGE = /\.(png|jpe?g|gif|bmp|tiff?|webp)$/i;

export function isOffice(path) {
  return OFFICE.has(extname(path).toLowerCase());
}

/** The archive's entries as a map from name to a function that returns the entry's bytes. */
function entries(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  if (end < 0) throw new Error('not a zip archive');
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const found = new Map();
  for (let i = 0; i < count && buffer.readUInt32LE(at) === 0x02014b50; i++) {
    const method = buffer.readUInt16LE(at + 10);
    const packed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const local = buffer.readUInt32LE(at + 42);
    const name = buffer.toString('utf8', at + 46, at + 46 + nameLength);
    found.set(name, () => {
      const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
      const data = buffer.subarray(start, start + packed);
      return method === 0 ? data : inflateRawSync(data);
    });
    at += 46 + nameLength + buffer.readUInt16LE(at + 30) + buffer.readUInt16LE(at + 32);
  }
  return found;
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };

/**
 * The text of an XML part. Tags that end a paragraph, a row or a cell become a line break or a tab; text
 * that the format splits over several runs comes out joined, so an address broken across runs is whole again.
 */
function textOfXml(xml) {
  return xml
    .replace(/<(?:w:tab|text:tab)\b[^>]*\/>/g, '\t')
    // The last paragraph of a table cell ends the cell, not a line: a row stays on one line.
    .replace(/<\/(?:text:p|w:p)>\s*<\/(?:table:table-cell|w:tc)>/g, '\t')
    .replace(/<\/(?:w:p|a:p|text:p|text:h|si|row|table:table-row)>|<(?:w:br|text:line-break)\b[^>]*\/>/g, '\n')
    .replace(/<\/(?:c|table:table-cell|w:tc)>/g, '\t')
    .replace(/<[^>]+>/g, '')
    .replace(/&(amp|lt|gt|quot|apos);/g, (_, name) => ENTITIES[name])
    .replace(/&#(x?)([0-9a-f]+);/gi, (_, hex, code) => String.fromCodePoint(parseInt(code, hex ? 16 : 10)))
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n');
}

/** Which parts of the archive hold text a reader sees, in reading order. */
function textParts(names) {
  const pick = (pattern) => names.filter((name) => pattern.test(name)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return [
    ...pick(/^word\/(document|header\d*|footer\d*|footnotes|endnotes|comments)\.xml$/),
    ...pick(/^xl\/sharedStrings\.xml$/),
    ...pick(/^xl\/worksheets\/sheet\d+\.xml$/),
    ...pick(/^xl\/comments\d*\.xml$/),
    ...pick(/^ppt\/(slides|notesSlides)\/[^/]+\.xml$/),
    ...pick(/^(content|styles|meta)\.xml$/),
    ...pick(/^docProps\/(core|app)\.xml$/),
  ];
}

/**
 * What an Office file holds: { text, pictures }. `pictures` are the embedded images as { name, bytes },
 * for the caller to read with the text recognition; a scanned page inside a document is one of them.
 */
export function readOffice(path) {
  const archive = entries(readFileSync(path));
  const names = [...archive.keys()];
  const text = textParts(names)
    .map((name) => textOfXml(archive.get(name)().toString('utf8')))
    .filter((part) => part.trim())
    .join('\n')
    .trim();
  const pictures = names.filter((name) => IMAGE.test(name)).map((name) => ({ name, bytes: archive.get(name)() }));
  return { text, pictures };
}
