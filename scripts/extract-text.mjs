#!/usr/bin/env node
// Prints the text of an image or a PDF, read on this computer. Claude runs it when the guard refused the
// picture itself: the text comes back as tool output, where the guard hides addresses, secrets and terms.
//
//   node extract-text.mjs <file>

import { closeGaps, textOf } from './pictures.mjs';

const path = process.argv[2];
if (!path) {
  console.error('Usage: extract-text.mjs <image or PDF>');
  process.exit(1);
}
const result = textOf(path);
if (result.unavailable) {
  console.error(`The text could not be read: ${result.unavailable}.`);
  process.exit(2);
}
// The gaps are closed so that an address the recognition split in two is still hidden on the way to Claude.
process.stdout.write(`${closeGaps(result.text).trim()}\n`);
