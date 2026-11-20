// Run with: node --test email-guard.test.mjs
// Addresses are put together from parts, so this file holds no email-shaped string and stays editable under the hook.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const script = join(dirname(fileURLToPath(import.meta.url)), 'email-guard.mjs');
const at = (local, domain) => [local, domain].join('@');
const private1 = at('jane.doe', 'mailbox.io');

const emptyAllow = join(mkdtempSync(join(tmpdir(), 'email-guard-')), 'allow.txt');
writeFileSync(emptyAllow, '# nothing\n');

function run(toolName, toolInput, allowFile = emptyAllow) {
  const result = spawnSync(process.execPath, [script], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: toolName, tool_input: toolInput }),
    encoding: 'utf8',
    env: { ...process.env, EMAIL_GUARD_ALLOW_FILE: allowFile },
  });
  const output = result.stdout ? JSON.parse(result.stdout).hookSpecificOutput : undefined;
  return { status: result.status, denied: output?.permissionDecision === 'deny', reason: output?.permissionDecisionReason ?? '' };
}

const denied = (name, tool, input) =>
  test(`denies: ${name}`, () => {
    const result = run(tool, input);
    assert.equal(result.status, 0);
    assert.equal(result.denied, true);
    assert.ok(!result.reason.includes(private1), 'the reason must not repeat the address');
  });

const allowed = (name, tool, input) =>
  test(`allows: ${name}`, () => {
    const result = run(tool, input);
    assert.equal(result.status, 0);
    assert.equal(result.denied, false);
  });

denied('a User-Agent with a contact address in a shell command', 'Bash', { command: `curl -A "Crawler/0.1 (contact ${private1})" https://site.io/` });
denied('a query string', 'WebFetch', { url: `https://site.io/api?contact=${private1}`, prompt: 'read it' });
denied('a URL-encoded query string', 'WebFetch', { url: `https://site.io/api?contact=${private1.replace('@', '%40')}` });
denied('a file written with the address', 'Write', { file_path: 'C:/x/config.ts', content: `export const userAgent = 'App/0.1 (${private1})';` });
denied('the text an edit replaces', 'Edit', { file_path: 'C:/x/config.ts', old_string: private1, new_string: '' });
denied('a search pattern', 'Grep', { pattern: private1.replace('.', '\\.') });
denied('a web search', 'WebSearch', { query: `"${private1}" breach` });
denied('a brief for another agent', 'Agent', { description: 'look it up', prompt: `Find where ${private1} is used.` });
denied('a nested argument of an MCP tool', 'mcp__mail__send', { message: { to: [private1], subject: 'hi' } });
denied('a JSON-escaped at sign', 'Write', { file_path: 'a.json', content: private1.replace('@', '\\u0040') });
denied('an address in a path after the host', 'Bash', { command: `curl https://site.io/users/${private1}/profile` });

test('the reason names the field and the count', () => {
  const result = run('Write', { file_path: 'a.txt', content: `${private1} and ${at('second', 'corp.io')}` });
  assert.match(result.reason, /content \(2\)/);
});

allowed('no address at all', 'Bash', { command: 'git status --short' });
allowed('the commit attribution line', 'Bash', { command: `git commit -m "x\n\nCo-Authored-By: Claude <${at('noreply', 'anthropic.com')}>"` });
allowed('reserved test domains', 'Write', { file_path: 'seed.ts', content: `${at('dev', 'myapp.local')} ${at('a', 'example.com')} ${at('b', 'sub.example.org')} ${at('c', 'app.test')}` });
allowed('a GitHub noreply address', 'Bash', { command: `git config user.email ${at('123+name', 'users.noreply.github.com')}` });
allowed('an SSH remote', 'Bash', { command: `git clone ${at('git', 'github.com')}:owner/repo.git` });
allowed('retina image names', 'Write', { file_path: 'a.html', content: `<img src="${at('logo', '2x.png')}"> <img src="${at('hero', '2x.6f7a8b9c0d.webp')}">` });
allowed('package versions', 'Bash', { command: `npm i ${at('react', '18.3.1')} ${at('pkg', '1.0.0-beta.rc')} ${at('@types/node', '24.19.1')}` });
allowed('credentials in a connection string', 'Bash', { command: `psql ${['postgres://app:secret', 'db.corp.io:5432/app'].join('@')}` });
allowed('a tool call without input', 'TaskList', undefined);

test('the allow file lets an exact address and a whole domain through', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'email-guard-')), 'allow.txt');
  writeFileSync(file, `# sender\n${at('', 'mail.corp.io')}\n${private1.toUpperCase()}\n`);
  assert.equal(run('Write', { content: private1 }, file).denied, false);
  assert.equal(run('Write', { content: at('noreply', 'mail.corp.io') }, file).denied, false);
  assert.equal(run('Write', { content: at('noreply', 'eu.mail.corp.io') }, file).denied, false);
  assert.equal(run('Write', { content: at('someone', 'corp.io') }, file).denied, true);
  assert.equal(run('Write', { content: at('someone', 'notmail.corp.io') }, file).denied, true);
});

test('unreadable hook input fails with exit code 1 and denies nothing', () => {
  const result = spawnSync(process.execPath, [script], { input: 'not json', encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
});
