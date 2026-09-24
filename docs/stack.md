This `STACK.md` document outlines the exact architecture for **DashForge** designed to keep your monthly infrastructure costs at **$0 (or pennies)** while you build, launch, and acquire your first 100 customers. 

To achieve a $0 cost, we must abandon traditional "always-on" servers (like AWS EC2) and use **Serverless & Edge Computing**. You will only use generous "Free Tiers" that scale automatically.

---

# STACK.md: The $0 MVP Architecture

**Core Philosophy:** *Do not pay a single dollar until the user pays you.* The only unavoidable cost will be the AI API calls, which cost fractions of a cent per prompt.

## 1. Frontend & Deployment (Cost: $0/month)
**Tech:** Next.js + Tailwind CSS + shadcn/ui
**Host:** Vercel (or Cloudflare Pages)
*   **Why Next.js:** It allows you to write your frontend (the dashboard) and backend (API routes) in the exact same codebase. 
*   **Why Vercel:** Vercel’s "Hobby" tier is 100% free. It includes serverless function execution, free SSL certificates, and fast edge deployment. 
*   **The Zero-Cost Hack:** Vercel allows you to map custom domains on their free tier. You can host the main `dashforge.ca` app for free.

## 2. Database & Storage (Cost: $0/month)
**Tech:** Supabase (Serverless PostgreSQL)
*   **Why Supabase:** Supabase gives you a massive free tier: 500MB of database space, 1GB of file storage (for user image uploads), and 50,000 active monthly users. 
*   **The "Generative" Advantage:** Supabase has a built-in feature called **PostgREST**. This means when your AI creates a new database table (e.g., `Invoices`), Supabase *instantly and automatically* generates an API endpoint for it. You don't have to write backend code to make the new table work.
*   **Location Note:** On the free tier, you can still select the **Canada (ca-central-1)** region, ensuring you remain PIPEDA compliant at no cost.

## 3. Authentication (Cost: $0/month)
**Tech:** Supabase Auth
*   **Why:** Included in your Supabase free tier. It supports "Magic Links" (passwordless login via email) right out of the box. You do not need to pay for Auth0 or Clerk.
*   **Limit:** Free for up to 50,000 Monthly Active Users (MAU). You will be making thousands of dollars a month before you ever hit this limit.

## 4. Custom Domains & Routing for Users (Cost: $0/month)
**Tech:** Cloudflare for SaaS (Free Tier)
*   **The Challenge:** If a user wants to connect their own domain (e.g., `timshvac.ca`) to your platform, managing SSL certificates usually costs money.
*   **The Zero-Cost Hack:** Cloudflare offers a feature called **"Cloudflare for SaaS"**. They allow you to route up to **100 custom hostnames for free**. You can automatically provision SSL certificates for your users' domains without paying a dime. 

## 5. The AI Engine (Cost: ~$1 to $5/month total)
**Tech:** OpenAI API (GPT-4o-mini) OR Groq (Llama 3)
*   You cannot host a smart LLM for free. However, API costs are strictly pay-per-use.
*   **Option A (Extreme Budget - $0):** Use **Groq's API** running the open-source `Llama-3-70b` model. Groq currently has an incredibly generous free tier for developers. It is lightning-fast and capable enough to generate JSON database schemas.
*   **Option B (Best Quality - ~$2/month):** Use **OpenAI's `gpt-4o-mini`**. It is incredibly cheap. Generating a full database schema will cost about $0.001 per prompt. If you get 1,000 users testing your app, your AWS bill would be $0, and your OpenAI bill would be about $1.00.

---

## The MVP "Data Flow" (How it works together)

1.  User goes to `dashforge.ca` (Hosted on **Vercel** - $0).
2.  User types: *"I need a roofing app."*
3.  Vercel sends the prompt to **OpenAI `gpt-4o-mini`** (Cost: $0.001).
4.  OpenAI returns a JSON schema for a roofing business.
5.  Vercel takes the JSON and executes a SQL query on **Supabase** (Hosted in Canada - $0).
6.  Supabase instantly creates the tables.
7.  Vercel generates the UI using **shadcn/ui** components mapping to the new Supabase tables.
8.  User claims the app via **Supabase Auth** magic link ($0).

---

## 💰 Total Estimated Monthly Cost Summary

| Service | Plan | Monthly Cost | Capacity |
| :--- | :--- | :--- | :--- |
| **Vercel** | Hobby Plan | **$0.00** | 100GB Bandwidth, unlimited API requests. |
| **Supabase** | Free Tier | **$0.00** | 500MB Database, 50,000 Users, Canada Region. |
| **Cloudflare** | Free + SaaS Add-on | **$0.00** | DDoS Protection + 100 User Custom Domains. |
| **OpenAI API** | Pay-as-you-go | **~$2.00** | 2,000 App Generations (using gpt-4o-mini). |
| **Resend** | Free Tier | **$0.00** | 3,000 Emails/month (for Magic Links). |
| **GitHub** | Free Tier | **$0.00** | Code Hosting and Actions (CI/CD). |
| **Domain Name**| GoDaddy/Namecheap | **~$1.50** | Appx $15-20/year for `dashforge.ca`. |

**Total Startup Infrastructure Cost:** **$2.00 / month.**

---

### When do you finally have to pay? (The Scaling Point)
You will only need to pull out your credit card and upgrade to paid tiers when:
1. You exceed 500MB of pure text data in your database (Supabase Pro is $25/mo). *Note: 500MB is enough to hold tens of thousands of invoices/records.*
2. You have more than 100 paying customers using custom domains (Cloudflare).
3. You need team collaboration (Vercel Pro is $20/mo per developer).

By using this serverless stack, your server costs scale linearly with your success. If the app goes viral, the servers auto-scale. If the app gets zero traffic on a Tuesday, you pay exactly $0.