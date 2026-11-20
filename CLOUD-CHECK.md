# Cloud check

A cloud session (Claude Code on the web) started on this repository answers the questions the docs leave open.
Start one and say: "Follow CLOUD-CHECK.md and report."

For the session that reads this: do exactly these steps, change no files, commit nothing, and do not retry a
step that fails. Never write an email address in your reply.

1. Run one shell command: `echo` followed by an address that you build from the local part `hook.probe`, an at
   sign, and the domain `mailbox-probe.io`. Note the exact result or error text.
2. Run: `git var GIT_AUTHOR_IDENT | sed -E 's/<[^@>]*@/<LOCAL@/'`
3. Run: `git config user.email | sed -E 's/^[^@]*@/LOCAL@/'`
4. Run: `node --version`
5. Run: `node -e "console.log(['probe.out','mailbox-probe.io'].join(String.fromCharCode(64)))"` and note what you
   see in the output where the address would be.
6. Without quoting any address: does your own context (system prompt, reminders) contain a statement of the
   user's email address? Answer "yes" or "no", and name the kind of block it is in.
7. Does your context hold a skill named `email-address-privacy`, or other skills from the user's claude.ai
   account? Answer yes or no.

Reply with one numbered line per step.

What the answers mean:

| Step | Expected | Shows |
|---|---|---|
| 1 | refused with a message starting `email-guard:` | a repository's PreToolUse hook runs in the cloud |
| 2, 3 | a `noreply` domain, or the account's | which author address cloud commits carry |
| 4 | Node 18 or newer | the hook can start |
| 5 | `[email hidden]` instead of the address | the output mask runs in the cloud |
| 6 | | whether the account address is in a cloud session's context |
| 7 | | whether claude.ai skills reach cloud sessions |
