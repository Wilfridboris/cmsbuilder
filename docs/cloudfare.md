# Product Requirements Document (PRD)

## 1. Project Overview & Objectives
The goal of this project is to architect and build a high-performance, cost-efficient, enterprise-ready corporate website using the **Astro Web Framework** deployed natively on **Cloudflare Workers**. The infrastructure leverages Cloudflare's serverless edge computing primitives (**D1 SQL Database** and **R2 Object Storage**) to maximize global page speed, minimize operating overhead, and achieve exceptional search engine and AI agent discoverability.

## 2. Target Technical Stack
*   **Frontend Framework:** Astro (Component-driven, hybrid Server-Side Rendering)
*   **Serverless Runtime:** Cloudflare Workers (V8 Isolate architecture)
*   **Database Layer:** Cloudflare D1 (Serverless, globally distributed SQLite)
*   **Asset Storage:** Cloudflare R2 (S3-compatible, zero egress fee object storage)
*   **Local Tooling:** Wrangler CLI

## 3. Infrastructure & Architecture Design

```
  [ User / AI Bot ]
         │
         ▼  (Request intercepted at nearest Edge data center)
 ┌─────────────────────────────────────────────────────────┐
 │                  CLOUDFLARE WORKERS                     │
 │  • Executes Astro server-side code instantly            │
 └───────┬─────────────────────────────────────────┬───────┘
         │                                         │
         ▼ (Fetch dynamic text/user data)          ▼ (Fetch images/large files)
 ┌────────────────────────┐               ┌────────────────────────┐
 │      D1 DATABASE       │               │       R2 STORAGE       │
 │  • Edge SQL Database   │               │  • Assets & Downloads  │
 │  • Ultra-low latency   │               │  • Zero egress fees    │
 └────────────────────────┘               └────────────────────────┘
```

### 3.1 Framework Capabilities
*   **Zero-JS by Default:** Astro strips out client-side JavaScript, rendering lean machine-readable HTML perfect for semantic indexing by LLM scrapers.
*   **Edge Image Service Integration:** Leverages the `@astrojs/cloudflare` adapter to execute on-the-fly responsive image resizing and format conversion (WebP/AVIF) directly at the network edge using Cloudflare's Transform via Fetch API.
*   **Layout Shift Prevention:** Integrated `<Image />` components natively apply strict dimensions and asynchronous decoding to eliminate Cumulative Layout Shift (CLS).

### 3.2 Storage & Computing Matrix
*   **Cloudflare Workers:** Acts as a globally replicated middleware running edge logic with sub-5ms boot times (eliminating container cold starts).
*   **D1 Database:** Distributed relational storage optimized for read-heavy operations like corporate blogs, dynamic inventory grids, and structured layout templates.
*   **R2 Storage:** Retains large media files, team portraiture, and document downloads without billing for bandwidth consumption.

## 4. Financial & Tiering Metrics

| Service Components | Free Tier Volume Limitations (Per Month / Day) | Scale Breakpoints (Workers Paid Plan - $5/mo) |
| :--- | :--- | :--- |
| **Cloudflare Workers** | 100,000 requests / day | 10 Million requests / day |
| **Cloudflare D1 DB** | 5M reads & 1M writes / mo (5 GB Storage) | Highly scalable metered overages |
| **Cloudflare R2** | 10 GB Storage, 1M read ops, 100k write ops / mo | $0.015 / GB storage (Zero egress fees) |

## 5. Deployment Configurations

### 5.1 Project Initialization
To bootstrap the production structure, initialize via the Cloudflare framework wizard:
```bash
npm create cloudflare@latest -- my-astro-site --framework=astro
```

### 5.2 Production Environmental Bindings (`wrangler.toml`)
```toml
#:schema node_modules/wrangler/config-schema.json
name = "company-production-site"
compatibility_date = "2024-04-03"
pages_build_output_dir = ".astro"

[[d1_databases]]
binding = "DB"
database_name = "production-db"
database_id = "your-cloudflare-d1-database-id"

[[r2_buckets]]
binding = "BUCKET"
bucket_name = "production-assets"
```

## 6. Structural Implementation Constraints
1.  **V8 Script Size Cap:** The final compiled Astro server bundle must remain strictly under **10MB** on standard plans. Avoid embedding heavy node packages or processing libraries.
2.  **Relational SQL Constraints:** Data schemas must adhere to SQLite limitations. Complex enterprise multi-table mutations should evaluate indexing patterns early.
3.  **Local Image Mocking:** Local development tools (`wrangler dev`) execute low-fidelity image proxying. Final multi-format edge caching must be audited post-deployment.

## 7. Launch Profile vs North-Star (added 2026-10-06)

This document describes the **north-star Cloudflare stack** (D1 + R2 + hybrid SSR) for a content-rich corporate site. The **Scheza marketing launch** deliberately uses a lighter profile, so the two don't conflict:

| Dimension | North-star (this PRD) | Launch profile (`scheza-marketing-v1`) |
| :--- | :--- | :--- |
| Rendering | Hybrid SSR | **Static** (`output: "static"`) |
| Database | D1 | **None** — leads go to **Resend Contacts** |
| Object storage | R2 | **None** — assets shipped as static files in `public/` |
| Server code | Astro SSR on Workers | **One** Worker route: `/api/waitlist` |

**Adopt D1 when:** the PersonaPress blog (FR-16/17) or dynamic content lands. **Adopt R2 when:** large media/downloads (demo video, PDF invoices from the calculator, FR-7/8) ship. Until then the static profile is the correct, cheaper, faster choice for a pre-launch landing page. See `sprint-change-proposal-2026-10-06.md` and the marketing `ARCHITECTURE-SPINE.md` "Launch Profile (v1)" section.
