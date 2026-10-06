import { spawnSync } from 'node:child_process'
import { isAbsolute, resolve as resolvePath, basename } from 'node:path'

import {
  COMMAND_TIMEOUT_MS,
  INVOCATION_DEADLINE_MS,
  MAX_OUTPUT_BYTES,
  MAX_U64,
  observeSequence,
  runHerdr,
  sanitizeToken
} from './runtime-helpers.mjs'

export const WORKSPACE_SOURCE = 'mahiro-herdr.workspace'
export const OWNED_WORKSPACE_TOKENS = [
  'mahiro_workspace_branch',
  'mahiro_workspace_git_status',
  'mahiro_workspace_worktree'
]
export const MAX_WORKSPACES = 128
export const WORKSPACE_TTL_MS = 5 * 60 * 1000

const DELIVERY_HEADROOM_MS = 1000
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
  const result = spawnSync(gitBin, args, {
    cwd,
    encoding: 'utf8',
    timeout,
    maxBuffer: MAX_OUTPUT_BYTES,
    killSignal: 'SIGKILL',
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
    if (resGit !== resCommon || gitDir.includes('/worktrees/') || gitDir.includes('\\worktrees\\')) {
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

export function workspaceMetadataArgs(workspaceId, metadata, sequence, now, ttlMs) {
  const tokens = metadata
    ? {
        mahiro_workspace_branch: metadata.branch,
        mahiro_workspace_git_status: metadata.gitStatus,
        ...(metadata.isLinked && metadata.worktreeLabel ? { mahiro_workspace_worktree: metadata.worktreeLabel } : {})
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

  let reports = 0
  for (const workspace of targets) {
    const now = clock()
    if (deadline - now <= DELIVERY_HEADROOM_MS) {
      throw new Error(`invocation deadline exhausted after ${reports}/${targets.length} workspace reports`)
    }

    let metadata = null
    if (!options.clearOnly) {
      try {
        const repoInfo = determineWorkspaceRepository(workspace, snapshot)
        if (repoInfo?.cwd) {
          metadata = inspectGitRepository(repoInfo.cwd, {
            ...options,
            deadline,
            clock,
            isLinked: repoInfo.isLinked,
            worktreeLabel: repoInfo.worktreeLabel
          })
        }
      } catch (error) {
        if (error.message?.includes('deadline exhausted')) throw error
        metadata = null
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
