// drives the real plugin (src/index.js) through a scripted subagent stall and
// recovery, and writes the plugin's own heartbeat log to the path you pass in.
//
//   node tools/demo/scenario.mjs tools/demo/.work/heartbeat.ndjson
//
// a real subagent hang is hard to stage on cue, so a small stand-in plays the
// opencode v2 plugin context (event stream, tool hooks, session api). the
// heartbeats themselves are whatever the plugin writes.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entry = pathToFileURL(path.join(here, "..", "..", "src", "index.js")).href;
const plugin = (await import(entry)).default;

const out = path.resolve(process.argv[2] ?? path.join(here, ".work", "heartbeat.ndjson"));
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.rmSync(out, { force: true });

const PARENT = "ses_parent_7c1e";
const CHILD = "ses_child_3fa9";

// stand-in for ctx.event.subscribe(): an async iterator we can push events into
const queue = [];
let wake = null;
let closed = false;
const push = (event) => {
  queue.push(event);
  wake?.();
  wake = null;
};
async function* subscribe({ signal } = {}) {
  signal?.addEventListener("abort", () => {
    closed = true;
    wake?.();
    wake = null;
  });
  while (true) {
    while (queue.length) yield queue.shift();
    if (closed) return;
    await new Promise((resolve) => (wake = resolve));
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const status = (sessionID, type) =>
  push({ type: "session.status", properties: { sessionID, status: { type } } });

const toolHooks = {};
const ctx = {
  options: {
    intervalMs: 1000,
    stallMs: 3000,
    childStallAction: "abort-resume-parent",
    output: "file",
    logFile: out,
  },
  event: { subscribe },
  tool: {
    hook: async (name, callback) => {
      toolHooks[name] = callback;
      return { dispose: async () => {} };
    },
  },
  session: {
    get: async ({ path: p }) => ({
      data: p.id === CHILD ? { id: CHILD, parentID: PARENT } : { id: p.id },
    }),
    // an aborted session goes idle shortly after
    abort: async ({ path: p }) => {
      setTimeout(() => status(p.id, "idle"), 150);
      return { error: null };
    },
    // the nudged parent picks the work back up
    prompt: async () => {
      setTimeout(() => status(PARENT, "busy"), 200);
      setTimeout(
        () =>
          push({
            type: "message.part.updated",
            properties: { part: { sessionID: PARENT, type: "tool", tool: "task" } },
          }),
        1300,
      );
      return {};
    },
  },
};

const cleanup = await plugin.setup(ctx);

// a couple of idle heartbeats, then a subagent picks up a task
await sleep(2300);
push({ type: "session.created", properties: { info: { id: CHILD, parentID: PARENT } } });
await sleep(1100);
status(CHILD, "busy");

// it runs a command
await sleep(1100);
const call = { tool: "bash", sessionID: CHILD, callID: "call_npm_test", input: { command: "npm test" } };
await toolHooks["execute.before"]?.(call);
await sleep(2700);
await toolHooks["execute.after"]?.(call);

// then it stays busy without making progress. after stallMs the plugin flags
// the stall, aborts the subagent and nudges the parent.
await sleep(6600);

cleanup();
console.log(`wrote ${path.relative(process.cwd(), out)}`);
process.exit(0);
