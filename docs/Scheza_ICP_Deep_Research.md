# Scheza: one-persona customer research and validation plan

Research date: 27 September 2026  
Prepared for: Boris  
Focus: owner-operated residential plumbing service businesses in Ontario

## Decision in brief

**Test whether Scheza can help a small plumbing business close a real job with less administrative work. Do not treat enthusiasm for a generated dashboard as proof of demand.**

The public evidence supports demand for connected quoting, job records, invoicing, payments, and practical mobile use. It does not yet establish that Ontario owners want to generate their own business system, pay per active record, import all their history, or replace their current tools with Scheza.

The strongest initial research persona is an owner who still works on plumbing jobs, has a small crew, and handles administration personally or with a partner. The proposed recruiting boundary is 2–5 people, no full-time office administrator, mainly residential service and repair. This is a research choice, not a validated market segmentation result.

**Recommended first problem to investigate:** the handoff between completed fieldwork and an invoice-ready job. What was done? Which materials and hours belong to it? What changes did the customer approve? What information is still missing before billing?

The business opportunity is conditional: this handoff must be frequent, costly, and poorly handled by the owner's existing tools. A record tracker that adds another place to update may make the problem worse.

## 1. Scope, method, and limits

I read the supplied `prd.md`, including its personas, MVP requirements, pricing, activation metrics, and deferred workflow and autonomous-operator plans. A separate file titled `deep-research` was not found after an exact title search and a simpler research search. The PRD references `docs/research.md`, but that source was not available. This report therefore tests the attached PRD, not unseen research.

“IPC” is interpreted as ICP, ideal customer profile. “Y assumptions” is interpreted as your assumptions in the PRD.

Research used public Reddit discussions, a specialist plumbing forum, Jobber's customer community, official product documentation, and a trade publication. Searches covered software selection, paperwork, billing, customer approvals, expense tracking, pricing jobs, mobile work, Ontario fit, and competing explanations. Both available search engines were attempted; one returned substantial irrelevant results, so conclusions rely on the relevant pages actually retrieved.

Evidence categories used throughout:

- **Observed:** a statement or request visible in a public source. It is still self-reported, not independently verified customer research.
- **Interpretation:** what that statement may imply for purchasing or product design.
- **Hypothesis:** something Scheza must test with recruited owners and actual behaviour.

This is qualitative desk research, not a representative survey. Public identities, team sizes, and locations are often unknown. One discussion explicitly identifies an Ontario family sewer-service business; several useful plumbing discussions are international or of unspecified geography. Electrical and handyman sources are adjacent evidence, clearly identified. No interview was conducted, no customer was contacted, and no Scheza willingness-to-pay result has been established.

Search-intent findings reflect questions people publicly asked. There was no access to their search histories or keyword-volume data. Proposed Google queries below are hypotheses, not measured searches.

## 2. The persona to recruit

### Working persona: the owner who is also the office

| Attribute | Recruiting definition | Status |
|---|---|---|
| Business | Residential plumbing service and repair | Selected focus |
| Geography | GTA first; Ontario more broadly if recruitment is slow | Selected focus |
| Size | Owner plus a small crew, 2–5 people total | Hypothesis to test |
| Owner's work | Still attends jobs and makes operational decisions | Screening requirement |
| Administration | Owner or partner handles it between other responsibilities | Screening requirement |
| Current tools | Paper, notes, spreadsheets, messaging, accounting/invoicing software, or an incompletely adopted field-service tool | Observe, do not assume |
| Trigger | Recent billing delay, disputed extra, missing job information, or painful software change | Evidence to collect |
| Purchase authority | Owner, with possible partner/bookkeeper veto | Hypothesis supported by a billing discussion |

Do not invent age, income, exact truck count, technical ability, or family composition. The PRD's Tim is a useful fictional scenario, not an interviewed customer.

Exclude large commercial/project contractors from the first cohort. Their progress billing, payroll, procurement, and reporting needs can make the product appear to need everything. Also exclude aspiring owners with no operating history from the main validation sample.

Recruit a few satisfied software users as a comparison group. Otherwise the research can only confirm that dissatisfied people exist.

### What is probably going through this owner's head

The following is a **composite interpretation, not a customer quotation**:

I know how to do the plumbing. What wears me down is reconstructing the job afterwards. I need to know what happened, what was agreed, and what I can bill. If a new system means more typing for me or the crew, I will end up back in my notes. Show me one real job working before asking me to move the business.

The emotional themes worth testing are control, professional credibility, confidence that billing is accurate, and less work after the field day. The evidence supports investigating these themes, not claiming every owner feels them.

A partner may see the same problem differently: the technician remembers a conversation, but the person invoicing needs a documented approval. Interview both where possible. [S1, S6]

## 3. What people actually said

These are selected evidence units, not a frequency-ranked market sample. Dates are exact where exposed by the source; relative dates are retained where exact publication dates were unavailable.

| Source and context | Observed complaint or request | Implication and limit |
|---|---|---|
| S1: plumbing owner's spouse, r/smallbusiness, approximately February 2025; location unspecified | Wants invoice tracking, cards, estimate acceptance, approval of extras, reminders, and a trail proving agreement. Bookkeeping is deliberately separate. | Customer approval and scope changes may matter more than generic organization. One household, not a prevalence estimate. |
| S2: Ontario family sewer-service business, 15 August 2024 | Wants dispatch, inventory, invoices/payments and CRM. Reports paying US$420/month for up to 15 users; complaint is lack of Canadian payment integrations. | Local compatibility can outweigh headline price. Larger than the proposed cohort; vendor unnamed. Historical spend, not current market pricing. |
| S3: plumbing business software thread, 20 June 2024 | Original poster uses Jobber and QuickBooks. A commenter manages schedules, callbacks, parts, hours and photos on an iPad without specialist software. Another discusses migration from QuickBooks. | The actual alternatives include familiar low-tech methods and vertical software. Dissatisfaction and satisfaction coexist. |
| S4: solo plumbing startup in Australia, approximately January 2026 | Asks for quotes, jobs and invoices in one flow, low admin, onsite payment, photos/notes, and accounting compatibility. | Strong direct expression of desired workflow; geography and solo-startup stage differ. Promotional replies were not used as corroboration. |
| S5: Colorado plumber operating about 18 months, approximately September 2025 | Asks for better invoicing and expense tracking. Replies include positive experiences with QuickBooks and Jobber. | Need is concrete, but incumbents already solve it for some users. |
| S6: trade-publication account of plumbers' partners, 9 October 2019 | Describes late-night paperwork and family participation in running the business. | Supports investigating the household cost of admin; old, anecdotal, not a time-use study. |
| S7: UK plumber/heating engineer, 27 February 2025 | Describes difficulty estimating, keeping material prices current, sourcing parts, and protecting profit. | A stock-count table would not solve supplier pricing or estimating uncertainty. Geography differs. |
| S8: handyman software discussion, 26 April 2024 | Poster finds Jobber expensive; another says its intake form quickly repays the cost by reducing back-and-forth. | Price resistance is conditional on benefit and business volume. Adjacent trade. |
| S9: electrical project business using Jobber six months, approximately 2025 | Requests easier change orders, billable time, manual reminders, checklists, and fewer spreadsheet workarounds. | Reveals workflow specificity and desire for selective control. Not a plumbing MVP shopping list. |
| S10: Jobber community accounting discussion, approximately March 2026 | Poster describes reconciliation trouble, separate payment links and manual updates. Another customer disagrees; support explains the newer integration's intended behaviour. | Compatibility and setup are purchase risks. This is not proof that Jobber currently has a universal accounting defect. |

Three useful verbatim excerpts:

> “We need something where it basically is a paper trail to say ‘yep you agreed to it on this date, see you signed it’” [S1, Reddit]

> “Quotes → jobs → invoices in one flow” [S4, Reddit]

> “Jobber. Pays for itself quickly.” [S8, Reddit]

The first quote has normalized the inner quotation marks only. These statements point to proof of agreement, fewer handoffs, and visible return on cost.

### An excluded source that matters

A March 2026 thread about a two-person plumbing operation sounded exceptionally relevant: supplier receipts, partially invoiced jobs, poor mobile spreadsheets. On opening it, the author promoted Hardhat Ledger with a referral code. Commenters challenged their inconsistent occupation claims. The same username appears in S4 claiming to be an electrician and recommending the same product. **This thread is excluded as independent customer validation.** It is logged as S13 for transparency, not counted as support for the persona.

Likewise, vendor “best software” lists, affiliate comparisons, and AI receptionist revenue-loss estimates were not treated as proof of customer pain or its financial magnitude.

## 4. Pain points, underlying needs, and buying triggers

Priority below means priority for Scheza's interviews, not measured market frequency.

| Priority | Surface complaint | Underlying job to do | Current workaround to inspect | Trigger to investigate |
|---|---|---|---|---|
| 1 | Billing requires finding or re-entering job details | Finish a job with accurate information ready to bill | Notes, texts, paper work orders, separate invoicing | A recent delayed or incorrect invoice |
| 2 | Customer disputes extras or total price | Prove what was approved before charging | Verbal agreement, texts, revised estimates | A recent dispute or unpaid change |
| 3 | Office and field information do not line up | Make the next action clear to both people | Calls, shared notes, spreadsheets | First employee or partner taking over admin |
| 4 | A tool does not fit payments/accounting | Preserve a dependable money and bookkeeping process | Duplicate invoice links, manual reconciliation | Software change, bookkeeper complaint |
| 5 | Software feels expensive or excessive | Pay for a result the owner uses repeatedly | Basic tools or lower feature tiers | Renewal, growth, or quieter trading |
| 6 | Material estimates are hard to maintain | Quote profitably and buy the right part | Supplier relationships, spreadsheets, research | Margin erosion or wrong-part purchase |
| 7 | Admin occupies family time | Finish the day knowing what still needs attention | Evening catch-up with partner | Work spilling repeatedly into personal time |

Support: priorities 1 and 3 derive primarily from S3–S5; 2 from S1 and adjacent S9; 4 from S2/S10; 5 from S8; 6 from S7; 7 from S6. Their ordering is an analytical recommendation.

There are three different billing problems to separate in interviews:

1. The invoice has not been created because job information is missing.
2. The invoice is ready but not sent because administration is delayed.
3. The invoice was sent but is unpaid or disputed.

An “invoice pending” status does not automatically solve any of them. Each needs a different intervention. Ask for the last actual instance before choosing one.

### A working day to investigate

This is a hypothesized sequence, not an observed day:

- **Before the first call:** owner checks appointments and unfinished work. Can the crew see the latest address and instructions?
- **During the job:** scope changes or a part is needed. Where is approval captured, and who records the cost?
- **Before leaving:** work is complete. Are time, materials, notes and next steps recorded while still fresh?
- **Later that day:** owner or partner prepares billing. What must they ask the technician again?
- **Later in the week:** someone checks unbilled work, disputes and payments. Which cases require judgment rather than an automatic reminder?

Use this only as an interview map. Let the participant redraw it.

## 5. What they are looking for and searching about

### Observed public demand

The retrieved discussions explicitly ask about invoicing/expenses, quoting and billing approvals, software to run a plumbing company, connected quote-to-invoice workflows, Canadian payment compatibility, and pricing jobs profitably. [S1–S5, S7]

They do not establish demand for “generative business operating systems,” database schemas, localized dummy records, or billing by record count. Those may be implementation choices; they are not demonstrated purchase motivations.

### Search-intent hypotheses for interviews and later content tests

| Situation | Candidate query, not measured search data | What a useful answer must deliver |
|---|---|---|
| Ready to choose software | best software for small plumbing business | One real workflow, relevant team size, full cost |
| Wants less invoicing effort | plumbing invoicing app for phone | Quote/job conversion, practical phone steps |
| Billing disputes | customer approval for extra plumbing work | How approval is recorded and retrieved |
| Wants better control | track completed jobs not invoiced | Difference between completed, ready to bill, and sent |
| Canadian fit | plumbing software Canada payments QuickBooks | Region-specific payment and accounting behaviour |
| Price dissatisfaction | Jobber alternative for small plumbing business | Exact missing capability and switching effort |
| Materials and margins | how to track plumbing materials per job | Capture cost against job without reconstruction |
| Migration anxiety | import customers and jobs into new software | What imports, what does not, and how to verify |
| Existing setup failing | Jobber QuickBooks payment reconciliation | Troubleshooting, not necessarily a replacement product |

Do not build SEO strategy around estimated volume from these phrases. First ask owners what they typed, what they clicked, and which sources they trusted. With permission, inspect a recent search or saved comparison. Then obtain geographic keyword-volume evidence separately.

An owner asking “What should I use?” is not necessarily ready to switch. Record whether they have tried a tool, paid for one, exported data, or scheduled implementation.

## 6. What this changes in Scheza's assumptions

| PRD assumption | Research judgment | Next test |
|---|---|---|
| Administrative burden is a meaningful problem | Supported directionally, with limited Ontario specificity | Recent incidents from 10 qualified owners |
| The gap is mainly between spreadsheets and Salesforce/HubSpot | Competitive framing needs revision | Ask unprompted alternatives; include Jobber, Housecall Pro, QuickBooks and familiar notes |
| A generated dashboard supplies the initial value | Not established | Compare a generated workspace with a ready plumbing template on the same real task |
| Local synthetic records cause an “aha” around second 14 | Not established; PRD scenario | Measure comprehension and first real task, not delight alone |
| CSV import should define activation | Plausible for spreadsheet users, too restrictive for others | Compare importing history with entering five current jobs |
| Owners want to stop using messaging entirely | Not established | Measure fewer repeated questions even if messaging remains |
| Crew invitations prove adoption | Insufficient | Observe a technician making useful updates without owner reminders |
| Per-record pricing is perceived as value-based | No supporting evidence found | Compare flat, capped hybrid and pure usage offers with the same workload |
| Canadian localization is a differentiator | Payment fit has direct Ontario evidence; language and residency purchase effects remain unproven | Ask what prevented an actual purchase before showing localization choices |
| Users will trust an autonomous operator after five clean approvals | Not established | Test action-specific controls later; five approvals are not evidence of desired autonomy |
| More stored records mean more customer value | Not necessarily | Measure useful job coverage and less rework; imports alone can inflate record count |
| A broad 1–15-person trades persona is sufficiently narrow | Too broad for first discovery | Use a single trade, job type, team range, and admin setup |

### The important scope mismatch

In the PRD, Tim asks to send invoices. The MVP requirements provide generated tables, editable records, intake forms, collaboration and imports. They do not clearly specify the complete customer invoicing, approval, payment and accounting workflow. Stripe in the MVP bills Scheza subscribers; it does not establish that a plumber can collect customer payments.

The strongest customer requests concern that complete operational process. A dashboard can represent an invoice without creating, delivering or reconciling one. This is the highest-priority product-fit question.

Do not respond by immediately building a full field-service suite. Run a narrow pilot to learn whether the missing job-to-office handoff is valuable by itself. If customers insist on end-to-end billing before they will use Scheza, either narrow the target further or reconsider scope before polishing generation.

### Competitor reality check

Jobber's official documentation describes a request-to-quote-to-job-to-invoice-to-payment flow and Canadian payment availability. Its pricing page separates solo and team plans, billing commitments, and promotions. At retrieval, non-promotional Core pricing included US$49 monthly or US$29/month billed annually; these are not CAD prices. [S11, S12]

Scheza's proposed roughly $29 base fee has an unspecified currency in the PRD. Specify it before any comparison. Low price alone is not a defensible claim when the products perform different work.

The relevant competitive test is: **Which real task becomes easier enough to justify changing habits?** Existing customers sometimes value incumbents highly. Historical complaints and user-reported workarounds should not be presented as verified current missing features.

## 7. Validation with real people

### Sample and recruitment

Start with **10 qualified Ontario owners** for discovery. Within that sample seek five using fragmented/basic tools, three dissatisfied with an existing field-service setup, and two broadly satisfied with their software. These are purposive quotas, not population proportions. Do not pre-screen everyone for an invoicing complaint, which would bias the finding.

Where relevant, add three partner/bookkeeper conversations and observe three field workers. They are additional perspectives, not extra independent businesses.

Recommended recruitment order:

1. Warm introductions through trade-facing bookkeepers, personal contacts, and plumbing supply-counter staff. Ask for introductions to the owner who handles their own admin.
2. Identify local businesses through public listings and their business websites. Confirm the owner works in the field and team size during screening; do not infer it from a van photo.
3. Ask local association or business-group organizers to circulate a research invitation. The MCAC directory is a starting point, but its plumbing category contains many suppliers and larger firms, so it is not a ready-made qualified prospect list. [S14]
4. Use online communities for listening and recruitment only where allowed. r/Plumbing prohibits advertising, and r/HVAC explicitly prohibits surveys/market research. Do not post a research pitch there as if it were an ordinary trade question. [S15, S16]

Offer a fixed **C$40 for a 25-minute research session**, payable regardless of answers or interest in Scheza. Ten owners cost C$400; this is a suggested research budget, not an action taken. A no-cash alternative is a useful one-page map of their current process, with less predictable recruitment response. Keep incentives separate from later payment-validation results.

Invitation draft, not sent:

> Hi [name], I'm Boris, based in Toronto. I'm researching how small plumbing businesses handle the work between finishing a job and sending the invoice. Could you walk me through one recent job in a 25-minute call? I'd like to understand what works and what gets frustrating. There's no demo or sales pitch. I can offer C$40 for your time, whether your process is working well or not. Customer details can stay hidden.

### Screening questions

- What kind of plumbing work makes up most of your jobs?
- How many people work in the business, including you?
- Do you still attend jobs? Who prepares the invoices?
- Which tools do you currently use for jobs, billing and accounting?
- Are you comfortable walking through a recent job with customer details hidden?

### A 25-minute interview

**Minutes 0–3:** role, team, work mix, existing tools. Ask permission before recording; notes are sufficient if they prefer.

**Minutes 3–12:** “Take the most recent job you finished. Walk me through it from the first call until billing.” Follow their sequence. Ask what they entered, where, and who touched it next. Do not introduce Scheza or the word AI.

**Minutes 12–18:** “What went differently from the plan?” “When did you last need to find missing information?” “What happened because of that?” “Can you show me an example with the customer details hidden?” Separate measured time or amounts from estimates. If nothing went wrong, inspect why the process worked.

**Minutes 18–22:** “What have you already tried to improve this?” “What do you pay now?” “What made you keep or stop using it?” “Who else would need to agree to a change?” Ask about actual software searches and purchases.

**Minutes 22–25:** “If you could remove one part of this process, which one?” Then ask whether they would join a separate task walkthrough. Book a specific time if they volunteer interest. Do not count a polite yes as adoption.

Avoid: “Would an AI assistant save you time?”, “Would you pay $29?”, or “Do you hate paperwork?” These invite agreement without revealing a buying decision.

### Assumption tests and precommitted decisions

The following thresholds are proposed small-sample decision rules, not statistical validation or industry benchmarks.

| Hypothesis | Behaviour/evidence | Initial decision rule |
|---|---|---|
| H1: the handoff is a recurring problem | Recent examples and weekly frequency from owners | Continue if at least 6/10 report a specific incident in the past 30 days and at least 4 describe weekly recurrence |
| H2: consequences justify change | Visible rework, billing delay, correction or dispute | At least 4/10 can substantiate a consequence beyond general annoyance |
| H3: owners will try a new process | Follow-through on scheduled task session | At least 4/10 attend and bring redacted examples; count attendance, not invitations accepted |
| H4: a narrow tracker can help without full billing | Pilot alongside existing invoicing | At least 3/5 pilots complete the chosen handoff with less total effort, including duplicate entry |
| H5: the crew will use it | Updates without founder/owner chasing | At least 3/5 pilot businesses have repeated unprompted field updates over two weeks |
| H6: onboarding is practical | First useful task from current records | At least 4/5 can complete it within a 30-minute session; log assistance separately |
| H7: Scheza earns payment | Clearly priced continuation after a useful pilot | At least 2/5 actually purchase; compensation and verbal intent do not count |
| H8: value persists | Continued workflow use after setup novelty | Inspect week-4 use in every pilot; 3/5 continuing is encouraging, not a retention estimate |

If the problem is real but everyone refuses a pilot because existing software already handles it, revise the proposed advantage. If owners test but field workers do not update it, address capture effort before adding intelligence. If billing/integration gaps block three of five pilots, do not market the current MVP as a replacement.

### The pilot task

Use five consenting businesses and one narrowly agreed workflow. Have them identify completed jobs missing information needed for invoicing. They keep their current accounting system. Use real business work only with consent, minimize customer data, and clearly distinguish any founder-performed assistance from product functionality.

Measure a comparable baseline week and pilot period:

- Minutes spent reconstructing each job, including follow-up calls and duplicate entry.
- Time from job completion to invoice-ready information.
- Number of missing-detail requests per completed job.
- Share of eligible jobs with a complete handoff.
- Corrections or missed details introduced by the new process.
- Owner and field-worker actions completed without prompting.

Do not attribute faster customer payment to the tracker without evidence. Separate missing information, invoice sending, and collection outcomes. If volume is low, extend observation instead of treating no incidents as success.

### Pricing test

The PRD compares hybrid usage with pure usage. Add a flat-price alternative so the test can challenge the underlying metering assumption.

Use the same functionality and realistic job volume in each offer. State CAD, included users, exact billable unit, overage and maximum bill. Show a slow, normal and busy month. Ask participants to explain each bill back to you before asking preference. Rotate presentation order.

Probe whether a customer plus job plus invoice counts as three billable records, whether old imported records count, and what happens when a cap blocks new work. The PRD's cap pauses record creation; test whether that conflicts with the product's promise of reduced worry. Preference is weak evidence; a completed purchase at disclosed terms is stronger.

## 8. What to build, say, and measure next

**Before expanding scope:** run the ten interviews, select the recurring bottleneck, and test five businesses on it. Do not commit to plumbing permanently on the basis of this report alone.

**Prototype:** a phone-friendly job completion card, a view of jobs missing billing information, and a clear handoff to whoever invoices. Fields should come from actual examples. If approvals are the dominant problem, test that separately rather than adding it to every job by assumption.

**Compare onboarding:** a prepared plumbing workflow versus the generated version. Give both the same redacted job and assess task completion, errors, owner effort, and preference after use. A small pilot informs direction; it cannot establish a precise conversion lift.

**Messaging concept to test:** “See which completed jobs still need information before you invoice.” Use it only if the prototype can do that reliably. The broader “get your evenings back” promise requires measured evidence of reduced work.

**Revise the learning metrics:** keep import rate as one measure, but add first useful job, complete handoff rate, reduced reconstruction time, repeated use, and paid continuation. A spreadsheet user and a paper-based owner need different onboarding routes.

Keep the original PRD unchanged until the behavioural evidence supports an edit. In particular, current research does not justify treating localized demo data, record-based pricing, bilingual UI, Canadian hosting, or future autonomy as the main reason this persona will buy.

## 9. Interview evidence template

Copy one entry per business. Leave unknowns blank rather than estimating.

| Field | Record |
|---|---|
| Anonymous business ID / interview date | |
| Location, work mix, team size, admin role | |
| Tools and actual current spend, with currency | |
| Last completed job: sequence and handoffs | |
| Recent incident, date, frequency | |
| Artifact observed, with consent | |
| Time impact: measured or participant estimate | |
| Money impact: documented, estimate, or unknown | |
| Exact customer language | |
| Existing workaround and why it survives | |
| Previous solution tried and reason stopped | |
| Actual searches and sources trusted | |
| Buyer, approver, user, possible veto | |
| Disconfirming evidence / process that already works | |
| Follow-up commitment and whether completed | |
| Pilot outcome and actual paid continuation | |

## Source register

All accessed 27 September 2026. “Opened” means the original page content was retrieved. Source dates should not be confused with crawl dates. Anonymous posts remain unverified self-reports. S13 is excluded from positive evidence.

| ID | Source | Geography / type / date | Evidence treatment |
|---|---|---|---|
| S1 | [Billing software for husband's plumbing business](https://www.reddit.com/r/smallbusiness/comments/1ijj3kn/looking_for_a_billing_software_recommendation_for/) | Unspecified; firsthand family-business request; approximately Feb 2025 | Opened; useful specific requirements |
| S2 | [Ontario plumbing and sewer-service software question](https://www.reddit.com/r/Plumbing/comments/1et7p98/industry_question_for_plumbing_sewer_service/) | Ontario; family-business representative; 15 Aug 2024 | Opened; local evidence, larger team |
| S3 | [Business owners: plumbers](https://www.reddit.com/r/Plumbing/comments/1dkku04/business_owners_plumbers/) | Unspecified; operator discussion; 20 Jun 2024 | Opened; existing alternatives and counterevidence |
| S4 | [Solo plumbing setup: ServiceM8 and Xero](https://www.reddit.com/r/Plumbing/comments/1qnu087/solo_plumbing_business_setup_servicem8_xero_or/) | Australia; startup owner; approximately Jan 2026 | Opened; original post used, promotional reply excluded |
| S5 | [Invoicing and expense tracking](https://www.reddit.com/r/Contractor/comments/1nb8fam/invoicing_and_expense_tracking/) | Colorado; plumber; approximately Sep 2025 | Opened; problem statement and positive incumbent experiences |
| S6 | [You Know You're a Plumber's Wife When…](https://www.phcppros.com/articles/10264-you-know-youre-a-plumbers-wife-when) | Trade publication; personal/collected anecdotes; 9 Oct 2019 | Opened; old qualitative context, not survey data |
| S7 | [Pricing jobs](https://ukplumbersforums.co.uk/threads/pricing-jobs.132106/) | UK; plumber/heating engineer discussion; relevant reply 2approximately Feb 2025 | Opened; materials and quoting difficulty |
| S8 | [Handyman software discussion](https://www.reddit.com/r/handyman/comments/1cdpqmx/software/) | Unspecified; adjacent trade; 26 Apr 2024 | Opened; price complaint plus opposing value experience |
| S9 | [Requests, six months in](https://community.getjobber.com/discussions/team-management/requests-6-months-in/6071) | Electrical projects; vendor-hosted customer forum; page says about 1 year ago | Opened; specific workarounds, not current feature audit |
| S10 | [Accounting problems with Jobber Payments](https://community.getjobber.com/discussions/invoicing-getting-paid/accounting-problems-with-jobber-payments/8853) | Construction/general contracting tags; vendor-hosted forum; replies about 6 months ago | Opened; complaint, conflicting customer experience, and support clarification retained |
| S11 | [Jobber pricing](https://www.getjobber.com/pricing/) | Official vendor; current snapshot | Opened; currencies and billing terms checked |
| S12 | [Jobber Core plan](https://help.getjobber.com/en/articles/the-core-plan/) | Official vendor documentation; current snapshot | Opened; workflow and Canadian payment availability only |
| S13 | [Two-person plumbing operation](https://www.reddit.com/r/Plumbing/comments/1rsc332/running_a_twoman_plumbing_operation_how_do_you/) | Claimed plumbing; 13 Mar 2026 | Opened; excluded because of referral promotion and conflicting occupational claims |
| S14 | [MCAC plumbing directory](https://members.mcac.ca/member-directory/Search/plumbing-606605?cid=606644) | Canada; association directory | Opened; recruitment discovery only, mostly not qualified small contractors |
| S15 | [r/Plumbing rules](https://www.reddit.com/r/Plumbing/) | Community rules; current snapshot | Retrieved; advertising prohibited |
| S16 | [r/HVAC rules](https://www.reddit.com/r/HVAC/) | Community rules; current snapshot | Retrieved; surveys/market research prohibited |

**What remains unvalidated:** Ontario prevalence and severity, exact buyer and team fit, willingness to change workflows, data readiness, willingness to pay Scheza, acceptable pricing model, useful integration boundary, and sustained retention. The next evidence must come from real tasks and commitments by qualified businesses.
