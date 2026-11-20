# Install guide for agents

This file is written for Claude. A person hands it over with a request such as "install the privacy guard,
follow INSTALL.md". Lead them through it as a wizard: one question at a time, as described in the next
section. Change only what they agreed to, and finish with the report in the last section.

## How to lead the person through it

The person decides step by step, and needs room to see what each decision does. So the install is a
conversation of many short turns, never one long message with all questions in it.

**Open with an introduction, written as an ordinary message.** Before any question and before any tool call
that asks something, write the introduction as plain text in the conversation. A question dialog can cover
the text above it, so the introduction and the first question both go into this message as text; do not use a
question tool for the first question. Say, in this order:

1. **What the privacy guard is:** a set of checks that keep email addresses, secrets and confidential names
   out of what Claude does on their behalf, plus settings that reduce what Claude Code reports back.
2. **That it works on this computer only.** Say this plainly, it is what people ask first:
   - The checks are small scripts that run locally each time Claude uses a tool. They open no network
     connection, need no internet access and send nothing anywhere. What they find stays on this computer.
   - The allow file, the lists of confidential terms and every report are local files.
   - The internet is used twice, and neither time by the checks: once to download the plugin from its
     repository, and, only if they ask for the optional host check, for one ordinary Claude Code turn that is
     routed through a logging proxy on this computer.
   - The guard has no account, no server and no telemetry of its own.
3. **What is about to happen:** you will ask one question at a time, show every change before you make it, and
   nothing is installed until they say yes to it.
4. **That they can skip any step, stop at any point, and remove everything again.**
5. **The first question** (step 2), with its choices, as the end of the message. Then stop and wait.

**Then repeat this rhythm for every step:**

1. **Explain** what the step is about in two or three sentences: what it does, and what it costs or changes for
   them. Take the content from the step's section; don't paste the section.
2. **Ask one question** and give the choices as a short list, each with its consequence in a few words. Mark
   the one you recommend and say why. "Skip" is always a choice. From the second question on you may use a
   question tool if you have one; the explanation of step 1 still goes into a message before it, and the
   question itself repeats in one line what it decides, because the dialog may be all the person sees.
3. **Stop and wait** for the answer. Do not ask the next question in the same message, and do not start the
   next step.
4. **Apply** what they chose. For a settings file, show the lines first and get a yes (rule 2 below).
5. **Report** in one or two sentences what you did, where, and how to undo it.
6. **Announce the next step** in one sentence, so they know what the next question will be about. Then go to 1.

More rules for the rhythm:

- One decision per question. Where a section holds several independent settings, each one is its own turn.
- Never batch questions to save time, and never decide a step for them because the answer seems obvious.
- Checks that need no decision (versions, tests, the proof at the end) are not questions: say what you are
  about to run, run it, and report the result.
- If an answer makes later steps pointless, say which ones you will leave out and why.
- Keep each message short enough to read at a glance. Details go into an answer when they ask for them.

**A command the person has to run gets a message of its own.** Never put it into a question, a choice or the
middle of a sentence: there it cannot be copied in one piece, and someone who is new to a terminal will not
get it right.

1. Write a message that says in one sentence what the command does and where to run it (for example "Open
   PowerShell from the Start menu and paste this").
2. Put the command alone in a fenced code block, as one line, with the full path of the file as it is on this
   computer, so that it works from any folder. Tag the block with the shell (`powershell`, `bash`).
3. Below the block say what they will see when it worked, and how to undo it.
4. End the message there and wait for them to say it is done. Ask no question in the same turn and open no
   question dialog over it. When they are back, go on with the check or the next step.

## What gets installed

| Part | What it does | Where it can live |
|---|---|---|
| Tool-call guard | Denies any tool call whose input holds an email address (shell commands, file writes, searches, fetch URLs, agent briefs, MCP tools) | Claude Code: the plugin, or a repository's `.claude/hooks/` |
| Output mask | Hides email addresses and secrets (API keys, tokens, private keys) in what tools return, before Claude reads it | same |
| Secret guard | Denies a call that leaves the computer (web search, fetch, MCP tools, shell commands that call out) when it holds a secret | same |
| Confidential terms | Denies such a call when it holds a term from the person's own list, also with typing mistakes; optionally keeps the terms out of Claude's view entirely | same, plus the person's list file |
| Prompt check | Stops a message the person sends when it holds an address, or attaches a file with `@` that does, and tells them | same |
| Account address | Leaves the address of the signed-in account out of the context Claude is given | the plugin only |
| Document reader | Gives Claude the text of an image, a PDF, a Word, Excel, PowerPoint or OpenDocument file, with the text of pictures embedded in it, read on this computer; the output mask hides values in it. A rule tells Claude to use it, and to pass images that its own extraction tools produce through it | same |
| Paste check | Reads images and documents pasted into a message before it is sent; holds the message back when one holds an address, a secret or a term kept from Claude | the plugin only |
| Picture check | Reads the text of an image or PDF on this computer before Claude opens it, and refuses the file when it holds an address, a secret or a term kept from Claude; Claude then works from the text. Optionally asks the person before every picture | same |
| Commit check | Denies a `git commit` whose changes add an address, and notes at session start when git commits under a real address | same |
| The rule | Tells every session why, and what to do when a task seems to need an address | the plugin, a repository's `.claude/rules/`, `claudeMd` in managed settings |
| Skill `email-address-privacy` | The same rule for places without hooks | claude.ai (web chats, Cowork, the Office add-ins), from where it also reaches Claude Code and cloud sessions |
| Skill `audit` | Reports which past sessions and which files hold an address, by domain only | the plugin (`/privacy-guard:audit`) |
| Skill `terms` | Adds, removes, checks and shares confidential terms; tells whether a term would get in the way | the plugin (`/privacy-guard:terms`) |
| Telemetry settings | Switch off error reports, the feedback command and the survey; optionally usage metrics and updates | `settings.json` (user or managed) |
| Host block | Points the two telemetry-only hosts nowhere | the computer's hosts file; the person runs it |
| Hardening settings | No session links in commits, no claude.ai connectors, no reading of credential folders | `settings.json` (user or managed) |

Only the hooks block anything. The rule and the skills are instructions: Claude follows them, nothing enforces
them.

## Rules for you, the agent

1. Never ask the person for their email address and never write one, theirs or anyone's, into a file, a
   command, a search or a memory entry. Nothing in this guide needs it. Where an example address is needed,
   make one up at `example.com`.
2. Before each change to a settings file, read the file, show the person the lines you will add, and wait for
   their yes. Merge; never replace the file. Keep existing `env` entries, hooks and permission rules.
3. Change nothing on GitHub, in an admin console, in a claude.ai account's settings or in the computer's system
   files yourself. Where a step needs one of those, tell the person what to do and wait.
4. Once the hooks are active, a denied tool call that starts with `email-guard:` or `privacy-guard:` and output
   that reads `[email hidden]`, `[secret hidden]` or `[term hidden]` are the guard working. Don't work around
   them.
5. Never open, search or edit the lists of confidential terms or their keys directly (A6). They change only
   through the `terms` skill's script, and only at the person's request.
6. If a command in this guide fails, stop and show the person the output. Don't improvise another way to reach
   the same state.

## Step 1: where are you running?

- **You have a shell and can read this repository's files** (Claude Code in a terminal, the desktop app or an
  IDE): go to step 2.
- **You are in a web chat or Cowork on claude.ai without this repository:** do section D only. It needs
  nothing but this file.

## Step 2: the first question, what to cover

This question closes your introduction. Ask which of these they want to protect; several can apply:

- **A. This computer:** every Claude Code session of this user here. The usual start.
- **B. A repository:** everyone who opens that repository, and cloud sessions started on it.
- **C. The organisation:** everyone on a Claude for Teams or Enterprise plan. Needs an Owner.
- **D. claude.ai:** web chats, Cowork and the Office add-ins of this account.

Wait for the answer. Then tell them the order you will go in (A, B, C, D, as chosen) and how many questions
the first part has, and go through the matching sections one question at a time.

## Step 3: checks

No question here. Say that you are checking whether the guard can run on this computer, run these, and report
the versions:

```
node --version
claude --version
```

- Node 18 or newer must be on the PATH. Without it the hooks cannot start, and Claude Code then lets every tool
  call through with an error message.
- Run the tests from this repository: `node --test scripts/*.test.mjs`. All must pass before you install
  anything.

## A. This computer

The questions of this part, in order. Each row is one turn of the rhythm, or more where it says so:

| Step | The question | Choices |
|---|---|---|
| A1 | Install the plugin with its checks? | install, skip (then stop: nothing else in A works without it) |
| A2 | none: you create the empty allow file and say where it is | |
| A3 | Which telemetry level? Before it, two short questions, each its own turn: Remote Control, and skills from claude.ai | light, metrics off, strict, leave as it is |
| A3 | Skip the fetch safety check? | yes, no |
| A3 | Keep stored sessions for fewer days? | a number of days, leave at 30 |
| A4 | Block the telemetry-only hosts? | the nine documented hosts, those plus four analytics hosts, no |
| A5 | Three settings, one turn each: session links in commits, claude.ai connectors, credential folders | apply, skip |
| A5b | How should images and PDFs be handled? | check them (default), check and ask me each time, refuse them all, leave them unchecked |
| A6 | Are there names that must never leave this computer through Claude? | yes (continue with the terms skill, one question at a time), no |
| A6b | none: you tell them what only they can do | |
| A7 | none: you run the proof and report | |
| A8 | Check your stored sessions for addresses that went out? | yes, no |
| A9 | Only in a repository: install here too, for cloud sessions? | yes (part B), no |

### A1. The plugin (hooks, rule, audit)

Explain first what the plugin adds, using "what they will notice" below, then ask whether to install it.

From the published repository:

```
claude plugin marketplace add Cotspheer/claude-privacy-guard
claude plugin install privacy-guard@claude-privacy-guard
```

From a local clone, give the folder instead: `claude plugin marketplace add ./claude-privacy-guard`
(the path must start with `./` or `../`, or be absolute).

The plugin installs at user scope, so it loads in every project. It applies to sessions started after the
install; a session that is already open needs `/reload-plugins` or a restart.

Later versions do not arrive by themselves: Claude Code updates plugins automatically only from Anthropic's own
marketplaces. Tell the person the update command: `claude plugin update privacy-guard@claude-privacy-guard`.

If the person already has an `email-guard` hook in their own `~/.claude/settings.json` from an earlier manual
install, tell them: with both in place the check runs twice. Offer to remove the manual entry, and remove it
only on their yes.

Tell the person what they will notice:

- A message they send with an email address in it comes back unsent, with the reason. They take the address
  out, or allow it (A2).
- Where a tool's output held an address or a secret, Claude sees `[email hidden]` or `[secret hidden]`. Claude
  can then not edit that exact spot of a file; it works around the line or asks them.
- Claude can still write a secret they give it into a local file or use it in a local command. It cannot put
  one into a web search, a fetch, an MCP tool or a shell command that calls out (`curl`, `ssh`, `git push` and
  the like); there it uses an environment variable.
- A message that attaches a text file with `@` comes back unsent when the file holds an address, a secret or
  a term kept from Claude: an attached file would reach Claude unmasked. They name the file without the `@`
  instead, and Claude opens it through the guard.
- Before Claude opens an image or a PDF, the guard reads its text on this computer. If it finds an address, a
  secret or a term kept from Claude, Claude does not get the picture; it gets the text, with those values
  hidden, and says so. That takes about a second per file.
- Word, Excel, PowerPoint and OpenDocument files: Claude gets their text from the guard's reader, with the
  text of embedded pictures (a scanned page inside a document, for example), and the values hidden. It is
  told to use that reader before writing an extraction script of its own, and to pass any image such a
  script produces through the reader and never open it directly.
- A message with a pasted image or document is checked the same way before it is sent. If the pasted file
  holds one of those values, the message comes back unsent; they save the file and name it in the message
  instead, and Claude gets its text with the values hidden.
- Claude no longer knows the address of the account it runs under: the plugin leaves that line out of the
  context.
- Each tool call takes about a tenth of a second longer, also for a message of several pages.

### A2. The allow file

Create `~/.claude/email-guard.allow.txt` if it is missing, with this content and nothing else:

```
# Addresses the privacy guard lets through, one per line:
#   name@domain    one address
#   @domain        every address at that domain and its subdomains
# Only the user edits this file.
```

Tell the person where the file is. They add entries themselves; you never do. Without any entry the guard
already lets through `example.com`, `example.org`, `example.net`, the reserved test endings (`.test`,
`.example`, `.invalid`, `.localhost`, `.local`), the Anthropic and GitHub noreply addresses, retina image names
(`logo@2x.png`), package versions, SSH remotes (`git@host:owner/repo`) and credentials in connection strings.

### A3. Telemetry settings

There are three levels. Each one adds to the one before and costs more. Say that the right level depends on
two things, and ask them one after the other, each in its own turn:

1. Do you use Remote Control (driving sessions on this computer from claude.ai or a phone)?
2. Do you want skills from your claude.ai account in Claude Code (section D)?

Then, in a third turn, present the three levels in a few lines each, recommend one, and ask which they want.
A yes to either question points to level 1, or to level 2 with its limits accepted. Never recommend level 3 to
someone who uses Remote Control.

**Level 1, light** (`settings/telemetry-off.light.json`)

- Switches off error reports (`DISABLE_ERROR_REPORTING`; they are on by default for a personal subscription),
  the `/feedback` command and the session survey.
- Costs nothing else. Usage metrics are still sent; the host block in A4 stops the part of them that goes to
  the logging service.

**Level 2, metrics off, updates on** (`settings/telemetry-off.keep-updates.json`)

- Adds `DISABLE_TELEMETRY`: no usage metrics.
- Auto-updates keep working: Claude Code asks `downloads.claude.ai` for a newer version at start and now and
  then while running, and installs it in the background. The docs do not say what goes along with that
  request. In return, security fixes arrive without anyone having to act.
- Cost: `DISABLE_TELEMETRY` also stops the fetching of feature flags. With that off:
  - Remote Control stays available (Claude Code 2.1.283 or later) but sessions no longer connect to it by
    themselves, and it is unavailable where an organisation requires Trusted Devices;
  - skills and plugins enabled on claude.ai no longer sync into Claude Code;
  - messaging between sessions on different machines, `/import`, `/restart` on personal plans and reading or
    answering artifact comments stop working;
  - on Windows with Git Bash the PowerShell tool is no longer offered by default
    (`CLAUDE_CODE_USE_POWERSHELL_TOOL=1` brings it back).

**Level 3, strict** (`settings/telemetry-off.strict.json`)

- `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`: everything in level 2, and also no auto-updates of Claude Code
  or of plugins.
- Cost: everything listed under level 2, and **Remote Control is unavailable**. Nobody gets security fixes
  until someone runs `claude update` (and `claude plugin update ...` for plugins). On one person's machine that
  is a habit to keep; across an organisation it needs someone who owns the rollout.
- To undo it, remove the variable. Setting it to `0` or `false` still counts as set.

Merge the chosen set into `~/.claude/settings.json`. Environment variables apply to sessions started after the
change.

Then ask about each of these in a turn of its own; each has a cost:

- `"skipWebFetchPreflight": true`: before fetching a page, Claude Code sends the page's host name (nothing
  else) to Anthropic to check it against a blocklist of unsafe sites. This setting skips the check, and with it
  that protection.
- `"cleanupPeriodDays": <number>`: transcripts under `~/.claude/projects` are kept 30 days by default. They hold
  each session's context, which includes the address of the signed-in account. A lower number removes them
  sooner; resumable history gets shorter by the same amount.

### A4. The host block (the person runs it)

Some hosts receive nothing but telemetry. Pointing them nowhere in the computer's hosts file stops that traffic
whatever the settings say, and leaves sign-in, the model API, Remote Control and auto-updates alone. The list
is `scripts/telemetry-hosts.txt`, in two parts.

**Default: nine hosts that Anthropic's documentation names as telemetry only**

| Host | Carries | Sent by |
|---|---|---|
| `http-intake.logs.us5.datadoghq.com` | operational telemetry events | Claude Code |
| `browser-intake-us5-datadoghq.com` | error reports, performance timing | Claude Code, desktop app |
| `browser-intake-datadoghq.com`, `-us3-`, `-ap1-`, `-ap2-`, `browser-intake-datadoghq.eu`, `browser-intake-ddog-gov.com` | performance timing | desktop app |
| `o1158394.ingest.us.sentry.io` | crash and error reports | desktop app |

**Extended, only when the person asks for it: four analytics hosts of the claude.ai pages**

`a-api.anthropic.com`, `a-cdn.anthropic.com`, `a.claude.ai`, `a-cdn.claude.ai`. The desktop app shows these
pages too. Anthropic's host tables do not list them; they are identified from captures of the pages' traffic.
Blocking them is untested, so say that, and say how to take them out again if a page misbehaves.

Explain the limits:

- Claude Code's usage events and the feature flags go to `api.anthropic.com`, the same host as the model API,
  and the pages' analytics events and performance timing go to `claude.ai` itself. A host block cannot
  separate those; only the settings in A3 can.
- These hosts are left alone on purpose: `downloads.claude.ai` (updates), `s-cdn.anthropic.com` (the browser
  check at sign-in; blocked, sign-in can fail), `statsig.anthropic.com` (older Claude Code versions use it for
  feature flags as well as metrics) and `sentry.io` itself (everyone's Sentry, not only Anthropic's reports).
- The Datadog hosts belong to a logging service that other software and websites use too. Their reports from
  this computer stop as well.
- A hosts file knows no wildcards. If Anthropic moves to another address, the list needs the new name.

The change touches a system file and needs administrator rights, so the person makes it, not you, in whatever
permission mode you run. Ask whether they want it. On a yes, give them the one command for their system in a
message of its own, as described under "A command the person has to run": the command alone in a code block,
with the script's full path on this computer (find it first; after a plugin install the scripts are in the
plugin's folder, not in a clone).

- Windows, in any PowerShell:
  `powershell -NoProfile -ExecutionPolicy Bypass -File "<full path>\scripts\block-telemetry-hosts.ps1"`
  (with `-Extended` at the end for the second part). The script asks Windows for administrator rights itself;
  the person confirms the Windows prompt. It prints "Blocked 9 hosts" when it worked.
- Linux and macOS: `sudo "<full path>/scripts/block-telemetry-hosts.sh"` (with `--extended` for the second
  part). The person types their password; you never handle it.

Tell them below the block that the same command with `-Remove` (Windows) or `--remove` takes all entries out
again. Then wait until they say it is done. Only after that, in the next turn, ask whether to check the result
together:

1. Run the host check: `node skills/audit/check-hosts.mjs cli`. It sends one short Claude Code turn through a
   logging proxy and lists every host it contacts. The telemetry hosts must now show "did not connect", and no
   host may be "NEW, on no list". Say beforehand that the turn uses a little of their plan.
2. Have them start a new Claude Code session and, if they use it, connect Remote Control once, to see that
   nothing they need is affected.

The same check shows what the block list misses after a Claude update. For the desktop app the person runs
`skills/audit/check-desktop-hosts.ps1` themselves (Windows); it restarts the app, so it cannot run from a
session. The skill `audit` explains both and how to read the report.

### A5. Hardening settings

`settings/hardening.json` holds three independent settings. Ask about each in a turn of its own: explain it,
ask, apply, report, then the next. Merge only those the person wants.

- `"attribution": { "sessionUrl": false }`: commits and pull requests from cloud or Remote Control sessions no
  longer carry a link to the session on claude.ai. No cost.
- `"disableClaudeAiConnectors": true`: the connectors set up on claude.ai (mail, calendar, drive and others)
  are not loaded into Claude Code. Cost: Claude Code cannot use them. Skip it for someone who works with them.
- `permissions.deny` for credential folders (`~/.ssh`, `~/.aws`, `~/.azure`, cloud and GitHub CLI
  configuration, `~/.npmrc`, `~/.netrc`, `~/.git-credentials`): Claude's file tools can no longer read them.
  Cost: Claude cannot help with those files. A shell command can still read them; this narrows, it does not
  seal.

### A5b. Images and PDFs

An image or a PDF reaches Claude as a picture or a whole document, and nothing can hide a value inside a
picture. So the guard reads the file's text itself before Claude opens it. Explain that, and that the reading
happens on this computer: on Windows with the text recognition built into Windows, elsewhere with `pdftotext`
and `tesseract` if they are installed. No service is called.

Ask how they want pictures handled:

- **check** (the default, recommended): a file with an address, a secret or a term kept from Claude is refused,
  and Claude works from its text with those values hidden. Clean files open as usual.
- **confirm**: the same check, and Claude Code asks them before every image or PDF Claude opens, so they decide
  case by case. More prompts.
- **strict**: no image or PDF is opened, except below folders they name. Claude can still get the text.
- **off**: pictures pass unread.

For anything but "check", write the choice into `privacy-guard.json` in their Claude config folder, after
showing it: `{ "pictures": "confirm" }`, or `{ "pictures": "strict", "picturesAllowed": ["<folder>"] }`.

Tell them the limits:

- Recognition misses small, stylised or handwritten text, and reads at most the first ten pages of a PDF and
  the first fifteen pictures of an Office file.
- The older binary formats (`.doc`, `.xls`, `.ppt`) are not read. Claude would have to convert them first.
- The rule about extraction tools is an instruction Claude follows. What backs it up: an image Claude then
  opens with its file tool goes through the picture check.
- Where this computer has no way to read a file (no `tesseract` on Linux or macOS, a scanned PDF without it),
  the file opens unchecked in "check" mode. "confirm" still asks, and says that it could not read the file.
- A pasted file cannot be replaced by its text, only held back. In "confirm" mode a clean pasted file brings
  up a question, send or cancel; so does a pasted file the guard could not read, in every mode but "off".
- The paste check and the removal of the account address are part of the plugin. A repository install (part
  B) and cloud sessions do not have them.
- On an account of a Team or Enterprise organisation, Claude Code runs a built-in security plugin first, and
  it passes the context on without asking a plugin the person installed. There the account address stays in
  the context; the paste check and all other checks still work. An organisation can put the plugin on its
  own tier (part C, `appendPlugins`); whether the removal then works is untested. The proof in A7 shows which
  case applies.

### A6. Confidential terms

Ask whether there are names that must never leave the computer through Claude: clients, matters, projects,
people. If so, follow the plugin's skill `terms` (`skills/terms/SKILL.md`; after the install it is
`/privacy-guard:terms`). In short:

1. Ask which mode they want, before they tell you any term:
   - **outbound** (the default): Claude may know the terms and work with them locally; a web search, a fetch,
     an MCP tool or a shell command that calls out is refused when it holds one.
   - **everywhere**: the terms are kept from Claude altogether. A message that holds one comes back unsent, tool
     output shows `[term hidden]`, and no tool call may hold one. In this mode you do not ask for the terms;
     the person types them into the script in their own terminal.
2. Add the terms with the skill's script. Never create or edit the list files by hand.
3. Run the script's `check` on every term you added and tell the person the result term by term. The check
   replays each term against what their sessions of the last 30 days sent out. **A term the check calls
   "LIKELY IN THE WAY" does not stay on the list without their explicit word**: every term refuses every call
   that holds it, whatever the call is about. "Phoenix" on the list means Claude can no longer look up the
   city, the framework or the bird; "Müller" refuses every Müller, not only the client. Offer the full,
   distinctive form instead ("Phoenix Capital Partners", "Müller Feinmechanik Holding").
4. Offer sound matching (`--sound`) only for names people misspell by ear. It follows German and English
   spelling ("Meier" catches Meyer, "Catherine" catches Kathryn) and also catches other people with a similar
   name.

For a team, the same script keeps **shared lists** (`--list <name>`). A shared list stores keyed hashes, never
the terms, in two files: the list, which may travel by any channel including a repository, and its key, which
the person passes on apart from the list. `skills/terms/SHARING.md` explains this step by step for the person
who shares, for the colleagues who receive, and for you. In short: `share <name>` prints both paths and the
steps, `import <list> <key>` takes a list over, `status` shows whether its key is present. You never read,
print or send a key.

What to tell them about the limits:

- The personal list is a plain text file in their Claude config folder. It deserves the same care as the files
  it protects. A shared list does not have that weakness, but nobody can read its terms back, its author
  included.
- The check compares letters. A description of the matter without its name passes.

### A6b. Things only the person can do

Tell them, and don't do these yourself:

- The training setting of a personal plan is at `https://claude.ai/settings/data-privacy-controls`.
- Claude Code puts the address of the signed-in account into every session's context. The plugin leaves it
  out for sessions on this computer. It still stands in the transcripts of earlier sessions, and in cloud
  sessions and repository installs, where the plugin does not run. Tool output that names the account (a
  sign-in status, for example) is masked like any other address. An account that signs in with a dedicated
  alias address keeps the private address out everywhere.

### A7. Prove it

In a session started after the install:

1. Run a harmless shell command that prints an address you make up at a domain you make up (not `example.com`,
   which is allowed). It must be denied with a message starting with `email-guard:`. If it runs, the hook is not
   active: check `claude plugin list`, restart the session and try once more, then report.
2. Run a shell command that builds such an address from two parts at run time and prints it (for example with
   `node -e`, joining the parts with the character of code 64). The call must run, and you must see
   `[email hidden]` in its output.
3. Run a shell command without an address. It must run.
4. Check that the rule is in your context: it starts with "Never use the user's personal email address". Check
   also that your context no longer states the account's email address, and say which of the two you found.
5. Ask the person to send you one message containing a made-up address. It must come back to them unsent.

### A8. Offer the audit

Offer to run the audit skill (`/privacy-guard:audit`) on their stored sessions. It shows which past sessions
put an address into a tool call, by tool and mail domain, without printing an address.

### A9. Is this folder a repository?

Run `git rev-parse --show-toplevel`. If it prints a folder, tell the person:

> What I just installed lives on this computer. A cloud session (Claude Code on the web) runs on Anthropic's
> machines, starts from a fresh clone of the repository and never sees this computer's `~/.claude` folder, so
> the guard is not there. Committed into the repository, the hooks and the rule travel with every clone,
> including the cloud's.

Ask whether to install into this repository too. On a yes, do section B for it.

## B. A repository (and cloud sessions on it)

What reaches a cloud session is what is committed and pushed. Work in a branch and leave committing and pushing
to the person unless they ask you to.

Explain that first, with what will be added to the repository (nine script files, two rule files, three hooks
in its settings), and ask whether to go ahead. Steps 1 to 3 need no further question. Steps 4, 5 and 7 each end
in a question of their own; ask them one at a time.

1. Copy these nine files from `scripts/` into `.claude/hooks/privacy-guard/` of the target repository:
   `lib.mjs`, `sensitive.mjs`, `pictures.mjs`, `office.mjs`, `email-guard.mjs`, `mask-output.mjs`,
   `prompt-check.mjs`, `extract-text.mjs`, `read-text.ps1`.
2. Copy `rules/email-address.md` and `rules/documents.md` into `.claude/rules/` there. In the copy of
   `documents.md`, replace `{extract}` with `.claude/hooks/privacy-guard/extract-text.mjs`. Files in that
   folder are always in context, so the repository does not need the skill as well.
3. Merge `settings/repository-hooks.json` into the repository's `.claude/settings.json`. Keep the hooks it
   already has.
4. Addresses the repository itself needs (a sender address of the product, for example): the guard also reads
   `email-guard.allow.txt` next to its scripts. Ask the person which `@domain` lines to commit there; they
   decide, and they should know the file is visible to everyone with the repository.
5. Run the audit script on the repository (`node skills/audit/audit.mjs --files <repository>`) and show the
   person the files and domains it lists. Editing those lines will be denied from now on unless the address is
   allowed; they decide what to allow and what to remove.
6. Prove it locally as in A7, in a session opened in that repository.
7. Cloud check: ask the person to push the branch, start a cloud session on it and give it the steps of
   `CLOUD-CHECK.md` from this repository (paste the numbered steps). Report what it answers.

Limits to tell the person:

- Repository hooks run in a cloud session that has one repository. Sessions with several repositories and
  project threads do not read a repository's hooks. The docs name SessionStart hooks for cloud sessions; that
  the other hooks run there too is expected but must be seen in step 7.
- Plugins a repository names are not installed in cloud sessions, which is why the scripts are copied.
- A cloud environment's network access (None, Limited with a list of domains, Full) is set per environment by
  the person. Limited with a short list narrows where anything can be sent.
- Whether the telemetry variables have an effect when set on a cloud environment is not documented.
- Which author address commits made in a cloud session carry is not documented. Step 7 shows it.

## C. The organisation (Claude for Teams or Enterprise)

An Owner sets this up; you prepare the files. There are two parts, and an organisation wants both.

The questions, one per turn: where the organisation hosts its copy of this repository; which telemetry level
(as in A3); which hardening settings (as in A5, one at a time); and how the settings are delivered
(server-managed, or a file on each device). After each answer, show what changed in the prepared file.

### C1. Managed settings: the hooks, the rule and the settings for Claude Code

Start from `settings/managed-settings.example.json`:

1. Replace `Cotspheer/claude-privacy-guard` with where the organisation hosts its copy of this repository. Every member's
   machine must be able to clone it.
2. Replace the `claudeMd` value with the full text of `rules/email-address.md` as one JSON string.
3. Adjust `env` to one of the levels in A3. The example is level 2: metrics off, auto-updates on. Keeping
   updates on is the right default for an organisation: security fixes reach every machine without a rollout.
   An organisation that needs to control versions pins them with `requiredMinimumVersion` and its own software
   distribution instead of switching updates off. Take `DISABLE_TELEMETRY` out (level 1) if members rely on
   Remote Control connecting by itself or on skills from claude.ai reaching Claude Code (C2).
4. Add the entries of `settings/hardening.json` the organisation wants (A5).
5. Keep the `appendPlugins` entry. It puts the plugin on the organisation's own tier, together with the two
   entries above it (`enabledPlugins` and the marketplace with a remote source); all three are needed. Without
   it the plugin counts as one a person installed, and Claude Code's built-in security plugin, which runs
   first on organisation accounts, skips its removal of the account address. Use `appendPlugins`, not
   `prependPlugins`: a `prependPlugins` list replaces the place the built-in security plugin takes by itself.
   Whether the address is then left out is untested; have one member run the proof of A7 after the rollout and
   look at step 4.

Two ways to deliver it, and they reach different sessions:

- **Server-managed settings:** claude.ai, Organization settings, Claude Code, Managed settings. Applies to every
  member signed in with the organisation's account, on any machine, and to cloud sessions. Members see a
  one-time approval dialog for the `env` and hook parts.
- **A file on each device**, rolled out by device management:
  - Windows: `C:\Program Files\ClaudeCode\managed-settings.json`
  - macOS: `/Library/Application Support/ClaudeCode/managed-settings.json`
  - Linux and WSL: `/etc/claude-code/managed-settings.json`

  This does not reach cloud sessions.

What members get: the plugin is installed and enabled at their next session start and they cannot switch it
off; the rule loads as managed instructions ahead of their own `CLAUDE.md`.

Tell the Owner:

- The hooks need Node on every member's PATH. Where it is missing they fail open.
- In cloud sessions the rule from `claudeMd` applies, but the plugin's scripts are not there. Repositories used
  in the cloud need section B as well.
- `allowManagedHooksOnly: true` would also block every hook members set up themselves. Leave it out unless the
  organisation wants that.
- Each member keeps their own allow file (A2) and may keep a personal list of confidential terms (A6).
- A list for the whole organisation or for one team is a shared list (A6): hashes in one file, the key in
  another. Device management puts both into each member's Claude config folder, or the list travels in a
  repository and the key reaches members through the environment variable `PRIVACY_GUARD_TERMS_KEY` in the
  managed settings' `env`. Whoever maintains the list adds and removes terms with the `terms` skill and
  redistributes the list file; the key stays the same.
- The host block (A4) is a line in the hosts file or a rule in the organisation's DNS filter or firewall; device
  management rolls it out.

### C2. The skill: the rule for web chats, Cowork and the Office add-ins

Build the skill's ZIP as in D3 and hand it to the Owner. They upload it in Organization settings, Plugins &
skills, and provision it for everyone (or publish it to the organisation as required). It then appears for
every member on claude.ai, and from there in their Claude Code and cloud sessions.

## D. claude.ai: web chats, Cowork, the Office add-ins

No hook exists here, so nothing is blocked. Three things carry the rule. Say that in your introduction, with
what each of the three is in one line. Then do them in this order, one at a time, and wait for the person
after each: explain, ask, do it, say what happened, announce the next.

### D1. A memory entry (you do this, after a yes)

Ask: "May I save one instruction to my memory of you, so that it applies in every future conversation?" and
show them the text:

> Never use my email address for anything: it stays out of searches, fetched URLs, forms, sign-ups, files, code
> and messages. If a task seems to need an address, stop and ask me which one to use.

On a yes, save it to memory in these words. Then tell them:

- it applies from the next conversation on;
- they can see, change or delete it under **Settings → Your Claude → Your memory → Manage**.

If memory is switched off for the account, skip this step and say so.

### D2. Instructions for Claude (the person does this)

You cannot set this field. Send the person this message, with the text in a block they can copy:

> **One setting for you to paste.** It makes the rule part of every conversation, not only the ones where I
> remember it.
>
> 1. Open **Settings** (your name at the bottom left, then Settings).
> 2. Open **Your Claude**. In the older layout this page is called **Account**.
> 3. Find the field **Instructions for Claude**.
> 4. Paste the text below at the end of whatever is already there. Don't replace what you have.
> 5. Save.
>
> ```
> Never use my email address for anything: it stays out of searches, fetched URLs, forms, sign-ups, files,
> code and messages. If a task seems to need an address, stop and ask me which one to use.
> ```
>
> If you work in Projects: each Project has its own instructions (open the Project, then "Instructions"). Paste
> the same text there for Projects where it matters.

Ask them to tell you when it is done, or that they skipped it.

### D3. The skill (you build it, the person uploads it)

1. Create a folder `email-address-privacy` with one file `SKILL.md` whose content is exactly the block below,
   without the fence lines. With this repository at hand, copy `skills/email-address-privacy/SKILL.md` instead.
2. Package the folder as `email-address-privacy.zip`. The ZIP holds the folder, and the folder holds
   `SKILL.md`. Give the person the ZIP as a file to download.
3. Send the person this message:

> **One file for you to upload.** The ZIP above is a skill: a short instruction file that I load whenever a
> task touches an email address. You upload it once.
>
> 1. Download `email-address-privacy.zip` from this chat.
> 2. Open **Customize** in the left sidebar, then **Skills**.
> 3. Click the **+** button, then **Create skill**, then **Upload a skill**.
> 4. Choose the ZIP.
> 5. The skill appears in your list as `email-address-privacy`. Make sure its switch is on.
>
> If there is no Skills page: open **Settings → Capabilities** and switch on **Code execution and file
> creation** (in the newer layout it is called "Create and edit files"), then try again. On a Team or
> Enterprise plan an Owner controls this.
>
> What it reaches: every chat of this account, Cowork, the Office add-ins and cloud sessions. It also syncs
> into Claude Code when you are signed in there with the same account. Keep the ZIP: a skill does not move when
> an account is migrated into an organisation.

<!-- skill:start -->
````markdown
---
name: email-address-privacy
description: Never use the user's email address for anything, in any conversation. It stays out of searches, fetched URLs, forms, sign-ups, files, code, headers, messages and tool calls unless the user was asked for that exact use first and said yes. Use this skill whenever an email address is about to be written, sent or searched for, when a service asks for a contact address or a sign-up, and when the user asks where their address was used.
---

# Email address privacy

The user's email address identifies them to you. It is not there to be used.

## Never, without asking first

- Don't write it anywhere: files, code, config, test data, documents, notes, commit messages, or instructions
  for other agents.
- Don't send it anywhere: no search query, URL, query string, HTTP header, User-Agent, form field, request body
  or message carries it.
- Don't sign up, log in, verify, send or receive anything with it, and don't read or send mail through the
  user's mailbox.
- Don't put it into a tool call to look for it either. To find where it stands, ask the user which term may be
  searched (the mail domain at most) and mask every match in what you show or store.

A yes from the user covers the one use they agreed to, not the next.

## What to do instead

- A service asks for a contact address (crawler etiquette, an API's User-Agent, a registration): use a generic
  client name without an address, or stop and ask the user which address to use.
- An example or a test needs an address: make one up at `example.com`.
- The address already stands in a file, a page or a history: tell the user where. Don't copy or quote it.
- A tool call is refused with a message starting with `email-guard:`: that is a guard working as intended.
  Don't work around it by splitting or encoding the address or by switching tools.

This holds for every address of the user's, not only the one of the account you run under, and for the
addresses of other people you come across: they are not yours to pass on either.
````
<!-- skill:end -->

Tell the person one limit of the sync into Claude Code: it stops when `syncClaudeAiSkills` is `false` there or
when telemetry level 2 or 3 of section A3 is set.

### D4. What else to tell them

- A chat learns an address when it is typed in or when a connector exposes it (mail, calendar, drive). Switching
  such connectors off in chats that don't need them is the effective measure.
- None of the three steps blocks anything. They are instructions I follow.

## Report to the person

End with a short list:

- what you installed and where (files, settings keys, memory entry), and what you left out because they said no;
- the result of each check in A7, and of the cloud check if section B was done;
- what the guard does not cover: an address split into pieces or encoded, what a program sends after it was
  written, sessions on machines without Node, and the account address in each session's context;
- what remains for them to do by hand (A4, A6, A6b, C, D2, the upload in D3).

## Remove it again

- Plugin: `claude plugin uninstall privacy-guard@claude-privacy-guard`, then
  `claude plugin marketplace remove claude-privacy-guard`.
- Settings: take the added keys out of `~/.claude/settings.json`.
- Host block: the person runs the script again with `-Remove` or `--remove`.
- Repository: delete `.claude/hooks/privacy-guard/` and `.claude/rules/email-address.md`, and take the hooks
  out of `.claude/settings.json`.
- Organisation: the Owner removes the entries from the managed settings and the provisioned skill.
- claude.ai: delete the skill under Customize, Skills, the memory entry under "Your memory", and the text from
  "Instructions for Claude".
