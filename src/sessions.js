import { activeToolsForSession, effectiveStallBudget } from "./tools.js";
export function noteSessionInfo(state, info) {
    let session = state.sessions.get(info.sessionID);
    if (!session) {
        session = createSessionTrack(state, info.sessionID);
        state.sessions.set(info.sessionID, session);
    }
    if (info.parentID) {
        session.parentID = info.parentID;
    }
}
export function noteStatus(state, info) {
    let session = state.sessions.get(info.sessionID);
    if (!session) {
        session = createSessionTrack(state, info.sessionID);
        state.sessions.set(info.sessionID, session);
    }
    const oldStatus = session.status;
    session.status = info.status;
    if (info.status === "busy") {
        if (oldStatus !== "busy") {
            session.lastProgressAt = state.runtime.now();
        }
        armStallWatch(state, info.sessionID);
    }
    else {
        disarmStallWatch(state, session);
        if (info.status === "idle") {
            const callbacks = [...session.idleCallbacks];
            session.idleCallbacks = [];
            for (const cb of callbacks) {
                cb();
            }
        }
    }
}
export function noteProgress(state, info) {
    let session = state.sessions.get(info.sessionID);
    if (!session) {
        session = createSessionTrack(state, info.sessionID);
        state.sessions.set(info.sessionID, session);
    }
    session.lastProgressAt = state.runtime.now();
    armStallWatch(state, info.sessionID);
}
export function noteWaitingForUser(state, sessionID, waiting) {
    const session = state.sessions.get(sessionID);
    if (session) {
        session.waitingForUser = waiting;
        if (waiting) {
            disarmStallWatch(state, session);
        }
        else {
            if (session.status === "busy") {
                session.lastProgressAt = state.runtime.now();
                armStallWatch(state, sessionID);
            }
        }
    }
}
export function clearSession(state, sessionID) {
    const session = state.sessions.get(sessionID);
    if (session) {
        disarmStallWatch(state, session);
        state.sessions.delete(sessionID);
    }
}
export function getSession(state, sessionID) {
    return state.sessions.get(sessionID);
}
export function waitForIdle(state, session, timeoutMs) {
    if (session.status === "idle") {
        return Promise.resolve();
    }
    return new Promise((resolve) => {
        const cb = () => {
            state.runtime.clearTimeout(timer);
            resolve();
        };
        const timer = state.runtime.setTimeout(() => {
            const idx = session.idleCallbacks.indexOf(cb);
            if (idx !== -1) {
                session.idleCallbacks.splice(idx, 1);
            }
            resolve();
        }, timeoutMs);
        session.idleCallbacks.push(cb);
    });
}
function createSessionTrack(state, sessionID) {
    return {
        sessionID,
        status: "idle",
        lastProgressAt: state.runtime.now(),
        stallTimer: null,
        waitingForUser: false,
        recoveryCount: 0,
        idleCallbacks: [],
    };
}
export function armStallWatch(state, sessionID) {
    const session = state.sessions.get(sessionID);
    if (!session) {
        return;
    }
    disarmStallWatch(state, session);
    const active = activeToolsForSession(state, sessionID);
    const isBusy = session.status === "busy";
    const hasActiveTools = active.length > 0;
    if (!isBusy && !hasActiveTools) {
        return;
    }
    if (session.waitingForUser) {
        return;
    }
    const budget = effectiveStallBudget(state, sessionID);
    if (budget === null) {
        return;
    }
    const now = state.runtime.now();
    const elapsed = now - session.lastProgressAt;
    const remaining = budget - elapsed;
    if (remaining <= 0) {
        handleStall(state, sessionID);
    }
    else {
        session.stallTimer = state.runtime.setTimeout(() => {
            session.stallTimer = null;
            handleStall(state, sessionID);
        }, remaining);
    }
}
export const rearmStallWatch = armStallWatch;
function disarmStallWatch(state, session) {
    if (session.stallTimer) {
        state.runtime.clearTimeout(session.stallTimer);
        session.stallTimer = null;
    }
}
function handleStall(state, sessionID) {
    const session = state.sessions.get(sessionID);
    if (!session) {
        return;
    }
    const active = activeToolsForSession(state, sessionID);
    const isBusy = session.status === "busy";
    const hasActiveTools = active.length > 0;
    if (!isBusy && !hasActiveTools) {
        return;
    }
    if (session.waitingForUser) {
        return;
    }
    const budget = effectiveStallBudget(state, sessionID);
    if (budget === null) {
        return;
    }
    const now = state.runtime.now();
    const actualElapsed = now - session.lastProgressAt;
    if (actualElapsed < budget) {
        armStallWatch(state, sessionID);
    }
    else {
        if (state.onStall) {
            state.onStall(sessionID);
        }
    }
}
