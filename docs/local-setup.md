# Local installation and migration

[Back to README](../README.md)

## Upgrading from the old plugin identity

**Upgrade from v0.5.0 or earlier:** while the old installation and source are still intact, run `herdr plugin uninstall mahiro-herdr-sidebar` to restore its owned configuration and clear old metadata, then install/configure the new plugin using the commands below. Back up config and verify recovery first; do not relabel the old snapshot or run both plugin IDs concurrently. Update custom keybindings, snapshot overrides (`MAHIRO_HERDR_SNAPSHOT`) and Agy producer import paths to the new identity. Mahiro Mods must also be updated and reloaded. Preserve unrelated config, caches and custom statusline output. The GitHub redirect is not a runtime plugin-ID migration.

The package remains `private: true` to prevent accidental npm publication. Distribution uses Herdr's GitHub plugin installer or a local Git clone; this project is not distributed through npm.

## Install or remove a local checkout

Requires Herdr 0.9.3+ and Node.js 22+. Run these commands from your own checkout; they change Herdr configuration.

For local development or an unreleased checkout:

```sh
git clone https://github.com/mahirocoko/mahiro-herdr.git
cd mahiro-herdr
npm run check
./install.sh
```

On Windows, link the same checkout with:

```powershell
powershell -File .\install.ps1
```

The installer checks the JSON plugin registry, refuses the same plugin ID at another or ambiguous root, links a new checkout disabled, configures and reloads Herdr, then enables the plugin. Re-running it from the registered checkout is supported. Reinstall failure restores the exact captured pre-operation config and enabled state when ownership evidence remains safe.

The plugin's Herdr uninstall action is intentionally restore-only because a running plugin must not unlink itself. To fully uninstall a locally linked development checkout, run:

```sh
./uninstall.sh
```

On Windows, run `powershell -File .\uninstall.ps1` from that same checkout.

The uninstall script passes its invoking checkout root to the workflow. Before disabling or changing configuration, the workflow verifies that Herdr's single same-ID registration resolves exactly to that root. This prevents an old clone from uninstalling a newer registration.

