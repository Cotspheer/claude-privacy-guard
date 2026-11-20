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
