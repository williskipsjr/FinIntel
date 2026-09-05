"""
Explainability engine (Phase 6).

Turns risk scores and detected patterns into investigator-facing explanations:
why, how, confidence, and the supporting evidence (counterparties, round-trip
hops, contributing factors). Deterministic + template-based, so it needs no
external LLM — though the narratives are structured to be LLM-augmentable later.
"""

from __future__ import annotations


def _money(x):
    try:
        return f"₹{float(x):,.0f}"
    except Exception:
        return str(x)


# --------------------------------------------------------------------------
# Account / entity explanation
# --------------------------------------------------------------------------
def explain_account(risk, engine, account):
    """Rich explanation for an account's risk assessment."""
    factors = risk.get("factors", [])
    level = risk.get("risk_level", "LOW")
    score = risk.get("risk_score", 0.0)

    # supporting evidence from the graph
    sent, received = [], []
    for (src, dst), e in engine.edges.items():
        if src == account:
            sent.append({"counterparty": dst, "amount": e["total_amount"],
                         "count": e["txn_count"]})
        if dst == account:
            received.append({"counterparty": src, "amount": e["total_amount"],
                             "count": e["txn_count"]})
    sent.sort(key=lambda x: x["amount"], reverse=True)
    received.sort(key=lambda x: x["amount"], reverse=True)

    node = engine.nodes.get(account, {})

    # confidence: more independent corroborating signals -> higher confidence
    confidence = round(min(1.0, 0.4 + 0.15 * len(factors)), 2)

    reasons = [f["explanation"] for f in factors[:3]]
    why = "; ".join(reasons) if reasons else "No elevated risk signals detected."

    narrative = (
        f"Account {account} is assessed {level} (risk score {score}). "
        f"Primary drivers: {why}. "
    )
    if received:
        narrative += (
            f"It received {_money(node.get('total_in', 0))} across "
            f"{len(received)} sender(s); "
        )
    if sent:
        narrative += (
            f"it sent {_money(node.get('total_out', 0))} across "
            f"{len(sent)} receiver(s)."
        )

    return {
        "account": account,
        "risk_score": score,
        "risk_level": level,
        "confidence": confidence,
        "narrative": narrative.strip(),
        "why": reasons,
        "how": [
            {
                "signal": f["signal"],
                "explanation": f["explanation"],
                "contribution": f["contribution"],
                "evidence": f.get("evidence", {}),
            }
            for f in factors
        ],
        "evidence": {
            "top_received_from": received[:5],
            "top_sent_to": sent[:5],
            "total_received": node.get("total_in", 0.0),
            "total_sent": node.get("total_out", 0.0),
        },
    }


# --------------------------------------------------------------------------
# Round-trip / circular-flow explanation
# --------------------------------------------------------------------------
def _severity(amount):
    if amount >= 1_000_000:
        return "CRITICAL"
    if amount >= 100_000:
        return "HIGH"
    if amount >= 10_000:
        return "MEDIUM"
    return "LOW"


def _display(node_id, engine):
    """Human-readable label for a node: holder name when known, else raw id."""
    n = (engine.nodes if engine else {}).get(node_id, {})
    name = n.get("holder_name")
    return f"{name} ({node_id})" if name else node_id


def _hop_evidence(src, dst, engine):
    e = engine.edges.get((src, dst), {}) if engine else {}
    return {
        "from": src,
        "to": dst,
        "amount": e.get("total_amount"),
        "txn_count": e.get("txn_count"),
        "channel": e.get("channel"),
        "first_date": e.get("first_date"),
        "last_date": e.get("last_date"),
        "sample_narrations": e.get("sample_narrations", []),
    }


def _hop_line(hop, engine):
    line = (
        f"{_display(hop['from'], engine)} → {_display(hop['to'], engine)}: "
        f"{_money(hop['amount'])} across {hop.get('txn_count') or 0} txn(s)"
        + (f" via {hop['channel']}" if hop.get("channel") else "")
    )
    samples = hop.get("sample_narrations") or []
    if samples:
        quote = samples[0]["narration"]
        if len(quote) > 90:
            quote = quote[:87] + "..."
        line += f' — e.g. "{quote}"'
    return line


def explain_round_trip(cycle, engine):
    nodes = cycle["nodes"]
    hops = [_hop_evidence(nodes[i], nodes[(i + 1) % len(nodes)], engine)
            for i in range(len(nodes))]

    path_str = " → ".join(_display(n, engine) for n in nodes + [nodes[0]])
    bottleneck = cycle["min_amount"]
    severity = _severity(bottleneck)

    narrative = (
        f"Circular money movement across {len(nodes)} account(s): {path_str}. "
        f"Funds leave {_display(nodes[0], engine)} and return to it after "
        f"{len(nodes)} hop(s), forming a closed loop. "
        f"The smallest hop is {_money(bottleneck)}, so at least {_money(bottleneck)} "
        f"can circulate through the entire loop (total moved across hops: "
        f"{_money(cycle['total_amount'])})."
    )
    hop_lines = [_hop_line(h, engine) for h in hops]
    if hop_lines:
        narrative += " Hop-by-hop: " + " | ".join(hop_lines)

    why = [
        "Money returns to its origin account (closed loop) — a classic "
        "layering / round-tripping indicator.",
        f"Loop length {len(nodes)} with a sustained bottleneck of {_money(bottleneck)}.",
    ]
    why.extend(
        f"Hop {i + 1}: {_hop_line(h, engine)}" for i, h in enumerate(hops)
    )

    return {
        "chain_id": cycle.get("id"),
        "severity": severity,
        "path": path_str,
        "nodes": nodes,
        "length": len(nodes),
        "bottleneck_amount": bottleneck,
        "total_amount": cycle["total_amount"],
        "hops": hops,
        "narrative": narrative,
        "why": why,
    }
