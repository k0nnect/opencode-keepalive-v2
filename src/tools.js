import { classifyBashCommand, extractBashCommand } from "./bash-command.js";
export function normalizeToolName(tool) {
    return tool.trim().toLowerCase();
}
export function activeToolsForSession(state, sessionID) {
    return [...state.activeTools.values()].filter((t) => t.sessionID === sessionID);
}
/**
 * Returns the stall budget (ms) for a busy session, or null if stall
 * should not arm purely from tool silence (unmapped tools in flight).
 */
export function effectiveStallBudget(state, sessionID) {
    const active = activeToolsForSession(state, sessionID);
    if (active.length === 0) {
        return state.options.stallMs; // stream / model silence
    }
    const mapped = [];
    for (const t of active) {
        const name = normalizeToolName(t.tool);
        if (name === "bash" || name === "shell") {
            const cmd = extractBashCommand(t.args);
            if (cmd && classifyBashCommand(cmd) === "quick") {
                mapped.push(state.options.bashQuickStallMs);
            }
            // long/unknown bash: contribute nothing (unmapped)
            continue;
        }
        const ms = state.options.toolStallMsByTool[name];
        if (ms !== undefined) {
            mapped.push(ms);
        }
    }
    if (mapped.length > 0) {
        // Strictest fuse among mapped active tools (glob+grep both hung → min)
        return Math.min(...mapped);
    }
    // Only unmapped tools in flight (e.g. bash npm install):
    // do NOT stall on tool silence alone — wait for after/stream progress
    // or worker wall timeout outside this plugin.
    return null;
}
