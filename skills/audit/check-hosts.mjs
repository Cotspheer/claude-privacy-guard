#!/usr/bin/env node
// Shows which hosts Claude Code or the Claude desktop app contact, by sending their traffic through a logging
// proxy on this computer. HTTPS passes through untouched, so the proxy sees host names and byte counts, never
// content. Each host is then compared with scripts/telemetry-hosts.txt: blocked, needed, or new.
//
//   node check-hosts.mjs cli                      one short Claude Code turn with your own settings
//   node check-hosts.mjs cli --default-settings   the same turn without your settings, as a fresh install sends
//   node check-hosts.mjs listen [--minutes 10] [--port 58555] [--out report.txt]
//                                                 log whatever is pointed at the proxy, for the desktop app
//
// A program that ignores the proxy setting is not seen here.

import { spawn, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const mode = args.shift();
const option = (name, fallback) => (args.includes(name) ? args[args.indexOf(name) + 1] : fallback);

/** The three groups of telemetry-hosts.txt as [{ host, group, purpose }]. */
function knownHosts() {
  const file = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'scripts', 'telemetry-hosts.txt');
  const known = [];
  let group = '';
  for (const raw of readFileSync(file, 'utf8').split(/\r?\n/)) {
    const [text, purpose = ''] = raw.split('#').map((part) => part.trim());
    const header = /^\[(.+)\]$/.exec(text);
    if (header) group = header[1];
    else if (text) known.push({ host: text, group, purpose });
  }
  return known;
}

function classify(host, known) {
  const entry = known.find((item) => (item.host.startsWith('*.') ? host.endsWith(item.host.slice(1)) : host === item.host));
  return entry ?? { group: 'new', purpose: '' };
}

/** Starts the proxy. Resolves to { hosts, close }, where hosts fills up as connections end. */
function startProxy(port) {
  const hosts = new Map();
  // "failed" counts connections that never reached the host, as when this computer's hosts file blocks it.
  const note = (host, change) => {
    const row = hosts.get(host) ?? { connections: 0, up: 0, down: 0, failed: 0 };
    hosts.set(host, { ...row, ...change(row) });
  };
  const server = http.createServer((request, response) => {
    note(request.headers.host ?? '(plain http)', (row) => ({ connections: row.connections + 1 }));
    response.writeHead(502).end();
  });
  server.on('connect', (request, client, head) => {
    const [host, targetPort] = request.url.split(':');
    let up = head.length;
    let down = 0;
    let done = false;
    let reached = false;
    const upstream = net.connect(Number(targetPort) || 443, host, () => {
      reached = true;
      client.write('HTTP/1.1 200 Connection Established\r\n\r\n');
      if (head.length) upstream.write(head);
      client.pipe(upstream);
      upstream.pipe(client);
    });
    const finish = () => {
      if (done) return;
      done = true;
      note(host, (row) => ({ connections: row.connections + 1, up: row.up + up, down: row.down + down, failed: row.failed + (reached ? 0 : 1) }));
      client.destroy();
      upstream.destroy();
    };
    client.on('data', (chunk) => (up += chunk.length));
    upstream.on('data', (chunk) => (down += chunk.length));
    for (const socket of [client, upstream]) socket.on('error', finish).on('close', () => finish());
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ hosts, port: server.address().port, close: () => server.close() })));
}

function report(hosts, title) {
  const known = knownHosts();
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;
  const labels = { default: 'TELEMETRY (block list)', extended: 'TELEMETRY (extended list)', needed: 'needed', new: 'NEW, on no list' };
  const rows = [...hosts].map(([host, row]) => ({ host, ...row, ...classify(host, known) })).sort((a, b) => b.up - a.up);
  const lines = [title, ''];
  for (const row of rows) {
    const reached = row.failed === row.connections ? 'did not connect (blocked on this computer?)' : `sent ${kb(row.up)}, received ${kb(row.down)}`;
    lines.push(`${labels[row.group].padEnd(26)} ${row.host.padEnd(40)} ${String(row.connections).padStart(3)} conn   ${reached}${row.purpose ? `   # ${row.purpose}` : ''}`);
  }
  if (rows.length === 0) lines.push('No connection came through the proxy. The program may ignore the proxy setting.');
  const telemetry = rows.filter((row) => (row.group === 'default' || row.group === 'extended') && row.failed < row.connections);
  const unknown = rows.filter((row) => row.group === 'new');
  lines.push('');
  if (unknown.length) lines.push(`${unknown.length} host(s) are on no list. Find out what they are before trusting the block list: ${unknown.map((row) => row.host).join(', ')}`);
  else if (rows.length) lines.push('Every host seen is on a list.');
  if (telemetry.length) lines.push(`Telemetry reached ${telemetry.map((row) => row.host).join(', ')}. The host block is not active here, or the settings still send it.`);
  else if (rows.length) lines.push('No telemetry-only host was reached.');
  lines.push('Telemetry that shares a host with the app or the model API (api.anthropic.com, claude.ai) cannot be told apart here.');
  return lines.join('\n');
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

if (mode === 'cli') {
  const proxy = await startProxy(0);
  const address = `http://127.0.0.1:${proxy.port}`;
  const env = { ...process.env, HTTPS_PROXY: address, HTTP_PROXY: address, https_proxy: address, http_proxy: address };
  delete env.NO_PROXY;
  delete env.no_proxy;
  // Telemetry switches that the calling shell carries would be passed on and hide what a normal start sends,
  // which happens when an agent runs this from inside a session. Claude Code still applies the ones in the
  // user's settings files itself.
  const switches = ['DISABLE_TELEMETRY', 'DISABLE_ERROR_REPORTING', 'DISABLE_FEEDBACK_COMMAND', 'DISABLE_AUTOUPDATER', 'DISABLE_UPDATES', 'DO_NOT_TRACK'];
  const dropped = Object.keys(env).filter((name) => switches.includes(name) || /^CLAUDE_CODE_DISABLE_(NONESSENTIAL_TRAFFIC|FEATURE_FLAGS|FEEDBACK_SURVEY)$/.test(name));
  for (const name of dropped) delete env[name];
  if (dropped.length) console.log(`Not passed on from this shell: ${dropped.join(', ')}`);
  const settings = args.includes('--default-settings');
  console.log(`Running one short Claude Code turn through the proxy${settings ? ', without your settings' : ', with your settings'} ...`);
  // The turn has to outlast Claude Code's telemetry timer (events go out in batches every 15 seconds), so it
  // runs one command that waits.
  const prompt = 'Run this shell command and wait for it to end: node -e "setTimeout(Object,20000)" Then reply with the single word ok.';
  const claudeArgs = ['-p', '--model', 'haiku', ...(settings ? ['--setting-sources', 'project'] : []), '--allowedTools', 'Bash', 'PowerShell', '--', prompt];
  // On Windows the program is started by its full path: going through a shell would mangle the quotes.
  const found = process.platform === 'win32' ? spawnSync('where', ['claude'], { encoding: 'utf8' }).stdout.split(/\r?\n/).find((path) => path.toLowerCase().endsWith('.exe')) : 'claude';
  if (!found) {
    console.error('claude.exe was not found on the PATH.');
    process.exit(1);
  }
  // Not spawnSync: that would stop this process, and the proxy with it, until Claude Code ends.
  const started = Date.now();
  const run = await new Promise((resolve) => {
    const child = spawn(found, claudeArgs, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', (chunk) => (output += chunk));
    child.stderr.on('data', (chunk) => (output += chunk));
    const timer = setTimeout(() => child.kill(), 180000);
    child.on('close', (status) => {
      clearTimeout(timer);
      resolve({ status, output });
    });
  });
  const seconds = Math.round((Date.now() - started) / 1000);
  if (run.status !== 0) console.log(`Claude Code ended with an error: ${run.output.trim().slice(0, 300)}`);
  else console.log(`The turn took ${seconds} s and answered: ${run.output.trim().slice(0, 80)}`);
  if (seconds < 18) console.log('That is shorter than the telemetry timer. The command that waits did not run, so a telemetry host may be missing below.');
  await sleep(3000);
  console.log(report(proxy.hosts, `\nHosts Claude Code contacted${settings ? ' (default settings)' : ' (your settings)'}:`));
  proxy.close();
  process.exit(0);
} else if (mode === 'listen') {
  const minutes = Number(option('--minutes', 10));
  const proxy = await startProxy(Number(option('--port', 58555)));
  const out = option('--out');
  console.log(`Logging proxy on http://127.0.0.1:${proxy.port} for ${minutes} minute(s). Point a program at it; Ctrl+C ends early.`);
  const finish = () => {
    const text = report(proxy.hosts, `Hosts contacted through the proxy in up to ${minutes} minute(s):`);
    console.log(`\n${text}`);
    if (out) writeFileSync(out, `${text}\n`);
    process.exit(0);
  };
  process.on('SIGINT', finish);
  setTimeout(finish, minutes * 60000);
} else {
  console.error('Usage: check-hosts.mjs cli [--default-settings] | listen [--minutes 10] [--port 58555] [--out report.txt]');
  process.exit(1);
}
