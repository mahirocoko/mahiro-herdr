#!/usr/bin/env node
import { rendererStatus, runRenderer, startRenderer, stopRenderer } from '../src/renderer-runtime.mjs'
import { setupRendererFont, restoreRendererFont } from '../src/renderer-font.mjs'

try {
  const command = process.argv[2]
  if (command === 'run') await runRenderer()
  else if (command === 'start') console.log(JSON.stringify(await startRenderer()))
  else if (command === 'stop') console.log(JSON.stringify({ stopped: await stopRenderer() }))
  else if (command === 'status') console.log(JSON.stringify(await rendererStatus()))
  else if (command === 'font-install') console.log(JSON.stringify(await setupRendererFont()))
  else if (command === 'font-restore') console.log(JSON.stringify({ restored: await restoreRendererFont() }))
  else throw new Error('usage: mahiro-herdr-renderer.mjs <start|run|stop|status|font-install|font-restore>')
} catch (error) {
  console.error(`mahiro-herdr renderer: ${error.message}`)
  process.exitCode = 1
}
