import { finishToolHeartbeat, requestHeartbeat, startToolHeartbeat, startIdleHeartbeat, } from "./heartbeat.js";
import { recoverStalledChild } from "./recover.js";
import { noteProgress, noteSessionInfo, noteStatus, noteWaitingForUser, rearmStallWatch, } from "./sessions.js";
export function createHooks(ctx, state) {
    state.client = ctx.client;
    state.onStall = (sessionID) => {
        const session = state.sessions.get(sessionID);
        requestHeartbeat(state, {
            trigger: "stall",
            sessionID,
            parentID: session?.parentID,
            stalledForMs: state.options.stallMs,
        });
        recoverStalledChild(state, sessionID).catch(() => {
            // Ignore recovery errors, they are handled inside recoverStalledChild
        });
    };
    startIdleHeartbeat(state);
    return {
        event: async (input) => {
            const event = input?.event;
            if (!event) {
                return;
            }
            if (!event.type) {
                return;
            }
            if (event.type === "heartbeat") {
                return;
            }
            const sessionID = extractSessionID(event);
            if (sessionID) {
                await ensureSessionKnown(state, sessionID);
                handleSessionEvent(state, sessionID, event);
            }
            requestHeartbeat(state, {
                trigger: "event",
                eventType: event.type,
                sessionID,
            });
        },
        "tool.execute.before": async (input, output) => {
            noteProgress(state, { sessionID: input.sessionID });
            startToolHeartbeat(state, {
                tool: input.tool,
                sessionID: input.sessionID,
                callID: input.callID,
                args: output?.args,
            });
            rearmStallWatch(state, input.sessionID);
        },
        "tool.execute.after": async (input, _output) => {
            noteProgress(state, { sessionID: input.sessionID });
            finishToolHeartbeat(state, input);
            rearmStallWatch(state, input.sessionID);
        },
        "permission.ask": async (input) => {
            const sessionID = input.sessionID || input.properties?.sessionID;
            if (sessionID) {
                noteWaitingForUser(state, sessionID, true);
            }
        }
    };
}
async function ensureSessionKnown(state, sessionID) {
    if (state.sessions.has(sessionID)) {
        return;
    }
    // Create a tracker entry immediately so progress/stall can attach.
    noteSessionInfo(state, { sessionID });
    if (!state.client) {
        return;
    }
    try {
        const { data } = await state.client.session.get({ path: { id: sessionID } });
        if (data?.parentID) {
            noteSessionInfo(state, { sessionID, parentID: data.parentID });
        }
    }
    catch {
        // ignore — recovery can retry get later
    }
}
function handleSessionEvent(state, sessionID, event) {
    // 1. Session identity
    if (event.type === "session.created" || event.type === "session.updated") {
        const info = event.properties?.info;
        if (info) {
            noteSessionInfo(state, { sessionID, parentID: info.parentID });
        }
    }
    // 2. Status
    if (event.type === "session.status") {
        const status = event.properties?.status?.type;
        if (status === "busy" || status === "idle" || status === "retry") {
            noteStatus(state, { sessionID, status });
        }
        // Also capture parentID if present in status event (newer SDKs)
        if (event.properties?.parentID) {
            noteSessionInfo(state, { sessionID, parentID: event.properties.parentID });
        }
    }
    if (event.type === "session.idle") {
        noteStatus(state, { sessionID, status: "idle" });
    }
    // 3. Permissions
    if (event.type === "permission.asked" || event.type === "permission.updated") {
        noteWaitingForUser(state, sessionID, true);
    }
    else if (event.type === "permission.replied") {
        noteWaitingForUser(state, sessionID, false);
        noteProgress(state, { sessionID });
    }
    // 4. Progress
    const isProgress = event.type === "message.part.updated" ||
        event.type === "message.updated" ||
        event.type === "message.part.delta" ||
        (event.type.startsWith("tool.") && event.type !== "tool.running") ||
        event.type.startsWith("command.");
    if (isProgress) {
        noteProgress(state, { sessionID });
    }
}
function extractSessionID(event) {
    if (event.sessionID) {
        return event.sessionID;
    }
    if (event.properties?.sessionID) {
        return event.properties.sessionID;
    }
    if (event.part?.sessionID) {
        return event.part.sessionID;
    }
    if (event.properties?.part?.sessionID) {
        return event.properties.part.sessionID;
    }
    if (event.properties?.info?.id) {
        return event.properties.info.id;
    }
    return undefined;
}
