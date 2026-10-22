# Mahiro Herdr

Agent status, usage and project shortcuts for [Herdr](https://herdr.dev).

- **Spaces:** per-agent status and icons, Git branch and clean/dirty state, plus listening ports on macOS.
- **Agents:** account usage from supported external cache producers.
- **Project actions:** a terminal picker that runs your project's saved commands in new tabs.

Requires **Herdr 0.9.3+** and **Node.js 22+**. No runtime package dependencies or provider requests.

## Install

```sh
herdr plugin install mahirocoko/mahiro-herdr --ref v0.8.0
herdr plugin action invoke configure --plugin mahiro-herdr
```

Configure applies the sidebar layout and starts the Space status updater. Usage
rows need a separate data source; see [Usage data](#usage-data).

> Upgrading from `mahiro-herdr-sidebar` (v0.5.0 or earlier)? Follow the
> [migration steps](docs/local-setup.md#upgrading-from-the-old-plugin-identity)
> before installing. Do not run both plugin IDs together.

### Platforms

| Feature | macOS | Linux | Windows |
| --- | --- | --- | --- |
| Agent status, Git metadata and usage rows | Yes | Yes | Yes |
| Project actions | Yes | Yes | Yes |
| Listening ports | Yes | — | — |
| Automatic logo font setup | Ghostty only | — | — |

Live Herdr installation has been verified on macOS. Linux and Windows runtime
integration is not fully verified; isolated tests do not establish live support.
Release CI runs Node 22 checks on all three platforms.

### Optional agent logos

Without font setup, agent names appear with generic symbols such as `⊙` and `◈`.
This is expected. Normal installation does not change terminal fonts.

For **macOS + Ghostty** with an existing standard Ghostty config:

```sh
herdr plugin action invoke renderer-font --plugin mahiro-herdr
```

Then choose **Reload Configuration** in Ghostty. The action installs the bundled
font/mapping and restarts the updater. Other terminals keep the generic fallback;
each terminal client must resolve any custom glyphs itself.

## Use

### Project actions

From a Herdr terminal in your project:

```sh
herdr plugin action invoke project-actions --plugin mahiro-herdr
```

Choose an action to run it in a **new tab in the same workspace**. Commands never
run in the picker or your existing terminal, and the new tab stays open afterward.

Press **M** to manage actions: add, edit or delete, then confirm changes with `yes`.
Press **Escape** to cancel. Projects start empty; no commands are inferred for you.

Actions live in `.herdr-actions.json` at the Git project root:

```json
{
  "version": 1,
  "actions": [
    { "id": "check", "title": "Run checks", "argv": ["npm", "run", "check"] }
  ]
}
```

Replace the example with commands your project actually supports. The file is
executable project configuration: trust it before running actions, and never put
credentials in arguments. Commands use explicit argv, not pipes, redirects or
variable expansion. Unsupported shells or arguments are rejected without sending
a command; see [shell restrictions](docs/integration.md#native-command-audit-2026-10-06).

If an error names a retained tab/pane, inspect it before retrying: submission may
have succeeded even if its response was lost.

### Refresh metadata

Git and usage metadata refresh on startup, manual refresh and relevant pane events.
Listening ports are not continuously tracked. To refresh manually:

```sh
herdr plugin action invoke refresh --plugin mahiro-herdr
```

The Space animation updater runs separately. You can control it with the
`renderer-start` and `renderer-stop` actions.

## Usage data

The plugin displays normalized caches; it does not collect account usage itself.
Installing it alone does not enable quota rows.

| Data | Source |
| --- | --- |
| Codex shared account usage | An external producer, such as [Mahiro Mods](https://github.com/mahirocoko/mods) |
| Agy shared pools | The optional [Agy statusline helper](docs/integration.md#agy-statusline-quota-producer-v030) or another compatible producer |
| Cursor Auto / API usage | Agent Halo |

By default, cache files are `codex.json`, `agy.json` and `cursor.json` under
`~/.letta/mods/mahiro-usage`. To use another location, set
`MAHIRO_HERDR_USAGE_CACHE_DIR` to the same absolute directory for both the producer
and the Herdr server.

Codex rows require eligible Letta or Pi provider tokens from their agent
integration. They show **shared account usage**, not session-specific or Pi-native
quota. Model/context/provider tokens remain owned by the agent integrations.

Codex and Agy caches expire after five minutes; Cursor after 65 minutes. Missing,
invalid or expired data clears the corresponding rows. See the
[integration protocol](docs/integration.md) for exact eligibility and cache formats.

## Troubleshooting and removal

Missing Space rows? From a terminal inside the affected Herdr session:

```sh
herdr plugin log list --plugin mahiro-herdr --limit 10
herdr plugin action invoke renderer-start --plugin mahiro-herdr
```

If startup fails, inspect the error instead of repeatedly configuring or
reinstalling fonts. Working status with missing/square logo glyphs usually points
to terminal font configuration. For stale sockets and configuration recovery,
follow [Troubleshooting](docs/troubleshooting.md). Do not delete config directories
or recovery snapshots to clear an error.

To remove a GitHub-installed plugin and restore its saved sidebar configuration:

```sh
herdr plugin uninstall mahiro-herdr
```

For a locally linked checkout, use its uninstall script instead. See
[local installation and migration](docs/local-setup.md).

## Development

See [local setup](docs/local-setup.md) to link a checkout. Run checks with:

```sh
npm run check
```

Tests isolate HOME, caches and Herdr configuration, using a stub Herdr executable.
CI runs **only when a GitHub release is published**, not on pushes or pull requests.

## Privacy and license

The adapter reads normalized caches and local inventory, not credentials, pane
contents or history. External collectors have their own trust boundaries. Keep
caches user-readable only; never store raw provider responses or secrets in them.
Configuration changes preserve recovery snapshots and refuse ambiguous ownership
or unexpected drift.

[MIT](LICENSE). Font licenses and provenance are in
[`assets/agent-icons`](assets/agent-icons). The design was informed by
`levi-qiao/herdr-agent-quota` at commit `0540feb1d51bb7618f94f02aa804493614b1ba0d`;
this is not a claim that its source was copied.
