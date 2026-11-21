// Tests of the rules skill's script, of rules of one's own, and of an organisation's settings laid under a
// person's. Placeholders are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, '..', 'skills', 'rules', 'rules.mjs');
const hiddenPersonal = ['[personal data', 'hidden]'].join(' ');

/** A profile of its own: a settings file, an empty session history, and a way to run the script and the hooks in it. */
function profile(org) {
  const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-rules-skill-'));
  const settings = join(dir, 'privacy-guard.json');
  const env = { ...process.env, PRIVACY_GUARD_SETTINGS_FILE: settings, CLAUDE_CONFIG_DIR: dir };
  delete env.PRIVACY_GUARD_ORG_SETTINGS;
  if (org) {
    env.PRIVACY_GUARD_ORG_SETTINGS = join(dir, 'org.json');
    writeFileSync(env.PRIVACY_GUARD_ORG_SETTINGS, JSON.stringify(org));
  }
  const run = (...args) => {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env });
    return { ok: result.status === 0, out: result.stdout + result.stderr };
  };
  const ruleFile = (rule) => {
    const file = join(dir, `${rule.id}.json`);
    writeFileSync(file, JSON.stringify(rule));
    return file;
  };
  const hook = (name, payload) => {
    const out = spawnSync(process.execPath, [join(here, name)], { input: JSON.stringify(payload), encoding: 'utf8', env }).stdout;
    return out ? JSON.parse(out).hookSpecificOutput : undefined;
  };
  return { dir, run, ruleFile, hook, stored: () => JSON.parse(readFileSync(settings, 'utf8')) };
}

const matter = {
  id: 'matter-number',
  kind: 'personal',
  pattern: '(?<![A-Za-z0-9])M-\\d{4}-\\d{5}(?![A-Za-z0-9])',
  flags: 'i',
  keywords: ['m-'],
  description: 'matter numbers',
  match: ['M-2026-00417', 'm-2025-10003'],
  noMatch: ['M-26-417', 'TM-2026-004171', '2026-00417'],
};

test('a rule of one\'s own is tried on its examples, stored without them, and applied by the hooks', () => {
  const p = profile();
  const added = p.run('add', p.ruleFile(matter));
  assert.ok(added.ok, added.out);
  assert.deepEqual(p.stored().customRules, [{ id: 'matter-number', kind: 'personal', pattern: matter.pattern, flags: 'i', keywords: ['m-'], description: 'matter numbers' }]);
  assert.match(p.run('test', 'see matter M-2026-00417').out, /matter-number: 1/);
  const out = p.hook('mask-output.mjs', { tool_name: 'Bash', tool_input: { command: 'cat notes.txt' }, tool_response: { stdout: 'file M-2026-00417 is open' } });
  assert.equal(out.updatedToolOutput.stdout, `file ${hiddenPersonal} is open`);
  assert.match(out.additionalContext, /rule matter-number/);
  assert.ok(p.run('remove', 'matter-number').ok);
  assert.equal(p.stored().customRules, undefined);
});

test('a rule that misses its examples, catches a look-alike, crawls or is malformed is not stored', () => {
  const p = profile();
  const refused = (rule, reason) => {
    const result = p.run('add', p.ruleFile({ ...matter, ...rule }));
    assert.equal(result.ok, false, JSON.stringify(rule));
    assert.match(result.out, reason);
  };
  refused({ match: ['N-2026-00417'] }, /does not find/);
  refused({ noMatch: ['M-2026-00417'] }, /should leave alone/);
  refused({ match: [] }, /at least one made-up value/);
  refused({ pattern: '(unclosed' }, /does not compile/);
  refused({ pattern: 'M?-?\\d*' }, /matches the empty text/);
  refused({ id: 'iban' }, /taken by a built-in rule/);
  refused({ id: 'X' }, /the id is/);
  refused({ kind: 'other' }, /the kind is/);
  refused({ check: 'md5' }, /the check is one of/);
  refused({ pattern: 'M-(\\d+)+x', match: ['M-1x'], noMatch: [] }, /takes too long/);
  assert.match(p.run('status').out, /Rules of your own: none/);
});

test('a checksum can be asked of a value', () => {
  const p = profile();
  const rule = { id: 'customer-number', kind: 'personal', pattern: '\\bK\\d{8}\\b', check: 'luhn', match: ['K79927398'], noMatch: ['K79927399'] };
  assert.ok(p.run('add', p.ruleFile({ ...rule, match: ['K79927399'] })).out.includes('checksum'));
  const added = p.run('add', p.ruleFile(rule));
  assert.ok(added.ok, added.out);
});

test('rules are switched on and off, and values, patterns and files are allowed', () => {
  const p = profile();
  const iban = 'CH93 0076 2011 6238 5295 7';
  assert.match(p.run('test', `pay to ${iban}`).out, /No rule finds/);
  assert.ok(p.run('enable', 'iban').ok);
  assert.match(p.run('test', `pay to ${iban}`).out, /iban: 1/);
  assert.ok(p.run('allow', 'value', iban).ok);
  assert.match(p.run('test', `pay to ${iban}`).out, /No rule finds/);
  assert.ok(p.run('unallow', 'value', iban).ok);
  assert.ok(p.run('enable', 'personal').ok);
  assert.ok(p.run('disable', 'iban', 'keyword-secret').ok);
  assert.deepEqual(p.stored(), { enabledRules: ['personal'], disabledRules: ['iban', 'keyword-secret'] });
  assert.match(p.run('status').out, /off {2}iban[\s\S]*ON {3}ch-ahv-number/);
  assert.ok(p.run('enable', 'iban').ok);
  assert.deepEqual(p.stored().disabledRules, ['keyword-secret']);
  assert.equal(p.run('enable', 'no-such-rule').ok, false);
  assert.equal(p.run('allow', 'pattern', '(a+)+b').ok, false);
  assert.ok(p.run('allow', 'file', '.env.test').ok);
  assert.equal(p.hook('mask-output.mjs', { tool_name: 'Read', tool_input: { file_path: '.env.test' }, tool_response: { file: { content: 'GREETING="hello there, world"\n' } } }), undefined);
});

test('what an organisation switches on stays on, and its rules come first', () => {
  const p = profile({ enabledRules: ['iban'], customRules: [{ id: matter.id, kind: matter.kind, pattern: matter.pattern, flags: 'i' }] });
  writeFileSync(join(p.dir, 'privacy-guard.json'), JSON.stringify({ disabledRules: ['iban', 'matter-number'] }));
  assert.match(p.run('test', 'M-2026-00417 pays to CH93 0076 2011 6238 5295 7').out, /matter-number: 1[\s\S]*iban: 1|iban: 1[\s\S]*matter-number: 1/);
  const refused = p.run('disable', 'iban');
  assert.equal(refused.ok, false);
  assert.match(refused.out, /organisation/);
  assert.equal(p.run('add', p.ruleFile(matter)).ok, false);
  assert.match(p.run('status').out, /set by the organisation/);
});

test('check replays a rule against the stored sessions and leaves the value out of its sample', () => {
  const p = profile();
  const session = join(p.dir, 'projects', 'demo');
  mkdirSync(session, { recursive: true });
  const lines = [
    { type: 'user', message: { content: 'the matter M-2026-00417 needs a letter' } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'court fees M-2026-00417' } }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'court fees schedule' } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', content: 'matter M-2025-10003 closed' }] } },
  ];
  writeFileSync(join(session, 'a.jsonl'), lines.map((line) => JSON.stringify(line)).join('\n'));
  assert.ok(p.run('add', p.ruleFile(matter)).ok);
  const checked = p.run('check', 'matter-number');
  assert.ok(checked.ok, checked.out);
  assert.match(checked.out, /matter-number: MAY BE IN THE WAY: it would have refused 1 of 2 calls.*stopped 1 of 1 of your messages.*hidden 1 value\(s\) in 1 of 1 tool results/);
  assert.ok(!checked.out.includes('M-2026-00417') && !checked.out.includes('M-2025-10003'));
  assert.match(p.run('check', 'us-ssn').out, /us-ssn: no sign of trouble/);
});

test('loosening the guard through the script is the person\'s to confirm; tightening it runs', () => {
  const p = profile();
  const decision = (command, mode) => p.hook('email-guard.mjs', { tool_name: 'Bash', permission_mode: mode, tool_input: { command } })?.permissionDecision;
  for (const command of ['node "C:/x/skills/rules/rules.mjs" disable keyword-secret', 'node rules.mjs allow value abc', 'node rules.mjs remove matter-number']) {
    assert.equal(decision(command, 'default'), 'ask', command);
    assert.equal(decision(command, 'auto'), 'deny', command);
  }
  for (const command of ['node rules.mjs enable iban', 'node rules.mjs add rule.json', 'node rules.mjs status', 'node rules.mjs check iban', 'node rules.mjs unallow value abc']) {
    assert.equal(decision(command, 'auto'), undefined, command);
  }
});

test('only the settings file the guard reads is protected, not every file or text of that name', () => {
  const p = profile({ enabledRules: ['iban'] });
  const own = join(p.dir, 'privacy-guard.json');
  const org = join(p.dir, 'org.json');
  const decision = (tool, input, mode = 'default', cwd = p.dir) => p.hook('email-guard.mjs', { tool_name: tool, permission_mode: mode, cwd, tool_input: input })?.permissionDecision;
  const project = join(p.dir, 'project');
  assert.equal(decision('Edit', { file_path: own, old_string: 'a', new_string: 'b' }), 'ask');
  assert.equal(decision('Write', { file_path: own, content: '{}' }, 'auto'), 'deny');
  assert.equal(decision('Write', { file_path: org, content: '{}' }), 'ask');
  assert.equal(decision('Bash', { command: `echo '{}' > "${own.replace(/\\/g, '/')}"` }), 'ask');
  assert.equal(decision('Bash', { command: 'rm privacy-guard.json' }), 'ask');
  // The same name in another folder, in a test file's text or in a read is no change to the guard.
  assert.equal(decision('Write', { file_path: join(p.dir, 'project', 'privacy-guard.json'), content: '{}' }, 'auto'), undefined);
  assert.equal(decision('Bash', { command: "cat >> scripts/a.test.mjs <<'EOF'\nconst file = join(dir, 'other', 'privacy-guard.json');\nEOF" }, 'auto', project), undefined);
  assert.equal(decision('Bash', { command: 'git commit -m "docs: privacy-guard.json keys" && rm old.txt' }, 'auto', project), undefined);
  assert.equal(decision('Bash', { command: `cat "${own.replace(/\\/g, '/')}"` }, 'auto'), undefined);
});

test('images and documents are handled each in their own way, and a session is told how', () => {
  const p = profile();
  const png = join(p.dir, 'shot.png');
  writeFileSync(png, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=', 'base64'));
  const pdf = join(p.dir, 'paper.pdf');
  writeFileSync(pdf, '%PDF-1.4\n');
  const open = (path) => p.hook('email-guard.mjs', { tool_name: 'Read', permission_mode: 'default', tool_input: { file_path: path } })?.permissionDecision;
  assert.ok(p.run('pictures', 'strict').ok);
  assert.equal(open(png), 'deny');
  assert.equal(open(pdf), 'deny');
  assert.match(p.run('pictures', 'images', 'off').out, /Images: off\. PDFs and pasted Office files: strict\./);
  assert.deepEqual(p.stored(), { pictures: { images: 'off', documents: 'strict' } });
  assert.equal(open(png), undefined);
  assert.equal(open(pdf), 'deny');
  const told = spawnSync(process.execPath, [join(here, 'session-rule.mjs')], { input: JSON.stringify({ cwd: p.dir }), encoding: 'utf8', env: { ...process.env, PRIVACY_GUARD_SETTINGS_FILE: join(p.dir, 'privacy-guard.json') } }).stdout;
  assert.match(told, /- Images \(screenshots, photos, scans\): open them with your file tool as usual\. The user switched the check off/);
  assert.match(told, /- PDFs: are not opened on this computer/);
  assert.ok(!told.includes('{handling}'));
  assert.ok(p.run('pictures', 'check').ok);
  assert.deepEqual(p.stored(), {});
  assert.equal(p.run('pictures', 'videos', 'off').ok, false);
  assert.equal(p.hook('email-guard.mjs', { tool_name: 'Bash', permission_mode: 'default', tool_input: { command: 'node rules.mjs pictures images off' } }).permissionDecision, 'ask');
});

test('an organisation sets how pictures are handled, and a person cannot change that', () => {
  const p = profile({ pictures: { images: 'strict' } });
  assert.equal(p.run('pictures', 'images', 'off').ok, false);
  assert.ok(p.run('pictures', 'documents', 'off').ok);
  assert.match(p.run('status').out, /Images: strict\. PDFs and pasted Office files: off\./);
});
