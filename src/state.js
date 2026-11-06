import fs from "node:fs";
import path from "node:path";
function createRuntime(options) {
    if (options.output === "none") {
        return {
            now: () => Date.now(),
            write: () => true,
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
            setInterval: globalThis.setInterval.bind(globalThis),
            clearInterval: globalThis.clearInterval.bind(globalThis),
            onceDrain: () => { },
        };
    }
    if (options.output === "file") {
        const logFile = options.logFile;
        try {
            fs.mkdirSync(path.dirname(logFile), { recursive: true });
        }
        catch {
            // best-effort; write will fail soft later
        }
        return {
            now: () => Date.now(),
            write: (line) => {
                try {
                    fs.appendFileSync(logFile, line, { encoding: "utf8" });
                    return true;
                }
                catch {
                    return false;
                }
            },
            setTimeout: globalThis.setTimeout.bind(globalThis),
            clearTimeout: globalThis.clearTimeout.bind(globalThis),
            setInterval: globalThis.setInterval.bind(globalThis),
            clearInterval: globalThis.clearInterval.bind(globalThis),
            // File writes are sync; no drain backpressure.
            onceDrain: () => { },
        };
    }
    const stream = options.output === "stderr" ? process.stderr : process.stdout;
    return {
        now: () => Date.now(),
        write: (line) => stream.write(line),
        setTimeout: globalThis.setTimeout.bind(globalThis),
        clearTimeout: globalThis.clearTimeout.bind(globalThis),
        setInterval: globalThis.setInterval.bind(globalThis),
        clearInterval: globalThis.clearInterval.bind(globalThis),
        onceDrain: (callback) => {
            stream.once("drain", callback);
        },
    };
}
export function createState(options, runtimeOverrides = {}) {
    return {
        options,
        runtime: {
            ...createRuntime(options),
            ...runtimeOverrides,
        },
        lastHeartbeatAt: 0,
        flushTimer: null,
        keepaliveTimer: null,
        idleTimer: null,
        pendingHeartbeat: null,
        awaitingDrain: false,
        activeTools: new Map(),
        lastRunningSignal: null,
        sessions: new Map(),
        recoveryInFlight: new Set(),
    };
}
