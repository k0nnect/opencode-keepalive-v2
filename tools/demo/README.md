# demo gif tooling

this is how `assets/demo.gif` gets made. the plugin in `src/` runs through a scripted subagent stall, and the heartbeat log it writes is drawn as a terminal tailing that log.

## the scripts

- `scenario.mjs` loads `src/index.js` and walks it through a subagent that picks up a task, runs `npm test`, then goes quiet until keepalive flags the stall, aborts it and nudges its parent. a real hang is hard to trigger on cue, so a small fake of the opencode v2 plugin context (event stream, tool hooks, session api) stands in for opencode. the heartbeats themselves come straight from the plugin.
- `render.py` pipes each heartbeat through the same `jq` filter shown in the gif, so every terminal line is what that command would print. it draws the frames, paces them by each heartbeat's `unixMs` (1.5x real time) and encodes a looping 960x600 gif. it also saves a few key frames to `tools/demo/.work/frames/` for a quick look.

you need node, jq, uv (it pulls in pillow) and macos, since the font is menlo.

## regenerate

from the repo root:

```sh
node tools/demo/scenario.mjs tools/demo/.work/heartbeat.ndjson
uv run tools/demo/render.py tools/demo/.work/heartbeat.ndjson assets/demo.gif
```

`--speed` changes the playback speed relative to real time (default `1.5`).
