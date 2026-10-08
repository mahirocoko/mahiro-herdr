import net from 'node:net'
import { spawn } from 'node:child_process'
import { chmod, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash, randomUUID } from 'node:crypto'
import { localCall, rendererFrame, rendererSocketPath, publishRendererFrame } from './agent-renderer.mjs'
import { privateDirectory } from './runtime-helpers.mjs'

const pluginConfigDir = env => {
  if (env.HERDR_PLUGIN_CONFIG_DIR) return env.HERDR_PLUGIN_CONFIG_DIR
  if (process.platform === 'win32') return join(env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'herdr', 'plugins', 'config', 'mahiro-herdr')
  return join(env.HOME || homedir(), '.config', 'herdr', 'plugins', 'config', 'mahiro-herdr')
}

export const rendererRoot = env => {
  const root = join(pluginConfigDir(env), 'renderer')
  if (!isAbsolute(root)) throw new Error('renderer state root must be absolute')
  return root
}

const pipeEndpoint = path => path.startsWith('\\\\.\\pipe\\') || path.startsWith('\\\\?\\pipe\\')

export const rendererControlPath = env => {
  const root = rendererRoot(env)
  if (process.platform !== 'win32') return join(root, 'control.sock')
  const digest = createHash('sha256').update(resolve(root)).digest('hex').slice(0, 16)
  return `\\\\.\\pipe\\mahiro-herdr-${digest}`
}

export const rejectSymlinkAncestors = async path => {
  let part = path
  while (part !== dirname(part)) {
    try { if ((await lstat(part)).isSymbolicLink()) throw new Error('renderer state ancestor is a symlink') }
    catch (error) { if (error.code !== 'ENOENT') throw error }
    part = dirname(part)
  }
}

export const ensureRendererRoot = async env => {
  const root = rendererRoot(env)
  await rejectSymlinkAncestors(root)
  await mkdir(root, { recursive: true, mode: 0o700 })
  const stat = await lstat(root)
  if (!privateDirectory(stat)) throw new Error('unsafe renderer state directory')
  return root
}

const controlPath = rendererControlPath
const control = (env, command) => localCall(controlPath(env), { id: 'mh-renderer-control', command }, 1500)
const ownedStatus = result => {
  if (result?.owner !== 'mahiro-herdr.renderer' || !Number.isSafeInteger(result.pid)) throw new Error('foreign renderer control endpoint')
  return result
}

export const startRenderer = async (env = process.env) => {
  if (env.HERDR_ENV !== '1') throw new Error('renderer requires Herdr runtime')
  await ensureRendererRoot(env)
  let existing = null
  try { existing = ownedStatus(await control(env, 'status')); if (existing.ready) return existing }
  catch (error) { if (error.code !== 'ENOENT') throw error }
  const entry = fileURLToPath(new URL('../bin/mahiro-herdr-renderer.mjs', import.meta.url))
  if (!existing) {
    const child = spawn(process.execPath, [entry, 'run'], { env, detached: true, stdio: 'ignore', windowsHide: true })
    child.on('error', () => {})
    child.unref()
  }
  for (let attempt = 0; attempt < 25; attempt += 1) {
    await new Promise(resolveWait => setTimeout(resolveWait, 100))
    try { const result = ownedStatus(await control(env, 'status')); if (result.ready) return result }
    catch (error) { if (!['ENOENT', 'ECONNREFUSED'].includes(error.code)) throw error }
  }
  throw new Error('renderer did not become ready; no duplicate launch attempted')
}

export const stopRenderer = async (env = process.env) => {
  try {
    ownedStatus(await control(env, 'status'))
    ownedStatus(await control(env, 'stop'))
    for (let attempt = 0; attempt < 100; attempt += 1) {
      await new Promise(resolveWait => setTimeout(resolveWait, 100))
      try { await control(env, 'status') }
      catch (error) { if (error.code === 'ENOENT') return true; throw error }
    }
    throw new Error('renderer stop did not finish')
  } catch (error) { if (error.code === 'ENOENT') return false; throw error }
}

export const rendererStatus = async (env = process.env) => ownedStatus(await control(env, 'status'))

export const runRenderer = async (env = process.env) => {
  if (env.HERDR_ENV !== '1') throw new Error('renderer requires Herdr runtime')
  const root = await ensureRendererRoot(env)
  const path = controlPath(env)
  // Conservative sockaddr_un budget for supported runtimes, including macOS CI Node22.
  // Newer local OS/Node combinations can accept more; do not rely on that capability.
  const socketByteLimit = process.platform === 'darwin' ? 103 : 107
  if (process.platform !== 'win32' && Buffer.byteLength(path) > socketByteLimit) throw new Error('renderer control socket path exceeds platform byte limit')
  const nonce = randomUUID()
  let stopping = false
  let ready = false
  let snapshot = null
  let states = {}
  let published = new Map()
  let lastSnapshot = 0
  let savedState = ''
  let lastError = null
  const fontPath = join(root, 'font-ready')
  const fontStat = await lstat(fontPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (fontStat && (!fontStat.isFile() || fontStat.isSymbolicLink() || fontStat.size > 8)) throw new Error('unsafe renderer font marker')
  const font = fontStat ? (await readFile(fontPath, 'utf8')).trim() === '1' : false
  const stateFile = join(root, 'done-state.json')
  const stateStat = await lstat(stateFile).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (stateStat) {
    if (!stateStat.isFile() || stateStat.isSymbolicLink() || stateStat.size > 128 * 1024) throw new Error('unsafe renderer Done state')
    try {
      states = JSON.parse(await readFile(stateFile, 'utf8'))
      if (!states || typeof states !== 'object' || Array.isArray(states)) states = {}
    } catch { states = {} }
  }
  const server = net.createServer(socket => {
    let bytes = ''
    socket.setTimeout(1000, () => socket.destroy())
    socket.on('error', () => {})
    socket.on('data', chunk => {
      bytes += chunk
      if (Buffer.byteLength(bytes) > 1024) return socket.destroy()
      if (!bytes.includes('\n')) return
      try {
        const request = JSON.parse(bytes.slice(0, bytes.indexOf('\n')))
        if (request.id !== 'mh-renderer-control' || !['status', 'stop'].includes(request.command)) return socket.destroy()
        const result = { owner: 'mahiro-herdr.renderer', pid: process.pid, nonce, ready, lastError }
        if (request.command === 'stop') stopping = true
        socket.end(JSON.stringify({ id: request.id, result }) + '\n')
      } catch { socket.destroy() }
    })
  })
  await new Promise((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(path, resolveListen)
  })
  if (!pipeEndpoint(path)) await chmod(path, 0o600)
  process.once('SIGTERM', () => { stopping = true })
  process.once('SIGINT', () => { stopping = true })
  const herdrPath = rendererSocketPath(env)
  try {
    while (!stopping) {
      const tick = Date.now()
      try {
        if (tick - lastSnapshot >= 1000 || !snapshot) {
          const result = await localCall(herdrPath, { id: 'mh-renderer-inventory', method: 'session.snapshot', params: {} })
          snapshot = result.snapshot || result
          // Validate before replacing state or treating a failure as disappearance.
          const next = rendererFrame(snapshot, states)
          states = next.states
          const liveWorkspaces = new Set(next.frames.map(frame => frame.workspaceId))
          for (const workspaceId of published.keys()) if (!liveWorkspaces.has(workspaceId)) published.delete(workspaceId)
          lastSnapshot = Date.now()
          const serialized = JSON.stringify(states)
          if (serialized !== savedState) {
            const temporary = `${stateFile}.${nonce}.tmp`
            await writeFile(temporary, serialized, { mode: 0o600, flag: 'wx' })
            await rename(temporary, stateFile)
            savedState = serialized
          }
        }
        const frame = rendererFrame(snapshot, states, { step: Math.floor(tick / 250), font })
        states = frame.states
        await publishRendererFrame(herdrPath, frame, published)
        ready = true
        lastError = null
      } catch (error) {
        ready = false
        lastError = String(error.message).slice(0, 160)
        snapshot = null
        await new Promise(resolveWait => setTimeout(resolveWait, 1000))
      }
      await new Promise(resolveWait => setTimeout(resolveWait, Math.max(50, 250 - (Date.now() - tick))))
    }
  } finally {
    if (snapshot) await publishRendererFrame(herdrPath, rendererFrame(snapshot, states), published, { clear: true }).catch(() => {})
    await new Promise(resolveClose => server.close(resolveClose))
    if (!pipeEndpoint(path)) await rm(path, { force: true })
    // Failed writes expire in ten seconds; never clear another metadata source.
  }
}
