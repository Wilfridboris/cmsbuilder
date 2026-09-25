# Next.js and Cloudflare Deployment Guide

This document captures a discussion regarding deploying Next.js and various applications on Cloudflare, highlighting platform capabilities and free-tier limits.

---

## 1. Deploying a Next.js Application on Cloudflare

You can deploy a Next.js application on Cloudflare using one of two primary methods depending on whether you need a full-stack environment or a static site export.

### Option 1: Full-Stack Deployment (Cloudflare Workers)
This method supports Server-Side Rendering (SSR), React Server Components (RSC), API routes, and Middleware by converting your Next.js build output into a format compatible with Cloudflare’s Edge runtime using the `@opennextjs/cloudflare` adapter.

#### Method A: Starting a New Project from Scratch
```bash
npm create cloudflare@latest -- my-next-app --framework=next --platform=workers
```

#### Method B: Adding Cloudflare to an Existing Project
1. **Install dependencies**:
   ```bash
   npm install @opennextjs/cloudflare
   npm install --save-dev wrangler
   ```
2. **Add build scripts to `package.json`**:
   ```json
   "scripts": {
     "dev": "next dev",
     "build": "next build",
     "start": "next start",
     "cloudflare-build": "opennextjs-cloudflare build",
     "preview": "npm run cloudflare-build && opennextjs-cloudflare preview",
     "deploy": "npm run cloudflare-build && wrangler deploy"
   }
   ```
3. **Initialize Wrangler configuration** by creating a `wrangler.jsonc` or `wrangler.toml` file in your root directory.
4. **Deploy**:
   ```bash
   npx wrangler login
   npm run deploy
   ```

### Option 2: Static Site Export (Cloudflare Pages)
If your application is entirely static and does not use server-side runtime operations, you can deploy it directly via Git integration.
1. **Configure for static export** in `next.config.js`:
   ```javascript
   /** @type {import('next').NextConfig} */
   const nextConfig = {
     output: 'export',
   };
   module.exports = nextConfig;
   ```
2. **Push code to GitHub or GitLab**.
3. **Connect to Cloudflare Dashboard**: Navigate to **Workers & Pages** > **Create Application** > **Pages** > **Connect to Git**, select your repository, and set **Next.js (Static HTML Export)** as your framework preset.

---

## 2. Other Applications Supported by Cloudflare

Cloudflare hosts a vast ecosystem of applications across **Cloudflare Workers** and **Cloudflare Pages**:

* **Frontend Frameworks & SPAs:** Remix, Nuxt, SvelteKit, Astro, SolidStart, QwikCity, React, Vue, Angular, Vite, Hugo, Jekyll, Eleventy.
* **Backends, APIs, & Microservices:** Lightweight REST & GraphQL APIs using frameworks like Hono, Elysia, or Itty Router; Python backends via FastAPI or Flask; Webhooks and background CRON tasks.
* **Full-Stack Applications with Storage:** Database-driven apps powered by Hyperdrive (Postgres accelerator), D1 (native SQL), Durable Objects (real-time WebSockets), KV (Key-Value), and R2 (Object Storage).
* **AI & Machine Learning Workloads:** Edge AI chatbots and vector engines powered by Workers AI and Vectorize.

---

## 3. Cloudflare's Free Tier Offerings

Cloudflare provides a permanently free developer tier with **\$0 data bandwidth/egress fees**, making it highly resilient against unexpected high-traffic billing.

### Cloudflare Pages (Free Tier)
* **Bandwidth:** Unlimited & Free
* **Builds:** Up to 500 builds per month (1 active build at a time)
* **Custom Domains:** Up to 100 custom domains per project
* **Security:** Free automatic SSL certificates and unmetered DDoS protection

### Cloudflare Workers (Free Tier)
* **Requests:** 100,000 requests per day (resets daily at midnight UTC)
* **CPU Execution:** Up to 10ms of CPU time per request (excludes time spent waiting for external API/DB fetch)
* **Scale:** Up to 100 different worker scripts per account

### Storage & Databases (Free Tier)
* **D1 (SQL Database):** 5 Million row reads and 100,000 row writes per day
* **R2 (Object Storage):** 10 GB of storage with 1M write / 10M read operations per month
* **KV (Key-Value):** 1 GB of storage with 100,000 read operations per day
* **Workers AI:** Access to open-source models with a daily quota of free compute units