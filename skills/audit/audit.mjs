#!/usr/bin/env node
// Reports where email addresses stand, without ever printing one: only mail domains, tools, sessions and files.
//
//   node audit.mjs                       Claude Code's stored sessions (the config folder's "projects")
//   node audit.mjs --days 30             only sessions changed in the last 30 days
//   node audit.mjs --transcripts <dir>   another folder of session transcripts
//   node audit.mjs --files <dir>         the files of a folder, such as a repository

import { createReadStream, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { createInterface } from 'node:readline';
import { blockedDomains, configDir, loadAllow } from '../../scripts/lib.mjs';

const args = process.argv.slice(2);
const option = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined);
const days = Number(option('--days')) || 0;
const allow = loadAllow();

const SKIP_DIRS = new Set(['.git', 'node_modules', 'bin', 'obj', 'dist', 'build', 'out', '.venv', '__pycache__']);

function* walk(dir, wanted) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) yield* walk(path, wanted);
    } else if (entry.isFile() && wanted(entry.name)) yield path;
  }
}

const tally = (map, key, by = 1) => map.set(key, (map.get(key) ?? 0) + by);
const top = (map, limit = 12) =>
  [...map]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, count]) => `${key} (${count})`)
    .join(', ');
const asText = (value) => (typeof value === 'string' ? value : (JSON.stringify(value) ?? ''));

async function auditTranscripts(root) {
  const since = days ? Date.now() - days * 86400000 : 0;
  const domains = new Map();
  const sessions = [];
  let files = 0;
  let contextOnly = 0;

  for (const file of walk(root, (name) => name.endsWith('.jsonl'))) {
    if (since && statSync(file).mtimeMs < since) continue;
    files++;
    const session = { file: relative(root, file), title: '', first: '', calls: [], results: 0, elsewhere: 0 };
    const seen = new Set();
    for await (const line of createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity })) {
      if (!session.title && line.includes('Title"')) {
        try {
          const record = JSON.parse(line);
          session.title = record.customTitle ?? record.aiTitle ?? '';
        } catch {}
      }
      if (!line.includes('@') && !line.includes('%40')) continue;
      if (blockedDomains(line, allow).length === 0) continue;
      let record;
      try {
        record = JSON.parse(line);
      } catch {
        continue;
      }
      session.first ||= record.timestamp ?? '';
      const content = record.message?.content;
      let placed = false;
      for (const block of Array.isArray(content) ? content : []) {
        if (block?.type === 'tool_use' && !seen.has(block.id)) {
          seen.add(block.id);
          for (const [field, value] of Object.entries(block.input ?? {})) {
            const found = blockedDomains(asText(value), allow);
            if (found.length === 0) continue;
            placed = true;
            found.forEach((domain) => tally(domains, `@${domain}`));
            session.calls.push(`${(record.timestamp ?? '').slice(0, 16)} ${block.name} ${field} (${found.length}) ${[...new Set(found)].map((d) => `@${d}`).join(' ')}`);
          }
        } else if (block?.type === 'tool_result' && blockedDomains(asText(block.content), allow).length > 0) {
          placed = true;
          session.results++;
        }
      }
      if (!placed) session.elsewhere++;
    }
    if (session.calls.length > 0 || session.results > 0) sessions.push(session);
    else if (session.elsewhere > 0) contextOnly++;
  }

  const withCalls = sessions.filter((session) => session.calls.length > 0);
  console.log(`Transcripts: ${files} files under ${root}${days ? `, changed in the last ${days} days` : ''}`);
  console.log(`Sessions with an address in a tool call: ${withCalls.length}`);
  for (const session of withCalls) {
    console.log(`\n  ${session.file}${session.title ? `\n  "${session.title}"` : ''}`);
    session.calls.slice(0, 20).forEach((call) => console.log(`    ${call}`));
    if (session.calls.length > 20) console.log(`    ... and ${session.calls.length - 20} more`);
  }
  console.log(`\nSessions where an address came back in tool output: ${sessions.filter((session) => session.results > 0).length}`);
  for (const session of sessions.filter((item) => item.results > 0)) console.log(`  ${session.file} (${session.results} results)${session.title ? ` "${session.title}"` : ''}`);
  console.log(`\nSessions that hold an address only in their context or in messages: ${contextOnly}`);
  console.log(`Domains in tool calls: ${top(domains) || 'none'}`);
}

function auditFiles(root) {
  const domains = new Map();
  const hits = [];
  let files = 0;
  for (const file of walk(root, () => true)) {
    let text;
    try {
      if (statSync(file).size > 2 * 1024 * 1024) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\u0000')) continue;
    files++;
    const found = blockedDomains(text, allow);
    if (found.length === 0) continue;
    found.forEach((domain) => tally(domains, `@${domain}`));
    hits.push(`  ${relative(root, file)} (${found.length}) ${[...new Set(found)].map((d) => `@${d}`).join(' ')}`);
  }
  console.log(`Files: ${files} text files under ${root} (folders such as .git and node_modules skipped)`);
  console.log(`Files that hold an address: ${hits.length}`);
  hits.slice(0, 200).forEach((hit) => console.log(hit));
  if (hits.length > 200) console.log(`  ... and ${hits.length - 200} more`);
  console.log(`Domains: ${top(domains) || 'none'}`);
}

if (option('--files')) auditFiles(option('--files'));
else await auditTranscripts(option('--transcripts') ?? join(configDir(), 'projects'));
