---
name: rules
description: Manage the privacy guard's rules for secrets and personal data. Switches rules on and off (IBAN, Swiss AHV number, payment card, phone number, US social security number), allows single values or files a rule is wrong about, and builds a new rule from the user's description of what to protect (a matter number, a customer id, a patient number, an internal token format), tests it and checks against the user's own session history whether it would get in their way. Use when the user wants to protect a kind of value, asks which rules exist or why a value was hidden or a call refused, wants to stop a false alarm, or sets rules up for a team or an organisation.
---

# Rules for secrets and personal data

Everything goes through the script `rules.mjs` in this skill's folder (`${CLAUDE_SKILL_DIR}/rules.mjs`), run with
Node. It is the one place that writes the guard's settings (`privacy-guard.json` in the Claude config folder).
Do not edit that file yourself.

| Task | Command |
|---|---|
| What is on, what is allowed | `node rules.mjs status` |
| Every rule's id | `node rules.mjs list` or `list stripe` |
| Switch personal data rules on | `node rules.mjs enable iban ch-ahv-number` (`personal` for all five) |
| Switch a rule off | `node rules.mjs disable phone-number` |
| A value no rule should report | `node rules.mjs allow value "CH93 0076 2011 6238 5295 7"` |
| A kind of value no rule should report | `node rules.mjs allow pattern "TEST-[0-9]{6}"` |
| A file the credential guard leaves alone | `node rules.mjs allow file ".env.test"` |
| Take an allowance back | `node rules.mjs unallow value|pattern|file "<entry>"` |
| How images and PDFs are handled | `node rules.mjs pictures off` or `pictures images off`, `pictures documents confirm` |
| A folder whose pictures pass in "strict" and "confirm" | `node rules.mjs allow folder "<folder>"` |
| A rule of the user's own | `node rules.mjs add <rule.json>` |
| Take such a rule out | `node rules.mjs remove <id>` |
| Which rules find something in a text | `node rules.mjs test "<text>"` |
| Would a rule get in the way | `node rules.mjs check <id>` |

What tightens the guard runs at once: `enable`, `add`. What loosens it brings up a question to the user, by
design: `disable`, `allow`, `remove`, `pictures`. Say before you run one of those what it does and why; in a permission mode
where no question reaches the user it is refused, and then you give them the command to run themselves, in a
message of its own with the command alone in a code block.

## Offering the rules

When the user asks what the guard can protect, run `status` and tell them in plain words:

- Secrets are on without a choice.
- Personal data is off until they switch it on. Name the five rules and what each costs: `iban`,
  `ch-ahv-number` and `payment-card` are validated by checksum and are rarely wrong; `phone-number` gets in the
  way where contact data is the work itself; `us-ssn` is only of use with US records.
- A kind of value of their own (a matter number, a customer id) can become a rule: see below.

Ask which ones they want, one question, then run `enable`, then `check` on each rule you switched on, and
report as described under "After every enable and add".

## A new rule from a description

A rule is data: a pattern, and optionally a checksum. It holds no code. Build it in this order.

1. **Ask what the value looks like**, not for real values. You need: what it is called, how it is written
   (letters, digits, separators, length), whether it carries a check digit, and what stands near it in text
   ("Matter no.", "Kundennummer"). Ask for two or three made-up examples in the real format, and for
   look-alikes that must not match (an invoice number of a similar shape, a date, a phone number).
   If the user pastes real values, use them for the pattern only where they are clearly not sensitive;
   otherwise make up values of the same shape and say so.
2. **Decide the kind**: `personal` for something that identifies a person or a client, `secret` for a
   credential. The kind only sets what a hidden value reads as.
3. **Write the pattern** as a JavaScript regular expression:
   - Anchor it with what cannot stand next to the value: `(?<![A-Za-z0-9])` in front, `(?![A-Za-z0-9])` behind.
     `\b` is fine where the value begins and ends with a letter or digit.
   - Bound every repetition (`{4}`, `{1,40}`), never `+` or `*` on a wide class. The script refuses a pattern
     that crawls on long input.
   - Allow the separators people really type (space, hyphen, dot) and nothing more.
   - Use `"flags": "i"` when case varies.
   - If only part of the match is the value ("Matter no. 12345": the number, not the words), put that part in
     a group and name it with `"group": 1`. The words in front then stay readable and make the rule precise.
   - `"keywords"` (lower case) are words of which one has to stand somewhere in the text before the pattern
     is tried at all. Use them when the pattern needs a word in front anyway. They keep the guard fast.
   - `"check"` names a checksum the value has to pass: `luhn` (card numbers and many customer numbers),
     `iban`, `ean13` (the Swiss AHV number and product codes). Ask the user whether their number has a check
     digit before you guess one.
4. **Write the rule file** with the Write tool into a temporary folder, with the examples:

   ```json
   {
     "id": "matter-number",
     "kind": "personal",
     "pattern": "(?<![A-Za-z0-9])M-\\d{4}-\\d{5}(?![A-Za-z0-9])",
     "flags": "i",
     "keywords": ["m-"],
     "description": "matter numbers, M-year-five digits",
     "match": ["M-2026-00417", "m-2025-10003"],
     "noMatch": ["M-26-417", "TM-2026-004171", "2026-00417"]
   }
   ```

5. **Run `add <rule.json>`.** It compiles the pattern, tries the examples and the look-alikes, times the
   pattern on long input and only then stores the rule. If it refuses, read the reason, change the pattern and
   run it again; do not weaken `noMatch` to get through. Delete the rule file afterwards.
6. **Run `check <id>`** and report, see below.
7. **Show the user the rule** in one or two sentences of plain words ("M, a year, five digits, with hyphens,
   upper or lower case"), with what it does not catch (the number written without hyphens, a number read out
   in words).

A value with no shape of its own (a surname, a project name) is no case for a rule. Those go on the list of
confidential terms: the `terms` skill.

## After every enable and add: check, and tell the user

`check <id>` replays the rule against the user's stored sessions of the last 30 days: the calls that left the
computer, their own messages and what tools returned. It prints a verdict per rule and, as a sample, the text
around a find with the value itself left out. Tell the user the result in plain words:

- **"LIKELY IN THE WAY"**: say so first, with the numbers and the sample ("it would have hidden 4,200 values
  in 310 of your tool results, for example in lines like `order_id: [...]`"). The pattern is too wide: tighten
  it (a word in front, a checksum, a fixed prefix) and add it again under the same id, which replaces it. Do
  not leave such a rule on without the user's explicit word.
- **"MAY BE IN THE WAY"**: say what was found and let them decide. A find in their history can also be exactly
  what the rule is for.
- **"no sign of trouble"**: say that this holds for their history, not for the future.

Say where the rule applies from now on: tool calls that leave the computer, tool output, their messages,
attached and pasted files, and the text read from pictures, PDFs and Office documents.

## Images and PDFs

Before Claude opens an image or a PDF, the guard reads its text on this computer and refuses the file when
it holds an address, a secret, personal data or a term kept from Claude. That is set for all files or apart
for two kinds: `images` (screenshots, photos, scans) and `documents` (PDFs, and Office files pasted into a
message). The modes: `check` (the default and the recommendation for both kinds), `confirm` (the check, and a
question before every file), `strict` (none are opened), `off` (they pass unread).

When the user says the check gets in their way, for example because they show you screenshots of their own
app all day and those hold test addresses:

1. If it is a few known values, allow those (`allow value`) and keep the check.
2. Otherwise switch the check off for that kind only: `pictures images off`. Say what that means: a
   screenshot with an address, a key or a client name in it reaches you as it is, and nothing can take it
   back out of the conversation.
3. `status` shows what is set. `pictures check` puts both kinds back to the default.

A session is told at its start how files are handled, so a change reaches a running session's hooks at once
and its instructions with the next session.

## A false alarm

When the user says a value was hidden or a call refused wrongly: the guard's message names the rule.

1. One value, such as a documented test IBAN: `allow value "<the value>"`.
2. A kind of value, such as all test ids: `allow pattern "<pattern>"`. The pattern has to match the whole
   value.
3. The rule is of no use to them: `disable <id>`.

Prefer the narrowest of the three. Each brings up a question to the user.

## Teams and organisations

The settings file is per person and per Claude profile. For more than one person:

- **A team without central management**: the rule files are plain JSON without anything confidential in
  them. Keep them in a shared repository and let each member run `add <rule.json>`.
- **An organisation**: an administrator writes one file in the format of `privacy-guard.json`, typically with
  `enabledRules` and `customRules`, puts it on every computer with their device management, and names it in
  the `env` of Claude Code's managed settings:
  `"env": { "PRIVACY_GUARD_ORG_SETTINGS": "C:\\ProgramData\\ClaudeCode\\privacy-guard.org.json" }`.
  An organisation that distributes its own copy of the plugin can instead put the file into the plugin's
  folder as `privacy-guard.org.json`. What that file switches on, a person's own settings cannot switch off;
  `status` marks those rules "set by the organisation", and `disable` refuses them. A person can still add
  rules and allowances of their own.

To write such a file for an administrator, build and test each rule with `add` on your own profile first, then
copy the stored rules from `status` into the file's `customRules` (without `match` and `noMatch`).

Say plainly what this is: the organisation's file is read by the hooks of the plugin. It binds the guard, not
the computer. Someone who can remove the plugin or change the managed settings can remove the rules too.
