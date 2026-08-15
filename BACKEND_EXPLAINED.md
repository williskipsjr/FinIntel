# FinIntel Backend — Complete Technical Walkthrough

> An in-depth technical walkthrough of the entire backend: architecture, every microservice,
> the algorithms behind each detection technique, the data model, and the
> reasoning behind key design decisions. Written so any team member or security auditor can understand
> this end-to-end without needing to re-read the code.

---

## 1. The 30-Second Pitch

FinIntel ingests raw bank statements (PDF/CSV/XLSX/DOCX/scanned images), turns
them into a clean transaction ledger, then runs **eight independent detection
engines** — graph analysis, risk fusion, anomaly detection, temporal pattern
detection, FIFO money-trail tracing, entity resolution, and validation — to
answer one investigator question: **"where did the money come from, where did
it go, and which accounts should I look at first?"**

Every engine is **explainable** — no black-box score is ever returned without
the factors, weights, and evidence that produced it.

---

## 2. High-Level Architecture

```
                         ┌─────────────────────────┐
                         │   React / Vite Frontend  │
                         │   (port 5173)             │
                         └────────────┬─────────────┘
                                      │ HTTP (JSON envelope)
                                      ▼
                         ┌─────────────────────────┐
                         │   Rust (Axum) Gateway     │   ← the ONLY port the
                         │   port 8080               │     frontend talks to
                         └────────────┬─────────────┘
                                      │ internal HTTP, never exposed to the browser
              ┌───────────┬───────────┼───────────┬────────────┬───────────┐
              ▼           ▼           ▼            ▼            ▼           ▼
          OCR (8001)  Standardize  Entity (8003) Validation  Graph (8005) Report(8010)
                       (8002)                    (8004)           │
                                                                    ├─ Anomaly (8007)
                                                                    ├─ Temporal (8008)
                                                                    └─ Trail (8009)
                                      │
                                      ▼
                         ┌─────────────────────────┐
                         │   PostgreSQL              │
                         │   statements / transactions│
                         │   entities / jobs / cache  │
                         └─────────────────────────┘
```

**Why a Rust gateway in front of Python microservices?**
The gateway is the single front door: it terminates CORS, owns the Postgres
connection pool, runs the async ingestion pipeline, and wraps every response in
one consistent envelope (`{success, data, error, meta}`). The Python side is
pure computation — each service is stateless and horizontally scalable, and a
service crashing (e.g., anomaly detection) never takes down ingestion or the
rest of the API, because the gateway treats ML calls as best-effort where
appropriate (see §7).

**Ports and responsibilities**

| Port | Service | Language | Role |
|---|---|---|---|
| 8080 | **Gateway** | Rust / Axum | Public API, auth-free CORS layer, Postgres, job queue, orchestration |
| 8001 | OCR | Python / FastAPI | Extracts raw rows from any file format |
| 8002 | Standardize | Python / FastAPI | Maps arbitrary bank columns → canonical schema |
| 8003 | Entity | Python / FastAPI | Extracts + resolves UPI IDs, accounts, IFSC, people, merchants |
| 8004 | Validation | Python / FastAPI | Dedup, failed-transaction detection, balance integrity, confidence scoring |
| 8005 | Graph | Python / FastAPI | Money-flow graph, round-trip detection, risk fusion, investigation views, explainability |
| 8007 | Anomaly | Python / FastAPI | IsolationForest statistical outlier detection |
| 8008 | Temporal | Python / FastAPI | Burst / velocity / structuring detection |
| 8009 | Trail | Python / FastAPI | FIFO money-trail tracing (Core Requirement 5) |
| 8010 | Report | Python / FastAPI | Aggregates everything into JSON/PDF/Excel/DOCX briefs |

**Golden rule enforced across the whole codebase:** the frontend and any
external caller only ever talk to **port 8080**. The gateway is the sole
client of every ML service — this keeps a single security/observability
boundary and means each ML service's contract can change without touching the
frontend.

---

## 3. The Ingestion Pipeline (what happens after "Upload")

This is the core flow, orchestrated entirely inside the Rust backend's
background worker (`backend/src/services/worker.rs`), so uploads return
instantly and processing happens asynchronously.

```
Upload (multipart) ──▶ [queued]
        │
        ▼
1. OCR / Extraction  (8001)  — file → raw structured rows
        │
        ▼
2. Standardize        (8002) — raw rows → canonical transactions (date, amount, sender/receiver, narration…)
        │
        ▼
3. Validate            (8004) — flags duplicates / failed txns / balance mismatches, scores confidence
        │
        ▼
4. Persist to Postgres          — transactions saved with statement_id FK
        │
        ▼
5. Entity Resolution   (8003) — extract + canonicalize UPI IDs / accounts / IFSC / names, persist
        │
        ▼
6. Graph Intelligence  (8005) — whole-network graph rebuilt + cached (round trips, risk, flow)
        │
        ▼
   [completed] ── polled by frontend via GET /api/v1/jobs/{job_id}/status
```

Each stage updates a `jobs` row (`status`, `progress %`, `stage`) so the
frontend's "Forensic Processing Engine" page can render a live pipeline
visualization. If any stage throws, the job is marked `failed` with the error
message — nothing downstream runs, and the statement's transactions already
written are left intact for debugging (they simply won't appear in "completed"
statement lists).

### Why stage 6 exists after every single upload
The graph/risk/round-trip engines are **stateless and rebuild themselves from
Postgres on every request** — there is no persistent graph database driving
production logic (Neo4j exists in the codebase but is an optional/legacy path;
see §6.1). So after each upload the worker explicitly recomputes and
**invalidates the whole-network cache** (`analysis_cache` table) — otherwise a
second uploaded statement would silently not show up in "Whole Network"
results because a stale cached aggregate from the first upload would still be
served. This was one of the concrete bugs fixed in this pass (see §9).

---

## 4. Service-by-Service Breakdown

### 4.1 OCR Service (8001) — Multi-Format Extraction

**Problem it solves:** bank statements arrive as PDFs, scanned images, CSVs,
Excel, DOCX, or plain text — each with a completely different internal
structure, and even PDFs vary between "real text" and "scanned image with no
text layer."

**Design — a parser registry + fallback chain:**
1. `ParserRegistry` picks a parser by file extension (`csv_parser`,
   `excel_parser`, `pdf_parser`, `docx_parser`, `image_parser`, `txt_parser`).
2. If a PDF has no extractable text layer (`ocr_required=True`), it falls back
   to `ScannedPDFParser`, which rasterizes pages and runs OCR.
3. Text-based sources (raw PDF text, OCR'd scans) don't come out as neat rows —
   they come out as **page text strings**. `TextStatementReconstructor` then
   parses that free text into structured transaction rows (date/narration/
   amount/balance) using table-detection heuristics
   (`table_detector.py`, `pdf_table_extractor.py`, `row_grouper.py`,
   `table_reconstructor.py`, `transaction_merger.py`).
4. `_ensure_structured_rows()` is the safety net: **every** downstream
   consumer receives `list[dict]`, never bare strings — this specifically
   fixed a class of bug where a scanned statement would 422 the standardize
   service because it received raw text instead of rows.

**Key architectural insight:** OCR here isn't "throw the PDF at Tesseract and
hope." It's a layered pipeline — table structure detection, row grouping
across wrapped lines, and transaction merging (a single logical transaction
that OCR split across two lines gets stitched back together) — before
anything is treated as a transaction.

### 4.2 Standardize Service (8002) — Canonicalization

**Problem it solves:** every bank uses different column names ("Withdrawal
Amt.", "Debit", "DR Amount"...), different date formats, and either a
split debit/credit layout or a single signed-amount column.

**Design — data-driven column resolution, not hardcoded bank templates:**
- `column_intelligence.resolve_columns(headers)` scores each source header
  against canonical fields (date, narration, debit, credit, balance, amount,
  ref_no, txn_type, sender/receiver) using heuristics, returning a
  `mapping` + a **confidence score per column** + `amount_mode` (`split` vs
  `signed`). This means a bank format the team never saw in testing still
  gets mapped reasonably, with the confidence exposed to the frontend as a
  QA signal rather than silently failing.
- `AmountNormalizer` parses real-world messy numbers: `"5,389.38Cr"`,
  `"(500.00)"`, `"₹1,200"` all become clean floats; `balance` keeps its sign
  (relevant for overdraft accounts), amount/debit/credit do not.
- A `0` in a split debit/credit column means "no movement on this side" — it's
  treated as `None`, not a phantom zero-value debit, so the enricher picks the
  correct direction.
- `TransactionEnricher` derives the final `debit_credit` direction and
  `txn_type`.

**Output:** a list of canonical transactions plus a `column_resolution` meta
block (mapping + confidence + unmapped columns) — this transparency was a
deliberate choice so a human reviewer can immediately see *why* a statement
parsed unusually well or badly.

### 4.3 Validation Service (8004) — Data Cleaning & Integrity (Core Requirement 2)

Four checks run in sequence, each annotating the transaction with
`is_duplicate` / `is_failed` / `is_valid` / `validation_notes[]`, ending in a
single `confidence_score`:

1. **Missing-data checks** — flags missing date/amount/balance.
2. **Duplicate detection** — a conservative **6-field composite key**: date +
   amount + direction + reference + narration + **running balance**. Balance
   is included deliberately: two genuinely repeated payments (same payee,
   same amount, same day) land on *different* running balances and are
   correctly NOT flagged, while a truly duplicated ledger line (same balance
   too) is.
3. **Failed/reversed transaction detection** — two independent signals:
   - **Reversal-pair matching**: a DEBIT followed within a 10-transaction
     window by a CREDIT of the same amount (±0.01 tolerance) — both legs
     marked failed. This is the primary, structural signal.
   - **Keyword fallback** — narration contains REVERSAL/REFUND/FAILED/
     RETURNED/CHARGEBACK, for reversals whose counter-leg fell outside the
     statement window.
4. **Balance-consistency validation** — enforces the correct ledger invariant:
   `balance[i] == balance[i-1] + credit[i] - debit[i]` (previous → current,
   not current → next — an inverted version of this check was an earlier bug
   the team explicitly fixed). Rows adjacent to a missing balance are
   skipped rather than false-flagged.

**Confidence scoring** is a simple, auditable penalty model — start at 1.0,
subtract a fixed penalty per issue found (missing_amount −0.4, balance_mismatch
−0.4, missing_date −0.2, duplicate −0.2, missing_balance −0.15), clamp to
`[0,1]`. A transaction with no usable amount is additionally hard-marked
`is_valid = False` regardless of score.

### 4.4 Entity Service (8003) — Extraction + Resolution

**Two-stage design**, deliberately separated:

**Stage 1 — Extraction (`EntityExtractor`)**: pulls every *mention* of a typed
entity from narration + reference text using dedicated deterministic
extractors — `UPIExtractor`, `IFSCExtractor`, `PhoneExtractor`,
`AccountExtractor`, `BankExtractor`, `OrganizationExtractor`,
`MerchantExtractor`, `PersonExtractor` — plus **optional** spaCy NER for
person/org names not caught by rules (the service runs identically if spaCy
isn't installed — pure graceful degradation, never a hard dependency).
A validity filter (`_is_valid_name`) rejects spaCy "names" that are actually
transaction codes (e.g. `UPI/515040414268/DR`), requiring real letters, no
slashes/@, no long digit runs, and excluding known non-name tokens.

**Stage 2 — Resolution (`EntityResolver`)**: groups raw mentions into
canonical entities so "the same account seen in 3 different statements"
becomes **one** entity with an occurrence count and alias list, not three
separate rows:
- **Identifier types** (UPI_ID, IFSC, ACCOUNT_NO, PHONE, BANK) resolve by
  **exact normalized identity** — UPI IDs lowercase, phone/account strip
  non-digits, IFSC/BANK uppercase. No ML needed; this is why a UPI ID from
  statement A and the same UPI ID from statement B *correctly* merge into one
  entity even though entities are stored in a single global table.
- **Name types** (PERSON, MERCHANT, ORGANIZATION) resolve by normalized name
  equality, with an **optional** embedding-based fuzzy merge
  (sentence-transformers cosine similarity ≥ 0.85) if the library happens to
  be installed — again, never a hard dependency; if absent, exact-name
  clusters are still returned unmerged.

This is why the entities table has **no `statement_id` column** — entities
are, by design, resolved across the whole database. It's also why our FIX 6
work (per-statement scoping of *risk/suspicious* views) had to re-derive
per-statement entity activity from `transactions` directly rather than
filtering the `entities` table (see §9).

### 4.5 Graph Service (8005) — The Analytical Core

This is the largest and most important service. It has five sub-engines:

#### a) MoneyFlowEngine (`flow_engine.py`) — the graph itself
A dependency-free, in-memory directed graph built fresh from a list of
transaction rows on every request (no persistent graph DB in the hot path).
Handles **two shapes of data**:
- Multi-account data with explicit `sender_account`/`receiver_account`.
- **Single-account bank statements** (the common real-world case) — here
  there's no explicit "receiver," so the engine derives the counterparty
  from the narration itself: it detects a UPI VPA (`name@bank`), a payee name
  following a VPA slash pattern, known merchant keywords (Paytm/PhonePe/
  Amazon/Swiggy/...), CASH/ATM, or a fallback "most distinctive alphabetic
  token" in the narration that isn't a routing code/bank prefix/stopword.
  Direction (who is source, who is target) then comes from `debit_credit`.
- Every edge aggregates `total_amount`, `txn_count`, `first_date`,
  `last_date` between the same two nodes across the whole scope. Node type is
  auto-classified (`UPI_ID`, `CASH`, `ACCOUNT`, or generic `ENTITY`).

**Why this matters:** traditional graph-analysis implementations often only work
on multi-party ledgers with explicit sender/receiver columns. Real Indian bank
statement exports are almost always single-account — this engine is what
makes round-trip and money-flow detection *possible* on the actual dataset,
not just synthetic test data.

#### b) Flow Analytics (`flow_analytics.py`) — Core Requirements 3 & 4
- **Round-trip / cycle detection** (Core Req 3): a Johnson-style simple-cycle
  enumeration — "smallest node id is the entry point" rule finds each cycle
  exactly once and prunes the DFS. Caps the scan at 5,000 cycles on dense
  graphs, then **ranks by bottleneck amount** (the smallest edge in the loop —
  i.e., the maximum amount that could actually circulate through the whole
  chain) and keeps the top 200. Each cycle reports `nodes`, `edge_amounts`
  (per-hop transfer amounts — what powers the round-trip graph's edge
  labels), `min_amount` (bottleneck) and `total_amount`.
- **Money-flow summary** (Core Req 4): accumulation accounts (highest total
  inflow — candidate "destination"/mule accounts), source accounts (highest
  outflow), fan-in/fan-out (≥3 distinct counterparties), and **layering
  detection** — accounts where inflow ≈ outflow (within 10%) and both sides
  are non-zero, the classic pass-through / mule pattern.
- **Communities** — weakly-connected components via union-find, surfacing
  clusters of accounts that only transact within their own group.
- **Degree centrality** — normalized (in-degree + out-degree) / (N-1), a cheap
  proxy for "how central is this account to the network."

#### c) Risk Fusion (`risk_fusion.py`) — the explainable scoring model
Fuses up to **nine independent signals** into one 0–100 score per node, with
every contribution traceable:

| Signal | Weight | What it measures |
|---|---|---|
| round_trip | 0.22 | Membership in a detected cycle |
| layering | 0.18 | Pass-through ratio (mule pattern) |
| accumulation | 0.15 | Share of total inbound concentration |
| fan_in | 0.10 | Distinct senders (collection behaviour) |
| fan_out | 0.10 | Distinct receivers (dispersion behaviour) |
| anomaly | 0.10 | External IsolationForest score (optional) |
| temporal | 0.08 | External burst/velocity/structuring score (optional) |
| failed_ratio | 0.04 | Proportion of failed/reversed transactions |
| centrality | 0.03 | Network connectivity |

Weights are **renormalized** over whichever signals are actually present —
if the Anomaly/Temporal services are down, their weight is proportionally
redistributed rather than silently zeroed against the max of 100 (graceful
degradation again). Every non-zero signal becomes a `factor` object carrying
its raw value, normalized weight, contribution, a human-readable explanation
string, and supporting **evidence** (e.g., `{total_received, sender_count}`
for accumulation) — this is what the Explainability layer and the frontend's
"Risk Indicators" bullet lists are built from. `risk_level` is a simple
threshold ladder: ≥80 CRITICAL, ≥60 HIGH, ≥35 MEDIUM, else LOW.

#### d) Investigation Views (`investigation.py`) — Core Requirement 5-adjacent
Investigator-facing shaping on top of risk-fusion output: `top_suspicious`
(ranked list with type + patterns), `counterparty_analysis` (who an account
sent to / received from, sorted by amount), and chronological `timeline`
(reuses the same narration-based counterparty resolver as the graph engine).

#### e) Explainability (`explainability.py`)
Deterministic, template-based narrative generation — **no LLM required, by
design**, so explanations are reproducible, fast, and don't depend on an
external API key during a demo. `explain_account` turns a risk profile into a
prose narrative + `why` (top 3 reasons) + `how` (every contributing factor
with its evidence) + a `confidence` score that increases with the number of
corroborating signals. `explain_round_trip` narrates a specific cycle: the
full path, the bottleneck amount, and a severity tier (`CRITICAL` ≥ ₹10L,
`HIGH` ≥ ₹1L, `MEDIUM` ≥ ₹10K, else `LOW`).

#### f) Persistence & scoping (`persistence.py`, `postgres_loader.py`)
- `PostgresLoader` has exactly three query shapes: `load_all_transactions()`
  (whole network), `load_statement_transactions(id)` (one statement),
  `load_account_transactions(account)` — all three only ever read **clean**
  rows (`is_valid = true AND is_duplicate = false/NULL`), so a dirty or
  duplicated row never pollutes the graph or risk model.
- `analysis_cache` (Postgres table, key = `(scope, kind)`) memoizes the
  expensive whole-network `analyze`/`risk` computation so it isn't recomputed
  on every dashboard load — **and must be invalidated whenever the dataset
  changes**, which is exactly the bug fixed in §9.

### 4.6 Anomaly Service (8007) — Statistical Outlier Detection

Feature engineering (`FeatureBuilder`) per **sender account**: mean/std/max
transaction amount, transaction count, unique counterparty count, and the
ratio of large (>₹50,000) transactions. These six features feed an
**Isolation Forest** (`sklearn`, 200 estimators, 5% contamination assumption).
The raw decision function is inverted and min-max normalized to `[0,1]`, then
thresholded at the 90th/95th percentile of the *current* dataset to tag
`moderate_statistical_anomaly` / `high_statistical_anomaly`. Because the
percentile thresholds are computed from the data itself, thresholds adapt
automatically to each dataset's scale rather than using a fixed arbitrary
cutoff.

### 4.7 Temporal Service (8008) — Behavioural Pattern Detection

Three independent statistical detectors, fused with a simple additive
(capped at 1.0) score per account:
- **Burst detection** — z-score of an account's transaction *count* against
  the population mean; z > 2 → `burst_activity`.
- **Velocity detection** — z-score of average *daily volume* against the
  population; z > 2 → `velocity_spike`.
- **Structuring detection** — flags transactions in the ₹45,000–₹50,000 band
  (just under the common ₹50,000 reporting threshold) — ≥3 such transactions
  from one account → `structuring_detected`, a classic anti-money-laundering
  "smurfing" signal (deliberately staying just under a reporting limit).

### 4.8 Trail Service (8009) — FIFO Money-Trail Tracing (Core Requirement 5)

Implements the spec precisely: *"when a credit is received, track how it's
spent (debited) until it's exhausted, following FIFO if multiple credits
overlap."*

Model: every CREDIT opens a **lot** of money (its own remaining balance).
Every subsequent DEBIT consumes from the **oldest open lot first** — pure
FIFO queue semantics. For every credit, the tracker returns the full ordered
list of debits that spent it, **including where each debit sent the money**
(via the same narration-based counterparty resolver used elsewhere), so an
investigator sees not just "this credit was spent" but "this credit funded
these specific onward transfers." `trace_for_credit` also supports the
reverse lookup — given a debit's transaction ID, which credit(s) funded it.

### 4.9 Report Service (8010) — Assembly & Export

`ReportBuilder.build(case_id, refresh)` is a pure aggregator: DB counts +
validation summary + entity list (from Postgres) + money-flow/round-trips
(from the Graph service, scoped by `case_id`) + top risks, merged into one
report model with auto-generated **recommendations** (e.g., "Investigate N
round-trip chains," "Scrutinize destination account X," "Prioritize CRITICAL
accounts: ..."). The same report model is shared by all four export formats —
`report_json` returns it directly; `excel_report.py`/`docx_report.py`/
`pdf_report.py` render it into their respective binary formats. This
"one model, four renderers" design means every export format is guaranteed to
show identical numbers — there's no separate PDF-only or Excel-only query
path that could drift out of sync.

---

## 5. The Gateway (Rust / Axum) — API Contract & Orchestration

### 5.1 Uniform response envelope
Every endpoint — success or failure — returns:
```json
{ "success": true, "data": { ... }, "error": null,
  "meta": { "request_id": "uuid", "timestamp": "...", "pagination": null } }
```
`AppError` is a single enum (`Validation`, `NotFound`, `Upstream`, `Timeout`,
`UnsupportedMediaType`, `Internal`, ...) mapped to the correct HTTP status and
serialized to the same envelope shape. This means the frontend has exactly
**one** parsing code path for every API response, and every upstream Python
service failure (timeout, 5xx, bad JSON) is caught and surfaced as a
structured `UPSTREAM_SERVICE_ERROR` / `TIMEOUT` rather than a raw exception.

### 5.2 `case_id` scoping — the core semantic contract
Nearly every investigation/report endpoint takes a `{case_id}` path segment
with exactly two valid meanings:
- **`case_id = "all"`** → aggregate across every statement currently in the
  database (whole-network view).
- **`case_id = {statement UUID}`** → scope strictly to that one statement's
  transactions — **no leakage** from any other uploaded statement.

The gateway is responsible for translating this into the correct upstream
call: for `"all"` it hits the DB-driven whole-network endpoints
(`/flow/*/all`, `/risk/top`, `/investigation/top-suspicious`); for a UUID it
either forwards to a statement-scoped ML endpoint
(`/flow/analyze/statement/{id}`) or filters its own SQL query by
`WHERE statement_id = $1`.

### 5.3 Background job queue
Upload is `async`: the gateway writes a `statements` row + a `jobs` row,
pushes a `ProcessingJob` onto an in-process `mpsc` channel, and returns
immediately with `{job_id, statement_id, status: "queued"}`. A single
long-running worker task drains the channel and runs the 6-stage pipeline
from §3, updating the `jobs` row after every stage so
`GET /api/v1/jobs/{id}/status` always reflects real progress — this is what
drives the live pipeline visualization on the frontend.

### 5.4 Database schema (Postgres)

| Table | Key columns | Scoped by |
|---|---|---|
| `statements` | id, filename, bank_name, status, account_number, opening/closing_balance, statement dates | — (one row per upload) |
| `transactions` | id, **statement_id FK**, date, sender/receiver_account, amount, debit_credit, narration, balance, is_duplicate/is_failed/is_valid, confidence_score | statement (has FK) |
| `entities` | id, entity_type, **identifier (UNIQUE, global)**, display_name, metadata (aliases) | global — resolved across all statements |
| `risk_profiles` | entity_id FK, rule/stat/temporal/graph/gnn/final score, risk_level, patterns | global |
| `jobs` | id, statement_id FK, status, progress, stage, error | statement |
| `analysis_cache` | (scope, kind) PK, payload JSONB, computed_at | `scope` = "all" or a statement UUID; `kind` = analyze/risk/report |

The single most important structural fact: **`transactions` and
`jobs` are statement-scoped by foreign key; `entities` and `risk_profiles` are
deliberately global** (an identifier like a UPI ID is the same real-world
entity no matter which statement it was seen in). Any feature that needs
"give me only this statement's suspicious accounts" therefore has to derive
that from `transactions.statement_id`, not filter `entities` directly — this
is exactly the root cause behind one of the scoping bugs fixed in this pass.

---

## 6. Two Key Architecture Decisions

### 6.1 Why the graph is stateless (no persistent Neo4j dependency)
Early code paths reference Neo4j (`neo4j_client.py`, `graph_builder.py`,
`entity_graph_builder.py`) — these exist but are **not** on the production
request path. The team's own comment in the code explains why:

> "The previous graph was Neo4j-only and keyed on sender_account/
> receiver_account, which are empty for real single-account bank statements —
> it built almost nothing on the real dataset."

The `MoneyFlowEngine` (§4.5a) was built specifically to solve this: it's
dependency-free, works identically for single-account statements (deriving
counterparties from narration) and multi-account ledgers, and rebuilds from
Postgres on demand. This trades a small amount of recompute cost for
correctness on the actual dataset shape — a deliberate, documented trade-off,
not an oversight.

### 6.2 Why explanations are template-based, not LLM-generated
Every "why is this risky" narrative (`explainability.py`) is deterministic
string templating over already-computed factors/evidence — not an LLM call.
This means: no API key dependency during a live demo, zero latency variance,
100% reproducible output for the same input, and every claim in the narrative
is traceable to a specific numeric factor. The code explicitly notes the
structure is "LLM-augmentable later" — i.e., this is a considered baseline,
with a clear upgrade path if richer prose is wanted.

---

## 7. Resilience Patterns Used Throughout

- **Graceful degradation, never a hard crash:** spaCy NER, sentence-transformer
  fuzzy matching, and the Anomaly/Temporal external signal fetches are all
  wrapped so their *absence* just means a feature quietly opts out (fewer
  signals fused, lower confidence) instead of the whole request failing.
- **Best-effort external calls:** the gateway's `case_summary` and the
  report builder's risk enrichment both use `if let Ok(...)` / `try/except` —
  a Python service being down degrades the payload (missing `top_risks`) but
  never 500s the whole endpoint.
- **Clean-only reads:** every analytical engine reads only
  `is_valid = true AND NOT is_duplicate` transactions, so upstream data-quality
  problems can't silently corrupt downstream risk scores.

---

## 8. What Happens End-to-End for One Uploaded Statement (Worked Example)

1. User drops `hdfc_statement.pdf` → `POST /api/v1/statements/upload` →
   gateway saves the file, inserts `statements` (`status='queued'`) +
   `jobs` row, enqueues, returns `{job_id, statement_id, status:"queued"}`
   immediately.
2. Worker: OCR extracts raw rows (falls back to scanned-PDF OCR if the PDF has
   no text layer, then text-reconstructs page strings into transaction rows).
3. Standardize maps HDFC's column headers to canonical fields with a
   confidence score per column.
4. Validate flags duplicates, reversal pairs, balance mismatches; scores
   confidence 0–1 per row.
5. Transactions persisted to Postgres with `statement_id` FK.
6. Entity service extracts UPI IDs/accounts/merchants from narrations,
   resolves them against the **global** entities table (merging with anything
   seen in prior uploads), persists canonical entities.
7. Graph service is triggered for a whole-network refresh; `analysis_cache`
   is cleared first so the refresh isn't discarded by a stale cache hit.
8. `jobs.status = 'completed'` → frontend polling sees this, fetches the
   validation report + transactions, and unlocks "View Round Trips / Money
   Flow / Money Trails / Generate Report."
9. From here, every investigation page can be viewed at **this specific
   statement's scope** (`case_id = statement_id`) or the **whole network**
   (`case_id = "all"`, combining this statement with every other upload).

---

## 9. Recent Correctness & Robustness Fixes

This backend was audited and hardened for exactly the class of bug that
matters most in a multi-tenant/multi-statement investigation tool: **scope
leakage and stale aggregates.**

- **Whole-network cache invalidation:** the `analysis_cache` table is now
  cleared on every completed ingestion, so a 2nd/3rd uploaded statement is
  guaranteed to be reflected in "Whole Network" views and reports instead of
  silently serving a cached result from the first upload.
- **Per-statement scoping for Top Suspicious / Top Risks / Case Summary:**
  these previously ignored the selected statement and always queried the
  whole network. The gateway now branches on `case_id`, and the Graph service
  exposes statement-scoped variants (`/risk/top/statement/{id}`,
  `/investigation/top-suspicious/statement/{id}`) that load only that
  statement's clean transactions before scoring — so selecting Statement A
  never shows risk signals derived from Statement B.
- **Statement delete / full workspace reset:** added cascade-safe deletion
  (transactions → jobs → orphaned entities → risk_profiles → statement, all
  in one DB transaction, plus stored-file cleanup and cache invalidation) and
  a full-clear endpoint — both were previously frontend-only stubs with no
  backend route.
- **Round-trip edge amounts surfaced to the UI:** the cycle detector always
  computed `edge_amounts` per hop; the frontend graph now renders them as
  labeled, tooltip-annotated edges instead of only showing the aggregate loop
  total.

---

## 10. Frequently Asked Technical Questions & Architecture Deep-Dive

**Q: How do you handle a bank statement format you've never seen before?**
A: The standardize service doesn't hardcode bank templates — it scores every
column header against canonical field heuristics and returns a confidence per
mapping. An unfamiliar bank still gets mapped (often correctly), and the
confidence score tells you immediately if a column was ambiguous, rather than
silently failing.

**Q: What happens if one of the eight microservices crashes mid-demo?**
A: Ingestion-critical services (OCR/Standardize/Validation/Entity) are on the
synchronous pipeline path, so a crash there fails that one upload with a clear
error message — nothing else breaks. Enrichment services (Anomaly, Temporal)
are optional signal providers to risk fusion; if they're unreachable, their
weight is proportionally redistributed to the signals that are available, and
the response still returns — just with one fewer corroborating signal instead
of failing.

**Q: Why not use a real graph database (Neo4j) for the money-flow graph?**
A: We tried; keying strictly on sender/receiver account breaks on real
single-account bank statements, which have no explicit receiver column at all
— we'd need to derive it from narration either way. So we built a
dependency-free in-memory engine that does that derivation and rebuilds from
Postgres per request. It's simpler to reason about, has no extra
infrastructure to keep alive during a demo, and works on the actual dataset
shape, not just idealized multi-party ledgers.

**Q: How is a risk score not a black box?**
A: Every risk score is the weighted sum of named, individually-normalized
signals (round-trip membership, layering ratio, accumulation, fan-in/out,
anomaly, temporal, failed-ratio, centrality). The API returns every
contributing `factor` with its weight, raw value, dollar-figure evidence, and
a plain-English explanation — nothing is scored without a traceable reason.

**Q: How do you avoid double-counting the same person/account across
multiple uploaded statements?**
A: Entities resolve on **exact normalized identity** for identifier types
(UPI ID lowercased, phone/account digits-only, IFSC uppercased) — this is
deliberately not fuzzy, so a UPI ID appearing in statement #1 and statement #3
merges into exactly one canonical entity with an occurrence count of 2, not
two separate entities.

**Q: What's the FIFO money-trail actually proving?**
A: It directly implements the "trace where a specific credit was spent"
requirement — money in creates a lot; each subsequent debit drains the oldest
open lot first, and we record the destination of every draining debit. So for
any credited transaction, you get an ordered, auditable list of exactly which
downstream transfers consumed it (and how much of it is still unspent) — the
literal definition of following the money.

**Q: How do you detect structuring (smurfing)?**
A: We flag accounts making ≥3 transactions in the ₹45,000–50,000 band — just
under the common ₹50,000 reporting/scrutiny threshold — a textbook AML
structuring signature, fused into that account's temporal score.

**Q: Is any of this LLM-generated or dependent on an external API at
runtime?**
A: No — all detection (graph, risk fusion, anomaly, temporal, FIFO trail,
validation) is deterministic statistics/graph-theory/rule-based logic that
runs entirely locally. Explanations are templated from real computed
evidence. This means the whole system runs offline, with zero external API
latency or cost, and is fully reproducible for scoring/audit purposes.

**Q: How does the "Whole Network" vs "single statement" toggle actually
work end-to-end?**
A: `case_id` is the single scoping parameter threaded through the entire
stack. `"all"` triggers Postgres queries/graph builds with no `statement_id`
filter (and a persisted cache, invalidated on every new upload); a statement
UUID filters every query — SQL `WHERE statement_id = ?` on the Rust side, or a
`load_statement_transactions(id)` call on the Python side — so the two modes
share the same code paths and detection logic, just with a different input
row-set.

---

## 11. Quick Reference — All Endpoints (via the gateway, port 8080)

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/v1/statements/upload` | Upload a statement (multipart), enqueue processing |
| GET | `/api/v1/jobs/{job_id}/status` | Poll ingestion pipeline progress |
| GET | `/api/v1/statements` | List uploaded statements (paginated) |
| GET | `/api/v1/statements/{id}` | Statement metadata |
| DELETE | `/api/v1/statements/{id}` | Cascade-delete a statement + its data |
| POST | `/api/v1/database/clear` | Wipe the whole workspace |
| GET | `/api/v1/statements/{id}/transactions` | Standardized transactions (paginated) |
| GET | `/api/v1/statements/{id}/validation-report` | Duplicates / failures / confidence summary |
| GET | `/api/v1/entities` / `/{id}` / `/{id}/aliases` | Canonical entity directory |
| GET | `/api/v1/entities/{id}/risk-profile` / `/explanation` | Fused risk + explainability for one entity |
| GET | `/api/v1/investigations/{case_id}/round-trips` | Circular chains (scoped or whole-network) |
| GET | `/api/v1/investigations/{case_id}/money-flow` | Graph nodes + edges + summary |
| GET | `/api/v1/investigations/{case_id}/graph/clusters` | Weakly-connected communities |
| GET | `/api/v1/investigations/{case_id}/money-trail/{txn_id}` | FIFO trail for one credit |
| GET | `/api/v1/investigations/{case_id}/timeline?account=` | Chronological account activity |
| GET | `/api/v1/investigations/{case_id}/top-suspicious-accounts` | Ranked suspicious accounts |
| GET | `/api/v1/investigations/{case_id}/top-risks` | Top fused risk scores |
| GET | `/api/v1/investigations/{case_id}/counterparties?account=` | Sent-to / received-from breakdown |
| GET | `/api/v1/cases/{case_id}/summary` | Dashboard KPI payload |
| GET | `/api/v1/reports/{case_id}/json\|pdf\|excel\|docx` | Full investigation brief, 4 formats |
| GET | `/openapi.json`, `/docs` | Machine-readable spec + Swagger UI |

`{case_id}` is always either the literal string `all` or a statement UUID.

---

*Document generated from a full read of `backend/src/**`,
`ml-services/**/main.py` and every referenced service module as of the current
`final-product` branch state.*
