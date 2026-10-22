import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { access, mkdir, mkdtemp, readFile, writeFile, symlink, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join, resolve } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

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
import { writeNodeStub } from './stub-executable.mjs'

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

test('picker command loads from HERDR_PLUGIN_ROOT outside the plugin checkout', async () => {
  const repoRoot = fileURLToPath(new URL('..', import.meta.url))
  const manifest = (await readFile(new URL('../herdr-plugin.toml', import.meta.url), 'utf8')).replaceAll('\r\n', '\n')
  const picker = manifest
    .split(/^\[\[panes\]\]$/m)
    .slice(1)
    .find((block) => /^id = "project-actions-picker"$/m.test(block))
  const command = JSON.parse(picker.match(/^command = (\[.*\])$/m)[1])
  assert.deepEqual(command.slice(0, 2), ['node', '-e'])
  assert.match(command[2], /HERDR_PLUGIN_ROOT/)
  assert.match(command[2], /mahiro-herdr-actions\.mjs/)
  const argvProbe = spawnSync(
    process.execPath,
    ['-e', 'process.stdout.write(JSON.stringify(process.argv.slice(2)))'],
    { encoding: 'utf8', shell: false, windowsHide: true }
  )
  assert.equal(argvProbe.stdout, '[]')
  const root = await mkdtemp(join(tmpdir(), 'herdr-picker-'))
  const home = join(root, 'home')
  const cwd = join(root, 'project')
  const log = join(root, 'herdr.log')
  try {
    await mkdir(home)
    await mkdir(cwd)
    await mkdir(join(home, 'cache'))
    assert.notEqual(resolve(cwd), resolve(repoRoot))
    await assert.rejects(access(join(cwd, 'bin', 'mahiro-herdr-actions.mjs')))
    const herdrBin = await writeNodeStub(
      join(root, 'herdr-stub'),
      "#!/usr/bin/env node\nimport { appendFileSync } from 'node:fs'\nappendFileSync(process.env.HERDR_TEST_LOG, 'called\\n')\nprocess.exit(1)\n"
    )
    const result = spawnSync(command[0], command.slice(1), {
      cwd,
      encoding: 'utf8',
      shell: false,
      windowsHide: true,
      timeout: 20000,
      env: {
        HOME: home,
        USERPROFILE: home,
        PATH: [dirname(process.execPath), root].join(delimiter),
        PATHEXT: process.env.PATHEXT,
        SystemRoot: process.env.SystemRoot,
        HERDR_PLUGIN_ROOT: repoRoot,
        HERDR_ENV: '1',
        HERDR_PLUGIN_ID: 'mahiro-herdr',
        HERDR_PLUGIN_ENTRYPOINT_ID: 'project-actions-picker',
        HERDR_BIN_PATH: herdrBin,
        HERDR_TEST_LOG: log,
        HERDR_CONFIG_PATH: join(home, 'herdr', 'config.toml'),
        HERDR_PLUGIN_CONFIG_DIR: join(home, 'plugin'),
        MAHIRO_HERDR_USAGE_CACHE_DIR: join(home, 'cache')
      }
    })
    assert.equal(result.status, 1)
    assert.match(
      result.stderr,
      /mahiro-herdr-actions: Native invocation context unavailable/
    )
    assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /MODULE_NOT_FOUND|ERR_MODULE_NOT_FOUND/)
    await assert.rejects(access(log))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
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
          foreground_processes: [{ pid: 42, name: 'zsh' }]
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
    const literal = "a'b | $not %PATH% space"
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

test('command text matches the pane shell and cmd rejects unsafe quotes', () => {
  assert.equal(
    paneCommandText(['npm', 'run', 'a&b^c'], 'cmd'),
    '"npm" "run" "a&b^c"'
  )
  assert.equal(paneCommandText(['echo', ''], 'cmd'), '"echo" ""')
  assert.equal(
    paneCommandText(['printf', '%s', "a'b; $(echo NOT_EXECUTED)"], 'posix'),
    `'printf' '%s' 'a'\\''b; $(echo NOT_EXECUTED)'`
  )
  assert.equal(paneCommandText(['npm', "a'b"], 'powershell'), "& 'npm' 'a''b'")
  assert.throws(() => paneCommandText(['npm']), /unsupported pane shell/)
  for (const arg of ['%PATH%', 'say "hi"', '100%']) {
    assert.throws(
      () => paneCommandText(['echo', arg], 'cmd'),
      /argument cannot be quoted safely for cmd.exe; no command sent/
    )
  }
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
    ['pane', 'run', 'w1:p2', paneCommandText(action.argv, 'posix')]
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

test('launch quotes for the created pane shell process name', async () => {
  const accepted = [
    ['cmd.exe', 'cmd', ['npm', 'run', 'dev']],
    ['bash.exe', 'posix', ['printf', '%s', "a'b; $(echo NOT_EXECUTED)"]],
    ['C:\\Program Files\\Git\\bin\\bash.exe', 'posix', ['printf', 'ok']],
    ['pwsh.exe', 'powershell', ['npm', 'run', 'dev']],
    ['PowerShell.EXE', 'powershell', ['npm', "a'b"]]
  ]
  for (const [name, shell, argv] of accepted) {
    const { call, calls } = fixture((args, result) => {
      if (args[1] === 'process-info')
        result.process_info.foreground_processes[0].name = name
    })
    const selected = { ...action, argv }
    await launchProjectAction(context, selected, call, {
      root: async () => project
    })
    assert.deepEqual(calls.find((args) => args[1] === 'run'), [
      'pane',
      'run',
      'w1:p2',
      paneCommandText(argv, shell)
    ])
  }
})

test('unsupported shells and unsafe cmd arguments send no command', async () => {
  const rejected = [
    { name: 'fish', argv: action.argv, pattern: /Unsupported shell fish; no command sent/ },
    { name: 'fish.exe', argv: action.argv, pattern: /Unsupported shell fish.exe; no command sent/ },
    { name: 'nu', argv: action.argv, pattern: /Unsupported shell nu; no command sent/ },
    { name: undefined, argv: action.argv, pattern: /Unsupported shell \(missing\); no command sent/ },
    {
      name: `fish\u0000${'Y'.repeat(80)}`,
      argv: action.argv,
      pattern: /Unsupported shell fishY{60}; no command sent/
    },
    {
      name: 'cmd.exe',
      argv: ['echo', '%PATH%'],
      pattern: /argument cannot be quoted safely for cmd.exe; no command sent/
    },
    {
      name: 'cmd.exe',
      argv: ['echo', 'say "hi"'],
      pattern: /argument cannot be quoted safely for cmd.exe; no command sent/
    }
  ]
  for (const item of rejected) {
    const { call, calls } = fixture((args, result) => {
      if (args[1] === 'process-info')
        result.process_info.foreground_processes[0].name = item.name
    })
    await assert.rejects(
      launchProjectAction(context, { ...action, argv: item.argv }, call, {
        root: async () => project
      }),
      (error) => {
        assert.match(error.message, item.pattern)
        assert.match(error.message, /tab w1:t2, pane w1:p2 retained/)
        assert.equal(error.message.includes('\u0000'), false)
        const label = error.message.match(/Unsupported shell ([^;]*); no command sent/u)
        if (label) assert.ok(label[1].length <= 64)
        return true
      }
    )
    assert.equal(calls.some((args) => args[1] === 'run'), false)
  }
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
