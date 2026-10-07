import net from 'node:net'
import { dirname, join } from 'node:path'
import { sanitizeToken } from './runtime-helpers.mjs'
import { LOGO_VENDORS, WORKING_VENDORS, RENDERER_TOKENS } from './space-renderer-style.mjs'

export const RENDERER_SOURCE = 'mahiro-herdr.renderer'
export { RENDERER_TOKENS } from './space-renderer-style.mjs'
export const SPINNER_FRAMES = ['⣷', '⣯', '⣟', '⡿', '⢿', '⣻', '⣽', '⣾']
export const FONT_GLYPHS = Object.fromEntries([
  'claude', 'codex', 'opencode', 'omp', 'cline', 'mastracode', 'kimi', 'kilo', 'maki', 'pi', 'hermes', 'cursor',
  'copilot', 'deepseek', 'gemini', 'gpt', 'qwen', 'grok', 'agy', 'kiro', 'amp', 'devin', 'qodercli', 'glm', 'kimchi', 'muse', 'crush'
].map((name, index) => [name, String.fromCodePoint(0xe1a0 + index)]))
FONT_GLYPHS.letta = '\ue1bb'

const idValid = value => typeof value === 'string' && /^[\w:-]{1,128}$/u.test(value)
const identity = pane => JSON.stringify([pane.terminal_id, pane.agent, pane.agent_session?.value, pane.tokens?.letta_started_at])

export const rendererSocketPath = env => env.HERDR_SOCKET_PATH || join(env.HERDR_CONFIG_PATH ? dirname(env.HERDR_CONFIG_PATH) : join(env.HOME, '.config', 'herdr'), 'herdr.sock')

// Only local bounded Herdr/control transport. No arbitrary method dispatch from callers.
export const localCall = (socketPath, request, timeout = 2000) => new Promise((resolve, reject) => {
  const socket = net.createConnection({ path: socketPath })
  let body = ''
  let settled = false
  const finish = (error, value) => {
    if (settled) return
    settled = true
    socket.destroy()
    if (error) reject(error)
    else resolve(value)
  }
  socket.setTimeout(timeout, () => finish(new Error('local renderer transport timeout')))
  socket.on('error', error => finish(error))
  socket.on('connect', () => socket.write(JSON.stringify(request) + '\n'))
  socket.on('end', () => finish(new Error('incomplete local renderer response')))
  socket.on('data', chunk => {
    body += chunk
    if (Buffer.byteLength(body) > 256 * 1024) return finish(new Error('renderer response exceeds limit'))
    const newline = body.indexOf('\n')
    if (newline < 0) return
    try {
      const response = JSON.parse(body.slice(0, newline))
      if (response.id !== request.id) throw new Error('renderer response identity mismatch')
      if (response.error) throw new Error(`renderer request refused: ${response.error.code}`)
      finish(null, response.result)
    } catch (error) { finish(error) }
  })
})

export const rendererFrame = (snapshot, previous = {}, { step = 0, font = false } = {}) => {
  if (!snapshot || !Array.isArray(snapshot.agents) || !Array.isArray(snapshot.workspaces)) throw new Error('invalid renderer inventory')
  if (snapshot.agents.length > 128 || snapshot.workspaces.length > 128) throw new Error('renderer inventory exceeds limit')
  const workspaces = new Map()
  for (const ws of snapshot.workspaces) {
    if (!idValid(ws.workspace_id) || workspaces.has(ws.workspace_id)) throw new Error('ambiguous renderer workspace inventory')
    workspaces.set(ws.workspace_id, { workspaceId: ws.workspace_id, entries: new Map() })
  }
  const seen = new Set()
  const states = {}
  for (const pane of snapshot.agents) {
    if (!idValid(pane.pane_id) || !idValid(pane.workspace_id) || !pane.terminal_id || seen.has(pane.pane_id)) throw new Error('ambiguous renderer pane inventory')
    seen.add(pane.pane_id)
    const key = identity(pane)
    const old = previous[pane.pane_id]?.identity === key ? previous[pane.pane_id] : null
    const status = ['working', 'done', 'blocked', 'idle', 'unknown'].includes(pane.agent_status) ? pane.agent_status : 'unknown'
    const completed = (status === 'done' && old?.status !== 'done') || (old?.status === 'working' && status === 'idle') ||
      (old && Number.isSafeInteger(pane.completion_seq) && pane.completion_seq > (old.completionSeq ?? -1))
    let heldDone = Boolean(old?.heldDone || completed)
    if (status === 'working' || status === 'blocked' || status === 'unknown' || pane.focused || snapshot.focused_pane_id === pane.pane_id) heldDone = false
    const display = heldDone ? 'done' : status === 'done' ? 'idle' : status
    states[pane.pane_id] = { identity: key, status, heldDone, completionSeq: pane.completion_seq ?? old?.completionSeq ?? null }
    const ws = workspaces.get(pane.workspace_id)
    if (!ws) throw new Error('renderer pane has no matching workspace')
    const name = sanitizeToken(pane.display_agent || pane.agent || 'Agent').slice(0, 48)
    const vendor = FONT_GLYPHS[name.toLowerCase()] ? name.toLowerCase() : pane.agent
    const logo = font && FONT_GLYPHS[vendor] ? FONT_GLYPHS[vendor] : vendor === 'letta' ? '⊙' : '◈'
    const entryKey = `${display}:${vendor}:${logo}`
    const entry = ws.entries.get(entryKey) || { display, logo, vendor, name, count: 0 }
    entry.count += 1
    ws.entries.set(entryKey, entry)
  }
  const frames = [...workspaces.values()].map(ws => {
    const tokens = Object.fromEntries(RENDERER_TOKENS.map(token => [token, null]))
    const entries = [...ws.entries.values()]
    // Source priority: asking > working > unseen result > parked > unavailable.
    const chosen = ['blocked', 'working', 'done', 'idle', 'unknown'].map(status => entries.find(entry => entry.display === status)).find(Boolean)
    const status = chosen?.display || 'none'
    const token = status === 'working' && WORKING_VENDORS.includes(chosen.vendor) ? `mh_ws_working_${chosen.vendor}` : `mh_ws_${status}`
    tokens[token] = status === 'working' ? SPINNER_FRAMES[step % SPINNER_FRAMES.length] : { blocked: '?', done: '✓', idle: '○', unknown: '◇', none: '·' }[status]
    const seenVendors = new Set()
    const other = []
    for (const entry of entries) {
      if (seenVendors.has(entry.vendor)) continue
      seenVendors.add(entry.vendor)
      const label = sanitizeToken(`${entry.logo} ${entry.vendor || entry.name}`)
      if (LOGO_VENDORS.includes(entry.vendor)) tokens[`mh_ws_logo_${entry.vendor}`] = label
      else other.push(label)
    }
    if (other.length) tokens.mh_ws_logo_other = sanitizeToken(other.join(' '))
    return { workspaceId: ws.workspaceId, tokens }
  })
  return { states, frames }
}

export const publishRendererFrame = async (socketPath, frame, published = new Map(), { call = localCall, now = Date.now(), clear = false } = {}) => {
  // Sequential bounded writes: no fanout and no quota/lifecycle fields in the envelope.
  const deadline = Date.now() + 2000
  for (const item of frame.frames) {
    const tokens = clear ? Object.fromEntries(RENDERER_TOKENS.map(name => [name, null])) : item.tokens
    const serialized = JSON.stringify(tokens)
    const old = published.get(item.workspaceId)
    if (!clear && old?.value === serialized && now - old.at < 4000) continue
    const remaining = deadline - Date.now()
    if (remaining <= 0) throw new Error('renderer publication budget exhausted')
    const entries = Object.entries(tokens)
    const chunks = old?.chunks || []
    for (let offset = 0; offset < entries.length; offset += 16) {
      const chunkTokens = Object.fromEntries(entries.slice(offset, offset + 16))
      const value = JSON.stringify(chunkTokens)
      const index = offset / 16
      if (!clear && chunks[index]?.value === value && now - chunks[index].at < 4000) continue
      const budget = deadline - Date.now()
      if (budget <= 0) throw new Error('renderer publication budget exhausted')
      await call(socketPath, { id: `mh-render:${item.workspaceId}:${offset}`, method: 'workspace.report_metadata', params: {
        workspace_id: item.workspaceId, source: RENDERER_SOURCE, tokens: chunkTokens, ttl_ms: 10000
      } }, budget)
      chunks[index] = { value, at: now }
      published.set(item.workspaceId, { chunks })
    }
    published.set(item.workspaceId, { value: serialized, at: now, chunks })
  }
}
