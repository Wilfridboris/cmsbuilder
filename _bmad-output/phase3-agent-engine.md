# Scheza Phase 3 — The Agent Engine (Technical Reference)

**Date:** 2026-09-24
**Author:** Boris (with Maya / Design Thinking facilitation)
**Status:** Vision / Phase 3 — reference for future engineering hires. Not MVP scope.

**Core strategic principle:** You do not build a better LLM. You rent the brain (Gemini/Claude) and build the *nervous system* around it — memory, orchestration, and small explainable models. The moat is the **data flywheel**, not any single algorithm. Every piece below sits behind a **clean seam** so a future engineer can upgrade one model without re-architecting the system.

---

## [1] The Flywheel Architecture

The intelligence is not one clever equation — it is a **loop that compounds**. Each turn of the loop makes the next turn smarter, because the business's own data accumulates in the middle.

```
                     ┌───────────────────────────────────────────┐
                     │                                           │
                     ▼                                           │
        ①  EVENT STREAM  (the senses)                            │
        org_activity_log — append-only, replayable (NFR-FC2)     │
                     │                                           │
                     ▼                                           │
        ②  MEMORY  (the brain's notebook)                        │
        tenant_facts projection + pgvector                       │
        [ RETRIEVAL: embeddings + cosine similarity ]            │
                     │                                           │
                     ▼                                           │
        ③  ORCHESTRATOR  ("co-founder" agent)                    │
        planner/router — LLM + rules. Picks who acts,            │
        resolves conflicts, enforces the memory contract        │
                     │                                           │
                     ▼                                           │
        ④  WORKER AGENTS  (the roles)                            │
        each = LLM (language) + a SMALL MODEL (prediction)       │
                     │                                           │
                     ▼                                           │
        ⑤  ACTION FENCE  (the safe hands)                        │
        action allowlist (NFR-FC4) → guarded mutation           │
        layer (NFR-FC1) → external tools (FR69)                  │
                     │                                           │
                     ▼                                           │
        ⑥  OUTCOME  (did it work?)                               │
        result logged back as a new event ──────────────────────┘
                     (the wheel turns again, smarter)
```

**The critical separation of concerns — memorize this:**

| Job | Technology | Why |
|---|---|---|
| **Language & reasoning** (understand a message, write an email, plan) | **LLM (rented)** | This is what foundation models are unbeatable at. Never rebuild it. |
| **Prediction on structured data** (who won't pay, how long a job takes) | **Small classical model** | Cheap, explainable, runs on your accumulated data, upgradeable by a hire. |
| **Memory / recall** (what do we know about this customer?) | **Retrieval (embeddings + cosine)** | Turns accumulated events into relevant context. The literal heart. |
| **Deciding who acts + safety** | **Orchestrator + allowlist** | Software architecture, not ML. Prevents chaos and danger. |

**Why the flywheel is the moat:** any competitor can copy the cosine-similarity formula and the logistic regression. Nobody can copy *two years of one business's data* sitting in the middle of the wheel. The edge is the flywheel, not the formula.

**The seam that lets you hire later:** each worker agent's small model has a *stable interface* — `features in → prediction out`. Today it can be a hard-coded heuristic (`if days_overdue > 30`). Tomorrow a hire replaces it with logistic regression, then gradient-boosted trees — and **nothing else in the loop changes.** Build the seam now; upgrade the model when success buys you the engineer.

---

## [2] Each Agent Role → Its Small Model

The LLM handles the *words*; the small model handles the *judgment*. Here is the map. Every model is chosen to be **explainable** (fixes the "black box" trust friction) and to **improve as data accumulates** (feeds the compounding moat).

| Agent role | The judgment it needs | Small model (start → upgrade) | Input features (from your data) | Output | Explainable to Tim as… |
|---|---|---|---|---|---|
| **Collections / Bookkeeper** | Which invoice won't get paid? | Rule → **Logistic regression** → Gradient-boosted trees | days overdue, invoice amount, customer's avg days-to-pay, past late count, season | `P(unpaid)` 0–1 | "80% likely you won't get paid — chase this first" |
| **Sales / Follow-up** | Which lead will convert? When to nudge? | Rule → **Logistic regression** (score) + **Multi-armed bandit** (timing/message) | lead source, response time, job type, quote amount, past conversions | `P(convert)` + best message/time | "This lead is hot; texts at 8am convert best" |
| **Operations / Dispatch** | How long will this job take? | Rule → **Linear regression** → Gradient boosting | job type, parts count, which tech, historical durations, time of day | predicted minutes | "This furnace job usually runs 2.5 hrs" |
| **Marketing** | Which post/subject/time performs? | **Multi-armed bandit** (Thompson sampling) | content type, send time, past engagement | best-performing variant | "Friday 'before/after' photos get the most clicks" |
| **Inventory / Reorder** | When will a part run out? | **Moving average / exponential smoothing** (forecast) | usage rate over time, lead time | reorder date/point | "You'll run out of filters in ~9 days" |
| **Reception / Intake** | Is this call a job? How urgent? | Rule → **Text classifier** (embeddings + logistic) | call/message text, keywords, caller history | intent + urgency label | "New emergency job — flagged to top" |

**The upgrade ladder (what you tell your future hire):**
`heuristic rule` → `linear / logistic regression (interpretable)` → `gradient-boosted trees (when data is rich)`. Never jump to deep learning for these — the data is tabular and small; classical models win on cost, speed, *and* explainability. Deep learning here is a rookie flex, not an advantage.

**What NOT to do:** do not fine-tune the LLM per business early. Retrieval + memory beats fine-tuning for personalization — cheaper, instant, reversible, and it doesn't bake mistakes into weights. Fine-tuning is a late-game optimization, if ever.

---

## [3] The Memory Algorithm — The True Heart

This is the "algorithm at the heart" you were chasing. It has two halves that work together.

### Half A — Structured facts (exact recall)

A per-tenant `tenant_facts` store of *typed beliefs*, each carrying:
- `value` (e.g., customer Kowalski's standard rate = $340)
- `provenance` (which events produced it)
- `confidence` (0–1)
- `last_updated` + `version`

**Conflict rule (from your architecture — the load-bearing part):** facts are **versioned and superseded, never mutated in place.** The newer / higher-confidence fact wins; the old one is *retained for audit*. This is what makes a *shared* brain safe when multiple agents write to it — no role silently clobbers another's belief. The whole `tenant_facts` store is a **projection rebuildable from the event log** — a cache, never a second source of truth. **Roles are scopes on *actions*, not on *memory*: one shared brain, separate hands.** (Reject role-local memories — they destroy the moat.)

### Half B — Semantic memory (fuzzy recall) — the embeddings + cosine core

For free-text observations ("customer mentioned the furnace is 15 years old and noisy"), exact key-value lookup fails. You need *meaning-based* recall. That's **embeddings + cosine similarity**, stored in **pgvector** (in-stack, ca-central-1, no new infra).

**How it works, in three steps:**

1. **Embed:** an embedding model turns text into a vector — a list of ~768 numbers capturing meaning. Similar meanings → nearby vectors.
2. **Store:** the vector goes into a `pgvector` column alongside the fact.
3. **Recall:** at query time, embed the question, then find the stored vectors *closest* to it by **cosine similarity**:

   ```
                    A · B
   cos(θ) = ─────────────────────      range −1 … 1   (higher = more similar in meaning)
                 ‖A‖ · ‖B‖
   ```

   Take the top-k closest facts, hand them to the LLM as context. *That* is Retrieval-Augmented Generation (RAG). The cosine equation above is, quite literally, the mathematical heart of the agent's memory.

### Putting the two halves together (the read path)

When an agent needs to act, it assembles context via a **hybrid read**:
- **Structured lookup** for exact facts (rate, address, terms) → precise, no hallucination.
- **Vector recall** for fuzzy context ("what do we know about this customer's history") → semantic.
- Both, plus the live event, go into the LLM prompt. The LLM reasons; the small model predicts; the orchestrator decides; the fence executes.

### The write path (how memory grows)

After each event, an extraction step (LLM) proposes new/updated facts → dedup against existing → apply the conflict rule (version & supersede) → embed any free-text → store. Confidence decays with staleness so old beliefs fade unless reinforced.

**Why this is the heart and not the LLM:** the LLM is rented and identical for everyone. *This memory* — typed, versioned, provenance-tracked, semantically indexed, grown per business — is the one thing that is uniquely yours and uniquely theirs. It is the moat expressed as an algorithm.

---

## The one-paragraph brief for your future engineering hire

> "Don't try to improve the LLM — we rent it. Your job is the nervous system: keep the event stream clean, keep the `tenant_facts` memory projection correct (versioned, provenance-tracked, rebuildable from the log), and own the per-agent small models behind their stable `features → prediction` interfaces. Start every model as a rule, graduate it to logistic/linear regression, then gradient-boosted trees as data grows. Keep everything explainable — a number Tim understands beats a black box he fears. The moat is the data flywheel; your work is to make it spin faster and never corrupt the memory in the middle."

---

_Generated during the Scheza Design Thinking session — companion to design-thinking-2026-09-24.md_
