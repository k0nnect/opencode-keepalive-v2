// opencode-keepalive — V2 adapter entry.
//
// The published npm package `opencode-keepalive@0.1.0` targets OpenCode's V1
// plugin API (default export = a function returning a hooks object) and fails to
// load on OpenCode v2.2.5, which requires `export default { id, setup }`.
//
// This entry keeps the package's proven engine (state/heartbeat/sessions/recover/
// tools/bash-command — all pure node:fs/node:path, no SDK import) completely
// unchanged, and bridges it to the V2 context:
//   V1 `event` hook              -> ctx.event.subscribe()  (async iterator)
//   V1 `tool.execute.before`     -> ctx.tool.hook("execute.before", cb)
//   V1 `tool.execute.after`      -> ctx.tool.hook("execute.after", cb)
//   V1 `ctx.client.session.*`    -> ctx.session.*  (via a tiny shim)
//   cleanup                      -> function returned from setup()
//
// Every bridge is defensive: a missing V2 domain degrades gracefully instead of
// throwing, and callbacks never throw back into OpenCode (they only record
// liveness), so the plugin can never block a tool or crash a session.

import { resolveOptions } from "./config.js";
import { createState } from "./state.js";
import { createHooks } from "./hooks.js";
import { stopIdleHeartbeat } from "./heartbeat.js";

function pickSessionID(e) {
  return (
    e?.sessionID ??
    e?.session?.id ??
    e?.input?.sessionID ??
    e?.properties?.sessionID ??
    undefined
  );
}

function pickCallID(e) {
  return e?.callID ?? e?.callId ?? e?.id ?? e?.call?.id ?? undefined;
}

// Process-level single-instance guard. OpenCode can load this plugin via more
// than one discovery path in the same server process (observed: a module load
// and a directory load milliseconds apart). Without this, idle heartbeats — and
// much more importantly, stall recovery (abort + parent nudge) — would run twice.
// The check-and-set below is synchronous, so on the single-threaded event loop
// only the first load claims the engine; any other load is an inert no-op.
const ENGINE_KEY = "__opencode_keepalive_engine__";

async function setup(ctx) {
  const G = globalThis;
  if (G[ENGINE_KEY]) {
    return () => {};
  }
  G[ENGINE_KEY] = true;

  const options = resolveOptions(ctx?.options ?? {});
  const state = createState(options);

  // Diagnostic + empirical API probe: record that setup ran and what the real
  // runtime ctx actually exposes (the installed SDK's .d.ts is stale, so this is
  // the source of truth). Written to the heartbeat log via the engine's own
  // runtime writer (same file/stream as heartbeats; no-op when output: "none").
  try {
    state.runtime.write(
      JSON.stringify({
        type: "plugin.loaded",
        source: "opencode-keepalive",
        timestamp: new Date().toISOString(),
        ctxKeys: ctx ? Object.keys(ctx) : [],
        has: {
          event_subscribe: typeof ctx?.event?.subscribe === "function",
          tool_hook: typeof ctx?.tool?.hook === "function",
          session_get: typeof ctx?.session?.get === "function",
          session_abort: typeof ctx?.session?.abort === "function",
          session_prompt: typeof ctx?.session?.prompt === "function",
        },
        options: {
          childStallAction: options.childStallAction,
          stallMs: options.stallMs,
          maxStallRecoveries: options.maxStallRecoveries,
          output: options.output,
          logFile: options.logFile,
        },
      }) + "\n",
    );
  } catch {
    // best-effort diagnostics only
  }

  // Shim the removed V1 `ctx.client`. The engine calls
  // state.client.session.{get,abort,prompt}. In V2 those live on ctx.session
  // with the same request/response shapes (ctx is "essentially an OpenCode
  // server client"), so a thin remap is all that's needed.
  const client = { session: ctx?.session };

  // Build the V1 hooks object from the untouched engine. createHooks() also
  // wires state.onStall -> recoverStalledChild and starts the idle heartbeat.
  const v1 = createHooks({ client }, state);

  const controller = new AbortController();

  // V1 `event` -> V2 event subscription (async iterator).
  if (typeof ctx?.event?.subscribe === "function" && typeof v1?.event === "function") {
    (async () => {
      try {
        for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
          try {
            await v1.event({ event });
          } catch {
            // never let event handling throw back into the stream
          }
        }
      } catch {
        // subscription aborted on unload, or stream error — nothing to do
      }
    })();
  }

  // V1 `tool.execute.before/after` -> V2 tool hooks. The V2 callback receives one
  // merged event; map it back to the engine's (input, output) shape. Swallow all
  // errors so a liveness probe can never abort a real tool call.
  const before = v1?.["tool.execute.before"];
  const after = v1?.["tool.execute.after"];
  if (typeof ctx?.tool?.hook === "function") {
    if (typeof before === "function") {
      try {
        await ctx.tool.hook("execute.before", async (e) => {
          try {
            await before(
              { tool: e?.tool, sessionID: pickSessionID(e), callID: pickCallID(e) },
              { args: e?.input ?? e?.args },
            );
          } catch {}
        });
      } catch {}
    }
    if (typeof after === "function") {
      try {
        await ctx.tool.hook("execute.after", async (e) => {
          try {
            await after(
              { tool: e?.tool, sessionID: pickSessionID(e), callID: pickCallID(e) },
              { args: e?.input ?? e?.args },
            );
          } catch {}
        });
      } catch {}
    }
  }

  // Cleanup on unload: stop the event subscription and the idle-heartbeat timer.
  // (Hook registrations are auto-disposed by OpenCode; other engine timers are
  // one-shot/guarded and die with the plugin's module scope.)
  return () => {
    try {
      controller.abort();
    } catch {}
    try {
      stopIdleHeartbeat(state);
    } catch {}
    try {
      delete G[ENGINE_KEY];
    } catch {
      G[ENGINE_KEY] = false;
    }
  };
}

export default {
  id: "opencode-keepalive",
  setup,
};
