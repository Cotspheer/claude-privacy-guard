// INSTALL.md carries a copy of the skill so that a web chat, which has only that one file, can build it.
// This test keeps the copy and the skill file identical.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => readFileSync(join(root, ...parts), 'utf8').replace(/\r\n/g, '\n');

test('the skill inside INSTALL.md equals skills/email-address-privacy/SKILL.md', () => {
  const install = read('INSTALL.md');
  const block = install.slice(install.indexOf('<!-- skill:start -->'), install.indexOf('<!-- skill:end -->'));
  const lines = block.split('\n');
  const open = lines.findIndex((line) => line.startsWith('````'));
  const close = lines.findLastIndex((line) => line.startsWith('````'));
  assert.ok(open >= 0 && close > open, 'the fenced block is missing');
  assert.equal(`${lines.slice(open + 1, close).join('\n')}\n`, read('skills', 'email-address-privacy', 'SKILL.md'));
});

test('the settings files parse and the managed example names the plugin', () => {
  const files = ['telemetry-off.light.json', 'telemetry-off.keep-updates.json', 'telemetry-off.strict.json', 'managed-settings.example.json', 'hardening.json', 'repository-hooks.json'];
  for (const file of files) {
    JSON.parse(read('settings', file));
  }
  const managed = JSON.parse(read('settings', 'managed-settings.example.json'));
  const plugin = JSON.parse(read('.claude-plugin', 'plugin.json')).name;
  const marketplace = JSON.parse(read('.claude-plugin', 'marketplace.json')).name;
  assert.equal(managed.enabledPlugins[`${plugin}@${marketplace}`], true);
  assert.ok(managed.extraKnownMarketplaces[marketplace]);
  // The three entries that put the plugin on the organisation's tier.
  assert.deepEqual(managed.appendPlugins, [`${plugin}@${marketplace}`]);
  assert.ok(['github', 'git', 'url'].includes(managed.extraKnownMarketplaces[marketplace].source.source));
});

test('the host block list holds no host that sign-in, the model API, Remote Control or updates need', () => {
  const sections = { default: [], extended: [], needed: [] };
  let section;
  for (const raw of read('scripts', 'telemetry-hosts.txt').split('\n')) {
    const line = raw.replace(/#.*$/, '').trim();
    const header = /^\[(.+)\]$/.exec(line);
    if (header) section = header[1];
    else if (line) sections[section].push(line);
  }
  assert.equal(sections.default.length, 9);
  assert.equal(sections.extended.length, 4);
  const all = [...sections.default, ...sections.extended];
  assert.equal(new Set(all).size, all.length, 'a host is listed twice');
  const needed = ['api.anthropic.com', 'claude.ai', 'claude.com', 'platform.claude.com', 'sso.claude.com', 'downloads.claude.ai', 'mcp-proxy.anthropic.com', 's-cdn.anthropic.com', 'statsig.anthropic.com', 'sentry.io', 'github.com', 'registry.npmjs.org'];
  for (const name of needed) assert.ok(sections.needed.includes(name), `${name} must be listed as needed`);
  const stays = (host) => sections.needed.some((entry) => (entry.startsWith('*.') ? host.endsWith(entry.slice(1)) : host === entry));
  for (const host of all) {
    assert.match(host, /^[a-z0-9.-]+\.[a-z]{2,}$/, host);
    assert.ok(!stays(host), `${host} must stay reachable`);
  }
});

test('both block scripts take their hosts from the list and leave the needed ones alone', () => {
  const list = read('scripts', 'telemetry-hosts.txt');
  for (const script of ['block-telemetry-hosts.ps1', 'block-telemetry-hosts.sh']) {
    const source = read('scripts', script);
    assert.ok(source.includes('telemetry-hosts.txt'), script);
    assert.ok(!source.includes('needed'), `${script} must not read the needed group`);
  }
  assert.ok(list.includes('[needed]'));
});

test('the checks open no network connection: only the optional host check may', () => {
  const network = /node:(http|https|http2|net|dgram|tls|dns)|\bfetch\(|XMLHttpRequest|WebSocket/;
  const files = [
    ...readdirSync(join(root, 'scripts')).filter((name) => name.endsWith('.mjs') && !name.endsWith('.test.mjs')).map((name) => ['scripts', name]),
    ['skills', 'audit', 'audit.mjs'],
    ['skills', 'terms', 'terms.mjs'],
  ];
  assert.ok(files.length >= 8);
  for (const parts of files) assert.ok(!network.test(read(...parts)), `${parts.join('/')} must not use the network`);
  assert.ok(network.test(read('skills', 'audit', 'check-hosts.mjs')));
});
