---
name: terms
description: Manage the privacy guard's lists of confidential terms (client, matter, project and person names that must not leave the computer through Claude). Adds and removes terms, switches a list's mode, creates and shares team lists that hold hashes instead of names, and checks against the user's own session history whether a term would get in their way. Use when the user wants to add, remove, review or share confidential terms, asks why a search was refused for a confidential term, or sets up a list for a team.
---

# Confidential terms

Everything goes through the script `terms.mjs` in this skill's folder (`${CLAUDE_SKILL_DIR}/terms.mjs`), run with
Node. Never open, search or edit the list files or key files yourself; the guard refuses that, and the script is
the only way in.

| Task | Command |
|---|---|
| What lists exist | `node terms.mjs status` |
| Add to the personal list | `node terms.mjs add "Project Falcon" "Acme Holdings"` |
| Add with sound matching | `node terms.mjs add --sound "Meier"` |
| Remove | `node terms.mjs remove "Acme Holdings"` |
| Would a term get in the way | `node terms.mjs check "Project Falcon"` |
| Check the whole personal list | `node terms.mjs check` |
| Switch a list's mode | `node terms.mjs mode outbound` or `everywhere` |
| Team list: add, remove, mode | the same commands with `--list <name>` |
| Would the guard catch this text | `node terms.mjs test "some text"` |
| Hand a team list to others | `node terms.mjs share <name>` |
| Take over a team list | `node terms.mjs import <list.json> <list.key>` |

## Before the user tells you a term

A term you are told is a term you know. Ask first which mode they want:

- **Outbound** (the default): you may know the terms and work with them locally. Calls that leave the computer
  (web search, fetch, MCP tools, shell commands that call out) are refused when they hold one.
- **Everywhere**: the terms are kept from you entirely. Then do not ask for them. Give the user the command to
  run in their own terminal; without a term on the command line the script reads one per line from the keyboard:
  `node "<this skill's folder>/terms.mjs" add` (with `--list <name>` for a team list).

Whenever the user has to run a command themselves, give it in a message of its own: one sentence on what it
does and where to run it, then the command alone in a code block, as one line with the full path filled in,
then what they will see. Never put a command into a question or a choice. Wait until they say it is done.

## After every add: check, and tell the user

Run `check` on each term you added, in the same turn. It replays the term against what the user's stored
sessions of the last 30 days sent out and against their own messages, and names terms that are short or
common. For a list in mode everywhere, have the user run `check` themselves or run it without terms (it then
prints "Term 1", "Term 2" and no names).

Tell the user the result in plain words, term by term:

- **"LIKELY IN THE WAY"**: say so first and say why, with the numbers ("it would have refused 14 of your last
  320 searches, for example the ones about the Phoenix framework"). Suggest the full, distinctive form of the
  name ("Phoenix Capital Partners" in place of "Phoenix") and offer to swap it. Do not leave such a term on the
  list without the user's explicit word.
- **"MAY BE IN THE WAY"**: say what was found and let them decide.
- **"no sign of trouble"**: say that this holds for their history, not for the future.

Also say what matching does, when it matters for the term:

- Any spacing and case match ("project-falcon", "ProjectFalcon"), with or without accents and umlauts.
- One typing mistake is tolerated from five letters, two from nine. That also means a real word two letters
  away matches: "Catherine" on the list refuses "catering".
- `--sound` catches spellings by ear, by German and English rules: "Meier" catches Meyer and Mayer, "Catherine"
  catches Kathryn, "Stephen" catches Steven. It also catches other people with a similar name. Use it only
  when the user asks for it or the name is one people misspell by ear.
- A description of the matter without its name passes. The check compares letters, not meaning.

## Team lists

A team list (`--list <name>`) stores keyed hashes, never the terms. It is two files in the Claude config
folder: the list (`privacy-guard.terms.<name>.json`), which may travel by any channel, and its key
(`privacy-guard.terms.<name>.key`), which is treated like a password. [SHARING.md](SHARING.md) in this folder
explains it for people; read it before you help with sharing, and point the user to it.

**The user wants to share a list**

1. If the list does not exist yet: ask for its name and its mode, then add the terms (`add --list <name> ...`),
   or have the user add them in their own terminal if you are not to see them.
2. Run `check "<term>"` on the terms you added in this conversation and report, as above. Settle terms that are
   likely in the way before sharing. The terms of a list that already exists cannot be read back: if you were
   not there when they were added, ask the user whether they were checked, and offer to check terms they name.
3. Run `share <name>` and show the user its output: the two file paths and what to do with each.
4. Stop there. The user sends the list by any channel and the key by a separate one they would trust with a
   password. Commit the list file to a repository only if they ask, and never the key.

**The user received a list**

1. Run `import <list file> <key file>` with the paths they name. Without the key file, import the list alone
   and tell them where the key has to go.
2. Run `status` and report the line of that list. `key present` means the guard applies it; `key MISSING`
   means the key file is absent or misnamed.
3. If they know a name on the list, run `test "<name>"`; it answers whether the guard catches it and by which
   list.

**Later changes**

- A term added or removed: the keeper of the list sends the list file again; everyone imports it again. The
  key stays the same.
- Someone leaves the team: a key cannot be taken back. A new list under a new name, the terms typed again,
  shared again; the old two files are deleted everywhere.

**The key**

You may pass a key file's path to `import`. You never read, print, send, upload, commit or paste a key. Moving
it between people is the user's job.

A team list catches spacing, case and one typing mistake, and sound for terms added with `--sound`. It does
not catch a term inside a longer word, which the personal list does. Nobody can list its terms, its author
included; removing one means typing it again.
