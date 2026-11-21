// The guard's settings, from privacy-guard.json in the Claude config folder. Every key is optional.
//
//   pictures                 "check" | "confirm" | "strict" | "off"       see pictures.mjs
//   picturesAllowed          folders whose pictures pass in "strict"
//   credentialFiles          "guard" | "off"                              see credentials.mjs
//   credentialFilesAllowed   file patterns the credential guard leaves alone, such as ".env.test"
//   enabledRules             ids of rules that are off unless named here, such as "iban"
//   disabledRules            ids of rules to switch off
//   allowedValues            exact values no rule reports, such as a documented example key
//   allowedPatterns          regular expressions; a value one of them matches whole is not reported

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configDir } from './lib.mjs';

export function settingsFile() {
  return process.env.PRIVACY_GUARD_SETTINGS_FILE ?? join(configDir(), 'privacy-guard.json');
}

let cached;

export function loadSettings() {
  if (cached) return cached;
  let settings = {};
  try {
    const file = settingsFile();
    if (existsSync(file)) settings = JSON.parse(readFileSync(file, 'utf8')) ?? {};
  } catch {}
  const list = (value) => (Array.isArray(value) ? value.filter((item) => typeof item === 'string' && item) : typeof value === 'string' && value ? [value] : []);
  cached = {
    pictures: ['check', 'confirm', 'strict', 'off'].includes(settings.pictures) ? settings.pictures : 'check',
    picturesAllowed: list(settings.picturesAllowed),
    credentialFiles: settings.credentialFiles === 'off' ? 'off' : 'guard',
    credentialFilesAllowed: list(settings.credentialFilesAllowed),
    enabledRules: list(settings.enabledRules),
    disabledRules: list(settings.disabledRules),
    allowedValues: list(settings.allowedValues),
    allowedPatterns: list(settings.allowedPatterns),
  };
  return cached;
}

/** Permission modes in which a question to the person is settled without showing it to them. */
export function cannotAsk(permissionMode) {
  return ['auto', 'bypassPermissions', 'dontAsk'].includes(permissionMode);
}
