// Tests of the output mask, the prompt check, the commit check and the session note.
// Addresses and the placeholder are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const at = (local, domain) => [local, domain].join('@');
const private1 = at('jane.doe', 'mailbox.io');
const placeholder = ['[email', 'hidden]'].join(' ');

const emptyAllow = join(mkdtempSync(join(tmpdir(), 'privacy-guard-')), 'allow.txt');
writeFileSync(emptyAllow, '# nothing\n');

function run(script, payload, env = {}) {
  const result = spawnSync(process.execPath, [join(here, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, EMAIL_GUARD_ALLOW_FILE: emptyAllow, ...env },
  });
  return { status: result.status, stdout: result.stdout, json: result.stdout.startsWith('{') ? JSON.parse(result.stdout) : undefined };
}

function gitRepo(email) {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-repo-'));
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q');
  git('config', 'user.email', email);
  git('config', 'user.name', 'Test');
  return { dir, git };
}

test('mask-output hides addresses in a shell result and keeps its shape', () => {
  const response = { stdout: `user: ${private1}\nok ${at('a', 'example.com')}`, stderr: '', interrupted: false, isImage: false };
  const out = run('mask-output.mjs', { tool_name: 'Bash', tool_response: response }).json.hookSpecificOutput;
  assert.deepEqual(out.updatedToolOutput, { ...response, stdout: `user: ${placeholder}\nok ${at('a', 'example.com')}` });
  assert.match(out.additionalContext, /1 email address/);
  assert.ok(!JSON.stringify(out).includes(private1));
});

test('mask-output reaches nested values, as a file read or an MCP result has them', () => {
  const response = { type: 'text', file: { filePath: 'C:/x/a.json', content: `{"owner": "${private1}"}`, numLines: 1 }, list: [private1, 7, null] };
  const out = run('mask-output.mjs', { tool_name: 'Read', tool_response: response }).json.hookSpecificOutput.updatedToolOutput;
  assert.equal(out.file.content, `{"owner": "${placeholder}"}`);
  assert.deepEqual(out.list, [placeholder, 7, null]);
  assert.equal(out.file.numLines, 1);
});

test('mask-output says nothing when there is nothing to hide', () => {
  assert.equal(run('mask-output.mjs', { tool_name: 'Bash', tool_response: { stdout: 'plain text, a retina image logo@2x.png', stderr: '' } }).stdout, '');
  assert.equal(run('mask-output.mjs', { tool_name: 'Bash', tool_response: 'x'.repeat(400000) }).stdout, '');
});

test('mask-output stays fast on a long run of letters with an at sign in it', () => {
  const started = Date.now();
  run('mask-output.mjs', { tool_name: 'Read', tool_response: `${'a'.repeat(600000)} ${private1} ${'b'.repeat(600000)}` });
  assert.ok(Date.now() - started < 5000);
});

test('prompt-check blocks a message with an address and names the allow file, not the address', () => {
  const out = run('prompt-check.mjs', { hook_event_name: 'UserPromptSubmit', prompt: `mail the report to ${private1} please` }).json;
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /email-guard\.allow\.txt/);
  assert.ok(!out.reason.includes(private1));
});

test('prompt-check lets a message without an address, or with an allowed one, through', () => {
  assert.equal(run('prompt-check.mjs', { prompt: 'fix the failing test' }).stdout, '');
  assert.equal(run('prompt-check.mjs', { prompt: `use ${at('dev', 'example.com')} as the test user` }).stdout, '');
});

test('email-guard denies writing the placeholder into a file, and allows reading about it', () => {
  const denied = run('email-guard.mjs', { tool_name: 'Write', tool_input: { file_path: 'a.json', content: `{"owner": "${placeholder}"}` } }).json;
  assert.equal(denied.hookSpecificOutput.permissionDecision, 'deny');
  assert.equal(run('email-guard.mjs', { tool_name: 'Grep', tool_input: { pattern: placeholder } }).stdout, '');
});

test('email-guard denies a commit whose staged changes add an address, and names the file only', () => {
  const { dir, git } = gitRepo(at('1+dev', 'users.noreply.github.com'));
  writeFileSync(join(dir, 'config.ts'), `export const contact = '${private1}';\n`);
  writeFileSync(join(dir, 'clean.ts'), 'export const x = 1;\n');
  git('add', '.');
  const out = run('email-guard.mjs', { tool_name: 'Bash', cwd: dir, tool_input: { command: 'git commit -m "add config"' } }).json.hookSpecificOutput;
  assert.equal(out.permissionDecision, 'deny');
  assert.match(out.permissionDecisionReason, /config\.ts \(1\)/);
  assert.ok(!out.permissionDecisionReason.includes('clean.ts'));
  assert.ok(!out.permissionDecisionReason.includes(private1));
});

test('email-guard lets a clean commit through, and sees unstaged changes of "commit -a"', () => {
  const { dir, git } = gitRepo(at('1+dev', 'users.noreply.github.com'));
  writeFileSync(join(dir, 'a.ts'), 'export const x = 1;\n');
  git('add', '.');
  assert.equal(run('email-guard.mjs', { tool_name: 'Bash', cwd: dir, tool_input: { command: 'git commit -m "clean"' } }).stdout, '');
  git('commit', '-q', '-m', 'first');
  writeFileSync(join(dir, 'a.ts'), `export const x = '${private1}';\n`);
  assert.equal(run('email-guard.mjs', { tool_name: 'Bash', cwd: dir, tool_input: { command: 'git commit -m "staged only"' } }).stdout, '');
  const out = run('email-guard.mjs', { tool_name: 'PowerShell', cwd: dir, tool_input: { command: 'git commit -am "all"' } }).json;
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
});

test('session-rule prints the rule, and a note only when git commits under a real address', () => {
  const real = gitRepo(private1);
  const noreply = gitRepo(at('1+dev', 'users.noreply.github.com'));
  const withNote = run('session-rule.mjs', { hook_event_name: 'SessionStart', cwd: real.dir }).stdout;
  const without = run('session-rule.mjs', { hook_event_name: 'SessionStart', cwd: noreply.dir }).stdout;
  assert.match(withNote, /^## Never use the user's personal email address/);
  assert.match(withNote, /commit under a real email address/);
  assert.ok(!withNote.includes(private1));
  assert.ok(!without.includes('commit under a real email address'));
});

test('prompt-check blocks a message that attaches a text file with an address or a secret, and names the file only', () => {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-attach-'));
  writeFileSync(join(dir, 'note.txt'), `owner: ${private1}\n`);
  writeFileSync(join(dir, 'my notes.md'), `key: ${['ghp', 'a1B2'.repeat(9)].join('_')}\n`);
  writeFileSync(join(dir, 'clean.txt'), 'nothing to hide\n');
  writeFileSync(join(dir, 'data.bin'), Buffer.from([0, 1, 2, ...Buffer.from(private1)]));
  const check = (prompt) => run('prompt-check.mjs', { hook_event_name: 'UserPromptSubmit', cwd: dir, prompt });

  const text = check('summarise @note.txt please').json;
  assert.equal(text.decision, 'block');
  assert.match(text.reason, /note\.txt \(1 email address/);
  assert.ok(!text.reason.includes(private1));
  assert.match(check('look at @"my notes.md", then answer').json.reason, /my notes\.md \(1 secret/);
  assert.match(check(`see @${join(dir, 'note.txt')}#L1-2.`).json.reason, /1 email address/);

  assert.equal(check('summarise @clean.txt').stdout, '');
  assert.equal(check('read note.txt and summarise it').stdout, '');
  assert.equal(check('ping @maria about @missing.txt and @data.bin').stdout, '');
});
