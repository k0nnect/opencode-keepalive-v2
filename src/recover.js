import { requestHeartbeat } from "./heartbeat.js";
import { noteProgress, waitForIdle } from "./sessions.js";
export async function recoverStalledChild(state, sessionID) {
    const session = state.sessions.get(sessionID);
    if (!session || state.recoveryInFlight.has(sessionID)) {
        return;
    }
    // Check policy
    if (state.options.childStallAction !== "abort-resume-parent") {
        return;
    }
    // If we don't know the parentID, try to fetch it
    if (!session.parentID && state.client) {
        try {
            const { data } = await state.client.session.get({ path: { id: sessionID } });
            if (data?.parentID) {
                session.parentID = data.parentID;
            }
        }
        catch {
            // ignore fetch error, we'll check parentID below
        }
    }
    // Must be a child to auto-recover
    if (!session.parentID) {
        return;
    }
    if (session.recoveryCount >= state.options.maxStallRecoveries) {
        return;
    }
    state.recoveryInFlight.add(sessionID);
    try {
        session.recoveryCount++;
        requestHeartbeat(state, {
            trigger: "stall.recovery",
            sessionID,
            parentID: session.parentID,
            recoveryAction: state.options.childStallAction,
            recoveryAttempt: session.recoveryCount,
        });
        // 1. Abort child
        if (state.client) {
            const { error } = await state.client.session.abort({ path: { id: sessionID } });
            if (error) {
                throw new Error(error.message || "Abort failed");
            }
            // 2. Wait for idle (best effort)
            await waitForIdle(state, session, state.options.abortWaitMs);
            // 3. Nudge parent
            const message = buildResumeMessage(sessionID, session.parentID, state.options.resumeMessageTemplate);
            // Call methods on the session object so SDK keeps `this` (needs this._client).
            const sessionApi = state.client.session;
            const promptArgs = {
                path: { id: session.parentID },
                body: {
                    parts: [{ type: "text", text: message }],
                },
            };
            if (typeof sessionApi.promptAsync === "function") {
                await sessionApi.promptAsync(promptArgs);
            }
            else {
                await sessionApi.prompt(promptArgs);
            }
        }
        // Success - reset progress so we don't immediately stall again
        noteProgress(state, { sessionID });
    }
    catch (err) {
        requestHeartbeat(state, {
            trigger: "stall.recovery",
            sessionID,
            parentID: session.parentID,
            error: err.message || String(err),
        });
    }
    finally {
        state.recoveryInFlight.delete(sessionID);
    }
}
function buildResumeMessage(sessionID, parentID, template) {
    return template
        .replaceAll("{{sessionID}}", sessionID)
        .replaceAll("{{parentID}}", parentID)
        // subagent_type might not be known if not seen in created event
        .replaceAll("{{subagent_type}}", "explore"); // fallback to explore if unknown
}
