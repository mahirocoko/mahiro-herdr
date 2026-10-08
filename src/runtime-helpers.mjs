import { spawnSync } from 'node:child_process'
import { resolve } from 'node:path'

export const MAX_OUTPUT_BYTES = 256 * 1024
export const COMMAND_TIMEOUT_MS = 5 * 1000
export const INVOCATION_DEADLINE_MS = 30 * 1000
export const MAX_U64 = (1n << 64n) - 1n

const stripExtendedPath = value => {
  if (typeof value !== 'string') return value
  if (value.startsWith('\\\\?\\UNC\\')) return `\\\\${value.slice('\\\\?\\UNC\\'.length)}`
  if (value.startsWith('\\\\?\\')) return value.slice(4)
  return value
}

export function samePath(left, right) {
  const resolvedLeft = resolve(stripExtendedPath(left))
  const resolvedRight = resolve(stripExtendedPath(right))
  return process.platform === 'win32' ? resolvedLeft.toLowerCase() === resolvedRight.toLowerCase() : resolvedLeft === resolvedRight
}

export function privateDirectory(stat) {
  if (!stat.isDirectory() || stat.isSymbolicLink()) return false
  if (process.platform === 'win32') return true
  return (stat.mode & 0o077) === 0
}

export function sameFileMode(actual, expected, exists) {
  if (process.platform === 'win32') return true
  return !exists || actual === expected
}

export function sanitizeToken(value) {
  const clean = String(value)
    .replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
  return Array.from(clean).slice(0, 80).join('')
}

export function observeSequence() {
  const value = process.hrtime.bigint()
  if (value < 0n || value > MAX_U64) throw new Error('system monotonic sequence is outside Herdr u64 range')
  return value.toString()
}

export function commandInvocation(bin, args) {
  if (process.platform === 'win32' && typeof bin === 'string' && /\.mjs$/iu.test(bin)) return { file: process.execPath, args: [bin, ...args] }
  return { file: bin, args }
}

export function runHerdr(env, args, options = {}) {
  const clock = options.clock || Date.now
  const deadline = options.deadline ?? clock() + INVOCATION_DEADLINE_MS
  const remaining = Math.floor(deadline - clock())
  if (remaining <= 0) throw new Error('invocation deadline exhausted before Herdr command')
  const command = commandInvocation(env.HERDR_BIN_PATH || 'herdr', args)
  const result = spawnSync(command.file, command.args, {
    encoding: 'utf8',
    env,
    timeout: Math.min(COMMAND_TIMEOUT_MS, remaining),
    killSignal: 'SIGKILL',
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true
  })
  if (result.error) throw new Error(`herdr ${args.slice(0, 2).join(' ')} failed: ${result.error.code || result.error.message}`)
  if (result.status !== 0) throw new Error(`herdr ${args.slice(0, 2).join(' ')} failed: ${sanitizeToken(result.stderr).slice(0, 200)}`)
  return result.stdout
}
