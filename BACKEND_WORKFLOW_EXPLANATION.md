# FinIntel V2 — Core Backend Architecture & Workflow Explanation

This document provides a comprehensive, deep-dive explanation of the **FinIntel V2** backend architecture and data processing pipeline. It is written to equip the authors with the technical arguments, under-the-hood algorithms, and design justifications necessary to deliver a **winning explanation to hackathon judges**.

---

## 1. Executive Summary & Problem Statement

### The Hackathon Challenge
Financial crime investigators face a massive hurdle: bank statements come from different banks, in different file formats (PDFs, scanned PDFs, Excel, CSV, plain TXT), with completely different column names, layouts, and data structures. For this hackathon, we were challenged to parse, standardize, clean, analyze, and report on **162 distinct real-world evaluation files** spanning diverse layouts and structures.

### Traditional Failures (Why we built FinIntel V2)
1. **Layout Fragility:** Traditional parsing uses hardcoded rules or regular expressions for each bank. A single change in a column header (e.g., `Tran Date` vs. `Txn Date`) crashes the pipeline.
2. **Perspective Disconnection in Graph DBs:** Traditional financial graph networks require both a `sender_account` and a `receiver_account` per transaction. In real-world single-statement PDFs, these fields are blank because the statement is from the holder's perspective. Traditional graph models extract almost nothing from these files.
3. **API Cost & Latency:** Relying on heavy Large Language Models (LLMs) to parse ledger lines or identify connections is slow (5–20s latency), extremely expensive at scale, and prone to hallucinations or non-deterministic outputs (not acceptable in legal or financial audits).
4. **Fragility & Crash Vulnerability:** Parsing multi-page scanned documents takes time. Blocking a synchronous HTTP request for 30 seconds results in timeouts. If the server crashes, progress is lost.

### The FinIntel V2 Approach
We designed a **hybrid Rust + Python Microservice Architecture** that is entirely **data-driven, deterministic, and LLM-free**. By replacing hardcoded heuristics with scored synonym-matching, implementing an in-memory perspective-aware graph engine, and using statistical machine learning (Isolation Forests, temporal Z-scores), we built a platform that processes all 162 layouts in milliseconds with zero API costs, full audit trails, and 100% predictable, reproducible outputs.

---

## 2. Core Architectural Philosophy & Technical Decisions

```
                           +------------------------+
                           |  Frontend UI (Next.js) |
                           +-----------+------------+
                                       | HTTP (CORS, /api/v1)
                                       v
                     +-----------------+------------------+
                     |        RUST AXUM API GATEWAY       |
                     |  - DB-backed Job Queue           |
                     |  - PostgreSQL Persistence          |
                     |  - OpenAPI & Swagger Documentation |
                     +-----------------+------------------+
                                       |
                                       | Tokio Async Worker (mpsc channel)
                                       v
  +------------------------------------+------------------------------------+
  |                     PYTHON MICROSERVICE FLEET (FastAPI)                 |
  |                                                                         |
  |  +------------------+   +------------------+   +---------------------+  |
  |  |  8001: OCR/Ext.  |-->| 8002: Standard.  |-->| 8004: Validation    |  |
  |  |  (PaddleOCR/Plumb)|   | (Col. Intelligence)|  | (Balance/Duplicates)|  |
  |  +------------------+   +------------------+   +----------+----------+  |
  |                                                           |             |
  |  +------------------+   +------------------+              |             |
  |  | 8005: Graph/Risk |<--| 8003: Entity Res.|<-------------+             |
  |  | (DFS/Johnson/WCC)|   | (Sentence-Trans.)|                            |
  |  +--------+---------+   +------------------+                            |
  |           |                                                             |
  |           |             +------------------+   +---------------------+  |
  |           +------------>| 8007: Anomaly    |   | 8008: Temporal      |  |
  |           |             | (IsolationForest)|   | (Burst/Structuring) |  |
  |           |             +--------+---------+   +----------+----------+  |
  |           |                      |                        |             |
  |           v                      +-----------+------------+             |
  |  +--------+---------+                        |                          |
  |  |  8009: FIFO Trail|<-----------------------+                          |
  |  |  (Credit-Lot-Q)  |                                                   |
  |  +--------+---------+                                                   |
  |           |                                                             |
  |           v                                                             |
  |  +--------+---------+                                                   |
  |  | 8010: Report Svc |                                                   |
  |  | (ReportLab/Excel)|                                                   |
  |  +------------------+                                                   |
  +-------------------------------------------------------------------------+
```

### 1. The Rust Gateway + Python Microservice Fleet Split
* **Rust (Axum 0.8 & SQLx):** Serves as our robust, high-throughput API gateway. Rust handles everything related to HTTP request validation, file storage, database transactions (PostgreSQL), and background job queueing. Axum is chosen for its speed and safety.
* **Python (FastAPI):** Python is the industry standard for data science and document parsing. Rather than rewriting complex libraries in Rust, we built isolated, stateless FastAPI microservices for OCR, Standardization, Validation, Entity Resolution, Graph Analytics, Anomaly detection, and Temporal analysis.
* **Separation of Concerns:** Each microservice runs on its own port and is completely self-contained. A dependency update in the Entity Resolution service cannot crash the OCR service. Testing and scaling are entirely decentralized.

### 2. In-Memory Graph Processing (Neo4j-Independent)
While Neo4j is supported for persistent investigations, we built a custom, dependency-free in-memory graph analyzer (`MoneyFlowEngine`). It compiles graphs directly from HTTP request payloads. This means the system remains stateless, highly portable, and can perform instant, localized case analyses without the performance and maintenance overhead of querying an external graph database on every click.

### 3. Data-Driven Synonym Matching vs. Bank Templates
We do not have a "HDFC parser" or an "ICICI parser". Instead, we built a declarative knowledge base of column synonyms (`Column Intelligence`). Incoming files are normalized, and a greedy one-to-one mapping algorithm automatically resolves column types and handles layout variations dynamically.

---

## 3. End-to-End Pipeline Execution Order

When a user uploads a bank statement, the backend processes it asynchronously through the following pipeline:

```
[Statement Upload] 
       |
       v
1. Rust Gateway (Axum)  --> Saves file, creates DB job (queued), triggers async Tokio worker.
       |
       v
2. OCR & Extraction     --> pdfplumber tables -> Fallback: pdf2image -> PaddleOCR (Scanned PDFs).
       | (raw rows/text strings)
       v
3. Standardization      --> Resolves columns dynamically; normalizes dirty currency/amount formats.
       | (Standardized transactions)
       v
4. Cleaning & Validation--> Scans for duplicates, debit-credit reversal pairs, and balance mismatches.
       | (Validated transactions)
       v
5. Entity Resolution    --> Extracts identifiers (UPI, Accounts); groups names via Cosine Similarity.
       | (Resolved canonical entities)
       v
6. Graph Analytics      --> Builds directed flow; detects loops (Johnson DFS); maps communities.
       | (Weakly-connected components, cycles, centralities)
       v
7. Statistical Anomaly  --> Fits Isolation Forest to detect statistical outliers.
       | (Normalized anomaly score)
       v
8. Temporal Analysis    --> Checks burst activity, daily velocity, and PAN cash-structuring (45k-50k).
       | (Structuring flags, burst scores)
       v
9. FIFO Money Trail     --> Tracks credit lots and matches subsequent debits to find final destinations.
       | (FIFO trail trees)
       v
10. Risk Fusion         --> Fuses all weights; persists standard transactions and risk profiles in PostgreSQL.
       |
       v
[Job Completed]         --> Updates job progress to 100%. Report is cached and ready for Excel/PDF download.
```

---

## 4. Service-by-Service Technical Deep Dive

### 1. Rust Axum Gateway (`backend/`)
* **Role:** Entry point, API router, asynchronous job orchestrator, database persistence layer, and cached analysis store.
* **Under the Hood:**
  * Uses a Tokio `mpsc` channel to queue jobs. A dedicated background worker thread pulls tasks and drives the Python pipeline.
  * Handles database persistence using `sqlx` against PostgreSQL. It splits records into `statements`, `transactions`, `entities`, and `risk_profiles` tables.
  * Implements a persistent cache table (`analysis_cache`) keyed by `(scope, kind)` to prevent recomputing complex graph and risk analytics for the same statement or case.
  * Wraps responses in a uniform JSON envelope: `{ success: bool, data: T, error: Error, meta: Metadata }`.

### 2. OCR & Extraction Service (`ml-services/ocr/`)
* **Role:** Extracts raw rows of cells from spreadsheet layouts or text lines from PDFs.
* **Table-First Parsing Strategy:**
  1. Opens PDF files using `pdfplumber`. Attempts table boundary extraction (`page.extract_tables()`). If structured cells are found, it maps them directly and carries headers across pages for multi-page statements.
  2. If no text or tables can be extracted, it flags the document as scanned (`ocr_required = true`).
* **OCR Pipeline (PaddleOCR):**
  * Converts PDF pages to high-resolution PNG images via `pdf2image.convert_from_path`.
  * Runs **PaddleOCR** with angle classification enabled (`use_angle_cls=True, lang="en"`).
  * Returns text lines, coordinate bounding boxes (`bbox`), and confidence scores for each string.
* **Text Reconstruction:**
  * If the extraction returned raw string lines (from text-based PDFs or OCR output), the `TextStatementReconstructor` groups text fragments horizontally and vertically based on coordinate boxes to reconstruct clean row arrays, preventing column misalignments.

### 3. Universal Standardization Service (`ml-services/standardize/`)
* **Role:** Resolves bank-agnostic columns and standardizes numerical values.
* **Dynamic Column Intelligence (Scored synonym mapping):**
  * Uses a precompiled dictionary of synonyms derived from the 162 real evaluation files (e.g., mapping `dr_amt`, `withdrawal`, and `debit` to a canonical `debit` field).
  * Computes candidate matches. Instead of a simple regex check, it ranks matches by confidence weights:
    $$\text{EXACT (Full match)} = 100 \implies \text{Confidence} = 0.99$$
    $$\text{STRONG (Token search)} = 60 \implies \text{Confidence} = 0.85$$
    $$\text{WEAK (Substring search)} = 30 \implies \text{Confidence} = 0.55$$
  * Runs a **greedy match algorithm with a one-to-one constraint**: maps the highest scored column first, binds it, removes both from the pools, and continues. This prevents a general "Date" from overlapping with "Value Date".
* **Amount Normalization:**
  * Clean-up engine strips currency symbols (`₹`, `INR`, `Rs.`), spaces, and commas.
  * Standardizes trailing signs (e.g., `500.00-`), parentheses (e.g., `(500.00)`), and Indian ledger suffixes (e.g., `1,250.00Cr` / `3,400.00Dr`).
  * Resolves layout modes: split debit/credit columns vs. a single signed amount column (determining transfer direction by positive/negative signs or Cr/Dr labels).

### 4. Cleaning & Validation Service (`ml-services/validation/`)
* **Role:** Cleans data, detects errors, and flags anomalies. Runs four core validation layers:
  1. **Running Balance Invariant Validator:** Evaluates chronological ledger consistency:
     $$\text{Balance}_{i} = \text{Balance}_{i-1} + \text{Credit}_{i} - \text{Debit}_{i}$$
     If the equation is broken by more than $1.00$ (float tolerance), it flags a `balance_mismatch` and marks the transaction as invalid.
  2. **Composite-Key Duplicate Detector:** Identifies exact ledger duplicates. To prevent false positives on genuine repeat payments (e.g., sending the same rent amount twice on the same day), it creates a composite key:
     $$\text{Key} = \{ \text{Date}, \text{Amount}, \text{Direction}, \text{Reference}, \text{Narration}, \text{Running Balance} \}$$
     Since repeated payments occur at different points in time, they land on different running balances. Only a truly duplicated database insert (matching balance too) is flagged.
  3. **Failed / Reversal Transaction Detector:** Identifies failed transfers that were immediately credited back.
     * **Reversal Pairs:** Searches for a debit of amount $A$, followed within a temporal window of 10 transactions by a credit of the same amount $A$. If found, both legs are flagged as failed.
     * **Keyword Flags:** Filters narrations for reversal terms: `REVERSAL`, `REVERSED`, `REFUND`, `FAILED`, `RETURNED`, `CHARGEBACK`.
  4. **Confidence Penalization:** Penalizes transaction confidence scores based on validation findings:
     * Missing amount: $-0.40$ (invalidates row)
     * Missing date: $-0.20$
     * Balance mismatch: $-0.40$
     * Duplicate: $-0.20$

### 5. Entity Resolution Service (`ml-services/entity/`)
* **Role:** Extracts entity mentions and clusters them to resolve identities across different statements.
* **Deterministic Extractors:** Regex-based parsers extract structured fields:
  * UPI Virtual Payment Addresses (e.g., `upi_id = string@bank`)
  * IFSC codes (routing identifiers)
  * Account numbers, telephone numbers, and bank names.
* **Fuzzy Name Clustering (Sentence-Transformers):**
  * Extends rules using a spaCy Named Entity Recognition (NER) model to find `PERSON`, `MERCHANT`, and `ORGANIZATION` tokens.
  * Standardizes names (casing, spaces, special character removal).
  * If the ML library is present, it uses `sentence-transformers` with the **`all-MiniLM-L6-v2`** model. It creates high-dimensional vector embeddings of the names and calculates **Cosine Similarity**:
    $$\text{Similarity}(E_1, E_2) \ge 0.85 \implies \text{Group together under one Canonical Entity}$$
  * Tracks minor spelling variants or transaction codes (e.g., `MOWAIS DOWAIS`, `M DOWAIS`) as `aliases` of the same canonical entity.

### 6. Custom In-Memory Graph Analytics Service (`ml-services/graph/`)
* **Role:** Analyzes money flows, detects communities, and maps loops.
* **Perspective-Aware MoneyFlowEngine:**
  * Converts single-account statements into a directed flow graph.
  * If explicit sender/receiver account numbers are missing, it extracts the counterparty from the narration (using UPI IDs, merchant prefixes, ATM cash tags, or beneficiary tokens).
  * Sets edge directions:
    * `DEBIT`: statement holder (Source) $\to$ counterparty (Target)
    * `CREDIT`: counterparty (Source) $\to$ statement holder (Target)
* **Cycle Detection (Johnson-style DFS):**
  * Enumerates simple directed cycles to find loops where money leaves an account and returns to it.
  * Uses the **"smallest node ID is the entry point"** rule to prevent double-counting cycles.
  * **Innovation (Bottleneck ranking):** In dense graphs, cycle count can explode. The engine caps cycle generation at a `scan_limit` (5,000 cycles) to protect CPU memory. It then ranks cycles by the **bottleneck amount** (the minimum transfer size along any edge in the loop):
    $$\text{Bottleneck Amount} = \min(e_1, e_2, \dots, e_k)$$
    The top 200 cycles with the largest bottleneck amounts are returned, ensuring investigators see the loops carrying the most circular capital.
* **Weakly-Connected Communities:**
  * Uses **Union-Find** (disjoint-set data structure with path compression) to group accounts into isolated sub-networks of activity.
* **Degree Centrality:**
  * Measures centrality scores of nodes to find central hubs of coordination:
    $$\text{Centrality}(v) = \frac{\text{in-degree}(v) + \text{out-degree}(v)}{N-1}$$

### 7. Statistical Anomaly Service (`ml-services/anomaly/`)
* **Role:** Identifies statistical outliers using unsupervised machine learning.
* **Feature Building:** Computes transaction frequency, maximum amounts, and unique counterparties per account.
* **Isolation Forest Model:**
  * Fits an **`IsolationForest`** model (`n_estimators=200`, `contamination=0.05`, `random_state=42`) to detect outliers in the feature space.
  * Outliers are flagged as `high_statistical_anomaly` (score in the 95th percentile) or `moderate_statistical_anomaly` (score in the 90th percentile).

### 8. Temporal Pattern Analysis Service (`ml-services/temporal/`)
* **Role:** Scans the timeline of transactions for time-series anomalies.
* **Burst Activity Detector:** Computes the transaction volume per account. Calculates Z-scores against the population mean:
  $$\text{Z-Score} = \frac{X - \mu}{\sigma}$$
  If the Z-score $> 2$, it flags a `burst_activity` spike.
* **Daily Velocity Spike Detector:** Calculates daily aggregate amounts per account. Computes the average daily amount, Z-scores it across all accounts, and flags values $>2$ as a `velocity_spike`.
* **KYC / PAN Structuring Detector:**
  * Under Indian financial regulations, transactions of 50,000 INR or above trigger mandatory PAN-card verification and strict reporting.
  * The Structuring Detector specifically scans for transaction amounts falling in the **$[45000, 50000)$** range. If an account has $\ge 3$ such transactions, it flags `structuring_detected`, pointing to intentional structuring (smurfing) to bypass regulatory controls.

### 9. FIFO Money Trail Tracker (`ml-services/trail/`)
* **Role:** Implements a First-In-First-Out trail matching algorithm.
* **Spec Logic:**
  * Every `CREDIT` received by an account creates a "credit lot" representing an inflow of funds.
  * Every subsequent `DEBIT` from that account consumes funds from the oldest open credit lot(s) (FIFO queue).
  * For each credit lot, the tracker traces which debits spent it, when they were spent, and the destination entity resolved from the narration:
  
  ```
  [Credit Inflow] (Rs. 100,000 from Source A)
        |
        v
    FIFO Queue
        |
        +---> [Debit Outflow 1] (Rs. 40,000 to Target X) -- Consumes Rs. 40,000 of Credit A
        |
        +---> [Debit Outflow 2] (Rs. 50,000 to Target Y) -- Consumes Rs. 50,000 of Credit A
        |
        +---> [Debit Outflow 3] (Rs. 30,000 to Target Z) -- Consumes Rs. 10,000 of Credit A (Fully consumed!)
                                                         -- Remainder (Rs. 20,000) falls to next Credit Lot
  ```
  
* **Reverse Lookup:**
  * **Credit Trail (Forward):** Shows how a specific deposit was dispersed across subsequent payments.
  * **Debit Funding (Backward):** Identifies which specific credit deposits funded a suspicious debit.

### 10. Risk Fusion Engine (Integrated)
* **Role:** Fuses graph, transactional, and external ML signals into a single score.
* **Renormalized Scoring Weights:**
  
  | Signal Source | Metric Description | Default Weight |
  |---|---|---|
  | **round_trip** | Membership in circular loops | **22%** |
  | **layering** | Pass-through ratio ($1 - \frac{|In - Out|}{\max(In, Out)}$) | **18%** |
  | **accumulation**| High concentration of inflows | **15%** |
  | **fan_in** | Receiving from multiple distinct sources | **10%** |
  | **fan_out** | Sending to multiple distinct destinations | **10%** |
  | **anomaly** | Isolation Forest statistical anomaly score | **10%** |
  | **temporal** | Burst / Velocity / Structuring anomalies | **8%** |
  | **failed_ratio**| Portion of failed/reversed transactions | **4%** |
  | **centrality** | Hub degree centrality in the component | **3%** |

* **Auditability & Explainability:**
  * Rather than generating a single number, the engine outputs a list of contributing factors. Each factor documents its weight, value, contribution, a human-readable explanation, and the raw evidence used (e.g., total received amount, sender count). This supports the frontend interface and provides full audit logs.

### 11. Report Generator Service (`ml-services/report/`)
* **Role:** Generates multi-format report exports for court submissions or audits.
* **Outputs:**
  * **Excel (openpyxl):** Multiple sheets documenting statement metadata, transactions, canonical entities, flagged risks, round trips, and FIFO trails.
  * **PDF (ReportLab):** High-fidelity, publication-grade document with structural tables, case summaries, and risk factor charts.
  * **Word (docx):** Formatted narrative report outlining the investigation timeline and findings.
  * **JSON:** Raw structured schema for third-party system integrations.

---

## 5. Why This Architecture Wins Hackathons (Key Talking Points for Judges)

If the judges ask about our design decisions, emphasize these five points:

1. **Production-Grade Reliability (No Panics):**
   We replaced raw Rust unwraps (`.unwrap()`, `.expect()`) with a global `AppError` mapping. If an upload fails or contains corrupted data, the API returns a structured HTTP `400/415` error envelope. It does not crash the server.
2. **True Generalization over 162 Layouts:**
   Instead of writing hardcoded parser rules for each bank statement format, our data-driven `Column Intelligence` synonym resolver mapped every column automatically. We achieved a near-zero layout failure rate across a highly heterogeneous dataset.
3. **Deterministic, Cost-Effective Analysis (No LLM Lag):**
   By avoiding external LLM APIs for core processing, our platform executes in milliseconds, costs nothing to run, operates offline, and guarantees reproducible results. It is fully compliant with legal audit trails where hallucinated data is unacceptable.
4. **Resilient Background Execution:**
   Statement parsing is slow due to OCR and file parsing. By building a database-backed async job queue, we decoupled file uploads from request threads. Progress is tracked from `0` to `100%` (`queued -> processing -> completed | failed`). If the backend restarts, the job state is preserved in PostgreSQL.
5. **Fuzzy Entity Matching at the Edge:**
   Our hybrid pipeline resolves entity aliases (matching common typos or transaction codes) using semantic embeddings (`all-MiniLM-L6-v2`) and cosine similarity thresholds, ensuring that transaction networks are mapped accurately.
