# Sprint Change Proposal — Marketing Site on Cloudflare (v1 canonical)

- **Date:** 2026-10-06
- **Author:** Boris (PM) with BMad Correct-Course
- **Project:** Scheza Marketing Site (`scheza.com`)
- **Scope classification:** Moderate (backlog reorganization + PRD MVP re-baseline; product vision intact)
- **Mode:** Incremental (each edit approved individually)

---

## Section 1 — Issue Summary

The marketing site is to be built **completely on Cloudflare**, using **`scheza-marketing-v1`** and **`scheza-brand-kit`** as the template for look, design, and assets ("it should look the same"), live at **`scheza.com`**, with the existing app at **`app.scheza.com`** (Next.js on Vercel, unchanged).

Discovery: two decoupled marketing codebases exist on disk, both git-ignored by the app per architecture AD-12 / NFR-8:

- **`scheza-marketing/`** (Sep 28) — has its own `.git`; built on the **retired navy/blue/cyan `docs/visual.png`** brand; only Hero/Header/Footer; planned EN/FR + Supabase/Turnstile. Stories **1-1** and **1-2** were completed against it.
- **`scheza-marketing-v1/`** (Oct 4) — no git yet; on the **correct `scheza-brand-kit`** brand (Ink `#342350` / Apricot `#FFC69A` / Vermilion `#D94B35`, Manrope+Inter); full landing section set; privacy/terms/404; security + axe a11y CI gates; and the **two-mode hero keyed on `PUBLIC_APP_URL`** that already implements the `scheza.com -> app.scheza.com` split.

Two problems follow: (a) the documented plan still names the **stale navy brand** as authoritative, and (b) the realized `v1` build is a **lean landing + waitlist** that is narrower than the marketing **PRD** (calculator, EN/FR, blog, referral, taste-of-magic preview). `cloudfare.md` additionally describes a heavier **D1+R2+SSR** stack than `v1`'s static-first approach.

**Evidence:** `epics-marketing-site.md` frontmatter names `docs/visual.png` (navy/blue/cyan) as "AUTHORITATIVE"; `scheza-marketing-v1` file tree (14 section components + `@theme` brand tokens + `public/brand/**`); `sprint-status-marketing-site.yaml` showing 1-1/1-2 `done`; the brand-kit README defining the Ink/Apricot identity.

---

## Section 2 — Impact Analysis

**Epic impact**
- **Epic 1 (conversion core):** re-baselined. `v1` realizes 1-1 (scaffold), 1-2 (Resend lead capture), and most of 1-3 (hero+waitlist), 1-5 (positioning), 1-6 (SEO/a11y baseline). **1-4 taste-of-magic preview** is not in v1 → deferred. New **Story 1-0** added: promote v1 into `scheza-marketing` and deploy.
- **Epics 2–5** (examples/testimonials, calculator, referral/pilot, blog): intent unchanged, **deferred** to a post-launch roadmap, re-mapped onto v1's architecture.

**Artifact conflicts**
- **PRD (marketing):** launch MVP shrinks to FR-2/FR-3/FR-18 + NFR-1/2/4/7. FR-1/4/5/6/7/8/9/10/11/12/13/15/16/17 and NFR-5 deferred. The **Supabase ca-central-1** store in NFR-8 was already superseded by the spine's **Resend Contacts, no-database** decision — v1 follows the spine.
- **Architecture spine:** paradigm (static-first + Resend + no DB) is **already aligned** with v1. Real launch deltas: **AD-10 Turnstile** and **AD-9 full CASL witnessed consent** not in the launch cut; **NFR-5 EN/FR** deferred. No D1/R2 at launch.
- **UI/UX:** no UX contract existed; `scheza-brand-kit` becomes the design source of truth (retires `docs/visual.png`). Net positive.
- **Other:** `cloudfare.md` reconciled (north-star vs launch profile); two sprint-status files; two completed stories annotated; `.gitignore` already correct.

**Technical impact:** promotion is a content move into an existing decoupled repo + a Cloudflare Workers deploy with Resend secrets and `PUBLIC_APP_URL`. No change to the Next.js app or its Vercel project.

---

## Section 3 — Recommended Approach

**Hybrid: Direct Adjustment + PRD MVP Review.** Keep v1's superior implementation (no code rollback); re-baseline the *plan* to match it; trim the launch MVP and defer the rest to a roadmap.

- **Rejected — full rollback:** would discard the polished, on-brand v1. Not justified.
- **Rejected — hold launch for full PRD scope:** delays a live `scheza.com` for months with no conversion benefit pre-launch.
- **Chosen — ship v1 lean now, defer the rest:** fastest path to a live, on-brand, decoupled site; preserves all prior work; honors the architecture spine.

**Decisions locked (by PM):** (1) promote v1 into `scheza-marketing`; (2) ship lean, defer calculator/EN-FR/blog/referral; (3) Resend-only at launch, Supabase/Turnstile/CASL deferred; (4) incremental review.

**Effort:** Low–Medium (promotion + deploy + copy TODOs). **Risk:** Low, with one accepted interim risk below. **Timeline:** days, not weeks, to a live site.

**Accepted interim risk:** at launch, lead capture has **no Turnstile** and **no full CASL witnessed-consent** record (rate-limiting + server-side validation only). Constraint: **public copy must not assert Canadian data residency or CASL-compliant consent** until that path lands.

---

## Section 4 — Detailed Change Proposals

All seven applied 2026-10-06:

1. **`epics-marketing-site.md`** — brand pointer `docs/visual.png` → `scheza-brand-kit`; course-correction banner (canonical code, domains, launch profile, deferrals); Story 1.1 brand AC rewritten to Ink/Apricot + Manrope.
2. **marketing `prd.md`** — new §0.1 "Launch Profile v1": ships-at-launch set, deferred roadmap, interim lead-capture risk, Supabase→Resend reconciliation.
3. **`ARCHITECTURE-SPINE.md`** — new "Launch Profile (v1)" section: canonical code, static/no-D1-R2, brand-kit, honored vs deferred invariants (AD-10/AD-9/NFR-5).
4. **`sprint-status-marketing-site.yaml`** — course-correction header; brand ref fixed; new `1-0` story `ready-for-dev`; 1-3/1-5/1-6 → `review` (realized by v1); 1-4 → deferred.
5. **Stories `1-1` and `1-2`** — course-correction addenda (brand corrected; EN-only; Turnstile + CASL deferred) appended outside the frozen Intent.
6. **`docs/cloudfare.md`** — new §7 "Launch Profile vs North-Star": D1/R2/SSR = north-star; static/Resend = launch; triggers to adopt D1 (blog) and R2 (media/PDF).
7. **New story `1-0`** — "Promote scheza-marketing-v1 to canonical and deploy to Cloudflare" with full AC (promotion, brand-kit, `PUBLIC_APP_URL` two modes, CI gates, deploy, copy constraint).

---

## Section 5 — Implementation Handoff

**Scope: Moderate → Product Owner / Developer.**

- **PM/PO:** owns the re-baselined PRD §0.1, epics banner, and sprint-status. Accepts 1-3/1-5/1-6 against the brand-kit (move `review` → `done` once verified in the promoted repo). Owns the deferred roadmap (Epics 2–5, 1-4, Turnstile/CASL, EN/FR).
- **Developer:** executes **Story 1-0** — promote v1 into `scheza-marketing`, retire the navy build, set `PUBLIC_APP_URL=https://app.scheza.com`, resolve `TODO(pricing)`/`TODO(legal)`, run `npm run ci`, deploy to Cloudflare Workers, set Resend secrets.

**Success criteria:** `scheza.com` live on Cloudflare, on the brand-kit brand, all CI gates green, `/api/waitlist` capturing to Resend, hero linking to `app.scheza.com`, and no residency/consent claims in public copy. Parent app untouched.

**Next deferred stories to schedule post-launch:** Turnstile + CASL witnessed consent; EN/FR i18n (NFR-5); then Epics 5/3/4/2 per the recommended sequence.
