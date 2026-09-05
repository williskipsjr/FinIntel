# LLM-Assisted Extraction — Future Consideration

**Status: Not adopted. Parked for future evaluation.**
**Author's recommendation: Do not put a hosted/cloud LLM in the extraction path — that's disqualified on privacy grounds alone (§3.1). A fully local model is a materially different, genuinely pilot-worthy option (§6) — it resolves the privacy blocker and most of the consistency concern, but doesn't remove hallucination risk and adds real hardware/ops cost. Worth a scoped, human-supervised pilot; not a wholesale replacement of the deterministic pipeline yet.**

## 1. Why this is even on the table

The current extraction pipeline (`ml-services/ocr/` + `ml-services/standardize/`) is **100% deterministic**: PaddleOCR for pixels-to-text on scanned documents, then regex/rule-based table detection (`PdfTableExtractor`), narration-continuation stitching (`TextStatementReconstructor`), and a scored synonym table for column mapping (`column_intelligence.py`). It has no LLM anywhere in the extraction path.

That pipeline is good, but it is fundamentally **enumerative**: every bank layout it handles correctly is a layout someone anticipated and wrote a rule for (a header keyword, a date regex, a narration-continuation heuristic). Real bank statements are extremely diverse — different banks, different PDF generators, different table conventions, scanned vs. digital, regional-language narration fragments, inconsistent multi-line wrapping. Every new format that doesn't fit an existing rule either:
- silently mis-extracts (truncates, misattributes fields — the exact class of bug just fixed this session), or
- gets dropped/flagged for manual entry.

An LLM, by contrast, can *read* a statement contextually — "this block of text, immediately below a NEFT row with no date, is obviously the continuation of that narration" — without a human having written a rule for that specific bank's layout first. That's the appeal: **better generalization to unseen formats, with less rule-maintenance burden.**

## 2. Where an LLM could plausibly help

| Task | Current approach | What an LLM could add |
|---|---|---|
| Table/row detection in messy PDFs | pdfplumber `extract_tables()` + heuristic header detection | Understand a table that pdfplumber can't grid-detect (irregular spacing, no visible borders) |
| Multi-line / multi-part narration stitching | Regex + "does this line have a date/money token" heuristic | Contextual judgment on which fragment belongs to which transaction, including ambiguous cases |
| Column-header mapping | Scored synonym dictionary (`column_intelligence.py`) | Handle a header phrase never seen before ("Txn Narration / UTR Ref") without a maintainer adding it to the synonym list |
| Counterparty / entity extraction from narration | Regex + stopword filtering (`counterparty.py`) | Understand narration text with more nuance (e.g. distinguishing a person name from a business suffix in one pass, rather than a hand-maintained exclusion list) |
| OCR error correction | None — PaddleOCR output used as-is | Plausible-text correction of OCR misreads ("O" vs "0", broken characters) |
| New-bank-format onboarding | A developer manually adds parsing rules per bank | An LLM could draft a first-pass rule set for a new bank from a handful of sample statements, for a human to review and commit |

## 3. The case against — and why it's heavier than it looks here

This is not a generic "should we use AI" question. The context is specific and it changes the calculus a lot: **this system ingests real citizens' bank statements as evidence in active criminal investigations, for a state police cyber-crime department.** Every downside below is sharper because of that context.

### 3.1 Privacy / data sovereignty (the blocking concern)

- Every bank statement processed contains highly sensitive PII: account numbers, balances, transaction history, counterparty names, sometimes Aadhaar/PAN references in narration. Under investigation, it may also be **sub judice evidence**.
- Sending that data to a **third-party hosted LLM API** (OpenAI, Anthropic, Google, etc.) means it leaves the department's infrastructure and crosses into a commercial vendor's servers — frequently outside India. For a CID/police tool, this is very likely a non-starter on its own:
  - It may conflict with India's **DPDP Act 2023** obligations around sensitive personal/financial data and cross-border transfer.
  - It creates a **new party with a copy of investigation evidence** — a chain-of-custody problem. "We extracted this transaction using a cloud AI service" is a hard sentence to defend in court or to an evidence-audit process.
  - Vendor data-retention/training policies (even "we don't train on API data") still mean the data transited and was processed by systems outside CID's control.
- **This is the single biggest reason not to adopt a hosted LLM for this pipeline as it stands today.** It's not a performance or cost question — it's a legal/evidentiary one.

### 3.2 Consistency / determinism (the forensic-integrity concern)

- LLM output is probabilistic. The same statement processed twice — or the same statement processed today vs. after the provider silently updates the model — can produce **different extracted numbers**.
- For a fraud investigation, "why does this platform say ₹1,200 was debited here" needs a reproducible, auditable answer. A regex/rule-based pipeline can be tested exhaustively and its behavior is fixed until someone deliberately changes the code (with a diff, a commit, a review). An LLM's behavior can drift under a hosted provider without any code change on your side at all.
- **Hallucination risk is the sharpest version of this**: when extraction is ambiguous, a rule-based system fails visibly (returns `None`, drops the row, flags low confidence). An LLM can instead produce a *plausible-looking but wrong* number or account name — confidently. In a system whose entire value proposition is "trustworthy financial forensics," a fabricated transaction amount is far more dangerous than a missing one.
- Courts and internal audit processes generally want extraction that is **explainable at the rule level** ("this field maps to narration because the header matched `/particulars/i` with confidence 0.85"), not "the model decided so."

### 3.3 Operational concerns (secondary, but real)

- **Cost**: per-page/per-statement LLM calls add a real, recurring cost that a regex pipeline doesn't have — multiplies with the volume of statements a department processes.
- **Latency**: LLM calls run in seconds, not milliseconds; multi-page statements with many transactions would meaningfully slow down the ingestion pipeline described in this session's memory-efficiency review.
- **Offline/air-gapped deployment**: police/government infrastructure often needs to run without external network dependency for security reasons. A hosted LLM API breaks that; a self-hosted model needs real GPU infrastructure the team may not currently have.
- **Attack surface**: narration text is attacker-influenced (a launderer chooses what to write in a UPI note). Prompt-injection-style content in narration text is a genuinely new and untested risk class for an LLM-based extractor that doesn't exist for a regex-based one.

## 4. Net assessment

| Dimension | Deterministic (current) | Hosted LLM | Self-hosted LLM |
|---|---|---|---|
| Format generalization | Weak — needs a rule per format | Strong | Strong |
| Privacy / data sovereignty | Safe — no data leaves infra | **Fails** for CID evidence use | Safe, if properly deployed |
| Reproducibility / auditability | Strong | Weak | Weak-to-moderate (still probabilistic, but at least version-pinned) |
| Hallucination risk | None (fails visibly instead) | Real | Real |
| Cost at scale | Near-zero | Meaningful | High upfront (GPU infra), low marginal |
| Latency | Milliseconds | Seconds | Seconds (less network overhead) |
| Offline/air-gapped capable | Yes | No | Yes, with investment |
| Court/evidence defensibility | Strong | Weak | Moderate, with logging discipline |

**Hosted LLMs are disqualified outright for this use case** on privacy grounds alone, independent of the consistency concerns. **Self-hosted/open-weight LLMs remove the privacy blocker** but keep the determinism/hallucination/explainability problems, and add real infrastructure cost.

## 5. Narrowing to "local only" — does it change the answer?

Yes, materially. "Local" here means: the model runs entirely on the department's own hardware (dev machine, on-prem server, or an air-gapped box), nothing is ever sent over a network, and the team controls the exact model file in use. This is a stricter, more concrete version of "self-hosted" above, and it's worth walking through what it actually fixes vs. what it doesn't.

### 5.1 What running fully local resolves

- **Privacy / data sovereignty — solved.** No statement data ever leaves the machine it's already on. No DPDP cross-border transfer question, no third-party vendor with a copy of evidence, no dependency on an external network connection at all. This removes the single hard blocker from §3.1 outright.
- **Model-drift risk — solved.** With a hosted API, the *provider* controls when the model changes. Local, the team controls the exact model weights (a specific file, pinned and version-controlled like any other artifact) and nothing changes unless *they* choose to update it. That's a genuinely different reproducibility story than "OpenAI silently upgraded gpt-4o last Tuesday."
- **Determinism — largely fixable, not automatic.** LLM inference is stochastic by default (sampling), but running with **greedy decoding (temperature = 0)** on a fixed model, fixed prompt, and frozen inference stack makes output deterministic for practical purposes — the same statement will extract the same way every time. This needs to be a deliberate engineering choice (pin the model file, pin the inference library version, disable sampling), not something that comes for free just because it's local.
- **Offline/air-gapped deployment — solved.** Matches the kind of infrastructure constraint police/government systems typically operate under anyway.

### 5.2 What running fully local does *not* resolve

- **Hallucination risk — unchanged, possibly worse.** Being local makes a model private and controllable, not more truthful. And the specific hardware already in this project's environment is a real constraint: the dev machine's GPU is an **RTX 4060 Laptop with 8GB VRAM** (confirmed from this project's own setup notes). That comfortably fits a quantized 7B–8B open-weight model (Llama 3.1 8B, Mistral 7B, Qwen2.5 7B, etc.) but not a frontier-class model. Smaller open-weight models are noticeably weaker than hosted frontier models at precise, no-error-tolerated numeric extraction — the exact task at hand. A confidently wrong ₹ amount from a small local model is just as dangerous as one from a large hosted model; it may in practice be *more* likely.
- **Explainability — unchanged.** A local model is still a black box relative to a regex rule. "Why did it map this text to `narration`" still isn't answerable at the rule level, even though the vendor-trust question is gone.
- **Resource contention — a new, concrete constraint.** The OCR service already loads PaddleOCR into memory for scanned statements (a real, measured resident-memory cost from this session's earlier memory-efficiency review). Adding a local LLM inference process onto the *same* 8GB-VRAM GPU means the two now compete for memory — running OCR and LLM-assisted extraction concurrently on current hardware would need to be load-tested, not assumed to just work.
- **Ops/maintenance burden shifts, doesn't disappear.** Instead of maintaining regex rules, the team now maintains: a pinned model artifact, an inference server (Ollama / llama.cpp / vLLM) kept running and patched, a prompt-versioning discipline, and an eval suite to catch accuracy regressions whenever the model or prompt changes. That's real work, just a different kind.

### 5.3 Net effect of "local only"

Local moves this from **"disqualified"** to **"a genuinely viable pilot candidate,"** specifically because it removes the one blocking concern (privacy) and meaningfully improves the other (consistency, if configured deliberately with pinned weights + greedy decoding). It does **not** remove hallucination risk or the explainability gap, and it introduces a concrete hardware-contention question on this project's current GPU that would need to be benchmarked, not assumed away.

## 6. Recommendation

**Do not put a hosted/cloud LLM anywhere near statement data.** That's a closed question on privacy grounds alone (§3.1).

**A fully local model is worth a scoped, supervised pilot** — but still not as a wholesale replacement of the deterministic pipeline, because hallucination risk and explainability remain open problems regardless of locality. If piloted:

1. **Fully local only, no exceptions.** Verified no network egress from the extraction process. Non-negotiable given the evidentiary context.
2. **Pinned weights + greedy decoding.** A specific model file, version-controlled, with sampling disabled — this is what actually buys the determinism benefit described in §5.1; it doesn't happen automatically.
3. **Fallback, not primary path.** Run the deterministic pipeline first; only invoke the local model on statements/rows it explicitly flags as low-confidence or unparsed — not on every statement.
4. **Human-in-the-loop, always.** Any LLM-produced field must be visibly marked as AI-assisted and require investigator confirmation before it's treated as fact in a report — never silently merged into the ledger the way a regex-matched field is today.
5. **Structured-output + validation layer.** Constrain the model to a strict schema and reject/flag anything that doesn't validate (right types, plausible date ranges, amount consistent with balance delta) rather than trusting free-text output directly.
6. **Full audit logging.** Log the exact model version, prompt, and raw output alongside every AI-assisted extraction, so any field can be traced back to exactly what produced it.
7. **Benchmark hardware contention first.** Load-test the local model running alongside PaddleOCR on the actual target GPU (8GB VRAM on the current dev machine) before assuming both can run concurrently in production.
8. **Narrow scope first.** The lowest-risk, highest-value starting point is *not* per-transaction extraction on live case data — it's **developer-facing assistance for onboarding a new bank format** (suggesting a first-pass rule set from sample statements, reviewed and committed by a human). That captures most of the "faster to support new formats" benefit with none of the evidentiary risk, and is a reasonable place to actually start experimenting.

**Trigger to revisit:** if the deterministic pipeline's format coverage plateaus despite continued rule additions, and the department is willing to invest in (a) dedicated GPU headroom separate from what PaddleOCR already uses, and (b) a formal audit-logging framework — that's the point to run the pilot in item 8 above, not before.
