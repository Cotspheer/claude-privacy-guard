#!/usr/bin/env node
// UserPromptSubmit hook for Claude Code: stops a message before it reaches Claude when it holds an email address,
// or one of the user's confidential terms while a list says "mode: everywhere". The same goes for the text
// files the message attaches with an @ mention: their content is put into Claude's context without a tool
// call, so the output mask never sees it. Attached images and PDFs are read with the local text recognition.
// The person sees why and decides.

import { openSync, readSync, closeSync, statSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import { countBlocked, loadAllow, readHookInput, userAllowFile } from './lib.mjs';
import { closeGaps, extractScript, isPicture, pictureSettings, textOf } from './pictures.mjs';
import { loadTermLists, maskSecrets, maskTerms } from './sensitive.mjs';

/** Attached files are read up to this size; a larger one is checked in its first part only. */
const ATTACHMENT_LIMIT = 2 * 1024 * 1024;

const payload = await readHookInput('prompt-check');
const prompt = typeof payload.prompt === 'string' ? payload.prompt : '';
const block = (reason) => process.stdout.write(JSON.stringify({ decision: 'block', reason }));
const allow = loadAllow();
const lists = loadTermLists();

/** The text files the prompt attaches: `@path`, `@"path with spaces"`, each with an optional `#L1-20` line range. */
function attachedFiles() {
  const files = [];
  for (const match of prompt.matchAll(/(?:^|\s)@(?:"([^"]+)"|([^\s"]+))/g)) {
    const named = (match[1] ?? match[2]).replace(/[),.;:!?]+$/, '').replace(/#L\d+(-\d+)?$/, '');
    const path = isAbsolute(named) ? named : join(payload.cwd ?? process.cwd(), named);
    try {
      if (!statSync(path).isFile()) continue;
      // An attached image or PDF reaches Claude as a picture; its text is read here, as for a file read.
      if (isPicture(path)) {
        if (pictureSettings().mode === 'off') continue;
        const read = textOf(path);
        if (read.text !== undefined) files.push({ named, text: closeGaps(read.text), picture: true });
        continue;
      }
      const buffer = Buffer.alloc(Math.min(statSync(path).size, ATTACHMENT_LIMIT));
      const handle = openSync(path, 'r');
      readSync(handle, buffer, 0, buffer.length, 0);
      closeSync(handle);
      // A file with NUL bytes is no text file; its content does not reach Claude as text.
      if (!buffer.includes(0)) files.push({ named, text: buffer.toString('utf8') });
    } catch {
      // Not a file, or not readable: an ordinary "@" in the message.
    }
  }
  return files;
}

const addresses = countBlocked(prompt, allow);
const confidential = maskTerms(prompt, lists, true).count;

if (addresses > 0) {
  block(
    `privacy-guard: your message holds ${addresses} email address(es) and was not sent. ` +
      'Send it again without them. If Claude may see and use an address, add it or its @domain to ' +
      `${userAllowFile()} first.`,
  );
} else if (confidential > 0) {
  block(
    `privacy-guard: your message holds ${confidential} confidential term(s) and was not sent. ` +
      "Send it again without them. The list they are on is set to keep its terms out of Claude's view entirely.",
  );
} else {
  const found = [];
  for (const file of attachedFiles()) {
    const parts = [
      [countBlocked(file.text, allow), 'email address(es)'],
      [maskSecrets(file.text).count, 'secret(s)'],
      [maskTerms(file.text, lists, true).count, 'confidential term(s)'],
    ].filter(([count]) => count > 0);
    if (parts.length > 0) found.push(`${file.named} (${parts.map(([count, kind]) => `${count} ${kind}`).join(', ')})`);
  }
  if (found.length > 0) {
    block(
      `privacy-guard: your message was not sent, because a file attached with "@" would reach Claude unmasked: ${found.join('; ')}. ` +
        'Send the message again and name the file without the "@" (for example "read note.txt"). Claude then opens it ' +
        'with its file tool, and the guard hides those values on the way. For a picture or PDF, Claude gets the text ' +
        `in place of the picture (it runs ${extractScript}).`,
    );
  }
}
