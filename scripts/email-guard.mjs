#!/usr/bin/env node
// PreToolUse hook for Claude Code. It denies a tool call when
//   - its input holds an email address that is not allowed,
//   - it leaves the computer and holds a secret or one of the user's confidential terms
//     (with "mode: everywhere" in the terms file, a term is denied in every tool call),
//   - it would write the placeholder of a hidden value into a file,
//   - it would print a file of private keys or tokens (id_rsa, *.pem, .aws/credentials), or
//   - it is a `git commit` and the changes to be committed add an email address.

import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { credentialKind, keyFilesPrinted } from './credentials.mjs';
import { PLACEHOLDER, countBlocked, loadAllow, readHookInput } from './lib.mjs';
import { isOffice } from './office.mjs';
import { closeGaps, extractScript, isPicture, pictureSettings, textOf } from './pictures.mjs';
import { cannotAsk, orgSettingsFile, settingsFile } from './settings.mjs';
import { PERSONAL_PLACEHOLDER, SECRET_PLACEHOLDER, TERM_PLACEHOLDER, findingsIn, isOutbound, loadTermLists, maskSecrets, maskTerms } from './sensitive.mjs';

const WRITING_FIELDS = { Write: ['content'], Edit: ['new_string'], NotebookEdit: ['new_source'] };
const PLACEHOLDERS = [PLACEHOLDER, SECRET_PLACEHOLDER, PERSONAL_PLACEHOLDER, TERM_PLACEHOLDER];
const GIT_COMMIT = /\bgit\b[^|;&\n]*\bcommit\b/;

function deny(reason) {
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: reason } }));
}

function asText(value) {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

/** The input's fields in which `count` finds something, as "field (count)". */
function fieldsWith(input, count) {
  const fields = [];
  for (const [key, value] of Object.entries(input)) {
    const found = count(asText(value));
    if (found > 0) fields.push(`${key} (${found})`);
  }
  return fields;
}

/** Files whose changes to be committed add an address, as "path (count)". */
function addressesInCommit(command, cwd, allow) {
  const run = (args) => {
    try {
      return execFileSync('git', args, { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'] });
    } catch {
      return '';
    }
  };
  let diff = run(['diff', '--cached', '-U0', '--no-color']);
  if (/\s(-[a-zA-Z]*a[a-zA-Z]*|--all)\b/.test(command)) diff += run(['diff', '-U0', '--no-color']);

  const perFile = new Map();
  let file = '';
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) file = line.slice(4).replace(/^b\//, '');
    else if (line.startsWith('+')) {
      const count = countBlocked(line.slice(1), allow);
      if (count > 0) perFile.set(file, (perFile.get(file) ?? 0) + count);
    }
  }
  return [...perFile].map(([path, count]) => `${path} (${count})`);
}

/** The reason to deny the call, or undefined. Reasons name the field or the file, never the value: they go into the model's context and the transcript. */
function reasonToDeny(payload) {
  const input = payload.tool_input;
  if (!input || typeof input !== 'object') return undefined;
  const tool = payload.tool_name;
  const allow = loadAllow();

  const addresses = fieldsWith(input, (text) => countBlocked(text, allow));
  if (addresses.length > 0) {
    return (
      `email-guard: this ${tool} call holds an email address in ${addresses.join(', ')}. ` +
      'Email addresses stay out of tool calls. Leave it out or use a made-up one (name@example.com). ' +
      'If the task needs this address, stop and ask the user; only they add an address or @domain to email-guard.allow.txt in the Claude config folder.'
    );
  }

  // The lists and their keys are the user's. They change only through the terms skill's script.
  const touched = [input.file_path, input.path, input.notebook_path, tool === 'Bash' || tool === 'PowerShell' ? input.command : undefined].map((value) => asText(value ?? ''));
  if (touched.some((text) => text.includes('privacy-guard.terms') && !text.includes('terms.mjs'))) {
    return (
      `privacy-guard: this ${tool} call reaches for the user's list of confidential terms or its key. ` +
      'Those files are not read or edited directly. Use the terms skill (its script adds, removes and checks terms), or ask the user.'
    );
  }

  // A key as a code is for the person's eyes and their password manager; the script also refuses without a terminal.
  if ((tool === 'Bash' || tool === 'PowerShell') && /\bterms\.mjs["']?\s+key\b/.test(asText(input.command))) {
    return (
      'privacy-guard: the key commands of the terms skill put a key code on the screen or the clipboard, so the person runs them in their own terminal. ' +
      'Give them the command in a message of its own, alone in a code block, with the full path filled in.'
    );
  }

  const outbound = isOutbound(tool, input);
  const lists = loadTermLists();
  const found = fieldsWith(input, (text) => maskTerms(text, lists, !outbound).count);
  if (found.length > 0) {
    return (
      `privacy-guard: this ${tool} call holds a confidential term from the user's list in ${found.join(', ')}. ` +
      (outbound ? 'Those terms stay out of calls that leave the computer. ' : 'Those terms stay out of every tool call. ') +
      'Rephrase without it, or stop and ask the user. Do not try spellings that get past the check.'
    );
  }
  if (outbound) {
    const rules = new Set();
    const found = fieldsWith(input, (text) => {
      const result = maskSecrets(text);
      for (const rule of result.rules) rules.add(rule);
      return result.count;
    });
    if (found.length > 0) {
      return (
        `privacy-guard: this ${tool} call would send what looks like a secret or personal data in ${found.join(', ')} (rule ${[...rules].join(', ')}). ` +
        'Such values stay out of calls that leave the computer. Pass a secret through an environment variable or a file the command reads, or ask the user. ' +
        `If the rule is wrong about this value, tell the user: they can list the value under "allowedValues" or the rule under "disabledRules" in ${settingsFile()}.`
      );
    }
  }

  const placeholder = PLACEHOLDERS.find((text) => (WRITING_FIELDS[tool] ?? []).some((key) => asText(input[key]).includes(text)));
  if (placeholder) {
    return (
      `email-guard: this ${tool} call would write "${placeholder}" into a file. That text is what a hidden value ` +
      'reads as in tool output; the file itself still holds the real one. Change only the lines around it, or ask the user.'
    );
  }

  if ((tool === 'Bash' || tool === 'PowerShell') && GIT_COMMIT.test(asText(input.command))) {
    const files = addressesInCommit(asText(input.command), payload.cwd, allow);
    if (files.length > 0) {
      return (
        `email-guard: this commit would add an email address in ${files.join(', ')}. ` +
        'Take it out of those files first, or tell the user which files hold one and let them decide.'
      );
    }
  }
  return undefined;
}

/**
 * What to do with a file read of an image or a PDF: { deny: reason }, { ask: reason } or nothing.
 * A picture cannot be masked on its way to Claude, so its text is read here first.
 */
function pictureDecision(payload) {
  const path = payload.tool_name === 'Read' ? payload.tool_input?.file_path : undefined;
  if (typeof path !== 'string') return undefined;
  const instead = `To work with its content, run: node "${extractScript}" "${path}" . That prints the text, with those values hidden.`;
  // The file tool cannot open an Office document. Claude is pointed to the guard's reader, so that it does not
  // write an extractor of its own, whose handling of embedded pictures nobody checks.
  if (isOffice(path)) {
    return { deny: `privacy-guard: an Office document is not opened with the file tool. ${instead} The text of pictures embedded in it is included.` };
  }
  if (!isPicture(path)) return undefined;
  const settings = pictureSettings(path);
  if (settings.mode === 'off') return undefined;
  if (settings.mode === 'strict' && !settings.isAllowed(path)) {
    return { deny: `privacy-guard: pictures and PDFs are not opened on this computer (the guard is set to "strict"). ${instead}` };
  }

  const read = textOf(path);
  if (read.text !== undefined) {
    const found = findingsIn(closeGaps(read.text), loadAllow(), loadTermLists());
    if (found.length > 0) {
      return {
        deny:
          `privacy-guard: this file holds ${found.join(', ')}, and a picture or PDF cannot be masked on its way to you. ` +
          `${instead} Tell the user that you worked from the text and not from the picture.`,
      };
    }
  }
  if (settings.mode === 'confirm' && !settings.isAllowed(path)) {
    const checked = read.text !== undefined ? 'The guard read its text and found no address, secret or confidential term.' : `The guard could not read its text (${read.unavailable}).`;
    // Where nobody is shown a question, asking would let the picture through unseen.
    if (cannotAsk(payload.permission_mode)) {
      return {
        deny:
          `privacy-guard: the person is to confirm every picture and PDF (the guard is set to "confirm"), and this session runs in the permission mode "${payload.permission_mode}", where a question does not reach them. ${instead} ` +
          'To open the picture itself, the user switches to the default permission mode or lists its folder under "picturesAllowed".',
      };
    }
    return { ask: `privacy-guard: Claude wants to open a picture or PDF. ${checked} What stands in it reaches Claude unmasked.` };
  }
  return undefined;
}

/** The reason to refuse a call that would put a file of private keys or tokens into Claude's context, or undefined. */
function keyFileReason(payload) {
  const tool = payload.tool_name;
  const input = payload.tool_input ?? {};
  let files = [];
  if (tool === 'Read' && credentialKind(input.file_path) === 'key') files = [input.file_path];
  else if (tool === 'Grep' && input.output_mode === 'content') {
    // A search prints the lines it finds: in a key file, or in the key files a pattern such as "*.pem" picks.
    files = [input.path, typeof input.glob === 'string' ? input.glob.replace(/\*+/g, 'x') : undefined].filter((path) => credentialKind(path) === 'key');
  } else if (tool === 'Bash' || tool === 'PowerShell') files = keyFilesPrinted(asText(input.command));
  if (files.length === 0) return undefined;
  return (
    `privacy-guard: ${files.join(', ')} holds private keys or tokens, and this ${tool} call would put them into the conversation. ` +
    'A command may use such a file (ssh -i, a program that reads it) without printing it. ' +
    `If its content is needed, ask the user; they can list the file under "credentialFilesAllowed" in ${settingsFile()}.`
  );
}

/**
 * A change to the guard's own settings is the person's to confirm: a rule switched off or a file allowed there
 * opens what the guard closes. Where no question reaches them, the change is refused.
 */
function settingsDecision(payload) {
  const input = payload.tool_input ?? {};
  const tool = payload.tool_name;
  // Only the settings files the guard really reads count: a file of the same name elsewhere, or the name inside
  // a test or a text, is no change to the guard.
  const guarded = [settingsFile(), orgSettingsFile()].filter(Boolean).map((file) => resolve(file).toLowerCase());
  const home = homedir().replace(/\\/g, '/');
  const isGuarded = (path) => {
    const expanded = String(path)
      .replace(/^["']|["']$/g, '')
      .replace(/\\/g, '/')
      .replace(/^(?:~|\$HOME|\$\{HOME\}|\$env:USERPROFILE|%USERPROFILE%)(?=\/|$)/i, home);
    return guarded.includes(resolve(payload.cwd ?? process.cwd(), expanded).toLowerCase());
  };
  const named = (text) =>
    asText(text ?? '')
      .split(/[\s<>|;&()=,]+/)
      .some((word) => /privacy-guard(?:\.org)?\.json["']?$/i.test(word) && isGuarded(word));
  const writes = ((tool === 'Write' || tool === 'Edit') && isGuarded(input.file_path ?? '')) || ((tool === 'Bash' || tool === 'PowerShell') && named(input.command) && /(?:>|\bset-content\b|\bout-file\b|\btee\b|\bsed\b|\bmv\b|\bcp\b|\bmove-item\b|\bcopy-item\b|\brm\b|\bremove-item\b|writeFile)/i.test(asText(input.command)));
  // The rules skill's script is the way to change the settings. What tightens the guard (enable, add) runs;
  // what loosens it (a rule off, a value or a file allowed, a rule taken out) is the person's to confirm.
  const loosens = (tool === 'Bash' || tool === 'PowerShell') && /\brules\.mjs["']?\s+(?:disable|allow|remove|pictures)\b/.test(asText(input.command));
  if (!writes && !loosens) return undefined;
  const what = loosens
    ? 'privacy-guard: this call loosens the guard: it switches a rule off, allows a value, a file or a folder, takes a rule out, or changes how pictures are handled.'
    : "privacy-guard: this call changes the guard's settings (privacy-guard.json), where rules are switched off and files are allowed.";
  if (cannotAsk(payload.permission_mode)) {
    return { deny: `${what} The person has to confirm that, and this session runs in the permission mode "${payload.permission_mode}", where a question does not reach them. Show them the change and let them make it.` };
  }
  return { ask: `${what} Allow it only if you asked for this change.` };
}

const payload = await readHookInput('email-guard');
const reason = reasonToDeny(payload) ?? keyFileReason(payload);
if (reason) deny(reason);
else {
  const decision = settingsDecision(payload) ?? pictureDecision(payload);
  if (decision?.deny) deny(decision.deny);
  else if (decision?.ask) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'ask', permissionDecisionReason: decision.ask } }));
  }
}
