// Tests of the rule list: secrets by keyword and by the gitleaks rules, personal data, and the settings that
// switch rules and values on and off. Secrets are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-rules-test-'));
const secretPlaceholder = ['[secret', 'hidden]'].join(' ');
const personalPlaceholder = ['[personal data', 'hidden]'].join(' ');

/** The rules run in a process of their own, so each test has its own settings file. */
function scan(text, settings = {}) {
  const file = join(dir, `settings-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(settings));
  const code = `import('${new URL('./rules.mjs', import.meta.url).href}').then(async (rules) => {
    let text = ''; for await (const chunk of process.stdin) text += chunk;
    process.stdout.write(JSON.stringify(rules.maskSensitive(text)));
  });`;
  const result = spawnSync(process.execPath, ['-e', code], { input: text, encoding: 'utf8', env: { ...process.env, PRIVACY_GUARD_SETTINGS_FILE: file } });
  return JSON.parse(result.stdout);
}

const random = ['q8Zx3vL0pRt7', 'NwB2kYh9Fd4J', 'sMa6Ue1C'].join('');
const personal = { enabledRules: ['personal'] };

test('a random value after a word such as "token" is a secret; the word itself stays readable', () => {
  const result = scan(`deploy_token: ${random}\nnext line`);
  assert.equal(result.text, `deploy_token: ${secretPlaceholder}\nnext line`);
  assert.deepEqual(result.rules, ['keyword-secret']);
});

test('randomness alone is no secret: commit ids, UUIDs, integrity hashes and identifiers pass', () => {
  const text = [
    'commit 3f786850e387550fdab836ed7e6dc881de23001b',
    'id = 123e4567-e89b-12d3-a456-426614174000',
    '"integrity": "sha512-9aXkq3Zb0rT7vL2pNw8YhFd4JsMa6Ue1CqZx3vL0pRt7NwB2kYh9Fd4JsMa6Ue1C=="',
    'const authToken = generateSessionTokenForUser2(user);',
    'token: your_token_goes_here_1234567890',
    'password = process.env.DATABASE_PASSWORD_PRODUCTION_1',
  ].join('\n');
  assert.equal(scan(text).count, 0);
});

test('the password in an address is hidden, the rest of the address stays', () => {
  const url = ['postgres://app:', 'S3cr3t-pass', '@db.internal:5432/main'].join('');
  assert.equal(scan(`DATABASE=${url}`).text, `DATABASE=postgres://app:${secretPlaceholder}@db.internal:5432/main`);
  assert.equal(scan('postgres://user:password@localhost/db').count, 0);
});

test('a rule converted from gitleaks finds its service, and only where its keyword stands', () => {
  const key = ['glpat-', 'Zx3vL0pRt7NwB2kYh9Fd'].join('');
  const result = scan(`gitlab ${key}`);
  assert.equal(result.count, 1);
  assert.ok(result.rules[0].startsWith('gl-gitlab'), result.rules[0]);
  assert.ok(!result.text.includes(key));
});

test('a rule is switched off by its id, and a value or a pattern can be allowed', () => {
  const text = `api_key = ${random}`;
  assert.equal(scan(text, { disabledRules: ['keyword-secret'] }).count, 0);
  assert.equal(scan(text, { allowedValues: [random] }).count, 0);
  assert.equal(scan(text, { allowedPatterns: ['q8Zx.*'] }).count, 0);
  assert.equal(scan(text, { allowedPatterns: ['(unclosed'] }).count, 1);
});

test('personal data is found only when its rules are switched on', () => {
  const text = 'IBAN CH93 0076 2011 6238 5295 7, AHV 756.9217.0769.85';
  assert.equal(scan(text).count, 0);
  assert.equal(scan(text, { enabledRules: ['iban'] }).text, `IBAN ${personalPlaceholder}, AHV 756.9217.0769.85`);
  const all = scan(text, personal);
  assert.equal(all.personal, 2);
  assert.deepEqual(all.rules, ['iban', 'ch-ahv-number']);
});

test('an IBAN, an AHV number and a card number have to pass their checksum', () => {
  for (const valid of ['DE89 3704 0044 0532 0130 00', 'CH9300762011623852957', 'gb82 west 1234 5698 7654 32', '756.9217.0769.85', '7569217076985', '4111 1111 1111 1111', '5500-0000-0000-0004', '378282246310005']) {
    assert.equal(scan(`value: ${valid}.`, personal).count, 1, valid);
  }
  for (const invalid of ['DE89 3704 0044 0532 0130 01', 'CH93 0076 2011 6238 5295', '756.9217.0769.84', '4111 1111 1111 1112', '1234 5678 9012 3456', '4316268596864']) {
    assert.equal(scan(`value: ${invalid}.`, personal).count, 0, invalid);
  }
});

test('phone numbers and US social security numbers are found in their written forms, not in bare digits', () => {
  for (const valid of ['+41 44 668 18 00', '+14155552671', '044 668 18 00', '(415) 555-2671', '415-555-2671', '123-45-6789']) {
    assert.equal(scan(`call ${valid} today`, personal).count, 1, valid);
  }
  for (const invalid of ['4155552671', '2024-11-20', '000-12-3456', 'version 1.2.3-45', 'order 20241120-1234']) {
    assert.equal(scan(`call ${invalid} today`, personal).count, 0, invalid);
  }
});

test('a large text is scanned quickly', () => {
  const line = `const value${random.slice(0, 5)} = compute(items, { token: session.token, key: "name" }); // 3f786850e387550fdab836ed7e6dc881de23001b\n`;
  const started = Date.now();
  assert.equal(scan(line.repeat(4000), personal).count, 0);
  assert.ok(Date.now() - started < 4000, `took ${Date.now() - started} ms`);
});

test('the output mask names the rule, and a call that leaves the computer is denied with it', () => {
  const run = (script, payload) => JSON.parse(spawnSync(process.execPath, [join(here, script)], { input: JSON.stringify(payload), encoding: 'utf8' }).stdout).hookSpecificOutput;
  const out = run('mask-output.mjs', { tool_name: 'Bash', tool_input: { command: 'cat notes.txt' }, tool_response: { stdout: `client_secret=${random}` } });
  assert.equal(out.updatedToolOutput.stdout, `client_secret=${secretPlaceholder}`);
  assert.match(out.additionalContext, /rule keyword-secret/);
  const denied = run('email-guard.mjs', { tool_name: 'WebFetch', tool_input: { url: 'https://site.io', prompt: `the token is ${random}` } });
  assert.equal(denied.permissionDecision, 'deny');
  assert.match(denied.permissionDecisionReason, /rule keyword-secret/);
  assert.ok(!denied.permissionDecisionReason.includes(random));
});
