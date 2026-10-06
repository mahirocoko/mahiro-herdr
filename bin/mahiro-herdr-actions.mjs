#!/usr/bin/env node

import {
  manageProjectActions,
  pickerInput,
  saveProjectActions
} from '../src/project-action-manager.mjs'
import {
  callerProject,
  herdrClient,
  launchProjectAction,
  nativeActionContext,
  openProjectPicker,
  readProjectCatalog
} from '../src/project-actions.mjs'
import { createTerminalStyle } from '../src/terminal-style.mjs'

const style = createTerminalStyle()

try {
  const call = herdrClient(process.env)
  const args = process.argv.slice(2)
  if (
    args.length > 1 ||
    (args[0]?.startsWith('--') &&
      !['--list', '--open-native', '--manage'].includes(args[0]))
  ) {
    throw new Error(
      'usage: mahiro-herdr-actions.mjs [--list|--manage|--open-native|action-id]'
    )
  }
  const native =
    args[0] === '--open-native' ||
    process.env.HERDR_PLUGIN_ENTRYPOINT_ID === 'project-actions-picker'
  const context = await (native ? nativeActionContext : callerProject)(
    process.env,
    call
  )
  let catalog = await readProjectCatalog(context.project)
  if (args[0] === '--open-native') {
    if (process.env.HERDR_PLUGIN_ACTION_ID !== 'project-actions')
      throw new Error('Native opener requires its declared plugin action')
    console.log(JSON.stringify(openProjectPicker(context, call)))
  } else if (args[0] === '--list') {
    console.log(
      JSON.stringify({ ...context, actions: catalog.actions }, null, 2)
    )
  } else {
    let action = catalog.actions.find((item) => item.id === args[0])
    if (!args.length || args[0] === '--manage') {
      if (!process.stdin.isTTY || !process.stdout.isTTY)
        throw new Error(
          'Picker requires an interactive terminal; or pass an action ID'
        )
      const input = pickerInput()
      const manage = () =>
        manageProjectActions(context.project, input, catalog, {
          style,
          save: async (project, expectedBytes, actions) => {
            const current = await (
              native ? nativeActionContext : callerProject
            )(process.env, call)
            if (
              current.project !== context.project ||
              current.workspaceId !== context.workspaceId ||
              current.callerPaneId !== context.callerPaneId
            )
              throw new Error('Caller project/workspace changed; reopen Manage')
            return saveProjectActions(project, expectedBytes, actions)
          }
        })
      try {
        if (args[0] === '--manage') {
          await manage()
          process.exitCode = 0
        } else {
          while (!action) {
            console.log(
              `\n${style.heading('Project actions')} ${style.muted(`· ${context.project}`)}\n`
            )
            catalog.actions.forEach((item, index) =>
              console.log(
                `${style.accent(`${index + 1}.`)} ${item.title}  ${style.muted(JSON.stringify(item.argv))}`
              )
            )
            if (!catalog.actions.length)
              console.log(
                `${style.muted('No actions yet.')} Press ${style.accent('M')} to add your first action.`
              )
            const answer = (
              await input.ask(
                `\nChoose number · ${style.accent('M')} Manage · ${style.muted('Esc/empty Enter cancel')}: `
              )
            )?.trim()
            if (!answer) break
            if (answer.toLowerCase() === 'm') {
              catalog = await manage()
              continue
            }
            if (/^[1-9][0-9]*$/.test(answer))
              action = catalog.actions[Number(answer) - 1]
            if (!action) console.log('Choose a listed number or M')
          }
        }
      } finally {
        input.close()
      }
    }
    if (action)
      console.log(
        JSON.stringify(await launchProjectAction(context, action, call))
      )
    else if (args.length && args[0] !== '--manage')
      throw new Error('Unknown project action')
  }
} catch (error) {
  console.error(
    createTerminalStyle(process.stderr).danger(
      `mahiro-herdr-actions: ${error.message}`
    )
  )
  if (
    process.env.HERDR_PLUGIN_ENTRYPOINT_ID === 'project-actions-picker' &&
    process.stdin.isTTY
  ) {
    const input = pickerInput()
    try {
      await input.ask('\nEnter/Esc to close without retrying: ')
    } finally {
      input.close()
    }
  }
  process.exitCode = 1
}
