// Tests of sound matching, shared (hashed) lists and the terms script.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const termsScript = join(here, '..', 'skills', 'terms', 'terms.mjs');

/** A fresh Claude config folder, so that lists, keys and session history are this test's own. */
function configFolder() {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-config-'));
  writeFileSync(join(dir, 'email-guard.allow.txt'), '# nothing\n');
  return dir;
}

function node(script, args, config, input) {
  const env = { ...process.env, CLAUDE_CONFIG_DIR: config };
  delete env.PRIVACY_GUARD_TERMS_FILE;
  delete env.EMAIL_GUARD_ALLOW_FILE;
  return spawnSync(process.execPath, [script, ...args], { input, encoding: 'utf8', env });
}
const terms = (config, ...args) => {
  const result = node(termsScript, args, config, '');
  return result.stdout + result.stderr;
};
function hook(script, payload, config) {
  const result = node(join(here, script), [], config, JSON.stringify(payload));
  const json = result.stdout.startsWith('{') ? JSON.parse(result.stdout) : undefined;
  return { json, denied: json?.hookSpecificOutput?.permissionDecision === 'deny', reason: json?.hookSpecificOutput?.permissionDecisionReason ?? json?.reason ?? '' };
}
const search = (config, query) => hook('email-guard.mjs', { tool_name: 'WebSearch', tool_input: { query } }, config).denied;

test('sound matching follows German and English spelling, and stays close to the term', () => {
  const config = configFolder();
  terms(config, 'add', '--sound', 'Catherine', 'Stephen', 'Philips', 'Jackson', 'Mayerhofer', 'Meier');
  for (const spelling of ['Kathryn', 'Cathryn', 'Steven', 'Filips', 'Jaxon', 'Meierhoffer', 'Meyrhover', 'Meyer', 'Mayer']) {
    assert.equal(search(config, `ruling ${spelling} 2026`), true, spelling);
  }
  // The same sound code, but too far in spelling: "more" and "Maria" sound like "Meier" to the code.
  for (const other of ['more', 'Maria', 'Stefanie', 'Jameson', 'cathedral', 'phyllis diller']) {
    assert.equal(search(config, `ruling ${other} 2026`), false, other);
  }
});

test('the terms script keeps the personal list: add, no duplicates, remove, mode, status', () => {
  const config = configFolder();
  assert.match(terms(config, 'add', 'Project Falcon', 'Acme Holdings'), /Added 2 of 2/);
  assert.match(terms(config, 'add', 'project-falcon', '--sound', 'Meier'), /Added 1 of 2/);
  const file = readFileSync(join(config, 'privacy-guard.terms.txt'), 'utf8');
  assert.match(file, /^Project Falcon$/m);
  assert.match(file, /^~Meier$/m);
  assert.equal(search(config, 'acme holdings insolvency'), true);
  assert.match(terms(config, 'remove', 'ACME holdings'), /Removed 1/);
  assert.equal(search(config, 'acme holdings insolvency'), false);
  assert.match(terms(config, 'mode', 'everywhere'), /mode everywhere/);
  assert.equal(hook('prompt-check.mjs', { prompt: 'summarise the project falcon memo' }, config).json.decision, 'block');
  assert.match(terms(config, 'status'), /Personal list: 2 term\(s\), mode everywhere/);
});

test('a shared list holds no term in plain text and still catches spacing, case and a typing mistake', () => {
  const config = configFolder();
  assert.match(terms(config, 'add', '--list', 'team', 'Project Falcon', 'Zeta'), /Added 2 of 2 term\(s\) to the shared list "team"/);
  assert.match(terms(config, 'add', '--list', 'team', '--sound', 'Mayerhofer'), /Added 1/);
  const listFile = join(config, 'privacy-guard.terms.team.json');
  const stored = readFileSync(listFile, 'utf8').toLowerCase();
  for (const word of ['falcon', 'project', 'zeta', 'mayerhofer', 'mayer']) assert.ok(!stored.includes(word), word);
  assert.ok(existsSync(join(config, 'privacy-guard.terms.team.key')));

  for (const query of ['Project Falcon merger', 'PROJECT-FALCON', 'ProjectFalcon', 'projct falcon', 'project flacon', 'the zeta filing', 'Meierhoffer ruling']) {
    assert.equal(search(config, query), true, query);
  }
  for (const query of ['project management', 'falconry', 'beta and meta', 'the zetas', 'Mayer ruling']) assert.equal(search(config, query), false, query);
  assert.match(terms(config, 'status'), /Shared list "team": 3 term\(s\), mode outbound, key present/);

  assert.match(terms(config, 'remove', '--list', 'team', 'project falcon'), /Removed 1/);
  assert.equal(search(config, 'Project Falcon merger'), false);
});

test('a shared list without its key is not applied, and import brings list and key', () => {
  const author = configFolder();
  terms(author, 'add', '--list', 'matter-7', 'Zebrafinch Holdings');
  assert.match(terms(author, 'share', 'matter-7'), /key copy matter-7/);

  const colleague = configFolder();
  assert.match(terms(colleague, 'import', join(author, 'privacy-guard.terms.matter-7.json')), /key is still missing/);
  assert.equal(search(colleague, 'zebrafinch holdings'), false);
  assert.match(terms(colleague, 'status'), /key MISSING/);
  terms(colleague, 'import', join(author, 'privacy-guard.terms.matter-7.json'), join(author, 'privacy-guard.terms.matter-7.key'));
  assert.equal(search(colleague, 'zebrafinch holdings'), true);

  renameSync(join(colleague, 'privacy-guard.terms.matter-7.key'), join(colleague, 'kept-elsewhere.key'));
  assert.equal(search(colleague, 'zebrafinch holdings'), false);
});

test('a shared list in mode everywhere keeps its terms out of prompts and tool output', () => {
  const config = configFolder();
  terms(config, 'add', '--list', 'team', 'Project Falcon');
  assert.equal(hook('prompt-check.mjs', { prompt: 'summarise the project falcon memo' }, config).json, undefined);
  terms(config, 'mode', '--list', 'team', 'everywhere');
  assert.equal(hook('prompt-check.mjs', { prompt: 'summarise the project falcon memo' }, config).json.decision, 'block');
  const out = hook('mask-output.mjs', { tool_name: 'Read', tool_response: 'Re: Project-Falcon, due Friday' }, config).json.hookSpecificOutput;
  assert.equal(out.updatedToolOutput, `Re: ${['[term', 'hidden]'].join(' ')}, due Friday`);
});

test('check tells from the stored sessions whether a term would get in the way', () => {
  const config = configFolder();
  mkdirSync(join(config, 'projects', 'p'), { recursive: true });
  const record = (type, content) => JSON.stringify({ type, timestamp: new Date().toISOString(), message: { role: type, content } });
  writeFileSync(
    join(config, 'projects', 'p', 'session.jsonl'),
    [
      record('assistant', [{ type: 'tool_use', id: 'a', name: 'WebSearch', input: { query: 'phoenix framework liveview docs' } }]),
      record('assistant', [{ type: 'tool_use', id: 'b', name: 'WebFetch', input: { url: 'https://hexdocs.pm/phoenix/overview.html', prompt: 'summarise' } }]),
      record('assistant', [{ type: 'tool_use', id: 'c', name: 'Bash', input: { command: 'echo phoenix stays local' } }]),
      record('assistant', [{ type: 'tool_use', id: 'd', name: 'WebSearch', input: { query: 'node test runner' } }]),
      record('user', 'how do I upgrade phoenix?'),
    ].join('\n'),
  );
  const report = terms(config, 'check', 'Phoenix', 'Zebrafinch Holdings');
  assert.match(report, /3 call\(s\) that left the computer, 1 message/);
  assert.match(report, /"Phoenix": LIKELY IN THE WAY: it would have refused 2 of 3 calls/);
  assert.match(report, /"Zebrafinch Holdings": no sign of trouble/);

  terms(config, 'add', 'Phoenix');
  const whole = terms(config, 'check');
  assert.match(whole, /Term 1: LIKELY IN THE WAY/);
  assert.ok(!/phoenix/i.test(whole), 'a check of the whole list must not print its terms');
});

test('the lists and keys are reached through the terms script only', () => {
  const config = configFolder();
  const guard = (tool, input) => hook('email-guard.mjs', { tool_name: tool, tool_input: input }, config);
  assert.equal(guard('Read', { file_path: join(config, 'privacy-guard.terms.txt') }).denied, true);
  assert.equal(guard('Bash', { command: 'cat ~/.claude/privacy-guard.terms.team.key' }).denied, true);
  assert.equal(guard('Edit', { file_path: 'C:/Users/x/.claude/privacy-guard.terms.team.json', old_string: 'a', new_string: 'b' }).denied, true);
  assert.equal(guard('Bash', { command: 'node skills/terms/terms.mjs status' }).denied, false);
  assert.equal(guard('Write', { file_path: 'INSTALL.md', content: 'the file privacy-guard.terms.txt holds the list' }).denied, false);
});

test('test says whether a text is caught and by which list, without repeating the text', () => {
  const config = configFolder();
  terms(config, 'add', 'Acme Holdings');
  terms(config, 'add', '--list', 'team', 'Project Falcon');
  const report = terms(config, 'test', 'the project-falcon memo', 'acme holdings filing', 'node test runner');
  assert.match(report, /Text 1: caught by the list team \(outbound\)/);
  assert.match(report, /Text 2: caught by the list personal \(outbound\)/);
  assert.match(report, /Text 3: not caught by any list/);
  assert.ok(!/falcon|acme/i.test(report));
});

test('share lists the steps for the sender and the receiver, and import reports the key', () => {
  const author = configFolder();
  terms(author, 'add', '--list', 'team', 'Project Falcon');
  const steps = terms(author, 'share', 'team');
  for (const part of ['What you do:', 'What each colleague does:', 'Later:', 'privacy-guard.terms.team.json', 'privacy-guard.terms.team.key']) assert.ok(steps.includes(part), part);
  const colleague = configFolder();
  const imported = terms(colleague, 'import', join(author, 'privacy-guard.terms.team.json'), join(author, 'privacy-guard.terms.team.key'));
  assert.match(imported, /Its key is present/);
  assert.match(terms(colleague, 'test', 'Project Falcon'), /caught by the list team/);
});

test('the key as a code is for a person at a terminal: the script refuses elsewhere, and the guard refuses the call', () => {
  const config = configFolder();
  terms(config, 'add', '--list', 'team', 'Project Falcon');
  for (const action of ['copy', 'show', 'set']) assert.match(terms(config, 'key', action, 'team'), /only in a terminal a person sits at/);
  const call = hook('email-guard.mjs', { tool_name: 'Bash', tool_input: { command: 'node "C:/x/skills/terms/terms.mjs" key show team' } }, config);
  assert.equal(call.denied, true);
  assert.match(call.reason, /in their own terminal/);
  assert.equal(hook('email-guard.mjs', { tool_name: 'Bash', tool_input: { command: 'node terms.mjs status' } }, config).denied, false);
});
