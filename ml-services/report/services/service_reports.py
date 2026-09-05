"""
Per-service investigation reports — Round Trips, Money Flow, Money Trail — each
scoped to a single statement or the whole network, with the full detail the
corresponding UI shows, structured for investigation.

Produces the generic "doc" (see generic_render) which is then rendered to
JSON / PDF / Excel / DOCX.
"""

import datetime
import json
import os
import urllib.request

from services.postgres_loader import PostgresLoader
from services.location_parser import parse_location, is_cash_narration

GRAPH_URL = os.getenv("GRAPH_URL", "http://localhost:8005")
TRAIL_URL = os.getenv("TRAIL_URL", "http://localhost:8009")

_loader = PostgresLoader()

SERVICES = ("round-trips", "money-flow", "money-trail")


def _get(url, timeout=40):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as exc:
        print(f"[INFO] service-report fetch failed ({url}): {exc}")
        return {}


def _money(x):
    try:
        return f"Rs {float(x):,.0f}"
    except Exception:
        return "" if x is None else str(x)


def _now():
    return datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M UTC")


def _scope_label(case_id):
    return "Whole Network (all statements)" if case_id == "all" else f"Single statement: {case_id}"


def _analysis(case_id):
    if case_id == "all":
        return _get(f"{GRAPH_URL}/flow/analyze/all")
    return _get(f"{GRAPH_URL}/flow/analyze/statement/{case_id}")


# ------------------------------------------------------------------ round trips
def _round_trips_doc(case_id, focus_chain=None):
    a = _analysis(case_id)
    trips = a.get("round_trips", []) if isinstance(a, dict) else []

    # Selective export: keep only the one chain the investigator selected.
    if focus_chain is not None:
        fc = str(focus_chain)
        trips = [t for t in trips if str(t.get("id")) == fc]

    chain_rows = []
    hop_rows = []
    for t in trips:
        nodes = t.get("nodes", [])
        cid = t.get("id")
        chain_rows.append([
            f"#{cid}",
            " -> ".join(nodes + ([nodes[0]] if nodes else [])),
            t.get("length"),
            _money(t.get("min_amount")),
            _money(t.get("total_amount")),
        ])
        amts = t.get("edge_amounts") or []
        for i, n in enumerate(nodes):
            nxt = nodes[(i + 1) % len(nodes)] if nodes else ""
            amt = amts[i] if i < len(amts) else None
            hop_rows.append([f"#{cid}", n, nxt, _money(amt)])

    focus_note = (f" (chain #{focus_chain})"
                  if focus_chain is not None else "")
    # Bank-facing: exact chain + hop details only, no analytical commentary.
    return {
        "title": "Round-Trip Investigation Report",
        "scope": _scope_label(case_id) + focus_note,
        "generated_at": _now(),
        "subtitle": f"{len(trips)} circular / round-trip chain(s).",
        "sections": [
            {"heading": "Round-Trip Chains", "kind": "table",
             "columns": ["Chain", "Path", "Hops", "Min Amount", "Total Amount"],
             "rows": chain_rows, "widths": [0.7, 5.0, 0.9, 1.6, 1.6],
             "right_cols": [3, 4], "empty": "No round trips detected in this scope."},
            {"heading": "Per-Hop Transfers", "kind": "table",
             "columns": ["Chain", "From", "To", "Amount"],
             "rows": hop_rows, "widths": [0.8, 3.2, 3.2, 1.6], "right_cols": [3],
             "empty": "No hop-level detail available."},
        ],
    }


# -------------------------------------------------------------------- money flow
def _money_flow_doc(case_id):
    a = _analysis(case_id)
    summary = a.get("summary", {}) if isinstance(a, dict) else {}
    graph = a.get("graph", {}) if isinstance(a, dict) else {}
    edges = graph.get("edges", []) or []
    nodes = graph.get("nodes", []) or []

    top_edges = sorted(edges, key=lambda e: e.get("total_amount", 0) or 0, reverse=True)[:40]
    edge_rows = [[
        e.get("source"), e.get("target"), _money(e.get("total_amount")),
        e.get("txn_count"),
        f"{e.get('first_date') or ''} - {e.get('last_date') or ''}".strip(" -"),
    ] for e in top_edges]

    acc_rows = [[a2.get("node"), _money(a2.get("total_received")), a2.get("sender_count")]
                for a2 in (summary.get("accumulation_accounts") or [])[:15]]
    src_rows = [[s.get("node"), _money(s.get("total_sent")), s.get("receiver_count")]
                for s in (summary.get("source_accounts") or [])[:15]]
    lay_rows = [[l.get("node"), _money(l.get("total_in")), _money(l.get("total_out")),
                 f"{round((l.get('passthrough_ratio') or 0) * 100)}%"]
                for l in (summary.get("layering") or [])[:15]]

    return {
        "title": "Money-Flow Investigation Report",
        "scope": _scope_label(case_id),
        "generated_at": _now(),
        "subtitle": f"Network of {summary.get('node_count', len(nodes))} account(s) "
                    f"and {summary.get('edge_count', len(edges))} transfer route(s).",
        "sections": [
            {"heading": "Flow Summary", "kind": "kv", "data": {
                "destination_account": summary.get("destination_account"),
                "node_count": summary.get("node_count", len(nodes)),
                "edge_count": summary.get("edge_count", len(edges)),
                "unresolved_counterparties": summary.get("unresolved_counterparties"),
            }},
            {"heading": "Accumulation Accounts (money collects here)", "kind": "table",
             "columns": ["Account", "Total Received", "Senders"], "rows": acc_rows,
             "widths": [4, 2.5, 1.5], "right_cols": [1, 2], "empty": "None."},
            {"heading": "Source Accounts (money originates here)", "kind": "table",
             "columns": ["Account", "Total Sent", "Receivers"], "rows": src_rows,
             "widths": [4, 2.5, 1.5], "right_cols": [1, 2], "empty": "None."},
            {"heading": "Layering / Pass-Through Accounts", "kind": "table",
             "columns": ["Account", "In", "Out", "Pass-Through"], "rows": lay_rows,
             "widths": [4, 2, 2, 1.6], "right_cols": [1, 2, 3], "empty": "None."},
            {"heading": "Top Transfers (routes by amount)", "kind": "table",
             "columns": ["From", "To", "Amount", "Txns", "Active Dates"], "rows": edge_rows,
             "widths": [2.8, 2.8, 1.6, 0.8, 2.0], "right_cols": [2, 3],
             "empty": "No transfers found."},
        ],
    }


# ------------------------------------------------------------------- money trail
def _statement_trails(sid):
    data = _get(f"{TRAIL_URL}/trail/statement/{sid}")
    return data.get("trails", []) if isinstance(data, dict) else []


def _cash_loc(narration):
    if is_cash_narration(narration):
        p = parse_location(narration)
        if p["location"]["city"] != "Unknown":
            return f"{p['location']['city']}, {p['location']['state']}"
    return ""


def _single_credit_trail(txn_id):
    """The one FIFO trail for a specific selected credit transaction."""
    data = _get(f"{TRAIL_URL}/trail/transaction/{txn_id}")
    if isinstance(data, dict) and data.get("kind") == "credit_trail":
        tr = data.get("trail")
        return [tr] if tr else []
    return []


def _emit_trail_rows(tr, trail_no, ledger_rows):
    """Append one FIFO trail's ledger lines: the credit, then the debits that
    consumed it. Bank-facing — every field is the EXACT transaction value
    (date, value date, narration, cheque/ref no, amount, balance). No arrows,
    no explanatory notes, no derived commentary."""
    camt = tr.get("credit_amount", 0) or 0

    # ledger: the credit line (exact narration, exact amounts)
    ledger_rows.append([
        f"Credit #{trail_no}",
        tr.get("credit_date"), tr.get("credit_time"), tr.get("credit_date"),
        tr.get("credit_narration") or "",
        tr.get("credit_reference") or "",
        "", _money(camt), _money(tr.get("credit_balance")), "",
    ])

    # ledger: each debit that consumed this credit (exact narration only)
    for c in tr.get("consumed_by", []) or []:
        narr = c.get("narration") or ""
        ledger_rows.append([
            f"  Debit #{trail_no}",
            c.get("date"), c.get("time"), c.get("date"),
            narr,
            c.get("reference_number") or "",
            _money(c.get("amount") or 0), "", _money(c.get("balance")),
            _cash_loc(narr),
        ])
    return camt


def _money_trail_doc(case_id, focus_credit=None):
    """Bank-facing money-trail ledger built from the FIFO trail service. Each
    traced credit is followed by the debit lines that consumed it, with only
    the exact transaction fields — this is the record investigators forward to
    banks for onward investigation.

    focus_credit: when set, export ONLY the debit trail for that one selected
    credit transaction (the selective-export feature), otherwise every credit
    in scope."""
    ledger_rows = []
    total_credit = 0.0
    trail_no = 0

    if focus_credit:
        for tr in _single_credit_trail(focus_credit):
            trail_no += 1
            total_credit += _emit_trail_rows(tr, trail_no, ledger_rows)
    else:
        sids = _loader.all_statement_ids() if case_id == "all" else [case_id]
        for sid in sids:
            for tr in _statement_trails(sid):
                trail_no += 1
                total_credit += _emit_trail_rows(tr, trail_no, ledger_rows)

    focus_note = " (selected credit)" if focus_credit else ""
    return {
        "title": "Money-Trail (FIFO) Investigation Report",
        "scope": _scope_label(case_id) + focus_note,
        "generated_at": _now(),
        "subtitle": f"{trail_no} credit trail(s). Total credited: {_money(total_credit)}.",
        "sections": [
            {"heading": "Transaction Ledger", "kind": "table",
             "columns": ["Trail", "Date", "Time", "Value Date", "Transaction Details",
                         "Cheque/Ref No", "Debit", "Credit", "Balance", "Cash Location"],
             "rows": ledger_rows, "widths": [0.9, 1.1, 0.9, 1.1, 3.2, 1.2, 1.2, 1.2, 1.2, 1.4],
             "right_cols": [6, 7, 8], "empty": "No ledger detail available."},
        ],
    }


def build_service_doc(service, case_id, focus=None):
    """focus: optional selective-export target — a credit transaction id for
    money-trail, or a round-trip chain id for round-trips. Ignored by
    money-flow (whole-graph by nature)."""
    if service == "round-trips":
        return _round_trips_doc(case_id, focus_chain=focus)
    if service == "money-flow":
        return _money_flow_doc(case_id)
    if service == "money-trail":
        return _money_trail_doc(case_id, focus_credit=focus)
    raise ValueError(f"unknown service '{service}'")
