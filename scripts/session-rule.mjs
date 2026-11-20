#!/usr/bin/env node
// SessionStart hook for Claude Code: prints the email rule, and a note when git here commits under a real address.
// Claude Code adds a SessionStart hook's stdout to the session's context.

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countBlocked, loadAllow, readHookInput } from './lib.mjs';

const payload = await readHookInput('session-rule');

// A repository install keeps the rule in .claude/rules, where it is always loaded; then there is nothing to print.
const here = dirname(fileURLToPath(import.meta.url));
const rule = join(here, '..', 'rules', 'email-address.md');
if (existsSync(rule)) process.stdout.write(readFileSync(rule, 'utf8'));

// How documents and pictures are read, with the path of the guard's reader on this computer.
const documents = join(here, '..', 'rules', 'documents.md');
if (existsSync(documents)) process.stdout.write(`\n${readFileSync(documents, 'utf8').replace('{extract}', join(here, 'extract-text.mjs'))}`);

try {
  const author = execFileSync('git', ['config', 'user.email'], { cwd: payload.cwd, encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  if (author && countBlocked(author, loadAllow()) > 0) {
    process.stdout.write(
      '\nprivacy-guard: git in this folder is set to commit under a real email address, which every commit publishes ' +
        'to whoever can read the repository. Tell the user once, early in the session; do not change the git configuration yourself.\n',
    );
  }
} catch {
  // Not a git folder, or git is missing: nothing to say.
}
