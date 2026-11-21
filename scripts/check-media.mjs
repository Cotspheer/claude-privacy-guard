#!/usr/bin/env node
// Checks one pasted image or document: reads its text on this computer and counts what it holds.
// Input on stdin: { filename?, mediaType?, base64 }. Output: { mode, found: [...], unavailable? } as JSON.
// The file is written to the temp folder for the reading and deleted afterwards.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { loadAllow } from './lib.mjs';
import { closeGaps, pictureSettings, textOf } from './pictures.mjs';
import { findingsIn, loadTermLists } from './sensitive.mjs';

const EXTENSIONS = {
  'image/png': '.png', 'image/jpeg': '.jpg', 'image/gif': '.gif', 'image/webp': '.webp', 'image/bmp': '.bmp', 'image/tiff': '.tif', 'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '.pptx',
  'application/vnd.oasis.opendocument.text': '.odt',
  'application/vnd.oasis.opendocument.spreadsheet': '.ods',
  'application/vnd.oasis.opendocument.presentation': '.odp',
};

let input = '';
for await (const chunk of process.stdin) input += chunk;
const item = JSON.parse(input);
const extension = EXTENSIONS[item.mediaType] ?? extname(item.filename ?? '').toLowerCase();
const mode = pictureSettings(`pasted${extension}`).mode;

let result = { mode, found: [] };
if (mode !== 'off') {
  if (!extension) result.unavailable = 'the kind of file is not one the guard can read';
  else {
    const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-paste-'));
    try {
      const file = join(dir, `pasted${extension}`);
      writeFileSync(file, Buffer.from(item.base64, 'base64'));
      const read = textOf(file);
      if (read.text === undefined) result.unavailable = read.unavailable;
      else {
        result.found = findingsIn(closeGaps(read.text), loadAllow(), loadTermLists());
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}
process.stdout.write(JSON.stringify(result));
