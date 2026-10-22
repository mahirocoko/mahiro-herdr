# Mahiro Herdr

MIT-licensed Herdr integration that projects normalized usage into Agents, shows per-agent status/icons beneath Spaces, publishes workspace Git metadata and macOS listening ports, and provides an optional Agy statusline quota producer. It uses Node.js built-ins only, has no runtime package dependencies, and does not contact providers.

### Existing installations

**Upgrade from v0.5.0 or earlier:** while the old installation and source are still intact, run `herdr plugin uninstall mahiro-herdr-sidebar` to restore its owned configuration and clear old metadata, then install/configure the new plugin using the commands below. Back up config and verify recovery first; do not relabel the old snapshot or run both plugin IDs concurrently. Update custom keybindings, snapshot overrides (`MAHIRO_HERDR_SNAPSHOT`) and Agy producer import paths to the new identity. Mahiro Mods must also be updated and reloaded. Preserve unrelated config, caches and custom statusline output. The GitHub redirect is not a runtime plugin-ID migration.

The package remains `private: true` to prevent accidental npm publication. Distribution uses Herdr's GitHub plugin installer or a local Git clone; this project is not distributed through npm.

## Prerequisites and support boundary

- [Herdr](https://herdr.dev) 0.9.3 or newer for the current native project-action manifest
- Node.js 22 or newer
- macOS or Linux
- An external cache producer that implements the open adapter protocol, the optional native Agy statusline producer module, or the workspace metadata bridge
- For Codex rows, an external pane-token producer that identifies eligible panes

The source and isolated test suite support macOS and Linux. Listening TCP ports inspection is macOS-only; Linux clears that row while retaining Git/quota behavior. Mahiro has verified installation, configuration, events, refresh, and metadata behavior with Herdr 0.9.0 on macOS. GitHub Actions runs isolated Node 22 tests on `macos-latest` and `ubuntu-latest` only when a GitHub release is published, not on pushes or pull requests; that Linux check does not claim live Herdr runtime integration.

## Install

For a released public version:

```sh
herdr plugin install mahirocoko/mahiro-herdr --ref v0.7.3
herdr plugin action invoke configure --plugin mahiro-herdr
```

**Agent logos need a separate font step.** Normal install/configure starts the
renderer but does not modify terminal configuration. Without the icon font,
`⊙` / `◈` plus readable agent names are intentional fallback, not vendor logos.

For **macOS + Ghostty**, explicitly install the bundled font/mapping:

```sh
herdr plugin action invoke renderer-font --plugin mahiro-herdr
```

Then use **Reload Configuration** in Ghostty. Automatic mapping currently
requires an existing standard macOS Ghostty config. Linux/other terminal setup is
not supported by this action. Without font setup the renderer uses generic
fallback; after setup, each terminal displaying the shared Herdr session must
resolve the custom glyphs itself—configuring Ghostty does not configure another
terminal client.

The font action restarts the renderer automatically to load the mapping.

If the entire agent row is missing, including loading/status, see
[Troubleshooting](#troubleshooting). Squares or missing logo glyphs with working
status instead point to terminal font configuration/reload.

To remove that installation, use Herdr's owning uninstall flow. Its manifest action restores the saved sidebar configuration before Herdr removes the plugin:

```sh
herdr plugin uninstall mahiro-herdr
```

For local development or an unreleased checkout:

```sh
git clone https://github.com/mahirocoko/mahiro-herdr.git
cd mahiro-herdr
npm run check
./install.sh
```

The installer checks the JSON plugin registry, refuses the same plugin ID at another or ambiguous root, links a new checkout disabled, configures and reloads Herdr, then enables the plugin. Re-running it from the registered checkout is supported. Reinstall failure restores the exact captured pre-operation config and enabled state when ownership evidence remains safe.

The plugin's Herdr uninstall action is intentionally restore-only because a running plugin must not unlink itself. To fully uninstall a locally linked development checkout, run:

```sh
./uninstall.sh
```

The uninstall script passes its invoking checkout root to the workflow. Before disabling or changing configuration, the workflow verifies that Herdr's single same-ID registration resolves exactly to that root. This prevents an old clone from uninstalling a newer registration.

## Troubleshooting

For missing Space agent rows, inspect plugin errors and try the existing updater
action from a terminal inside the affected Herdr session:

```sh
herdr plugin log list --plugin mahiro-herdr --limit 10
herdr plugin action invoke renderer-start --plugin mahiro-herdr
```

The start action reuses a healthy updater. If it fails, inspect the error rather
than repeatedly running Configure or reinstalling fonts.

### `ECONNREFUSED` on `renderer/control.sock`

The renderer can stop without removing its Unix socket. The file remains but no
process accepts connections. Current startup rejects that endpoint instead of
reclaiming it automatically, so startup, Configure and the font action can all
fail with the same error. This explains missing icons/loading, not why the
original process stopped.

To recover without restarting Herdr:

1. Run `herdr plugin list --plugin mahiro-herdr --json` and change directory to
   the exact `plugin_root`. Check renderer health:

   ```sh
   node bin/mahiro-herdr-renderer.mjs status
   ```

2. Only for that exact `ECONNREFUSED` error, locate the socket and check for a
   holder or renderer still starting. Do not run concurrent start/font/configure
   actions during recovery.

   ```sh
   config_dir="$(herdr plugin config-dir mahiro-herdr)"
   socket="$config_dir/renderer/control.sock"
   ls -ld "$config_dir/renderer" "$socket"
   lsof -n -U | grep -F -- "$socket"
   ps -axo pid,ppid,args | grep '[m]ahiro-herdr-renderer.mjs'
   ```

3. Continue only if the path matches the error, the directory/socket belong to
   your user and are not symlinks, no process holds the socket, and no renderer
   is running or starting. Repeat the status check immediately before removal;
   it must still return `ECONNREFUSED`. If ownership is ambiguous, stop.

   ```sh
   node bin/mahiro-herdr-renderer.mjs status
   # Only after confirming the checks above:
   test ! -L "$socket" && test -S "$socket" && rm -- "$socket"
   herdr plugin action invoke renderer-start --plugin mahiro-herdr
   ```

4. After startup, check status again: expect `ready: true` and `lastError: null`.
   Confirm icons and changing loading frames on a working agent in Spaces;
   idle agents should not spin.

Remove **only the confirmed stale socket**, never the renderer/config directory,
Done state, font markers or recovery snapshots. Do not kill processes or remove
endpoints based on age. Timeout, permission and foreign-endpoint errors do not
prove abandonment. This is manual recovery, not an automatic-recovery code fix.

## Project actions

Project quick actions use a terminal picker, not a native right-click menu.
From a Herdr terminal in the target project, run:

```sh
herdr plugin action invoke project-actions --plugin mahiro-herdr
```

Choose a project-owned action. The launcher opens a new tab in the caller's same
workspace, runs the configured argv from the project root, focuses the new tab,
and retains it after completion. It never submits commands to the caller's
existing terminal. Enter on an empty picker answer cancels without creating a tab.
Escape also cancels the picker. Press **M** for Manage: **A** adds, **E** edits a
listed action's title/command, **D** deletes with explicit `yes` confirmation,
and **B** returns to the picker. Escape cancels an unfinished draft; no save or
command execution occurs. Add/Edit also show the exact argv and require `yes`
before saving. IDs stay stable on edits. Commands accept executable arguments
with quoted values, not shell pipes, redirects or variable expansion.
Projects without a catalog show an empty state and let Manage create their first
action. A concurrent file edit refuses to overwrite it; reopen the picker to
load the new state. The editor is terminal UI, not a native graphical editor.
For inspection only, use `node bin/mahiro-herdr-actions.mjs --list`; an explicit
action ID such as `check` skips the picker but still validates the target.
`node bin/mahiro-herdr-actions.mjs --manage` opens Manage directly.

The project owns its `.herdr-actions.json` file. Use version `1` and an `actions`
array containing unique `id`, readable `title`, and non-empty `argv` arrays.
Commands are trusted executable configuration, not downloaded suggestions.
No Dev/Build command is invented for this repo, and there is no native
per-workspace action editor yet.
Launching can succeed before a response is lost: if an error names a retained
tab/pane, inspect that exact target before retrying; the prototype never retries
or closes tabs automatically. See the integration protocol for the native boundary.

## Integration boundaries

The components have separate owners:

1. **Read-only Herdr Adapter (`src/core.mjs`)**: The core plugin runtime. It reads normalized `codex.json`, `agy.json`, and `cursor.json` cache files and projects them into Herdr agent sidebar rows. It never writes to cache files, never collects provider data, and makes no network requests.
2. **Optional Agy Statusline Quota Producer (`src/agy-statusline-producer.mjs`)**: An opt-in helper module for Agy CLI users. It consumes already-delivered statusline payloads, normalizes the quota map, and publishes snapshots atomically to `agy.json`. It never reads credentials, email, plan tier, transcripts, sessions, or raw provider payloads, never invokes `agy -p`, and makes no network requests.
3. **Workspace Metadata Bridge (`src/workspace-metadata.mjs`, v0.4.0+)**: A focused module publishing a bounded, allowlisted cross-client projection of Git and listening port metadata for Herdr Web and sidebar display without replacing native Space rendering. It observes `herdr api snapshot`, inspects Git repository evidence deterministically, collects listening TCP ports per Space via bounded one-shot process-tree attribution (`lsof` + `ps` on macOS), and reports workspace metadata (`mahiro_workspace_branch`, `mahiro_workspace_git_status`, `mahiro_workspace_worktree`, `mahiro_workspace_ports`) via `herdr workspace report-metadata`.

4. **Space Agent Renderer (`src/agent-renderer.mjs`, `src/renderer-runtime.mjs`)**: Each agent gets one status/icon/name row beneath the native Space name. Empty rows collapse; eight slots preserve native order, with an overflow count. Native highlight, branch/Git/ports and Agents remain unchanged. Metadata expires after ten seconds; animation runs nominally every 250 ms. No lifecycle/history/theme/order changes.

### Renderer lifecycle and optional font

Live configure and startup start the updater. `renderer-start` and `renderer-stop` are native actions. Stopping hides renderer-owned state marks and logos after token expiry, not the native Space name/branch/Git status/ports or Agents panel. Unknown/stale control endpoints are reported, never force-reclaimed by guessed PID or age.

Font changes preserve exact original/applied recovery and reject drift. Font
licenses and provenance are under `assets/agent-icons`. Installation alone does
not prove terminal rendering; reload and inspect the actual glyphs.

## Open adapter inputs

By default, the adapter reads:

- `~/.letta/mods/mahiro-usage/codex.json`
- `~/.letta/mods/mahiro-usage/agy.json`
- `~/.letta/mods/mahiro-usage/cursor.json`

The default preserves compatibility with [Mahiro Mods v0.10.0+](https://github.com/mahirocoko/mods/releases/tag/v0.10.0), the reference producer for model/context/provider metadata and the normalized Codex cache. Agy quota now comes from the optional Agy statusline producer below or another external producer. To use another cache root, set `MAHIRO_HERDR_USAGE_CACHE_DIR` to a non-empty absolute directory path in the environments that launch both the producer and Herdr server; plugin actions and events inherit it. Relative or empty overrides fail closed.

External producers own their collection and normalization. The optional Agy helper owns only normalization and publication of the already-delivered statusline `quota` map. Agent Halo is the canonical trusted Cursor collector and publishes only normalized `Auto` and `API` windows to `cursor.json`; this adapter does not duplicate its credential or provider-network logic. The adapter only reads bounded normalized JSON and never reads credentials or raw provider payloads. Codex sidebar projection requires an exact inventory pair: `agent=letta` with `mahiro_sidebar_provider=openai-codex`, or `agent=pi` with `mahiro_sidebar_provider=openai`. Agent integrations publish and own model/context/provider tokens (Mahiro Mods for Letta, mahiro-pi for Pi); the adapter never changes them. Both eligible pairs display the same shared Codex account cache with existing `Codex 5h` / `Codex 7d` labels, colors, order and expiry. This is not Pi-native quota, session attribution or proof of matching authentication; Pi's footer still omits quota. Pi `openai-codex`, other providers and model-name inference are excluded. Agy values are labeled `Agy shared pools` because they are account-level shared pools, not active-session attribution. Cursor values are labeled `Cursor auto` and `Cursor api` on live `cursor` panes.

Codex and Agy snapshots remain usable for five minutes. Cursor snapshots remain usable for 65 minutes, covering Agent Halo's configurable maximum 60-minute usage refresh cadence plus delivery headroom while its desktop renderer is running, without adding another poller. If Agent Halo is not running or refresh fails, the cache expires and Cursor rows clear.

Cursor quota support requires Mahiro Herdr v0.5.0+ (released under the Mahiro Herdr Sidebar name) and Agent Halo v0.1.15+ as the trusted producer.

See [Open adapter integration protocol](docs/integration.md) for the exact JSON schema, milliseconds/percentage units, accepted labels, freshness and reset margins, pane-token contract, and fail-closed rules.

## Optional Agy statusline producer

For Agy CLI 1.2.2+ quota payloads, call the helper from your existing statusline
script. It normalizes only the supported quota buckets and publishes atomically;
absent/invalid quota leaves the cache unchanged. Keep your rendered output:

```javascript
import { publishAgyStatusline } from '/absolute/path/to/mahiro-herdr/src/agy-statusline-producer.mjs'

// Receive payload from Agy CLI via stdin:
const payload = JSON.parse(stdinText)

// Finish publication before a one-shot statusline process exits.
// Failure stays isolated from the rendered statusline.
await publishAgyStatusline(payload).catch(() => null)

// Render custom statusline text to stdout:
process.stdout.write(renderStatusLine(payload))
```

## Metadata refresh

Quota/Git/ports refreshes are one-shot on startup, manual refresh or exact pane
events, separate from the resident animation updater. The adapter preserves
agent-owned model/context/provider tokens. For a manual metadata refresh:

```sh
herdr plugin action invoke refresh --plugin mahiro-herdr
```

See the [integration protocol](docs/integration.md) for limits, timing and ownership.

## Configuration safety and recovery

Configuration changes preserve exact original/applied snapshots, use owner locks,
and reject drift, path mismatches or ambiguous registry roots. Failed operations
restore captured state only where ownership remains safe.

On a failed install or uninstall, read the complete error before retrying. Do not delete the plugin config directory or snapshot evidence. Resolve registry-root conflicts by running the script from the checkout shown by `herdr plugin list --json`. Resolve config drift manually before retrying; the adapter will not overwrite an unknown sidebar owner. A metadata-clear failure is non-destructive because Herdr TTL remains the fallback.

## Privacy and security model

The adapter reads bounded normalized caches and local inventory, not credentials,
pane contents or history. External collectors retain their own trust boundaries.
Keep caches user-readable only and never put credentials or raw provider responses
in normalized files. No secrets are required by the adapter or CI.

## Development

```sh
npm test
npm run check
bash -n install.sh uninstall.sh
git diff --check
```

Tests isolate HOME, cache, Herdr configuration, and a stub Herdr executable. They do not mutate a live Herdr installation.

The design was informed by `levi-qiao/herdr-agent-quota` at reviewed commit `0540feb1d51bb7618f94f02aa804493614b1ba0d`; no claim is made that its source was copied.
