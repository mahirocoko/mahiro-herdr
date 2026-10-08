import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { writeNodeStub } from './stub-executable.mjs'

import {
  MAX_WORKSPACES,
  OWNED_WORKSPACE_TOKENS,
  WORKSPACE_SOURCE,
  WORKSPACE_TTL_MS,
  attributePortsToWorkspaces,
  clearWorkspaceMetadata,
  collectWorkspacePorts,
  dedupeWorkspaces,
  determineWorkspaceRepository,
  inspectGitRepository,
  parseLsofOutput,
  parsePsOutput,
  parseSnapshotWorkspaces,
  reconcileWorkspaces,
  workspaceMetadataArgs
} from '../src/workspace-metadata.mjs'
import { clearOwnedMetadata, eventRefresh, refresh } from '../src/core.mjs'

const roots = []

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'mahiro-ws-test-'))
  roots.push(root)
  const home = join(root, 'home')
  const pluginConfig = join(root, 'plugin-config')
  const herdrConfig = join(root, 'herdr', 'config.toml')
  const cache = join(home, '.letta', 'mods', 'mahiro-usage')
  await Promise.all([
    mkdir(pluginConfig, { recursive: true }),
    mkdir(join(root, 'herdr'), { recursive: true }),
    mkdir(cache, { recursive: true })
  ])
  return {
    root,
    home,
    pluginConfig,
    herdrConfig,
    cache,
    env: {
      ...process.env,
      HOME: home,
      HERDR_PLUGIN_CONFIG_DIR: pluginConfig,
      HERDR_CONFIG_PATH: herdrConfig
    }
  }
}

test.after(async () => {
  await Promise.all(roots.map(root => rm(root, { recursive: true, force: true })))
})

async function initGitRepo(dir, options = {}) {
  await mkdir(dir, { recursive: true })
  spawnSync('git', ['init', '-b', options.branch || 'main'], { cwd: dir, encoding: 'utf8' })
  spawnSync('git', ['config', 'user.name', 'Test User'], { cwd: dir, encoding: 'utf8' })
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir, encoding: 'utf8' })
  await writeFile(join(dir, 'README.md'), '# Initial Commit\n')
  spawnSync('git', ['add', '.'], { cwd: dir, encoding: 'utf8' })
  spawnSync('git', ['commit', '-m', 'Initial commit'], { cwd: dir, encoding: 'utf8' })
}

async function stubHerdrWithSnapshot(setup, snapshotData, agents = []) {
  const executable = join(setup.root, 'herdr-stub.mjs')
  const log = join(setup.root, 'herdr.log')
  const inventory = join(setup.root, 'inventory.json')
  const snapshotFile = join(setup.root, 'snapshot.json')
  const registry = join(setup.root, 'registry.json')
  const failures = join(setup.root, 'failures.json')

  await writeFile(inventory, JSON.stringify({ id: 'cli:agent:list', result: { agents } }))
  await writeFile(snapshotFile, JSON.stringify({ result: { snapshot: snapshotData } }))
  await writeFile(registry, JSON.stringify({ plugins: [] }))
  await writeFile(failures, JSON.stringify([]))

  const herdrBin = await writeNodeStub(executable, `#!/usr/bin/env node
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const command = args.join(' ')
appendFileSync(process.env.HERDR_TEST_LOG, JSON.stringify(args) + '\\n')
const failures = JSON.parse(readFileSync(process.env.HERDR_TEST_FAILURES, 'utf8'))
const failure = failures.find(item => item.remaining > 0 && command.includes(item.needle))
if (failure) {
  failure.remaining -= 1
  writeFileSync(process.env.HERDR_TEST_FAILURES, JSON.stringify(failures))
  process.stderr.write('injected failure')
  process.exit(1)
}
if (args[0] === 'agent' && args[1] === 'list') {
  process.stdout.write(readFileSync(process.env.HERDR_TEST_INVENTORY, 'utf8'))
} else if (args[0] === 'api' && args[1] === 'snapshot') {
  process.stdout.write(readFileSync(process.env.HERDR_TEST_SNAPSHOT, 'utf8'))
} else if (args[0] === 'workspace' && args[1] === 'report-metadata') {
  // Accepted
} else if (args[0] === 'pane' && args[1] === 'report-metadata') {
  // Accepted
} else if (args[0] === 'pane' && args[1] === 'process-info') {
  process.stdout.write(JSON.stringify({ result: { process_info: { shell_pid: 12345 } } }))
} else if (args[0] === 'plugin' && args[1] === 'list') {
  process.stdout.write(readFileSync(process.env.HERDR_TEST_REGISTRY, 'utf8'))
}
`)

  return {
    log,
    inventory,
    snapshotFile,
    failures,
    env: {
      ...setup.env,
      HERDR_BIN_PATH: herdrBin,
      HERDR_TEST_LOG: log,
      HERDR_TEST_INVENTORY: inventory,
      HERDR_TEST_SNAPSHOT: snapshotFile,
      HERDR_TEST_REGISTRY: registry,
      HERDR_TEST_FAILURES: failures
    }
  }
}

async function readCalls(path) {
  try {
    const text = await readFile(path, 'utf8')
    return text.trim().split('\n').filter(Boolean).map(JSON.parse)
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
}

function workspaceReportCalls(entries) {
  return entries.filter(call => call[0] === 'workspace' && call[1] === 'report-metadata')
}

// -------------------------------------------------------------
// 1. Deterministic CWD Selection Tests
// -------------------------------------------------------------

test('deterministic cwd: linked worktree checkout_path takes precedence over pane cwd', async () => {
  const setup = await fixture()
  const linkedPath = join(setup.root, 'linked-wt')
  const panePath = join(setup.root, 'pane-dir')
  await mkdir(linkedPath, { recursive: true })
  await mkdir(panePath, { recursive: true })

  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: {
      checkout_path: linkedPath,
      is_linked_worktree: true,
      repo_name: 'test-repo',
      repo_key: 'test',
      repo_root: setup.root
    }
  }

  const snapshot = {
    layouts: [
      { workspace_id: 'w1', tab_id: 't1', focused_pane_id: 'p1' }
    ],
    panes: [
      { pane_id: 'p1', workspace_id: 'w1', tab_id: 't1', cwd: panePath, foreground_cwd: panePath }
    ]
  }

  const repoInfo = determineWorkspaceRepository(workspace, snapshot)
  assert.ok(repoInfo)
  assert.equal(repoInfo.cwd, linkedPath)
  assert.equal(repoInfo.isLinked, true)
  assert.equal(repoInfo.worktreeLabel, basename(linkedPath))
  assert.equal(repoInfo.worktreeLabel.includes('/'), false)
})

test('deterministic cwd: active tab layout focused pane foreground_cwd is used when not linked', async () => {
  const setup = await fixture()
  const paneCwd = join(setup.root, 'my-repo')
  await mkdir(paneCwd, { recursive: true })

  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: null
  }

  const snapshot = {
    layouts: [
      { workspace_id: 'w1', tab_id: 't1', focused_pane_id: 'p1' }
    ],
    panes: [
      { pane_id: 'p1', workspace_id: 'w1', tab_id: 't1', cwd: '/some/old/path', foreground_cwd: paneCwd },
      { pane_id: 'p2', workspace_id: 'w1', tab_id: 't1', cwd: '/other/path', foreground_cwd: null }
    ]
  }

  const repoInfo = determineWorkspaceRepository(workspace, snapshot)
  assert.ok(repoInfo)
  assert.equal(repoInfo.cwd, paneCwd)
  assert.equal(repoInfo.isLinked, false)
})

test('deterministic cwd: fallback to non-linked workspace worktree checkout_path when layout focused pane is missing', async () => {
  const setup = await fixture()
  const mainCheckout = join(setup.root, 'main-checkout')
  await mkdir(mainCheckout, { recursive: true })

  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: {
      checkout_path: mainCheckout,
      is_linked_worktree: false,
      repo_name: 'main-repo',
      repo_key: 'main',
      repo_root: mainCheckout
    }
  }

  const snapshot = {
    layouts: [],
    panes: []
  }

  const repoInfo = determineWorkspaceRepository(workspace, snapshot)
  assert.ok(repoInfo)
  assert.equal(repoInfo.cwd, mainCheckout)
  assert.equal(repoInfo.isLinked, false)
})

test('deterministic cwd: fallback to identical panes in active tab when focused pane is missing', async () => {
  const setup = await fixture()
  const sharedPath = join(setup.root, 'shared-tab-dir')
  await mkdir(sharedPath, { recursive: true })

  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: null
  }

  const snapshot = {
    layouts: [],
    panes: [
      { pane_id: 'p1', workspace_id: 'w1', tab_id: 't1', cwd: sharedPath },
      { pane_id: 'p2', workspace_id: 'w1', tab_id: 't1', foreground_cwd: sharedPath }
    ]
  }

  const repoInfo = determineWorkspaceRepository(workspace, snapshot)
  assert.ok(repoInfo)
  assert.equal(repoInfo.cwd, sharedPath)
})

test('deterministic cwd: ambiguous conflicting cwds in active tab without focused pane returns null', () => {
  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: null
  }

  const snapshot = {
    layouts: [],
    panes: [
      { pane_id: 'p1', workspace_id: 'w1', tab_id: 't1', cwd: '/dir/one' },
      { pane_id: 'p2', workspace_id: 'w1', tab_id: 't1', cwd: '/dir/two' }
    ]
  }

  const repoInfo = determineWorkspaceRepository(workspace, snapshot)
  assert.equal(repoInfo, null)
})

test('deterministic cwd: non-absolute, empty, or null cwds fail closed', () => {
  const workspace = {
    workspace_id: 'w1',
    active_tab_id: 't1',
    worktree: { checkout_path: 'relative/path', is_linked_worktree: true }
  }
  assert.equal(determineWorkspaceRepository(workspace, {}), null)

  const ws2 = {
    workspace_id: 'w2',
    active_tab_id: 't1',
    worktree: null
  }
  const snapshot = {
    layouts: [{ workspace_id: 'w2', tab_id: 't1', focused_pane_id: 'p1' }],
    panes: [{ pane_id: 'p1', workspace_id: 'w2', tab_id: 't1', cwd: '' }]
  }
  assert.equal(determineWorkspaceRepository(ws2, snapshot), null)
})

// -------------------------------------------------------------
// 2. Git State Tests: Clean, Dirty, Detached, Non-Git
// -------------------------------------------------------------

test('git inspection: clean repository on branch', async () => {
  const setup = await fixture()
  const repoDir = join(setup.root, 'clean-repo')
  await initGitRepo(repoDir, { branch: 'feat/test-branch' })

  const meta = inspectGitRepository(repoDir)
  assert.ok(meta)
  assert.equal(meta.branch, 'feat/test-branch')
  assert.equal(meta.gitStatus, 'clean')
  assert.equal(meta.isLinked, false)
  assert.equal(meta.worktreeLabel, null)
})

test('git inspection: dirty repository with uncommitted changes', async () => {
  const setup = await fixture()
  const repoDir = join(setup.root, 'dirty-repo')
  await initGitRepo(repoDir, { branch: 'main' })

  await writeFile(join(repoDir, 'dirty.txt'), 'uncommitted changes\n')

  const meta = inspectGitRepository(repoDir)
  assert.ok(meta)
  assert.equal(meta.branch, 'main')
  assert.equal(meta.gitStatus, 'dirty')
})

test('git inspection: detached HEAD state returns detached@<short sha>', async () => {
  const setup = await fixture()
  const repoDir = join(setup.root, 'detached-repo')
  await initGitRepo(repoDir, { branch: 'main' })

  const shaRes = spawnSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: repoDir, encoding: 'utf8' })
  const shortSha = shaRes.stdout.trim()

  spawnSync('git', ['checkout', '--detach'], { cwd: repoDir, encoding: 'utf8' })

  const meta = inspectGitRepository(repoDir)
  assert.ok(meta)
  assert.equal(meta.branch, `detached@${shortSha}`)
  assert.equal(meta.gitStatus, 'clean')
})

test('git inspection: non-git directory returns null', async () => {
  const setup = await fixture()
  const nonGitDir = join(setup.root, 'not-a-git-repo')
  await mkdir(nonGitDir, { recursive: true })

  const meta = inspectGitRepository(nonGitDir)
  assert.equal(meta, null)
})

test('git inspection: linked worktree detection and label without leaking absolute path', async () => {
  const setup = await fixture()
  const mainRepo = join(setup.root, 'main-repo')
  const worktreeDir = join(setup.root, 'worktree-feature-x')
  await initGitRepo(mainRepo, { branch: 'main' })

  spawnSync('git', ['worktree', 'add', worktreeDir, '-b', 'feature-x'], { cwd: mainRepo, encoding: 'utf8' })

  const meta = inspectGitRepository(worktreeDir)
  assert.ok(meta)
  assert.equal(meta.branch, 'feature-x')
  assert.equal(meta.isLinked, true)
  assert.equal(meta.worktreeLabel, 'worktree-feature-x')
  assert.equal(meta.worktreeLabel.includes('/'), false)
  assert.equal(meta.worktreeLabel.includes('\\'), false)
})

// -------------------------------------------------------------
// 3. Unsafe / Oversized Output Safety Tests
// -------------------------------------------------------------

test('unsafe/oversized: git command exceeding buffer limit fails closed to all-clear', async () => {
  const setup = await fixture()
  const fakeGit = await writeNodeStub(join(setup.root, 'fake-git.mjs'), `const args = process.argv.slice(2)
const command = args[0]
if (command === 'rev-parse') {
  process.stdout.write('true\\n/tmp/fake-repo\\n.git\\n.git\\n')
  process.exit(0)
}
if (command === 'symbolic-ref') {
  process.stdout.write('main\\n')
  process.exit(0)
}
if (command === 'status') {
  const line = 'M overly_long_file_path_for_buffer_overflow_test_abcdefghijklmnopqrstuvwxyz\\n'
  let written = 0
  while (written < 300 * 1024) {
    process.stdout.write(line)
    written += line.length
  }
  process.exit(0)
}
process.exit(1)
`)

  const meta = inspectGitRepository(setup.root, { gitBin: fakeGit })
  assert.equal(meta, null)
})

test('sanitization: control characters and whitespace in branch name are stripped', () => {
  const args = workspaceMetadataArgs('w1', {
    branch: 'feat\u0000ure/\u001fbad\nbranch\tname  ',
    gitStatus: 'clean',
    isLinked: false,
    worktreeLabel: null
  }, '100', Date.now(), 60000)

  const branchToken = args.find(a => String(a).startsWith('mahiro_workspace_branch='))
  assert.ok(branchToken)
  assert.equal(branchToken.includes('\n'), false)
  assert.equal(branchToken.includes('\u0000'), false)
  assert.equal(branchToken.includes('\u001f'), false)
  assert.match(branchToken, /mahiro_workspace_branch=feat ure\/ bad branch name/)
})

// -------------------------------------------------------------
// 4. All-Token Set-or-Clear Invariant Tests
// -------------------------------------------------------------

test('all-token set-or-clear: every report contains exactly one decision per owned token', () => {
  // Case A: Linked worktree (all 4 set)
  const argsLinked = workspaceMetadataArgs('w1', {
    branch: 'main',
    gitStatus: 'clean',
    isLinked: true,
    worktreeLabel: 'my-wt',
    ports: 'Ports 5173'
  }, '1', Date.now(), 60000)

  assert.equal(argsLinked[0], 'workspace')
  assert.equal(argsLinked[1], 'report-metadata')
  assert.equal(argsLinked[2], 'w1')
  assert.equal(argsLinked[3], '--source')
  assert.equal(argsLinked[4], WORKSPACE_SOURCE)

  for (const name of OWNED_WORKSPACE_TOKENS) {
    const sets = argsLinked.filter((val, idx) => argsLinked[idx - 1] === '--token' && String(val).startsWith(`${name}=`)).length
    const clears = argsLinked.filter((val, idx) => argsLinked[idx - 1] === '--clear-token' && val === name).length
    assert.equal(sets + clears, 1, `Token ${name} must have exactly 1 decision in linked state`)
    assert.equal(sets, 1, `Token ${name} should be set in linked state`)
  }

  // Case B: Non-linked repo (branch + status set, worktree + ports cleared)
  const argsStandard = workspaceMetadataArgs('w1', {
    branch: 'main',
    gitStatus: 'dirty',
    isLinked: false,
    worktreeLabel: null
  }, '1', Date.now(), 60000)

  for (const name of OWNED_WORKSPACE_TOKENS) {
    const sets = argsStandard.filter((val, idx) => argsStandard[idx - 1] === '--token' && String(val).startsWith(`${name}=`)).length
    const clears = argsStandard.filter((val, idx) => argsStandard[idx - 1] === '--clear-token' && val === name).length
    assert.equal(sets + clears, 1, `Token ${name} must have exactly 1 decision in standard state`)
    if (name === 'mahiro_workspace_worktree' || name === 'mahiro_workspace_ports') {
      assert.equal(clears, 1, `${name} should be cleared in non-linked repo when not provided`)
    } else {
      assert.equal(sets, 1, `${name} should be set in standard repo`)
    }
  }

  // Case C: Null metadata / non-git (all 3 cleared)
  const argsUnavailable = workspaceMetadataArgs('w1', null, '1', Date.now(), 0)
  for (const name of OWNED_WORKSPACE_TOKENS) {
    const sets = argsUnavailable.filter((val, idx) => argsUnavailable[idx - 1] === '--token' && String(val).startsWith(`${name}=`)).length
    const clears = argsUnavailable.filter((val, idx) => argsUnavailable[idx - 1] === '--clear-token' && val === name).length
    assert.equal(sets + clears, 1, `Token ${name} must have exactly 1 decision in unavailable state`)
    assert.equal(clears, 1, `Token ${name} must be cleared in unavailable state`)
  }
  assert.equal(argsUnavailable.includes('--ttl-ms'), false, 'cleared metadata must not include ttl-ms')
})

// -------------------------------------------------------------
// 5. Full Reconcile & Exact Event Workspace Scoping Tests
// -------------------------------------------------------------

test('full refresh reconciles all bounded workspaces with one sequence and bounded TTL', async () => {
  const setup = await fixture()
  const repo1 = join(setup.root, 'repo1')
  const repo2 = join(setup.root, 'repo2')
  await initGitRepo(repo1, { branch: 'branch-one' })
  await initGitRepo(repo2, { branch: 'branch-two' })

  const snapshot = {
    workspaces: [
      { workspace_id: 'w1', active_tab_id: 't1', worktree: { checkout_path: repo1, is_linked_worktree: false } },
      { workspace_id: 'w2', active_tab_id: 't2', worktree: { checkout_path: repo2, is_linked_worktree: true } }
    ],
    layouts: [],
    panes: []
  }

  const stub = await stubHerdrWithSnapshot(setup, snapshot)
  const now = 1789400000000
  const result = await reconcileWorkspaces(stub.env, { clock: () => now, sequence: () => '1001' })

  assert.equal(result.reports, 2)
  assert.equal(result.sequence, '1001')

  const calls = await readCalls(stub.log)
  const wsReports = workspaceReportCalls(calls)
  assert.equal(wsReports.length, 2)

  // Verify workspace 1 report
  const r1 = wsReports.find(c => c[2] === 'w1')
  assert.ok(r1)
  assert.ok(r1.includes('mahiro_workspace_branch=branch-one'))
  assert.ok(r1.includes('mahiro_workspace_git_status=clean'))
  assert.ok(r1.includes('mahiro_workspace_worktree')) // cleared
  assert.ok(r1.includes('--seq'))
  assert.equal(r1[r1.indexOf('--seq') + 1], '1001')
  assert.ok(r1.includes('--ttl-ms'))
  assert.equal(r1[r1.indexOf('--ttl-ms') + 1], String(WORKSPACE_TTL_MS - 1000))

  // Verify workspace 2 report (linked)
  const r2 = wsReports.find(c => c[2] === 'w2')
  assert.ok(r2)
  assert.ok(r2.includes('mahiro_workspace_branch=branch-two'))
  assert.ok(r2.includes('mahiro_workspace_worktree=repo2'))
})

test('eventRefresh reconciles exact pane quota and additionally only that event exact workspace', async () => {
  const setup = await fixture()
  const repo1 = join(setup.root, 'repo-event-1')
  const repo2 = join(setup.root, 'repo-event-2')
  await initGitRepo(repo1, { branch: 'event-b1' })
  await initGitRepo(repo2, { branch: 'event-b2' })

  const snapshot = {
    workspaces: [
      { workspace_id: 'w1', active_tab_id: 't1', worktree: { checkout_path: repo1, is_linked_worktree: false } },
      { workspace_id: 'w2', active_tab_id: 't2', worktree: { checkout_path: repo2, is_linked_worktree: false } }
    ],
    layouts: [],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', foreground_cwd: repo1 },
      { pane_id: 'w2:p1', workspace_id: 'w2', foreground_cwd: repo2 }
    ]
  }

  const agents = [
    { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} },
    { pane_id: 'w2:p1', workspace_id: 'w2', agent: 'other', tokens: {} }
  ]

  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  const event = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w2:p1', workspace_id: 'w2' }
  })

  const now = 1789400000000
  await eventRefresh(stub.env, { rawEvent: event, clock: () => now, sequence: () => '2001' })

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  const wsReports = workspaceReportCalls(calls)

  // Exact pane w2:p1 reconciled
  assert.equal(paneReports.length, 1)
  assert.equal(paneReports[0][2], 'w2:p1')

  // Exact workspace w2 reconciled (w1 ignored)
  assert.equal(wsReports.length, 1)
  assert.equal(wsReports[0][2], 'w2')
  assert.ok(wsReports[0].includes('mahiro_workspace_branch=event-b2'))
})

test('eventRefresh cross-validates event pane and workspace identity: mismatched pair yields 0 reports', async () => {
  const setup = await fixture()
  const snapshot = {
    workspaces: [
      { workspace_id: 'w1', active_tab_id: 't1' },
      { workspace_id: 'w2', active_tab_id: 't2' }
    ],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1' },
      { pane_id: 'w2:p1', workspace_id: 'w2' }
    ]
  }
  const agents = [
    { pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} },
    { pane_id: 'w2:p1', workspace_id: 'w2', agent: 'other', tokens: {} }
  ]

  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  // Syntactically valid pair, but mismatched in snapshot: pane w1:p1 belongs to workspace w1, NOT w2
  const mismatchedEvent = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w1:p1', workspace_id: 'w2' }
  })

  const now = 1789400000000
  const result = await eventRefresh(stub.env, { rawEvent: mismatchedEvent, clock: () => now, sequence: () => '2002' })

  // Cross-validation before either report: zero pane and zero workspace reports!
  assert.equal(result.reports, 0)
  assert.equal(result.workspaceReports, 0)

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  const wsReports = workspaceReportCalls(calls)
  const snapshotCalls = calls.filter(c => c[0] === 'api' && c[1] === 'snapshot')

  assert.equal(paneReports.length, 0)
  assert.equal(wsReports.length, 0)
  assert.equal(snapshotCalls.length, 1)
})

test('eventRefresh rejects ambiguous duplicate pane or workspace identities before reporting', async () => {
  const setup = await fixture()
  const event = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w1:p1', workspace_id: 'w1' }
  })
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]

  for (const snapshot of [
    {
      workspaces: [{ workspace_id: 'w1' }],
      panes: [
        { pane_id: 'w1:p1', workspace_id: 'w1' },
        { pane_id: 'w1:p1', workspace_id: 'w1' }
      ]
    },
    {
      workspaces: [{ workspace_id: 'w1' }, { workspace_id: 'w1' }],
      panes: [{ pane_id: 'w1:p1', workspace_id: 'w1' }]
    }
  ]) {
    const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
    const result = await eventRefresh(stub.env, {
      rawEvent: event,
      clock: () => 1789400000000,
      sequence: () => '2002'
    })

    assert.equal(result.reports, 0)
    assert.equal(result.workspaceReports, 0)
    const calls = await readCalls(stub.log)
    assert.equal(calls.filter(call => call[0] === 'pane' && call[1] === 'report-metadata').length, 0)
    assert.equal(workspaceReportCalls(calls).length, 0)
  }
})

test('eventRefresh fails closed before reporting when authoritative snapshot is unavailable', async () => {
  const setup = await fixture()
  const snapshot = {
    workspaces: [{ workspace_id: 'w1' }],
    panes: [{ pane_id: 'w1:p1', workspace_id: 'w1' }]
  }
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]
  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  await writeFile(stub.failures, JSON.stringify([
    { needle: 'api snapshot', remaining: 1 }
  ]))
  const warnings = []
  const result = await eventRefresh(stub.env, {
    rawEvent: JSON.stringify({
      event: 'pane_focused',
      data: { type: 'pane_focused', pane_id: 'w1:p1', workspace_id: 'w1' }
    }),
    clock: () => 1789400000000,
    sequence: () => '2002',
    warn: message => warnings.push(message)
  })

  assert.equal(result.reports, 0)
  assert.equal(result.workspaceReports, 0)
  assert.equal(warnings.length, 1)
  const calls = await readCalls(stub.log)
  assert.equal(calls.filter(call => call[0] === 'pane' && call[1] === 'report-metadata').length, 0)
  assert.equal(workspaceReportCalls(calls).length, 0)
})

test('eventRefresh: valid idle shell pane refreshes workspace Git metadata while pane quota reports remain zero', async () => {
  const setup = await fixture()
  const repo = join(setup.root, 'repo-shell')
  await initGitRepo(repo, { branch: 'shell-branch' })

  const snapshot = {
    workspaces: [
      {
        workspace_id: 'w1',
        active_tab_id: 't1',
        worktree: { is_linked_worktree: true, checkout_path: repo }
      }
    ],
    panes: [
      { pane_id: 'w1:shell', workspace_id: 'w1', foreground_cwd: repo }
    ]
  }
  // Idle shell pane is not in agent list!
  const agents = []

  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  const shellEvent = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w1:shell', workspace_id: 'w1' }
  })

  const now = 1789400000000
  const result = await eventRefresh(stub.env, { rawEvent: shellEvent, clock: () => now, sequence: () => '2003' })

  // Workspace report produced even though pane quota reports remain zero!
  assert.equal(result.reports, 0)
  assert.equal(result.workspaceReports, 1)

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  const wsReports = workspaceReportCalls(calls)
  const snapshotCalls = calls.filter(c => c[0] === 'api' && c[1] === 'snapshot')

  assert.equal(paneReports.length, 0)
  assert.equal(wsReports.length, 1)
  assert.equal(wsReports[0][2], 'w1')
  assert.ok(wsReports[0].includes('mahiro_workspace_branch=shell-branch'))
  assert.equal(snapshotCalls.length, 1)
})

test('eventRefresh: valid agent event produces both pane and workspace reports', async () => {
  const setup = await fixture()
  const repo = join(setup.root, 'repo-agent')
  await initGitRepo(repo, { branch: 'agent-branch' })

  const snapshot = {
    workspaces: [
      {
        workspace_id: 'w1',
        active_tab_id: 't1',
        worktree: { is_linked_worktree: true, checkout_path: repo }
      }
    ],
    panes: [
      { pane_id: 'w1:agent', workspace_id: 'w1', foreground_cwd: repo }
    ]
  }
  const agents = [
    { pane_id: 'w1:agent', workspace_id: 'w1', agent: 'other', tokens: {} }
  ]

  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  const agentEvent = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w1:agent', workspace_id: 'w1' }
  })

  const now = 1789400000000
  const result = await eventRefresh(stub.env, { rawEvent: agentEvent, clock: () => now, sequence: () => '2004' })

  // Both pane and workspace reports produced!
  assert.equal(result.reports, 1)
  assert.equal(result.workspaceReports, 1)

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  const wsReports = workspaceReportCalls(calls)
  const snapshotCalls = calls.filter(c => c[0] === 'api' && c[1] === 'snapshot')

  assert.equal(paneReports.length, 1)
  assert.equal(paneReports[0][2], 'w1:agent')
  assert.equal(wsReports.length, 1)
  assert.equal(wsReports[0][2], 'w1')
  assert.ok(wsReports[0].includes('mahiro_workspace_branch=agent-branch'))
  assert.equal(snapshotCalls.length, 1)
})

test('eventRefresh: workspace failure does not destroy pane reconciliation path', async () => {
  const setup = await fixture()
  const snapshot = {
    workspaces: [{ workspace_id: 'w1', active_tab_id: 't1' }],
    panes: [{ pane_id: 'w1:agent', workspace_id: 'w1' }]
  }
  const agents = [
    { pane_id: 'w1:agent', workspace_id: 'w1', agent: 'other', tokens: {} }
  ]

  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)
  // Inject failure specifically for workspace report-metadata
  await writeFile(stub.failures, JSON.stringify([
    { needle: 'workspace report-metadata', remaining: 1 }
  ]))

  const agentEvent = JSON.stringify({
    event: 'pane_focused',
    data: { type: 'pane_focused', pane_id: 'w1:agent', workspace_id: 'w1' }
  })

  const warnings = []
  const result = await eventRefresh(stub.env, {
    rawEvent: agentEvent,
    clock: () => Date.now(),
    sequence: () => '2005',
    warn: msg => warnings.push(msg)
  })

  // Pane report succeeded, workspace report isolated
  assert.equal(result.reports, 1)
  assert.equal(result.workspaceReports, 0)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /workspace metadata event refresh failed/)
})

// -------------------------------------------------------------
// 6. Inventory Capping and Deadline Tests
// -------------------------------------------------------------

test('bounded inventory: rejects snapshot with > 128 workspaces', async () => {
  const setup = await fixture()
  const workspaces = Array.from({ length: MAX_WORKSPACES + 10 }, (_, i) => ({
    workspace_id: `ws-${i}`,
    active_tab_id: 't1'
  }))

  const stub = await stubHerdrWithSnapshot(setup, { workspaces })
  await assert.rejects(
    reconcileWorkspaces(stub.env, { sequence: () => '3001' }),
    /workspace inventory exceeds the 128-workspace refresh limit/
  )
})

test('deadline honor: fails explicitly when deadline is exhausted before or during reports', async () => {
  const setup = await fixture()
  const repo = join(setup.root, 'repo-deadline')
  await initGitRepo(repo)

  const stub = await stubHerdrWithSnapshot(setup, {
    workspaces: [{ workspace_id: 'w1', worktree: { checkout_path: repo, is_linked_worktree: false } }]
  })

  // Clock exceeds deadline
  await assert.rejects(
    reconcileWorkspaces(stub.env, { clock: () => 29_500, deadline: 30_000, sequence: () => '3002' }),
    /deadline exhausted/
  )
})

// -------------------------------------------------------------
// 7. Cleanup & Fault Isolation Tests
// -------------------------------------------------------------

test('clearWorkspaceMetadata clears all owned tokens on all workspaces', async () => {
  const setup = await fixture()
  const stub = await stubHerdrWithSnapshot(setup, {
    workspaces: [
      { workspace_id: 'w1', active_tab_id: 't1' },
      { workspace_id: 'w2', active_tab_id: 't1' }
    ]
  })

  const result = await clearWorkspaceMetadata(stub.env, { sequence: () => '4001' })
  assert.equal(result.reports, 2)

  const calls = await readCalls(stub.log)
  const wsReports = workspaceReportCalls(calls)
  assert.equal(wsReports.length, 2)

  for (const report of wsReports) {
    for (const token of OWNED_WORKSPACE_TOKENS) {
      assert.ok(report.includes('--clear-token'))
      assert.ok(report.includes(token))
    }
    assert.equal(report.includes('--token'), false)
  }
})

test('clearOwnedMetadata coordinates pane and workspace cleanup best-effort', async () => {
  const setup = await fixture()
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]
  const snapshot = { workspaces: [{ workspace_id: 'w1', active_tab_id: 't1' }] }
  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)

  const result = await clearOwnedMetadata(stub.env, { sequence: () => '5001' })
  assert.equal(result.reports, 1) // pane reports
  assert.equal(result.workspaceReports, 1) // workspace reports

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  const wsReports = workspaceReportCalls(calls)

  assert.equal(paneReports.length, 1)
  assert.equal(wsReports.length, 1)
})

test('clearOwnedMetadata: pane cleanup failure does not prevent workspace cleanup while truthfully signaling failure', async () => {
  const setup = await fixture()
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]
  const snapshot = { workspaces: [{ workspace_id: 'w1', active_tab_id: 't1' }] }
  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)

  // Inject failure specifically for pane report-metadata
  await writeFile(stub.failures, JSON.stringify([
    { needle: 'pane report-metadata', remaining: 1 }
  ]))

  // Preserves truthful failure signaling: rejects after both attempts
  await assert.rejects(
    clearOwnedMetadata(stub.env, { sequence: () => '5002' }),
    /pane cleanup failed|injected failure/
  )

  // Verifies workspace cleanup was still attempted despite pane clear failure
  const calls = await readCalls(stub.log)
  const wsReports = workspaceReportCalls(calls)
  assert.equal(wsReports.length, 1)
  assert.equal(wsReports[0][2], 'w1')
})

test('clearOwnedMetadata: workspace cleanup failure does not prevent pane cleanup while truthfully signaling failure', async () => {
  const setup = await fixture()
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]
  const snapshot = { workspaces: [{ workspace_id: 'w1', active_tab_id: 't1' }] }
  const stub = await stubHerdrWithSnapshot(setup, snapshot, agents)

  // Inject failure specifically for workspace report-metadata
  await writeFile(stub.failures, JSON.stringify([
    { needle: 'workspace report-metadata', remaining: 1 }
  ]))

  // Preserves truthful failure signaling: rejects after both attempts
  await assert.rejects(
    clearOwnedMetadata(stub.env, { sequence: () => '5003' }),
    /workspace cleanup failed|injected failure/
  )

  // Verifies pane cleanup was still attempted (and succeeded)
  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  assert.equal(paneReports.length, 1)
  assert.equal(paneReports[0][2], 'w1:p1')
})

test('fault isolation: workspace failure does not corrupt quota refresh or broaden pane ownership', async () => {
  const setup = await fixture()
  const agents = [{ pane_id: 'w1:p1', workspace_id: 'w1', agent: 'other', tokens: {} }]
  const stub = await stubHerdrWithSnapshot(setup, { workspaces: [{ workspace_id: 'w1' }] }, agents)

  // Inject failure specifically for workspace report-metadata
  await writeFile(stub.failures, JSON.stringify([
    { needle: 'workspace report-metadata', remaining: 1 }
  ]))

  const warnings = []
  const result = await refresh(stub.env, {
    clock: () => Date.now(),
    sequence: () => '6001',
    warn: msg => warnings.push(msg)
  })

  // Pane refresh succeeded!
  assert.equal(result.reports, 1)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /workspace metadata refresh failed/)

  const calls = await readCalls(stub.log)
  const paneReports = calls.filter(c => c[0] === 'pane' && c[1] === 'report-metadata')
  assert.equal(paneReports.length, 1)
  assert.equal(paneReports[0][2], 'w1:p1')
  // Verify pane report only uses pane-owned tokens, never workspace tokens
  assert.equal(paneReports[0].some(val => String(val).includes('mahiro_workspace')), false)
})

// -------------------------------------------------------------
// 8. Module Layering and Acyclic Import Smoke Tests
// -------------------------------------------------------------

test('module layering: workspace-metadata does not import core.mjs', async () => {
  const wsSource = await readFile(new URL('../src/workspace-metadata.mjs', import.meta.url), 'utf8')
  assert.equal(wsSource.includes('./core.mjs'), false, 'src/workspace-metadata.mjs must not import ./core.mjs')
})

test('initialization cycle smoke: core and workspace-metadata import cleanly in both orders', () => {
  // Test order 1: core then workspace-metadata
  const r1 = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import * as core from './src/core.mjs'; import * as ws from './src/workspace-metadata.mjs'; import * as rt from './src/runtime-helpers.mjs'; if (!core.refresh || !ws.reconcileWorkspaces || !rt.runHerdr) process.exit(1)"
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8'
  })
  assert.equal(r1.status, 0, `import core then workspace-metadata failed: ${r1.stderr}`)

  // Test order 2: workspace-metadata then core
  const r2 = spawnSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import * as ws from './src/workspace-metadata.mjs'; import * as core from './src/core.mjs'; import * as rt from './src/runtime-helpers.mjs'; if (!core.refresh || !ws.reconcileWorkspaces || !rt.runHerdr) process.exit(1)"
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)),
    encoding: 'utf8'
  })
  assert.equal(r2.status, 0, `import workspace-metadata then core failed: ${r2.stderr}`)
})

test('shared runtime helpers re-exported identically from core for backwards compatibility', async () => {
  const runtime = await import('../src/runtime-helpers.mjs')
  const core = await import('../src/core.mjs')

  assert.equal(typeof runtime.sanitizeToken, 'function')
  assert.equal(typeof runtime.observeSequence, 'function')
  assert.equal(typeof runtime.runHerdr, 'function')
  assert.equal(core.sanitizeToken, runtime.sanitizeToken)
  assert.equal(core.observeSequence, runtime.observeSequence)
  assert.equal(core.runHerdr, runtime.runHerdr)
  assert.equal(core.COMMAND_TIMEOUT_MS, runtime.COMMAND_TIMEOUT_MS)
  assert.equal(core.INVOCATION_DEADLINE_MS, runtime.INVOCATION_DEADLINE_MS)
  assert.equal(core.MAX_OUTPUT_BYTES, runtime.MAX_OUTPUT_BYTES)
  assert.equal(core.MAX_U64, runtime.MAX_U64)
})

// -------------------------------------------------------------
// 9. Listening TCP Ports per Herdr Space Tests
// -------------------------------------------------------------

test('ports: reject cwd-only matching and attribute strictly via process tree', () => {
  const shellPidToWorkspace = new Map([[100, 'w1']])
  // PID 200 is running in the same directory, but its parent is init (1), not descendant of shell PID 100
  const pidToPpid = new Map([[200, 1]])
  const pidToPorts = new Map([[200, new Set([8000])]])

  const result = attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(result.size, 0, 'daemon with ppid=1 must not be attributed to w1 merely by cwd')

  // Contrast: if PID 200 is child of 100
  const childPidToPpid = new Map([[200, 100]])
  const childResult = attributePortsToWorkspaces(pidToPorts, childPidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(childResult.get('w1'), 'Ports 8000', 'descendant of shell pid 100 must be attributed to w1')
})

test('ports: conflicting ownership across spaces leaves port unassigned', () => {
  const shellPidToWorkspace = new Map([[100, 'w1'], [101, 'w2']])
  const pidToPpid = new Map([[200, 100], [300, 101]])
  // Port 9000 is listened by both w1 (pid 200) and w2 (pid 300)
  const pidToPorts = new Map([
    [200, new Set([3000, 9000])],
    [300, new Set([4000, 9000])]
  ])

  const result = attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(result.get('w1'), 'Ports 3000')
  assert.equal(result.get('w2'), 'Ports 4000')
  assert.ok(!result.get('w1').includes('9000'))
  assert.ok(!result.get('w2').includes('9000'))
})

test('ports: sibling spaces with identical cwd are attributed distinctly without conflation', () => {
  const snapshot = {
    workspaces: [{ workspace_id: 'w1' }, { workspace_id: 'w2' }],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', cwd: '/common/repo', foreground_cwd: '/common/repo', shell_pid: 100 },
      { pane_id: 'w2:p1', workspace_id: 'w2', cwd: '/common/repo', foreground_cwd: '/common/repo', shell_pid: 101 }
    ]
  }

  const psOutput = '  PID  PPID\n  100     1\n  200   100\n  101     1\n  300   101\n'
  const lsofOutput = 'p200\nf3\nPtcp\nTST=LISTEN\nn*:3001\np300\nf3\nPtcp\nTST=LISTEN\nn*:3002\n'

  const result = collectWorkspacePorts(process.env, snapshot, snapshot.workspaces, {
    platform: 'darwin',
    psOutput,
    lsofOutput,
    kill: () => true
  })

  assert.equal(result.get('w1'), 'Ports 3001')
  assert.equal(result.get('w2'), 'Ports 3002')
})

test('ports: child and grandchild listeners are traversed via PPID chain', () => {
  const shellPidToWorkspace = new Map([[100, 'w1']])
  // 100 (shell) -> 200 (npm/tool) -> 300 (dev server)
  const pidToPpid = new Map([[200, 100], [300, 200]])
  const pidToPorts = new Map([[300, new Set([5173])]])

  const result = attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(result.get('w1'), 'Ports 5173')
})

test('ports: non-listening TCP (ESTABLISHED, CLOSE_WAIT, connected) is rejected', () => {
  const lsofOutput = [
    'p100',
    'f3',
    'Ptcp',
    'TST=ESTABLISHED',
    'n127.0.0.1:5173->127.0.0.1:54321',
    'p101',
    'f4',
    'Ptcp',
    'TST=CLOSE_WAIT',
    'n127.0.0.1:8080',
    'p102',
    'f5',
    'Ptcp',
    'TST=LISTEN',
    'n*:3000'
  ].join('\n') + '\n'

  const pidToPorts = parseLsofOutput(lsofOutput)
  assert.equal(pidToPorts.has(100), false, 'ESTABLISHED socket must not be parsed')
  assert.equal(pidToPorts.has(101), false, 'CLOSE_WAIT socket must not be parsed')
  assert.ok(pidToPorts.has(102))
  assert.deepEqual([...pidToPorts.get(102)], [3000])
})

test('ports: IPv4 and IPv6 sockets deduplicate into a single port number', () => {
  const lsofOutput = [
    'p200',
    'f3',
    'PTCP',
    'TST=LISTEN',
    'n*:8080',
    'f4',
    'PTCP',
    'TST=LISTEN',
    'n*:8080',
    'f5',
    'PTCP',
    'TST=LISTEN',
    'n127.0.0.1:8080'
  ].join('\n') + '\n'

  const pidToPorts = parseLsofOutput(lsofOutput)
  assert.ok(pidToPorts.has(200))
  assert.deepEqual([...pidToPorts.get(200)], [8080])

  const shellPidToWorkspace = new Map([[100, 'w1']])
  const pidToPpid = new Map([[200, 100]])
  const result = attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(result.get('w1'), 'Ports 8080')
})

test('ports: no ports or empty listeners clears token without claiming zero services', () => {
  const snapshot = {
    workspaces: [{ workspace_id: 'w1' }],
    panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', shell_pid: 100 }]
  }

  const result = collectWorkspacePorts(process.env, snapshot, snapshot.workspaces, {
    platform: 'darwin',
    psOutput: '  PID  PPID\n  100     1\n',
    lsofOutput: '',
    kill: () => true
  })

  assert.equal(result.size, 0)

  const args = workspaceMetadataArgs('w1', { branch: 'main', gitStatus: 'clean', ports: null }, '1', Date.now(), 60000)
  assert.ok(args.includes('--clear-token'))
  const clearIndex = args.indexOf('mahiro_workspace_ports')
  assert.ok(clearIndex !== -1 && args[clearIndex - 1] === '--clear-token')
  assert.ok(!args.some(arg => String(arg).startsWith('mahiro_workspace_ports=')))
})

test('ports: command failure or unsupported platform clears token and leaves Git metadata intact', async () => {
  const setup = await fixture()
  const repo = join(setup.root, 'repo')
  await initGitRepo(repo, { branch: 'main' })

  const snapshotData = {
    workspaces: [{ workspace_id: 'w1' }],
    panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', foreground_cwd: repo, shell_pid: 100 }],
    layouts: [{ workspace_id: 'w1', tab_id: 't1', focused_pane_id: 'w1:p1' }]
  }

  const stub = await stubHerdrWithSnapshot(setup, snapshotData)
  // Reconcile with unsupported platform 'win32'
  const result = await reconcileWorkspaces(stub.env, {
    snapshot: snapshotData,
    platform: 'win32'
  })

  assert.equal(result.reports, 1)
  const calls = await readCalls(stub.log)
  const reportCall = calls.find(c => c[0] === 'workspace' && c[1] === 'report-metadata')
  assert.ok(reportCall, 'workspace report must still occur')
  assert.ok(reportCall.includes('mahiro_workspace_branch=main'), 'git branch must still be reported')
  assert.ok(reportCall.includes('mahiro_workspace_git_status=clean'), 'git status must still be reported')
  const portsIndex = reportCall.indexOf('mahiro_workspace_ports')
  assert.ok(portsIndex !== -1 && reportCall[portsIndex - 1] === '--clear-token', 'ports token must be cleared')
})

test('ports: stale token clearing when port stops listening', () => {
  const now = Date.now()
  // Cycle 1: port active
  const argsActive = workspaceMetadataArgs('w1', {
    branch: 'main',
    gitStatus: 'clean',
    ports: 'Ports 5173'
  }, '1', now, 60000)
  assert.ok(argsActive.some(arg => arg === 'mahiro_workspace_ports=Ports 5173'))

  // Cycle 2: port stopped listening -> ports is null
  const argsStopped = workspaceMetadataArgs('w1', {
    branch: 'main',
    gitStatus: 'clean',
    ports: null
  }, '2', now, 60000)
  assert.ok(!argsStopped.some(arg => String(arg).startsWith('mahiro_workspace_ports=')))
  const idx = argsStopped.indexOf('mahiro_workspace_ports')
  assert.ok(idx !== -1 && argsStopped[idx - 1] === '--clear-token')
})

test('ports: bounded sorting and deadline honor', () => {
  const shellPidToWorkspace = new Map([[100, 'w1']])
  const pidToPpid = new Map([[200, 100]])
  const pidToPorts = new Map([[200, new Set([8080, 3000, 5173])]])

  const result = attributePortsToWorkspaces(pidToPorts, pidToPpid, shellPidToWorkspace, { kill: () => true })
  assert.equal(result.get('w1'), 'Ports 3000 · 5173 · 8080', 'ports must be numerically sorted')

  // Deadline honor
  assert.throws(() => {
    collectWorkspacePorts(process.env, { workspaces: [{ workspace_id: 'w1' }], panes: [{ pane_id: 'w1:p1', workspace_id: 'w1', shell_pid: 100 }] }, [{ workspace_id: 'w1' }], {
      platform: 'darwin',
      clock: () => 1000,
      deadline: 1500
    })
  }, /deadline exhausted/u)
})

test('ports: multi-tab attribution includes background tabs and all panes', () => {
  const snapshot = {
    workspaces: [{ workspace_id: 'w1', active_tab_id: 't1' }],
    panes: [
      { pane_id: 'w1:p1', workspace_id: 'w1', tab_id: 't1', shell_pid: 100 },
      { pane_id: 'w1:p2', workspace_id: 'w1', tab_id: 't2', shell_pid: 101 }
    ]
  }

  const psOutput = '  PID  PPID\n  100     1\n  200   100\n  101     1\n  201   101\n'
  const lsofOutput = 'p200\nf3\nPtcp\nTST=LISTEN\nn*:3000\np201\nf4\nPtcp\nTST=LISTEN\nn*:4000\n'

  const result = collectWorkspacePorts(process.env, snapshot, snapshot.workspaces, {
    platform: 'darwin',
    psOutput,
    lsofOutput,
    kill: () => true
  })

  assert.equal(result.get('w1'), 'Ports 3000 · 4000', 'both active and background tab panes must be attributed')
})

test('ports: config configure and restore preserve [ui.sidebar.spaces] with ports token row and coexistence', async () => {
  const setup = await fixture()
  const { configure, restoreConfig, hasSpacesOwner } = await import('../src/core.mjs')

  const original = Buffer.from('[ui.sidebar]\nsymbols = "codicons"\n')
  await writeFile(setup.herdrConfig, original, { mode: 0o640 })
  await configure(setup.env)

  const applied = (await readFile(setup.herdrConfig)).toString('utf8')
  assert.ok(applied.includes('symbols = "codicons"'), 'existing symbols setting must be preserved')
  assert.ok(applied.includes('[ui.sidebar.spaces]'), 'sidebar spaces block must be added')
  assert.ok(applied.includes('$mahiro_workspace_ports'), 'ports token must be configured in spaces block')
  assert.equal(hasSpacesOwner(applied), true, 'hasSpacesOwner must detect configured spaces block')

  await restoreConfig(setup.env)
  const restored = (await readFile(setup.herdrConfig)).toString('utf8')
  assert.equal(restored, original.toString('utf8'), 'restored config must match original exactly')
  assert.equal(hasSpacesOwner(restored), false, 'hasSpacesOwner must be false on restored config')

  // Coexistence of all 4 tokens
  const args = workspaceMetadataArgs('w1', {
    branch: 'feat/test',
    gitStatus: 'clean',
    isLinked: true,
    worktreeLabel: 'wt-1',
    ports: 'Ports 5173 · 8787'
  }, '1', Date.now(), 60000)

  for (const tokenName of OWNED_WORKSPACE_TOKENS) {
    const isSet = args.some((val, idx) => args[idx - 1] === '--token' && String(val).startsWith(`${tokenName}=`))
    assert.ok(isSet, `Token ${tokenName} must coexist in report`)
  }
  assert.equal(args.includes('--clear-token'), false, 'no tokens should be cleared when all are provided')
})

test('ports: existing applied snapshot upgrades without losing applied-only settings or original bytes', async () => {
  const setup = await fixture()
  const { configure, restoreConfig } = await import('../src/core.mjs')
  const original = '[ui]\nstatus_indicators = "symbols"\n'
  await writeFile(setup.herdrConfig, original, { mode: 0o640 })
  await configure(setup.env)
  const statePath = join(setup.pluginConfig, 'config-snapshots.json')
  const saved = JSON.parse(await readFile(statePath, 'utf8'))
  const oldApplied = Buffer.from(saved.appliedBase64, 'base64').toString('utf8')
    .replace(/\n\[ui\.sidebar\.spaces\][\s\S]*?(?=# mahiro-herdr:end)/u, '\n') + '\n[keys]\nsettings = "prefix+s"\n'
  saved.appliedBase64 = Buffer.from(oldApplied).toString('base64')
  await writeFile(statePath, JSON.stringify(saved))
  await writeFile(setup.herdrConfig, oldApplied)
  await configure(setup.env)
  const applied = await readFile(setup.herdrConfig, 'utf8')
  assert.ok(applied.includes('$mahiro_workspace_ports'))
  assert.ok(applied.includes('settings = "prefix+s"'))
  assert.ok(applied.includes('status_indicators = "symbols"'))
  const upgraded = JSON.parse(await readFile(statePath, 'utf8'))
  assert.equal(upgraded.originalBase64, saved.originalBase64)
  await configure(setup.env)
  assert.equal(await readFile(setup.herdrConfig, 'utf8'), applied)
  await writeFile(setup.herdrConfig, applied + '# unrelated drift\n')
  await assert.rejects(configure(setup.env), /drifted/u)
  await writeFile(setup.herdrConfig, applied)
  await restoreConfig(setup.env)
  assert.equal(await readFile(setup.herdrConfig, 'utf8'), original)
})

test('ports: oversized pane inventory fails closed instead of reporting a partial owner map', () => {
  const snapshot = {
    workspaces: [{ workspace_id: 'w1' }],
    panes: Array.from({ length: 129 }, (_, i) => ({ pane_id: `p${i}`, workspace_id: 'w1', shell_pid: i + 100 }))
  }
  assert.throws(() => collectWorkspacePorts(process.env, snapshot, snapshot.workspaces, { platform: 'darwin' }), /inventory exceeds/u)
})

test('ports: collector sub-deadline failure does not stop Git reports', async () => {
  const setup = await fixture()
  const repo = join(setup.root, 'budget-repo')
  await initGitRepo(repo)
  const snapshot = {
    workspaces: [{ workspace_id: 'w1', worktree: { checkout_path: repo } }],
    panes: [{ pane_id: 'p1', workspace_id: 'w1' }]
  }
  const stub = await stubHerdrWithSnapshot(setup, snapshot)
  let now = 1000
  const result = await reconcileWorkspaces(stub.env, {
    snapshot,
    platform: 'darwin',
    clock: () => now,
    deadline: 30000,
    getPaneProcessInfo: () => { now = 4100; throw new Error('invocation deadline exhausted') }
  })
  assert.equal(result.reports, 1)
  const reports = workspaceReportCalls(await readCalls(stub.log))
  assert.ok(reports[0].includes('mahiro_workspace_git_status=clean'))
  assert.ok(reports[0].includes('mahiro_workspace_ports'))
})
