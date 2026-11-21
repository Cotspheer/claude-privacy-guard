// Files that hold credentials, and what the guard does about them.
//
// Two kinds are told apart:
//   "key"     a private key, a keystore or a token store (id_rsa, *.pem, .aws/credentials, .git-credentials).
//             Nothing in it is of use to Claude, so reading it is refused.
//   "values"  a file of NAME=value lines (.env, .npmrc). Claude may read it, and sees the names with the
//             values hidden: enough to work on the configuration, and no value reaches the context.
//
// The same hiding is applied to the output of a command that names such a file, and to a dump of the
// environment (env, printenv), where only the names that sound like a secret lose their value.

import { loadSettings } from './settings.mjs';
import { SECRET_PLACEHOLDER } from './rules.mjs';

const TEMPLATE = /\.(?:example|sample|template|dist|defaults?)(?:\.[a-z0-9]+)?$/;
const KEY_NAME = [
  /^id_(?:rsa|dsa|ecdsa|ed25519)(?!.*\.pub$)/,
  /\.(?:pem|key|p12|pfx|jks|keystore|ppk)$/,
  /^[._]netrc$/,
  /^\.git-credentials$/,
  /^\.pgpass$/,
  /^\.htpasswd$/,
  /^service[-_]account.*\.json$/,
];
const KEY_PATH = [/(?:^|\/)\.aws\/credentials$/, /(?:^|\/)\.docker\/config\.json$/, /(?:^|\/)\.kube\/config$/, /(?:^|\/)\.config\/gh\/hosts\.yml$/];
const VALUES_NAME = [/^\.env(?:\..+)?$/, /^[\w-]+\.env$/, /^\.npmrc$/, /^\.pypirc$/];

function globToRegExp(glob) {
  const body = glob
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .toLowerCase()
    .replace(/[.+^${}()|[\]]/g, '\\$&')
    .replace(/\*\*\/?/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*');
  // A pattern without "/" names a file wherever it lies; one with "/" names the end of a path.
  return new RegExp(`(?:^|/)${body}$`);
}

/** "key", "values" or undefined for a path. Templates (.env.example) and the user's allowed patterns pass. */
export function credentialKind(path) {
  if (typeof path !== 'string' || !path) return undefined;
  const settings = loadSettings();
  if (settings.credentialFiles === 'off') return undefined;
  const full = path.replace(/\\/g, '/').replace(/^['"]|['"]$/g, '').toLowerCase();
  const name = full.slice(full.lastIndexOf('/') + 1);
  if (!name || TEMPLATE.test(name)) return undefined;
  const kind = KEY_NAME.some((pattern) => pattern.test(name)) || KEY_PATH.some((pattern) => pattern.test(full)) ? 'key' : VALUES_NAME.some((pattern) => pattern.test(name)) ? 'values' : undefined;
  if (kind && settings.credentialFilesAllowed.some((glob) => globToRegExp(glob).test(full))) return undefined;
  return kind;
}

const words = (text) => text.split(/[\s'"()<>|;&`$=,{}]+/).filter(Boolean);

/** Commands that print what a file holds, and interpreters that can. */
const PRINTERS = new Set([
  'cat', 'type', 'get-content', 'gc', 'head', 'tail', 'less', 'more', 'bat', 'nl', 'tac', 'grep', 'egrep', 'fgrep', 'rg', 'findstr', 'select-string', 'sls',
  'sed', 'awk', 'cut', 'sort', 'uniq', 'tee', 'base64', 'xxd', 'od', 'hexdump', 'strings', 'certutil', 'format-hex',
  'python', 'python3', 'py', 'node', 'ruby', 'perl', 'php', 'pwsh', 'powershell', 'bash', 'sh', 'zsh',
]);

/** The key files a shell command would print, by name. Using a key (ssh -i, chmod, cp, git) is left alone. */
export function keyFilesPrinted(command) {
  const printed = [];
  for (const segment of command.split(/\||;|&&?|\n|\$\(|`/)) {
    const parts = words(segment).filter((word) => !/^(?:sudo|command|exec)$/.test(word));
    const verb = (parts[0] ?? '').replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.exe$/, '');
    const keys = parts.slice(1).filter((word) => credentialKind(word) === 'key');
    if (keys.length > 0 && PRINTERS.has(verb)) printed.push(...keys);
    for (const match of segment.matchAll(/<\s*(["']?)([^\s"'<>|;&]+)\1/g)) if (credentialKind(match[2]) === 'key') printed.push(match[2]);
  }
  return [...new Set(printed)];
}

/** Whether a shell command names a file of NAME=value lines. */
export function namesValuesFile(command) {
  return words(command).some((word) => credentialKind(word) === 'values');
}

const DUMP = [
  /^(?:env|printenv)(?:\s+-\S+)*\s*$/i,
  /^printenv\b/i,
  /^(?:export|declare|typeset)(?:\s+-[a-z]+)?\s*$/i,
  /^set\s*$/i,
  /^(?:gci|ls|dir|get-childitem|get-item)\s+env:/i,
  /getenvironmentvariables\s*\(/i,
  /^cmd(?:\.exe)?\s+\/c\s+set\s*$/i,
];

/** Whether a shell command lists the environment. */
export function dumpsEnvironment(command) {
  if (loadSettings().credentialFiles === 'off') return false;
  return command.split(/\||;|&&?|\n|\$\(|`/).some((segment) => DUMP.some((pattern) => pattern.test(segment.trim())));
}

const SECRET_NAME = /key|token|secret|pass|pwd|credential|auth|dsn|connection|cookie|session|signature|private|database_url|webhook/i;
const HARMLESS = /^(?:|true|false|yes|no|on|off|null|none|undefined|-?\d+(?:\.\d+)?)$/i;
const PLAIN = /^(?:[a-z][a-z0-9_.-]{0,40}|https?:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[\w./-]*)?)$/i;

const LEFT = /^(?:.*?[:-]\d+[:-]|\s*\d+[\t→])?[+-]?\s*(?:export\s+|set\s+|\$env:)?([A-Za-z_][\w.-]*|\/\/\S*:_[\w-]+)\s*$/;

function hides(name, value, everyName) {
  const bare = value.replace(/\s+#.*$/, '').trim().replace(/^(["'`])(.*)\1$/, '$2');
  if (HARMLESS.test(bare) || bare === SECRET_PLACEHOLDER) return false;
  if (SECRET_NAME.test(name)) return true;
  return everyName && !PLAIN.test(bare);
}

/**
 * The text with the values of its NAME=value lines hidden. With `everyName`, every value goes except the ones
 * that are plainly no secret (numbers, switches, a host name under a name that does not sound like a secret);
 * without it, only the names that sound like a secret lose theirs. `onlyLine` picks the lines to look at.
 */
export function hideValues(text, { everyName = true, onlyLine } = {}) {
  let count = 0;
  const lines = text.split('\n').map((line) => {
    if (onlyLine && !onlyLine(line)) return line;
    const equals = line.indexOf('=');
    // Left of the "=" stands a name and nothing else, apart from what a search or a diff puts in front of a line.
    let name = equals > 0 ? LEFT.exec(line.slice(0, equals))?.[1] : undefined;
    let start = equals + 1;
    if (!name && !everyName) {
      // The table a PowerShell listing of the environment prints: the name, spaces, the value.
      const row = /^(\s*)([A-Za-z_]\w*)(\s{2,})(?=\S)/.exec(line);
      if (!row) return line;
      name = row[2];
      start = row[0].length;
    }
    if (!name) return line;
    const gap = /^\s*/.exec(line.slice(start))[0].length;
    const value = line.slice(start + gap).replace(/\r$/, '');
    if (!hides(name, value, everyName)) return line;
    count++;
    return `${line.slice(0, start + gap)}${SECRET_PLACEHOLDER}${line.endsWith('\r') ? '\r' : ''}`;
  });
  return { text: count > 0 ? lines.join('\n') : text, count };
}

/**
 * How a tool's output is to be treated, from the call that produced it: undefined, or the options for hideValues.
 */
export function valueHiding(tool, input) {
  if (!input || typeof input !== 'object' || loadSettings().credentialFiles === 'off') return undefined;
  if (tool === 'Bash' || tool === 'PowerShell') {
    const command = typeof input.command === 'string' ? input.command : '';
    if (namesValuesFile(command)) return { everyName: true };
    if (dumpsEnvironment(command)) return { everyName: false };
    return undefined;
  }
  const path = input.file_path ?? input.path;
  if (credentialKind(path) === 'values') return { everyName: true };
  if (tool === 'Grep') {
    // A search over a folder prints "path:line:text"; the lines that come from a values file lose their values.
    return { everyName: true, onlyLine: (line) => credentialKind(/^(.+?)[:-]\d+[:-]/.exec(line)?.[1]) === 'values' };
  }
  return undefined;
}
