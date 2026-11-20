# Claude privacy guard

Keeps email addresses, secrets and confidential names out of what Claude Code does on your behalf.

An agent knows the address of the account it runs under, and it reads others in files and command output. Left
alone it may put one into a crawler's User-Agent, a query string, a config file or a search. This repository
adds a check at each of those points. The address checks match the shape of an address, so you never give the
guard your own.

| Where | What happens |
|---|---|
| Tool calls | A hook denies any tool call whose input holds an email address. |
| Tool output | Addresses and secrets (API keys, tokens, private keys) in what tools return are hidden before Claude reads it. |
| Secrets | A call that leaves the computer (web search, fetch, MCP tools, shell commands that call out) is denied when it holds one. A secret is recognised by a format that identifies itself, such as a provider's key prefix, so ordinary hashes and ids pass. |
| Confidential terms | Your own list of names (clients, matters, projects) that such calls may never hold. A term is caught across spacing, case, accents and typing mistakes, and by sound (German and English spelling) where you mark it. You can also keep the terms out of Claude's view entirely. A skill adds terms and checks against your own session history whether one would get in your way. A team shares a list that holds keyed hashes in place of the names. |
| Prompts | A message you send with an address in it comes back unsent, with the reason. So does one that attaches a file with `@` that holds one. |
| Account address | The address of the account Claude runs under is left out of the context it is given. |
| Pasted files | An image or document pasted into a message is read before the message is sent. If it holds an address, a secret or a term kept from Claude, the message comes back unsent. |
| Office files | Word, Excel, PowerPoint and OpenDocument files reach Claude as text from the guard's own reader, with the text of pictures embedded in them and the values hidden. A rule tells Claude to pass images that its own extraction tools produce through the same reader. |
| Images and PDFs | Before Claude opens one, the guard reads its text on this computer. A file with an address, a secret or a term kept from Claude is refused, and Claude works from the text with those values hidden. You can also be asked before every picture. |
| Commits | A `git commit` whose changes add an address is denied. |
| The rule | Tells each session why. It comes with the plugin, through a repository, or through an organisation's managed settings, and as a skill for claude.ai, where no hook exists. |
| Audit | Lists which past sessions and which files hold an address, by mail domain only. |
| Settings | Three levels switch off Claude Code's error reports, feedback command and survey, then usage metrics, then auto-updates; INSTALL.md says what each level costs. There is also a host block for the telemetry-only hosts, and a few hardening settings. |

## Install

Hand [INSTALL.md](INSTALL.md) to your Claude Code agent: "install the privacy guard from this repository,
follow INSTALL.md". It asks what to cover (this computer, a repository and its cloud sessions, a whole
organisation, claude.ai), shows each change before making it, and proves that the hooks work.

In a web chat on claude.ai, give Claude the same file. It saves the rule to memory and builds the skill for you
to upload. One setting you paste yourself, and it tells you where.

By hand, for one computer:

```
claude plugin marketplace add Cotspheer/claude-privacy-guard
claude plugin install privacy-guard@claude-privacy-guard
```

The hooks need Node 18 or newer on the PATH.

## What passes

Reserved test domains (`example.com`, `.test`, `.local` and the like), the Anthropic and GitHub noreply
addresses, retina image names, package versions, SSH remotes and credentials in connection strings. Anything
else you allow yourself, one line per address or `@domain`, in `~/.claude/email-guard.allow.txt`.

## What it does not do

- It does not remove the account address from the transcripts of earlier sessions, and not in cloud sessions
  or repository installs, where only the plain hooks run. On an account of a Team or Enterprise organisation
  the address also stays in the context: Claude Code's own security plugin runs first there and skips this
  step of a plugin you installed yourself.
- It checks Claude's own actions. Once a program is written, its requests are outside the guard's reach; the
  guard catches the write and the commit of that program.
- An address split into pieces or encoded in some other way passes.
- A pasted file cannot be replaced by its text, only held back.
- Text recognition misses small, stylised or handwritten text. On Linux and macOS it needs `pdftotext` and
  `tesseract`; without them images and scanned PDFs open unchecked.
- Without Node the hooks cannot start, and Claude Code then lets tool calls through.
- On claude.ai nothing is blocked. The skill, the memory entry and the instructions are text Claude follows,
  and no hook enforces them.

## Layout

| Path | Content |
|---|---|
| `scripts/email-guard.mjs` | tool-call guard and commit check (PreToolUse) |
| `scripts/mask-output.mjs` | output mask (PostToolUse) |
| `scripts/prompt-check.mjs` | prompt check (UserPromptSubmit) |
| `scripts/session-rule.mjs` | puts the rule into each session's context (SessionStart) |
| `scripts/lib.mjs` | what counts as an address and which ones are allowed |
| `scripts/sensitive.mjs` | secrets, confidential terms, and which calls leave the computer |
| `scripts/pictures.mjs`, `office.mjs`, `read-text.ps1`, `extract-text.mjs` | the check of images and PDFs, the reader for Office files, and the text Claude gets in their place |
| `scripts/*.test.mjs` | the tests: `node --test scripts/*.test.mjs` |
| `scripts/block-telemetry-hosts.*`, `scripts/telemetry-hosts.txt` | the host block for Windows and for Linux and macOS, and the hosts it covers |
| `rules/email-address.md`, `rules/documents.md` | the rule, and how Claude reads documents and pictures |
| `skills/email-address-privacy/` | the rule as a skill, for claude.ai |
| `skills/audit/` | the audit of sessions and files, and the check of which hosts Claude contacts (`/privacy-guard:audit`) |
| `skills/terms/` | confidential terms: add, remove, check, share (`/privacy-guard:terms`); [SHARING.md](skills/terms/SHARING.md) explains team lists |
| `hooks/hooks.json`, `.claude-plugin/` | the plugin, its marketplace entry and its icon |
| `hooks/register.ts`, `scripts/check-media.mjs` | the hooks module: the account address left out of the context, and the check of pasted files |
| `assets/icon.svg` | the icon's source |
| `settings/` | settings to merge, the hooks for a repository, and an example for managed settings |
| `.claude/settings.json` | this repository guards itself with its own hooks, also in cloud sessions |
| `CLOUD-CHECK.md` | steps for a cloud session that show what runs there |

## Licence

Apache License 2.0, see [LICENSE](LICENSE). If you pass this software on, changed or unchanged, keep the
[NOTICE](NOTICE) file with it and say what you changed.
