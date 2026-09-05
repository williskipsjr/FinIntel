"""
Chart images for reports (Word / PDF).

Renders pie / bar / line charts to PNG bytes with matplotlib (Agg backend, no
display needed). Every function returns None if matplotlib isn't installed or
there's nothing to plot, so callers degrade gracefully to the data tables that
always accompany each chart.

Excel uses openpyxl's *native* charts instead (see excel_report) — those are
editable in Excel and need no image.
"""

from __future__ import annotations

import io

try:
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    _OK = True
except Exception:  # matplotlib absent -> callers fall back to tables
    _OK = False


# A calm, print-friendly palette (distinct but not neon — reads on paper).
_PALETTE = [
    "#2563EB", "#DC2626", "#059669", "#D97706", "#7C3AED", "#0891B2",
    "#DB2777", "#65A30D", "#4B5563", "#B45309", "#9333EA", "#0D9488",
    "#E11D48",
]


def available() -> bool:
    return _OK


def _fig_to_png(fig) -> bytes:
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=130, bbox_inches="tight")
    plt.close(fig)
    return buf.getvalue()


def pie_png(labels, values, title=None):
    """Donut/pie of channel share. Returns PNG bytes or None."""
    if not _OK:
        return None
    pairs = [(l, v) for l, v in zip(labels, values) if v]
    if not pairs:
        return None
    labels, values = zip(*pairs)
    fig, ax = plt.subplots(figsize=(5.2, 3.6))
    colors = [_PALETTE[i % len(_PALETTE)] for i in range(len(values))]
    wedges, _texts, autotexts = ax.pie(
        values, colors=colors, autopct=lambda p: f"{p:.0f}%" if p >= 5 else "",
        startangle=90, pctdistance=0.78,
        wedgeprops=dict(width=0.42, edgecolor="white"),
    )
    for at in autotexts:
        at.set_fontsize(8)
        at.set_color("white")
    ax.legend(wedges, labels, loc="center left", bbox_to_anchor=(1.0, 0.5),
              fontsize=8, frameon=False)
    ax.set(aspect="equal")
    if title:
        ax.set_title(title, fontsize=11, fontweight="bold")
    return _fig_to_png(fig)


def bar_png(labels, values, title=None, xlabel=None):
    """Horizontal bar of counts per class. Returns PNG bytes or None."""
    if not _OK:
        return None
    pairs = [(l, v) for l, v in zip(labels, values) if v]
    if not pairs:
        return None
    labels, values = zip(*pairs)
    fig, ax = plt.subplots(figsize=(6.0, max(2.2, 0.42 * len(labels) + 0.8)))
    ypos = range(len(labels))
    colors = [_PALETTE[i % len(_PALETTE)] for i in range(len(values))]
    ax.barh(list(ypos), list(values), color=colors)
    ax.set_yticks(list(ypos))
    ax.set_yticklabels(labels, fontsize=8)
    ax.invert_yaxis()
    for i, v in enumerate(values):
        ax.text(v, i, f" {int(v)}", va="center", fontsize=8)
    ax.spines[["top", "right"]].set_visible(False)
    if xlabel:
        ax.set_xlabel(xlabel, fontsize=9)
    if title:
        ax.set_title(title, fontsize=11, fontweight="bold")
    return _fig_to_png(fig)


def timeline_png(dates, counts, credit, debit, title=None):
    """Fund-velocity over time: txn count (bars) + credit/debit value (lines)."""
    if not _OK:
        return None
    if not dates:
        return None
    fig, ax1 = plt.subplots(figsize=(7.2, 3.4))
    x = range(len(dates))
    ax1.bar(list(x), list(counts), color="#CBD5E1", label="Txn count")
    ax1.set_ylabel("Txn count", fontsize=9, color="#475569")
    ax1.tick_params(axis="y", labelsize=8)

    ax2 = ax1.twinx()
    ax2.plot(list(x), list(credit), color="#059669", linewidth=1.8, label="Credit ₹")
    ax2.plot(list(x), list(debit), color="#DC2626", linewidth=1.8, label="Debit ₹")
    ax2.set_ylabel("Value (₹)", fontsize=9, color="#475569")
    ax2.tick_params(axis="y", labelsize=8)

    # thin the x labels so they stay legible
    step = max(1, len(dates) // 10)
    ax1.set_xticks(list(x)[::step])
    ax1.set_xticklabels([dates[i] for i in list(x)[::step]], rotation=45,
                        ha="right", fontsize=7)
    ax1.spines[["top"]].set_visible(False)
    ax2.spines[["top"]].set_visible(False)

    lines = [ax1.patches[0]] if ax1.patches else []
    l2, = ax2.plot([], [], color="#059669", linewidth=1.8)
    l3, = ax2.plot([], [], color="#DC2626", linewidth=1.8)
    ax1.legend([ax1.patches[0], l2, l3] if ax1.patches else [l2, l3],
               ["Txn count", "Credit ₹", "Debit ₹"], loc="upper left",
               fontsize=8, frameon=False)
    if title:
        ax1.set_title(title, fontsize=11, fontweight="bold")
    return _fig_to_png(fig)
