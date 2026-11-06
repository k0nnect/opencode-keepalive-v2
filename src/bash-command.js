const QUICK_BINARIES = new Set([
    "cat", "head", "tail", "wc", "echo", "printf", "true", "false",
    "pwd", "which", "type", "basename", "dirname", "realpath", "readlink",
    "ls", "stat", "file", "test", "[", "mkdir", "rm", "mv", "cp", "touch",
    "chmod", "ln", "uniq", "sort", "tr", "cut", "tee", "diff", "cmp",
    "grep", "rg", "ag", "ack",
    "sed", "awk",
    "jq", "yq",
]);
const LONG_BINARIES = new Set([
    "npm", "npx", "pnpm", "yarn", "bun", "node", "deno",
    "tsc", "vitest", "jest", "pytest", "python", "python3",
    "go", "cargo", "rustc", "make", "cmake", "docker", "podman",
    "sleep", "curl", "wget", "ssh", "scp", "rsync", "git",
    "opencode", "vite", "webpack", "esbuild", "rollup",
]);
export function extractBashCommand(args) {
    if (!args || typeof args !== "object")
        return "";
    const a = args;
    const c = a.command ?? a.cmd ?? a.script;
    return typeof c === "string" ? c : "";
}
/** First pipeline/chain segment only. */
function firstSegment(command) {
    const trimmed = command.split("#")[0]?.trim() ?? "";
    // split on |, ||, &&, ; but keep first piece
    return trimmed.split(/(?:&&|\|\||[;|])/).map((s) => s.trim())[0] ?? "";
}
function stripLeadingNoise(segment) {
    let s = segment.trim();
    // env assignments FOO=bar BAZ=1
    while (/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/.test(s)) {
        s = s.replace(/^[A-Za-z_][A-Za-z0-9_]*=\S+\s+/, "");
    }
    // common prefixes
    s = s.replace(/^(?:sudo|command|time|nohup|nice)\s+/i, "");
    return s.trim();
}
function firstToken(segment) {
    const s = stripLeadingNoise(segment);
    if (!s)
        return "";
    // strip leading path: /usr/bin/cat → cat
    const tok = s.split(/\s+/)[0] ?? "";
    const base = tok.split("/").pop() ?? tok;
    return base.toLowerCase();
}
export function classifyBashCommand(command) {
    const segment = firstSegment(command);
    const bin = firstToken(segment);
    if (!bin)
        return "long";
    if (QUICK_BINARIES.has(bin))
        return "quick";
    if (LONG_BINARIES.has(bin))
        return "long";
    return "long"; // fail-safe
}
