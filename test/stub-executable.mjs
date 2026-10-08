import { chmod, writeFile } from 'node:fs/promises'

export const writeNodeStub = async (path, source) => {
  const body = source.replace(/^#![^\n]*\n/u, '')
  if (process.platform !== 'win32') {
    const program = source.startsWith('#!') ? source : `#!/usr/bin/env node\n${body}`
    await writeFile(path, program)
    await chmod(path, 0o755)
    return path
  }
  const script = path.endsWith('.mjs') ? path : `${path}.mjs`
  await writeFile(script, body)
  return script
}
