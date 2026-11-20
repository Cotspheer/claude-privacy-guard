// Shared by the hooks: what counts as an email address, which ones are allowed, and how they are hidden.
//
// Everything here is generic (the shape of an address), so no file of this repository ever names a private one.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** "@" and the spellings that would slip past a plain search: URL, JSON and HTML escapes. */
const AT = '(?:@|%40|\\\\u0040|&#64;|&#x40;|&commat;)';
const HAS_AT = new RegExp(AT, 'i');
// The lengths are bounded (64 for the part before the "@", 253 for the domain) so that a long run of letters,
// such as a minified file or encoded data, cannot make the search slow.
const EMAIL = new RegExp(`([A-Za-z0-9][A-Za-z0-9._%+-]{0,63}?)${AT}([A-Za-z0-9.-]{1,251}\\.[A-Za-z]{2,})`, 'gi');

/** What a hidden address reads as in tool output. */
export const PLACEHOLDER = '[email hidden]';

const ALLOWED_ADDRESSES = new Set(['noreply@anthropic.com']);
const ALLOWED_DOMAINS = ['example.com', 'example.org', 'example.net', 'users.noreply.github.com'];
/** Top-level domains reserved for tests and local networks (RFC 2606, RFC 6762). */
const ALLOWED_TLDS = new Set(['test', 'example', 'invalid', 'localhost', 'local']);
/** File extensions that are no top-level domain: `logo@2x.png` is a file name. */
const FILE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg', 'avif', 'ico', 'json', 'js', 'ts', 'tsx', 'jsx', 'css', 'txt', 'pdf']);

/** The folder Claude Code keeps its configuration in. */
export function configDir() {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/** The user's own allow file. It lives outside the plugin, so plugin updates leave it alone. */
export function userAllowFile() {
  return join(configDir(), 'email-guard.allow.txt');
}

/**
 * Where the allow list is read from. EMAIL_GUARD_ALLOW_FILE names the one file to use. Without it: the user's
 * own file, and one next to these scripts (a repository's shared entries).
 */
function allowFiles() {
  if (process.env.EMAIL_GUARD_ALLOW_FILE) return [process.env.EMAIL_GUARD_ALLOW_FILE];
  return [userAllowFile(), join(dirname(fileURLToPath(import.meta.url)), 'email-guard.allow.txt')];
}

export function loadAllow() {
  const addresses = new Set();
  const domains = [];
  for (const file of allowFiles()) {
    if (!existsSync(file)) continue;
    for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
      const line = raw.trim().toLowerCase();
      if (!line || line.startsWith('#')) continue;
      if (line.startsWith('@')) domains.push(line.slice(1));
      else addresses.add(line);
    }
  }
  return { addresses, domains };
}

function inDomain(domain, allowed) {
  return domain === allowed || domain.endsWith(`.${allowed}`);
}

/** Whether the match is an address at all, and not a file name, a package version, an SSH remote or URL credentials. */
function isAddress(text, index, local, domain) {
  const labels = domain.split('.');
  if (labels.some((label) => label === '')) return false;
  if (FILE_EXTENSIONS.has(labels.at(-1).toLowerCase())) return false;
  // `icon@2x.<hash>.webp`, `pkg@1.0.0-beta.rc`
  if (/^\d+x$/i.test(labels[0]) || /^\d+\.\d+\.\d+/.test(domain)) return false;
  // `git@github.com:owner/repo.git`
  if (local === 'git') return false;
  // `scheme://user:password@host.tld`: the part between "://" and "@" has no "/", "?" or "#".
  const before = text.slice(0, index + local.length);
  const token = before.slice(Math.max(before.lastIndexOf(' '), before.lastIndexOf('"'), before.lastIndexOf("'"), before.lastIndexOf('\n')) + 1);
  const scheme = token.lastIndexOf('://');
  if (scheme >= 0 && !/[/?#]/.test(token.slice(scheme + 3))) return false;
  return true;
}

function isAllowed(local, domain, allow) {
  const address = `${local}@${domain}`.toLowerCase();
  const lowerDomain = domain.toLowerCase();
  if (ALLOWED_ADDRESSES.has(address) || allow.addresses.has(address)) return true;
  if (ALLOWED_TLDS.has(lowerDomain.split('.').at(-1))) return true;
  return [...ALLOWED_DOMAINS, ...allow.domains].some((allowed) => inDomain(lowerDomain, allowed));
}

/** Replaces every address that is not allowed with the placeholder. */
export function mask(text, allow) {
  if (!HAS_AT.test(text)) return { text, count: 0 };
  let count = 0;
  const masked = text.replace(EMAIL, (whole, local, domain, index) => {
    if (!isAddress(text, index, local, domain) || isAllowed(local, domain, allow)) return whole;
    count++;
    return PLACEHOLDER;
  });
  return { text: masked, count };
}

/** Number of addresses in the text that are not allowed. */
export function countBlocked(text, allow) {
  return mask(text, allow).count;
}

/** The domains of the addresses in the text that are not allowed, for reports that must not show an address. */
export function blockedDomains(text, allow) {
  const domains = [];
  if (!HAS_AT.test(text)) return domains;
  for (const match of text.matchAll(EMAIL)) {
    const [, local, domain] = match;
    if (isAddress(text, match.index, local, domain) && !isAllowed(local, domain, allow)) domains.push(domain.toLowerCase());
  }
  return domains;
}

/** Reads a hook's JSON input. Ends the process with exit code 1 (a non-blocking error) when it is unreadable. */
export async function readHookInput(name) {
  let data = '';
  for await (const chunk of process.stdin) data += chunk;
  try {
    return JSON.parse(data);
  } catch (error) {
    console.error(`${name}: could not read the hook input (${error.message})`);
    process.exit(1);
  }
}
