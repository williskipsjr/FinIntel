"""
MoneyFlowEngine — dependency-free in-memory money-flow graph + analytics.

Why a new engine (Phase 3):
  The previous graph was Neo4j-only and keyed on sender_account/receiver_account,
  which are empty for real single-account bank statements -> it built almost
  nothing on the real dataset. This engine works for BOTH shapes:

    * Multi-account / investigation data: edges from sender -> receiver.
    * Single-account statements: edges from the statement holder to the
      counterparty derived from the narration (UPI VPA / payee name / merchant /
      CASH), with direction from debit/credit.

Provides (Core Requirements 3 & 4):
    * directed money-flow graph (nodes = accounts/counterparties, edges = aggregated transfers)
    * round-trip / circular-flow detection (cycles)
    * accumulation/destination detection, sources, fan-in / fan-out, layering
    * degree centrality and weakly-connected communities
    * a frontend-ready {nodes, edges} payload

No third-party deps (no neo4j / networkx required) so it is portable and
testable. Neo4j can persist the same graph separately.
"""

from __future__ import annotations

import re
from collections import defaultdict

from services.channel import channel_of

_UPI_RE = re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]+@[A-Za-z][A-Za-z0-9]+")
_NAME_AFTER_VPA = re.compile(
    r"@[A-Za-z0-9]+/([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+){1,3})"
)
_MERCHANTS = ("PAYTM", "PHONEPE", "GOOGLE PAY", "GPAY", "AMAZON", "FLIPKART",
              "SWIGGY", "ZOMATO", "JIO", "AIRTEL")

# fallback beneficiary-name extraction (reduces "unresolved" counterparties)
_CD_TOKEN = re.compile(r"/(?:CR|DR)/([A-Za-z]{3,})")
_ALPHA_TOKEN = re.compile(r"[A-Za-z]{4,}")
_CP_STOPWORDS = {
    "UPI", "IMPS", "NEFT", "RTGS", "ATM", "POS", "CASH", "SELF", "PAYMENT",
    "PAY", "REQUEST", "TRANSFER", "CREDIT", "DEBIT", "BANK", "LIMITED", "LTD",
    "BRANCH", "INDIA", "INR", "WITHDRAWAL", "DEPOSIT", "CHARGES", "CHARGE",
    "GST", "INT", "OPENING", "CLOSING", "BALANCE", "BROUGHT", "FORWARD",
    "REVERSAL", "REVERSED", "REFUND", "MOB", "CBS", "BULKPAYMENT", "NEFTCR",
    "IMPSCR", "TRANSACTION", "ACCOUNT", "NUMBER", "VALUE", "DATE",
}
# IFSC bank-code prefixes — routing codes, not counterparties
_BANK_CODES = {
    "YESB", "HDFC", "ICIC", "SBIN", "BARB", "PUNB", "CNRB", "IDIB", "UTIB",
    "UBIN", "MAHB", "IDFB", "INDB", "FINO", "IPOS", "AIRP", "ESFB", "UJVN",
    "JAKA", "DCBL", "RATN", "FDRL", "SIBL", "KVBL", "KKBK", "IOBA", "PYTM",
}
# Generic business-entity descriptor words. On their own they don't identify
# WHICH company sent/received money — dozens of unrelated firms are all
# "... Enterprises" or "... Private Limited" — so letting the "longest token"
# heuristic pick one of these (it usually IS the longest word in the
# narration) wrongly merges unrelated businesses into one shared node. Same
# false-round-trip / false-accumulation risk as the CASH node, just via a
# different word.
_GENERIC_ENTITY_WORDS = {
    "ENTERPRISE", "ENTERPRISES", "INDUSTRY", "INDUSTRIES", "PRIVATE", "PVT",
    "COMPANY", "CORP", "CORPORATION", "GROUP", "TRADERS", "TRADING",
    "ASSOCIATES", "VENTURES", "SOLUTIONS", "SERVICES", "SERVICE", "INC",
    "LLP", "FIRM", "STORES", "STORE", "HOUSE", "MART", "AGENCY", "AGENCIES",
    "EXPORTS", "IMPORTS", "INTERNATIONAL", "GLOBAL", "HOLDINGS",
    "CONSULTANCY", "CONSULTANTS", "INFOTECH", "TECHNOLOGIES", "TECHNOLOGY",
    "SYSTEMS", "PROJECTS", "PROJECT", "CONSTRUCTION", "CONSTRUCTIONS",
    "MARKETING", "SUPPLIERS", "SUPPLY", "DISTRIBUTORS", "DISTRIBUTION",
    "AUTOMOBILES", "MOTORS", "TEXTILES", "FOODS", "ENGINEERING", "WORKS",
}


def _beneficiary_token(narration_upper: str):
    cands = [
        t for t in _ALPHA_TOKEN.findall(narration_upper)
        if t not in _CP_STOPWORDS and t not in _BANK_CODES
    ]
    specific = [t for t in cands if t not in _GENERIC_ENTITY_WORDS]
    if specific:
        return max(specific, key=len)
    # Every candidate was a generic descriptor (e.g. "PAYMENT TO ENTERPRISES"
    # with no distinguishing name left). Don't guess: returning None leaves
    # the transaction unresolved (UI falls back to the raw narration text)
    # instead of silently bucketing it under a generic node shared by
    # unrelated businesses.
    return None


def _to_float(v):
    try:
        return float(str(v).replace(",", "").strip())
    except Exception:
        return None


def resolve_counterparty(narration: str):
    """Module-level counterparty resolver (reused by the investigation engine)."""
    narr = narration or ""
    if not narr:
        return None
    m = _UPI_RE.search(narr)
    if m and not (m.end() < len(narr) and narr[m.end()] == "."):
        return m.group(0).lower()
    pm = _NAME_AFTER_VPA.search(narr)
    if pm:
        return pm.group(1).strip().upper()
    up = narr.upper()
    for mk in _MERCHANTS:
        if mk in up:
            return mk
    if "ATM" in up or "CASH" in up:
        return "CASH"
    # beneficiary abbreviation right after /CR/ or /DR/
    cd = _CD_TOKEN.search(narr)
    if cd:
        tok = cd.group(1).upper()
        if (tok not in _CP_STOPWORDS and tok not in _BANK_CODES
                and tok not in _GENERIC_ENTITY_WORDS):
            return tok
    # last resort: the most distinctive name token in the narration
    return _beneficiary_token(up)


def _classify(node_id: str) -> str:
    if "@" in node_id:
        return "UPI_ID"
    if node_id == "CASH":
        return "CASH"
    if node_id in _MERCHANTS:
        # A known payment-processor/merchant keyword match (Paytm, PhonePe,
        # Jio, Airtel, ...) is a many-to-one pooled bucket just like CASH —
        # every transaction that mentions it collapses into this one node
        # regardless of which real recipient it actually went to, so it
        # carries the same false-round-trip risk as CASH.
        return "MERCHANT"
    digits = re.sub(r"\D", "", node_id)
    if digits and len(digits) >= 6 and digits == node_id:
        return "ACCOUNT"
    return "ENTITY"


class MoneyFlowEngine:

    def __init__(self):
        self.nodes = {}                       # id -> node dict
        self.edges = {}                       # (src,dst) -> edge dict
        self.out_adj = defaultdict(set)
        self.in_adj = defaultdict(set)
        self.unresolved = 0                   # txns with no usable counterparty

    # ------------------------------------------------------------------ #
    # build
    # ------------------------------------------------------------------ #

    def build(self, transactions, holder=None):
        for txn in (transactions or []):
            self._add_txn(txn, holder)
        return self

    def _add_txn(self, txn, holder):
        amount = _to_float(txn.get("amount"))
        if amount is None or amount <= 0:
            return
        direction = (txn.get("debit_credit") or "").upper()
        src, dst = self._resolve(txn, holder, direction)
        if not src or not dst or src == dst:
            if src is None and dst is None:
                self.unresolved += 1
            return
        self._add_edge(src, dst, amount, txn.get("date"), channel_of(txn),
                       narration=txn.get("narration"), time=txn.get("time"))
        # investigator detail: statement-holder identity + activity window
        holder_id = str(txn.get("account") or holder or "SELF").strip()
        self._set_identity(holder_id, txn)
        self._touch_dates(src, txn.get("date"))
        self._touch_dates(dst, txn.get("date"))

    def _set_identity(self, node_id, txn):
        n = self.nodes.get(node_id)
        if not n:
            return
        if not n.get("holder_name") and txn.get("account_holder"):
            n["holder_name"] = txn.get("account_holder")
        if not n.get("bank") and txn.get("holder_bank"):
            n["bank"] = txn.get("holder_bank")
        if not n.get("ifsc") and txn.get("ifsc_code"):
            n["ifsc"] = txn.get("ifsc_code")

    def _touch_dates(self, node_id, date):
        if not date:
            return
        n = self.nodes.get(node_id)
        if not n:
            return
        d = str(date)
        if not n.get("first_seen") or d < n["first_seen"]:
            n["first_seen"] = d
        if not n.get("last_seen") or d > n["last_seen"]:
            n["last_seen"] = d

    def _resolve(self, txn, holder, direction):
        sender = (txn.get("sender_account") or "").strip() \
            if txn.get("sender_account") else ""
        receiver = (txn.get("receiver_account") or "").strip() \
            if txn.get("receiver_account") else ""
        if sender and receiver:
            return sender, receiver

        holder_id = (txn.get("account") or holder or "SELF")
        holder_id = str(holder_id).strip()
        counterparty = self._counterparty(txn)
        if counterparty is None:
            return None, None

        if direction == "DEBIT":
            return holder_id, counterparty
        if direction == "CREDIT":
            return counterparty, holder_id
        return None, None

    def _counterparty(self, txn):
        return resolve_counterparty(txn.get("narration") or "")

    def _ensure_node(self, node_id):
        if node_id not in self.nodes:
            self.nodes[node_id] = {
                "id": node_id, "type": _classify(node_id),
                "total_in": 0.0, "total_out": 0.0,
                "in_count": 0, "out_count": 0,
                "holder_name": None, "bank": None, "ifsc": None,
                "first_seen": None, "last_seen": None,
            }

    # cap on real narration samples kept per edge — just enough to quote as
    # evidence in an explanation, not a full transaction log (that stays in
    # the DB / trail service).
    _MAX_EDGE_SAMPLES = 3

    def _add_edge(self, src, dst, amount, date, channel="Other",
                  narration=None, time=None):
        self._ensure_node(src)
        self._ensure_node(dst)
        key = (src, dst)
        e = self.edges.get(key)
        if e is None:
            e = self.edges[key] = {
                "source": src, "target": dst, "total_amount": 0.0,
                "txn_count": 0, "first_date": date, "last_date": date,
                "channels": {}, "sample_narrations": [],
            }
        e["total_amount"] = round(e["total_amount"] + amount, 2)
        e["txn_count"] += 1
        e["channels"][channel] = e["channels"].get(channel, 0) + 1
        # dominant channel (most transactions on this route)
        e["channel"] = max(e["channels"].items(), key=lambda kv: kv[1])[0]
        if narration and len(e["sample_narrations"]) < self._MAX_EDGE_SAMPLES:
            narration = str(narration).strip()
            if narration and not any(
                s["narration"] == narration for s in e["sample_narrations"]
            ):
                e["sample_narrations"].append({
                    "narration": narration, "date": date, "time": time,
                    "amount": amount, "channel": channel,
                })
        if date:
            if not e["first_date"] or str(date) < str(e["first_date"]):
                e["first_date"] = date
            if not e["last_date"] or str(date) > str(e["last_date"]):
                e["last_date"] = date
        self.out_adj[src].add(dst)
        self.in_adj[dst].add(src)
        self.nodes[src]["total_out"] = round(self.nodes[src]["total_out"] + amount, 2)
        self.nodes[src]["out_count"] += 1
        self.nodes[dst]["total_in"] = round(self.nodes[dst]["total_in"] + amount, 2)
        self.nodes[dst]["in_count"] += 1
