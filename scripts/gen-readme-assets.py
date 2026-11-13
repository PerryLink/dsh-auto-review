#!/usr/bin/env python3
"""README visuals for dsh-auto-review: hero banner + claim-funnel structure.

Both figures are derived from this repo's runtime, not from the prose.

  * `src/runtime.ts` `answerCore()` is an `approval/request` answerer mounted
    with `{ prepend: true }`. It claims a request only when the session is
    enabled (`autoReview/state` override, else `enableByDefault`), the resolved
    policy is `ai` (risk rules first match over `reason` / `toolName` /
    `arguments`, then `toolsPolicy`), both per-turn budgets remain
    (`maxReviewsPerTurn` verdicts, `maxFailuresPerTurn` failures), the denial
    circuit breaker is not tripped, and the pending `approval/asked` event can
    be correlated. Everything else delegates through `next()`; `never`
    rejects deterministically without a reviewer.
  * The reviewer room has two backends (`src/review.ts`): the one-shot child /
    structured-output agent seam with the read-only `read`/`glob`/`grep`
    allow-list behind the `agent/pre-step` context firewall, or the local
    non-generative `phocinae` backend (Phocinae-Largha-150M-v1 over loopback).
    Evidence is the redacted arguments, the calling model's self-reported
    reason, the risk-rule list and the bounded `contextBudget` transcript.
  * The verdict contract is `{decision, reason, riskLevel}`. `riskPolicy`
    (maxAutoAllow / onHighRisk), the same-fingerprint verdict cache (only when
    `contextBudget.turns: 0`) and `fallbackPolicy` settle it into three exits:
    `allow` → `allowed-once`, `deny` → `rejected` with the reason injected into
    the denied tool result by the `tools/post-execute` listener (callId-linked),
    or `fallback` → rejected by default.
  * Audit is log-only: `approval/asked` → `autoReview/verdict` |
    `autoReview/rejection` → `approval/decided`, with `ignorable: true`
    envelopes; the `autoReview` session projection feeds the Web panel.

Hero: the review docket — one claimed request, the evidence it authorises the
reviewer to read, the two backends behind one verdict contract, the deny
receipt, and the three exits, with the reason returning to the denied tool
result. Deliberately NOT the admission order; that is figure two.

Flow (docs/assets/…-flow-v5-*.svg): a claim funnel — four gates narrow every
boundary-crossing request down to the reviewer room and the three outcome
doors, with the delegation lane and the deterministic-close lane on the right
and the log-only audit chain closing the bottom. Not a row of five boxes.

Fonts: Microsoft YaHei (msyh.ttc / msyhbd.ttc) for CJK, Consolas for mono,
Segoe UI for the Latin copy.

Run:  python scripts/gen-readme-assets.py
"""
from __future__ import annotations

import os
from html import escape

from PIL import Image, ImageDraw, ImageFilter, ImageFont

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "assets")

FONT_CJK = r"C:\Windows\Fonts\msyh.ttc"
FONT_CJK_BOLD = r"C:\Windows\Fonts\msyhbd.ttc"
FONT_MONO = r"C:\Windows\Fonts\consola.ttf"
FONT_MONO_BOLD = r"C:\Windows\Fonts\consolab.ttf"
FONT_EN = r"C:\Windows\Fonts\segoeui.ttf"
FONT_EN_BOLD = r"C:\Windows\Fonts\segoeuib.ttf"

for _p in (FONT_CJK, FONT_CJK_BOLD, FONT_MONO, FONT_MONO_BOLD,
           FONT_EN, FONT_EN_BOLD):
    if not os.path.exists(_p):
        raise SystemExit(f"FATAL: font missing: {_p}")

KIND = {
    "cjk": FONT_CJK,
    "cjk_bold": FONT_CJK_BOLD,
    "mono": FONT_MONO,
    "mono_bold": FONT_MONO_BOLD,
    "en": FONT_EN,
    "en_bold": FONT_EN_BOLD,
}

# Family palette: accent #4B67B4 (dark #8496f5); page gradients #f9f6fd→#e4eaf8
# and #131a2a→#0c1016; radius 18–22; soft shadows.
SKIN = {
    "light": dict(
        bg_from="#f9f6fd", bg_to="#e4eaf8",
        card="#ffffff", card_edge="#e5e0f2",
        text="#17151f", sub="#4c5160", faint="#8a8fa2",
        accent="#4B67B4", pill="#ece7f9", grid="#ece8f5",
        allow="#24785f", warn="#a3681a", deny="#ad3a4e",
        shadow=(38, 30, 68),
    ),
    "dark": dict(
        bg_from="#131a2a", bg_to="#0c1016",
        card="#1b2231", card_edge="#2d364a",
        text="#eef2fa", sub="#a8b1c4", faint="#737d92",
        accent="#8496f5", pill="#242d42", grid="#242c3d",
        allow="#6fd3ac", warn="#e2ae57", deny="#f08a9c",
        shadow=(0, 0, 0),
    ),
}

# The measured-data chart keeps its own neutral GitHub-page palette.
EV_SKIN = {
    "light": dict(bg="#ffffff", box="#f6f8fa", border="#d0d7de",
                  text="#1f2328", sub="#57606a", track="#eaeef2"),
    "dark": dict(bg="#0d1117", box="#161b22", border="#30363d",
                 text="#f0f6fc", sub="#8b949e", track="#21262d"),
}
GREEN = {"light": "#16a34a", "dark": "#3fb950"}
ORANGE = {"light": "#bc4c00", "dark": "#d29922"}
RED = {"light": "#cf222e", "dark": "#f85149"}
FAMILY = "#4B67B4"


# ── small colour / font helpers ─────────────────────────────────────────────

def font(size: float, kind: str = "cjk_bold") -> ImageFont.FreeTypeFont:
    return ImageFont.truetype(KIND[kind], int(size))


def hx(value) -> tuple:
    if isinstance(value, tuple):
        return value[:3]
    value = value.lstrip("#")
    return tuple(int(value[i:i + 2], 16) for i in (0, 2, 4))


def blend(a, b, t: float):
    """Paint colour a over base b at t (t = how much of a survives)."""
    pa, pb = hx(a), hx(b)
    return tuple(int(y * (1 - t) + x * t) for x, y in zip(pa, pb))


def gradient(w: int, h: int, c1: str, c2: str) -> Image.Image:
    img = Image.new("RGB", (w, h))
    d = ImageDraw.Draw(img)
    a, b = hx(c1), hx(c2)
    for y in range(h):
        t = 0.34 * (y / h) + 0.66 * (y / h) ** 1.55
        d.line([(0, y), (w, y)],
               fill=tuple(int(p + (q - p) * t) for p, q in zip(a, b)))
    return img


def glow(img: Image.Image, cx: int, cy: int, r: int, color, alpha: int):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    for i in range(12, 0, -1):
        rr = r * i / 12
        d.ellipse([cx - rr, cy - rr, cx + rr, cy + rr],
                  fill=color + (int(alpha * (1 - i / 13)),))
    return Image.alpha_composite(img.convert("RGBA"), layer).convert("RGB")


def soft_card(img: Image.Image, box, skin, radius=20, lift=11, strength=1.0,
              outline=None, width=2) -> Image.Image:
    x0, y0, x1, y1 = box
    sh = Image.new("RGBA", img.size, (0, 0, 0, 0))
    sd = ImageDraw.Draw(sh)
    sd.rounded_rectangle([x0 + 1, y0 + lift, x1 + 1, y1 + lift + 3],
                         radius=radius,
                         fill=hx(skin["shadow"]) + (int(34 * strength),))
    base = Image.alpha_composite(img.convert("RGBA"),
                                 sh.filter(ImageFilter.GaussianBlur(14)))
    d = ImageDraw.Draw(base)
    d.rounded_rectangle(box, radius=radius, fill=hx(skin["card"]),
                        outline=hx(outline or skin["card_edge"]), width=width)
    return base.convert("RGB")


def fit(d: ImageDraw.ImageDraw, text: str, maxw: float, start: int,
        kind: str, floor: int) -> ImageFont.FreeTypeFont:
    size = start
    while size > floor:
        f = font(size, kind)
        if d.textlength(text, font=f) <= maxw:
            return f
        size -= 1
    return font(floor, kind)


def chip(img: Image.Image, x: int, y: int, text: str, f, fg, bg,
         h: int = 26, padx: int = 12) -> int:
    d = ImageDraw.Draw(img)
    w = int(d.textlength(text, font=f)) + 2 * padx
    d.rounded_rectangle([x, y, x + w, y + h], radius=h // 2, fill=hx(bg))
    d.text((x + padx, y + h / 2 + 1), text, font=f, fill=hx(fg), anchor="lm")
    return w


def tint(skin, color, t: float) -> tuple:
    return blend(color, skin["card"], t)


# ── hero ────────────────────────────────────────────────────────────────────

HERO = {
    "zh": dict(
        kicker="DeepSeek Harness · 审批链第二模型",
        eyebrow="dsh-auto-review",
        title="先审后放",
        value=["把裁决交给第二个模型，", "每个拒绝都带着理由回来。"],
        sub="只读审查 · 失败关闭 · 会话日志可重建",
        meta="agent / phocinae 双后端 · 默认 rejected",
        foot="Apache-2.0 · github.com/PerryLink/dsh-auto-review",
        req_label="approval/request",
        req_right="prepend · answerer",
        req_chip1="bash",
        req_chip2="ai 策略",
        req_gate="riskRules 首匹配 → ai",
        req_reason="reason：调用方自述 · 仅作证据",
        ev_head="证据",
        ev_tag="read-only",
        ev_rows=[("工作区", "read/glob/grep"),
                 ("调用参数", "按键名 + 内联脱敏"),
                 ("风险规则", "首匹配已解析"),
                 ("会话记录", "2 轮 / 4000 字"),
                 ("审批理由", "调用方自述")],
        ev_foot="不执行 · 不写盘",
        rv_head="审查室",
        rv_tag="one-shot",
        rv_a=("agent 后端", "fork · read/glob/grep", "上下文防火墙"),
        rv_b=("phocinae 后端", "150M · loopback", "单次前向 ≈21 ms"),
        rv_foot=("60 s 截止", "失败不走放行"),
        dk_head="裁决",
        dk_tag="autoReview/verdict",
        dk_decision="deny",
        dk_reason=["参数被截断，", "证据不足"],
        dk_risk="riskLevel",
        dk_risk_value="high",
        dk_ids=["reviewId · approvalId", "provider · durationMs"],
        al_head="allow", al_detail="→ allowed-once", al_note="不产生持久授权",
        fb_head="fallback", fb_detail="→ rejected（默认）",
        fb_note="delegate · allow-once",
        dn_head="deny", dn_detail="理由 → 被拒工具结果",
        dn_note="[auto-review] · callId",
        au1="approval/asked → autoReview/verdict | autoReview/rejection → approval/decided",
        au2="仅日志 · 信封 ignorable",
        au3="autoReview 投影 → Web 面板",
    ),
    "en": dict(
        kicker="DeepSeek Harness · second-model approval",
        eyebrow="dsh-auto-review",
        title="Review first.",
        value=["A second model reads the evidence,",
               "so every denial explains itself."],
        sub="read-only · fail-closed · every verdict logged",
        meta="agent | phocinae backends · fallback rejected",
        foot="Apache-2.0 · github.com/PerryLink/dsh-auto-review",
        req_label="approval/request",
        req_right="prepend · answerer",
        req_chip1="bash",
        req_chip2="ai policy",
        req_gate="riskRules first match → ai",
        req_reason="reason: caller self-report · evidence only",
        ev_head="evidence",
        ev_tag="read-only",
        ev_rows=[("workspace", "read/glob/grep"),
                 ("args", "key + inline redaction"),
                 ("risk rules", "first match resolved"),
                 ("transcript", "2 turns / 4000 chars"),
                 ("reason", "caller self-report")],
        ev_foot="never executes · never writes",
        rv_head="reviewer room",
        rv_tag="one-shot",
        rv_a=("agent backend", "fork · read/glob/grep", "context firewall"),
        rv_b=("phocinae backend", "150M · loopback", "≈21 ms per forward"),
        rv_foot=("60 s deadline", "failure never grants"),
        dk_head="verdict",
        dk_tag="autoReview/verdict",
        dk_decision="deny",
        dk_reason=["arguments truncated,", "evidence insufficient"],
        dk_risk="riskLevel",
        dk_risk_value="high",
        dk_ids=["reviewId · approvalId", "provider · durationMs"],
        al_head="allow", al_detail="→ allowed-once", al_note="no persistent grant",
        fb_head="fallback", fb_detail="→ rejected (default)",
        fb_note="delegate · allow-once",
        dn_head="deny", dn_detail="reason → denied tool result",
        dn_note="[auto-review] · callId",
        au1="approval/asked → autoReview/verdict | autoReview/rejection → approval/decided",
        au2="log-only · ignorable envelope",
        au3="autoReview projection → Web panel",
    ),
}

W, H = 1440, 576
COL_X, COL_W = 72, 500


def hero(lang: str, skin: str) -> None:
    s = SKIN[skin]
    Hd = HERO[lang]
    zh = lang == "zh"
    light = skin == "light"

    img = gradient(W, H, s["bg_from"], s["bg_to"])
    img = glow(img, 1210, 58, 420, hx(s["accent"]), 24 if light else 46)
    img = glow(img, 210, 600, 330, hx(s["accent"]), 8 if light else 14)
    d = ImageDraw.Draw(img)

    # faint column rule between copy and the docket composition
    d.line([(588, 62), (588, 520)], fill=hx(s["grid"]), width=2)

    # ── left column ────────────────────────────────────────────────────────
    fk = font(18, "cjk_bold" if zh else "en_bold")
    kw = d.textlength(Hd["kicker"], font=fk)
    pill_x, pill_y, pill_h = COL_X, 58, 38
    d.rounded_rectangle([pill_x, pill_y, pill_x + kw + 62, pill_y + pill_h],
                        radius=pill_h // 2, fill=hx(s["pill"]))
    # a "2" badge: the second model, drawn as the pill's leading mark
    d.ellipse([pill_x + 13, pill_y + 8, pill_x + 35, pill_y + 30],
              fill=hx(s["accent"]))
    d.text((pill_x + 24, pill_y + 19), "2", font=font(13, "en_bold"),
           fill=hx(s["pill"]), anchor="mm")
    d.text((pill_x + 44, pill_y + 8), Hd["kicker"], font=fk,
           fill=hx(s["accent"]))
    assert pill_x + kw + 62 <= COL_X + COL_W, "kicker overflows"

    d.text((COL_X, 112), Hd["eyebrow"], font=font(26, "mono"),
           fill=hx(s["accent"]))

    f_title = fit(d, Hd["title"], COL_W, 84,
                  "cjk_bold" if zh else "en_bold", floor=80)
    assert f_title.size >= 80, (lang, f_title.size)
    d.text((COL_X, 152), Hd["title"], font=f_title, fill=hx(s["text"]))

    y = 268
    for line in Hd["value"]:
        f_v = fit(d, line, COL_W, 32,
                  "cjk_bold" if zh else "en_bold", floor=28)
        assert d.textlength(line, font=f_v) <= COL_W, line
        d.text((COL_X, y), line, font=f_v, fill=hx(s["text"]))
        y += 40

    f_sub = fit(d, Hd["sub"], COL_W, 25, "cjk" if zh else "en", floor=24)
    assert d.textlength(Hd["sub"], font=f_sub) <= COL_W, Hd["sub"]
    d.text((COL_X, 362), Hd["sub"], font=f_sub, fill=hx(s["sub"]))

    f_meta = fit(d, Hd["meta"], COL_W, 20, "cjk" if zh else "en", floor=19)
    assert d.textlength(Hd["meta"], font=f_meta) <= COL_W, Hd["meta"]
    d.text((COL_X, 404), Hd["meta"], font=f_meta, fill=hx(s["faint"]))
    d.line([COL_X, 446, COL_X + COL_W, 446], fill=hx(s["grid"]), width=2)

    f_foot = font(16, "mono")
    assert d.textlength(Hd["foot"], font=f_foot) <= COL_W, "footer overflows"
    d.text((COL_X, 458), Hd["foot"], font=f_foot, fill=hx(s["faint"]))

    # ── right: one claimed request ─────────────────────────────────────────
    img = soft_card(img, (612, 44, 1368, 152), s, radius=20, lift=10,
                    strength=0.85)
    d = ImageDraw.Draw(img)
    d.text((636, 66), Hd["req_label"], font=font(13, "mono"),
           fill=hx(s["accent"]))
    d.text((1344, 68), Hd["req_right"], font=font(11, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    x = 636
    x += chip(img, x, 84, Hd["req_chip1"], font(14, "mono"), s["card"],
              s["accent"], h=28) + 10
    x += chip(img, x, 84, Hd["req_chip2"], font(13, "cjk_bold" if zh else "en_bold"),
              s["accent"], tint(s, s["accent"], 0.13), h=28, padx=13) + 12
    f_gate = font(12.5, "cjk" if zh else "mono")
    assert x + d.textlength(Hd["req_gate"], font=f_gate) <= 1336, "gate line"
    d.text((x, 92), Hd["req_gate"], font=f_gate, fill=hx(s["sub"]),
           anchor="lm")
    f_reason = font(12, "cjk" if zh else "en")
    d.text((636, 130), Hd["req_reason"], font=f_reason, fill=hx(s["faint"]))

    # ── right: the evidence folder ────────────────────────────────────────
    img = soft_card(img, (612, 168, 884, 392), s, radius=18, lift=9,
                    strength=0.8)
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([636, 157, 758, 174], radius=8, fill=hx(s["card"]),
                        outline=hx(s["card_edge"]), width=2)
    d.text((646, 165), "evidence", font=font(11, "mono"),
           fill=hx(s["faint"]), anchor="lm")
    d.text((636, 188), Hd["ev_head"],
           font=font(18, "cjk_bold" if zh else "en_bold"), fill=hx(s["text"]))
    d.text((860, 190), Hd["ev_tag"], font=font(11, "mono"),
           fill=hx(s["accent"]), anchor="ra")
    d.line([636, 204, 860, 204], fill=hx(s["grid"]), width=2)
    row_y = 224
    for label, detail in Hd["ev_rows"]:
        f_l = font(13, "cjk_bold" if zh else "en_bold")
        f_d = font(11.5, "mono" if detail.isascii() else "cjk")
        d.text((636, row_y), label, font=f_l, fill=hx(s["sub"]), anchor="la")
        assert d.textlength(detail, font=f_d) <= 160, detail
        d.text((860, row_y + 1), detail, font=f_d, fill=hx(s["faint"]),
               anchor="ra")
        row_y += 30
    d.text((636, 358), Hd["ev_foot"], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]))

    # ── right: the reviewer room, two backends ────────────────────────────
    img = soft_card(img, (900, 168, 1112, 392), s, radius=18, lift=9,
                    strength=0.8)
    d = ImageDraw.Draw(img)
    d.text((920, 188), Hd["rv_head"],
           font=font(17, "cjk_bold" if zh else "en_bold"), fill=hx(s["text"]))
    d.text((1092, 189), Hd["rv_tag"], font=font(11, "mono"),
           fill=hx(s["accent"]), anchor="ra")
    for idx, block in enumerate((Hd["rv_a"], Hd["rv_b"])):
        top = 204 + idx * 72
        d.rounded_rectangle([920, top, 1092, top + 62], radius=13,
                            fill=tint(s, s["accent"], 0.055),
                            outline=tint(s, s["accent"], 0.26), width=1)
        head, l2, l3 = block
        d.text((932, top + 9), head,
               font=font(14, "cjk_bold" if zh else "en_bold"),
               fill=hx(s["text"]))
        d.text((932, top + 31), l2, font=font(11, "mono"),
               fill=hx(s["sub"]))
        d.text((932, top + 47), l3,
               font=font(11, "cjk" if zh else "en"), fill=hx(s["faint"]))
    d.text((920, 352), Hd["rv_foot"][0], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]))
    d.text((920, 368), Hd["rv_foot"][1], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]))

    # ── right: the verdict docket ──────────────────────────────────────────
    img = soft_card(img, (1128, 168, 1368, 392), s, radius=18, lift=9,
                    strength=0.85,
                    outline=tint(s, s["deny"], 0.32), width=2)
    d = ImageDraw.Draw(img)
    d.text((1148, 188), Hd["dk_head"],
           font=font(17, "cjk_bold" if zh else "en_bold"), fill=hx(s["sub"]))
    d.text((1348, 190), Hd["dk_tag"], font=font(11, "mono"),
           fill=hx(s["faint"]), anchor="ra")
    d.text((1146, 202), Hd["dk_decision"], font=font(46, "mono_bold"),
           fill=hx(s["deny"]))
    ry = 264
    for line in Hd["dk_reason"]:
        f_r = fit(d, line, 200, 13, "cjk" if zh else "en", floor=12)
        d.text((1148, ry), line, font=f_r, fill=hx(s["sub"]))
        ry += 22
    d.line([1148, 306, 1348, 306], fill=hx(s["grid"]), width=2)
    d.text((1148, 318), Hd["dk_risk"], font=font(11, "mono"),
           fill=hx(s["faint"]))
    bars = 3 if Hd["dk_risk_value"] == "high" else 2
    for i in range(3):
        bx = 1240 + i * 20
        d.rounded_rectangle([bx, 320, bx + 14, 328], radius=3,
                            fill=hx(s["deny"] if i < bars else s["grid"]))
    d.text((1348, 318), Hd["dk_risk_value"],
           font=font(12, "cjk_bold" if zh else "en_bold"),
           fill=hx(s["deny"]), anchor="ra")
    d.text((1148, 340), Hd["dk_ids"][0], font=font(11, "mono"),
           fill=hx(s["faint"]))
    d.text((1148, 358), Hd["dk_ids"][1], font=font(11, "mono"),
           fill=hx(s["faint"]))

    # ── right: the three exits, with the feedback hook ────────────────────
    img = soft_card(img, (612, 408, 884, 496), s, radius=18, lift=9,
                    strength=0.75, outline=tint(s, s["allow"], 0.28))
    d = ImageDraw.Draw(img)
    d.text((636, 420), Hd["al_head"], font=font(21, "mono_bold"),
           fill=hx(s["allow"]))
    d.text((636, 450), Hd["al_detail"], font=font(12, "mono"),
           fill=hx(s["sub"]))
    d.text((636, 472), Hd["al_note"], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]))

    img = soft_card(img, (900, 408, 1112, 496), s, radius=18, lift=9,
                    strength=0.75, outline=tint(s, s["warn"], 0.28))
    d = ImageDraw.Draw(img)
    d.text((920, 420), Hd["fb_head"], font=font(17, "mono_bold"),
           fill=hx(s["warn"]))
    d.text((920, 448), Hd["fb_detail"], font=font(12, "cjk" if zh else "en"),
           fill=hx(s["sub"]))
    d.text((920, 472), Hd["fb_note"], font=font(11, "mono"),
           fill=hx(s["faint"]))

    img = soft_card(img, (1128, 408, 1368, 496), s, radius=18, lift=9,
                    strength=0.8, outline=tint(s, s["deny"], 0.30))
    d = ImageDraw.Draw(img)
    d.text((1148, 420), Hd["dn_head"], font=font(21, "mono_bold"),
           fill=hx(s["deny"]))
    d.text((1148, 450), Hd["dn_detail"],
           font=font(12, "cjk" if zh else "en"), fill=hx(s["sub"]))
    d.text((1148, 472), Hd["dn_note"], font=font(11, "mono"),
           fill=hx(s["faint"]))
    # the docket's deny receipt hands its reason to the denied tool result
    d.line([1248, 392, 1248, 404], fill=hx(s["deny"]), width=2)
    d.polygon([(1244, 402), (1252, 402), (1248, 408)], fill=hx(s["deny"]))

    # arrows: evidence → reviewer → verdict
    for ax in (886, 1114):
        d.line([ax, 272, ax + 11, 272], fill=hx(s["accent"]), width=2)
        d.polygon([(ax + 9, 268), (ax + 9, 276), (ax + 15, 272)],
                  fill=hx(s["accent"]))

    # ── right: the log-only audit chain ────────────────────────────────────
    d.text((612, 512), Hd["au1"], font=font(12.5, "mono"),
           fill=hx(s["accent"]))
    d.text((612, 532), Hd["au2"], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]))
    d.text((1368, 532), Hd["au3"], font=font(11, "cjk" if zh else "en"),
           fill=hx(s["faint"]), anchor="ra")

    path = os.path.join(OUT, f"dsh-auto-review-hero-{lang}-{skin}.webp")
    img.save(path, "WEBP", quality=92, method=6)
    print(f"wrote {os.path.relpath(path, ROOT)}")


# ── flow diagram (hand-written SVG): the claim funnel ──────────────────────

SANS = "Segoe UI, Microsoft YaHei, PingFang SC, Noto Sans CJK SC, sans-serif"
MONO = "Consolas, SFMono-Regular, Menlo, monospace"


def flow_svg(skin: str) -> None:
    s = SKIN[skin]
    Wd, Ht = 1100, 660
    light = skin == "light"
    shadow_op = "0.13" if light else "0.48"
    e = []

    def add(x):
        e.append(x)

    def tint(c, t):
        return "#%02x%02x%02x" % blend(c, s["card"], t)

    def txt(x, y, body, size=15, color=None, weight="400", mono=False,
            anchor="start"):
        fam = MONO if mono else SANS
        add(f'<text x="{x}" y="{y}" fill="{color or s["text"]}" '
            f'font-family="{fam}" font-size="{size}" font-weight="{weight}" '
            f'text-anchor="{anchor}">{escape(body)}</text>')

    def rect(x, y, w, h, r=16, fill=None, stroke=None, sw=1.5, shadow=False):
        g = (f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{r}" '
             f'fill="{fill or s["card"]}"')
        if stroke:
            g += f' stroke="{stroke}" stroke-width="{sw}"'
        g += "/>"
        add(f'<g filter="url(#soft)">{g}</g>' if shadow else g)

    def poly(points, fill, stroke=None, sw=1.4):
        pts = " ".join(f"{x},{y}" for x, y in points)
        add(f'<polygon points="{pts}" fill="{fill}"'
            + (f' stroke="{stroke}" stroke-width="{sw}"' if stroke else "")
            + "/>")

    def line(x1, y1, x2, y2, stroke, w=2, dash=None, marker=None):
        g = (f'<line x1="{x1}" y1="{y1}" x2="{x2}" y2="{y2}" '
             f'stroke="{stroke}" stroke-width="{w}" stroke-linecap="round"')
        if dash:
            g += f' stroke-dasharray="{dash}"'
        if marker:
            g += f' marker-end="url(#{marker})"'
        add(g + "/>")

    def path(d, stroke, w=2, marker=None, dash=None):
        g = (f'<path d="{d}" fill="none" stroke="{stroke}" stroke-width="{w}" '
             f'stroke-linecap="round" stroke-linejoin="round"')
        if dash:
            g += f' stroke-dasharray="{dash}"'
        if marker:
            g += f' marker-end="url(#{marker})"'
        add(g + "/>")

    add(f'<svg xmlns="http://www.w3.org/2000/svg" width="{Wd}" height="{Ht}" '
        f'viewBox="0 0 {Wd} {Ht}" role="img" aria-labelledby="fig-title">')
    add('<title id="fig-title">dsh-auto-review — the claim funnel: four gates '
        '(session, ai policy, per-turn budgets, circuit) narrow every '
        'boundary-crossing approval/request down to the read-only reviewer '
        'room and three outcome doors (allow, deny, fallback); non-ai and '
        'unavailable requests bypass through next() to the human answerer, '
        'never and reviewer failures close deterministically, and the log-only '
        'audit chain runs underneath</title>')
    add("<defs>")
    add('<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">'
        f'<stop offset="0" stop-color="{s["bg_from"]}"/>'
        f'<stop offset="1" stop-color="{s["bg_to"]}"/></linearGradient>')
    add(f'<filter id="soft" x="-30%" y="-30%" width="170%" height="185%">'
        f'<feDropShadow dx="0" dy="7" stdDeviation="10" flood-color="#1b1735" '
        f'flood-opacity="{shadow_op}"/></filter>')
    add('<marker id="arr" viewBox="0 0 10 10" refX="8.5" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0.5 0.5 L9.5 5 L0.5 9.5 z" fill="{s["accent"]}"/></marker>')
    add('<marker id="arrw" viewBox="0 0 10 10" refX="8.5" refY="5" '
        f'markerWidth="7" markerHeight="7" orient="auto-start-reverse">'
        f'<path d="M0.5 0.5 L9.5 5 L0.5 9.5 z" fill="{s["warn"]}"/></marker>')
    add("</defs>")
    add(f'<rect width="{Wd}" height="{Ht}" rx="22" fill="url(#bg)"/>')
    add(f'<circle cx="1040" cy="92" r="220" fill="{s["accent"]}" '
        f'opacity="{0.05 if light else 0.10}"/>')

    # ── header ────────────────────────────────────────────────────────────
    txt(44, 50, "dsh-auto-review · claim funnel", 23, s["text"], "700")
    txt(44, 78, "every boundary-crossing request is filtered by four claim "
        "gates; only ai policy reaches the reviewer", 15, s["sub"])
    txt(1056, 50, "src/runtime.ts · answerCore()", 14, s["faint"], mono=True,
        anchor="end")
    txt(1056, 74, "/auto-review on|off|status|approve [n]", 14, s["accent"],
        mono=True, anchor="end")
    line(44, 94, 1056, 94, s["grid"], 1.5)

    # ── funnel body: stage connectors first, cards on top ─────────────────
    poly([(48, 182), (548, 182), (506, 196), (90, 196)],
         tint(s["accent"], 0.05))
    poly([(90, 264), (506, 264), (464, 278), (132, 278)],
         tint(s["accent"], 0.05))
    poly([(132, 358), (464, 358), (422, 372), (174, 372)],
         tint(s["accent"], 0.05))
    poly([(174, 440), (422, 440), (383, 478), (213, 478)],
         tint(s["accent"], 0.10), tint(s["accent"], 0.30), 1.2)

    stages = [
        (48, 104, 500, 78, 20, tint(s["accent"], 0.38)),
        (90, 196, 416, 68, 18, s["card_edge"]),
        (132, 278, 332, 80, 18, s["card_edge"]),
        (174, 372, 248, 68, 18, s["card_edge"]),
    ]
    for (x, y, w, h, r, stroke) in stages:
        rect(x, y, w, h, r, s["card"], stroke, 1.7 if r == 20 else 1.4,
             shadow=True)

    # stage 1 — claim gate
    txt(68, 132, "① claim gate", 17, s["text"], "700")
    txt(528, 132, "claim", 11, s["accent"], "700", mono=True, anchor="end")
    txt(68, 158, "session on · policy=ai · per-turn budgets · circuit clear",
        12.5, s["sub"], mono=True)

    # stage 2 — evidence assembly
    txt(110, 220, "② evidence assembly", 17, s["text"], "700")
    txt(486, 220, "approval/asked id", 11, s["accent"], mono=True,
        anchor="end")
    txt(110, 244, "redacted args · reason · risk rules · bounded transcript",
        12.5, s["sub"], mono=True)

    # stage 3 — reviewer room with the two backends
    txt(152, 304, "③ reviewer room · read-only", 17, s["text"], "700")
    txt(444, 304, "one-shot", 11, s["accent"], mono=True, anchor="end")
    for bx, lines in ((144, ("agent · fork", "read/glob/grep")),
                      (304, ("phocinae · 150M", "loopback · ≈21 ms"))):
        rect(bx, 316, 152 if bx == 144 else 148, 36, 11,
             tint(s["accent"], 0.06), tint(s["accent"], 0.24), 1)
        txt(bx + 10, 331, lines[0], 12, s["text"], "600")
        txt(bx + 10, 346, lines[1], 11, s["sub"], mono=True)

    # stage 4 — verdict contract
    txt(194, 394, "④ verdict contract", 17, s["text"], "700")
    txt(194, 416, "{decision, reason, riskLevel}", 12, s["sub"], "600",
        mono=True)
    txt(194, 432, "riskPolicy · cache · fallbackPolicy", 11, s["faint"],
        mono=True)
    txt(298, 467, "outcome", 11, s["accent"], "700", mono=True,
        anchor="middle")

    # ── bypass: delegation lane ───────────────────────────────────────────
    rect(640, 104, 416, 210, 18, s["card"], s["card_edge"], 1.4, shadow=True)
    txt(660, 130, "bypass · next()", 17, s["text"], "700")
    txt(1036, 130, "never short-circuits", 11, s["accent"], mono=True,
        anchor="end")
    txt(660, 150, "the human answerer keeps its turn", 11.5, s["sub"])
    line(660, 162, 1036, 162, s["grid"], 1.2)
    rows_a = [
        "· session off / /auto-review off",
        "· toolsPolicy: human (default)",
        "· per-turn budget spent",
        "· circuit action: delegate",
        "· fallbackPolicy: delegate",
    ]
    for i, row in enumerate(rows_a):
        txt(660, 184 + i * 26, row, 12.5, s["sub"], mono=True)
    txt(660, 306, "→ human answerer → approval/decided", 11, s["accent"],
        mono=True)

    # ── deterministic close lane ──────────────────────────────────────────
    rect(640, 328, 416, 152, 18, s["card"], s["card_edge"], 1.4, shadow=True)
    txt(660, 354, "deterministic close", 17, s["text"], "700")
    txt(1036, 354, "fail closed", 11, s["deny"], "700", mono=True,
        anchor="end")
    txt(660, 374, "no reviewer run, no budget burned", 11.5, s["sub"])
    line(660, 386, 1036, 386, s["grid"], 1.2)
    rows_b = [
        "· never rule / toolsPolicy → [auto-review-never]",
        "· reviewer failure → fallbackPolicy: rejected",
        "· circuit action: reject / abort-turn",
    ]
    for i, row in enumerate(rows_b):
        txt(660, 408 + i * 24, row, 12.5, s["sub"], mono=True)

    # exit arrows from the gates that do not claim
    line(548, 143, 636, 143, s["accent"], 1.8, dash="5 5", marker="arr")
    path("M 422 406 H 596 Q 620 406 620 430 H 636", s["warn"], 1.8,
         marker="arrw", dash="5 5")
    txt(470, 400, "reviewer failure", 11, s["warn"], mono=True)

    # ── outcome bus and the three doors ───────────────────────────────────
    line(298, 478, 298, 492, s["accent"], 2)
    line(205, 492, 893, 492, s["accent"], 2)
    for dx in (205, 549, 893):
        line(dx, 492, dx, 506, s["accent"], 2, marker="arr")

    doors = [
        (44, "allow", s["allow"], "allowed-once · no persistent grant"),
        (388, "deny", s["deny"], "rejected · reason → denied tool result"),
        (732, "fallback", s["warn"], "rejected (default) · delegate · allow-once"),
    ]
    for x, head, col, detail in doors:
        rect(x, 508, 322, 64, 16, s["card"], tint(col, 0.30), 1.4,
             shadow=True)
        txt(x + 20, 534, head, 18, col, "700", mono=True)
        txt(x + 20, 556, detail, 11.5, s["sub"], mono=True)

    # ── audit chain ───────────────────────────────────────────────────────
    rect(44, 584, 1012, 60, 16, s["card"], s["card_edge"], 1.4, shadow=True)
    txt(64, 610, "approval/asked → autoReview/verdict | autoReview/rejection "
        "→ approval/decided", 13, s["accent"], "700", mono=True)
    txt(64, 632, "log-only · ignorable envelope · autoReview projection → "
        "Web panel", 11.5, s["sub"], mono=True)
    txt(1036, 632, "Apache-2.0 · fail closed", 11, s["faint"], mono=True,
        anchor="end")

    add("</svg>")
    path_out = os.path.join(OUT, f"dsh-auto-review-flow-v5-{skin}.svg")
    with open(path_out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write("\n".join(e) + "\n")
    print(f"wrote {os.path.relpath(path_out, ROOT)}")


# ── measured-data chart (Phocinae 91-command benchmark) ────────────────────
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


def evfont(size):
    return ImageFont.truetype(FONT_CJK, int(size))


def evidence(lang: str, skin: str) -> None:
    s = EV_SKIN[skin]
    t = TEXT[lang]
    w, h = 1600, 560
    img = Image.new("RGB", (w, h), s["bg"])
    d = ImageDraw.Draw(img)
    pad = 70
    # title block
    d.text((pad, 44), t["title"], font=evfont(36), fill=s["text"])
    d.text((pad, 100), t["sub"], font=evfont(19), fill=s["sub"])
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
        lb = d.textbbox((0, 0), name, font=evfont(22))
        d.text((bar_x - 24 - (lb[2] - lb[0]), y + 8), name,
               font=evfont(22), fill=s["text"])
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
                   font=evfont(18), fill=s["bg"], anchor="mm")
            x += seg_w
        d.text((bar_x + int(unit * total) + 18, y + 8), f"n={total}",
               font=evfont(22), fill=s["sub"])
    # legend
    ly = top + len(ROWS) * row_h + 16
    lx = bar_x
    for key, col in legend:
        label = t[key]
        colr = col[skin] if col else s["border"]
        d.rounded_rectangle([lx, ly, lx + 22, ly + 22], radius=5, fill=colr)
        d.text((lx + 30, ly - 2), label, font=evfont(18), fill=s["sub"])
        lx += 30 + d.textbbox((0, 0), label, font=evfont(18))[2] + 42
    # footnotes
    ny = ly + 52
    d.text((pad, ny), t["note1"], font=evfont(17), fill=s["sub"])
    d.text((pad, ny + 32), t["note2"], font=evfont(17), fill=s["sub"])
    img.save(os.path.join(OUT, f"dsh-auto-review-evidence-{lang}-{skin}.webp"),
             "WEBP", quality=90)


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    for skin in ("light", "dark"):
        for lang in ("zh", "en"):
            hero(lang, skin)
        flow_svg(skin)
    for lang in ("zh", "en"):
        for skin in ("light", "dark"):
            evidence(lang, skin)


if __name__ == "__main__":
    main()
