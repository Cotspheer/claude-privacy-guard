// Tests of the check for images and PDFs. They use the text recognition of Windows and are skipped elsewhere.
// Addresses are put together from parts, so this file stays editable under the hooks.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { closeGaps, isPicture } from './pictures.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const windows = process.platform === 'win32';
const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-pictures-'));
const emptyAllow = join(dir, 'allow.txt');
writeFileSync(emptyAllow, '# nothing\n');
const at = (local, domain) => [local, domain].join('@');
const address = at('scan.probe', 'mailbox-probe.io');

/** Draws lines of text into a PNG with the drawing library that ships with Windows. */
function image(name, lines) {
  const draw = lines.map((line, i) => `$g.DrawString('${line}', $f, [System.Drawing.Brushes]::Black, 30, ${20 + i * 70});`).join(' ');
  const script = `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap 900,220; $g = [System.Drawing.Graphics]::FromImage($b); $g.Clear([System.Drawing.Color]::White); $f = New-Object System.Drawing.Font 'Arial',28; ${draw} $b.Save('${join(dir, name)}', [System.Drawing.Imaging.ImageFormat]::Png)`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', script]);
  return join(dir, name);
}

function hook(script, payload, mode) {
  const settings = join(dir, `settings-${mode}.json`);
  writeFileSync(settings, JSON.stringify({ pictures: mode, picturesAllowed: [join(dir, 'allowed')] }));
  const result = spawnSync(process.execPath, [join(here, script)], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    env: { ...process.env, EMAIL_GUARD_ALLOW_FILE: emptyAllow, PRIVACY_GUARD_SETTINGS_FILE: settings, PRIVACY_GUARD_TERMS_FILE: join(dir, 'no-terms.txt') },
  });
  const json = result.stdout.startsWith('{') ? JSON.parse(result.stdout) : undefined;
  return { decision: json?.hookSpecificOutput?.permissionDecision ?? json?.decision ?? 'pass', reason: json?.hookSpecificOutput?.permissionDecisionReason ?? json?.reason ?? '' };
}
const read = (path, mode) => hook('email-guard.mjs', { tool_name: 'Read', tool_input: { file_path: path } }, mode);

test('isPicture and closeGaps', () => {
  assert.equal(isPicture('C:/x/scan.PNG'), true);
  assert.equal(isPicture('report.pdf'), true);
  assert.equal(isPicture('notes.txt'), false);
  assert.equal(closeGaps('owner: a.b @ site. io and more'), `owner: ${at('a.b', 'site.io')} and more`);
});

test('a picture with an address is refused, a clean one passes, and the reason does not repeat the address', { skip: !windows }, () => {
  const scan = image('scan.png', ['Meeting note', `owner: ${address}`]);
  const clean = image('clean.png', ['Quarterly chart, no names']);
  const refused = read(scan, 'check');
  assert.equal(refused.decision, 'deny');
  assert.match(refused.reason, /1 email address/);
  assert.match(refused.reason, /extract-text\.mjs/);
  assert.ok(!refused.reason.includes(address));
  assert.equal(read(clean, 'check').decision, 'pass');

  assert.equal(read(clean, 'confirm').decision, 'ask');
  assert.equal(read(scan, 'confirm').decision, 'deny');
  assert.equal(read(clean, 'strict').decision, 'deny');
  assert.equal(read(scan, 'off').decision, 'pass');

  const prompt = hook('prompt-check.mjs', { cwd: dir, prompt: 'what is in @scan.png and @clean.png' }, 'check');
  assert.equal(prompt.decision, 'block');
  assert.match(prompt.reason, /scan\.png \(1 email address/);
  assert.ok(!prompt.reason.includes('clean.png ('));

  const text = spawnSync(process.execPath, [join(here, 'extract-text.mjs'), scan], { encoding: 'utf8' }).stdout;
  assert.match(text, /Meeting note/);
  assert.ok(text.includes(address));
});

test('check-media reports what a pasted picture holds, by kind and count only', { skip: !windows }, () => {
  const scan = image('pasted-scan.png', [`owner: ${address}`]);
  const clean = image('pasted-clean.png', ['Quarterly chart, no names']);
  const check = (file, mode) => {
    const settings = join(dir, `paste-${mode}.json`);
    writeFileSync(settings, JSON.stringify({ pictures: mode }));
    const result = spawnSync(process.execPath, [join(here, 'check-media.mjs')], {
      input: JSON.stringify({ mediaType: 'image/png', base64: readFileSync(file).toString('base64') }),
      encoding: 'utf8',
      env: { ...process.env, EMAIL_GUARD_ALLOW_FILE: emptyAllow, PRIVACY_GUARD_SETTINGS_FILE: settings, PRIVACY_GUARD_TERMS_FILE: join(dir, 'no-terms.txt') },
    });
    assert.ok(!result.stdout.includes(address));
    return JSON.parse(result.stdout);
  };
  assert.deepEqual(check(scan, 'check'), { mode: 'check', found: ['1 email address(es)'] });
  assert.deepEqual(check(clean, 'confirm'), { mode: 'confirm', found: [] });
  assert.deepEqual(check(scan, 'off'), { mode: 'off', found: [] });
});
