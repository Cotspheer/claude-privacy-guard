#!/usr/bin/env node
// PostToolUse hook for Claude Code: hides email addresses and secrets in a tool's output before Claude reads it,
// and the user's confidential terms when their terms file says "mode: everywhere".
// What Claude never sees, it cannot pass on. The tool has already run; files and programs are untouched.

import { PLACEHOLDER, loadAllow, mask, readHookInput } from './lib.mjs';
import { SECRET_PLACEHOLDER, TERM_PLACEHOLDER, loadTermLists, maskSecrets, maskTerms } from './sensitive.mjs';

const payload = await readHookInput('mask-output');
const allow = loadAllow();
const lists = loadTermLists();
const hidden = { addresses: 0, secrets: 0, terms: 0 };

function maskAll(text) {
  const secrets = maskSecrets(text);
  const addresses = mask(secrets.text, allow);
  const confidential = maskTerms(addresses.text, lists, true);
  hidden.secrets += secrets.count;
  hidden.addresses += addresses.count;
  hidden.terms += confidential.count;
  return confidential.text;
}

/** The same value with every string in it masked. The shape stays as the tool produced it. */
function walk(value) {
  if (typeof value === 'string') return maskAll(value);
  if (Array.isArray(value)) return value.map(walk);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, walk(item)]));
  return value;
}

const output = walk(payload.tool_response);
const parts = [
  hidden.addresses && `${hidden.addresses} email address(es) as "${PLACEHOLDER}"`,
  hidden.secrets && `${hidden.secrets} secret(s) as "${SECRET_PLACEHOLDER}"`,
  hidden.terms && `${hidden.terms} confidential term(s) as "${TERM_PLACEHOLDER}"`,
].filter(Boolean);

if (parts.length > 0) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'PostToolUse',
        updatedToolOutput: output,
        additionalContext:
          `privacy-guard: this output is shown with ${parts.join(', ')}. ` +
          'The file or source still holds the real values. Never write a placeholder into a file, and do not try to recover what is hidden.',
      },
    }),
  );
}
