# opencode-keepalive-v2

keep your coding agent from stalling out ~ a v2-compatible port of [opencode-keepalive](https://github.com/joeyism/opencode-keepalive) that actually loads on opencode 2.x.

![a terminal tails the plugin's heartbeat log: idle heartbeats, a subagent picks up a task and runs npm test, then goes quiet; keepalive flags the stall, aborts the stuck subagent and nudges its parent, which resumes](assets/demo.gif)

every line in the gif is real plugin output from a scripted stall. see [`tools/demo`](tools/demo) for how it's made.

the original plugin is written for opencode's v1 plugin api (`export default (ctx) => hooks`), so on opencode 2.x it fails to load with:

```
Plugin must export a default definition with an id and an effect or setup function.
```

this is a thin port. it keeps joeyism's heartbeat / stall-detection / recovery engine unchanged and bridges it to the v2 plugin api.

## what it does

- **liveness heartbeats** — appends newline-delimited json to a local log on a fixed cadence, so an external watchdog (or just `tail -f`) can tell your agent is still alive.
- **stall detection** — notices when a session is busy but has stopped making progress for too long.
- **auto-recovery** — optionally aborts a stuck *subagent* and nudges its parent to resume. your main session is never aborted.

## install

clone it into your opencode config dir:

```bash
git clone https://github.com/k0nnect/opencode-keepalive-v2 \
  ~/.config/opencode/local-plugins/opencode-keepalive-v2
```

then point your `~/.config/opencode/opencode.jsonc` at it:

```jsonc
{
  "plugins": [
    {
      "package": "./local-plugins/opencode-keepalive-v2",
      "options": { "childStallAction": "abort-resume-parent" }
    }
  ]
}
```

restart opencode (or let the file watcher reload it) and you're done. by default it writes heartbeats to `~/.local/state/opencode-keepalive/heartbeat.ndjson`.

## options

| option | default | what it does |
|---|---|---|
| `intervalMs` | `10000` | heartbeat cadence in ms |
| `stallMs` | `120000` | how long a busy session can make no progress before it counts as stalled |
| `childStallAction` | `report` | `report` (log only) or `abort-resume-parent` (abort the stuck subagent and nudge its parent) |
| `maxStallRecoveries` | `3` | cap on automatic recoveries per subagent |
| `output` | `file` | `file`, `stdout`, `stderr`, or `none` |
| `logFile` | `~/.local/state/opencode-keepalive/heartbeat.ndjson` | where the ndjson goes when `output` is `file` |

watch it live:

```bash
tail -f ~/.local/state/opencode-keepalive/heartbeat.ndjson | jq .
```

## how the port works

opencode 2.x replaced the v1 plugin shape with `export default { id, setup }` and moved the api onto the plugin context. this adapter:

- wraps the engine in `{ id, setup }`, and keeps exactly **one** engine per process — opencode can load a local plugin along more than one discovery path, so a small process-level guard stops heartbeats and recovery from doubling up.
- drives the v1 `event` hook from `ctx.event.subscribe()`, and the `tool.execute.before` / `tool.execute.after` hooks from `ctx.tool.hook(...)`.
- shims the removed `ctx.client.session.*` onto `ctx.session.*` so the recovery path (abort + parent nudge) works unchanged.

everything under `src/` except `index.js` is joeyism's engine, vendored as-is.

## credits

the heartbeat / stall-detection / recovery engine is [opencode-keepalive](https://github.com/joeyism/opencode-keepalive) by [joeyism](https://github.com/joeyism), vendored unchanged under `src/` (mit). this repo adds the v2 adapter (`src/index.js`) and the single-instance guard. see [`NOTICE`](NOTICE).

## license

mit — see [`LICENSE`](LICENSE).
