// The part of the guard that only a hooks module can do:
//   - the address of the signed-in account is left out of the context Claude is given, and
//   - images and documents pasted into a message are read on this computer before the message is sent.
import type { Register } from 'claude-code'

type Verdict = { mode: string; found: string[]; unavailable?: string }

/** The context block that states the account's email address. */
const ACCOUNT_BLOCK = 'userEmail'

export const register: Register = on => {
  on('prompt.context', async ($, e, next) => {
    const result = await next({ ...e, blocks: e.blocks.filter(block => block.name !== ACCOUNT_BLOCK) })

    return { ...result, blocks: result.blocks.filter(block => block.name !== ACCOUNT_BLOCK) }
  })

  on('prompt.submit', async ($, e, next) => {
    const pasted = (e.attachments ?? []).filter(item => item.id && (item.type === 'image' || item.type === 'document'))

    if (pasted.length === 0) {
      return next(e)
    }

    const findings: string[] = []
    const unread: string[] = []
    let mode = 'check'

    for (const [index, item] of pasted.entries()) {
      const name = item.filename ?? `pasted ${item.type} ${index + 1}`
      let base64 = ''
      let offset: number | undefined
      let isReadable = true

      // The engine hands a large item over in slices.
      do {
        const slice = await $.prompt.media(offset === undefined ? { id: item.id! } : { id: item.id!, offset })

        if (slice.unreadable !== undefined) {
          isReadable = false
          break
        }

        base64 += slice.base64
        offset = slice.next
      } while (offset !== undefined)

      if (!isReadable) {
        unread.push(name)
        continue
      }

      const run = await $.process.run(['node', `${$.plugin.root}/scripts/check-media.mjs`], {
        stdin: JSON.stringify({ filename: item.filename, mediaType: item.mediaType, base64 }),
        timeoutMs: 40000,
      })

      if (run.exitCode !== 0) {
        unread.push(name)
        continue
      }

      const verdict = JSON.parse(run.stdout) as Verdict
      mode = verdict.mode

      if (verdict.found.length > 0) {
        findings.push(`${name} (${verdict.found.join(', ')})`)
      } else if (verdict.unavailable) {
        unread.push(name)
      }
    }

    if (mode === 'off') {
      return next(e)
    }

    if (findings.length > 0) {
      return {
        drop:
          `privacy-guard: your message was not sent. A pasted file would reach Claude unmasked: ${findings.join('; ')}. ` +
          'Save the file and name it in your message instead of pasting it; Claude then gets its text with those values hidden.',
      }
    }

    if (mode === 'strict') {
      return { drop: 'privacy-guard: your message was not sent. Pasted pictures and documents are switched off on this computer.' }
    }

    if (mode === 'confirm' || unread.length > 0) {
      const what = unread.length > 0 ? `The guard could not read ${unread.join(', ')}.` : 'The guard found no address, secret or confidential term in what you pasted.'
      let answer = 'Cancel'

      try {
        answer = await $.ui.ask(`${what} What stands in a pasted picture reaches Claude unmasked. Send the message?`, ['Send it', 'Cancel'])
      } catch {
        // Dismissed, or nobody to ask: the message is not sent.
      }

      if (answer !== 'Send it') {
        return { drop: 'privacy-guard: the message with the pasted file was not sent.' }
      }
    }

    return next(e)
  }).catch(($, e, next) => {
    // The check itself failed. A message with pasted files is held back; any other goes on.
    if (next.called || (e.attachments ?? []).length === 0) {
      return next(e)
    }

    return { drop: 'privacy-guard: the pasted file could not be checked, so the message was not sent. Name the file in your message instead of pasting it.' }
  })
}
