import { createHash, randomUUID } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { chmod, copyFile, lstat, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensureRendererRoot, rejectSymlinkAncestors } from './renderer-runtime.mjs'

const FONT_SOURCE = fileURLToPath(new URL('../assets/agent-icons/MahiroHerdrAgentIcons-Regular.ttf', import.meta.url))
const MAP = '# mahiro-herdr:font-begin\nfont-codepoint-map = U+E1A0-U+E1BB=Mahiro Herdr Agent Icons\n# mahiro-herdr:font-end\n'
const PREVIOUS_MAP = '# mahiro-herdr:font-begin\nfont-codepoint-map = U+E1A0-U+E1BA=Herdr Agent Icons Max\n# mahiro-herdr:font-end\n'

const safeFile = async path => {
  const stat = await lstat(path)
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 256 * 1024) throw new Error('unsafe renderer font/config file')
  return stat
}

const atomic = async (path, bytes, mode) => {
  const tmp = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(tmp, bytes, { flag: 'wx', mode })
    await chmod(tmp, mode)
    await rename(tmp, path)
  } finally { await rm(tmp, { force: true }) }
}

const withFontLock = async (env, action) => {
  const root = await ensureRendererRoot(env)
  const lock = join(root, 'font.lock')
  await mkdir(lock, { mode: 0o700 }) // Exclusive; no stale/ambiguous-owner takeover.
  try { return await action() }
  finally { await rm(lock, { recursive: true }) }
}

const installFont = async (env, { platform = process.platform, validate } = {}) => {
  if (platform !== 'darwin') throw new Error('automatic icon-font mapping currently supports macOS Ghostty only')
  const root = await ensureRendererRoot(env)
  const config = join(env.HOME, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
  await rejectSymlinkAncestors(config)
  const stat = await safeFile(config)
  const current = await readFile(config)
  const snapshotPath = join(root, 'font-config.json')
  const existing = await lstat(snapshotPath).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  let saved
  if (existing) {
    await safeFile(snapshotPath)
    saved = JSON.parse(await readFile(snapshotPath, 'utf8'))
    const known = [saved.original, saved.applied, saved.previousApplied].filter(Boolean).map(value => Buffer.from(value, 'base64'))
    if (saved.path !== config || !known.some(bytes => current.equals(bytes))) throw new Error('renderer font config drifted')
    const applied = Buffer.from(saved.applied, 'base64').toString('utf8')
    if (!applied.includes(MAP)) {
      if (applied.split(PREVIOUS_MAP).length !== 2) throw new Error('unknown renderer font mapping generation')
      saved.previousApplied = saved.applied
      saved.applied = Buffer.from(applied.replace(PREVIOUS_MAP, MAP)).toString('base64')
    }
  } else {
    const text = current.toString('utf8')
    if (/mahiro-herdr:font|font-codepoint-map[^\n]*E1[A-C]/iu.test(text)) throw new Error('conflicting icon font mapping')
    saved = { path: config, mode: stat.mode & 0o777, original: current.toString('base64'), applied: Buffer.from(text + (text.endsWith('\n') ? '' : '\n') + MAP).toString('base64') }
  }
  const candidate = join(root, `ghostty-check-${randomUUID()}.conf`)
  try {
    await writeFile(candidate, Buffer.from(saved.applied, 'base64'), { flag: 'wx', mode: 0o600 })
    if (validate) await validate(candidate)
    else {
      const result = spawnSync('/Applications/Ghostty.app/Contents/MacOS/ghostty', ['+validate-config', `--config-file=${candidate}`], {
        env, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024
      })
      if (result.error || result.status !== 0 || result.stdout?.trim() || result.stderr?.trim()) throw new Error('Ghostty font mapping validation failed')
    }
  } finally { await rm(candidate, { force: true }) }
  const bytes = await readFile(FONT_SOURCE)
  const digest = createHash('sha256').update(bytes).digest('hex')
  const dir = join(env.HOME, 'Library', 'Fonts')
  await rejectSymlinkAncestors(dir)
  await mkdir(dir, { recursive: true })
  if ((await lstat(dir)).isSymbolicLink()) throw new Error('font directory is a symlink')
  const target = join(dir, `MahiroHerdrAgentIcons-${digest.slice(0, 8)}.ttf`)
  const installed = await lstat(target).catch(error => { if (error.code !== 'ENOENT') throw error; return null })
  if (installed) {
    await safeFile(target)
    if (!(await readFile(target)).equals(bytes)) throw new Error('installed renderer font hash mismatch')
  } else await copyFile(FONT_SOURCE, target, 1)
  if (!(await readFile(config)).equals(current)) throw new Error('font config changed during install')
  await atomic(snapshotPath, Buffer.from(JSON.stringify(saved)), 0o600)
  if (!current.equals(Buffer.from(saved.applied, 'base64'))) await atomic(config, Buffer.from(saved.applied, 'base64'), saved.mode)
  delete saved.previousApplied
  await atomic(snapshotPath, Buffer.from(JSON.stringify(saved)), 0o600)
  await atomic(join(root, 'font-ready'), Buffer.from('1\n'), 0o600)
  return { installed: true, hash: digest, requiresTerminalReload: true }
}

const restoreFont = async env => {
  const root = await ensureRendererRoot(env)
  const path = join(root, 'font-config.json')
  try { await safeFile(path) } catch (error) { if (error.code === 'ENOENT') return false; throw error }
  const saved = JSON.parse(await readFile(path, 'utf8'))
  const expected = join(env.HOME, 'Library', 'Application Support', 'com.mitchellh.ghostty', 'config')
  if (saved.path !== expected) throw new Error('font recovery path mismatch')
  await rejectSymlinkAncestors(saved.path)
  await safeFile(saved.path)
  const current = await readFile(saved.path)
  const original = Buffer.from(saved.original, 'base64')
  const known = [saved.applied, saved.previousApplied, saved.original].filter(Boolean).map(value => Buffer.from(value, 'base64'))
  if (!known.some(bytes => current.equals(bytes))) throw new Error('font recovery refuses config drift')
  await atomic(saved.path, original, saved.mode)
  await rm(path)
  await rm(join(root, 'font-ready'), { force: true })
  // Retain the shared font file; another terminal/app may have started using it.
  return true
}

export const installRendererFont = (env = process.env, options = {}) => withFontLock(env, () => installFont(env, options))
export const restoreRendererFont = (env = process.env) => withFontLock(env, () => restoreFont(env))
