---
name: audit
description: Find where email addresses went, and which hosts Claude contacts. Lists the past Claude Code sessions that put an address into a tool call (shell, web search, fetch, file write), the sessions where one came back in tool output, and the files of a folder that hold one, by mail domain and never by address. A second check shows which hosts Claude Code or the desktop app talk to and whether a telemetry host is missing from the block list. Use when the user asks whether or where their email address leaked, wants a privacy audit of their sessions or of a repository, asks what telemetry Claude sends or whether the host block is complete, or has just installed or updated.
---

# Privacy audit

Run the script `audit.mjs` that sits in this skill's folder (`${CLAUDE_SKILL_DIR}/audit.mjs`) with Node. It reads
and reports; it changes nothing.

| What to check | Command |
|---|---|
| All stored Claude Code sessions on this computer | `node audit.mjs` |
| Only recent ones | `node audit.mjs --days 30` |
| The files of a folder, such as the current repository | `node audit.mjs --files <folder>` |

Ask the user which of these they want if they did not say. The first can take a few minutes on years of
sessions; say so before you start it.

## Rules

- Never search for the address itself, whole or in parts, with this or any other tool. The script matches the
  shape of an address and prints the mail domain only.
- Addresses on the user's allow file and test addresses (`example.com`) are not reported.
- Do not open the listed transcripts or files to look at the addresses. The report is the result.

## Report to the user

1. **What left the computer:** tool calls that send their input somewhere else (web search, web fetch, browser,
   a shell command that calls out, an MCP tool) with an address in it. Name the session, the time, the tool and
   the domain.
2. **What stayed local:** tool calls that wrote an address into a file or searched for one, and sessions where
   one came back in tool output.
3. **Files** that hold an address, if a folder was checked.
4. **What a program may have sent:** if an address was written into code or configuration (a User-Agent, a
   contact field), say that the program's own requests are not in the transcripts, and where to look (its
   download folder, logs or git history).

End with what the user could do about each finding. Removing transcripts, files or history is their decision;
do none of it unasked.

## Which hosts Claude contacts

A second script in this folder, `check-hosts.mjs`, shows which hosts Claude Code or the desktop app talk to.
It sends their traffic through a logging proxy on this computer. HTTPS passes through untouched, so it sees
host names and sizes, never content. Each host is compared with the guard's host list
(`scripts/telemetry-hosts.txt`) and reported as telemetry, needed, or new.

Use it when the user asks what Claude sends, whether the host block is complete or still works, or after a
Claude update.

| What to check | Command |
|---|---|
| Claude Code, with the user's settings | `node check-hosts.mjs cli` |
| Claude Code as a fresh install sends | `node check-hosts.mjs cli --default-settings` |
| The desktop app | the user runs `check-desktop-hosts.ps1` themselves (Windows) |

The Claude Code check starts one headless turn of about 30 seconds and uses a little of the user's plan. Say
so before you run it.

The desktop check closes and restarts the app, which ends the session you are in. So you do not run it: give
the user the command in a message of its own (alone in a code block, as one line with the script's full path,
never inside a question or a choice), tell them it takes five minutes and that they must restart the app normally afterwards,
and read the report (`claude-desktop-hosts.txt` in their temp folder) when they are back. On macOS and Linux
there is no helper: the user starts `node check-hosts.mjs listen` in a terminal and the app with the option
`--proxy-server=http://127.0.0.1:58555`.

How to read the report:

- **"NEW, on no list"** is the line that matters. Find out what the host is (its name, the app's
  documentation) before anything else, and tell the user. If it carries telemetry only, it belongs on the
  block list; if the app needs it, it belongs in the needed group. Propose the change to
  `scripts/telemetry-hosts.txt`; do not edit the computer's hosts file.
- **"TELEMETRY ... sent"** means telemetry got through: the host block is not active, or the settings still
  send it. **"did not connect"** on a telemetry host means the block works.
- Telemetry that shares a host with the model API or the app (`api.anthropic.com`, `claude.ai`) cannot be
  told apart by host. Only the settings reduce that part; compare the sizes of two runs to see the effect.
- A program that ignores the proxy is not seen. The report says so when nothing came through.
