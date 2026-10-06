import assert from 'node:assert/strict'
import test from 'node:test'
import { createTerminalStyle } from '../src/terminal-style.mjs'

test('TTY semantic roles use theme palette slots and reset each fragment', () => {
  const style = createTerminalStyle({ isTTY: true }, { TERM: 'xterm-256color' })
  assert.equal(style.accent('M'), '\x1b[33mM\x1b[0m')
  assert.equal(style.muted('command'), '\x1b[90mcommand\x1b[0m')
  assert.equal(style.success('Saved'), '\x1b[32mSaved\x1b[0m')
  assert.equal(style.danger('Delete'), '\x1b[31mDelete\x1b[0m')
  assert.equal(style.heading('Actions'), '\x1b[1mActions\x1b[0m')
})

test('NO_COLOR including empty value, dumb terminals and redirected output stay plain', () => {
  for (const [output, env] of [
    [{ isTTY: true }, { NO_COLOR: '' }],
    [{ isTTY: true }, { NO_COLOR: '1' }],
    [{ isTTY: true }, { TERM: 'dumb' }],
    [{ isTTY: false }, {}],
    [{}, {}]
  ]) {
    const style = createTerminalStyle(output, env)
    for (const render of Object.values(style))
      assert.equal(render('plain'), 'plain')
  }
})
