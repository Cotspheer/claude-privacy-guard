// The guard's settings, from privacy-guard.json in the Claude config folder. Every key is optional.
//
//   pictures                 "check" | "confirm" | "strict" | "off"       see pictures.mjs; or one mode per kind
//                            of file: { "images": "off", "documents": "check" } (documents: PDFs and
//                            pasted Office files)
//   picturesAllowed          folders whose pictures pass in "strict"
//   credentialFiles          "guard" | "off"                              see credentials.mjs
//   credentialFilesAllowed   file patterns the credential guard leaves alone, such as ".env.test"
//   enabledRules             ids of rules that are off unless named here, such as "iban"
//   disabledRules            ids of rules to switch off
//   allowedValues            exact values no rule reports, such as a documented example key
//   allowedPatterns          regular expressions; a value one of them matches whole is not reported
//   customRules              rules of the person's own, see rules.mjs
//
// An organisation can lay a second file under the person's own: the file PRIVACY_GUARD_ORG_SETTINGS names
// (set through the `env` of managed settings), or privacy-guard.org.json in the plugin's folder (an
// organisation's own copy of the plugin). Its rules are added to the person's, and what it switches on, the
// person's file cannot switch off.

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { configDir } from './lib.mjs';

export function settingsFile() {
  return process.env.PRIVACY_GUARD_SETTINGS_FILE ?? join(configDir(), 'privacy-guard.json');
}

/** The organisation's file, or undefined where there is none. */
export function orgSettingsFile() {
  const named = process.env.PRIVACY_GUARD_ORG_SETTINGS;
  const shipped = join(dirname(fileURLToPath(import.meta.url)), '..', 'privacy-guard.org.json');
  return [named, shipped].find((file) => file && existsSync(file));
}

function read(file) {
  try {
    const settings = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
    return settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  } catch {
    return {};
  }
}

const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : typeof value === 'string' && value ? [value] : []);
const rules = (value) => (Array.isArray(value) ? value.filter((rule) => rule && typeof rule === 'object' && typeof rule.id === 'string' && typeof rule.pattern === 'string') : []);

const PICTURE_MODES = ['check', 'confirm', 'strict', 'off'];

/** The mode for one kind of file: the organisation's word first, then the person's, then "check". */
function pictureMode(kind, ...files) {
  for (const file of files) {
    const value = typeof file.pictures === 'string' ? file.pictures : file.pictures?.[kind];
    if (PICTURE_MODES.includes(value)) return value;
  }
  return 'check';
}

let cached;

export function loadSettings() {
  if (cached) return cached;
  const own = read(settingsFile());
  const org = read(orgSettingsFile());
  const orgRules = rules(org.customRules);
  const taken = new Set(orgRules.map((rule) => rule.id));
  // What the organisation switches on stays on: its rules and the rules it enables.
  const locked = new Set([...list(org.enabledRules), ...taken]);
  const pick = (key, values, fallback) => [org[key], own[key]].find((value) => values.includes(value)) ?? fallback;
  cached = {
    pictures: { images: pictureMode('images', org, own), documents: pictureMode('documents', org, own) },
    picturesAllowed: [...list(org.picturesAllowed), ...list(own.picturesAllowed)],
    credentialFiles: pick('credentialFiles', ['guard', 'off'], 'guard'),
    credentialFilesAllowed: [...list(org.credentialFilesAllowed), ...list(own.credentialFilesAllowed)],
    enabledRules: [...locked, ...list(own.enabledRules)],
    disabledRules: [...list(org.disabledRules), ...list(own.disabledRules).filter((id) => !locked.has(id) && !(locked.has('personal') && PERSONAL_IDS.includes(id)))],
    allowedValues: [...list(org.allowedValues), ...list(own.allowedValues)],
    allowedPatterns: [...list(org.allowedPatterns), ...list(own.allowedPatterns)],
    customRules: [...orgRules, ...rules(own.customRules).filter((rule) => !taken.has(rule.id))],
    locked,
  };
  return cached;
}

/** The rules "personal" in enabledRules stands for. */
export const PERSONAL_IDS = ['iban', 'ch-ahv-number', 'payment-card', 'phone-number', 'us-ssn'];

/** Permission modes in which a question to the person is settled without showing it to them. */
export function cannotAsk(permissionMode) {
  return ['auto', 'bypassPermissions', 'dontAsk'].includes(permissionMode);
}
