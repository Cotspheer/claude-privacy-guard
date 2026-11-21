// The rules that find secrets and personal data in a text. Each rule is one entry in a list:
//
//   { id, kind: 'secret' | 'personal', optIn?, keywords?, find(text) -> [[start, end], ...] }
//
// A new check is a new entry. `id` is what messages name and what the settings switch on or off
// (enabledRules, disabledRules in privacy-guard.json). A rule with `optIn` is off until it is named in
// enabledRules. `keywords` (lower case) spare the work: the rule runs only on a text that holds one of them.
//
// Every caller goes through findSensitive, so a rule added here applies to tool calls, tool output, prompts,
// attached files and the text read from pictures, PDFs and Office documents alike.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadSettings } from './settings.mjs';

/** What a hidden value reads as in tool output. */
const hidden = (what) => `[${what} hidden]`;
export const SECRET_PLACEHOLDER = hidden('secret');
export const PERSONAL_PLACEHOLDER = hidden('personal data');

/** A rule from a regular expression. `group` names the capture group that holds the value; `valid` may refuse a match. */
function pattern(id, kind, regex, { group = 0, valid, keywords, optIn } = {}) {
  const flags = [...new Set(`${regex.flags}gd`)].join('');
  return {
    id,
    kind,
    keywords,
    optIn,
    find(text) {
      const spans = [];
      for (const match of text.matchAll(new RegExp(regex.source, flags))) {
        const span = match.indices[group];
        if (span && span[1] > span[0] && (!valid || valid(match[group], match))) spans.push(span);
      }
      return spans;
    },
  };
}

// ---------------------------------------------------------------------------------------------------------
// Secrets
// ---------------------------------------------------------------------------------------------------------

/** How evenly the characters of a value are spread, in bits per character. Random tokens score high. */
export function entropy(value) {
  const counts = new Map();
  for (const character of value) counts.set(character, (counts.get(character) ?? 0) + 1);
  let bits = 0;
  for (const count of counts.values()) bits -= (count / value.length) * Math.log2(count / value.length);
  return bits;
}

const PLACEHOLDER_VALUE = /^(?:x+|\*+|0+|y?our[_-].*|.*(?:example|placeholder|changeme|redacted|dummy).*)$/i;

/** Whether a value after a word such as "token" or "password" looks like a random secret, and not like a name, an id or a path. */
function looksRandom(value) {
  if (value.length < 20 || PLACEHOLDER_VALUE.test(value)) return false;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return false;
  if (!/[A-Za-z]/.test(value) || !/\d/.test(value)) return false;
  if ((value.match(/\//g) ?? []).length > 1) return false;
  const hex = /^[0-9a-f]+$/i.test(value);
  // A long run of letters of one case is a word: identifiers such as generateSessionToken2 are no secrets.
  if (!hex && /[a-z]{8,}|[A-Z]{8,}/.test(value)) return false;
  return entropy(value) >= (hex ? 3.0 : 3.8);
}

const SECRET_WORD = '(?:api[_-]?key|apikey|access[_-]?key|secret|token|passw(?:or)?d|passwd|credential|private[_-]?key|auth|bearer)';

const BUILT_IN = [
  pattern('anthropic-key', 'secret', /sk-ant-[A-Za-z0-9_-]{20,}/),
  pattern('openai-key', 'secret', /sk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}/),
  pattern('github-token', 'secret', /gh[pousr]_[A-Za-z0-9]{36,}/),
  pattern('github-fine-grained-token', 'secret', /github_pat_[A-Za-z0-9_]{50,}/),
  pattern('aws-access-key-id', 'secret', /(?:AKIA|ASIA)[0-9A-Z]{16}\b/),
  pattern('google-api-key', 'secret', /AIza[0-9A-Za-z_-]{35}/),
  pattern('slack-token', 'secret', /xox[abprs]-[A-Za-z0-9-]{10,}/),
  pattern('stripe-live-key', 'secret', /[sr]k_live_[A-Za-z0-9]{20,}/),
  pattern('npm-token', 'secret', /npm_[A-Za-z0-9]{36}/),
  pattern('json-web-token', 'secret', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/),
  pattern('private-key', 'secret', /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/),
  // The password of an address such as postgres://user:password@host. The rest of the address stays readable.
  pattern('password-in-url', 'secret', /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s:/@'"]{0,64}:([^\s@/'"]{3,128})@[\w.-]+/i, {
    group: 1,
    keywords: ['://'],
    valid: (value) => !/^(?:password|passwd|pass|secret|pw|\*+|x+|<.*>|\$\{?.*|%.*|\[.*\])$/i.test(value),
  }),
  // A random-looking value right after a word such as "token" or "api_key". Never by randomness alone, so
  // commit ids, hashes and UUIDs without such a word in front pass.
  pattern(
    'keyword-secret',
    'secret',
    new RegExp(`(?<![A-Za-z0-9])${SECRET_WORD}[A-Za-z0-9_-]{0,20}["'\`]?(?:[ \\t]*(?::=|=>|[:=])[ \\t]*|[ \\t]+(?:is|are|was)[ \\t]+)["'\`]?([A-Za-z0-9+/_=-]{20,256})(?![A-Za-z0-9+/_=.(\\[-])`, 'i'),
    { group: 1, valid: looksRandom, keywords: ['key', 'secret', 'token', 'passw', 'credential', 'auth', 'bearer'] },
  ),
];

/**
 * The rules converted from gitleaks (data/gitleaks-rules.json, see NOTICE), as "gl-<name>". Each names its
 * keywords, the group that holds the secret, and for some the entropy below which a match is no secret.
 */
function gitleaksRules() {
  // The plugin keeps the data next to scripts/; a repository install keeps it below its copy of the scripts.
  const here = dirname(fileURLToPath(import.meta.url));
  const file = [join(here, '..', 'data', 'gitleaks-rules.json'), join(here, 'data', 'gitleaks-rules.json')].find((path) => existsSync(path));
  if (!file) return [];
  let data;
  try {
    data = JSON.parse(readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
  return data.map((rule) => {
    let regex;
    return {
      id: `gl-${rule.name}`,
      kind: 'secret',
      keywords: rule.keywords,
      find(text) {
        regex ??= new RegExp(rule.regex, [...new Set(`${rule.flags ?? ''}gd`)].join(''));
        const spans = [];
        for (const match of text.matchAll(regex)) {
          // The secret is the group the rule names, else the first group that matched, else the whole match.
          const group = rule.secretGroup ?? (rule.secretOnly ? match.findIndex((part, index) => index > 0 && part !== undefined) : 0);
          const span = match.indices[group > 0 ? group : 0];
          const value = match[group > 0 ? group : 0];
          if (span && value && (rule.entropy === undefined || entropy(value) >= rule.entropy)) spans.push(span);
        }
        return spans;
      },
    };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Personal data. Off until named in enabledRules: a guard for code should not stop over an order number.
// Each check validates what it finds (a checksum, a numbering plan), so a row of digits alone is no match.
// ---------------------------------------------------------------------------------------------------------

const digitsOf = (value) => value.replace(/\D/g, '');

function luhn(digits) {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) digit = digit * 2 > 9 ? digit * 2 - 9 : digit * 2;
    sum += digit;
  }
  return sum % 10 === 0;
}

/** Card numbers by issuer: the leading digits and the lengths each issuer uses. */
const CARD_ISSUERS = [
  [/^4/, [16, 19]], // Visa (its 13-digit numbers are long out of use, and a product barcode has 13 digits too)
  [/^(?:5[1-5]|2(?:2[2-9]|[3-6]|7[01]|720))/, [16]], // Mastercard
  [/^3[47]/, [15]], // American Express
  [/^(?:6011|65|64[4-9])/, [16, 19]], // Discover
  [/^35(?:2[89]|[3-8])/, [16, 19]], // JCB
  [/^(?:30[0-5]|36|38)/, [14]], // Diners Club
];

function validCard(value) {
  const digits = digitsOf(value);
  if (/^(\d)\1+$/.test(digits)) return false;
  return CARD_ISSUERS.some(([prefix, lengths]) => prefix.test(digits) && lengths.includes(digits.length)) && luhn(digits);
}

/** The lengths of the IBANs of the countries met most often; other countries pass by checksum alone. */
const IBAN_LENGTH = { CH: 21, LI: 21, DE: 22, AT: 20, FR: 27, IT: 27, ES: 24, NL: 18, BE: 16, LU: 20, GB: 22, IE: 22, PT: 25, DK: 18, SE: 24, NO: 15, FI: 18, PL: 28 };

function validIban(value) {
  const iban = value.replace(/\s/g, '').toUpperCase();
  if (iban.length < 15 || iban.length > 34) return false;
  const expected = IBAN_LENGTH[iban.slice(0, 2)];
  if (expected && iban.length !== expected) return false;
  // The checksum of ISO 13616: the first four characters moved to the end, letters read as 10 to 35, modulo 97.
  const moved = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of moved) {
    const number = character >= 'A' ? character.charCodeAt(0) - 55 : Number(character);
    remainder = (remainder * (number > 9 ? 100 : 10) + number) % 97;
  }
  return remainder === 1;
}

/** The Swiss social security number (AHV-Nr., 756.xxxx.xxxx.xx) carries the check digit of an EAN-13. */
function validAhv(value) {
  const digits = digitsOf(value);
  if (digits.length !== 13) return false;
  let sum = 0;
  for (let i = 0; i < 12; i++) sum += Number(digits[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (sum % 10)) % 10 === Number(digits[12]);
}

function validPhone(value) {
  const digits = digitsOf(value);
  if (value.trim().startsWith('+')) return digits.length >= 9 && digits.length <= 15;
  // Without a country code: a Swiss or German national number (0xx xxx xx xx), or a North American one.
  if (digits.startsWith('0')) return digits.length >= 10 && digits.length <= 12 && !digits.startsWith('00');
  return digits.length === 10 && /^[2-9]\d\d[2-9]/.test(digits) && !/^(\d)\1+$/.test(digits);
}

const PERSONAL = [
  pattern('payment-card', 'personal', /(?<![\d.-])\d(?:[ -]?\d){12,18}(?!\d|[.-]\d)/, { valid: validCard, optIn: true }),
  pattern('iban', 'personal', /(?<![A-Za-z0-9])[A-Za-z]{2}\d{2}(?: ?[A-Za-z0-9]{4}){2,7}(?: ?[A-Za-z0-9]{1,3})?(?![A-Za-z0-9])/, { valid: validIban, optIn: true }),
  pattern('ch-ahv-number', 'personal', /(?<![\d.])756[. ]?\d{4}[. ]?\d{4}[. ]?\d{2}(?!\d|\.\d)/, { valid: validAhv, optIn: true, keywords: ['756'] }),
  pattern('us-ssn', 'personal', /(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/, { optIn: true }),
  pattern(
    'phone-number',
    'personal',
    // With a country code (+41 44 668 18 00), a national number with separators (044 668 18 00), or the
    // North American forms ((415) 555-2671, 415-555-2671). A bare row of digits is left alone.
    /(?<![\w.+-])(?:\+\d{1,3}[ .-]?(?:\(0\)[ ]?)?\d{1,4}(?:[ .-]?\d{2,4}){1,4}|0\d{1,4}[ /-]\d{2,4}(?:[ -]\d{2,4}){1,3}|\(\d{3}\) ?\d{3}-\d{4}|\d{3}-\d{3}-\d{4})(?![\w-])/,
    { valid: validPhone, optIn: true },
  ),
];

// ---------------------------------------------------------------------------------------------------------

let active;

/**
 * The rules in force: the built-in ones and the gitleaks ones, plus the personal ones named in enabledRules
 * ("personal" there switches all of them on).
 */
export function activeRules() {
  if (active) return active;
  const settings = loadSettings();
  const off = new Set(settings.disabledRules);
  const on = new Set(settings.enabledRules);
  active = [...BUILT_IN, ...PERSONAL, ...gitleaksRules()].filter((rule) => !off.has(rule.id) && (!rule.optIn || on.has(rule.id) || (rule.kind === 'personal' && on.has('personal'))));
  return active;
}

/** Every rule's id, kind and whether it has to be switched on, for the docs and the audit. */
export function allRules() {
  return [...BUILT_IN, ...PERSONAL, ...gitleaksRules()].map(({ id, kind, optIn }) => ({ id, kind, optIn: Boolean(optIn) }));
}

let allowed;

function isAllowedValue(value) {
  if (!allowed) {
    const settings = loadSettings();
    const patterns = [];
    for (const source of settings.allowedPatterns) {
      try {
        patterns.push(new RegExp(`^(?:${source})$`));
      } catch {
        // A pattern that does not compile is no pattern.
      }
    }
    allowed = { values: new Set(settings.allowedValues), patterns };
  }
  return allowed.values.has(value) || allowed.patterns.some((regex) => regex.test(value));
}

/**
 * Where the rules find something in the text: [{ start, end, rule, kind }], in order and without overlaps.
 * Two findings that overlap become one, under the rule that starts first.
 */
export function findSensitive(text) {
  if (typeof text !== 'string' || text.length < 8) return [];
  let lowered;
  const found = [];
  for (const rule of activeRules()) {
    if (rule.keywords?.length) {
      lowered ??= text.toLowerCase();
      if (!rule.keywords.some((keyword) => lowered.includes(keyword))) continue;
    }
    let spans;
    try {
      spans = rule.find(text);
    } catch {
      continue;
    }
    for (const [start, end] of spans) {
      const value = text.slice(start, end);
      // What is hidden already is not found again, and what the user allowed is no finding.
      if (value.includes(' hidden]') || isAllowedValue(value)) continue;
      found.push({ start, end, rule: rule.id, kind: rule.kind });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const kept = [];
  for (const item of found) {
    const last = kept[kept.length - 1];
    if (last && item.start < last.end) {
      if (item.end > last.end) last.end = item.end;
      continue;
    }
    kept.push(item);
  }
  return kept;
}

/**
 * The text with what the rules found hidden: { text, count, secrets, personal, rules }. `rules` are the ids
 * of the rules that found something, for a message that says which rule to look at.
 */
export function maskSensitive(text) {
  const found = findSensitive(text);
  if (found.length === 0) return { text, count: 0, secrets: 0, personal: 0, rules: [] };
  let masked = '';
  let position = 0;
  let personal = 0;
  for (const item of found) {
    masked += text.slice(position, item.start) + (item.kind === 'personal' ? PERSONAL_PLACEHOLDER : SECRET_PLACEHOLDER);
    position = item.end;
    if (item.kind === 'personal') personal++;
  }
  return { text: masked + text.slice(position), count: found.length, secrets: found.length - personal, personal, rules: [...new Set(found.map((item) => item.rule))] };
}
