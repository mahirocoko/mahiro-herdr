# herdr-radar: Implementation Patterns

Read-only study of commit `1ba8cc4a3900191c9f1f4f850398c7dd10212df2`, version 1.4.2, on 2026-10-06. Reader: repo-scout; synthesis and targeted source checks: Main. No installer, tests, daemon or browser were executed. Snippets below are bounded excerpts or explicitly marked sketches, not copied standalone implementations.

## 1. Motion is token publication, not a native animation widget

Actual constants, lib/frame.js lines 30–36:

```js
const SPIN_MS = 150;
const PULSE_MS = SPIN_MS * PULSE_STEPS;
```

Composition sketch, lib/state.js lines 523–535:

```js
const lead = display === 'working'
  ? config.FRAMES[step % config.FRAMES.length]
  : display === 'blocked'
    ? blockedFrame(step)
    : /* done/unknown glyph or empty */ '';
```

Working rows cycle eight braille glyphs at a nominal 150 ms cadence. Blocked rows pulse across five steps per phase (750 ms). Motion is ahead of the title, not the vendor logo. This is source-level capability evidence; smoothness and CPU cost were not measured in a live run. References: lib/config.js lines 133–141, lib/logos.js lines 81–100, lib/frame.js, lib/state.js.

## 2. Events wake; snapshots decide

Actual timers, lib/daemon.js:

```js
timers.push(setInterval(refreshTabLine, TABLINE_MS));
timers.push(setInterval(wake, HEARTBEAT_MS));
```

Both constants are 2000 ms. The resident daemon schedules frames from current agent inventory; events are wake hints, not durable state truth. A failed snapshot must not be treated as an empty agent list. Frame publication is diff-based to avoid writing all unchanged tokens on every animation tick. A 120 ms floor and 150 ms scheduler poll constrain self-generated update-event loops. References: lib/daemon.js lines 6–14, 33–42, 289–357; lib/frame.js.

## 3. Different caches solve different jobs

Actual cache use, lib/lookup.js lines 20–58:

```js
if (fresh(cached, paneId, workspaceId, now)) {
  return { ...cached, cached: true };
}
```

The focused tab-line lookup has an eight-second file cache keyed by pane/workspace. Labels have a separate five-second in-memory TTL; an empty/failed lookup retains good labels and advances the TTL rather than retrying every animation frame. Do not collapse these into one generic cache policy. Shared JSON persistence uses temp plus rename (lib/cache.js lines 21–35). Regression reference: test/labels.test.js lines 33–60.

## 4. Atomic writes preserve a dotfiles symlink

Actual write shape, lib/toml-blocks.js lines 222–239:

```js
const target = realTarget(file);
const tmp = `${target}${suffix}`;
fs.writeFileSync(tmp, text, 'utf8');
fs.renameSync(tmp, target);
```

Resolving the target before replacing it preserves the symlink itself. This is Radar's explicit choice, not permission to loosen Mahiro Herdr's non-symlink/exact-byte recovery contract. Regression reference: test/write-atomic.test.js lines 23–57. Config parser validation and backups are separate safeguards from atomicity.

## 5. Branch freshness deliberately excludes dirty status

The Git helper walks upward to a `.git` directory or worktree/submodule `gitdir:` indirection and reads HEAD directly. Its source comment explains the tradeoff: cheap current branch reads on the two-second tab-line timer, but no dirty marker because that requires asking Git. References: lib/git.js lines 3–55; lib/daemon.js tab-line timer. No file-change or added/deleted-line count implementation was evidenced.

## 6. Regression ideas worth studying

- Failed-label-read TTL: test/labels.test.js.
- Monotonic scheduler resilience after wall-clock rollback: test/scheduler.test.js lines 41–82.
- Symlink-preserving atomic writes: test/write-atomic.test.js.
- Foreign sidebar table ownership: test/foreign-tables.test.js.
- Generated Spaces token limits: test/spaces-row-limit.test.js.
- Daemon endpoint health versus PID liveness: test/daemon-status.test.js.

These are source-inspected tests, not a test PASS claim. `tools/prove-checks.js` mutates source as a proof harness and was deliberately not executed during read-only learning.

## Platform boundary

Manifest platforms are Linux/macOS/Windows; README says Windows 11/macOS tested, Linux not yet tested. Node 18+ is the minimum, with optional activity-recovery features gated by newer Node support. A manifest entry is not rendered/runtime compatibility proof.
