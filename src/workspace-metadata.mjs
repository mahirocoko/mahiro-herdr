import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve as resolvePath, basename } from 'node:path'

import {
  COMMAND_TIMEOUT_MS,
  INVOCATION_DEADLINE_MS,
  MAX_OUTPUT_BYTES,
  MAX_U64,
  commandInvocation,
  observeSequence,
  runHerdr,
  samePath,
  sanitizeToken
} from './runtime-helpers.mjs'

export const WORKSPACE_SOURCE = 'mahiro-herdr.workspace'
export const OWNED_WORKSPACE_TOKENS = [
  'mahiro_workspace_branch',
  'mahiro_workspace_git_status',
  'mahiro_workspace_worktree',
  'mahiro_workspace_ports'
]
export const MAX_WORKSPACES = 128
export const WORKSPACE_TTL_MS = 5 * 60 * 1000

const DELIVERY_HEADROOM_MS = 1000
const PORTS_BUDGET_MS = 3000
const MAX_ID_CHARS = 128

function validId(value) {
  return typeof value === 'string' && value.length > 0 && Array.from(value).length <= MAX_ID_CHARS && !/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/u.test(value)
}

function isValidPath(value) {
  return typeof value === 'string' && value.length > 0 && isAbsolute(value) && !value.includes('\0')
}

export function dedupeWorkspaces(workspaces) {
  const selected = new Map()
  for (const ws of workspaces) {
    if (ws && validId(ws.workspace_id)) {
      if (!selected.has(ws.workspace_id)) selected.set(ws.workspace_id, ws)
      if (selected.size > MAX_WORKSPACES) {
        throw new Error(`workspace inventory exceeds the ${MAX_WORKSPACES}-workspace refresh limit`)
      }
    }
  }
  return [...selected.values()]
}

export function determineWorkspaceRepository(workspace, snapshot) {
  if (!workspace || typeof workspace !== 'object') return null

  // 1. Linked worktree checkout path from Herdr workspace worktree metadata
  if (workspace.worktree && workspace.worktree.is_linked_worktree === true) {
    if (isValidPath(workspace.worktree.checkout_path)) {
      const cwd = resolvePath(workspace.worktree.checkout_path)
      const worktreeLabel = sanitizeToken(basename(cwd))
      return { cwd, isLinked: true, worktreeLabel }
    }
    return null
  }

  // 2. Active tab layout focused pane foreground_cwd || cwd
  let candidateCwd = null
  const activeTabId = workspace.active_tab_id
  if (activeTabId && Array.isArray(snapshot?.layouts)) {
    const layout = snapshot.layouts.find(item => item && item.workspace_id === workspace.workspace_id && item.tab_id === activeTabId)
    if (layout && validId(layout.focused_pane_id) && Array.isArray(snapshot?.panes)) {
      const focusedPane = snapshot.panes.find(item => item && item.pane_id === layout.focused_pane_id && item.workspace_id === workspace.workspace_id)
      if (focusedPane) {
        const raw = focusedPane.foreground_cwd || focusedPane.cwd
        if (isValidPath(raw)) {
          candidateCwd = resolvePath(raw)
        }
      }
    }
  }

  // 3. Clear deterministic fallbacks
  if (!candidateCwd) {
    // Fallback A: Non-linked checkout_path explicitly recorded on workspace
    if (workspace.worktree && isValidPath(workspace.worktree.checkout_path)) {
      candidateCwd = resolvePath(workspace.worktree.checkout_path)
    }
  }

  if (!candidateCwd && activeTabId && Array.isArray(snapshot?.panes)) {
    // Fallback B: Panes in active tab with identical resolved cwd
    const tabPanes = snapshot.panes.filter(item => item && item.workspace_id === workspace.workspace_id && item.tab_id === activeTabId)
    const validCwds = tabPanes
      .map(item => item.foreground_cwd || item.cwd)
      .filter(isValidPath)
      .map(item => resolvePath(item))
    if (validCwds.length > 0 && new Set(validCwds).size === 1) {
      candidateCwd = validCwds[0]
    }
  }

  if (!candidateCwd && Array.isArray(snapshot?.panes)) {
    // Fallback C: All panes in workspace with identical resolved cwd
    const wsPanes = snapshot.panes.filter(item => item && item.workspace_id === workspace.workspace_id)
    const allCwds = wsPanes
      .map(item => item.foreground_cwd || item.cwd)
      .filter(isValidPath)
      .map(item => resolvePath(item))
    if (allCwds.length > 0 && new Set(allCwds).size === 1) {
      candidateCwd = allCwds[0]
    }
  }

  if (!candidateCwd) return null

  return {
    cwd: candidateCwd,
    isLinked: false,
    worktreeLabel: null
  }
}

function runGit(gitBin, args, cwd, options) {
  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  const remaining = Math.floor(deadline - clock())
  if (remaining <= DELIVERY_HEADROOM_MS) {
    throw new Error('invocation deadline exhausted before Git command')
  }

  const timeout = Math.min(COMMAND_TIMEOUT_MS, remaining)
  const command = commandInvocation(gitBin, args)
  const result = spawnSync(command.file, command.args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    killSignal: 'SIGKILL',
    windowsHide: true,
    env: {
      ...options.env,
      LC_ALL: 'C',
      GIT_TERMINAL_PROMPT: '0',
      GIT_OPTIONAL_LOCKS: '0'
    }
  })

  if (result.error) {
    return { ok: false, error: result.error }
  }
  if (result.status !== 0) {
    return { ok: false, status: result.status, stderr: result.stderr }
  }
  return { ok: true, stdout: result.stdout }
}

export function inspectGitRepository(cwd, options = {}) {
  const gitBin = options.gitBin || options.env?.GIT_BIN_PATH || process.env.GIT_BIN_PATH || 'git'

  // Step 1: Verify work tree and paths
  const revParse = runGit(gitBin, ['rev-parse', '--is-inside-work-tree', '--show-toplevel', '--git-dir', '--git-common-dir'], cwd, options)
  if (!revParse.ok) return null

  const lines = revParse.stdout.split(/\r?\n/u)
  if (lines[0]?.trim() !== 'true') return null

  const topLevel = lines[1]?.trim()
  if (!topLevel) return null

  const gitDir = lines[2]?.trim()
  const gitCommonDir = lines[3]?.trim()

  let isLinked = options.isLinked === true
  let worktreeLabel = options.worktreeLabel || null

  if (!isLinked && gitDir && gitCommonDir) {
    const resGit = resolvePath(cwd, gitDir)
    const resCommon = resolvePath(cwd, gitCommonDir)
    if (!samePath(resGit, resCommon) || gitDir.includes('/worktrees/') || gitDir.includes('\\worktrees\\')) {
      isLinked = true
      worktreeLabel = sanitizeToken(basename(topLevel))
    }
  }

  // Step 2: Determine branch or detached HEAD
  let branch = null
  const symRef = runGit(gitBin, ['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd, options)
  if (symRef.ok && symRef.stdout.trim()) {
    branch = sanitizeToken(symRef.stdout.trim())
  } else {
    const revHead = runGit(gitBin, ['rev-parse', '--short', 'HEAD'], cwd, options)
    if (revHead.ok && revHead.stdout.trim()) {
      const sha = sanitizeToken(revHead.stdout.trim())
      branch = sanitizeToken(`detached@${sha}`)
    }
  }

  if (!branch || branch.length === 0) return null

  // Step 3: Check clean / dirty status
  const statusRes = runGit(gitBin, ['status', '--porcelain=v1', '--untracked-files=all'], cwd, options)
  if (!statusRes.ok) return null

  const gitStatus = statusRes.stdout.trim().length === 0 ? 'clean' : 'dirty'

  return {
    branch,
    gitStatus,
    isLinked,
    worktreeLabel: isLinked ? (worktreeLabel || sanitizeToken(basename(topLevel))) : null
  }
}

function runSubprocess(bin, args, options = {}) {
  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  const remaining = Math.floor(deadline - clock())
  if (remaining <= DELIVERY_HEADROOM_MS) {
    return { ok: false, error: new Error(`invocation deadline exhausted before ${bin} command`) }
  }

  const timeout = Math.min(COMMAND_TIMEOUT_MS, remaining)
  const baseEnv = options.env !== undefined ? options.env : process.env
  const callerPath = baseEnv.PATH || process.env.PATH || ''
  const standardPaths = ['/usr/bin', '/bin', '/usr/sbin', '/sbin']
  const mergedPath = callerPath
    ? `${callerPath}:${standardPaths.filter(p => !callerPath.split(':').includes(p)).join(':')}`
    : standardPaths.join(':')

  const env = {
    ...baseEnv,
    PATH: mergedPath,
    LC_ALL: 'C'
  }

  const result = spawnSync(bin, args, {
    cwd: options.cwd || process.cwd(),
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    killSignal: 'SIGKILL',
    env
  })

  if (result.error) {
    return { ok: false, error: result.error, status: result.status }
  }
  if (result.status !== 0) {
    return { ok: false, status: result.status, stderr: result.stderr, stdout: result.stdout }
  }
  return { ok: true, stdout: result.stdout, status: 0 }
}

function resolveExecutable(bin, searchPaths = []) {
  if (bin && isAbsolute(bin)) return bin
  for (const candidate of searchPaths) {
    try {
      if (existsSync(candidate)) return candidate
    } catch {}
  }
  return bin
}

export function parsePsOutput(output) {
  const pidToPpid = new Map()
  if (!output || typeof output !== 'string') return pidToPpid
  for (const line of output.split(/\r?\n/u)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const parts = trimmed.split(/\s+/u)
    if (parts.length >= 2) {
      const pid = parseInt(parts[0], 10)
      const ppid = parseInt(parts[1], 10)
      if (Number.isSafeInteger(pid) && Number.isSafeInteger(ppid) && pid > 0) {
        pidToPpid.set(pid, ppid)
      }
    }
  }
  return pidToPpid
}

export function parseLsofOutput(output) {
  if (!output || typeof output !== 'string') return new Map()
  const pidToPorts = new Map()
  let currentPid = null
  let currentProto = null
  let currentPort = null
  let currentIsListen = false
  let hasTField = false

  const commitSocket = () => {
    if (currentPid && currentPort) {
      const isTcp = !currentProto || currentProto.toUpperCase() === 'TCP'
      const isListening = hasTField ? currentIsListen : true
      if (isTcp && isListening) {
        if (!pidToPorts.has(currentPid)) {
          pidToPorts.set(currentPid, new Set())
        }
        pidToPorts.get(currentPid).add(currentPort)
      }
    }
    currentPort = null
    currentIsListen = false
    hasTField = false
  }

  const commitProcess = () => {
    commitSocket()
    currentPid = null
    currentProto = null
  }

  for (const line of output.split(/\r?\n/u)) {
    if (!line) continue
    const tag = line[0]
    const val = line.slice(1)

    if (tag === 'p') {
      commitProcess()
      const pid = parseInt(val, 10)
      if (Number.isSafeInteger(pid) && pid > 0) {
        currentPid = pid
      }
    } else if (tag === 'f') {
      commitSocket()
    } else if (tag === 'P') {
      currentProto = val
    } else if (tag === 'T') {
      if (val.startsWith('ST=')) {
        hasTField = true
        currentIsListen = (val.slice(3).toUpperCase() === 'LISTEN')
      }
    } else if (tag === 'n') {
      if (val.includes('->')) {
        currentPort = null
      } else {
        const lastColon = val.lastIndexOf(':')
        if (lastColon !== -1) {
          const port = parseInt(val.slice(lastColon + 1), 10)
          if (Number.isSafeInteger(port) && port >= 1 && port <= 65535) {
            currentPort = port
          } else {
            currentPort = null
          }
        }
      }
    }
  }
  commitProcess()
  return pidToPorts
}

export function attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, options = {}) {
  const kill = options.kill || process.kill
  const portToSpaces = new Map()

  for (const [pid, ports] of pidToPorts) {
    if (!ports || ports.size === 0) continue

    if (typeof kill === 'function') {
      try {
        kill(pid, 0)
      } catch (err) {
        if (err.code === 'ESRCH') {
          continue
        }
      }
    }

    let current = pid
    let ownerWorkspace = null
    const visited = new Set()

    while (current && current > 1 && !visited.has(current)) {
      visited.add(current)
      if (shellPidToWorkspace.has(current)) {
        ownerWorkspace = shellPidToWorkspace.get(current)
        break
      }
      current = pidToPpid.get(current)
    }

    if (ownerWorkspace) {
      for (const port of ports) {
        if (!portToSpaces.has(port)) {
          portToSpaces.set(port, new Set())
        }
        portToSpaces.get(port).add(ownerWorkspace)
      }
    }
  }

  const workspacePorts = new Map()
  for (const [port, spaces] of portToSpaces) {
    if (spaces.size === 1) {
      const wsId = [...spaces][0]
      if (!workspacePorts.has(wsId)) {
        workspacePorts.set(wsId, new Set())
      }
      workspacePorts.get(wsId).add(port)
    }
  }

  const result = new Map()
  for (const [wsId, portSet] of workspacePorts) {
    if (portSet.size > 0) {
      const sorted = [...portSet].sort((a, b) => a - b)
      result.set(wsId, sanitizeToken(`Ports ${sorted.join(' · ')}`))
    }
  }
  return result
}

export function collectWorkspacePorts(env = process.env, snapshot = null, targets = [], options = {}) {
  const platform = options.platform || process.platform
  if (platform !== 'darwin') {
    return new Map()
  }

  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  if (deadline - clock() <= DELIVERY_HEADROOM_MS) {
    throw new Error('invocation deadline exhausted before ports inspection')
  }

  const allPanes = Array.isArray(snapshot?.panes) ? snapshot.panes : []
  const allWorkspaces = Array.isArray(snapshot?.workspaces) ? snapshot.workspaces : targets
  const knownWsIds = new Set(allWorkspaces.filter(ws => ws && validId(ws.workspace_id)).map(ws => ws.workspace_id))
  const relevantPanes = allPanes.filter(pane => pane && validId(pane.pane_id) && validId(pane.workspace_id) && knownWsIds.has(pane.workspace_id))
  if (relevantPanes.length > MAX_WORKSPACES) throw new Error('ports pane inventory exceeds limit')

  if (relevantPanes.length === 0) {
    return new Map()
  }

  const shellPidToWorkspace = new Map()
  const conflictedShellPids = new Set()
  const kill = options.kill || process.kill

  for (const pane of relevantPanes) {
    if (deadline - clock() <= DELIVERY_HEADROOM_MS) {
      throw new Error('invocation deadline exhausted during pane process inspection')
    }

    let shellPid = null
    if (Number.isSafeInteger(pane.shell_pid) && pane.shell_pid > 1) {
      shellPid = pane.shell_pid
    } else if (options.paneShellPids && options.paneShellPids.has(pane.pane_id)) {
      shellPid = options.paneShellPids.get(pane.pane_id)
    } else if (options.getPaneProcessInfo) {
      const info = options.getPaneProcessInfo(pane.pane_id)
      if (Number.isSafeInteger(info?.shell_pid) && info.shell_pid > 1) {
        shellPid = info.shell_pid
      }
    } else {
      try {
        const output = runHerdr(env, ['pane', 'process-info', '--pane', pane.pane_id], { clock, deadline })
        const parsed = JSON.parse(output)
        const info = parsed?.result?.process_info || parsed?.process_info
        if (Number.isSafeInteger(info?.shell_pid) && info.shell_pid > 1) {
          shellPid = info.shell_pid
        }
      } catch (err) {
        if (err.message?.includes('deadline exhausted')) throw err
        shellPid = null
      }
    }

    if (shellPid) {
      if (typeof kill === 'function') {
        try {
          kill(shellPid, 0)
        } catch (err) {
          if (err.code === 'ESRCH') {
            continue
          }
        }
      }

      if (shellPidToWorkspace.has(shellPid)) {
        if (shellPidToWorkspace.get(shellPid) !== pane.workspace_id) {
          conflictedShellPids.add(shellPid)
        }
      } else {
        shellPidToWorkspace.set(shellPid, pane.workspace_id)
      }
    }
  }

  for (const pid of conflictedShellPids) {
    // Keep an ambiguity barrier: never walk past this root to another Space.
    shellPidToWorkspace.set(pid, null)
  }

  if (shellPidToWorkspace.size === 0) {
    return new Map()
  }

  let psOutput = options.psOutput
  if (psOutput === undefined) {
    const psBin = options.psBin || env.PS_BIN_PATH || '/bin/ps'
    const psRes = runSubprocess(psBin, ['-A', '-o', 'pid=,ppid='], { clock, deadline, env })
    if (!psRes.ok) {
      return new Map()
    }
    psOutput = psRes.stdout
  }

  const pidToPpid = parsePsOutput(psOutput)

  let lsofOutput = options.lsofOutput
  if (lsofOutput === undefined) {
    const lsofBin = options.lsofBin || env.LSOF_BIN_PATH || '/usr/sbin/lsof'
    const lsofRes = runSubprocess(lsofBin, ['-n', '-P', '-iTCP', '-sTCP:LISTEN', '-F', 'pPnT'], { clock, deadline, env })
    if (!lsofRes.ok) {
      if (lsofRes.status === 1 && (!lsofRes.stdout || lsofRes.stdout.trim().length === 0)) {
        return new Map()
      }
      return new Map()
    }
    lsofOutput = lsofRes.stdout
  }

  const pidToPorts = parseLsofOutput(lsofOutput)

  return attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, options)
}

export function workspaceMetadataArgs(workspaceId, metadata, sequence, now, ttlMs) {
  const tokens = metadata
    ? {
        ...(metadata.branch ? { mahiro_workspace_branch: metadata.branch } : {}),
        ...(metadata.gitStatus ? { mahiro_workspace_git_status: metadata.gitStatus } : {}),
        ...(metadata.isLinked && metadata.worktreeLabel ? { mahiro_workspace_worktree: metadata.worktreeLabel } : {}),
        ...(metadata.ports ? { mahiro_workspace_ports: metadata.ports } : {})
      }
    : {}

  const args = ['workspace', 'report-metadata', workspaceId, '--source', WORKSPACE_SOURCE]
  for (const name of OWNED_WORKSPACE_TOKENS) {
    if (Object.hasOwn(tokens, name)) {
      args.push('--token', `${name}=${sanitizeToken(tokens[name])}`)
    } else {
      args.push('--clear-token', name)
    }
  }

  args.push('--seq', sequence)
  if (Object.keys(tokens).length > 0 && ttlMs > 0) {
    args.push('--ttl-ms', String(Math.floor(ttlMs)))
  }
  return args
}

export function parseSnapshotWorkspaces(snapshotOutput) {
  let parsed
  try {
    parsed = JSON.parse(snapshotOutput)
  } catch {
    throw new Error('unexpected Herdr api snapshot response')
  }

  const snapshot = parsed?.result?.snapshot?.workspaces
    ? parsed.result.snapshot
    : (parsed?.result?.workspaces
        ? parsed.result
        : (parsed?.snapshot?.workspaces
            ? parsed.snapshot
            : (parsed?.workspaces ? parsed : null)))

  if (!snapshot || !Array.isArray(snapshot.workspaces)) {
    throw new Error('unexpected Herdr api snapshot response')
  }
  return snapshot
}

export function observeSnapshot(env, options = {}) {
  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  const output = runHerdr(env, ['api', 'snapshot'], { clock, deadline })
  return parseSnapshotWorkspaces(output)
}

export function validateEventSnapshot(snapshot, paneId, workspaceId) {
  if (!snapshot || !validId(paneId) || !validId(workspaceId)) return false
  if (!Array.isArray(snapshot.panes) || !Array.isArray(snapshot.workspaces)) return false
  const panes = snapshot.panes.filter(item => item && item.pane_id === paneId)
  const workspaces = snapshot.workspaces.filter(item => item && item.workspace_id === workspaceId)
  return panes.length === 1 && panes[0].workspace_id === workspaceId && workspaces.length === 1
}

export async function reconcileWorkspaces(env = process.env, options = {}) {
  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  const sequence = String((options.sequence || observeSequence)())
  const numericSequence = BigInt(sequence)
  if (numericSequence < 0n || numericSequence > MAX_U64) {
    throw new Error('sequence is outside Herdr u64 range')
  }

  const snapshot = options.snapshot || observeSnapshot(env, { clock, deadline })

  const validWorkspaces = snapshot.workspaces.filter(ws => ws && validId(ws.workspace_id))
  const targets = options.targetWorkspaceId
    ? validWorkspaces.filter(ws => ws.workspace_id === options.targetWorkspaceId).slice(0, 1)
    : dedupeWorkspaces(validWorkspaces)

  if (targets.length === 0) return { reports: 0, sequence }

  let workspacePorts = new Map()
  if (!options.clearOnly) {
    try {
      const portsDeadline = Math.min(deadline - DELIVERY_HEADROOM_MS, clock() + PORTS_BUDGET_MS)
      workspacePorts = collectWorkspacePorts(env, snapshot, targets, { ...options, clock, deadline: portsDeadline })
    } catch {
      workspacePorts = new Map()
    }
  }

  let reports = 0
  for (const workspace of targets) {
    const now = clock()
    if (deadline - now <= DELIVERY_HEADROOM_MS) {
      throw new Error(`invocation deadline exhausted after ${reports}/${targets.length} workspace reports`)
    }

    let metadata = null
    if (!options.clearOnly) {
      let git = null
      try {
        const repoInfo = determineWorkspaceRepository(workspace, snapshot)
        if (repoInfo?.cwd) {
          git = inspectGitRepository(repoInfo.cwd, {
            ...options,
            deadline,
            clock,
            isLinked: repoInfo.isLinked,
            worktreeLabel: repoInfo.worktreeLabel
          })
        }
      } catch (error) {
        if (error.message?.includes('deadline exhausted')) throw error
        git = null
      }

      const ports = workspacePorts.get(workspace.workspace_id) || null
      if (git || ports) {
        metadata = {
          ...(git || {}),
          ports
        }
      }
    }

    const ttlMs = WORKSPACE_TTL_MS - DELIVERY_HEADROOM_MS
    const args = workspaceMetadataArgs(workspace.workspace_id, metadata, sequence, now, ttlMs)
    runHerdr(env, args, { clock, deadline })
    reports += 1
  }

  return { reports, sequence }
}

export async function clearWorkspaceMetadata(env = process.env, options = {}) {
  return reconcileWorkspaces(env, { ...options, clearOnly: true })
}
