import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import {
  callerProject,
  commandText,
  paneCommandText,
  herdrClient,
  launchProjectAction,
  nativeActionContext,
  openProjectPicker,
  parseProjectActions,
  readProjectActions
} from '../src/project-actions.mjs'

const project = process.cwd()

test('silent CLI acknowledgement is accepted only for run and focus', () => {
  const call = herdrClient({}, () => '')
  assert.deepEqual(call(['pane', 'run', 'w1:p2', 'echo ok']), { type: 'ok' })
  assert.deepEqual(call(['tab', 'focus', 'w1:t2']), { type: 'ok' })
  assert.throws(() => call(['tab', 'create']))
  assert.throws(() => call(['pane', 'get', 'w1:p2']))
})

const context = { project, workspaceId: 'w1', callerPaneId: 'w1:p1' }

test('native popup keeps original project context without a popup pane ID', async () => {
  const { call } = fixture()
  const env = {
    HERDR_ENV: '1',
    HERDR_PLUGIN_ID: 'mahiro-herdr',
    MAHIRO_ACTION_CONTEXT: JSON.stringify(context)
  }
  assert.deepEqual(
    await nativeActionContext(env, call, async () => project),
    context
  )
  await assert.rejects(
    nativeActionContext({ ...env, HERDR_ENV: '0' }, call),
    /runtime/
  )
  await assert.rejects(
    nativeActionContext(env, call, async () => '/another-project'),
    /changed/
  )
})

test('native action derives and validates its exact focused workspace/pane', async () => {
  const { call } = fixture()
  const env = {
    HERDR_ENV: '1',
    HERDR_PLUGIN_ID: 'mahiro-herdr',
    HERDR_PLUGIN_CONTEXT_JSON: JSON.stringify({
      focused_pane_id: 'w1:p1',
      workspace_id: 'w1'
    })
  }
  assert.deepEqual(
    await nativeActionContext(env, call, async () => project),
    context
  )
  await assert.rejects(
    nativeActionContext(
      {
        ...env,
        HERDR_PLUGIN_CONTEXT_JSON:
          '{"focused_pane_id":"w1:p1","workspace_id":"w2"}'
      },
      call,
      async () => project
    ),
    /changed/
  )
  await assert.rejects(
    nativeActionContext({ ...env, HERDR_PLUGIN_CONTEXT_JSON: '{}' }, call),
    /exact pane/
  )
})

test('native opener passes a frozen project context via argv to declared picker', () => {
  let observed
  openProjectPicker(context, (args) => {
    observed = args
    return { type: 'ok' }
  })
  assert.deepEqual(observed, [
    'plugin',
    'pane',
    'open',
    '--plugin',
    'mahiro-herdr',
    '--entrypoint',
    'project-actions-picker',
    '--cwd',
    project,
    '--env',
    `MAHIRO_ACTION_CONTEXT=${JSON.stringify(context)}`
  ])
})
const action = {
  id: 'test',
  title: 'Test',
  argv: ['printf', '%s', "a'b; $(echo NOT_EXECUTED)"]
}
const pane = {
  pane_id: 'w1:p2',
  workspace_id: 'w1',
  tab_id: 'w1:t2',
  cwd: project
}

const fixture = (change = () => {}) => {
  const calls = []
  const call = (args) => {
    calls.push(args)
    const key = args.slice(0, 2).join(' ')
    let result
    if (key === 'pane get')
      result = {
        pane:
          args[2] === context.callerPaneId
            ? { ...pane, pane_id: context.callerPaneId }
            : { ...pane }
      }
    if (key === 'tab create')
      result = {
        tab: { tab_id: pane.tab_id, workspace_id: 'w1' },
        root_pane: { ...pane }
      }
    if (key === 'pane process-info')
      result = {
        process_info: {
          pane_id: pane.pane_id,
          shell_pid: 42,
          foreground_processes: [{ pid: 42 }]
        }
      }
    if (key === 'pane run' || key === 'tab focus') result = { type: 'ok' }
    change(args, result)
    return result
  }
  return { call, calls }
}

test('catalog rejects duplicate IDs, arbitrary fields and terminal controls', () => {
  const parse = (actions) =>
    parseProjectActions(JSON.stringify({ version: 1, actions }))
  assert.deepEqual(parse([action]), [action])
  for (const actions of [
    [action, action],
    [{ ...action, command: 'bad' }],
    [{ ...action, title: '\x1b[2J' }],
    [{ ...action, argv: ['echo', 'a\nb'] }],
    [{ ...action, argv: [] }]
  ]) {
    assert.throws(() => parse(actions))
  }
})

test('shell quoting preserves literal argv without executing metacharacters', () => {
  if (process.platform === 'win32') {
    const literal = "a'b | $not space"
    const argv = ['Write-Output', literal]
    const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', paneCommandText(argv, 'powershell')], { encoding: 'buffer' })
    assert.equal(result.status, 0)
    const decoded = result.stdout.includes(0) ? result.stdout.toString('utf16le') : result.stdout.toString('utf8')
    assert.equal(decoded.replace(/^\uFEFF/u, '').trim(), literal)
    return
  }
  const result = spawnSync('/bin/sh', ['-c', commandText(action.argv)], {
    encoding: 'utf8'
  })
  assert.equal(result.status, 0)
  assert.equal(result.stdout, action.argv[2])
})

test('catalog reads only a bounded regular non-symlink file', async () => {
  const root = await mkdtemp(join(tmpdir(), 'herdr-actions-test-'))
  try {
    const file = join(root, '.herdr-actions.json')
    await writeFile(file, JSON.stringify({ version: 1, actions: [action] }))
    assert.deepEqual(await readProjectActions(root), [action])
    await rm(file)
    await symlink(join(root, 'other'), file)
    await assert.rejects(readProjectActions(root))
    await rm(file)
    await writeFile(file, ' '.repeat(65537))
    await assert.rejects(readProjectActions(root), /oversized/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('outside runtime cannot claim a caller pane', async () => {
  await assert.rejects(
    callerProject({ HERDR_PANE_ID: 'w1:p1' }, () => {
      throw new Error('must not call')
    }),
    /inside a Herdr/
  )
})

test('launch targets returned new pane in same workspace, then focuses its tab', async () => {
  const { call, calls } = fixture()
  const receipt = await launchProjectAction(context, action, call, {
    root: async () => project
  })
  assert.deepEqual(receipt, {
    workspaceId: 'w1',
    tabId: 'w1:t2',
    paneId: 'w1:p2',
    actionId: 'test'
  })
  assert.deepEqual(
    calls.find((args) => args[0] === 'tab' && args[1] === 'create'),
    [
      'tab',
      'create',
      '--workspace',
      'w1',
      '--cwd',
      project,
      '--label',
      'Test',
      '--no-focus'
    ]
  )
  assert.deepEqual(
    calls.find((args) => args[1] === 'run'),
    ['pane', 'run', 'w1:p2', paneCommandText(action.argv)]
  )
  assert.deepEqual(calls.at(-1), ['tab', 'focus', 'w1:t2'])
})

test('caller project drift rejects before tab creation', async () => {
  const { call, calls } = fixture()
  await assert.rejects(
    launchProjectAction(context, action, call, {
      root: async () => '/other-project'
    }),
    /changed/
  )
  assert.equal(calls.length, 1)
})

test('cross-workspace or caller-pane creation receipt never receives input', async () => {
  for (const corrupt of [
    (result) => {
      result.tab.workspace_id = 'w2'
    },
    (result) => {
      result.root_pane.pane_id = context.callerPaneId
    }
  ]) {
    const { call, calls } = fixture((args, result) => {
      if (args[1] === 'create') corrupt(result)
    })
    await assert.rejects(
      launchProjectAction(context, action, call, { root: async () => project }),
      /receipt mismatch/
    )
    assert.equal(
      calls.some((args) => args[1] === 'run'),
      false
    )
  }
})

test('busy shell times out without sending command or auto-closing tab', async () => {
  let now = 0
  const { call, calls } = fixture((args, result) => {
    if (args[1] === 'process-info')
      result.process_info.foreground_processes = [{ pid: 99 }]
  })
  await assert.rejects(
    launchProjectAction(context, action, call, {
      root: async () => project,
      clock: () => now,
      sleep: async () => {
        now += 8000
      }
    }),
    /readiness timed out/
  )
  assert.equal(
    calls.some((args) => ['run', 'close'].includes(args[1])),
    false
  )
})

test('agent taking over new terminal is rejected', async () => {
  const { call, calls } = fixture((args, result) => {
    if (args[1] === 'get' && args[2] === pane.pane_id)
      result.pane.agent = 'letta'
  })
  await assert.rejects(
    launchProjectAction(context, action, call, { root: async () => project }),
    /ownership/
  )
  assert.equal(
    calls.some((args) => args[1] === 'run'),
    false
  )
})

test('unknown submission outcome is not retried', async () => {
  const { call, calls } = fixture((args) => {
    if (args[1] === 'run') throw new Error('timeout')
  })
  await assert.rejects(
    launchProjectAction(context, action, call, { root: async () => project }),
    /Submission may be unknown/
  )
  assert.equal(calls.filter((args) => args[1] === 'run').length, 1)
  assert.equal(calls.filter((args) => args[1] === 'create').length, 1)
})
