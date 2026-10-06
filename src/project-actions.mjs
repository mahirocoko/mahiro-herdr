import { constants } from 'node:fs'
import { open, realpath } from 'node:fs/promises'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

import { runHerdr } from './runtime-helpers.mjs'

const ACTION_FILE = '.herdr-actions.json'
const MAX_BYTES = 64 * 1024
const plainText = (value, max) =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= max &&
  !/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/u.test(value)

export const parseProjectActions = (text) => {
  const catalog = JSON.parse(text)
  if (
    catalog?.version !== 1 ||
    !Array.isArray(catalog.actions) ||
    catalog.actions.length > 32
  ) {
    throw new Error('Expected version 1 and at most 32 project actions')
  }
  const ids = new Set()
  for (const action of catalog.actions) {
    if (
      !action ||
      !/^[a-z][a-z0-9_-]{0,31}$/.test(action.id) ||
      ids.has(action.id) ||
      !plainText(action.title, 80) ||
      !Array.isArray(action.argv) ||
      action.argv.length < 1 ||
      action.argv.length > 64 ||
      !action.argv.every((arg) => plainText(arg, 2048)) ||
      Object.keys(action).some((key) => !['id', 'title', 'argv'].includes(key))
    ) {
      throw new Error(
        'Invalid or duplicate project action; expected id, title and bounded argv'
      )
    }
    ids.add(action.id)
  }
  return catalog.actions
}

export const readProjectCatalog = async (project) => {
  let file
  try {
    file = await open(
      join(project, ACTION_FILE),
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK
    )
  } catch (error) {
    if (error.code === 'ENOENT') return { actions: [], bytes: null }
    throw error
  }
  try {
    const stat = await file.stat()
    if (!stat.isFile() || stat.size > MAX_BYTES)
      throw new Error('Unsafe or oversized action catalog')
    const buffer = Buffer.alloc(MAX_BYTES + 1)
    const { bytesRead } = await file.read(buffer, 0, buffer.length, 0)
    if (bytesRead > MAX_BYTES) throw new Error('Oversized action catalog')
    const bytes = buffer.subarray(0, bytesRead)
    return {
      actions: parseProjectActions(
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      ),
      bytes
    }
  } finally {
    await file.close()
  }
}

export const readProjectActions = async (project) =>
  (await readProjectCatalog(project)).actions

export const projectRoot = async (cwd) => {
  const result = spawnSync('git', ['-C', cwd, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 64 * 1024
  })
  if (result.error || result.status !== 0)
    throw new Error('Caller pane must belong to a Git project')
  return realpath(result.stdout.trim())
}

export const herdrClient = (env, run = runHerdr) => {
  return (args) => {
    const output = run(env, args)
    // These CLI wrappers acknowledge success with exit status, not JSON.
    // Inventory and creation still require a structured ownership receipt.
    if (
      !output.trim() &&
      ((args[0] === 'pane' && args[1] === 'run') ||
        (args[0] === 'tab' && args[1] === 'focus'))
    )
      return { type: 'ok' }
    const response = JSON.parse(output)
    if (response.error || !response.result)
      throw new Error(response.error?.code || 'Invalid Herdr response')
    return response.result
  }
}

export const callerProject = async (env, call, root = projectRoot) => {
  if (env.HERDR_ENV !== '1' || !env.HERDR_PANE_ID)
    throw new Error('Run the picker inside a Herdr project pane')
  const pane = call(['pane', 'get', env.HERDR_PANE_ID]).pane
  if (pane?.pane_id !== env.HERDR_PANE_ID || !pane.workspace_id || !pane.tab_id)
    throw new Error('Caller identity unavailable')
  const cwd = pane.foreground_cwd || pane.cwd
  if (typeof cwd !== 'string' || !cwd.startsWith('/'))
    throw new Error('Caller project cwd unavailable')
  return {
    project: await root(cwd),
    workspaceId: pane.workspace_id,
    callerPaneId: pane.pane_id
  }
}

export const commandText = (argv) =>
  argv.map((arg) => `'${arg.replaceAll("'", "'\\''")}'`).join(' ')

export const nativeActionContext = async (env, call, root = projectRoot) => {
  if (env.HERDR_ENV !== '1' || env.HERDR_PLUGIN_ID !== 'mahiro-herdr')
    throw new Error('Native picker requires this plugin runtime')
  const raw = env.MAHIRO_ACTION_CONTEXT || env.HERDR_PLUGIN_CONTEXT_JSON
  if (!raw || Buffer.byteLength(raw) > 8192)
    throw new Error('Native invocation context unavailable')
  const supplied = JSON.parse(raw)
  const callerPaneId = env.MAHIRO_ACTION_CONTEXT
    ? supplied.callerPaneId
    : supplied.focused_pane_id
  const workspaceId = env.MAHIRO_ACTION_CONTEXT
    ? supplied.workspaceId
    : supplied.workspace_id
  if (typeof callerPaneId !== 'string' || typeof workspaceId !== 'string')
    throw new Error('Native invocation needs an exact pane and workspace')
  const context = await callerProject(
    { ...env, HERDR_PANE_ID: callerPaneId },
    call,
    root
  )
  if (
    context.workspaceId !== workspaceId ||
    (env.MAHIRO_ACTION_CONTEXT && context.project !== supplied.project)
  )
    throw new Error('Native invocation project/workspace changed')
  return context
}

export const openProjectPicker = (context, call) =>
  call([
    'plugin',
    'pane',
    'open',
    '--plugin',
    'mahiro-herdr',
    '--entrypoint',
    'project-actions-picker',
    '--cwd',
    context.project,
    '--env',
    `MAHIRO_ACTION_CONTEXT=${JSON.stringify(context)}`
  ])

// Only the returned, background-created terminal may receive input. Never retry
// creation or submission after an unknown outcome, and never auto-close a tab.
export const launchProjectAction = async (
  context,
  action,
  call,
  options = {}
) => {
  parseProjectActions(JSON.stringify({ version: 1, actions: [action] }))
  const root = options.root || projectRoot
  const caller = call(['pane', 'get', context.callerPaneId]).pane
  if (
    caller?.pane_id !== context.callerPaneId ||
    caller.workspace_id !== context.workspaceId ||
    (await root(caller.foreground_cwd || caller.cwd)) !== context.project
  ) {
    throw new Error('Caller workspace/project changed; reopen the picker')
  }
  const created = call([
    'tab',
    'create',
    '--workspace',
    context.workspaceId,
    '--cwd',
    context.project,
    '--label',
    action.title,
    '--no-focus'
  ])
  const tabId = created.tab?.tab_id
  const paneId = created.root_pane?.pane_id
  if (
    !tabId ||
    !paneId ||
    created.tab.workspace_id !== context.workspaceId ||
    created.root_pane.workspace_id !== context.workspaceId ||
    created.root_pane.tab_id !== tabId ||
    paneId === context.callerPaneId
  )
    throw new Error(
      'New-tab receipt mismatch; no command sent, do not retry blindly'
    )

  const clock = options.clock || Date.now
  const sleep = options.sleep || delay
  const deadline = clock() + 8000
  try {
    while (true) {
      const pane = call(['pane', 'get', paneId]).pane
      if (
        pane?.pane_id !== paneId ||
        pane.workspace_id !== context.workspaceId ||
        pane.tab_id !== tabId ||
        pane.agent ||
        (await realpath(pane.foreground_cwd || pane.cwd)) !== context.project
      ) {
        throw new Error('New terminal ownership/cwd changed')
      }
      const info = call(['pane', 'process-info', '--pane', paneId]).process_info
      if (info?.pane_id !== paneId) throw new Error('Process receipt mismatch')
      if (clock() >= deadline)
        throw new Error('New terminal shell readiness timed out')
      if (
        info.shell_pid > 0 &&
        info.foreground_processes?.length === 1 &&
        info.foreground_processes[0].pid === info.shell_pid
      )
        break
      await sleep(100)
    }
    call(['pane', 'run', paneId, commandText(action.argv)])
    if (options.focus !== false) call(['tab', 'focus', tabId])
  } catch (error) {
    throw new Error(
      `${error.message}; tab ${tabId}, pane ${paneId} retained. Submission may be unknown; inspect before retrying`
    )
  }
  return {
    workspaceId: context.workspaceId,
    tabId,
    paneId,
    actionId: action.id
  }
}
