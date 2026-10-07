import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import net from 'node:net'
import { configure } from '../src/core.mjs'
import { SPACE_RENDERER_ROWS, VENDOR_COLORS, WORKING_VENDORS } from '../src/space-renderer-style.mjs'
import { FONT_GLYPHS, RENDERER_TOKENS, localCall, rendererFrame, publishRendererFrame } from '../src/agent-renderer.mjs'
import { installRendererFont, restoreRendererFont } from '../src/renderer-font.mjs'
import { rendererStatus, runRenderer, startRenderer, stopRenderer } from '../src/renderer-runtime.mjs'

const pane = (id, status = 'idle', extra = {}) => ({ pane_id: id, workspace_id: 'w1', terminal_id: `term-${id}`, agent: 'letta', display_agent: 'Letta', terminal_title_stripped: 'Mahiro Code', agent_status: status, ...extra })
const snapshot = agents => ({ agents, workspaces: [{ workspace_id: 'w1', label: 'Project' }, { workspace_id: 'w2', label: 'Feature', worktree: { is_linked_worktree: true } }] })

test('Space source anatomy: one mark beside name, independently colored vendor labels on next row', () => {
  const rows = SPACE_RENDERER_ROWS.split('\n')
  assert.equal(rows.length, 2)
  assert.ok(rows[0].endsWith('"workspace"],'))
  assert.ok(!rows[0].includes('mh_ws_logo_'))
  assert.ok(!rows[1].includes('mh_ws_working'))
  for (const [vendor, color] of Object.entries(VENDOR_COLORS)) {
    assert.ok(rows[1].includes(`token = "$mh_ws_logo_${vendor}", fg = "${color}"`))
    if (WORKING_VENDORS.includes(vendor)) assert.ok(rows[0].includes(`token = "$mh_ws_working_${vendor}", fg = "${color}"`))
  }
  const frame = rendererFrame(snapshot([pane('p1', 'working', { agent: 'gemini', display_agent: 'gemini' })]), {}, { font: true })
  assert.equal(frame.frames[0].tokens.mh_ws_working, null)
  assert.ok(frame.frames[0].tokens.mh_ws_working_gemini)
  assert.equal(frame.frames[0].tokens.mh_ws_logo_gemini, `${FONT_GLYPHS.gemini} gemini`)
  assert.ok(Object.values(frame.frames[0].tokens).filter(Boolean).length <= 13)
})

test('renderer placement: Agents block equals accepted pre-renderer baseline; only Spaces bind renderer', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'space-renderer-config-')))
  const config = join(root, 'config.toml')
  const env = { HOME: root, HERDR_CONFIG_PATH: config, HERDR_PLUGIN_CONFIG_DIR: join(root, 'plugin') }
  try {
    await writeFile(config, '[ui]\nstatus_indicators = "symbols"\n')
    await configure(env)
    const text = await readFile(config, 'utf8')
    const agents = text.slice(text.indexOf('[ui.sidebar.agents]'), text.indexOf('[ui.sidebar.spaces]')).trim()
    const baseline = (await readFile(new URL('./fixtures/agents-sidebar.baseline.toml', import.meta.url), 'utf8')).trim()
    assert.equal(agents, baseline)
    const spaces = text.slice(text.indexOf('[ui.sidebar.spaces]'))
    assert.ok(spaces.includes('row_gap = 0 # mahiro-herdr:spaces-row-gap'))
    for (const token of RENDERER_TOKENS) assert.ok(spaces.includes(`$${token}`))
    assert.ok(spaces.includes('mahiro_workspace_ports'))
    assert.ok(spaces.includes('["branch", "git_status"]'))
    assert.ok(!agents.includes('$mh_'))
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('renderer: mixed vendors/states stay visible per Space and empty Space clears every token', () => {
  const frame = rendererFrame(snapshot([
    pane('p1', 'working'), pane('p2', 'blocked', { agent: 'agy', display_agent: 'agy', tab_id: 'background' }),
    pane('p3', 'working', { workspace_id: 'w2', agent: 'codex', display_agent: 'codex' })
  ]), {}, { font: true })
  assert.equal(frame.frames[0].tokens.mh_ws_working, null)
  assert.equal(frame.frames[0].tokens.mh_ws_blocked, '?')
  assert.ok(frame.frames[0].tokens.mh_ws_logo_other.includes(FONT_GLYPHS.letta))
  assert.ok(frame.frames[0].tokens.mh_ws_logo_other.includes(FONT_GLYPHS.agy))
  assert.equal(frame.frames[1].tokens.mh_ws_blocked, null)
  assert.equal(frame.frames[1].tokens.mh_ws_logo_other, `${FONT_GLYPHS.codex} codex`)
  const empty = rendererFrame(snapshot([pane('p1', 'working')]), frame.states)
  assert.equal(empty.frames[1].tokens.mh_ws_none, '·')
  assert.ok(Object.entries(empty.frames[1].tokens).every(([name, value]) => name === 'mh_ws_none' || value === null))
})

test('renderer: working-to-idle holds Done, focus acknowledges once, new turn clears', () => {
  let previous = rendererFrame(snapshot([pane('p1', 'working')])).states
  let frame = rendererFrame(snapshot([pane('p1')]), previous)
  assert.equal(frame.frames[0].tokens.mh_ws_done, '✓')
  previous = frame.states
  frame = rendererFrame(snapshot([pane('p1', 'idle', { focused: true })]), previous)
  assert.equal(frame.frames[0].tokens.mh_ws_done, null)
  frame = rendererFrame(snapshot([pane('p1')]), frame.states)
  assert.equal(frame.frames[0].tokens.mh_ws_done, null)
  frame = rendererFrame(snapshot([pane('p1', 'working')]), previous)
  assert.equal(frame.frames[0].tokens.mh_ws_done, null)
})

test('renderer: explicit Done is not re-held after viewing while status stays done', () => {
  const first = rendererFrame(snapshot([pane('p1', 'done')]))
  const focused = rendererFrame(snapshot([pane('p1', 'done', { focused: true })]), first.states)
  const left = rendererFrame(snapshot([pane('p1', 'done')]), focused.states)
  assert.equal(left.frames[0].tokens.mh_ws_done, null)
})

test('renderer: terminal/session replacement and deleted panes discard held Done', () => {
  const held = rendererFrame(snapshot([pane('p1', 'done')]))
  const replaced = rendererFrame(snapshot([pane('p1', 'idle', { terminal_id: 'replacement' })]), held.states)
  assert.equal(replaced.frames[0].tokens.mh_ws_done, null)
  assert.deepEqual(rendererFrame(snapshot([]), held.states).states, {})
})

test('renderer: completion receipt survives restart, blocked/unknown override held Done', () => {
  const first = rendererFrame(snapshot([pane('p1', 'idle', { completion_seq: 1 })]))
  const completed = rendererFrame(snapshot([pane('p1', 'idle', { completion_seq: 2 })]), first.states)
  assert.ok(completed.frames[0].tokens.mh_ws_done)
  const restarted = rendererFrame(snapshot([pane('p1')]), JSON.parse(JSON.stringify(completed.states)))
  assert.ok(restarted.frames[0].tokens.mh_ws_done)
  for (const status of ['blocked', 'unknown']) assert.equal(rendererFrame(snapshot([pane('p1', status)]), restarted.states).frames[0].tokens.mh_ws_done, null)
})

test('renderer: exact Space owns all its agents across tabs; no pane headers or task titles', () => {
  const frame = rendererFrame(snapshot([pane('p1'), pane('p2'), pane('p3', 'idle', { workspace_id: 'w2' })]))
  assert.equal(frame.frames[0].workspaceId, 'w1')
  assert.equal(frame.frames[0].tokens.mh_ws_idle, '○')
  assert.equal(frame.frames[0].tokens.mh_ws_logo_other, '⊙ letta')
  assert.equal(frame.frames[1].workspaceId, 'w2')
  assert.equal(frame.frames[1].tokens.mh_ws_idle, '○')
  assert.ok(frame.frames.every(item => !Object.hasOwn(item, 'paneId')))
  assert.ok(!JSON.stringify(frame.frames).includes('Mahiro Code'))
  assert.throws(() => rendererFrame(snapshot([pane('p1'), pane('p1')])), /ambiguous/u)
  assert.throws(() => rendererFrame(snapshot(Array.from({ length: 129 }, (_, i) => pane(`p${i}`)))), /limit/u)
  assert.throws(() => rendererFrame(null), /inventory/u)
})

test('renderer: spinner changes pixels/glyph; fonts map known identity only and sanitize labels', () => {
  const first = rendererFrame(snapshot([pane('p1', 'working')]), {}, { step: 0 })
  const next = rendererFrame(snapshot([pane('p1', 'working')]), first.states, { step: 1 })
  assert.notEqual(first.frames[0].tokens.mh_ws_working, next.frames[0].tokens.mh_ws_working)
  assert.equal(first.frames[0].tokens.mh_ws_logo_other, '⊙ letta')
  const codex = rendererFrame(snapshot([pane('p1', 'idle', { agent: 'codex', display_agent: 'codex', terminal_title_stripped: '\u001b[31mTitle\n' })]), {}, { font: true })
  assert.ok(codex.frames[0].tokens.mh_ws_logo_other.includes(FONT_GLYPHS.codex))
  assert.ok(!codex.frames[0].tokens.mh_ws_idle.includes('\u001b'))
  const titled = rendererFrame(snapshot([pane('p1', 'idle', { title: 'Accepted custom task title' })]))
  assert.ok(!titled.frames[0].tokens.mh_ws_idle.includes('Accepted custom task title'))
  assert.ok(!titled.frames[0].tokens.mh_ws_idle.includes('Mahiro Code'))
})

test('renderer: diff writes have TTL, only owned tokens, no lifecycle/quota mutation', async () => {
  const calls = []
  const call = async (_, request) => { calls.push(request); return {} }
  const frame = rendererFrame(snapshot([pane('p1')]))
  const published = new Map()
  await publishRendererFrame('fixture', frame, published, { call, now: 1000 })
  await publishRendererFrame('fixture', frame, published, { call, now: 2000 })
  assert.equal(calls.length, 4)
  assert.ok(calls.every(item => item.method === 'workspace.report_metadata'))
  const patch = Object.assign({}, ...calls.filter(item => item.params.workspace_id === 'w1').map(item => item.params.tokens))
  assert.deepEqual(Object.keys(patch), RENDERER_TOKENS)
  assert.ok(calls.every(item => Object.keys(item.params.tokens).length <= 16))
  assert.equal(calls[0].params.ttl_ms, 10000)
  assert.deepEqual(Object.keys(calls[0].params).sort(), ['source', 'tokens', 'ttl_ms', 'workspace_id'])
  await publishRendererFrame('fixture', frame, published, { call, now: 6000 })
  assert.equal(calls.length, 8)
  await publishRendererFrame('fixture', frame, published, { call, clear: true })
  assert.ok(calls.slice(8).every(item => Object.values(item.params.tokens).every(value => value === null)))
})

test('renderer: local transport checks response identity and rejects truncation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'renderer-transport-'))
  const path = join(root, 'test.sock')
  const server = net.createServer(socket => { socket.on('error', () => {}); socket.once('data', () => socket.end('{"id":"wrong","result":{}}\n')) })
  await new Promise(resolve => server.listen(path, resolve))
  try { await assert.rejects(localCall(path, { id: 'correct' }), /identity/u) }
  finally { await new Promise(resolve => server.close(resolve)); await rm(root, { recursive: true }) }
})

test('renderer font: isolated install preserves config, idempotence, drift rejection and exact restore', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'renderer-font-')))
  const config = join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
  await mkdir(join(config, '..'), { recursive: true })
  const original = Buffer.from('font-family = JetBrains Mono\n')
  await writeFile(config, original)
  const env = { HOME: home, HERDR_PLUGIN_CONFIG_DIR: join(home, 'plugin') }
  const validate = async path => {
    const text = await readFile(path, 'utf8')
    assert.ok(text.includes('font-codepoint-map = U+E1A0-U+E1BB=Mahiro Herdr Agent Icons'))
    assert.ok(!text.includes('\nsymbol-map'))
  }
  try {
    const result = await installRendererFont(env, { platform: 'darwin', validate })
    assert.equal(result.hash, 'ed16934c7231b09b266f754569355236a3d475d530643c14a1f312226c6653e1')
    const applied = await readFile(config)
    assert.ok(applied.toString().includes('font-codepoint-map'))
    await installRendererFont(env, { platform: 'darwin', validate })
    await writeFile(config, Buffer.concat([applied, Buffer.from('# drift')]))
    await assert.rejects(restoreRendererFont(env), /drift/u)
    await writeFile(config, applied)
    await restoreRendererFont(env)
    assert.deepEqual(await readFile(config), original)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('font generation upgrade retains immutable original and restores exactly', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'renderer-font-upgrade-')))
  const env = { HOME: home, HERDR_PLUGIN_CONFIG_DIR: join(home, 'plugin') }
  const root = join(env.HERDR_PLUGIN_CONFIG_DIR, 'renderer')
  const config = join(home, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
  const original = 'font-size = 13\n'
  const previous = original + '# mahiro-herdr:font-begin\nfont-codepoint-map = U+E1A0-U+E1BA=Herdr Agent Icons Max\n# mahiro-herdr:font-end\n'
  await mkdir(root, { recursive: true, mode: 0o700 })
  await mkdir(join(config, '..'), { recursive: true })
  await writeFile(config, previous)
  await writeFile(join(root, 'font-config.json'), JSON.stringify({ path: config, mode: 0o644, original: Buffer.from(original).toString('base64'), applied: Buffer.from(previous).toString('base64') }))
  try {
    await installRendererFont(env, { platform: 'darwin', validate: async candidate => assert.ok((await readFile(candidate, 'utf8')).includes('Mahiro Herdr Agent Icons')) })
    const saved = JSON.parse(await readFile(join(root, 'font-config.json'), 'utf8'))
    assert.equal(Buffer.from(saved.original, 'base64').toString(), original)
    assert.ok((await readFile(config, 'utf8')).includes('U+E1A0-U+E1BB'))
    await restoreRendererFont(env)
    assert.equal(await readFile(config, 'utf8'), original)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('renderer runtime: existing endpoint reused; native metadata published, persisted and cleared on stop', async () => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'renderer-life-')))
  const socketPath = join(home, 'herdr.sock')
  const env = { HOME: home, HERDR_ENV: '1', HERDR_PLUGIN_CONFIG_DIR: join(home, 'plugin'), HERDR_SOCKET_PATH: socketPath }
  const calls = []
  let current = snapshot([pane('p1', 'done')])
  const server = net.createServer(socket => {
    socket.on('error', () => {})
    socket.once('data', chunk => {
      const request = JSON.parse(chunk.toString().trim())
      calls.push(request)
      const result = request.method === 'session.snapshot' ? { snapshot: current } : { type: 'metadata_reported' }
      socket.end(JSON.stringify({ id: request.id, result }) + '\n')
    })
  })
  await new Promise(resolve => server.listen(socketPath, resolve))
  const running = runRenderer(env)
  try {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise(resolve => setTimeout(resolve, 50))
      const ready = await rendererStatus(env).catch(() => null)
      if (ready?.ready) break
    }
    const status = await startRenderer(env)
    assert.equal(status.pid, process.pid, 'reuse the already bound runtime, not launch another process')
    assert.equal(status.ready, true)
    assert.ok(calls.some(item => item.params?.tokens?.mh_ws_done?.startsWith('✓')))
    assert.ok(calls.filter(item => item.method !== 'session.snapshot').every(item => item.method === 'workspace.report_metadata'))
    const state = JSON.parse(await readFile(join(env.HERDR_PLUGIN_CONFIG_DIR, 'renderer', 'done-state.json'), 'utf8'))
    assert.equal(state.p1.heldDone, true)
    await stopRenderer(env)
    await running
    assert.ok(calls.some(item => item.method === 'workspace.report_metadata' && Object.values(item.params.tokens).every(value => value === null)))
    await assert.rejects(rendererStatus(env), error => error.code === 'ENOENT')
    current = snapshot([pane('p1', 'idle')])
  } finally {
    await stopRenderer(env).catch(() => {})
    await running
    await new Promise(resolve => server.close(resolve))
    await rm(home, { recursive: true, force: true })
  }
})
