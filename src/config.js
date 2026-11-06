import os from "node:os";
import path from "node:path";
export const DEFAULT_RESUME_MESSAGE = [
    "Subagent session {{sessionID}} stalled and was aborted.",
    "Resume it now using the task tool with these exact fields:",
    "- task_id: {{sessionID}}",
    "- subagent_type: {{subagent_type}}",
    "- description: resume stalled subagent",
    "- prompt: Continue the previous work. Summarize what was done and finish the remaining steps.",
    "Do not omit task_id. Do not start a different subagent.",
].join("\n");
export function defaultLogFile() {
    const base = process.env.XDG_STATE_HOME?.trim() ||
        path.join(os.homedir(), ".local", "state");
    return path.join(base, "opencode-keepalive", "heartbeat.ndjson");
}
export const DEFAULT_TOOL_STALL_MS_BY_TOOL = {
    glob: 60_000,
    grep: 60_000,
    read: 60_000,
    list: 60_000,
};
export const DEFAULT_OPTIONS = {
    intervalMs: 10_000,
    includeDetails: true,
    includeSessionID: true,
    stallMs: 120_000,
    childStallAction: "report",
    maxStallRecoveries: 3,
    abortWaitMs: 30_000,
    toolStallMsByTool: DEFAULT_TOOL_STALL_MS_BY_TOOL,
    bashQuickStallMs: 60_000,
    resumeMessageTemplate: DEFAULT_RESUME_MESSAGE,
    output: "file",
    logFile: defaultLogFile(),
};
export function resolveOptions(options) {
    const stallMs = normalizeMs(options?.stallMs, DEFAULT_OPTIONS.stallMs);
    const childStallAction = normalizeChildStallAction(options?.childStallAction);
    const maxStallRecoveries = normalizeMaxRecoveries(options?.maxStallRecoveries);
    const abortWaitMs = normalizeMs(options?.abortWaitMs, Math.min(stallMs, 30_000));
    const toolStallMsByTool = resolveToolStallMap(options?.toolStallMsByTool);
    const bashQuickStallMs = normalizeMs(options?.bashQuickStallMs, DEFAULT_OPTIONS.bashQuickStallMs);
    const output = normalizeOutput(options?.output);
    const logFile = typeof options?.logFile === "string" && options.logFile.trim().length > 0
        ? expandHome(options.logFile.trim())
        : DEFAULT_OPTIONS.logFile;
    return {
        intervalMs: normalizeMs(options?.intervalMs, DEFAULT_OPTIONS.intervalMs),
        includeDetails: options?.includeDetails ?? DEFAULT_OPTIONS.includeDetails,
        includeSessionID: options?.includeSessionID ?? DEFAULT_OPTIONS.includeSessionID,
        stallMs,
        childStallAction,
        maxStallRecoveries,
        abortWaitMs,
        toolStallMsByTool,
        bashQuickStallMs,
        resumeMessageTemplate: options?.resumeMessageTemplate ?? DEFAULT_OPTIONS.resumeMessageTemplate,
        output,
        logFile,
    };
}
function resolveToolStallMap(input) {
    const out = { ...DEFAULT_TOOL_STALL_MS_BY_TOOL };
    if (!input || typeof input !== "object")
        return out;
    for (const [k, v] of Object.entries(input)) {
        const key = k.trim().toLowerCase();
        if (!key)
            continue;
        if (v === null || v === undefined) {
            delete out[key];
            continue;
        }
        if (!Number.isFinite(v))
            continue;
        out[key] = Math.max(1_000, Math.floor(v));
    }
    return out;
}
function expandHome(p) {
    if (p === "~")
        return os.homedir();
    if (p.startsWith("~/"))
        return path.join(os.homedir(), p.slice(2));
    return p;
}
function normalizeMs(ms, defaultValue) {
    if (ms === undefined || !Number.isFinite(ms)) {
        return defaultValue;
    }
    return Math.max(1_000, Math.floor(ms));
}
function normalizeChildStallAction(action) {
    if (action === "report" || action === "abort-resume-parent") {
        return action;
    }
    return DEFAULT_OPTIONS.childStallAction;
}
function normalizeMaxRecoveries(max) {
    if (max === undefined || !Number.isFinite(max)) {
        return DEFAULT_OPTIONS.maxStallRecoveries;
    }
    return Math.max(0, Math.floor(max));
}
function normalizeOutput(output) {
    if (output === "file" || output === "stdout" || output === "stderr" || output === "none") {
        return output;
    }
    return DEFAULT_OPTIONS.output;
}
