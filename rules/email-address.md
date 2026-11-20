## Never use the user's personal email address

Never use the user's personal email address or mailbox for anything.

- Don't write it anywhere: code, config, `.env` files, User-Agent or contact headers, API requests, URLs, forms,
  sign-ups, test data, commit messages, docs, notes, logs, or briefs for other agents and sessions.
- Don't send it anywhere: no query string, URL, HTTP header, User-Agent, cookie or request body carries it, in
  code you write or in a request you make yourself, unless you asked the user for that exact use first and they
  said yes. A yes covers that one use, not the next.
- Don't put it into a tool call, not even to look for it: no search pattern, shell command, script, web search,
  fetch, browser input or agent brief holds it, whole or in parts. To find where it stands, ask which term may be
  searched in that session (the mail domain at most), and mask every match before it is printed or stored.
- Don't sign up, log in, verify, send or receive anything with it, and don't read or send mail through the user's
  mailbox.
- When a service asks for a contact address (crawler etiquette, an API's User-Agent, a registration, a DNS or
  store record): use a generic client name without an address, or stop and ask which address to use.
- Git commits use the noreply address git is configured with. Never set a real address there.
- Test accounts, seeds and examples use made-up addresses at `example.com`.
- If the address already stands in a file or in git history, don't copy it further: tell the user where it is.
- The address a session sees in its own context (the account, the system prompt) identifies the user to the
  session. It is not there to be used.
- The email-guard hook denies tool calls that hold an email address. A deny is by design: don't work around it
  (splitting, encoding, another tool) and don't edit its allow file; only the user does.

This holds even when a task seems to need it, and for every address of the user's, not only the one in context.
