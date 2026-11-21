#!/usr/bin/env node
// Manages the rules the privacy guard finds secrets and personal data with, and tells whether a rule would
// get in the way. It is the one place that writes privacy-guard.json.
//
//   node rules.mjs status                          what is on, what is allowed, where the settings live
//   node rules.mjs list [<part of an id>]          every rule's id
//   node rules.mjs enable  <id>...                 switch on rules that are off by default ("personal": all five)
//   node rules.mjs disable <id>...                 switch a rule off
//   node rules.mjs allow   value|pattern|file <entry>...     what no rule reports, or files the credential guard leaves alone
//   node rules.mjs unallow value|pattern|file <entry>...
//   node rules.mjs pictures [images|documents] check|confirm|strict|off     how images and PDFs are handled
//   node rules.mjs add <rule.json>                 a rule of your own, see below
//   node rules.mjs remove <id>...                  take a rule of your own out
//   node rules.mjs test [<text>...]                which rules find something in this text (no text: standard input)
//   node rules.mjs check [--days 30] <id>...       would the rule have got in the way in the stored sessions
//
// A rule file for `add`:
//   { "id": "matter-number", "kind": "personal", "pattern": "\\bM-\\d{4}-\\d{5}\\b", "flags": "i",
//     "group": 0, "keywords": ["m-"], "check": "luhn", "description": "our matter numbers",
//     "match": ["M-2026-00417"], "noMatch": ["M-26-417", "TM-2026-004171"] }
// `match` lists made-up values the rule has to find, `noMatch` look-alikes it has to leave alone. Both are
// tried before the rule is stored, and neither is stored.

import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { configDir } from '../../scripts/lib.mjs';
import { CHECKS, allRules, customRule, findSensitive, findWith } from '../../scripts/rules.mjs';
import { isOutbound } from '../../scripts/sensitive.mjs';
import { PERSONAL_IDS, loadSettings, orgSettingsFile, settingsFile } from '../../scripts/settings.mjs';

const args = process.argv.slice(2);
const command = args.shift();
function option(name) {
  const at = args.indexOf(name);
  return at < 0 ? undefined : args.splice(at, 2)[1];
}
const fail = (message) => {
  console.error(message);
  process.exit(1);
};

/** The person's own settings file as it stands, and a way to write it back with its other keys kept. */
function own() {
  const file = settingsFile();
  let settings = {};
  if (existsSync(file)) {
    try {
      settings = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      fail(`${file} is no valid JSON. Repair or remove it first; this script does not overwrite a file it cannot read.`);
    }
  }
  return settings;
}
const save = (settings) => writeFileSync(settingsFile(), `${JSON.stringify(settings, null, 2)}\n`);
const listOf = (settings, key) => (Array.isArray(settings[key]) ? settings[key] : []);

/** Adds to or removes from a list in the settings; says what changed. */
function change(key, entries, add) {
  const settings = own();
  const before = listOf(settings, key);
  const after = add ? [...new Set([...before, ...entries])] : before.filter((entry) => !entries.includes(entry));
  if (after.length) settings[key] = after;
  else delete settings[key];
  save(settings);
  return add ? entries.filter((entry) => !before.includes(entry)) : before.filter((entry) => entries.includes(entry));
}

const known = () => new Map(allRules().map((rule) => [rule.id, rule]));
const restart = 'Sessions that are running apply it from their next tool call.';

function status() {
  const settings = loadSettings();
  const rules = allRules();
  const on = new Set(settings.enabledRules);
  const off = new Set(settings.disabledRules);
  console.log(`Settings: ${settingsFile()}${existsSync(settingsFile()) ? '' : ' (not there yet: everything is at its default)'}`);
  const org = orgSettingsFile();
  if (org) console.log(`Organisation settings: ${org} (what it switches on cannot be switched off here)`);
  console.log(`\nSecrets: ${rules.filter((rule) => rule.kind === 'secret' && !rule.custom && !off.has(rule.id)).length} rules on (key formats, about 200 services from gitleaks, keyword-secret, password-in-url).`);
  console.log('\nPersonal data (off until switched on):');
  for (const id of PERSONAL_IDS) console.log(`  ${on.has(id) || on.has('personal') ? (off.has(id) ? 'off' : 'ON ') : 'off'}  ${id}${settings.locked.has(id) || settings.locked.has('personal') ? '  (set by the organisation)' : ''}`);
  const custom = settings.customRules;
  console.log(`\nRules of your own: ${custom.length || 'none'}`);
  for (const spec of custom) {
    let problem = '';
    try {
      customRule(spec);
    } catch (error) {
      problem = `  NOT IN USE: ${error.message}`;
    }
    console.log(`  ${off.has(spec.id) ? 'off' : 'ON '}  ${spec.id} (${spec.kind})${spec.description ? `: ${spec.description}` : ''}${settings.locked.has(spec.id) ? '  (set by the organisation)' : ''}${problem}`);
  }
  const switchedOff = [...off].filter((id) => !PERSONAL_IDS.includes(id));
  console.log(`\nSwitched off: ${switchedOff.join(', ') || 'none'}`);
  console.log(`Allowed values: ${settings.allowedValues.length}, allowed patterns: ${settings.allowedPatterns.length} (shown by: status --allowed)`);
  console.log(`Credential files: ${settings.credentialFiles}; left alone: ${settings.credentialFilesAllowed.join(', ') || 'none'}`);
  console.log(`Images: ${settings.pictures.images}. PDFs and pasted Office files: ${settings.pictures.documents}. Folders whose pictures pass in "strict" and "confirm": ${settings.picturesAllowed.join(', ') || 'none'}`);
  if (args.includes('--allowed')) {
    for (const value of settings.allowedValues) console.log(`  value    ${value}`);
    for (const value of settings.allowedPatterns) console.log(`  pattern  ${value}`);
  }
}

function list() {
  const part = args[0] ?? '';
  const rules = allRules().filter((rule) => rule.id.includes(part));
  for (const rule of rules) console.log(`${rule.id}  (${rule.kind}${rule.optIn ? ', off by default' : ''}${rule.custom ? ', your own' : ''})`);
  console.log(`\n${rules.length} rule(s).`);
}

function enable() {
  if (args.length === 0) fail('Name the rules to switch on, for example: enable iban ch-ahv-number');
  const rules = known();
  for (const id of args) if (id !== 'personal' && !rules.has(id)) fail(`There is no rule "${id}". See: list`);
  change('disabledRules', args, false);
  const optIn = args.filter((id) => id === 'personal' || rules.get(id).optIn);
  if (optIn.length) change('enabledRules', optIn, true);
  console.log(`On: ${args.join(', ')}. ${restart}`);
}

function disable() {
  if (args.length === 0) fail('Name the rules to switch off.');
  const rules = known();
  const settings = loadSettings();
  for (const id of args) {
    if (!rules.has(id)) fail(`There is no rule "${id}". See: list`);
    if (settings.locked.has(id) || (settings.locked.has('personal') && PERSONAL_IDS.includes(id))) fail(`"${id}" is switched on by the organisation's settings and cannot be switched off here.`);
  }
  change('enabledRules', args, false);
  // "personal" stands for all five; one of them is switched off by name.
  const stillOn = new Set(listOf(own(), 'enabledRules'));
  const needOff = args.filter((id) => !rules.get(id).optIn || stillOn.has('personal'));
  if (needOff.length) change('disabledRules', needOff, true);
  console.log(`Off: ${args.join(', ')}. ${restart}`);
}

const ALLOW_KEYS = { value: 'allowedValues', pattern: 'allowedPatterns', file: 'credentialFilesAllowed', folder: 'picturesAllowed' };

/** Sets how images, documents (PDFs, pasted Office files) or both are handled. */
function pictures() {
  const mode = args.pop();
  const kind = args[0];
  if (!['check', 'confirm', 'strict', 'off'].includes(mode) || (kind !== undefined && kind !== 'images' && kind !== 'documents')) fail('Use: pictures [images|documents] check|confirm|strict|off');
  if (orgPictures(kind)) fail('The organisation\'s settings set how these files are handled; that cannot be changed here.');
  const settings = own();
  const before = typeof settings.pictures === 'string' ? { images: settings.pictures, documents: settings.pictures } : { images: 'check', documents: 'check', ...(settings.pictures ?? {}) };
  const after = kind ? { ...before, [kind]: mode } : { images: mode, documents: mode };
  if (after.images === after.documents) settings.pictures = after.images;
  else settings.pictures = after;
  if (settings.pictures === 'check') delete settings.pictures;
  save(settings);
  console.log(`Images: ${after.images}. PDFs and pasted Office files: ${after.documents}. New sessions are told so; a running one applies it from its next tool call.`);
}

/** Whether the organisation's file sets the mode for this kind of file (or for any, without a kind). */
function orgPictures(kind) {
  const file = orgSettingsFile();
  if (!file) return false;
  try {
    const set = JSON.parse(readFileSync(file, 'utf8')).pictures;
    return typeof set === 'string' || (set && (kind ? set[kind] !== undefined : set.images !== undefined || set.documents !== undefined));
  } catch {
    return false;
  }
}

function allow(add) {
  const key = ALLOW_KEYS[args.shift()];
  if (!key || args.length === 0) fail('Use: allow value|pattern|file|folder <entry>... (and unallow the same way)');
  if (add && key === 'allowedPatterns') {
    for (const source of args) {
      try {
        new RegExp(`^(?:${source})$`);
      } catch (error) {
        fail(`The pattern ${source} does not compile (${error.message}).`);
      }
      const slow = tooSlow(source, '');
      if (slow) fail(`The pattern ${source} is not stored: ${slow}`);
    }
  }
  const changed = change(key, args, add);
  console.log(changed.length ? `${add ? 'Allowed' : 'No longer allowed'} (${key}): ${changed.length} entr${changed.length === 1 ? 'y' : 'ies'}. ${restart}` : 'Nothing changed.');
}

/**
 * Tries a pattern on texts that make a careless pattern crawl, in a process of its own with a time limit.
 * Returns the reason when it is too slow, else undefined.
 */
function tooSlow(pattern, flags, examples = []) {
  const code = `
    const regex = new RegExp(process.argv[1], process.argv[2] + 'g');
    // Long runs show a pattern whose cost grows with the square of the input; short runs that end in a
    // character the pattern cannot take show one whose cost doubles with every character.
    const probes = ['a1 '.repeat(10000), 'aA1-_.'.repeat(5000) + '!', '1 2-3.'.repeat(5000)];
    for (const run of ['a', 'A', '1', ' ', '-', '.', '_', 'ab', 'a1', 'a ']) probes.push(run.repeat(30000), run.repeat(32) + '!', run.repeat(4000) + '!');
    // A pattern that begins with fixed text only starts to work behind it: each example is stretched at
    // every position, so the run stands where the pattern's repetition is.
    for (const example of JSON.parse(process.argv[3]).slice(0, 3)) {
      for (let i = 0; i < Math.min(example.length, 40); i++) {
        const head = example.slice(0, i + 1);
        probes.push(head + example[i].repeat(32) + '!', head + example[i].repeat(4000) + '!');
      }
    }
    for (const probe of probes) { regex.lastIndex = 0; let n = 0; while (regex.exec(probe) && n++ < 100000) if (regex.lastIndex === 0) break; }
  `;
  const started = Date.now();
  const result = spawnSync(process.execPath, ['-e', code, pattern, flags, JSON.stringify(examples.filter((example) => typeof example === 'string'))], { timeout: 3000, encoding: 'utf8' });
  if (result.error || result.status !== 0) return `it takes too long on long runs of letters, digits or spaces (stopped after ${Date.now() - started} ms). Bound its repetitions, for example {1,40} in place of + or *.`;
  return undefined;
}

function add() {
  const file = args[0];
  if (!file || !existsSync(file)) fail('Use: add <rule.json>. The top of this file shows what the rule file holds.');
  let spec;
  try {
    spec = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${file} is no valid JSON (${error.message}).`);
  }
  const { match = [], noMatch = [], ...rule } = spec;
  let built;
  try {
    built = customRule(rule);
  } catch (error) {
    fail(`The rule is not stored: ${error.message}.`);
  }
  if (!Array.isArray(match) || match.length === 0) fail('The rule is not stored: "match" has to list at least one made-up value the rule must find.');
  const slow = tooSlow(rule.pattern, rule.flags ?? '', match);
  if (slow) fail(`The rule is not stored: ${slow}`);

  const finds = (value) => built.find(`before ${value} after`).length > 0;
  const missed = match.filter((value) => !finds(value));
  const caught = (Array.isArray(noMatch) ? noMatch : []).filter(finds);
  if (missed.length || caught.length) {
    if (missed.length) console.error(`The rule does not find: ${missed.join(' | ')}`);
    if (caught.length) console.error(`The rule finds what it should leave alone: ${caught.join(' | ')}`);
    fail(`The rule is not stored.${rule.check ? ` A value has to pass the "${rule.check}" checksum to count.` : ''}`);
  }

  const settings = own();
  if (loadSettings().locked.has(rule.id)) fail(`The organisation's settings already hold a rule "${rule.id}".`);
  const kept = listOf(settings, 'customRules').filter((existing) => existing?.id !== rule.id);
  const replaced = kept.length !== listOf(settings, 'customRules').length;
  settings.customRules = [...kept, { id: rule.id, kind: rule.kind, pattern: rule.pattern, flags: rule.flags, group: rule.group, keywords: rule.keywords, check: rule.check, description: rule.description }];
  save(settings);
  console.log(`${replaced ? 'Replaced' : 'Stored'}: ${rule.id} (${rule.kind}). It found ${match.length} of ${match.length} example(s) and left ${caught.length === 0 ? 'all' : 'not all'} ${noMatch.length} look-alike(s) alone. ${restart}`);
  console.log(`Next: node rules.mjs check ${rule.id}`);
}

function remove() {
  if (args.length === 0) fail('Name the rules of your own to take out.');
  const settings = own();
  const before = listOf(settings, 'customRules');
  const after = before.filter((rule) => !args.includes(rule?.id));
  if (after.length === before.length) fail(`None of ${args.join(', ')} is a rule of your own. Built-in rules are switched off with: disable <id>`);
  if (after.length) settings.customRules = after;
  else delete settings.customRules;
  for (const key of ['enabledRules', 'disabledRules']) {
    const left = listOf(settings, key).filter((id) => !args.includes(id));
    if (left.length) settings[key] = left;
    else delete settings[key];
  }
  save(settings);
  console.log(`Taken out: ${before.length - after.length} rule(s). ${restart}`);
}

async function test() {
  let text = args.join(' ');
  if (!text) for await (const chunk of process.stdin) text += chunk;
  const found = findSensitive(text);
  if (found.length === 0) return console.log('No rule finds anything in this text.');
  const perRule = new Map();
  for (const item of found) perRule.set(item.rule, (perRule.get(item.rule) ?? 0) + 1);
  for (const [rule, count] of perRule) console.log(`${rule}: ${count}`);
}

// --- check: would a rule get in the way? -------------------------------------------------------------------

function* transcripts(dir, since) {
  let entries = [];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {}
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* transcripts(path, since);
    else if (entry.name.endsWith('.jsonl') && statSync(path).mtimeMs >= since) yield path;
  }
}

const asText = (value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

/** What left the computer, what the user wrote and what tools returned, in the stored sessions of the last days. */
async function history(days) {
  const calls = [];
  const prompts = [];
  const outputs = [];
  for (const file of transcripts(join(configDir(), 'projects'), Date.now() - days * 86400000)) {
    for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
      if (!line.includes('"tool_use"') && !line.includes('"type":"user"')) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      const content = record.message?.content;
      if (record.type === 'user' && typeof content === 'string') prompts.push(content);
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'tool_use' && isOutbound(block.name, block.input)) calls.push(asText(block.input));
        else if (block?.type === 'text' && record.type === 'user') prompts.push(block.text ?? '');
        else if (block?.type === 'tool_result' && outputs.length < 20000) outputs.push(asText(block.content).slice(0, 200000));
      }
    }
  }
  return { calls, prompts, outputs };
}

async function check() {
  const days = Number(option('--days')) || 30;
  if (args.length === 0) fail('Name the rules to check, for example: check iban');
  const known = new Set(allRules().map((rule) => rule.id));
  for (const id of args) if (!known.has(id)) fail(`There is no rule "${id}". See: list`);
  console.log(`Reading the sessions of the last ${days} days ...`);
  const { calls, prompts, outputs } = await history(days);
  console.log(`${calls.length} call(s) that left the computer, ${prompts.length} message(s) of yours, ${outputs.length} tool result(s).\n`);

  for (const id of args) {
    // Each rule is run alone, whatever is switched on: another rule must not take its findings.
    const found = {};
    for (const [name, texts] of Object.entries({ calls, prompts, outputs })) {
      found[name] = { hits: 0, values: 0, sample: '' };
      for (const text of texts) {
        const spans = findWith(id, text);
        if (spans.length === 0) continue;
        found[name].hits++;
        found[name].values += spans.length;
        if (!found[name].sample) found[name].sample = `${text.slice(Math.max(0, spans[0][0] - 40), spans[0][0])}[...]${text.slice(spans[0][1], spans[0][1] + 30)}`.replace(/\s+/g, ' ');
      }
    }
    const reasons = [];
    if (found.calls.hits) reasons.push(`it would have refused ${found.calls.hits} of ${calls.length} calls that left the computer`);
    if (found.prompts.hits) reasons.push(`it would have stopped ${found.prompts.hits} of ${prompts.length} of your messages`);
    if (found.outputs.hits) reasons.push(`it would have hidden ${found.outputs.values} value(s) in ${found.outputs.hits} of ${outputs.length} tool results`);
    const share = outputs.length ? found.outputs.hits / outputs.length : 0;
    const verdict = found.calls.hits >= 2 || found.prompts.hits >= 3 || (found.outputs.hits >= 5 && share > 0.02) ? 'LIKELY IN THE WAY' : reasons.length ? 'MAY BE IN THE WAY' : 'no sign of trouble';
    console.log(`${id}: ${verdict}${reasons.length ? `: ${reasons.join('; ')}` : ' in this history'}.`);
    // The value itself is left out of the sample; what stands around it shows whether the find was right.
    for (const group of ['calls', 'prompts', 'outputs']) if (found[group].sample) console.log(`    e.g. (${group}) ...${found[group].sample}...`);
  }
}

const commands = { status, list, pictures, enable, disable, allow: () => allow(true), unallow: () => allow(false), add, remove, test, check };
if (!commands[command]) fail(`Commands: ${Object.keys(commands).join(', ')}. Checks a rule of your own can name: ${Object.keys(CHECKS).join(', ')}. See the top of this file.`);
await commands[command]();
