// Tests of the guard for credential files, of the permission modes that cannot ask, and of the cleaned copy a
// stopped message comes back with. Placeholders are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-credentials-test-'));
const hiddenValue = ['[secret', 'hidden]'].join(' ');
const hiddenAddress = ['[email', 'hidden]'].join(' ');
const address = ['jane.doe', 'mailbox-probe.io'].join('@');

function settings(content) {
  const file = join(dir, `settings-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(file, JSON.stringify(content));
  return file;
}
const noSettings = settings({});
const emptyAllow = join(dir, 'allow.txt');
writeFileSync(emptyAllow, '# nothing\n');

function run(script, payload, settingsFile = noSettings) {
  const result = spawnSync(process.execPath, [join(here, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, PRIVACY_GUARD_SETTINGS_FILE: settingsFile, EMAIL_GUARD_ALLOW_FILE: emptyAllow },
  });
  return result.stdout ? JSON.parse(result.stdout) : undefined;
}
const decision = (tool, input, file, extra = {}) => run('email-guard.mjs', { tool_name: tool, tool_input: input, ...extra }, file)?.hookSpecificOutput;
const denied = (tool, input, file) => decision(tool, input, file)?.permissionDecision === 'deny';
const masked = (tool, input, response, file) => run('mask-output.mjs', { tool_name: tool, tool_input: input, tool_response: response }, file)?.hookSpecificOutput;

test('reading or printing a file of private keys or tokens is refused', () => {
  assert.equal(denied('Read', { file_path: 'C:\\Users\\x\\.ssh\\id_ed25519' }), true);
  assert.equal(denied('Read', { file_path: '/home/x/.aws/credentials' }), true);
  assert.equal(denied('Bash', { command: 'cat ~/.ssh/id_rsa | head -3' }), true);
  assert.equal(denied('PowerShell', { command: 'Get-Content C:\\certs\\server.pem' }), true);
  assert.equal(denied('Bash', { command: 'python -c "print(open(\'deploy.key\').read())"' }), true);
  assert.equal(denied('Bash', { command: 'wc -c < server.key' }), true);
  assert.equal(denied('Grep', { pattern: 'BEGIN', glob: '*.pem', output_mode: 'content' }), true);
  const reason = decision('Read', { file_path: 'server.pem' }).permissionDecisionReason;
  assert.match(reason, /credentialFilesAllowed/);
});

test('using a key file without printing it, public keys and templates pass', () => {
  for (const command of ['ssh -i ~/.ssh/id_rsa host uptime', 'chmod 600 server.key', 'ls -la ~/.ssh/id_rsa', 'git add certs/server.pem', 'cat ~/.ssh/id_rsa.pub']) {
    assert.equal(denied('Bash', { command }), false, command);
  }
  assert.equal(denied('Read', { file_path: 'id_rsa.pub' }), false);
  assert.equal(denied('Read', { file_path: '.env' }), false);
  assert.equal(denied('Grep', { pattern: 'BEGIN', glob: '*.pem' }), false);
});

test('a key file the user allowed passes, and the guard can be switched off', () => {
  assert.equal(denied('Read', { file_path: 'tests/fixtures/ca.pem' }, settings({ credentialFilesAllowed: ['tests/fixtures/*.pem'] })), false);
  assert.equal(denied('Read', { file_path: 'src/ca.pem' }, settings({ credentialFilesAllowed: ['tests/fixtures/*.pem'] })), true);
  assert.equal(denied('Read', { file_path: 'server.pem' }, settings({ credentialFiles: 'off' })), false);
});

test('a file of NAME=value lines is read with its names shown and its values hidden', () => {
  const content = '# local settings\nPORT=3000\nDEBUG=true\nLOG_LEVEL=info\nAPI_KEY=abc\nGREETING="hello there, world"\nexport DB_PASS=hunter2\n';
  const out = masked('Read', { file_path: 'app/.env.local' }, { type: 'text', file: { filePath: 'app/.env.local', content, numLines: 7 } });
  assert.equal(out.updatedToolOutput.file.content, `# local settings\nPORT=3000\nDEBUG=true\nLOG_LEVEL=info\nAPI_KEY=${hiddenValue}\nGREETING=${hiddenValue}\nexport DB_PASS=${hiddenValue}\n`);
  assert.match(out.additionalContext, /the value of 3 setting/);
  assert.equal(masked('Read', { file_path: '.env.example' }, { file: { content } }), undefined);
  assert.equal(masked('Read', { file_path: '.env' }, { file: { content } }, settings({ credentialFilesAllowed: ['.env'] })), undefined);
});

test('a command that names such a file has the values hidden in its output, and code lines are left alone', () => {
  const out = masked('Bash', { command: 'cat .env && git diff .env' }, { stdout: 'STRIPE=abc def\n+NEW_VALUE=Zx9 q\nconst token = getToken()\n', stderr: '' });
  assert.equal(out.updatedToolOutput.stdout, `STRIPE=${hiddenValue}\n+NEW_VALUE=${hiddenValue}\nconst token = getToken()\n`);
  const search = masked('Grep', { pattern: 'KEY', output_mode: 'content' }, { content: 'src/app.ts:4:const KEY = load()\nconfig/.env:2:MAIL_KEY=abc\n' });
  assert.equal(search.updatedToolOutput.content, `src/app.ts:4:const KEY = load()\nconfig/.env:2:MAIL_KEY=${hiddenValue}\n`);
});

test('a listing of the environment keeps its values, except under names that sound like a secret', () => {
  const out = masked('Bash', { command: 'git status && env' }, { stdout: 'PATH=/usr/bin:/bin\nGITHUB_TOKEN=abc123\nHOME=/home/x\n' });
  assert.equal(out.updatedToolOutput.stdout, `PATH=/usr/bin:/bin\nGITHUB_TOKEN=${hiddenValue}\nHOME=/home/x\n`);
  const table = masked('PowerShell', { command: 'Get-ChildItem Env:' }, { stdout: 'Name              Value\nDB_PASSWORD       hunter2\nTEMP              C:\\tmp\n' });
  assert.equal(table.updatedToolOutput.stdout, `Name              Value\nDB_PASSWORD       ${hiddenValue}\nTEMP              C:\\tmp\n`);
  assert.equal(masked('Bash', { command: 'env NODE_ENV=test node run.js' }, { stdout: 'API_KEY=abc\n' }), undefined);
});

test('where no question reaches the person, a picture that needs their yes is refused and not asked about', () => {
  const picture = join(dir, 'empty.png');
  writeFileSync(picture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const confirm = settings({ pictures: 'confirm' });
  assert.equal(decision('Read', { file_path: picture }, confirm, { permission_mode: 'default' }).permissionDecision, 'ask');
  for (const mode of ['auto', 'bypassPermissions', 'dontAsk']) {
    const out = decision('Read', { file_path: picture }, confirm, { permission_mode: mode });
    assert.equal(out.permissionDecision, 'deny', mode);
    assert.match(out.permissionDecisionReason, /extract-text\.mjs/);
  }
});

test('a stopped message comes back with a cleaned copy, and a secret in a message stops it too', () => {
  const key = ['ghp_', 'Zx3vL0pRt7NwB2kYh9Fd4JsMa6Ue1CqZx3vL0'].join('');
  const out = run('prompt-check.mjs', { prompt: `mail ${address} that the token ${key} expired` });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /1 email address\(es\), 1 secret\(s\) \(rule github-token\)/);
  assert.ok(out.reason.endsWith(`mail ${hiddenAddress} that the token ${hiddenValue} expired`));
  assert.ok(!out.reason.includes(address) && !out.reason.includes(key));
  const long = run('prompt-check.mjs', { prompt: `${'word '.repeat(2000)}${address}` });
  assert.equal(long.decision, 'block');
  assert.ok(!long.reason.includes('to copy and send'));
});
