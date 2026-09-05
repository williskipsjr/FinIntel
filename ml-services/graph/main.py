from fastapi import FastAPI
from pydantic import BaseModel

from services.graph_builder import (
    GraphBuilder
)
from services.round_trip_detector import (
    RoundTripDetector
)
from services.money_flow_analyzer import (
    MoneyFlowAnalyzer
)

from services.investigation_service import (
    InvestigationService
)

from services.accumulation_detector import (
    AccumulationDetector
)

from services.entity_graph_builder import(
    EntityGraphBuilder
)

from services.accumulation_detector import (
    AccumulationDetector
)

from services.transaction_graph_builder import (
    TransactionGraphBuilder
)

entity_builder = (
    EntityGraphBuilder()
)


accumulation_detector = (
    AccumulationDetector()
)

investigator = InvestigationService()
money_flow = MoneyFlowAnalyzer()

round_trip_detector = RoundTripDetector()

app = FastAPI()

builder = GraphBuilder()

txn_graph_builder = (
    TransactionGraphBuilder()
)

class BuildEntityGraphRequest(
    BaseModel
):
    transactions: list
    entities: list

class TransactionGraphRequest(
    BaseModel
):
    transactions: list
    entities: list
class BuildGraphRequest(
    BaseModel
):
    transactions: list


@app.get("/health")
def health():

    return {
        "service": "graph",
        "status": "healthy"
    }


@app.post("/build-graph")
def build_graph(
    request: BuildGraphRequest
):

    builder.build(
        request.transactions
    )

    return {
        "status": "success",
        "nodes_loaded":
            len(request.transactions)
    }

@app.post(
    "/build-entity-graph"
)
def build_entity_graph(
    request:
    BuildEntityGraphRequest
):

    entity_builder.build(
        request.transactions,
        request.entities
    )

    return {
        "status": "success",
        "transactions":
            len(
                request.transactions
            ),
        "entities":
            len(
                request.entities
            )
    }

@app.get("/round-trips")
def round_trips():

    cycles = (
        round_trip_detector
        .detect_cycles()
    )

    return {

        "count":
            len(cycles),

        "cycles":
            cycles
    }
@app.get(
    "/money-flow/{account}"
)
def money_flow_trace(
    account: str
):

    paths = money_flow.trace(
        account
    )

    return {

        "source":
            account,

        "path_count":
            len(paths),

        "paths":
            paths
    }


@app.get(
    "/investigation/account/{account_id}"
)
def investigate_account(
    account_id: str
):

    return (
        investigator
        .investigate(
            account_id
        )
    )

@app.get(
    "/accumulation-accounts"
)
def accumulation_accounts():

    return {

        "accounts":
            accumulation_detector
            .top_accumulation_accounts()
    }

@app.post(
    "/build-transaction-graph"
)
def build_transaction_graph(
    request:
        TransactionGraphRequest
):

    txn_graph_builder.build(
        request.transactions,
        request.entities
    )

    return {
        "status":
            "success"
    }


# ==========================================================================
# Phase 3 — in-memory graph intelligence (dependency-free, Neo4j-independent).
# Stateless: each call builds the graph from the supplied transactions, so the
# backend can scope analysis to a case without a running graph DB.
# ==========================================================================

from typing import Optional               # noqa: E402
from services.flow_engine import MoneyFlowEngine          # noqa: E402
from services import flow_analytics as fa                 # noqa: E402


class FlowRequest(BaseModel):
    account: Optional[str] = None          # statement holder account (optional)
    transactions: list = []


def _engine(req: "FlowRequest"):
    return MoneyFlowEngine().build(req.transactions, holder=req.account)


@app.post("/flow/analyze")
def flow_analyze(request: FlowRequest):
    eng = _engine(request)
    return {
        "summary": fa.money_flow_summary(eng),
        "round_trips": fa.detect_round_trips(eng),
        "communities": fa.detect_communities(eng),
        "centrality": fa.degree_centrality(eng),
        "graph": fa.graph_payload(eng),
    }


@app.post("/flow/money-flow")
def flow_money_flow(request: FlowRequest):
    eng = _engine(request)
    payload = fa.graph_payload(eng)
    return {
        "summary": fa.money_flow_summary(eng),
        "nodes": payload["nodes"],
        "edges": payload["edges"],
    }


@app.post("/flow/round-trips")
def flow_round_trips(request: FlowRequest):
    eng = _engine(request)
    cycles = fa.detect_round_trips(eng)
    return {"count": len(cycles), "round_trips": cycles}


@app.post("/flow/clusters")
def flow_clusters(request: FlowRequest):
    eng = _engine(request)
    return {"communities": fa.detect_communities(eng)}


# ----- DB-driven: build the graph straight from Postgres (whole network) -----

from services.postgres_loader import PostgresLoader        # noqa: E402
from services import persistence                            # noqa: E402

_loader = PostgresLoader()


def _engine_from_rows(rows):
    # rows already carry a per-statement holder `account`; build directly.
    return MoneyFlowEngine().build(rows)


def _rows_for_node(node_id):
    """Load the transactions behind a money-flow node. Single-account holders are
    exposed as `STMT:<uuid>` when they have no account number, so look those up
    by statement id; everything else resolves by account/counterparty."""
    if node_id and node_id.startswith("STMT:"):
        return _loader.load_statement_transactions(node_id[5:])
    return _loader.load_account_transactions(node_id)


def _full_result(eng):
    return {
        "summary": fa.money_flow_summary(eng),
        "round_trips": fa.detect_round_trips(eng),
        "communities": fa.detect_communities(eng),
        "centrality": fa.degree_centrality(eng),
        "graph": fa.graph_payload(eng),
    }


def _analyze_all(refresh: bool = False):
    """Whole-network analysis with persistence: cached unless refresh=true.
    A single cached 'analyze' entry powers money-flow/round-trips/clusters."""
    if not refresh:
        cached = persistence.load("all", "analyze")
        if cached:
            return cached["payload"]
    eng = _engine_from_rows(_loader.load_all_transactions())
    result = _full_result(eng)
    persistence.save("all", "analyze", result)
    return result


@app.get("/flow/analyze/all")
def flow_analyze_all(refresh: bool = False):
    return _analyze_all(refresh)


@app.get("/flow/money-flow/all")
def flow_money_flow_all(refresh: bool = False):
    a = _analyze_all(refresh)
    g = a.get("graph", {})
    return {"summary": a.get("summary"),
            "nodes": g.get("nodes", []), "edges": g.get("edges", [])}


@app.get("/flow/round-trips/all")
def flow_round_trips_all(refresh: bool = False):
    a = _analyze_all(refresh)
    rt = a.get("round_trips", [])
    return {"count": len(rt), "round_trips": rt}


@app.get("/flow/clusters/all")
def flow_clusters_all(refresh: bool = False):
    a = _analyze_all(refresh)
    return {"communities": a.get("communities", [])}


@app.get("/flow/analyze/statement/{statement_id}")
def flow_analyze_statement(statement_id: str):
    eng = _engine_from_rows(_loader.load_statement_transactions(statement_id))
    return _full_result(eng)


@app.get("/flow/analyze/account/{account}")
def flow_analyze_account(account: str):
    eng = _engine_from_rows(_loader.load_account_transactions(account))
    return _full_result(eng)


# ==========================================================================
# Phase 4 — Risk Fusion (DB-driven). Fuses graph + transaction signals
# (+ optional temporal/anomaly) into an explainable per-account risk score.
# ==========================================================================

import os                                   # noqa: E402
import json as _json                         # noqa: E402
import urllib.request                        # noqa: E402
from services.risk_fusion import RiskFusionEngine          # noqa: E402

_risk = RiskFusionEngine()

ANOMALY_URL = os.getenv("ANOMALY_URL", "http://localhost:8007")
TEMPORAL_URL = os.getenv("TEMPORAL_URL", "http://localhost:8008")


def _get_json(url, timeout=15):
    try:
        with urllib.request.urlopen(url, timeout=timeout) as resp:
            return _json.loads(resp.read().decode())
    except Exception as exc:
        print(f"[INFO] external signal fetch failed ({url}): {exc}")
        return None


def _external_maps():
    """Pull per-account anomaly (8007) + temporal (8008) scores. Graceful: a
    down/empty service just means that signal is skipped in the fusion."""
    temporal_map, anomaly_map = {}, {}
    a = _get_json(f"{ANOMALY_URL}/anomaly")
    if a and isinstance(a.get("results"), list):
        for r in a["results"]:
            acct, sc = r.get("account"), r.get("stat_score")
            if acct is not None and sc is not None:
                anomaly_map[str(acct)] = float(sc)
    t = _get_json(f"{TEMPORAL_URL}/temporal")
    if t and isinstance(t.get("results"), list):
        for r in t["results"]:
            acct, sc = r.get("account"), r.get("temporal_score")
            if acct is not None and sc is not None:
                temporal_map[str(acct)] = float(sc)
    return temporal_map, anomaly_map


def _risk_for_rows(rows, top_n=None, with_external=True):
    eng = _engine_from_rows(rows)
    trips = fa.detect_round_trips(eng)
    temporal_map, anomaly_map = _external_maps() if with_external else ({}, {})
    scored = _risk.score_network(
        eng, rows=rows, round_trips=trips,
        temporal_map=temporal_map, anomaly_map=anomaly_map,
    )
    return scored[:top_n] if top_n else scored


def _risk_all(refresh: bool = False, with_external: bool = True):
    """Whole-network risk with persistence (cached unless refresh=true).
    Only the external-signals-included variant is cached."""
    if with_external and not refresh:
        cached = persistence.load("all", "risk")
        if cached:
            return cached["payload"]
    rows = _loader.load_all_transactions()
    scored = _risk_for_rows(rows, with_external=with_external)
    if with_external:
        persistence.save("all", "risk", scored)
    return scored


def _representative_top_risks(per_statement: int = 3, refresh: bool = False):
    """Whole-network risk ranking that GUARANTEES every statement is represented.

    Problem: `_risk_all` scores all accounts in one combined graph and normalizes
    volume-based signals (accumulation / fan / centrality) against GLOBAL maxima.
    A smaller-volume statement's accounts therefore get suppressed and fall below
    the top-N cutoff, so a whole-network report looks like it only covers the
    largest statement.

    Fix: start from the true whole-network ranking, then fold in each statement's
    own top accounts scored *within that statement* (fair, un-suppressed), keeping
    the higher of the two scores. Result: the genuine cross-statement ranking, but
    no statement's key suspicious accounts can be buried by another's volume.
    Cached under ('all','risk_repr'); the ingestion worker clears it on new data.
    """
    if not refresh:
        cached = persistence.load("all", "risk_repr")
        if cached:
            return cached["payload"]

    by_node = {r["node"]: dict(r) for r in _risk_all()}

    for sid in _loader.all_statement_ids():
        rows = _loader.load_statement_transactions(sid)
        if not rows:
            continue
        # in-statement scoring (no external signals -> avoids N extra HTTP calls
        # and judges each account fairly within its own statement)
        for r in _risk_for_rows(rows, top_n=per_statement, with_external=False):
            node = r["node"]
            cur = by_node.get(node)
            if cur is None:
                entry = dict(r)
                entry["source_statement"] = sid
                by_node[node] = entry
            elif r["risk_score"] > cur.get("risk_score", 0):
                promoted = dict(cur)
                promoted["risk_score"] = r["risk_score"]
                promoted["risk_level"] = r["risk_level"]
                promoted["factors"] = r.get("factors", cur.get("factors"))
                promoted["top_reasons"] = r.get("top_reasons", cur.get("top_reasons"))
                promoted["tags"] = r.get("tags", cur.get("tags"))
                promoted["source_statement"] = sid
                by_node[node] = promoted
            else:
                cur.setdefault("source_statement", sid)

    ranked = sorted(by_node.values(), key=lambda r: r.get("risk_score", 0),
                    reverse=True)
    persistence.save("all", "risk_repr", ranked)
    return ranked


@app.get("/risk/top")
def risk_top(limit: int = 20, include_external: bool = True, refresh: bool = False):
    scored = _risk_all(refresh=refresh, with_external=include_external)
    return {"count": len(scored[:limit]), "top_risks": scored[:limit]}


@app.get("/risk/top/representative")
def risk_top_representative(limit: int = 20, refresh: bool = False):
    """Whole-network top risks with every statement guaranteed representation."""
    scored = _representative_top_risks(refresh=refresh)
    return {"count": len(scored[:limit]), "top_risks": scored[:limit]}


@app.get("/risk/top/statement/{statement_id}")
def risk_top_statement(statement_id: str, limit: int = 20, include_external: bool = True):
    """Top fused risks scoped to a single statement (no cross-statement leakage)."""
    rows = _loader.load_statement_transactions(statement_id)
    scored = _risk_for_rows(rows, with_external=include_external)
    return {"count": len(scored[:limit]), "top_risks": scored[:limit]}


@app.get("/risk/account/{account}")
def risk_account(account: str, include_external: bool = True):
    rows = _loader.load_account_transactions(account)
    scored = _risk_for_rows(rows, with_external=include_external)
    profile = next((r for r in scored if r["node"] == account), None)
    if profile is None:
        return {"account": account, "risk_score": 0.0, "risk_level": "LOW",
                "factors": [], "top_reasons": [],
                "note": "no resolvable activity for this account"}
    return profile


# ==========================================================================
# Phase 5 — Investigation engine (top-suspicious / counterparties / timeline)
# ==========================================================================

from services import investigation as inv                  # noqa: E402


@app.get("/investigation/top-suspicious")
def investigation_top_suspicious(limit: int = 20, account_only: bool = False,
                                 include_external: bool = True,
                                 refresh: bool = False):
    scored = _risk_all(refresh=refresh, with_external=include_external)
    return {"count": len(scored),
            "accounts": inv.top_suspicious(scored, limit, account_only)}


@app.get("/investigation/top-suspicious/statement/{statement_id}")
def investigation_top_suspicious_statement(statement_id: str, limit: int = 20,
                                           account_only: bool = False,
                                           include_external: bool = True):
    """Suspicious accounts scoped to one statement's transactions only."""
    rows = _loader.load_statement_transactions(statement_id)
    scored = _risk_for_rows(rows, with_external=include_external)
    return {"count": len(scored),
            "accounts": inv.top_suspicious(scored, limit, account_only)}


@app.get("/investigation/top-suspicious/representative")
def investigation_top_suspicious_representative(limit: int = 20,
                                                account_only: bool = False,
                                                refresh: bool = False):
    """Whole-network suspicious accounts with every statement represented."""
    scored = _representative_top_risks(refresh=refresh)
    return {"count": len(scored),
            "accounts": inv.top_suspicious(scored, limit, account_only)}


@app.get("/investigation/counterparties/{account}")
def investigation_counterparties(account: str):
    rows = _rows_for_node(account)
    eng = _engine_from_rows(rows)
    return inv.counterparty_analysis(eng, account)


@app.get("/investigation/timeline/{account}")
def investigation_timeline(account: str):
    rows = _rows_for_node(account)
    return {"account": account, "count": len(rows),
            "timeline": inv.timeline(rows)}


# ==========================================================================
# Phase 6 — Explainability (narratives + evidence)
# ==========================================================================

from services import explainability as expl                # noqa: E402


@app.get("/explain/account/{account}")
def explain_account_endpoint(account: str, include_external: bool = True):
    rows = _loader.load_account_transactions(account)
    eng = _engine_from_rows(rows)
    scored = _risk_for_rows(rows, with_external=include_external)
    profile = next((r for r in scored if r["node"] == account), None)
    if profile is None:
        profile = {"node": account, "risk_score": 0.0, "risk_level": "LOW",
                   "factors": [], "top_reasons": []}
    return expl.explain_account(profile, eng, account)


def _engine_for_scope(case_id: str):
    """Same scoping rule as every other endpoint: "all"/unset = whole
    network, anything else = that statement only. Cycle ids are only stable
    *within* a scope, so explaining a chain_id requires rebuilding the exact
    same scope the caller's round-trip list came from — mixing scopes here
    was the root cause of round-trip explanations pointing at the wrong
    (unrelated, whole-network) cycle when viewing a single statement."""
    if case_id and case_id != "all":
        return _engine_from_rows(_loader.load_statement_transactions(case_id))
    return _engine_from_rows(_loader.load_all_transactions())


@app.get("/explain/round-trips")
def explain_round_trips_list(case_id: str = "all"):
    eng = _engine_for_scope(case_id)
    cycles = fa.detect_round_trips(eng)
    return {"count": len(cycles),
            "round_trips": [
                {"chain_id": c["id"], "nodes": c["nodes"],
                 "bottleneck_amount": c["min_amount"], "length": c["length"]}
                for c in cycles]}


@app.get("/explain/round-trip/{chain_id}")
def explain_round_trip_endpoint(chain_id: int, case_id: str = "all"):
    eng = _engine_for_scope(case_id)
    cycles = fa.detect_round_trips(eng)
    cycle = next((c for c in cycles if c["id"] == chain_id), None)
    if cycle is None:
        return {"chain_id": chain_id, "found": False,
                "message": "round-trip chain not found"}
    return expl.explain_round_trip(cycle, eng)


@app.get("/investigation/account/{account}")
def investigation_account(account: str, include_external: bool = True):
    """One-stop investigator dossier for an account."""
    rows = _loader.load_account_transactions(account)
    eng = _engine_from_rows(rows)
    scored = _risk_for_rows(rows, with_external=include_external)
    profile = next((r for r in scored if r["node"] == account), None)
    return {
        "account": account,
        "risk": profile,
        "counterparties": inv.counterparty_analysis(eng, account),
        "round_trips": fa.detect_round_trips(eng),
        "timeline_preview": inv.timeline(rows, limit=50),
    }