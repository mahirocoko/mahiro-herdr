import assert from 'node:assert/strict'
import {
  mkdtemp,
  readFile,
  writeFile,
  readdir,
  symlink,
  rm
} from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import test from 'node:test'
import { commandText, readProjectCatalog } from '../src/project-actions.mjs'
import {
  manageProjectActions,
  parseActionCommand,
  pickerInput,
  saveProjectActions
} from '../src/project-action-manager.mjs'

const action = { id: 'dev', title: 'Dev', argv: ['npm', 'run', 'dev'] }
const fixture = async (operation) => {
  const root = await mkdtemp(join(tmpdir(), 'herdr-manage-'))
  try {
    await operation(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
const answers = (values) => ({
  ask: async () => {
    assert.ok(values.length, 'unexpected prompt')
    return values.shift()
  }
})

test('command tokenizer roundtrips literal argv, quotes and escapes', () => {
  const argv = ['printf', '%s', "a'b", 'space here', '$literal']
  assert.deepEqual(parseActionCommand(commandText(argv)), argv)
  assert.deepEqual(parseActionCommand('npm run dev -- --host "0.0.0.0"'), [
    'npm',
    'run',
    'dev',
    '--',
    '--host',
    '0.0.0.0'
  ])
  for (const text of [
    'npm test && echo done',
    'echo $HOME',
    'a | b',
    'echo > file',
    'echo\nbad',
    '"unterminated',
    'abc\\'
  ])
    assert.throws(() => parseActionCommand(text))
})

test('missing catalog is empty; create/update/delete persist atomically', async () =>
  fixture(async (root) => {
    let catalog = await readProjectCatalog(root)
    assert.deepEqual(catalog, { actions: [], bytes: null })
    catalog = await saveProjectActions(root, catalog.bytes, [action])
    assert.deepEqual((await readProjectCatalog(root)).actions, [action])
    catalog = await saveProjectActions(root, catalog.bytes, [
      { ...action, title: 'Run dev' }
    ])
    catalog = await saveProjectActions(root, catalog.bytes, [])
    assert.deepEqual((await readProjectCatalog(root)).actions, [])
    assert.deepEqual(await readdir(root), ['.herdr-actions.json'])
  }))

test('external edits and stale editor do not get overwritten', async () =>
  fixture(async (root) => {
    const catalog = await saveProjectActions(root, null, [action])
    const external = JSON.stringify({
      version: 1,
      actions: [{ ...action, title: 'Human edit' }]
    })
    await writeFile(join(root, '.herdr-actions.json'), external)
    await assert.rejects(saveProjectActions(root, catalog.bytes, []), /changed/)
    assert.equal(
      await readFile(join(root, '.herdr-actions.json'), 'utf8'),
      external
    )
  }))

test('concurrent creators have only one winner and no leftover lock', async () =>
  fixture(async (root) => {
    const results = await Promise.allSettled([
      saveProjectActions(root, null, [action]),
      saveProjectActions(root, null, [{ ...action, title: 'Other writer' }])
    ])
    assert.equal(
      results.filter((result) => result.status === 'fulfilled').length,
      1
    )
    assert.deepEqual(await readdir(root), ['.herdr-actions.json'])
  }))

test('symlinks and duplicate IDs cannot be saved over', async () =>
  fixture(async (root) => {
    await writeFile(join(root, 'outside'), 'keep')
    await symlink(join(root, 'outside'), join(root, '.herdr-actions.json'))
    await assert.rejects(saveProjectActions(root, null, [action]))
    assert.equal(await readFile(join(root, 'outside'), 'utf8'), 'keep')
    await assert.rejects(
      saveProjectActions(root, null, [action, action]),
      /duplicate/
    )
  }))

test('Manage Add/Edit/Delete require confirmation and never execute commands', async () =>
  fixture(async (root) => {
    const io = answers([
      'a',
      'dev',
      'Dev',
      'npm run dev',
      'yes',
      'e',
      '1',
      'Build',
      'npm run build',
      'yes',
      'd',
      '1',
      'yes',
      'b'
    ])
    const result = await manageProjectActions(
      root,
      io,
      await readProjectCatalog(root),
      { print: () => {} }
    )
    assert.deepEqual(result.actions, [])
    assert.deepEqual((await readProjectCatalog(root)).actions, [])
  }))

test('Esc during draft and declined save leave missing catalog untouched', async () =>
  fixture(async (root) => {
    const initial = await readProjectCatalog(root)
    await manageProjectActions(root, answers(['a', 'dev', null]), initial, {
      print: () => {}
    })
    await manageProjectActions(
      root,
      answers(['a', 'dev', 'Dev', 'npm run dev', 'no', 'b']),
      initial,
      { print: () => {} }
    )
    assert.deepEqual(await readdir(root), [])
  }))

test('deletion needs exact yes confirmation; Esc preserves existing actions', async () =>
  fixture(async (root) => {
    const catalog = await saveProjectActions(root, null, [action])
    const result = await manageProjectActions(
      root,
      answers(['d', '1', 'no', 'd', '1', null]),
      catalog,
      { print: () => {} }
    )
    assert.deepEqual(result.actions, [action])
    assert.deepEqual((await readProjectCatalog(root)).actions, [action])
  }))

test('keypress Escape aborts pending question and cleanup removes its listener', async () => {
  const stdin = new PassThrough()
  stdin.isTTY = true
  stdin.setRawMode = () => {}
  const stdout = new PassThrough()
  stdout.isTTY = true
  const io = pickerInput(stdin, stdout)
  const answer = io.ask('Choose: ')
  stdin.emit('keypress', '\x1b', { name: 'escape' })
  assert.equal(await answer, null)
  io.close()
  assert.equal(stdin.listenerCount('keypress'), 0)
  stdin.destroy()
  stdout.destroy()
})
