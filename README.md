<p align="center">
  <img src="docs/assets/finintel-banner.png" alt="FinIntel — Turning Financial Evidence into Intelligence" width="100%" />
</p>

# FinIntel — AI-Powered Financial Crime Investigation Platform

**Turn raw bank statements into investigator-ready intelligence — money-flow graphs, round-trip/mule detection, FIFO money-trail tracing, cash/ATM location leads, risk scoring, and one-click investigation reports.**

Built for law-enforcement & bank fraud-investigation teams. Designed so a non-technical officer can go from *"here's a stack of statements"* to *"here's who to arrest and where"* in minutes.

<p align="center">
  <a href="https://www.rust-lang.org/"><img src="https://img.shields.io/badge/Rust-DEA584?style=for-the-badge&logo=rust&logoColor=black" alt="Rust" /></a>
  <a href="https://www.python.org/"><img src="https://img.shields.io/badge/Python-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python" /></a>
  <a href="https://react.dev/"><img src="https://img.shields.io/badge/React-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React" /></a>
  <a href="https://fastapi.tiangolo.com/"><img src="https://img.shields.io/badge/FastAPI-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI" /></a>
  <a href="https://www.postgresql.org/"><img src="https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL" /></a>
  <a href="https://neo4j.com/"><img src="https://img.shields.io/badge/Neo4j-008CC1?style=for-the-badge&logo=neo4j&logoColor=white" alt="Neo4j" /></a>
  <a href="https://www.docker.com/"><img src="https://img.shields.io/badge/Docker-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker" /></a>
  <a href="https://vitejs.dev/"><img src="https://img.shields.io/badge/Vite-646CFF?style=for-the-badge&logo=vite&logoColor=white" alt="Vite" /></a>
</p>


---

## Table of Contents

1. [Overview](#overview)
2. [Key Features](#key-features)
3. [Architecture](#architecture)
4. [Tech Stack](#tech-stack)
5. [Repository Structure](#repository-structure)
6. [Prerequisites](#prerequisites)
7. [Setup & Installation](#setup--installation)
8. [Running the Project](#running-the-project)
9. [Docker Setup & Execution](#docker-setup--execution)
10. [Environment Variables Reference](#environment-variables-reference)
11. [API Access](#api-access)
12. [Testing](#testing)
13. [Troubleshooting](#troubleshooting)

---

## Overview

**FinIntel** ingests scanned/PDF/CSV/Excel bank statements — including messy, unstructured, real-world formats — and turns them into a full financial-crime investigation workspace:

- **OCR & parsing** of scanned/tabular/delimited statements into a clean, canonical transaction model.
- **Entity resolution** across accounts, UPI IDs, and counterparties.
- **Money-flow graph** analysis — who paid whom, accumulation points, layering chains, source accounts.
- **Round-trip / circular-flow detection** — classic layering & mule-account patterns.
- **Rapid pass-through detection** — accounts where money lands and leaves within minutes (mule/gaming-fraud signature).
- **FIFO money-trail tracing** — for any credit, trace exactly which debits spent it, in order, down to the rupee — including genuinely un-traceable ("untracked funds") remainders.
- **Cash/ATM location extraction** — deterministic parsing of ATM/cash narrations into city/state + time, so an officer knows *where to go*.
- **Payment-channel segregation** — transactions auto-classified into UPI / PhonePe / GPay / Paytm / IMPS / NEFT / RTGS / ATM-Cash / Cheque / Card-POS, filterable everywhere.
- **Explainable risk scoring** — a multi-signal fusion engine (round-trips, layering, fan-in/out, anomaly, temporal, pass-through, centrality) with plain-language "why flagged" evidence and investigator-friendly tags/badges.
- **Real-time alerts** — a nav bell + toast + panel surfaces HIGH/CRITICAL findings the moment a statement finishes processing.
- **Downloadable investigation reports** — PDF, Excel, and Word (DOCX) — both a consolidated case report and dedicated per-service reports (Round Trips, Money Flow, Money Trail bank-ledger format), scoped to a single statement or the whole network, plus one-click email delivery.

The product is built to be **visual-first**: badges over raw numbers, colour-coded severity, and graphs/timelines that a non-technical investigating officer can read at a glance — not a data-science dashboard.

## Key Features

| Category | What it does |
|---|---|
| **Ingestion** | Upload PDF/scanned/CSV/Excel statements → OCR → standardize → validate, with duplicate/failed-transaction detection and a confidence score per row |
| **Money-Flow Graph** | Interactive, pannable/zoomable graph of the transaction network with node identity (holder, bank, IFSC), activity windows, channel-coloured edges, and an enlarge/full-screen mode |
| **Round-Trip Detection** | Finds circular money chains (A → B → C → A) with per-hop amounts and bottleneck/total value |
| **Rapid Pass-Through** | Flags accounts where inbound funds are drained out almost immediately (velocity gauge) |
| **Money Trail (FIFO)** | Every credit traced FIFO to the debits that spent it, with per-debit destination, channel, cash location, and correct "untracked" remainder math for multi-credit-split debits |
| **Cash/ATM Location Mapping** | Deterministic parser (no LLM — instant, offline, reproducible) extracts city/state/time from ATM & cash narrations |
| **Malicious-Activity Tags** | Plain-language badges (Circular Flow, Rapid Pass-Through, Accumulation, Layering, Collector, Distributor, Anomaly…) instead of raw scores |
| **Alerts** | Balanced-sensitivity alerting (HIGH/CRITICAL accounts + any round-trip/pass-through) via bell, toast, and panel |
| **Reports** | Combined case report *and* per-service reports (Round Trips / Money Flow / Money Trail), each in PDF, Excel, and DOCX, scoped to one statement or the whole network, plus email delivery |
| **Whole-Network View** | Aggregate analysis across every uploaded statement, with a "representative" risk-ranking algorithm so smaller statements aren't buried by larger ones |

## Architecture

```
                                   ┌──────────────────────────┐
                                   │   React / TypeScript /   │
                                   │   Vite frontend  (3000)  │
                                   └─────────────┬─────────────┘
                                                 │ REST (JSON)
                                                 ▼
                                   ┌──────────────────────────┐
                                   │   Rust · Axum API Gateway │
                                   │        (port 8080)        │
                                   │  · single entry point     │
                                   │  · uniform response       │
                                   │    envelope                │
                                   │  · sqlx Postgres pool      │
                                   │  · background ingestion    │
                                   │    worker + job queue      │
                                   │  · alerts engine            │
                                   └──────┬───────────┬─────────┘
                                          │           │
                         ┌────────────────┘           └───────────────┐
                         ▼                                            ▼
        ┌────────────────────────────────┐            ┌───────────────────────────┐
        │   PostgreSQL 16 (finintel DB)   │            │  8 × Python FastAPI ML     │
        │  statements · transactions ·    │◀──────────▶│  microservices (stateless)│
        │  entities · risk_profiles ·     │            └───────────────────────────┘
        │  jobs · analysis_cache · alerts │
        └──────────────────────────────────┘

   ML microservice pipeline (each independently callable by the gateway only):

   OCR (8001) → Standardize (8002) → Entity (8003) → Validation (8004)
        → Graph (8005)  → Anomaly (8007) → Temporal (8008) → Trail (8009) → Report (8010)
```

- **Gateway (Rust/Axum)** is the *only* thing the frontend talks to. It owns Postgres, the upload/ingestion job queue, the alert pipeline, and proxies analysis requests to the right ML microservice.
- **ML microservices (Python/FastAPI)** are stateless — each rebuilds whatever it needs from Postgres per request. The Graph service memoizes expensive whole-network computations in an `analysis_cache` table, invalidated automatically on every new upload.
- **`case_id` scoping**: `"all"` = whole-network aggregate across every statement; a statement UUID = strictly isolated single-statement view. Both are supported end-to-end (analysis, graphs, reports).

## Tech Stack

| Layer | Technology |
|---|---|
| API Gateway | Rust, Axum 0.8, Tokio, sqlx (Postgres), reqwest, Swagger/OpenAPI |
| ML Microservices | Python 3.11, FastAPI, Uvicorn, pandas, scikit-learn, PaddleOCR, reportlab, openpyxl, python-docx |
| Database | PostgreSQL 16 |
| Frontend | React 19, TypeScript, Vite 6, Tailwind CSS 4, lucide-react, Express (dev/preview server) |
| Infra (optional) | Docker / Docker Compose |

## Repository Structure

```
Bank_Hackathon/
├── backend/                # Rust Axum API gateway
│   ├── src/                #   handlers, routes, repositories, services, models
│   ├── migrations/         #   sqlx SQL migrations (run automatically on startup)
│   └── Cargo.toml
├── ml-services/            # 8 independent Python FastAPI microservices
│   ├── ocr/                 (8001) statement OCR & parsing
│   ├── standardize/         (8002) column intelligence → canonical model
│   ├── entity/               (8003) entity resolution
│   ├── validation/          (8004) duplicate/failed/confidence checks
│   ├── graph/                (8005) money-flow graph, risk fusion, round-trips, tags
│   ├── anomaly/              (8007) statistical/ML anomaly detection
│   ├── temporal/             (8008) time-based velocity/burst analysis
│   ├── trail/                 (8009) FIFO money-trail tracing
│   ├── report/                (8010) PDF/Excel/DOCX report generation + email
│   └── shared/                common base-service utilities
├── frontend/                # React + TypeScript + Vite SPA
│   ├── src/                  components, services (API client), types
│   └── server.ts             Express dev/preview server
├── scripts/
│   ├── start-all.ps1         launch the full stack (Windows)
│   ├── start-all.sh          launch the full stack (Linux/macOS/Git-Bash)
│   └── init_postgres.sql     legacy manual schema reference (migrations are authoritative)
├── docker-compose.yml       # containerized PostgreSQL (+ optional legacy Neo4j)
├── environment.yml          # exported conda environment (Windows/CUDA build)
└── requirements-working.txt # pip freeze of the working Python environment
```

## Prerequisites

Install these before you start:

| Tool | Version | Notes |
|---|---|---|
| **Rust & Cargo** | 1.75+ | via [rustup](https://rustup.rs/) |
| **Python** | 3.11 | a **conda** environment named `finintel` is strongly recommended (matches `environment.yml`) — the ML services use PaddleOCR/scikit-learn/pandas |
| **Node.js & npm** | 18+ | for the frontend |
| **PostgreSQL** | 16 | run natively **or** via the provided Docker Compose file |
| **Docker & Docker Compose** | latest | optional — only needed if you want Postgres containerized instead of a native install |
| **Git** | any recent | to clone the repo |

> **Note on Neo4j:** `docker-compose.yml` also defines a Neo4j container. It is a **legacy/optional** dependency — the current graph & risk-analysis pipeline is fully Postgres-driven and in-memory (Neo4j-independent). You do not need to start it for the product to work.

## Setup & Installation

### 1. Clone the repository

```bash
git clone <your-repo-url>
cd Bank_Hackathon
```

### 2. Start PostgreSQL

Pick **one**:

**Option A — Docker (recommended, zero local install):**

```bash
docker compose up -d postgres
```

This starts Postgres 16 on `localhost:5432` with `user=postgres`, `password=postgres`, `db=finintel` (matches the backend's default `DATABASE_URL`).

**Option B — native Postgres:**

Create a database and user matching (or override via `DATABASE_URL`, see [Environment Variables](#-environment-variables-reference)):

```sql
CREATE DATABASE finintel;
```

> Migrations under `backend/migrations/` run **automatically** on gateway startup (via `sqlx`) — no manual schema step is required with a fresh database.

### 3. Set up the Python ML services (conda)

```bash
conda env create -f environment.yml -n finintel
conda activate finintel

# Report service needs one extra package not pinned in the exported env:
pip install reportlab
```

> If `conda env create` is slow/platform-mismatched (the exported `environment.yml` is a Windows/CUDA build), create a fresh env and install from `requirements-working.txt` instead:
> ```bash
> conda create -n finintel python=3.11 -y
> conda activate finintel
> pip install -r requirements-working.txt
> pip install reportlab
> ```

### 4. Configure the report service's email settings (optional)

Only needed if you want the "email report" feature. Copy the example and fill in your SMTP credentials:

```bash
cd ml-services/report
cp .env.example .env
# edit .env: SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASSWORD, SMTP_FROM
cd ../..
```

Every other service and the gateway work with **zero configuration** — all service URLs and the database URL have sane `localhost` defaults (see [Environment Variables](#-environment-variables-reference) to override any of them).

### 5. Build the backend

```bash
cd backend
cargo build
cd ..
```

### 6. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Running the Project

### Fastest path — one command starts everything

**Windows (PowerShell):**

```powershell
./scripts/start-all.ps1
```

**Linux / macOS / Git Bash:**

```bash
chmod +x scripts/start-all.sh   # first time only
./scripts/start-all.sh
```

This launches all 8 Python ML services (each in its own window/process) **and** the Rust gateway (`cargo run` on port `8080`). It assumes Postgres is already running and the `finintel` conda env exists.

Then, in a separate terminal, start the frontend:

```bash
cd frontend
npm run dev
```

Open **http://localhost:3000** — the frontend talks to the gateway at `http://localhost:8080` by default (configurable in-app under Settings, or via `VITE`/runtime config).

### Manual path — start each service yourself

If you want full control (e.g. only running a subset of services during development):

```bash
# 1. Postgres must already be running (Docker or native)

# 2. Each ML microservice (run each in its own terminal, conda env activated)
cd ml-services/ocr          && uvicorn main:app --port 8001
cd ml-services/standardize  && uvicorn main:app --port 8002
cd ml-services/entity       && uvicorn main:app --port 8003
cd ml-services/validation   && uvicorn main:app --port 8004
cd ml-services/graph        && uvicorn main:app --port 8005
cd ml-services/anomaly      && uvicorn main:app --port 8007
cd ml-services/temporal     && uvicorn main:app --port 8008
cd ml-services/trail        && uvicorn main:app --port 8009
cd ml-services/report       && uvicorn main:app --port 8010

# 3. The Rust gateway
cd backend && cargo run

# 4. The frontend
cd frontend && npm run dev
```

Add `--reload` to any `uvicorn` command for hot-reload during development (the `start-all` scripts omit it for stability). Note: `--reload` watches `.py` files only — changes to `.env` require a manual restart to take effect.

### Service map (once running)

| Service | URL |
|---|---|
| Frontend | http://localhost:3000 |
| API Gateway | http://localhost:8080 |
| Gateway Swagger UI | http://localhost:8080/docs |
| Gateway health | http://localhost:8080/health |
| All-services health | http://localhost:8080/services/health |
| OCR | http://localhost:8001 |
| Standardize | http://localhost:8002 |
| Entity | http://localhost:8003 |
| Validation | http://localhost:8004 |
| Graph | http://localhost:8005 |
| Anomaly | http://localhost:8007 |
| Temporal | http://localhost:8008 |
| Trail | http://localhost:8009 |
| Report | http://localhost:8010 |

## Docker Setup & Execution

Today, **Docker is used for infrastructure** (PostgreSQL, and an optional legacy Neo4j) — the gateway, ML services, and frontend run natively as described above for fastest local iteration and full GPU/OCR access. `docker-compose.yml` at the repo root:

```yaml
services:
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: finintel
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data

  neo4j:                # legacy / optional — not required by the current pipeline
    image: neo4j:5
    environment:
      NEO4J_AUTH: neo4j/password
    ports:
      - "7474:7474"
      - "7687:7687"
    volumes:
      - neo4j_data:/data
```

### Start the containerized database

```bash
docker compose up -d postgres
```

Check it's healthy:

```bash
docker compose ps
docker compose logs -f postgres
```

### Point the gateway at it

The default `DATABASE_URL` (`postgres://postgres:postgres@localhost:5432/finintel`) already matches this container — no configuration needed. If you changed the compose credentials, export an override before `cargo run`:

```bash
export DATABASE_URL="postgres://postgres:postgres@localhost:5432/finintel"
```

### Stopping / resetting

```bash
docker compose down            # stop containers, keep data volume
docker compose down -v         # stop containers AND wipe the Postgres volume (fresh DB next start)
```

### Containerizing the app services yourself

There are no Dockerfiles for the gateway/ML services/frontend in this repo yet (they're run natively per above). If you need fully containerized deployment, the pattern to follow for each piece is:

- **Backend (Rust):** multi-stage build — `cargo build --release` in a `rust:1` builder stage, copy the binary into a slim `debian:bookworm-slim` runtime image, set `DATABASE_URL` and the `*_URL` service-discovery env vars (see below) to the container network's service names instead of `localhost`.
- **ML services (Python):** one image per service (or a shared base image) from `python:3.11-slim`, `pip install -r requirements-working.txt` (+ `reportlab`), `CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "<service-port>"]`.
- **Frontend:** `node:22-slim` build stage (`npm run build`) → `npm run start` (serves the built app via the bundled Express server) or serve the static `dist/` via nginx.
- Add each as a service in `docker-compose.yml`, put them on the same Docker network, and swap every `*_URL`/`DATABASE_URL` `localhost` reference for the corresponding compose service name.

## Environment Variables Reference

All variables are optional with working `localhost` defaults for local development — only set what you need to override.

### Backend gateway (`backend/.env`, loaded via `dotenvy`)

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/finintel` | Postgres connection string |
| `OCR_URL` | `http://localhost:8001` | OCR service base URL |
| `STANDARDIZE_URL` | `http://localhost:8002` | Standardize service base URL |
| `ENTITY_URL` | `http://localhost:8003` | Entity service base URL |
| `VALIDATION_URL` | `http://localhost:8004` | Validation service base URL |
| `GRAPH_URL` | `http://localhost:8005` | Graph service base URL |
| `ANOMALY_URL` | `http://localhost:8007` | Anomaly service base URL |
| `TEMPORAL_URL` | `http://localhost:8008` | Temporal service base URL |
| `TRAIL_URL` | `http://localhost:8009` | Trail service base URL |
| `REPORT_URL` | `http://localhost:8010` | Report service base URL |

### Report service (`ml-services/report/.env`, copy from `.env.example`)

| Variable | Default | Purpose |
|---|---|---|
| `SMTP_HOST` | — | e.g. `smtp.gmail.com` (required only for the "email report" feature) |
| `SMTP_PORT` | `465` | `465` = implicit SSL, `587` = STARTTLS |
| `SMTP_USER` | — | SMTP login (often same as `SMTP_FROM`) |
| `SMTP_PASSWORD` | — | SMTP login / app-password |
| `SMTP_FROM` | `SMTP_USER` | From address |
| `SMTP_USE_TLS` | `false` | `true` = STARTTLS on 587, `false` = SSL on 465 |

Graph/Trail/Report services also read `GRAPH_URL` / `TRAIL_URL` (same defaults as above) to call each other for cross-service report data.

### Frontend

The gateway base URL defaults to `http://localhost:8080` and can be changed at runtime from the in-app **Settings** page — no rebuild required. An optional `GEMINI_API_KEY` enables an AI-copilot demo feature in `frontend/server.ts`; the app runs fully without it.

## API Access

The gateway exposes a single, uniformly-enveloped REST API (`{ success, data, error, meta }` on every response):

- **Swagger / OpenAPI UI:** http://localhost:8080/docs
- **Health check:** http://localhost:8080/health
- **All-microservices health:** http://localhost:8080/services/health

See [`API_CONTRACT.md`](API_CONTRACT.md) for the full endpoint contract and [`BACKEND_EXPLAINED.md`](BACKEND_EXPLAINED.md) for a deep dive into every microservice's algorithms.

## Testing

```bash
# Rust
cd backend && cargo check && cargo test

# Frontend type-check
cd frontend && npx tsc --noEmit

# Python microservices (each has its own test_*.py files, e.g.)
cd ml-services/graph && python -m pytest
cd ml-services/trail && python -m pytest
cd ml-services/ocr   && python -m pytest
```

- **Uploading a statement never finishes** — check `http://localhost:8080/services/health`; if any ML service shows unhealthy, start it (see [Running the Project](#running-the-project)).
- **`.env` changes don't seem to apply** — `uvicorn --reload` watches `.py` files only, not `.env`. Fully restart the affected service after editing its `.env`.
- **Report emails fail with a TLS/SSL error** — some corporate VPN/Zero-Trust clients (e.g. Cloudflare WARP) intercept and break TLS handshakes for certain OpenSSL builds. If this happens, try disabling the VPN/proxy for the report service's outbound traffic, or switch `SMTP_PORT`/`SMTP_USE_TLS` between `465`/SSL and `587`/STARTTLS in `ml-services/report/.env` (then restart the service) — the service already retries automatically across both transports.
- **Whole-network view looks incomplete right after an upload** — whole-network results are cached (`analysis_cache`) and refreshed automatically when a new statement finishes processing; give the background job a moment to complete (watch the alert bell / job status).
