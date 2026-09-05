"""
Render the report data model to a PDF (Core Requirement 6, graded).

Minimal, statistics-first and investigator-friendly. No charts — just the
numbers (in the summary) plus the two explained sections (round trips and money
flow). Every account identifier is already resolved to an account number / file
name upstream in report_builder, so no opaque statement UUID appears here.

Uses reportlab (pip install reportlab). Kept dependency-isolated: the import is
inside build_pdf so the rest of the report service runs even if reportlab isn't
installed yet (the endpoint then returns a clear error). Amounts use an ASCII
"Rs" prefix with Indian digit grouping because the Rupee glyph isn't in the
base-14 PDF fonts.
"""

import io


def _inr(value):
    """Format a number with Indian digit grouping and an ASCII 'Rs' prefix."""
    try:
        n = float(value)
    except (TypeError, ValueError):
        return "-" if value in (None, "") else str(value)
    negative = n < 0
    n = int(round(abs(n)))
    s = str(n)
    if len(s) > 3:
        last3 = s[-3:]
        rest = s[:-3]
        parts = []
        while len(rest) > 2:
            parts.insert(0, rest[-2:])
            rest = rest[:-2]
        if rest:
            parts.insert(0, rest)
        s = ",".join(parts) + "," + last3
    return ("-" if negative else "") + "Rs " + s


KEY_METRICS = [
    ("statements", "Statements"),
    ("transactions", "Transactions"),
    ("total_credit", "Total Credit"),
    ("total_debit", "Total Debit"),
    ("duplicates", "Duplicate Transactions"),
    ("failed_or_reversed", "Failed / Reversed"),
    ("round_trips_detected", "Round Trips Detected"),
    ("high_risk_accounts", "High-Risk Accounts"),
]
_MONEY_METRICS = {"total_credit", "total_debit"}

CATEGORY_LABELS = [
    ("total_transactions", "Total Transactions"), ("credits", "Credits"),
    ("debits", "Debits"), ("atm_withdrawals", "ATM Withdrawals"),
    ("cash_deposits", "Cash Deposits"), ("failed_transactions", "Failed / Reversed"),
    ("digital_upi", "Digital (UPI / apps)"), ("cheque", "Cheque"),
    ("card_pos", "Card / POS"),
]


def build_pdf(report: dict) -> bytes:
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.units import mm
    from reportlab.platypus import (
        SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    )

    styles = getSampleStyleSheet()
    body = styles["BodyText"]
    title_style = ParagraphStyle("Title2", parent=styles["Title"], fontSize=18,
                                 spaceAfter=4)
    meta_style = ParagraphStyle("Meta", parent=styles["BodyText"], fontSize=9,
                                textColor=colors.HexColor("#52525B"))
    h2 = ParagraphStyle("H2c", parent=styles["Heading2"], fontSize=13,
                        textColor=colors.HexColor("#1F4E78"), spaceBefore=8,
                        spaceAfter=4)
    h3 = ParagraphStyle("H3c", parent=styles["Heading3"], fontSize=10.5,
                        textColor=colors.HexColor("#1F4E78"), spaceBefore=6,
                        spaceAfter=2)
    note = ParagraphStyle("Note", parent=body, fontSize=8.5, leading=11,
                          textColor=colors.HexColor("#3F3F46"))
    cell = ParagraphStyle("Cell", parent=body, fontSize=8, leading=10)
    cell_right = ParagraphStyle("CellR", parent=cell, alignment=2)  # right
    head_cell = ParagraphStyle("HeadCell", parent=cell, textColor=colors.white,
                               fontName="Helvetica-Bold")

    buf = io.BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        topMargin=16 * mm, bottomMargin=16 * mm,
        leftMargin=14 * mm, rightMargin=14 * mm,
    )
    avail = doc.width
    flow = []

    def P(text, style=cell):
        return Paragraph("" if text is None else str(text), style)

    def make_table(headers, rows, ratios, right_cols=()):
        total = float(sum(ratios)) or 1.0
        col_widths = [avail * (r / total) for r in ratios]
        data = [[P(h, head_cell) for h in headers]]
        for row in rows:
            data.append([
                P(c, cell_right if i in right_cols else cell)
                for i, c in enumerate(row)
            ])
        t = Table(data, colWidths=col_widths, repeatRows=1, hAlign="LEFT")
        t.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1F4E78")),
            ("FONTSIZE", (0, 0), (-1, -1), 8),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#B8C4D4")),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("LEFTPADDING", (0, 0), (-1, -1), 4),
            ("RIGHTPADDING", (0, 0), (-1, -1), 4),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1),
             [colors.white, colors.HexColor("#F2F6FB")]),
        ]))
        return t

    # ------------------------------------------------------------------ header
    flow.append(Paragraph(report.get("title", "Investigation Report"), title_style))
    flow.append(Paragraph(report.get("scope") or f"Case: {report.get('case_id', 'all')}",
                          meta_style))
    if report.get("generated_at"):
        flow.append(Paragraph(f"Generated: {report.get('generated_at')}", meta_style))
    flow.append(Spacer(1, 8))

    # ------------------------------------------------ Summary — key statistics
    flow.append(Paragraph("Summary — Key Statistics", h2))
    es = report.get("executive_summary", {}) or {}
    flow.append(make_table(
        ["Metric", "Value"],
        [[lbl, _inr(es.get(key)) if key in _MONEY_METRICS else es.get(key, 0)]
         for key, lbl in KEY_METRICS],
        [3, 2], right_cols=(1,)))
    flow.append(Spacer(1, 6))

    dist = report.get("risk_distribution") or {}
    if any(dist.values()):
        flow.append(Paragraph("Accounts by Risk Level", h3))
        flow.append(make_table(
            ["Critical", "High", "Medium", "Low"],
            [[dist.get("CRITICAL", 0), dist.get("HIGH", 0),
              dist.get("MEDIUM", 0), dist.get("LOW", 0)]],
            [1, 1, 1, 1]))
        flow.append(Spacer(1, 6))

    cats = report.get("category_counts") or {}
    if cats:
        flow.append(Paragraph("Transaction Categories", h3))
        flow.append(make_table(
            ["Category", "Count"],
            [[lbl, cats.get(key, 0)] for key, lbl in CATEGORY_LABELS],
            [3, 1], right_cols=(1,)))
        flow.append(Spacer(1, 6))

    channels = report.get("channel_breakdown") or []
    if channels:
        flow.append(Paragraph("Payment Channels", h3))
        flow.append(make_table(
            ["Channel / Class", "Transactions", "Total Value", "Share"],
            [[c.get("channel"), c.get("count"), _inr(c.get("value")),
              f"{round((c.get('share') or 0) * 100)}%"] for c in channels],
            [2.5, 1.5, 2.0, 1.0], right_cols=(1, 2, 3)))
        flow.append(Spacer(1, 6))

    # flagged findings live INSIDE the summary
    flow.append(Paragraph("Flagged Findings", h3))
    flow.append(Paragraph(report.get("flags_summary", ""), body))
    flow.append(Spacer(1, 3))
    flagged = report.get("flagged_findings", [])
    if flagged:
        flow.append(make_table(
            ["Account", "Severity", "Flags", "Evidence"],
            [[f.get("account"), f.get("severity"),
              ", ".join(f.get("tags", []) or []),
              "; ".join(f.get("reasons", []) or [])] for f in flagged],
            [2.4, 1.1, 2.5, 4.0]))
    flow.append(Spacer(1, 8))

    # ------------------------------------------------------------- round trips
    flow.append(Paragraph("Round Trips (Circular Flows)", h2))
    if report.get("round_trips_definition"):
        flow.append(Paragraph(report["round_trips_definition"], note))
        flow.append(Spacer(1, 4))
    trips = report.get("round_trips", [])
    if trips:
        for i, c in enumerate(trips, start=1):
            flow.append(Paragraph(f"Round Trip #{c.get('id', i)}", h3))
            flow.append(Paragraph("<b>Path:</b> " + " &rarr; ".join(
                str(n) for n in c.get("nodes", [])), body))
            if c.get("description"):
                flow.append(Paragraph(c["description"], note))
            flow.append(Spacer(1, 4))
    else:
        flow.append(Paragraph("No circular flows detected in this scope.", body))
    flow.append(Spacer(1, 8))

    # -------------------------------------------------------------- money flow
    flow.append(Paragraph("Money Flow", h2))
    defs = report.get("money_flow_definitions") or {}
    if defs.get("overview"):
        flow.append(Paragraph(defs["overview"], note))
    mf = report.get("money_flow", {})
    flow.append(Paragraph(
        "Primary destination (where funds accumulate): "
        f"<b>{mf.get('destination_account') or 'None identified'}</b>", body))
    flow.append(Spacer(1, 4))

    acc = mf.get("accumulation_accounts", [])[:10]
    if acc:
        flow.append(Paragraph("Accumulation Accounts", h3))
        if defs.get("accumulation"):
            flow.append(Paragraph(defs["accumulation"], note))
        flow.append(make_table(
            ["Account", "Total Received", "Senders"],
            [[a.get("node"), _inr(a.get("total_received")), a.get("sender_count")]
             for a in acc],
            [4, 2.5, 1.5], right_cols=(1, 2)))
        flow.append(Spacer(1, 6))

    src = mf.get("source_accounts", [])[:10]
    if src:
        flow.append(Paragraph("Source Accounts", h3))
        if defs.get("source"):
            flow.append(Paragraph(defs["source"], note))
        flow.append(make_table(
            ["Account", "Total Sent", "Receivers"],
            [[a.get("node"), _inr(a.get("total_sent")), a.get("receiver_count")]
             for a in src],
            [4, 2.5, 1.5], right_cols=(1, 2)))
        flow.append(Spacer(1, 6))

    lay = mf.get("layering", [])[:10]
    if lay:
        flow.append(Paragraph("Layering / Pass-Through Accounts", h3))
        if defs.get("layering"):
            flow.append(Paragraph(defs["layering"], note))
        flow.append(make_table(
            ["Account", "Total In", "Total Out", "Pass-Through"],
            [[a.get("node"), _inr(a.get("total_in")), _inr(a.get("total_out")),
              f"{round((a.get('passthrough_ratio') or 0) * 100)}%"] for a in lay],
            [4, 2, 2, 1.6], right_cols=(1, 2, 3)))
        flow.append(Spacer(1, 8))

    # --------------------------------------------- fund velocity (numbers only)
    timeline = report.get("activity_timeline") or []
    if timeline:
        flow.append(Paragraph("Fund Velocity — Daily Activity", h2))
        flow.append(make_table(
            ["Date", "Transactions", "Credit", "Debit"],
            [[t.get("date"), t.get("count"), _inr(t.get("credit")), _inr(t.get("debit"))]
             for t in timeline],
            [2.2, 1.6, 2.1, 2.1], right_cols=(1, 2, 3)))
        flow.append(Spacer(1, 8))

    # ------------------------------ cash withdrawal / deposit locations
    cash = report.get("cash_locations") or []
    if cash:
        flow.append(Paragraph("Cash Withdrawal / Deposit Locations", h2))
        flow.append(Paragraph(
            "Physical ATM / branch locations where cash was withdrawn (debit) or "
            "deposited (credit), parsed from the transaction narrations — the "
            "on-ground leads for an officer.", note))
        flow.append(Spacer(1, 3))
        flow.append(make_table(
            ["City", "State", "Type", "Amount", "Date / Time"],
            [[c.get("city"), c.get("state"),
              "Withdrawal" if c.get("direction") == "DEBIT" else "Deposit",
              _inr(c.get("amount")),
              f"{c.get('date') or ''} {c.get('time') or ''}".strip()]
             for c in cash],
            [2.2, 2.2, 1.4, 1.6, 2.6], right_cols=(3,)))

    doc.build(flow)
    return buf.getvalue()
