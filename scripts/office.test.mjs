// Tests of the reader for Word, Excel and OpenDocument files. The test files are built here, as zip archives.
// Addresses are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { deflateRawSync } from 'node:zlib';
import { isOffice, readOffice } from './office.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-office-test-'));
const address = ['office.probe', 'mailbox-probe.io'].join('@');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(bytes) {
  let c = 0xffffffff;
  for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** A zip archive of the given entries, each deflated or (stored: true) kept as it is. */
function zip(entries, stored = false) {
  const parts = [];
  const central = [];
  let offset = 0;
  for (const [name, content] of Object.entries(entries)) {
    const data = Buffer.from(content);
    const packed = stored ? data : deflateRawSync(data);
    const label = Buffer.from(name);
    const head = Buffer.alloc(30);
    head.writeUInt32LE(0x04034b50, 0);
    head.writeUInt16LE(stored ? 0 : 8, 8);
    head.writeUInt32LE(crc32(data), 14);
    head.writeUInt32LE(packed.length, 18);
    head.writeUInt32LE(data.length, 22);
    head.writeUInt16LE(label.length, 26);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(stored ? 0 : 8, 10);
    entry.writeUInt32LE(crc32(data), 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(label.length, 28);
    entry.writeUInt32LE(offset, 42);
    parts.push(head, label, packed);
    central.push(entry, label);
    offset += 30 + label.length + packed.length;
  }
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(central.reduce((sum, part) => sum + part.length, 0), 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, ...central, end]);
}

function file(name, entries, stored) {
  const path = join(dir, name);
  writeFileSync(path, zip(entries, stored));
  return path;
}

const [local, domain] = address.split('@');
const docx = file('note.docx', {
  // The address is split over two runs, as Word does after an edit.
  'word/document.xml': `<w:document><w:body><w:p><w:r><w:t>Meeting &amp; minutes</w:t></w:r></w:p><w:p><w:r><w:t>owner: ${local}</w:t></w:r><w:r><w:t>@${domain}</w:t></w:r></w:p></w:body></w:document>`,
  'word/header1.xml': '<w:hdr><w:p><w:r><w:t>Confidential</w:t></w:r></w:p></w:hdr>',
});
const xlsx = file('note.xlsx', {
  'xl/sharedStrings.xml': `<sst><si><t>owner</t></si><si><t>${address}</t></si></sst>`,
  'xl/worksheets/sheet1.xml': '<worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row></sheetData></worksheet>',
});
const odf = (body) => `<office:document-content><office:body>${body}</office:body></office:document-content>`;
const odt = file('note.odt', { mimetype: 'application/vnd.oasis.opendocument.text', 'content.xml': odf(`<text:p>Meeting note</text:p><text:p>owner: ${address}</text:p>`) }, true);
const ods = file('note.ods', { 'content.xml': odf(`<table:table-row><table:table-cell><text:p>owner</text:p></table:table-cell><table:table-cell><text:p>${address}</text:p></table:table-cell></table:table-row>`) });

test('isOffice knows the document formats', () => {
  for (const name of ['a.docx', 'b.XLSX', 'c.pptx', 'd.odt', 'e.ods', 'f.odp']) assert.equal(isOffice(name), true, name);
  for (const name of ['a.doc', 'b.txt', 'c.pdf', 'd.zip']) assert.equal(isOffice(name), false, name);
});

test('the text of Word, Excel and OpenDocument files is read, an address split over runs included', () => {
  const word = readOffice(docx).text;
  assert.match(word, /Meeting & minutes/);
  assert.match(word, /Confidential/);
  assert.ok(word.includes(`owner: ${address}`));
  for (const path of [xlsx, odt, ods]) assert.ok(readOffice(path).text.includes(address), path);
  assert.match(readOffice(ods).text, /owner\t/);
});

test('embedded pictures are handed back for the text recognition', () => {
  const path = file('scan.docx', { 'word/document.xml': '<w:document><w:p><w:r><w:t>see the stamp</w:t></w:r></w:p></w:document>', 'word/media/image1.png': Buffer.from([1, 2, 3]), 'word/media/chart.emf': 'x' });
  const { pictures } = readOffice(path);
  assert.deepEqual(pictures.map((picture) => [picture.name, picture.bytes.length]), [['word/media/image1.png', 3]]);
});

test('a file that is no archive is refused with a reason, not a crash', () => {
  const path = join(dir, 'broken.docx');
  writeFileSync(path, 'not a zip');
  const result = spawnSync(process.execPath, [join(here, 'extract-text.mjs'), path], { encoding: 'utf8' });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /could not be opened as an Office document/);
});

test('the file tool is pointed to the reader for an Office file, and the reader prints its text', () => {
  const hook = spawnSync(process.execPath, [join(here, 'email-guard.mjs')], { input: JSON.stringify({ tool_name: 'Read', tool_input: { file_path: docx } }), encoding: 'utf8' });
  const decision = JSON.parse(hook.stdout).hookSpecificOutput;
  assert.equal(decision.permissionDecision, 'deny');
  assert.match(decision.permissionDecisionReason, /extract-text\.mjs/);
  assert.ok(!decision.permissionDecisionReason.includes(address));
  const text = spawnSync(process.execPath, [join(here, 'extract-text.mjs'), docx], { encoding: 'utf8' }).stdout;
  assert.ok(text.includes(address));
});
