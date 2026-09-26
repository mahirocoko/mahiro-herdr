# Repository contract

This is an MIT-licensed, dependency-free repository providing a read-only Herdr adapter (`src/core.mjs`), an optional Agy-native statusline quota producer (`src/agy-statusline-producer.mjs`), and a workspace metadata bridge (`src/workspace-metadata.mjs`).

- Use Node 22+ built-ins only and keep modules small.
- Use single quotes and omit semicolons in JavaScript.
- Distinguish the three components:
  - `src/core.mjs` is strictly a read-only cache adapter for Herdr. It projects normalized cache files and coordinates lifecycle refresh.
  - `src/agy-statusline-producer.mjs` is an optional consumer of already-delivered Agy CLI statusline payloads (`quota` map).
  - `src/workspace-metadata.mjs` is a focused separate module providing a bounded, allowlisted cross-client projection for Herdr Web without replacing native Space rendering.
- Canonical source for workspace metadata is `mahiro-herdr-sidebar.workspace`.
- Canonical owned workspace tokens: `mahiro_workspace_branch`, `mahiro_workspace_git_status`, `mahiro_workspace_worktree`.
- Workspace token values: sanitized/bounded branch name (detached uses `detached@<short sha>`), exact `clean` or `dirty`, and a bounded linked-worktree label without leaking absolute paths; clear every owned token when workspace/repository evidence is unavailable or ambiguous.
- Never read pane contents, transcripts, sessions, credentials, email, plan tier, or raw provider payloads, never invoke `agy -p`, and make no network requests.
- The only usage inputs to the adapter are normalized `codex.json`, `agy.json`, and `cursor.json` cache files under the absolute `MAHIRO_HERDR_USAGE_CACHE_DIR` override or the default `~/.letta/mods/mahiro-usage`.
- Never clear `mahiro_sidebar_model`, `mahiro_sidebar_context`, or `mahiro_sidebar_provider`; Mahiro Mods owns them.
- Use Herdr CLI wrappers only: one `herdr api snapshot` inventory plus `herdr workspace report-metadata`; use subprocess argv without a shell for Git.
- Choose repository evidence deterministically from `workspace.worktree.checkout_path` when linked; otherwise use the active tab layout's focused pane `foreground_cwd || cwd`, with a clear fallback only when deterministic.
- Treat workspace metadata as display-only, use one invocation-wide u64 seq, bounded TTL so stale Git facts expire, cap inventory at 128 targets, honor the global 30s deadline, 5s command timeout, and 256 KiB output limit.
- Refresh is stateless: one inventory observation, complete per-pane and per-workspace owned-token patches, no refresh state, suppression, heartbeat, or refresh lock.
- Startup and manual refresh reconcile all bounded workspaces; exact pane events keep existing exact-pane quota reconciliation and additionally reconcile only that event's exact workspace.
- Workspace metadata failure must not corrupt caches or broaden pane ownership; design fault isolation truthfully.
- Keep configuration changes exact, reversible, atomic, serialized by PID-plus-nonce lock directories, and fail closed on ownership ambiguity, lock contention, or drift.
- Reclaim config locks only after an `ESRCH` liveness proof; never reclaim by age or force an ambiguous owner.
- Uninstall and restore best-effort clear both pane-owned and workspace-owned tokens with TTL as fallback.
- Do not add watchers, pollers, daemons, notifications, settings panes, sorting, dependencies, or network access.
- The Agy producer normalizes only four exact bucket IDs (`gemini-5h`, `gemini-weekly`, `3p-5h`, `3p-weekly`) to `Gemini:5h`, `Gemini:7d`, `Claude-GPT:5h`, `Claude-GPT:7d` in fixed order.
- The producer returns unavailable without touching existing cache when quota is absent or invalid; publishes only `{fetched, failed: false, windows}` atomically to `agy.json` with user-only permissions (`0o600` file, `0o700` dir); refuses symlinks in every path component and non-regular targets/directories; semantically dedupes stable windows within 120 seconds; and survives failure of the default deadline-bounded Herdr refresh path.
- The Agy producer's post-publication refresh is pane-only through `refreshPaneMetadata`; it must never invoke workspace snapshots, Git inspection, or workspace reports. Startup, manual, configure, and install refreshes own the combined pane + workspace pass.
- Agent Halo is the canonical trusted Cursor collector and `cursor.json` producer. This repository owns only the normalized cache protocol and read-only projection: exact labels `Auto` then `API`, remaining percentage points, and billing-cycle reset epoch milliseconds. Cursor cache freshness is 65 minutes to cover Agent Halo's configurable maximum 60-minute refresh cadence plus delivery headroom while its desktop renderer is running; Codex and Agy remain five minutes. When Agent Halo is absent or refresh fails, expiry clears Cursor rows. Do not duplicate Agent Halo's credential, token-refresh, or provider-network logic here.
- Refresh is eligible only when the runtime environment has both `HERDR_ENV=1` and a non-empty `HERDR_PANE_ID`; caller options must not promote an outside process into Herdr evidence.
- Agy statusline producer integration is library import-call to preserve custom rendered statusline stdout.
- Cursor Agent `2026.09.23-86fc751` statusline payloads do not contain account usage. Do not present Cursor statusline or hooks as the quota source; Agent Halo's existing direct provider integration owns collection.
- Tests must isolate HOME, cache, Herdr configuration, and use a stub Herdr executable.
