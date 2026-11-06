# demo gif tooling

how `assets/demo.gif` is made: the real plugin from `src/` runs through a scripted subagent stall, and its heartbeat log is drawn as a terminal tailing that log.

## the scripts

- `scenario.mjs`: loads `src/index.js` and drives it through a subagent that picks up a task, runs `npm test`, then goes quiet until keepalive flags the stall, aborts it and nudges its parent. a small stand-in plays the opencode v2 plugin context (event stream, tool hooks, session api), because a real hang is hard to stage on cue. the heartbeats are whatever the plugin writes.
- `render.py`: pipes every heartbeat through the same `jq` filter the gif shows, so each terminal line is exactly what that command prints. then it draws the frames and encodes a looping 960×600 gif with one global palette. timing follows each heartbeat's `unixMs`, sped up 1.5×. a few key frames land in `tools/demo/.work/frames/` so you can check them by eye.

needs node 20+, jq, uv (pillow comes in through the script's inline metadata) and macos for the menlo font.

## regenerate

from the repo root:

```sh
node tools/demo/scenario.mjs tools/demo/.work/heartbeat.ndjson
uv run tools/demo/render.py tools/demo/.work/heartbeat.ndjson assets/demo.gif
```

`--speed` sets how much faster than real time the output plays (default `1.5`).
