# Design Thinking Session: Scheza

**Date:** 2026-09-24
**Facilitator:** Boris
**Design Challenge:** The Week-4 Retention Gate (the lock on the Phase 3 "digital crew" vision)

---

## 🎯 Design Challenge

**How might we make Scheza indispensable to "Time-Starved Tim" by week 4 — so that logging his real business into it becomes a daily reflex, not a one-time "wow" — thereby earning the accumulated per-tenant memory that unlocks the Phase 3 digital crew?**

**Why this challenge (grounded in Boris's own docs):**

- Product principle #1 (planning-artifacts/prd.md): *"Value compounds, it does not front-load. The 30-second generation is the hook, not the product. Scheza must be more useful in month six than in minute one."*
- The 30-second generation is a front-loaded dopamine hit; without week-4 usage there is no event stream → no accumulated `tenant_facts` memory → no moat → no Phase 3.
- Phase 3 ("Your Digital Employee," FR62–FR69) is explicitly **gated on proven week-4 retention + month-over-month records-under-management growth**. This retention gate is the literal precondition for the "developer / scrum-master / marketer" agent-crew vision.

**Primary user:** *Time-Starved Tim* — 45, HVAC contractor, GTA, 5 trucks, lives on his iPhone, hates computers, dirty hands, spotty signal, works in a truck all day.

**Constraints:** Mobile-first PWA · EN/FR · PIPEDA (ca-central-1) · frozen MVP stack · self-imposed Phase-3 gate on this metric.

**Success:** Tim logs a *real* data entry in W1 (KPI target 40%) and is still returning in W4.

**The haunting question:** *Why would a man who hates computers open this app on Tuesday of week 3?*

---

## 👥 EMPATHIZE: Understanding Users

**Methods used:** Journey Mapping · Contextual Shadowing (Tim in the truck) · Jobs-to-be-Done · Empathy Mapping. These fit because Tim is a real, observable, hands-busy field worker — we learn far more from *where and how he works* than from asking him what features he wants.

### User Insights

**Tim's day (journey):** Wakes 5:30am → coffee, checks texts for today's jobs (stored in his head + a notebook on the dashboard) → drives truck-to-truck all day, gloves on, hands dirty, phone in a windshield mount → texts customers "on my way" → collects cash/e-transfer → scribbles parts + amounts in the notebook → gets home 7pm exhausted → **9pm dread**: sits at the kitchen table and does invoices in QuickBooks he hates, wife helps with the books.

**The claim story:** Tim got a cold email — *"Hey Tim, I built this app for Tim's HVAC, click here."* He clicked, saw a gorgeous dashboard with 5 trucks and Ontario addresses, thought *"whoa,"* claimed it with a magic link... and then the dummy data got wiped and he was staring at an **empty app** at 9:47pm. He closed it. He's been meaning to "set it up this weekend" for three weekends.

### Key Observations

**Why Tim will NOT return in week 4 — the six churn forces:**

1. **Value is front-loaded; effort is back-loaded.** The wow was free; the real value requires *him* to type his whole business in. The magic oversells, then week 1 reveals the work is his. This is the exact inversion of what retention needs.
2. **The claim moment creates "empty-app dread."** Wiping the dummy data (per the deploy flow) replaces a rich-looking app with a blank one — the very blank-state intimidation `design.md` warned against, delivered at the worst possible moment.
3. **Data entry is impossible at the point of work.** Gloves, dirty hands, driving, cold, spotty signal. Tim cannot type a job *while doing the job* — and by 9pm he's too tired.
4. **"Good enough" incumbent.** His notebook + texts + memory already work. Scheza currently *adds* a step instead of *removing* one. Switching cost > perceived gain.
5. **Single-player diary.** None of his 5 techs or his wife are in it, so it's not the source of truth — it's a parallel record only Tim must maintain. Nothing breaks if he ignores it.
6. **No reason to return.** Nothing pulls him back — no nudge he'd care about, no money on the line, no one depending on it.

**What surprised us (the counter-intuitive core):** *The 30-second generation "wow" may actively HURT retention.* It sets the expectation that the app does the work — so when week 1 reveals that Tim does the data entry, the gap between promise and effort feels like a betrayal. **The hook and the product are misaligned.**

### Empathy Map Summary

| | Tim |
|---|---|
| **SAYS** | "Looks slick, but I'm slammed." · "I'll set it up this weekend." · "I already keep all this in my head." |
| **THINKS** | "One more thing to keep updated." · "Is this worth $49/mo?" · "My guys will never use it." |
| **DOES** | Opens it once after claiming, pokes around, closes it. Goes back to texts + notebook. Never enters a real job. |
| **FEELS** | Delight → guilt ("I should use it") → overwhelm → indifference → churn. |

**Jobs-to-be-Done:** Tim isn't hiring a "database." He's hiring: **(functional)** get paid faster, never forget a job or a part; **(emotional)** kill the 9pm paperwork dread, feel in control; **(social)** look professional to customers, look organized to his crew. Today he "hires" his notebook, his memory, his wife, text messages, and QuickBooks — Scheza must beat *that* bundle, not a blank slate.

---

## 🎨 DEFINE: Frame the Problem

### Point of View Statement

> **Time-Starved Tim needs his real jobs to land in Scheza almost without typing, and needs a reason the app pulls him back each day — because Scheza's value is front-loaded (the wow) while its effort is back-loaded (data entry), and he already runs a "good enough" system he won't abandon for something that adds a step to his day.**

### How Might We Questions

1. **HMW get Tim's real jobs into Scheza without him sitting down to type them?**
2. HMW give Tim a reason to open the app that he'd feel even if he never typed a thing?
3. **HMW make Scheza *remove* a step from Tim's day instead of adding one?**
4. HMW turn the claim moment from "empty-app dread" into "it already knows my week"?
5. HMW make Scheza the source of truth for his crew, so staying *out* of it costs him?
6. HMW convert Tim's existing inputs — texts, calls, photos, voice — into structured records automatically?
7. HMW make the compounding "it's smarter this week than last" feeling something Tim can actually *see*?

### Key Insights

- **The retention lever is not features — it's INPUT FRICTION and RETURN TRIGGER.** Everything else is downstream.
- **Retention design and moat design are the same design.** The Phase-3 crew feeds on the event stream. The event stream only exists if Tim inputs data. Input only happens if it's near-zero effort. So *frictionless capture IS the Phase-3 fuel* — you are not choosing between "boring retention work" and "the cool agent vision." Solving capture builds both.
- **Multiplayer converts a single-player diary into a shared source of truth** → the strongest structural retention lock, and it multiplies the data feeding the moat.
- **The generation wow must be re-pointed** from "look what I built" to "look what I'll keep doing for you" — the hook must *promise the return*, not just the birth.

---

## 💡 IDEATE: Generate Solutions

### Selected Methods

Brainstorming (defer judgment, go for volume) · SCAMPER (bend the existing flow) · Analogous Inspiration (steal from Strava, Duolingo, MyFitnessPal, Cash App) · Crazy 8s (fast divergence). Chosen to force *quantity and range* before we converge — the first idea (an in-app "quick add" button) is almost always the wrong one.

### Generated Ideas

**Cluster 1 — Capture without typing ("Talk, don't type"):**
1. **Voice-to-record:** Tim says *"just finished the Kowalski furnace, parts $340, collected cash"* → Gemini structures it into a job record. Voice is his native mode in a truck.
2. **Text-message ingestion:** a Scheza phone number; Tim texts/forwards job info like he'd tell a buddy → auto-extracted. Meets him where he already lives (SMS).
3. **Photo capture:** snap a handwritten invoice / part label / whiteboard → OCR + LLM → record.
4. **Call-log capture:** call from an unknown number → later prompt *"New job? [Yes → creates lead]."*
5. **Email-in receipts:** forward supplier receipts → auto-log parts + costs.
6. **End-of-day voice dump:** one 30-sec voice note → app splits it into multiple job records.

**Cluster 2 — Return trigger / reason to open:**
7. **6am Run Sheet (SMS):** *"3 jobs today: Kowalski 9am, Nguyen 1pm, Osei 3pm — tap for addresses."* He opens for value, not chore.
8. **Money nudge:** *"2 unpaid invoices = $1,240. Tap to send reminders."* Money is Tim's ultimate trigger.
9. **Proactive suggestion (a taste of Phase 3):** *"Kowalski furnace — warranty follow-up due in 6 months. Want me to remind you?"*
10. **Sunday snapshot:** *"You made $4,200 this week."* Emotional payoff, zero effort.

**Cluster 3 — Remove a step:**
11. **One-tap auto-invoice:** from a completed job record → branded invoice sent. Replaces the 9pm QuickBooks ritual entirely. (Killer.)
12. **Auto-collections:** SMS reminder to customers on unpaid invoices — collects money while Tim sleeps.

**Cluster 4 — Multiplayer / crew:**
13. **Dead-simple tech links:** each of 5 techs gets a link, sees only *their* jobs today, taps "done." Now the app is dispatch truth — Tim *must* be in it.
14. **Wife = bookkeeper view:** she gets the money screen. Two people now depend on it.

**Cluster 5 — Fix the claim moment:**
15. **Never-blank claim:** on claim, run a 60-second voice/text interview → pre-populate with *real* jobs, so the app is never empty.
16. **Import from his phone:** *"Connect contacts/texts — I'll find your recent jobs"* (privacy-gated, PIPEDA-safe).

**Cluster 6 — Make the moat visible:**
17. **"Scheza learned 12 things about your business this week"** badge — makes the accruing memory *felt*.
18. **Smarter defaults over time:** auto-fills part costs, addresses, typical job durations from history — the app visibly gets easier.

**Wild / provotypes (push past obvious):**
19. **Zero-UI for Tim:** the entire product for Tim is SMS + voice; the "dashboard" is for his wife/office. *What if the retention play is that Tim barely touches a screen?*
20. **AI receptionist:** Scheza answers his business line, logs every call as a lead. Reveals the principle: *the highest-retention capture is the one Tim doesn't even do.*

*Analogous steals:* Strava (compounding stats pull you back) · Duolingo (nudges/streaks) · MyFitnessPal (barcode scan crushed logging friction) · Cash App (money is the hook) · Superhuman (speed as the feature).

### Top Concepts

**Concept A — "Talk, Don't Type" (Frictionless Capture).** Voice + text-message + photo → structured records via Gemini. Kills the back-loaded-effort churn force and *directly fills the event stream that Phase 3 runs on.* **The foundation.**

**Concept B — "6am Run Sheet + Money Nudges" (Return Trigger).** Proactive daily SMS that gives value before asking for input; unpaid-invoice + Sunday-earnings nudges. Gives Tim a reason to return he feels even if he never types. A *preview of the Phase-3 operator* in humble suggestion form.

**Concept C — "Auto-Invoice + Crew Dispatch" (Remove-a-step + Multiplayer).** One-tap invoice from a job record (kills the 9pm ritual = willingness-to-pay moment) + per-tech job links (makes the app the source of truth = structural lock).

**Why these three:** they form a self-reinforcing loop → **Capture (A)** gives the app real data → the app can **nudge & dispatch (B, C)** → Tim returns → captures more → **memory compounds** → the Phase-3 gate opens. Retention and moat, built by the same three moves.

---

## 🛠️ PROTOTYPE: Make Ideas Tangible

### Prototype Approach

**Wizard of Oz — before writing a line of the capture pipeline.** The riskiest assumptions are behavioral, not technical: *will Tim actually capture by voice/text, and will nudges pull him back?* You don't need Gemini to learn that. **Boris (or a helper) is the backend.** Rough, fast, human-powered — because a flopped fake test this month is worth more than a polished pipeline built on a wrong assumption.

### Prototype Description

1. Stand up a **Twilio phone number** = "Scheza." Recruit **5–7 real GTA trades** (HVAC, plumbing, electrical, snow removal).
2. Tell them: *"Text or voice-note me your jobs like you'd tell a buddy. Every morning I'll text your run sheet."*
3. Behind the curtain, a human reads each message and hand-enters a structured record into a bare dashboard (even a spreadsheet), then manually sends: the **6am run sheet**, an **invoice PDF within 5 minutes** of a "job done" text, a **Wednesday unpaid-invoice nudge**, and the **Sunday "you made $X + 2 warranty follow-ups due"** snapshot.
4. **Storyboard the 5 scenes:** (1) 6am run-sheet SMS → (2) Tim voice-notes a finished job from the truck → (3) instant invoice texted back → (4) Wed money nudge → (5) Sunday earnings + smart follow-up snapshot.

### Key Features to Test (the assumptions, ranked by risk)

- **A1 (riskiest):** Tim will actually capture via voice/text *at the point of work*. If he won't input even by voice, nothing downstream matters.
- **A2:** The 6am run sheet + money nudges make him open/reply (the return trigger works).
- **A3:** One-tap auto-invoice is the "remove-a-step" he'd pay $49/mo for.
- **A4:** Seeing "you made $X / it learned Y" produces the compounding feeling.
- **A5:** A never-blank claim (60-sec interview) beats empty-app dread.

---

## ✅ TEST: Validate with Users

### Testing Plan

- **Who:** 5–7 real GTA trades (not friends, not developers — actual Tims). Include one French-preferring operator (EN/FR is a product constraint).
- **How long:** 3–4 weeks — deliberately long enough to reach the *actual week-4 question* we're designing for.
- **Tasks:** capture 3 jobs by voice/text over the first week; respond to a nudge; request an invoice.
- **Measure behavior, not opinions** (observe what they *do*, per the empathize principle): Did they capture *unprompted* on day 3, 7, 14, 21? Did they open/reply to the 6am SMS? Did they send an invoice? **Records-created-per-week per user** — the Phase-3 gate metric, in miniature.

### User Feedback

Captured live in a **Feedback Capture Grid** per participant — *Likes · Struggles · Surprises · Would-change* — reviewed weekly. (To be filled during the pilot; the pilot is the point.)

### Key Learnings (hypotheses to confirm/kill)

- Voice/text capture will dramatically outperform in-app typing (expected).
- The *return trigger*, not the dashboard, drives opens.
- The invoice is the willingness-to-pay moment.
- Empty-app-after-claim is a real churn cliff → the never-blank claim is high-leverage.
- Crew multiplayer may be the strongest structural lock but is hardest to test with a solo pilot → flag for **cycle 2**.

---

## 🚀 Next Steps

### Refinements Needed

- **Narrow the MVP retention bet** to **Capture + Trigger + Auto-invoice**; defer crew multiplayer to cycle 2.
- **Redesign the claim moment** so the app is *never blank* (60-second real-job interview).
- **Re-point the generation wow** from "look what I built" to "look what I'll keep doing for you."

### Action Items (sequenced)

1. **Run the Wizard-of-Oz pilot** (Twilio number + human backend, 5–7 GTA trades) — *before* writing any capture code. Cheapest possible test of the riskiest assumption.
2. **Instrument the true north-star from day one:** `records-created-per-org-per-week`. Your architecture already anticipates this (activity-log / usage-metering readiness) — wire the metric even in the fake test.
3. **Re-sequence the roadmap:** treat frictionless capture as the *retention engine and Phase-3 fuel*, not a "nice feature" — pull it forward ahead of dashboard polish.
4. **Redesign the claim flow** to never-blank; storyboard it and test in the pilot.
5. **Hold the Phase-3 gate closed until week-4 retention proves out.** *Then* design the first agent-role — recommend the **collections / bookkeeper role** (closest to money = highest-trust, highest-payoff first graduation under FR63–FR66), not the "developer" agent.

### Success Metrics

- **Leading indicators:** % of pilot users capturing ≥1 real record *unprompted* on day 7 / 14 / 21 · 6am-SMS open+reply rate · invoices sent per user.
- **North-star (the Phase-3 gate, in miniature):** median `records-created-per-org` in **week 4 ≥ week 1** — i.e. usage *compounds*, does not decay.
- **Guardrails:** W1 real-entry retention ≥ 40% (existing KPI) · W4 still-active ≥ target.
- **Kill criterion:** if voice/text capture does **not** beat in-app typing in the pilot, the "value compounds" thesis — and therefore Phase 3 — must be rethought *before any code is written*.

---

_Generated using BMAD Creative Intelligence Suite - Design Thinking Workflow_
