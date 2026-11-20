#!/usr/bin/env node
// Manages the lists of confidential terms the privacy guard reads, and tells whether a term would get in the way.
//
//   node terms.mjs status
//   node terms.mjs add    [--list <name>] [--sound] [<term>...]     no term given: one per line from standard input
//   node terms.mjs remove [--list <name>] [<term>...]
//   node terms.mjs mode   [--list <name>] outbound|everywhere
//   node terms.mjs check  [--days 30] [--quiet] [<term>...]         no term given: the whole personal list
//   node terms.mjs test   [<text>...]                               would the guard catch this text, and which list
//   node terms.mjs share  <name>                                    how to hand a shared list to others
//   node terms.mjs import <list.json> [<list.key>]                  take a shared list over
//
// Without --list a term goes to the personal list, a plain text file. With --list <name> it goes to a shared
// list, which holds keyed hashes instead of terms; its key sits in a file of its own.

import { randomBytes } from 'node:crypto';
import { chmodSync, copyFileSync, createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { createInterface } from 'node:readline';
import { configDir } from '../../scripts/lib.mjs';
import { hashTerm, isOutbound, loadTermLists, maskTerms, parseTerm, sharedKeyFile, sharedListFile, termsDir, termsFile } from '../../scripts/sensitive.mjs';

const args = process.argv.slice(2);
const command = args.shift();
function option(name) {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
}
function flag(name) {
  const at = args.indexOf(name);
  if (at >= 0) args.splice(at, 1);
  return at >= 0;
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

const listName = option('--list');
if (listName !== undefined && !/^[a-z0-9][a-z0-9-]{0,40}$/.test(listName)) fail('A list name is lower-case letters, digits and hyphens, for example "team" or "matter-2026".');

/** The terms to work on: the arguments, or one per line from standard input, so that a term never has to pass through Claude. */
async function termsGiven() {
  if (args.length > 0) return args;
  if (process.stdin.isTTY) console.error('Type one term per line. End with an empty line.');
  const lines = [];
  for await (const line of createInterface({ input: process.stdin })) {
    if (!line.trim()) break;
    lines.push(line.trim());
  }
  return lines;
}

// --- the personal list (plain text) ------------------------------------------------------------------------

function readPersonal() {
  return existsSync(termsFile()) ? readFileSync(termsFile(), 'utf8').split(/\r?\n/) : ['# Confidential terms, one per line. "~" in front also matches by sound.', '# mode: outbound'];
}
const isTermLine = (line) => line.trim() && !line.trim().startsWith('#');
const writePersonal = (lines) => writeFileSync(termsFile(), `${lines.join('\n').replace(/\n+$/, '')}\n`);

// --- shared lists (hashes) ---------------------------------------------------------------------------------

function readShared(name) {
  const file = sharedListFile(name);
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { format: 1, name, mode: 'outbound', terms: [] };
}
const writeShared = (list) => writeFileSync(sharedListFile(list.name), `${JSON.stringify(list, null, 1)}\n`);

function sharedKey(name, create) {
  const file = sharedKeyFile(name);
  if (!existsSync(file)) {
    if (process.env.PRIVACY_GUARD_TERMS_KEY) return Buffer.from(process.env.PRIVACY_GUARD_TERMS_KEY, 'hex');
    if (!create) fail(`The key of the list "${name}" is missing: ${file}. Without it the list cannot be read or changed.`);
    writeFileSync(file, `${randomBytes(32).toString('hex')}\n`, { mode: 0o600 });
    try {
      chmodSync(file, 0o600);
    } catch {}
    console.log(`Created the key of the list "${name}": ${file}`);
  }
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'hex');
}

// --- commands ----------------------------------------------------------------------------------------------

async function add() {
  const bySound = flag('--sound');
  const given = await termsGiven();
  let added = 0;
  if (listName) {
    const key = sharedKey(listName, true);
    const list = readShared(listName);
    for (const text of given) {
      const term = parseTerm(text, bySound);
      if (!term) continue;
      const hashed = hashTerm(term, key);
      if (list.terms.some((entry) => entry.id === hashed.id)) continue;
      list.terms.push(hashed);
      added++;
    }
    writeShared(list);
    console.log(`Added ${added} of ${given.length} term(s) to the shared list "${listName}" (${list.terms.length} in it, mode ${list.mode}).`);
  } else {
    const lines = readPersonal();
    const known = new Set(lines.filter(isTermLine).map((line) => parseTerm(line)?.joined));
    for (const text of given) {
      const term = parseTerm(text, bySound);
      if (!term || known.has(term.joined)) continue;
      known.add(term.joined);
      lines.push(`${term.sounds ? '~' : ''}${text.replace(/^~/, '').trim()}`);
      added++;
    }
    writePersonal(lines);
    console.log(`Added ${added} of ${given.length} term(s) to the personal list (${lines.filter(isTermLine).length} in it).`);
  }
  if (added < given.length) console.log('The others were on the list already or are shorter than three letters.');
}

async function remove() {
  const given = (await termsGiven()).map((text) => parseTerm(text)).filter(Boolean);
  if (listName) {
    const key = sharedKey(listName, false);
    const list = readShared(listName);
    const ids = new Set(given.map((term) => hashTerm(term, key).id));
    const before = list.terms.length;
    list.terms = list.terms.filter((entry) => !ids.has(entry.id));
    writeShared(list);
    console.log(`Removed ${before - list.terms.length} term(s) from the shared list "${listName}".`);
  } else {
    const gone = new Set(given.map((term) => term.joined));
    const lines = readPersonal();
    const kept = lines.filter((line) => !isTermLine(line) || !gone.has(parseTerm(line)?.joined));
    writePersonal(kept);
    console.log(`Removed ${lines.length - kept.length} term(s) from the personal list.`);
  }
}

function mode() {
  const value = args[0];
  if (value !== 'outbound' && value !== 'everywhere') fail('The mode is "outbound" or "everywhere".');
  if (listName) {
    const list = readShared(listName);
    list.mode = value;
    writeShared(list);
  } else {
    const lines = readPersonal().filter((line) => !/^#\s*mode:/i.test(line.trim()));
    lines.splice(1, 0, `# mode: ${value}`);
    writePersonal(lines);
  }
  console.log(`The ${listName ? `shared list "${listName}"` : 'personal list'} is now in mode ${value}.`);
}

function sharedNames() {
  try {
    return readdirSync(termsDir()).map((name) => /^privacy-guard\.terms\.(.+)\.json$/.exec(name)?.[1]).filter(Boolean);
  } catch {
    return [];
  }
}

function status() {
  const lines = existsSync(termsFile()) ? readPersonal() : [];
  const personalMode = /^#\s*mode:\s*everywhere/im.test(lines.join('\n')) ? 'everywhere' : 'outbound';
  console.log(`Personal list: ${existsSync(termsFile()) ? `${lines.filter(isTermLine).length} term(s), mode ${personalMode}` : 'none'} (${termsFile()})`);
  for (const name of sharedNames()) {
    const list = readShared(name);
    const hasKey = existsSync(sharedKeyFile(name)) || Boolean(process.env.PRIVACY_GUARD_TERMS_KEY);
    console.log(`Shared list "${name}": ${list.terms.length} term(s), mode ${list.mode}, key ${hasKey ? 'present' : 'MISSING: the list is not applied'}`);
  }
}

function share() {
  const name = args[0] ?? listName;
  if (!name || !existsSync(sharedListFile(name))) fail(`There is no shared list "${name ?? ''}". Create one with: add --list <name> <term>`);
  const list = readShared(name);
  console.log(
    [
      `Sharing the list "${name}" (${list.terms.length} term(s), mode ${list.mode})`,
      '',
      `It is two files in ${termsDir()}:`,
      `  the list: privacy-guard.terms.${name}.json   hashes only, safe to send by any channel`,
      `  the key:  privacy-guard.terms.${name}.key    opens the list; treat it like a password`,
      '',
      'What you do:',
      '  1. Send the list file to your colleagues: mail, chat, a shared drive or a repository.',
      '  2. Send the key file another way, one you would trust with a password: your password manager\'s',
      '     sharing, or in person. Never put both files into the same message or the same repository.',
      '',
      'What each colleague does:',
      '  1. Save both files into their Claude config folder (~/.claude; on Windows C:\\Users\\<name>\\.claude)',
      '     and keep the file names. Or tell their Claude: "import this team list", naming the two files.',
      '  2. Ask their Claude for the status of the terms lists. The list must show "key present".',
      '',
      'Later:',
      '  - You add or remove a term: send the list file again. The key stays the same.',
      '  - Someone leaves the team: a key cannot be taken back. Start a list under a new name, add the terms',
      '    again, share it, and have everyone delete the old two files.',
    ].join('\n'),
  );
}

/** Says whether the guard would catch a text, and by which list, without repeating the text. */
async function test() {
  const lists = loadTermLists();
  (await termsGiven()).forEach((text, index) => {
    const names = lists.filter((list) => maskTerms(text, [list]).count > 0).map((list) => `${list.name} (${list.mode})`);
    console.log(`Text ${index + 1}: ${names.length ? `caught by the list ${names.join(', ')}` : 'not caught by any list'}.`);
  });
}

function importList() {
  const [listPath, keyPath] = args;
  if (!listPath || !existsSync(listPath)) fail('Name the list file to import: import <list.json> [<list.key>]');
  const list = JSON.parse(readFileSync(listPath, 'utf8'));
  if (!list.name || !Array.isArray(list.terms)) fail(`${basename(listPath)} is not a shared list.`);
  if (keyPath && !existsSync(keyPath)) fail(`The key file ${keyPath} does not exist.`);
  copyFileSync(listPath, sharedListFile(list.name));
  if (keyPath) copyFileSync(keyPath, sharedKeyFile(list.name));
  console.log(`Imported the shared list "${list.name}" with ${list.terms.length} term(s), mode ${list.mode}.`);
  if (existsSync(sharedKeyFile(list.name)) || process.env.PRIVACY_GUARD_TERMS_KEY) console.log('Its key is present. The guard applies the list from the next tool call on.');
  else console.log(`Its key is still missing, so the list is not applied yet. Save the key file as ${sharedKeyFile(list.name)}, or run import again with both files.`);
}

// --- check: would a term get in the way? -------------------------------------------------------------------

function* transcripts(dir, since) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* transcripts(path, since);
    else if (entry.name.endsWith('.jsonl') && statSync(path).mtimeMs >= since) yield path;
  }
}

const asText = (value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

/** What Claude Code sent out, and what the user wrote, in the stored sessions of the last days. */
async function history(days) {
  const calls = [];
  const prompts = [];
  for (const file of transcripts(join(configDir(), 'projects'), Date.now() - days * 86400000)) {
    for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
      const call = line.includes('"tool_use"');
      if (!call && !line.includes('"type":"user"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const content = record.message?.content;
      if (record.type === 'user' && typeof content === 'string') prompts.push(content);
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'tool_use' && isOutbound(block.name, block.input)) calls.push(asText(block.input));
        else if (block?.type === 'text' && record.type === 'user') prompts.push(block.text ?? '');
      }
    }
  }
  return { calls, prompts };
}

async function check() {
  const days = Number(option('--days')) || 30;
  const quiet = flag('--quiet');
  const named = args.length > 0;
  if (!named && listName) {
    return console.log(
      `The terms of the shared list "${listName}" cannot be read back, so they cannot be checked from the list. ` +
        'Name the terms to check: check "<term>" ... If you are not to see them, the person who added them runs this.',
    );
  }
  const lines = named ? args : readPersonal().filter(isTermLine);
  if (lines.length === 0) return console.log('There is no term to check.');
  console.log(`Reading the sessions of the last ${days} days ...`);
  const { calls, prompts } = await history(days);
  console.log(`${calls.length} call(s) that left the computer, ${prompts.length} message(s) of yours.\n`);

  lines.forEach((line, index) => {
    const term = parseTerm(line);
    const label = named ? `"${line}"` : `Term ${index + 1}`;
    if (!term) return console.log(`${label}: shorter than three letters, not usable.`);
    const list = [{ name: 'check', mode: 'everywhere', plain: [term], hashed: undefined }];
    const hits = (texts) => texts.filter((text) => maskTerms(text, list).count > 0);
    const callHits = hits(calls);
    const promptHits = hits(prompts);

    const reasons = [];
    if (callHits.length > 0) reasons.push(`it would have refused ${callHits.length} of ${calls.length} calls that left the computer`);
    if (promptHits.length > 0) reasons.push(`it stands in ${promptHits.length} of ${prompts.length} of your messages (those come back unsent in mode "everywhere")`);
    if (term.words === 1 && term.joined.length <= 6) reasons.push('it is one short word, and short words turn up inside ordinary text');
    if (term.sounds && term.joined.length <= 6) reasons.push('sound matching on a short name catches many other words');

    const verdict = callHits.length >= 2 || reasons.length >= 2 ? 'LIKELY IN THE WAY' : reasons.length === 1 ? 'MAY BE IN THE WAY' : 'no sign of trouble';
    console.log(`${label}: ${verdict}${reasons.length ? `: ${reasons.join('; ')}` : ' in this history'}.`);
    if (!quiet && named) {
      for (const text of [...callHits, ...promptHits].slice(0, 2)) {
        const masked = maskTerms(text, list).text;
        const at = masked.indexOf('[term hidden]');
        console.log(`    e.g. ...${masked.slice(Math.max(0, at - 50), at + 70).replace(/\s+/g, ' ')}...`);
      }
    }
  });
}

const commands = { add, remove, mode, status, share, import: importList, check, test };
if (!commands[command]) fail('Commands: status, add, remove, mode, check, test, share, import. See the top of this file.');
await commands[command]();
