// Secrets and confidential terms: what counts as one, how they are found and hidden, and which tool calls
// leave the computer.

import { createHmac } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir, countBlocked } from './lib.mjs';
import { PERSONAL_PLACEHOLDER, SECRET_PLACEHOLDER, findSensitive, maskSensitive } from './rules.mjs';

export { PERSONAL_PLACEHOLDER, SECRET_PLACEHOLDER };

export const TERM_PLACEHOLDER = '[term hidden]';

/** Hides what the rules of rules.mjs find: secrets, and personal data where its rules are switched on. */
export const maskSecrets = maskSensitive;

/**
 * What a text holds that must not reach Claude, as phrases such as "2 email address(es)" and
 * "1 secret(s) (rule github-token)". An empty list means nothing was found.
 */
export function findingsIn(text, allow, lists) {
  const found = findSensitive(text);
  const part = (kind, label) => {
    const rules = found.filter((item) => item.kind === kind).map((item) => item.rule);
    return [rules.length, `${label} (rule ${[...new Set(rules)].join(', ')})`];
  };
  return [[countBlocked(text, allow), 'email address(es)'], part('secret', 'secret(s)'), part('personal', 'personal data value(s)'), [maskTerms(text, lists, true).count, 'confidential term(s)']]
    .filter(([count]) => count > 0)
    .map(([count, kind]) => `${count} ${kind}`);
}

// ---------------------------------------------------------------------------------------------------------
// Confidential terms
//
// Two kinds of list exist side by side:
//   - the personal list, plain text, one term per line: privacy-guard.terms.txt
//   - shared lists, which hold keyed hashes instead of terms: privacy-guard.terms.<name>.json, each with
//     its key in privacy-guard.terms.<name>.key. The list can travel anywhere; without the key it says nothing.
// ---------------------------------------------------------------------------------------------------------

/** The folder the lists and keys live in: the Claude config folder, or the folder of PRIVACY_GUARD_TERMS_FILE. */
export function termsDir() {
  return process.env.PRIVACY_GUARD_TERMS_FILE ? dirname(process.env.PRIVACY_GUARD_TERMS_FILE) : configDir();
}

/** The user's personal list. */
export function termsFile() {
  return process.env.PRIVACY_GUARD_TERMS_FILE ?? join(configDir(), 'privacy-guard.terms.txt');
}

export const sharedListFile = (name, dir = termsDir()) => join(dir, `privacy-guard.terms.${name}.json`);
export const sharedKeyFile = (name) => join(termsDir(), `privacy-guard.terms.${name}.key`);

const UMLAUTS = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

/** Lower case, German umlauts written out ("ü" as "ue"), other accents dropped: the form in which terms and text are compared. */
function normalise(text) {
  return text
    .toLowerCase()
    .normalize('NFC')
    .replace(/[äöüß]/g, (letter) => UMLAUTS[letter])
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const WORD = /[\p{L}\p{N}]+/gu;

/** Typing mistakes a term may hold and still match: none in short terms, one from 5 letters, two from 9. */
function tolerance(length) {
  return length < 5 ? 0 : length < 9 ? 1 : 2;
}

/** How a word sounds by the Cologne phonetics (Kölner Phonetik), which are made for German names. */
function cologne(word) {
  const letters = word.replace(/[^a-z]/g, '');
  let code = '';
  for (let i = 0; i < letters.length; i++) {
    const letter = letters[i];
    const previous = letters[i - 1] ?? ' ';
    const next = letters[i + 1] ?? ' ';
    let digit;
    if ('aeijouy'.includes(letter)) digit = '0';
    else if (letter === 'h') continue;
    else if (letter === 'b') digit = '1';
    else if (letter === 'p') digit = next === 'h' ? '3' : '1';
    else if (letter === 'd' || letter === 't') digit = 'csz'.includes(next) ? '8' : '2';
    else if ('fvw'.includes(letter)) digit = '3';
    else if ('gkq'.includes(letter)) digit = '4';
    else if (letter === 'c') {
      if (i === 0) digit = 'ahkloqrux'.includes(next) ? '4' : '8';
      else digit = 'sz'.includes(previous) || !'ahkoqux'.includes(next) ? '8' : '4';
    } else if (letter === 'x') digit = 'ckq'.includes(previous) ? '8' : '48';
    else if (letter === 'l') digit = '5';
    else if (letter === 'm' || letter === 'n') digit = '6';
    else if (letter === 'r') digit = '7';
    else digit = '8'; // s, z
    code += digit;
  }
  const collapsed = code.replace(/(.)\1+/g, '$1');
  return collapsed.slice(0, 1) + collapsed.slice(1).replace(/0/g, '');
}

/** How a word sounds by Metaphone, which follows English spelling: silent letters, "ph", "th", "gh", "kn". */
function metaphone(word) {
  let w = word.replace(/[^a-z]/g, '');
  if (/^(?:ae|gn|kn|pn|wr)/.test(w)) w = w.slice(1);
  else if (w.startsWith('x')) w = `s${w.slice(1)}`;
  else if (w.startsWith('wh')) w = `w${w.slice(2)}`;
  const vowel = (letter) => letter !== ' ' && 'aeiou'.includes(letter);
  let code = '';
  for (let i = 0; i < w.length; i++) {
    const letter = w[i];
    const previous = w[i - 1] ?? ' ';
    const next = w[i + 1] ?? ' ';
    const afterNext = w[i + 2] ?? ' ';
    if (letter === previous && letter !== 'c') continue;
    switch (letter) {
      case 'a':
      case 'e':
      case 'i':
      case 'o':
      case 'u':
        if (i === 0) code += letter;
        break;
      case 'b':
        if (!(previous === 'm' && i === w.length - 1)) code += 'b';
        break;
      case 'c':
        if (next === 'i' && afterNext === 'a') code += 'x';
        else if (next === 'h') code += previous === 's' ? 'k' : 'x';
        else if ('iey'.includes(next)) code += previous === 's' ? '' : 's';
        else code += 'k';
        break;
      case 'd':
        code += next === 'g' && 'eyi'.includes(afterNext) ? 'j' : 't';
        break;
      case 'g':
        if (next === 'h' && !vowel(afterNext)) break;
        if (next === 'n' && (i + 2 === w.length || w.slice(i + 2) === 'ed')) break;
        if (previous === 'd' && 'eyi'.includes(next)) break;
        code += 'iey'.includes(next) ? 'j' : 'k';
        break;
      case 'h':
        if (vowel(next) && !'cgpst'.includes(previous)) code += 'h';
        break;
      case 'k':
        if (previous !== 'c') code += 'k';
        break;
      case 'p':
        code += next === 'h' ? 'f' : 'p';
        break;
      case 'q':
        code += 'k';
        break;
      case 's':
        code += next === 'h' || (next === 'i' && 'oa'.includes(afterNext)) ? 'x' : 's';
        break;
      case 't':
        if (next === 'i' && 'oa'.includes(afterNext)) code += 'x';
        else if (next === 'h') code += '0';
        else if (!(next === 'c' && afterNext === 'h')) code += 't';
        break;
      case 'v':
        code += 'f';
        break;
      case 'w':
      case 'y':
        if (vowel(next)) code += letter;
        break;
      case 'x':
        code += 'ks';
        break;
      case 'z':
        code += 's';
        break;
      default:
        code += letter; // f, j, l, m, n, r
    }
  }
  return code.replace(/(.)\1+/g, '$1');
}

/**
 * The sound codes of a word, by German and by English spelling rules. A code of a single sound is left out:
 * it would match half the dictionary ("Lee" and "law" share one).
 */
function soundsOf(word) {
  return [`c${cologne(word)}`, `m${metaphone(word)}`].filter((code) => code.length >= 3);
}

/**
 * Sound codes ignore vowels, so "Meier" and "more" share one. A sound match therefore also has to be close in
 * spelling: at most this many letters apart ("Catherine" and "Kathryn" are four apart, "Meier" and "more" three).
 */
function soundSlack(length) {
  return Math.max(1, Math.floor(length * 0.45));
}

/** A term as the lists hold it, from a line such as "Project Falcon" or "~Meier" (the "~" asks for sound matching). */
export function parseTerm(line, bySound = false) {
  const text = line.trim();
  const sound = bySound || text.startsWith('~');
  const words = normalise(text.replace(/^~/, '')).match(WORD) ?? [];
  const joined = words.join('');
  if (joined.length < 3) return undefined;
  return { joined, words: words.length, slack: tolerance(joined.length), sounds: sound ? soundsOf(joined) : undefined };
}

const hashOf = (key, token) => createHmac('sha256', key).update(token).digest('base64').slice(0, 22);

/** The word with one letter left out, at every position. */
function* withoutOneLetter(word) {
  for (let i = 0; i < word.length; i++) {
    if (word[i] !== word[i - 1]) yield word.slice(0, i) + word.slice(i + 1);
  }
}

/**
 * A term as a shared list holds it: hashes only. A typing mistake is caught through the term with one letter
 * left out: a word and a term that differ by one mistake share such a shortened form.
 */
export function hashTerm(term, key) {
  const fuzzy = term.joined.length >= 5;
  const tokens = fuzzy ? [`t:${term.joined}`, ...[...withoutOneLetter(term.joined)].map((short) => `t:${short}`)] : [`x:${term.joined}`];
  // A hash cannot be compared letter by letter, so a sound match is tied to words of about the term's length
  // instead, and to codes of at least three sounds.
  const reach = soundSlack(term.joined.length);
  for (const sound of (term.sounds ?? []).filter((code) => code.length >= 4)) {
    for (let length = term.joined.length - reach; length <= term.joined.length + reach; length++) tokens.push(`s:${term.words}:${length}:${sound}`);
  }
  return {
    id: hashOf(key, `id:${term.joined}`),
    length: term.joined.length,
    fuzzy,
    sound: Boolean(term.sounds?.length),
    hashes: tokens.map((token) => hashOf(key, token)),
  };
}

function readKey(name) {
  const file = sharedKeyFile(name);
  const hex = existsSync(file) ? readFileSync(file, 'utf8').trim() : (process.env.PRIVACY_GUARD_TERMS_KEY ?? '');
  return /^[0-9a-f]{32,}$/i.test(hex) ? Buffer.from(hex, 'hex') : undefined;
}

function loadSharedList(file) {
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
  const key = readKey(data.name);
  if (!key || !Array.isArray(data.terms)) return undefined;
  const lengths = new Set();
  for (const term of data.terms) for (const length of term.fuzzy ? [term.length - 1, term.length, term.length + 1] : [term.length]) lengths.add(length);
  return {
    name: data.name,
    mode: data.mode === 'everywhere' ? 'everywhere' : 'outbound',
    plain: [],
    hashed: {
      key,
      lengths,
      longest: Math.max(0, ...data.terms.map((term) => term.length)),
      sound: data.terms.some((term) => term.sound),
      hashes: new Set(data.terms.flatMap((term) => term.hashes)),
    },
  };
}

/**
 * Every list that applies, as { name, mode, plain, hashed }. Mode "outbound" keeps a list's terms out of calls
 * that leave the computer; "everywhere" keeps them out of prompts, every tool call and tool output too.
 */
export function loadTermLists() {
  const lists = [];
  const personal = termsFile();
  if (existsSync(personal)) {
    const list = { name: 'personal', mode: 'outbound', plain: [], hashed: undefined };
    for (const raw of readFileSync(personal, 'utf8').split(/\r?\n/)) {
      const line = raw.trim();
      const setting = /^#\s*mode:\s*(outbound|everywhere)\b/i.exec(line);
      if (setting) list.mode = setting[1].toLowerCase();
      if (!line || line.startsWith('#')) continue;
      const term = parseTerm(line);
      if (term) list.plain.push(term);
    }
    lists.push(list);
  }
  // Shared lists: the user's own folder, and next to these scripts for a list a repository carries.
  for (const dir of new Set([termsDir(), dirname(fileURLToPath(import.meta.url))])) {
    let names = [];
    try {
      names = readdirSync(dir).filter((name) => /^privacy-guard\.terms\..+\.json$/.test(name));
    } catch {}
    for (const name of names) {
      const list = loadSharedList(join(dir, name));
      if (list) lists.push(list);
    }
  }
  return lists;
}

/** Whether two strings differ by at most `max` typing mistakes (a wrong, missing, extra or swapped letter). */
function within(a, b, max) {
  if (a === b) return true;
  if (max === 0 || Math.abs(a.length - b.length) > max) return false;
  let before = null;
  let previous = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const current = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost);
      if (before && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) value = Math.min(value, before[j - 2] + 1);
      current.push(value);
      if (value < best) best = value;
    }
    if (best > max) return false;
    before = previous;
    previous = current;
  }
  return previous[b.length] <= max;
}

/** Texts above these sizes are compared exactly only, to keep a hook fast on large tool output. */
const FUZZY_LIMIT = 200000;
const HASHED_FUZZY_LIMIT = 60000;

function matchesHashed(list, candidate, size, fuzzy, sounds) {
  const has = (token) => list.hashes.has(hashOf(list.key, token));
  if (list.lengths.has(candidate.length)) {
    if (has(`x:${candidate}`) || has(`t:${candidate}`)) return true;
    if (fuzzy && candidate.length >= 5) {
      for (const short of withoutOneLetter(candidate)) if (has(`t:${short}`)) return true;
    }
  }
  return list.sound && candidate.length >= 3 && candidate.length <= list.longest * 1.5 && sounds().some((sound) => sound.length >= 4 && has(`s:${size}:${candidate.length}:${sound}`));
}

/**
 * Where the lists' terms stand in the text, as [start, end) spans. A term matches across spaces, hyphens and
 * case ("Project Falcon", "project-falcon", "ProjectFalcon"), with typing mistakes, by sound where it is
 * marked, and (personal list only) inside a longer word.
 */
function termSpans(text, lists) {
  const plain = lists.flatMap((list) => list.plain);
  const hashed = lists.filter((list) => list.hashed).map((list) => list.hashed);
  if (plain.length === 0 && hashed.length === 0) return [];
  const tokens = [...text.matchAll(WORD)].map((match) => ({ start: match.index, end: match.index + match[0].length, word: normalise(match[0]) }));
  const fuzzy = text.length <= FUZZY_LIMIT;
  const hashedFuzzy = text.length <= HASHED_FUZZY_LIMIT;
  const verdicts = new Map();
  // A term marked to match by sound does so only against as many words as it has itself.
  const matches = (candidate, size) => {
    const key = `${size}:${candidate}`;
    let verdict = verdicts.get(key);
    if (verdict === undefined) {
      let codes;
      const sounds = () => (codes ??= soundsOf(candidate));
      verdict =
        plain.some(
          (term) =>
            within(candidate, term.joined, fuzzy ? term.slack : 0) ||
            (size === 1 && term.joined.length >= 6 && candidate.includes(term.joined)) ||
            (term.sounds !== undefined &&
              size === term.words &&
              candidate.length >= 3 &&
              sounds().some((sound) => term.sounds.includes(sound)) &&
              within(candidate, term.joined, soundSlack(term.joined.length))),
        ) || hashed.some((list) => matchesHashed(list, candidate, size, hashedFuzzy, sounds));
      verdicts.set(key, verdict);
    }
    return verdict;
  };
  const longest = Math.max(4, ...plain.map((term) => term.words + 1));
  const spans = [];
  for (let i = 0; i < tokens.length; i++) {
    let joined = '';
    for (let size = 1; size <= longest && i + size <= tokens.length; size++) {
      joined += tokens[i + size - 1].word;
      if (!matches(joined, size)) continue;
      // The tolerance for typing mistakes must not pull a neighbouring word in: if the words after the first
      // one match on their own, the span starts there.
      const withoutFirst = joined.slice(tokens[i].word.length);
      if (size === 1 || !matches(withoutFirst, size - 1)) spans.push([tokens[i].start, tokens[i + size - 1].end]);
      break;
    }
  }
  return spans;
}

/**
 * Hides the lists' terms in the text. With `everywhereOnly`, only the lists in mode "everywhere" count: that is
 * the check for prompts, tool output and calls that stay on the computer.
 */
export function maskTerms(text, lists, everywhereOnly = false) {
  const spans = termSpans(text, everywhereOnly ? lists.filter((list) => list.mode === 'everywhere') : lists);
  if (spans.length === 0) return { text, count: 0 };
  let masked = '';
  let position = 0;
  let count = 0;
  for (const [start, end] of spans) {
    if (start < position) continue;
    masked += text.slice(position, start) + TERM_PLACEHOLDER;
    position = end;
    count++;
  }
  return { text: masked + text.slice(position), count };
}

const NETWORK_COMMAND =
  /\b(?:curl|wget|iwr|irm|Invoke-WebRequest|Invoke-RestMethod|Send-MailMessage|nc|ncat|telnet|ftp|sftp|scp|ssh|rsync)\b|\bgit\s+push\b|\bgh\s+(?:api|gist|issue|pr|release|repo)\b|\bnpm\s+publish\b/i;

/** Whether a tool call sends its input somewhere else: the web tools, every MCP tool, and shell commands that call out. */
export function isOutbound(toolName, input) {
  if (toolName === 'WebSearch' || toolName === 'WebFetch' || String(toolName).startsWith('mcp__')) return true;
  if (toolName === 'Bash' || toolName === 'PowerShell') return NETWORK_COMMAND.test(typeof input?.command === 'string' ? input.command : '');
  return false;
}
