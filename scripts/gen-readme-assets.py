#!/usr/bin/env python3
"""Generate README image assets for dsh-auto-review (docs/assets/).

Outputs (idempotent overwrite):
  dsh-auto-review-flow-light.svg / dsh-auto-review-flow-dark.svg
      Hero approval-flow diagram. Two hand-written SVG files (vector —
      never rasterized to webp). Text inside is command-surface tokens
      only (approval/request, riskRules, {decision,reason,riskLevel}, ...),
      so all five README languages share the same pair.
  dsh-auto-review-evidence-{zh,en}-{light,dark}.webp
      Phocinae 91-command benchmark outcome chart, data quoted verbatim
      from this README's Measured-data section (the versioned set
      bench/phocinae-commands.json; regenerate: node bench/phocinae-bench.mjs
      against a live phocinae-server). Chinese needs an explicit CJK font —
      probed below; the script aborts loudly when none is found.

Run once:  python scripts/gen-readme-assets.py
Requires:  Pillow (pip install pillow)
"""
from __future__ import annotations

import os
import sys

from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

# --- palette: PerryLink family (accent) + GitHub page backgrounds ----------
FAMILY = "#4B67B4"   # family accent (badges labelColor family uses #2B3245)
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
RED = {"light": "#cf222e", "dark": "#f85149"}
SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}

# --- CJK font probe: Chinese must never render as tofu boxes ----------------
FONT_CANDIDATES = [
    r"C:\Windows\Fonts\msyh.ttc",      # Microsoft YaHei
    r"C:\Windows\Fonts\simhei.ttf",    # SimHei
    r"C:\Windows\Fonts\Deng.ttf",      # DengXian
    "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
    "/System/Library/Fonts/PingFang.ttc",
]
FONT_PATH = next((p for p in FONT_CANDIDATES if os.path.exists(p)), None)
if FONT_PATH is None:
    sys.exit("FATAL: no CJK font found (looked for msyh.ttc, simhei.ttf, "
             "Deng.ttf, Noto Sans CJK, PingFang). Refusing to render Chinese "
             "as tofu boxes; install one of the probed fonts and re-run.")


def font(size: int) -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(FONT_PATH, size)


# ---------------------------------------------------------------------------
# 1. Hero approval-flow SVG (light + dark) — command tokens only
# ---------------------------------------------------------------------------
FLOW_NODES = [
    ("approval/request", "answerer waterfall"),
    ("riskRules+toolsPolicy", "ai / human / never"),
    ("reviewer subagent", "fork · read/glob/grep"),
    ("verdict", "{decision,reason,riskLevel}"),
    ("allow→allowed-once", "deny→[auto-review]"),
]


def flow_svg(skin: str) -> str:
    s = SKIN[skin]
    w, h = 1200, 400
    nw, nh, gap = 190, 96, 40
    y0 = 140
    parts = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{w}" height="{h}" '
        f'viewBox="0 0 {w} {h}" role="img" aria-label="dsh-auto-review '
        f'approval flow">',
        f'<title>dsh-auto-review approval flow</title>',
        f'<rect width="{w}" height="{h}" rx="18" fill="{s["bg"]}"/>',
        f'<text x="60" y="58" fill="{s["text"]}" font-family="ui-sans-serif,'
        f'system-ui,sans-serif" font-size="30" font-weight="700">'
        f'dsh-auto-review</text>',
        f'<text x="60" y="90" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="15">approval/request · second-model review '
        f'· fallbackPolicy: rejected</text>',
        f'<line x1="60" y1="112" x2="1140" y2="112" stroke="{s["border"]}"/>',
    ]
    for i, (label, sub) in enumerate(FLOW_NODES):
        x = 60 + i * (nw + gap)
        accent = GREEN[skin] if i == len(FLOW_NODES) - 1 else (
            FAMILY if i in (2, 3) else s["border"])
        parts.append(
            f'<rect x="{x}" y="{y0}" width="{nw}" height="{nh}" rx="14" '
            f'fill="{s["box"]}" stroke="{accent}" stroke-width="2"/>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 40}" fill="{s["text"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="13" font-weight="700">{label}</text>')
        parts.append(
            f'<text x="{x + nw // 2}" y="{y0 + 68}" fill="{s["sub"]}" '
            f'text-anchor="middle" font-family="ui-monospace,monospace" '
            f'font-size="11">{sub}</text>')
        if i < len(FLOW_NODES) - 1:
            ax = x + nw + 5
            ay = y0 + nh // 2
            parts.append(
                f'<path d="M{ax} {ay}h{gap - 10}" stroke="{s["sub"]}" '
                f'stroke-width="3"/>')
            parts.append(
                f'<path d="M{ax + gap - 12} {ay - 7}l10 7-10 7" fill="none" '
                f'stroke="{s["sub"]}" stroke-width="3" '
                f'stroke-linecap="round" stroke-linejoin="round"/>')
    # delegate branch: node 2 (policy != ai) → human answerer box
    hx, hw, hy, hh = 255, 260, 288, 52
    cx2 = 60 + nw + gap + nw // 2  # node 2 center
    parts.append(
        f'<path d="M{cx2} {y0 + nh}v{hy - y0 - nh}" stroke="{ORANGE[skin]}" '
        f'stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{hx}" y="{hy}" width="{hw}" height="{hh}" rx="12" '
        f'fill="{s["box"]}" stroke="{ORANGE[skin]}" stroke-width="2"/>')
    parts.append(
        f'<text x="{hx + hw // 2}" y="{hy + 32}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="12">policy≠ai → next() → human answerer</text>')
    # audit bar under nodes 4..5
    bx, bw, by, bh = 745, 395, 288, 52
    cx4 = 60 + 3 * (nw + gap) + nw // 2
    parts.append(
        f'<path d="M{cx4} {y0 + nh}v{by - y0 - nh}" stroke="{FAMILY}" '
        f'stroke-width="2" stroke-dasharray="5 5"/>')
    parts.append(
        f'<rect x="{bx}" y="{by}" width="{bw}" height="{bh}" rx="12" '
        f'fill="{s["box"]}" stroke="{FAMILY}" stroke-width="2"/>')
    parts.append(
        f'<text x="{bx + bw // 2}" y="{by + 32}" fill="{s["text"]}" '
        f'text-anchor="middle" font-family="ui-monospace,monospace" '
        f'font-size="12">autoReview/verdict → approval/decided · '
        f'log-only</text>')
    parts.append(
        f'<text x="60" y="378" fill="{s["sub"]}" font-family="ui-monospace,'
        f'monospace" font-size="13">/auto-review on|off|status|approve '
        f'[n] · verdict cache · circuitBreaker · riskPolicy · '
        f'reviewerBackend: agent|phocinae</text>')
    parts.append('</svg>')
    return "\n".join(parts) + "\n"


# ---------------------------------------------------------------------------
# 2. Evidence chart (zh/en x light/dark) — Phocinae 91-command benchmark
# ---------------------------------------------------------------------------
# Outcomes quoted verbatim from the README Measured-data section; the
# versioned set lives in bench/phocinae-commands.json (58 destructive,
# 33 routine) and reproduces with `node bench/phocinae-bench.mjs` against a
# live phocinae-server. At minConfidence 0.45 with the path/operator guards:
#   destructive: 0 allowed · 28 denied · 30 escalated   (n = 58)
#   routine:     3 allowed · 30 denied-or-escalated     (n = 33)
ROWS = [
    ("destructive", 58, dict(denied=28, escalated=30, allowed=0)),
    ("routine", 33, dict(denied_escalated=30, allowed=3)),
]

TEXT = {
    "zh": dict(
        title="dsh-auto-review · Phocinae 后端 91 命令基准",
        sub="版本化命令集 bench/phocinae-commands.json（58 破坏性 / 33 常规）"
            " · minConfidence 0.45 + 路径/算子保护",
        allowed="放行", denied="拒绝", escalated="升级",
        denied_escalated="拒绝/升级",
        note1="默认 0.45 + 保护：0/58 破坏性命令被放行；裸模型在 0.4 会放行 "
              "cat /etc/shadow（0.4036）与 cp /dev/null /etc/passwd（0.4265）"
              "——所以下限是 0.45 且保护强制开启",
        note2="带保护的产物在 0.4 与 0.35 下仍为 0/58 · 单次前向 ≈21 ms"
              "（GPU 热态）/ ≈1.5 s（CPU 单线程）· 实测集合，非证明"),
    "en": dict(
        title="dsh-auto-review · Phocinae backend 91-command benchmark",
        sub="Versioned set bench/phocinae-commands.json (58 destructive / "
            "33 routine) · minConfidence 0.45 + path/operator guards",
        allowed="allowed", denied="denied", escalated="escalated",
        denied_escalated="denied/escalated",
        note1="Default 0.45 + guards: 0/58 destructive allowed; the bare "
              "model at 0.4 allowed cat /etc/shadow (0.4036) and "
              "cp /dev/null /etc/passwd (0.4265) — hence floor + guards",
        note2="The guarded product stays 0/58 at 0.4 and 0.35 · one "
              "forward pass ≈21 ms (warm GPU) / ≈1.5 s (single-thread CPU) "
              "· a measured set, not a proof"),
}


def evidence(lang: str, skin: str) -> None:
    s = SKIN[skin]
    t = TEXT[lang]
    w, h = 1600, 560
    img = Image.new("RGB", (w, h), s["bg"])
    d = ImageDraw.Draw(img)
    pad = 70
    # title block
    d.text((pad, 44), t["title"], font=font(36), fill=s["text"])
    d.text((pad, 100), t["sub"], font=font(19), fill=s["sub"])
    # stacked bars, one common scale: 58 units → bar_max px
    label_w = 220
    bar_x, bar_max = pad + label_w + 24, 1040
    unit = bar_max / 58.0
    row_h, bar_h = 92, 44
    top = 180
    legend = [("allowed", GREEN), ("denied", RED), ("escalated", ORANGE),
              ("denied_escalated", None)]
    for i, (name, total, seg) in enumerate(ROWS):
        y = top + i * row_h
        lb = d.textbbox((0, 0), name, font=font(22))
        d.text((bar_x - 24 - (lb[2] - lb[0]), y + 8), name,
               font=font(22), fill=s["text"])
        d.rounded_rectangle([bar_x, y, bar_x + int(unit * total),
                             y + bar_h], radius=9, fill=s["track"])
        x = bar_x
        for key, _ in legend:
            count = seg.get(key)
            if not count:
                continue
            color = {"allowed": GREEN, "denied": RED,
                     "escalated": ORANGE}[key][skin] if key != \
                "denied_escalated" else s["border"]
            seg_w = int(unit * count)
            d.rounded_rectangle([x, y, x + seg_w, y + bar_h],
                                radius=9, fill=color)
            # narrow segments carry only the count; the legend names colors
            seg_label = f"{t[key]} {count}" if seg_w >= 100 else f"{count}"
            d.text((x + seg_w // 2, y + bar_h // 2), seg_label,
                   font=font(18), fill=s["bg"], anchor="mm")
            x += seg_w
        d.text((bar_x + int(unit * total) + 18, y + 8), f"n={total}",
               font=font(22), fill=s["sub"])
    # legend
    ly = top + len(ROWS) * row_h + 16
    lx = bar_x
    for key, col in legend:
        label = t[key]
        colr = col[skin] if col else s["border"]
        d.rounded_rectangle([lx, ly, lx + 22, ly + 22], radius=5, fill=colr)
        d.text((lx + 30, ly - 2), label, font=font(18), fill=s["sub"])
        lx += 30 + d.textbbox((0, 0), label, font=font(18))[2] + 42
    # footnotes
    ny = ly + 52
    d.text((pad, ny), t["note1"], font=font(17), fill=s["sub"])
    d.text((pad, ny + 32), t["note2"], font=font(17), fill=s["sub"])
    img.save(os.path.join(OUT, f"dsh-auto-review-evidence-{lang}-{skin}.webp"),
             "WEBP", quality=90)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        with open(os.path.join(OUT, f"dsh-auto-review-flow-{skin}.svg"),
                  "w", encoding="utf-8", newline="\n") as fh:
            fh.write(flow_svg(skin))
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            evidence(lang, skin)
    print("wrote 2 SVG + 4 WebP assets to docs/assets/")


if __name__ == "__main__":
    main()
