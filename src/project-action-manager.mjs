import { mkdir, writeFile, rename, unlink, rmdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createInterface } from 'node:readline/promises'
import { createTerminalStyle } from './terminal-style.mjs'
import {
  commandText,
  parseProjectActions,
  readProjectCatalog
} from './project-actions.mjs'

// Intentionally an argv tokenizer, not a shell interpreter. No pipes, expansion,
// redirects or compound commands; explicit executable/arguments stay literal.
export const parseActionCommand = (text) => {
  if (typeof text !== 'string' || /[\u0000-\u001f\u007f-\u009f]/u.test(text))
    throw new Error('Command must be one printable line')
  const argv = []
  let word = ''
  let quote = ''
  let escaped = false
  let started = false
  for (const char of text) {
    if (escaped) {
      word += char
      escaped = false
      started = true
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      started = true
      continue
    }
    if (quote) {
      if (char === quote) quote = ''
      else word += char
      started = true
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/u.test(char)) {
      if (started) {
        argv.push(word)
        word = ''
        started = false
      }
    } else {
      if (/[|&;<>()$`]/u.test(char))
        throw new Error(
          'Use executable arguments, not shell operators or expansion'
        )
      word += char
      started = true
    }
  }
  if (escaped || quote) throw new Error('Unclosed quote or trailing escape')
  if (started) argv.push(word)
  parseProjectActions(
    JSON.stringify({
      version: 1,
      actions: [{ id: 'validate', title: 'Validate', argv }]
    })
  )
  return argv
}

export const saveProjectActions = async (project, expectedBytes, actions) => {
  const bytes = Buffer.from(
    JSON.stringify({ version: 1, actions }, null, 2) + '\n'
  )
  if (bytes.length > 65536) throw new Error('Action catalog exceeds 64 KiB')
  parseProjectActions(bytes.toString())
  const nonce = randomUUID()
  const lock = join(project, '.herdr-actions.lock')
  const owner = join(lock, `owner-${nonce}.json`)
  const temp = join(project, `.herdr-actions-${nonce}.tmp`)
  await mkdir(lock, { mode: 0o700 }) // Contention/stale locks fail closed; never reclaim by age.
  try {
    await writeFile(owner, JSON.stringify({ pid: process.pid, nonce }), {
      flag: 'wx',
      mode: 0o600
    })
    const matches = (current) =>
      expectedBytes === null
        ? current === null
        : current !== null && current.equals(expectedBytes)
    if (!matches((await readProjectCatalog(project)).bytes))
      throw new Error('Actions changed elsewhere; reopen Manage before saving')
    await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
    if (!matches((await readProjectCatalog(project)).bytes))
      throw new Error('Actions changed during save; no overwrite performed')
    await rename(temp, join(project, '.herdr-actions.json'))
    return { actions, bytes }
  } finally {
    await unlink(temp).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    await unlink(owner).catch((error) => {
      if (error.code !== 'ENOENT') throw error
    })
    await rmdir(lock)
  }
}

export const pickerInput = (stdin = process.stdin, stdout = process.stdout) => {
  const input = createInterface({
    input: stdin,
    output: stdout,
    terminal: true,
    escapeCodeTimeout: 50
  })
  let pending
  const cancel = () => pending?.abort()
  const onKey = (_text, key) => {
    if (key?.name === 'escape') cancel()
  }
  stdin.on('keypress', onKey)
  input.on('SIGINT', cancel)
  return {
    ask: async (prompt) => {
      pending = new AbortController()
      try {
        return await input.question(prompt, { signal: pending.signal })
      } catch (error) {
        if (error.name === 'AbortError') return null
        throw error
      } finally {
        pending = null
      }
    },
    close: () => {
      stdin.off('keypress', onKey)
      input.off('SIGINT', cancel)
      input.close()
    }
  }
}

export const manageProjectActions = async (
  project,
  io,
  catalog,
  options = {}
) => {
  const save = options.save || saveProjectActions
  const print = options.print || console.log
  const style = options.style || createTerminalStyle()
  while (true) {
    print(`\n${style.heading('Manage project actions')}`)
    catalog.actions.forEach((action, index) =>
      print(
        `${style.accent(`${index + 1}.`)} ${action.title} ${style.muted(`(${action.id}) · ${commandText(action.argv)}`)}`
      )
    )
    const choice = (
      await io.ask(
        `\n${style.accent('[A]')} Add  ${style.accent('[E]')} Edit  ${style.danger('[D] Delete')}  ${style.accent('[B]')} Back ${style.muted('(Esc cancels)')}: `
      )
    )
      ?.trim()
      .toLowerCase()
    if (!choice || choice === 'b') return catalog
    try {
      let actions = catalog.actions.map((action) => ({
        ...action,
        argv: [...action.argv]
      }))
      if (!['a', 'e', 'd'].includes(choice)) {
        print('Choose A, E, D or B')
        continue
      }
      let index = actions.length
      if (choice !== 'a') {
        const number = (await io.ask('Action number: '))?.trim()
        if (number === undefined) return catalog
        if (!/^[1-9][0-9]*$/.test(number))
          throw new Error('Choose a listed action number')
        index = Number(number) - 1
        if (!actions[index]) throw new Error('Unknown action number')
      }
      if (choice === 'd') {
        const answer = await io.ask(
          `${style.danger(`Delete ${actions[index].title}?`)} Type yes: `
        )
        if (answer === null) return catalog
        if (answer.trim().toLowerCase() !== 'yes') continue
        actions.splice(index, 1)
      } else {
        const current = actions[index]
        const id = current?.id || (await io.ask('ID (e.g. dev): '))?.trim()
        if (id === undefined) return catalog
        const title = await io.ask(
          `Title${current ? ` [${current.title}]` : ''}: `
        )
        if (title === null) return catalog
        const command = await io.ask(
          `Command${current ? ` [${commandText(current.argv)}]` : ''} (argv; no pipes/expansion): `
        )
        if (command === null) return catalog
        actions[index] = {
          id,
          title: title.trim() || current?.title,
          argv: command.trim()
            ? parseActionCommand(command.trim())
            : current?.argv
        }
        parseProjectActions(JSON.stringify({ version: 1, actions }))
        const confirmation = await io.ask(
          `Save ${actions[index].title} · ${commandText(actions[index].argv)}? Type yes: `
        )
        if (confirmation === null) return catalog
        if (confirmation.trim().toLowerCase() !== 'yes') continue
      }
      catalog = await save(project, catalog.bytes, actions)
      print(
        `${style.success('Saved.')} ${style.muted('Nothing was executed.')}`
      )
    } catch (error) {
      print(style.danger(`Not saved: ${error.message}`))
      // A drift error must not be retried against silently refreshed user data.
      if (/changed|EEXIST/.test(error.message)) return catalog
    }
  }
}
