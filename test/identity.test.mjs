import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

import { SOURCE } from '../src/core.mjs'
import { WORKSPACE_SOURCE } from '../src/workspace-metadata.mjs'

test('Mahiro Herdr display rename preserves installed ownership and producer contracts', async () => {
  const root = new URL('../', import.meta.url)
  const manifest = await readFile(new URL('herdr-plugin.toml', root), 'utf8')
  const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'))
  assert.equal(pkg.name, 'mahiro-herdr')
  assert.equal(pkg.private, true)
  assert.match(manifest, /^name = "Mahiro Herdr"$/m)
  assert.match(manifest, /^id = "mahiro-herdr-sidebar"$/m)
  assert.equal(SOURCE, 'mahiro-herdr-sidebar.usage')
  assert.equal(WORKSPACE_SOURCE, 'mahiro-herdr-sidebar.workspace')
  assert.match(manifest, /bin\/mahiro-herdr-sidebar\.mjs/)
  const workflows = await readFile(new URL('src/workflows.mjs', root), 'utf8')
  assert.match(workflows, /const PLUGIN_ID = 'mahiro-herdr-sidebar'/)
  assert.equal(
    pkg.repository.url,
    'git+https://github.com/mahirocoko/mahiro-herdr-sidebar.git',
  )
})
