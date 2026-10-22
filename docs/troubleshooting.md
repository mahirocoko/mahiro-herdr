# Troubleshooting

[Back to README](../README.md)

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

## Configuration safety and recovery

Configuration changes preserve exact original/applied snapshots, use owner locks,
and reject drift, path mismatches or ambiguous registry roots. Failed operations
restore captured state only where ownership remains safe.

On a failed install or uninstall, read the complete error before retrying. Do not delete the plugin config directory or snapshot evidence. Resolve registry-root conflicts by running the script from the checkout shown by `herdr plugin list --json`. Resolve config drift manually before retrying; the adapter will not overwrite an unknown sidebar owner. A metadata-clear failure is non-destructive because Herdr TTL remains the fallback.

