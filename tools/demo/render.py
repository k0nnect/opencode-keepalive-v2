# /// script
# requires-python = ">=3.11"
# dependencies = ["pillow>=10.1"]
# ///
"""render the readme demo gif (assets/demo.gif) from a captured heartbeat log.

    uv run tools/demo/render.py tools/demo/.work/heartbeat.ndjson assets/demo.gif

the terminal lines are not typed by hand. every heartbeat in the log is piped
through the same jq filter the gif shows, so each line is exactly what that
command prints. the tail starts after the plugin has loaded (tail -n0), so the
load marker is left out. timing comes from each heartbeat's unixMs, sped up.
"""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
WORK = HERE / ".work"

SCALE = 2
SIZE = (960, 600)
W, H = SIZE[0] * SCALE, SIZE[1] * SCALE

# cream / ink / red page palette, plus lifted tones that read on the dark terminal
CREAM = (0xF3, 0xEF, 0xE6)
INK = (0x16, 0x16, 0x16)
RED = (0xC8, 0x10, 0x2E)
TONE = (0x4A, 0x46, 0x40)
FAINT = (0x9A, 0x94, 0x88)
TEXT = (0xE8, 0xE3, 0xD8)
DIM = (0x86, 0x81, 0x77)
TOOL = (0x8C, 0xA2, 0xFF)
STALL = (0xFF, 0x5D, 0x6C)
OK = (0x6B, 0xD1, 0x96)
CURSOR = (0xC9, 0xC3, 0xB6)
LIGHTS = [(0xFF, 0x5F, 0x57), (0xFE, 0xBC, 0x2E), (0x28, 0xC8, 0x40)]

JQ_FILTER = ".properties | {trigger, eventType, tool, recoveryAction} | del(..|nulls)"
COMMAND = [
    ("$ ", "tail -n0 -f ~/.local/state/opencode-keepalive/heartbeat.ndjson \\"),
    (">   ", f"| jq -c '{JQ_FILTER}'"),
]

MENLO = "/System/Library/Fonts/Menlo.ttc"

# layout, in 2x pixels
MARGIN = 72
WIN = (MARGIN, 60, W - MARGIN, H - 196)
BAR = 62
PAD = 40
FONT_SIZE = 27
LINE = 39
TOP = WIN[1] + BAR + 26
ROWS = (WIN[3] - 22 - TOP) // LINE

TYPE_CHARS = 4  # characters per typing frame
TYPE_MS = 45
END_HOLD_MS = 3400
TITLE_MS = 2200


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(MENLO, size, index=1 if bold else 0)


F_TERM = font(FONT_SIZE)
F_TERM_BOLD = font(FONT_SIZE, bold=True)
F_BAR = font(22)
F_CAPTION = font(32)
F_REPO = font(24)
F_TITLE = font(96, bold=True)
F_TAG = font(40)
F_SUB = font(32)
CHAR = F_TERM.getlength("m")


def captions(stalled_ms: float) -> dict[str, str]:
    return {
        "tail": "tail the heartbeat log",
        "idle": "liveness heartbeats while the agent idles",
        "start": "a subagent picks up a task",
        "tool": "it runs bash: npm test",
        "quiet": "then goes quiet mid-task, still marked busy",
        "stall": f"stall: busy with no progress for {stalled_ms / 1000:g}s (stallMs)",
        "recovery": "keepalive aborts the stuck subagent and nudges its parent",
        "resume": "the parent resumes. your main session is never aborted",
    }


def line_style(trigger: str) -> tuple[tuple[int, int, int], bool]:
    if trigger == "idle":
        return DIM, False
    if trigger.startswith("tool."):
        return TOOL, False
    if trigger == "stall":
        return STALL, True
    if trigger == "stall.recovery":
        return OK, True
    return TEXT, False


def phases(triggers: list[str]) -> list[str]:
    """the caption phase after each output line."""
    out, phase = [], "tail"
    seen_event = seen_tool_after = seen_recovery = False
    for trig in triggers:
        if trig == "stall":
            phase = "stall"
        elif trig == "stall.recovery":
            phase, seen_recovery = "recovery", True
        elif seen_recovery:
            phase = "resume"
        elif trig.startswith("tool."):
            phase = "tool"
            seen_tool_after = seen_tool_after or trig == "tool.execute.after"
        elif trig == "event":
            phase, seen_event = "start", True
        elif trig == "idle":
            if seen_tool_after:
                phase = "quiet"
            elif not seen_event:
                phase = "idle"
        out.append(phase)
    return out


def window() -> Image.Image:
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)
    d.rounded_rectangle(WIN, radius=22, fill=INK)
    cy = WIN[1] + BAR // 2
    for i, colour in enumerate(LIGHTS):
        cx = WIN[0] + 34 + i * 30
        d.ellipse((cx - 9, cy - 9, cx + 9, cy + 9), fill=colour)
    title = "~/.local/state/opencode-keepalive"
    d.text(((WIN[0] + WIN[2]) / 2, cy), title, font=F_BAR, fill=DIM, anchor="mm")
    d.line((WIN[0], WIN[1] + BAR, WIN[2], WIN[1] + BAR), fill=(0x26, 0x26, 0x26), width=2)
    return im


BASE = window()


def terminal(rows: list[list[tuple[str, tuple, bool]]], cursor: tuple[int, int] | None, caption: str) -> Image.Image:
    im = BASE.copy()
    d = ImageDraw.Draw(im)
    offset = max(0, len(rows) - ROWS + (1 if cursor and cursor[0] >= len(rows) else 0))
    x0 = WIN[0] + PAD
    for r, segments in enumerate(rows[offset:]):
        x, y = x0, TOP + r * LINE
        for text, colour, bold in segments:
            f = F_TERM_BOLD if bold else F_TERM
            d.text((x, y), text, font=f, fill=colour)
            x += f.getlength(text)
    if cursor:
        row, col = cursor[0] - offset, cursor[1]
        if 0 <= row < ROWS:
            cx, cy = x0 + col * CHAR, TOP + row * LINE
            d.rectangle((cx, cy + 2, cx + CHAR - 2, cy + LINE - 8), fill=CURSOR)
    y = WIN[3] + 70
    x = MARGIN + 10
    d.ellipse((x, y - 9, x + 18, y + 9), fill=RED)
    d.text((x + 38, y), caption, font=F_CAPTION, fill=TONE, anchor="lm")
    d.text((W - MARGIN, y), "k0nnect/opencode-keepalive-v2", font=F_REPO, fill=FAINT, anchor="rm")
    return im


def title_card() -> Image.Image:
    im = Image.new("RGB", (W, H), CREAM)
    d = ImageDraw.Draw(im)
    name = "opencode-keepalive-v2"
    x = (W - d.textlength(name, font=F_TITLE)) / 2
    y = H / 2 - 40
    d.rectangle((x, y - 128, x + 110, y - 116), fill=RED)
    d.text((x, y), name, font=F_TITLE, fill=INK, anchor="ls")
    d.text((x, y + 76), "keep your coding agent from stalling out", font=F_TAG, fill=TONE, anchor="ls")
    d.text((x, y + 130), "a v2 port of opencode-keepalive, for opencode 2.x", font=F_SUB, fill=FAINT, anchor="ls")
    return im


def load(log: Path) -> tuple[list[str], list[dict]]:
    raw = [line for line in log.read_text().splitlines() if line.strip()]
    beats = [(line, json.loads(line)) for line in raw]
    beats = [(line, b) for line, b in beats if b.get("type") == "heartbeat"]
    if not beats:
        sys.exit(f"no heartbeats in {log}")
    if not shutil.which("jq"):
        sys.exit("jq is required")
    res = subprocess.run(
        ["jq", "-c", JQ_FILTER],
        input="\n".join(line for line, _ in beats) + "\n",
        capture_output=True,
        text=True,
        check=True,
    )
    printed = res.stdout.splitlines()
    if len(printed) != len(beats):
        sys.exit(f"jq printed {len(printed)} lines for {len(beats)} heartbeats")
    return printed, [b["properties"] for _, b in beats]


def build(printed: list[str], props: list[dict], speed: float) -> list[tuple[Image.Image, int]]:
    triggers = [p["trigger"] for p in props]
    stalled = next((p.get("stalledForMs", 0) for p in props if p["trigger"] == "stall"), 0)
    text = captions(stalled)
    phase_after = phases(triggers)
    frames: list[tuple[Image.Image, int]] = [(title_card(), TITLE_MS)]

    # type the command
    rows: list[list[tuple[str, tuple, bool]]] = []
    for i, (prompt, cmd) in enumerate(COMMAND):
        rows.append([(prompt, TEXT if i == 0 else DIM, i == 0)])
        frames.append((terminal(rows, (len(rows) - 1, len(prompt)), text["tail"]), 600 if i == 0 else 250))
        for n in range(TYPE_CHARS, len(cmd) + TYPE_CHARS, TYPE_CHARS):
            typed = cmd[:n]
            rows[-1] = [(prompt, TEXT if i == 0 else DIM, i == 0), (typed, TEXT, False)]
            frames.append((terminal(rows, (len(rows) - 1, len(prompt) + len(typed)), text["tail"]), TYPE_MS))
        frames[-1] = (frames[-1][0], 450 if i == len(COMMAND) - 1 else 250)

    # output, paced by the real timestamps
    stamps = [p["unixMs"] for p in props]
    for i, line in enumerate(printed):
        if i == 0:
            hold = 900
        else:
            hold = min(850, max(280, (stamps[i] - stamps[i - 1]) / speed))
            if triggers[i - 1] in ("stall", "stall.recovery"):
                hold = max(hold, 1800)
        # the frame before this line (prompt waiting, or the previous line) holds until it appears
        if i == 0:
            frames.append((terminal(rows, (len(rows), 0), text["tail"]), hold))
        else:
            frames[-1] = (frames[-1][0], int(hold))
        colour, bold = line_style(triggers[i])
        rows.append([(line, colour, bold)])
        frames.append((terminal(rows, (len(rows), 0), text[phase_after[i]]), END_HOLD_MS))
    return frames


def encode(frames: list[tuple[Image.Image, int]], out: Path) -> None:
    small = [im.resize(SIZE, Image.Resampling.LANCZOS) for im, _ in frames]
    # one global palette, built from the title card, the finished terminal and a
    # strip of every pure colour, so small accents (window lights, the stall line)
    # keep their exact tone instead of being absorbed by the larger areas
    swatches = [CREAM, INK, RED, TONE, FAINT, TEXT, DIM, TOOL, STALL, OK, CURSOR, *LIGHTS]
    strip = 80
    sample = Image.new("RGB", (SIZE[0], SIZE[1] * 2 + strip), CREAM)
    sample.paste(small[0], (0, 0))
    sample.paste(small[-1], (0, SIZE[1]))
    d = ImageDraw.Draw(sample)
    width = SIZE[0] // len(swatches)
    for i, colour in enumerate(swatches):
        d.rectangle((i * width, SIZE[1] * 2, (i + 1) * width - 1, SIZE[1] * 2 + strip - 1), fill=colour)
    palette = sample.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
    paletted = [im.quantize(palette=palette, dither=Image.Dither.NONE) for im in small]
    out.parent.mkdir(parents=True, exist_ok=True)
    paletted[0].save(
        out,
        save_all=True,
        append_images=paletted[1:],
        duration=[int(ms) for _, ms in frames],
        loop=0,
        disposal=1,
        optimize=False,
    )


def verify(out: Path) -> None:
    sheets = WORK / "frames"
    shutil.rmtree(sheets, ignore_errors=True)
    sheets.mkdir(parents=True)
    with Image.open(out) as gif:
        n, total = gif.n_frames, 0
        for i in range(n):
            gif.seek(i)
            ms = gif.info.get("duration", 0)
            total += ms
            # title, mid-typing, the held stall and recovery beats, and the last frame
            if i in (0, n // 4, n - 1) or 1700 <= ms < END_HOLD_MS:
                gif.convert("RGB").save(sheets / f"frame-{i:03d}.png")
        size = gif.size
    kb = out.stat().st_size / 1024
    print(f"[render] {out.relative_to(ROOT)}: {size[0]}x{size[1]}, {n} frames, {total / 1000:.1f}s loop, {kb:.0f} KB")
    print(f"[render] key frames for a look: {sheets.relative_to(ROOT)}/")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("log", type=Path, nargs="?", default=WORK / "heartbeat.ndjson")
    ap.add_argument("out", type=Path, nargs="?", default=ROOT / "assets" / "demo.gif")
    ap.add_argument("--speed", type=float, default=1.5, help="how much faster than real time the output plays")
    args = ap.parse_args()
    printed, props = load(args.log)
    frames = build(printed, props, args.speed)
    encode(frames, args.out.resolve())
    verify(args.out.resolve())


if __name__ == "__main__":
    main()
