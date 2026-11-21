# Sharing a list of confidential terms

A team keeps one list of names that must not leave anyone's computer through Claude: clients, matters,
projects, people. This page is for the person who shares such a list, for the colleagues who receive it, and
for the Claude agent that helps either of them.

## How a shared list works

A shared list is two files:

| File | What it holds | How to treat it |
|---|---|---|
| `privacy-guard.terms.<name>.json` | the list: one group of hashes per term, never a term | send it by any channel |
| `privacy-guard.terms.<name>.key` | the key the hashes were made with | like a password |

Each computer's privacy guard needs both. With the list alone the guard can do nothing, and neither can anyone
who finds the file. With both, the guard recognises a term when it sees one. Nobody can read the terms back out
of the files, the person who made the list included.

`<name>` is a short name you choose, such as `team` or `matter-2026`. Several lists can exist side by side.

## You share a list

Ask your Claude: "Create a shared terms list called team and add these names", or "share my terms list team".
It uses the `terms` skill and does the steps below with you. By hand, the commands are in brackets.

1. **Create the list and add the terms.**
   (`node terms.mjs add --list team "Project Falcon" "Acme Holdings"`)
   The first add creates the key. If Claude should not see the names, run the command yourself without names;
   it then asks for them line by line.
2. **Let Claude check each term.** It tells you which terms would get in the way of ordinary work, from your
   own session history. Replace those with a more distinctive form before you share.
3. **Find the two files.** (`node terms.mjs share team`) prints where they are and repeats these steps.
4. **Send the list file** to your colleagues: mail, chat, a shared drive, or commit it to a repository.
5. **Hand the key over another way**, one you would trust with a password. The simplest is your password
   manager (Bitwarden, Proton Pass, Devolutions and the like). In your own terminal, run
   `node <the plugin's skills/terms/terms.mjs> key copy <name>`; ask Claude for the full command. It puts the
   key as a code on the clipboard. Paste it into a new entry as the password, name the entry after the list,
   and share the entry with your colleagues. Copy something else afterwards, so the code leaves the
   clipboard. `key show <name>` prints the code if you prefer to copy it by hand. Sending the key file itself
   works too. Never put the key into the same message or the same repository as the list.

   A colleague who receives the code runs `node <...>/terms.mjs key set <name>` in their own terminal and
   pastes it. That writes the key file. Claude cannot run these three commands, by design: the code would
   land in the conversation.

## You receive a list

1. **Save both files** into your Claude config folder and keep their names:
   - Windows: `C:\Users\<your user>\.claude`
   - macOS and Linux: `~/.claude`

   Or tell your Claude: "Import this team list", and name the two files. (`node terms.mjs import <list> <key>`)
2. **Check that it is active.** Ask your Claude: "What is the status of my terms lists?"
   (`node terms.mjs status`) The list must show `key present`. If it shows `key MISSING`, the key file is not
   in the folder or has another name.
3. **Try it**, if you know a name that is on the list: ask your Claude to test that name against the lists.
   (`node terms.mjs test "Project Falcon"`) It answers "caught by the list team".

You need the privacy guard installed for any of this to have an effect (see INSTALL.md).

## Keeping a list up to date

- **A term is added or removed:** the person who keeps the list sends the list file again, and everyone
  replaces theirs. The key stays the same.
- **Someone leaves the team:** a key cannot be taken back. Start a list under a new name, add the terms again,
  share it, and have everyone delete the two old files. Nobody can copy the terms over for you, because nobody
  can read them out.
- **The mode** (`outbound` or `everywhere`) is part of the list file and applies to everyone who has it.

## Other ways to distribute

- **In a repository:** commit the list file next to the guard's scripts (`.claude/hooks/privacy-guard/`). Everyone
  who works in that repository gets the list with it and needs only the key in their config folder. Cloud
  sessions on the repository get the list too, but not the key, so there the list is not applied.
- **For a whole organisation:** device management puts both files into each member's config folder. The key
  can also arrive as the environment variable `PRIVACY_GUARD_TERMS_KEY` (the content of the key file) in the
  managed settings; it then opens every shared list that has no key file of its own.

## What a shared list does and does not catch

It catches a term in any spacing and case (`project-falcon`, `ProjectFalcon`), with or without accents and
umlauts, with one typing mistake, and by sound for terms that were added with `--sound`.

It does not catch a term inside a longer word, a second typing mistake, or a description of the matter that
leaves the name out. The personal list catches the first two; nothing catches the third.

## What the key protects, and what it does not

Someone who has the list and the key cannot print the terms, but can test guesses: "is this name on the list?"
Names are easy to guess, so the key deserves a password's care. The guard needs the key on every computer that
applies the list, so every program running under that user can read it. The list keeps names out of
repositories, backups, screen shares and out of Claude's view; it does not hide them from someone who controls
the computer.

## For the agent

- Run everything through `terms.mjs` in this folder. Do not open, print or edit the list or the key.
- You may pass the path of a key file to `import` when the person names it. Do not read the file, and do not
  send, upload, commit or paste a key anywhere. Moving the key between people is the person's job.
- When you share: run `share <name>`, show the person its output, and stop there. Offer to commit the list
  file to a repository only if they ask, and check first that the key is not in that repository.
- When you import: run `import`, then `status`, and report the line for that list. If the key is missing, say
  where it has to go and wait.
- After any add to a shared list, run `check` on the terms you were given and report as the skill describes.
  For a list in mode `everywhere` you are not told the terms; the person runs `add` and `check` themselves.
