export function createHeartbeat(signal, state) {
    const unixMs = state.runtime.now();
    const properties = {
        source: "opencode-keepalive",
        timestamp: new Date(unixMs).toISOString(),
        unixMs,
        trigger: signal.trigger,
    };
    if (state.options.includeDetails) {
        if (signal.eventType) {
            properties.eventType = signal.eventType;
        }
        if (signal.tool) {
            properties.tool = signal.tool;
        }
        if (signal.parentID) {
            properties.parentID = signal.parentID;
        }
        if (signal.stalledForMs) {
            properties.stalledForMs = signal.stalledForMs;
        }
        if (signal.recoveryAction) {
            properties.recoveryAction = signal.recoveryAction;
        }
        if (signal.recoveryAttempt) {
            properties.recoveryAttempt = signal.recoveryAttempt;
        }
        if (signal.error) {
            properties.error = signal.error;
        }
    }
    if (state.options.includeSessionID && signal.sessionID) {
        properties.sessionID = signal.sessionID;
    }
    return {
        type: "heartbeat",
        properties,
    };
}
export function requestHeartbeat(state, signal) {
    const heartbeat = createHeartbeat(signal, state);
    const now = state.runtime.now();
    // Stall and stall.recovery triggers bypass the throttle and write immediately
    // unless we are currently awaiting a drain.
    const isHighPriority = signal.trigger === "stall" || signal.trigger === "stall.recovery";
    if (isHighPriority ||
        state.lastHeartbeatAt === 0 ||
        now - state.lastHeartbeatAt >= state.options.intervalMs) {
        // If it's high priority but we are already throttled, we still clear the flush timer
        // because the immediate write will reset the interval.
        clearFlushTimer(state);
        state.pendingHeartbeat = null;
        writeHeartbeat(state, heartbeat);
        return;
    }
    state.pendingHeartbeat = heartbeat;
    scheduleFlush(state, state.options.intervalMs - (now - state.lastHeartbeatAt));
}
export function startToolHeartbeat(state, input) {
    const key = getCallKey(input);
    const activeTool = {
        tool: input.tool,
        sessionID: input.sessionID,
        args: input.args,
    };
    state.activeTools.set(key, activeTool);
    state.lastRunningSignal = {
        trigger: "tool.running",
        tool: input.tool,
        sessionID: input.sessionID,
    };
    ensureKeepaliveTimer(state);
    requestHeartbeat(state, {
        trigger: "tool.execute.before",
        tool: input.tool,
        sessionID: input.sessionID,
    });
}
export function finishToolHeartbeat(state, input) {
    const key = getCallKey(input);
    state.activeTools.delete(key);
    if (state.activeTools.size === 0) {
        stopKeepaliveTimer(state);
        state.lastRunningSignal = null;
    }
    else {
        const latest = Array.from(state.activeTools.values()).at(-1);
        state.lastRunningSignal = {
            trigger: "tool.running",
            tool: latest.tool,
            sessionID: latest.sessionID,
        };
    }
    requestHeartbeat(state, {
        trigger: "tool.execute.after",
        tool: input.tool,
        sessionID: input.sessionID,
    });
}
export function flushPendingHeartbeat(state) {
    if (!state.pendingHeartbeat || state.awaitingDrain) {
        return;
    }
    const heartbeat = state.pendingHeartbeat;
    state.pendingHeartbeat = null;
    writeHeartbeat(state, heartbeat);
}
export function writeHeartbeat(state, heartbeat) {
    if (state.awaitingDrain) {
        state.pendingHeartbeat = heartbeat;
        return false;
    }
    try {
        const accepted = state.runtime.write(`${JSON.stringify(heartbeat)}\n`);
        state.lastHeartbeatAt = heartbeat.properties.unixMs;
        resetIdleHeartbeat(state);
        if (!accepted) {
            state.awaitingDrain = true;
            state.pendingHeartbeat = heartbeat;
            state.runtime.onceDrain(() => {
                state.awaitingDrain = false;
                flushPendingHeartbeat(state);
            });
        }
        return true;
    }
    catch {
        return false;
    }
}
function ensureKeepaliveTimer(state) {
    if (state.keepaliveTimer) {
        return;
    }
    state.keepaliveTimer = state.runtime.setInterval(() => {
        if (!state.lastRunningSignal) {
            return;
        }
        requestHeartbeat(state, state.lastRunningSignal);
    }, state.options.intervalMs);
}
function stopKeepaliveTimer(state) {
    if (!state.keepaliveTimer) {
        return;
    }
    state.runtime.clearInterval(state.keepaliveTimer);
    state.keepaliveTimer = null;
}
function scheduleFlush(state, delayMs) {
    if (state.flushTimer) {
        return;
    }
    state.flushTimer = state.runtime.setTimeout(() => {
        state.flushTimer = null;
        flushPendingHeartbeat(state);
    }, delayMs);
}
export function clearFlushTimer(state) {
    if (!state.flushTimer) {
        return;
    }
    state.runtime.clearTimeout(state.flushTimer);
    state.flushTimer = null;
}
export function stopIdleHeartbeat(state) {
    if (state.idleTimer) {
        state.runtime.clearTimeout(state.idleTimer);
        state.idleTimer = null;
    }
}
export function startIdleHeartbeat(state) {
    scheduleIdleHeartbeat(state, state.options.intervalMs);
}
function scheduleIdleHeartbeat(state, delayMs) {
    if (state.idleTimer) {
        return;
    }
    state.idleTimer = state.runtime.setTimeout(() => {
        state.idleTimer = null;
        handleIdleHeartbeat(state);
    }, delayMs);
}
function resetIdleHeartbeat(state) {
    stopIdleHeartbeat(state);
    scheduleIdleHeartbeat(state, state.options.intervalMs);
}
function handleIdleHeartbeat(state) {
    if (state.activeTools.size > 0 ||
        state.pendingHeartbeat ||
        state.flushTimer ||
        state.awaitingDrain) {
        scheduleIdleHeartbeat(state, state.options.intervalMs);
        return;
    }
    try {
        const heartbeat = createHeartbeat({ trigger: "idle" }, state);
        writeHeartbeat(state, heartbeat);
    }
    catch {
        // If it throws, we just try again later
    }
    // Ensure it's scheduled for next time in case writeHeartbeat failed or threw
    scheduleIdleHeartbeat(state, state.options.intervalMs);
}
function getCallKey(input) {
    if (input.callID) {
        return input.callID;
    }
    return `${input.tool}:${input.sessionID ?? "unknown"}`;
}
