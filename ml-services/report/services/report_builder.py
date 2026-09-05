"""
ReportBuilder — assembles the investigation report data model from the DB
(counts, validation, entities) + the graph service (money-flow, round-trips,
risk). Graph enrichment is best-effort so a report is always produced.
"""

import datetime
import json
import os
import re
import urllib.request

from services.postgres_loader import PostgresLoader
from services.location_parser import parse_location
from services import persistence
from services import channel_analytics

GRAPH_URL = os.getenv("GRAPH_URL", "http://localhost:8005")


def _get(url, timeout=30):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return json.loads(resp.read().decode())
    except Exception as exc:
        print(f"[INFO] report graph fetch failed ({url}): {exc}")
        return {}


def _inr(value):
    """Indian-grouped rupee amount for plain-language descriptions."""
    try:
        return f"Rs {float(value):,.0f}"
    except (TypeError, ValueError):
        return str(value)


def _account_no_from_filename(fname):
    """Pull the account number out of a statement file name — it's the leading
    run of digits (e.g. '99907411895495.csv' -> '99907411895495',
    'SOA_777701931901.xlsx' -> '777701931901',
    '257204405495_PDF stmt.pdf' -> '257204405495'). Returns None when the file
    name carries no account-number-like digit run."""
    m = re.search(r"\d{6,}", fname or "")
    return m.group(0) if m else None


# Plain-language definitions so an officer understands each section at a glance.
ROUND_TRIPS_DEFINITION = (
    "A round trip (circular flow) is money that leaves an account and returns "
    "to it after passing through one or more other accounts, forming a closed "
    "loop. It is a classic money-laundering / layering pattern used to disguise "
    "the origin of funds and create the appearance of legitimate turnover."
)

MONEY_FLOW_DEFINITIONS = {
    "overview": (
        "Money flow traces how funds move between accounts across the "
        "statements. The accounts below are grouped by the role they play in "
        "the network."
    ),
    "accumulation": (
        "Accumulation accounts — money collects here from many senders. A "
        "single account receiving from many sources is a common collection / "
        "mule-consolidation point."
    ),
    "source": (
        "Source accounts — money originates here and fans out to many "
        "receivers. Often the account that distributes funds across a network."
    ),
    "layering": (
        "Layering / pass-through accounts — money in is almost equal to money "
        "out, so funds barely rest before being forwarded. High pass-through "
        "means the account is used mainly to move money onward, not to hold it."
    ),
}


class ReportBuilder:

    def __init__(self):
        self.loader = PostgresLoader()

    # ---- identifier resolution: statement UUID -> account no / file name -----
    def _statement_labels(self):
        """Map every statement UUID to its ACCOUNT NUMBER. The account number is
        taken from the account_number column when present, else pulled out of
        the file name (the leading digit run — the file type extension and any
        '_stmt'/'_PDF' suffix are dropped), else the holder name, so a report
        shows a clean account number, never a file name or opaque UUID."""
        out = {}
        for s in self.loader.statement_identities():
            sid = str(s.get("id"))
            acct = (s.get("account_number") or "").strip()
            fname = (s.get("filename") or "").strip()
            holder = (s.get("account_holder") or "").strip()
            out[sid] = (acct or _account_no_from_filename(fname) or holder
                        or f"Statement {sid[:8]}")
        return out

    @staticmethod
    def _relabel(node, labels):
        """Replace a statement-UUID identifier with its friendly label. Real
        account numbers / UPI ids / counterparty names / CASH pass through
        unchanged."""
        if node is None:
            return node
        s = str(node)
        if s.startswith("STMT:"):
            uid = s[5:]
            return labels.get(uid, f"Statement {uid[:8]}")
        return labels.get(s, s)

    def build(self, case_id="all", refresh=False):
        if not refresh:
            cached = persistence.load(case_id, "report")
            if cached:
                return cached

        scoped = case_id and case_id != "all"
        stmt = case_id if scoped else None

        counts = self.loader.summary_counts(stmt)
        validation = self.loader.validation_summary(stmt)
        entities = self.loader.top_entities(25)
        cash_locations = self._cash_locations(stmt)
        analytics = channel_analytics.compute(
            self.loader.transactions_for_analytics(stmt))

        # Risk + flow must follow the SAME scope as the counts above:
        #  - scoped: this statement's transactions only.
        #  - all   : the whole network, but via the *representative* ranking so
        #    every statement's top suspicious accounts are guaranteed to appear
        #    (a plain global top-N buries smaller statements under global
        #    volume normalization).
        if scoped:
            analysis = _get(f"{GRAPH_URL}/flow/analyze/statement/{case_id}")
            risks = _get(f"{GRAPH_URL}/risk/top/statement/{case_id}?limit=20")
        else:
            analysis = _get(f"{GRAPH_URL}/flow/analyze/all")
            risks = _get(f"{GRAPH_URL}/risk/top/representative?limit=25")

        mf = analysis.get("summary", {}) if isinstance(analysis, dict) else {}
        round_trips = analysis.get("round_trips", []) if isinstance(analysis, dict) else []
        communities = analysis.get("communities", []) if isinstance(analysis, dict) else []
        top_risks = risks.get("top_risks", []) if isinstance(risks, dict) else []

        # Resolve every statement-UUID identifier to a file name / account no.
        labels = self._statement_labels()
        round_trips = self._decorate_round_trips(round_trips, labels)   # ALL of them
        money_flow = self._decorate_money_flow(mf, labels)
        flagged = self._flagged_findings(top_risks, labels)
        scope_label = labels.get(case_id, case_id) if scoped else None

        report = {
            "title": "Financial Crime Investigation Report",
            "case_id": case_id,
            "scope": "Whole Network (all statements)" if not scoped
                     else f"Statement: {scope_label}",
            "generated_at": datetime.datetime.now(datetime.timezone.utc)
                            .strftime("%Y-%m-%d %H:%M UTC"),
            "risk_distribution": self._risk_distribution(top_risks),
            "flagged_findings": flagged,
            "flags_summary": self._flags_summary(flagged),
            "executive_summary": {
                "statements": counts.get("statements", 0),
                "transactions": counts.get("transactions", 0),
                "entities": counts.get("entities", 0),
                "duplicates": counts.get("duplicates", 0),
                "failed_or_reversed": counts.get("failed", 0),
                "total_credit": counts.get("total_credit", 0.0),
                "total_debit": counts.get("total_debit", 0.0),
                "round_trips_detected": len(round_trips),
                "communities_detected": len(communities),
                "high_risk_accounts": sum(
                    1 for r in top_risks if r.get("risk_level") in ("HIGH", "CRITICAL")
                ),
            },
            "money_flow": money_flow,
            "money_flow_definitions": MONEY_FLOW_DEFINITIONS,
            "round_trips": round_trips,
            "round_trips_definition": ROUND_TRIPS_DEFINITION,
            "top_risks": top_risks,
            "top_entities": entities,
            "cash_locations": cash_locations,
            "cash_by_city": self._cash_by_city(cash_locations),
            "channel_breakdown": analytics["channel_breakdown"],
            "category_counts": analytics["categories"],
            "activity_timeline": analytics["timeline"],
            "validation": validation,
            "recommendations": self._recommendations(mf, round_trips, top_risks, validation),
        }
        persistence.save(case_id, "report", report)
        return report

    def _cash_locations(self, statement_id):
        """Physical ATM / cash withdrawal & deposit sites (city, state) — the
        leads list for officers. Parsed deterministically from narrations."""
        out = []
        for r in self.loader.cash_transactions(statement_id):
            parsed = parse_location(r.get("narration"))
            loc = parsed["location"]
            if loc["city"] == "Unknown":
                continue
            out.append({
                "city": loc["city"],
                "state": loc["state"],
                "amount": float(r.get("amount") or 0),
                "date": r.get("date"),
                "time": r.get("time") if r.get("time")
                        else (parsed["time"] if parsed["time"] != "Unknown" else None),
                "direction": r.get("debit_credit"),
                "narration": r.get("narration"),
            })
        return out

    def _cash_by_city(self, cash_locations):
        """Aggregate cash withdrawals/deposits by city (count + total value) —
        the physical-leads chart for officers."""
        agg = {}
        for c in cash_locations or []:
            city = c.get("city")
            if not city or city == "Unknown":
                continue
            key = f"{city}, {c.get('state')}" if c.get("state") else city
            a = agg.setdefault(key, {"city": key, "count": 0, "value": 0.0})
            a["count"] += 1
            a["value"] += float(c.get("amount") or 0)
        return sorted(agg.values(), key=lambda x: x["count"], reverse=True)

    def _flagged_findings(self, top_risks, labels=None):
        """HIGH/CRITICAL accounts distilled into investigator-facing findings —
        severity, plain-language flags and evidence. The account is shown as an
        account number / file name, never an opaque statement UUID."""
        labels = labels or {}
        out = []
        for r in top_risks or []:
            level = r.get("risk_level")
            if level not in ("HIGH", "CRITICAL"):
                continue
            pt = r.get("passthrough") or {}
            out.append({
                "account": self._relabel(r.get("node") or r.get("account"), labels),
                "severity": level,
                "risk_score": r.get("risk_score"),
                "tags": [t.get("label") for t in (r.get("tags") or [])],
                "reasons": r.get("top_reasons") or [],
                "passthrough_latency_min": pt.get("avg_latency_min"),
                "source_statement": self._relabel(r.get("source_statement"), labels),
            })
        return out

    def _decorate_round_trips(self, round_trips, labels):
        """Relabel every node to its account number and attach a full
        hop-by-hop description — the amount moved from each account to the next,
        from the start of the loop right back to the origin — so the chain is
        self-explanatory."""
        out = []
        for c in round_trips or []:
            nodes = [self._relabel(n, labels) for n in (c.get("nodes") or [])]
            amts = c.get("edge_amounts") or []
            min_amt = c.get("min_amount") or 0
            total = c.get("total_amount") or 0
            n = len(nodes)
            hops = []
            for i in range(n):
                src = nodes[i]
                dst = nodes[(i + 1) % n]      # last hop closes the loop to nodes[0]
                amt = amts[i] if i < len(amts) else None
                hops.append(f"{src} sent {_inr(amt)} to {dst}")
            origin = nodes[0] if nodes else "the origin account"
            hop_text = "; then ".join(hops)
            desc = (
                f"Money completed a full loop back to {origin}. Hop by hop: "
                f"{hop_text}. The smallest hop ({_inr(min_amt)}) is the maximum "
                f"amount that can circulate through the entire loop; {_inr(total)} "
                f"moved across all hops combined."
            )
            out.append({**c, "nodes": nodes, "description": desc})
        return out

    def _decorate_money_flow(self, mf, labels):
        """Relabel every account identifier in the money-flow summary."""
        def relabel_list(items, key="node"):
            out = []
            for a in (items or [])[:10]:
                a = dict(a)
                a[key] = self._relabel(a.get(key), labels)
                out.append(a)
            return out
        return {
            "destination_account": self._relabel(mf.get("destination_account"), labels),
            "accumulation_accounts": relabel_list(mf.get("accumulation_accounts")),
            "source_accounts": relabel_list(mf.get("source_accounts")),
            "layering": relabel_list(mf.get("layering")),
        }

    def _flags_summary(self, flagged):
        if not flagged:
            return "No accounts flagged for malicious activity."
        crit = sum(1 for f in flagged if f["severity"] == "CRITICAL")
        high = sum(1 for f in flagged if f["severity"] == "HIGH")
        return (f"{len(flagged)} account(s) flagged for malicious activity "
                f"({crit} critical, {high} high).")

    def _risk_distribution(self, top_risks):
        dist = {"CRITICAL": 0, "HIGH": 0, "MEDIUM": 0, "LOW": 0}
        for r in top_risks or []:
            level = r.get("risk_level")
            if level in dist:
                dist[level] += 1
        return dist

    def _recommendations(self, mf, round_trips, top_risks, validation):
        recs = []
        if round_trips:
            recs.append(
                f"Investigate {len(round_trips)} circular/round-trip chain(s); "
                "these strongly indicate layering."
            )
        dest = mf.get("destination_account")
        if dest:
            recs.append(
                f"Scrutinize destination account {dest} where funds accumulate."
            )
        crit = [r for r in top_risks if r.get("risk_level") == "CRITICAL"]
        if crit:
            names = ", ".join(str(r.get("node")) for r in crit[:5])
            recs.append(f"Prioritize CRITICAL-risk accounts: {names}.")
        if validation.get("failed"):
            recs.append(
                f"Review {validation['failed']} failed/reversed transactions for "
                "intentional probing or refunds."
            )
        if not recs:
            recs.append("No high-priority red flags detected in the current dataset.")
        return recs
