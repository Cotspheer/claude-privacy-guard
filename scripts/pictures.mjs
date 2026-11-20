// Images and PDFs reach Claude as pictures or whole documents, which no hook can mask. So the guard reads
// their text itself, on this computer, before Claude opens them.

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir } from './lib.mjs';
import { isOffice, readOffice } from './office.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const IMAGES = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.tif', '.tiff']);

/** The script Claude runs to get a picture's text in place of the picture. */
export const extractScript = join(here, 'extract-text.mjs');

export function isPicture(path) {
  const extension = extname(path).toLowerCase();
  return extension === '.pdf' || IMAGES.has(extension);
}

/** A file whose content the guard reads itself: a picture, a PDF or an Office document. */
export function isDocument(path) {
  return isPicture(path) || isOffice(path);
}

/** Embedded pictures are read up to this many per document. */
const PICTURE_LIMIT = 15;

/** The text of an Office file: its own text, then the text read from each picture embedded in it. */
function textOfOffice(path) {
  let content;
  try {
    content = readOffice(path);
  } catch (error) {
    return { unavailable: `the file could not be opened as an Office document (${error.message})` };
  }
  const parts = [content.text];
  const unread = [];
  if (content.pictures.length > 0) {
    const dir = mkdtempSync(join(tmpdir(), 'privacy-guard-office-'));
    try {
      content.pictures.slice(0, PICTURE_LIMIT).forEach((picture, index) => {
        const file = join(dir, `picture${index}${extname(picture.name).toLowerCase()}`);
        writeFileSync(file, picture.bytes);
        const read = textOf(file);
        if (read.text === undefined) unread.push(picture.name);
        else if (read.text.trim()) parts.push(`[text read from the embedded picture ${picture.name}]\n${read.text.trim()}`);
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    if (content.pictures.length > PICTURE_LIMIT) unread.push(`${content.pictures.length - PICTURE_LIMIT} more pictures`);
  }
  if (unread.length > 0) parts.push(`[embedded pictures the guard could not read: ${unread.join(', ')}]`);
  return { text: parts.filter(Boolean).join('\n\n'), unread };
}

/**
 * How pictures are handled, from privacy-guard.json in the Claude config folder:
 *   "check"    (default) read the text first; refuse the picture when it holds an address, a secret or a term
 *   "confirm"  the same check, and the person is asked before every picture Claude opens
 *   "strict"   no pictures, except below the folders in "picturesAllowed"
 *   "off"      pictures pass unread
 */
export function pictureSettings() {
  const file = process.env.PRIVACY_GUARD_SETTINGS_FILE ?? join(configDir(), 'privacy-guard.json');
  let settings = {};
  try {
    if (existsSync(file)) settings = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  const mode = ['check', 'confirm', 'strict', 'off'].includes(settings.pictures) ? settings.pictures : 'check';
  const allowed = Array.isArray(settings.picturesAllowed) ? settings.picturesAllowed.map((folder) => resolve(String(folder)).toLowerCase()) : [];
  return { mode, isAllowed: (path) => allowed.some((folder) => resolve(path).toLowerCase().startsWith(folder)) };
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 25000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return result.status === 0 ? result.stdout : undefined;
}

/**
 * The text of an image, a PDF or an Office document as { text }, or { unavailable: reason } when this computer
 * has no way to read it. Windows: its built-in text recognition. Elsewhere: pdftotext for PDFs and tesseract for images, if installed.
 */
export function textOf(path) {
  if (!existsSync(path)) return { unavailable: 'the file does not exist' };
  if (isOffice(path)) return textOfOffice(path);
  if (process.platform === 'win32') {
    const text = run('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(here, 'read-text.ps1'), '-Path', path]);
    return text === undefined ? { unavailable: 'the text recognition of Windows could not read it' } : { text };
  }
  if (extname(path).toLowerCase() === '.pdf') {
    const text = run('pdftotext', ['-l', '10', path, '-']);
    if (text !== undefined && text.trim()) return { text };
    return { unavailable: text === undefined ? 'pdftotext is not installed' : 'the PDF holds no text (a scan); reading it needs tesseract' };
  }
  const text = run('tesseract', [path, 'stdout']);
  return text === undefined ? { unavailable: 'tesseract is not installed' } : { text };
}

/** Recognised text with the gaps closed that recognition tends to put around "@" and before a domain ending. */
export function closeGaps(text) {
  return text.replace(/\s*@\s*/g, '@').replace(/\.\s+(?=[a-z]{2,6}\b)/gi, '.');
}
