# Dunamis

Multi-gym SaaS CRM: members, customizable plans, weekly check-ups, AI workout/diet plans with
member preview links, expiry reminders, leads, finance, analytics and data import.

| Part | Stack |
|---|---|
| `frontend/` | Next.js 15 (App Router, TypeScript), shadcn/ui (Base UI + Tailwind v4), TanStack Query, React Hook Form + Zod, typed client via openapi-fetch |
| `backend/` | FastAPI, SQLAlchemy 2 (async), Alembic, Pydantic v2, JWT auth (httpOnly cookies) |
| Data | PostgreSQL 16 in Docker/production; SQLite for local dev without Docker. Redis for background jobs (upcoming). |

## Status

**Phase 1: foundation (done)**
- Gym signup creates the gym (tenant), a main branch and an owner account.
- Login, refresh, logout and gym switching.
- Roles: owner, manager, trainer and front desk.
- Gym settings, including membership expiry reminder timing.
- Branches.
- Staff invites by shareable link, with role and branch management.
- Tenant isolation: every tenant query goes through `TenantRepository`, and tests prove one gym can't read or change another's data.

**Phase 2: plans & members (done)**
- **Custom plan builder:**
  - Any duration in days, weeks, months or years, with price, joining fee, tax %, included services and allowed freeze days.
  - Archive or restore a plan. Only plans that were never sold can be deleted.
- **Member onboarding:**
  - Profile, emergency contact, fitness profile (goal, diet, experience, height, medical notes), trainer, branch and tags.
  - Optionally sell the first membership in the same step, with a live price and end-date preview.
- **Membership lifecycle:**
  - Renew: the next membership starts the day after the current one ends, and the joining fee only applies to the first.
  - Freeze and unfreeze: the end date moves by the frozen days, and later renewals move with it.
  - Cancel.
  - Overlapping memberships are rejected. Plan terms are copied into each membership, so editing a plan never rewrites history.
- **Statuses** (active, expiring soon, frozen, upcoming, expired, no plan) are computed from "today" in the gym's own time zone.
- **Members list:** status tabs with counts, search by name, phone or email, trainer, branch and tag filters, sorting and pagination.
- **Dashboard:** member stats and a "renewals due" list.
- **Member preview links:** each member already gets a private link token (copy, share on WhatsApp, regenerate). The page it opens comes in phase 5.

**Phase 3: membership expiry reminders (done)**
- **Settings:** the owner picks the reminder days (e.g. 7, 3 and 1 days before, on the day, 3 days after) and a send hour in the gym's time zone. They can also edit the message templates, with `{placeholders}` and a live preview.
- **Automatic email:**
  - Members with an email address get reminders automatically.
  - Members who already renewed are skipped.
  - Every send is recorded in `reminder_logs`, which has a unique key per membership, reminder day and channel. A send is claimed before it is sent, so the job can run hourly, or on several machines, without double-sending.
  - Failed sends are logged, and **Send emails now** retries them.
- **WhatsApp:** the **Reminders → Due** list has a one-click WhatsApp button with the message prefilled. Staff send it from their own WhatsApp, and the app logs it. The WhatsApp Business API comes later.
- **Staff alerts:**
  - A daily digest notification goes to owners, managers and the front desk via the header bell.
  - The sidebar badge counts reminders nobody has sent yet.
  - The History tab shows every send.

**Phase 4: check-ups & progress (done)**
- **Check-ups:** weight, body fat %, muscle mass, height (keeps the profile's height up to date), automatic BMI, chest/waist/hips/arm/thigh measurements and trainer notes. One check-up per member per day. Whoever recorded a check-up can edit it; managers and owners can edit any.
- **Progress photos:** up to 4 per check-up, JPEG, PNG or WebP, max 8 MB.
  - The file type is checked from the file's contents, not the name it was uploaded with.
  - Stored privately: on local disk in dev, or in S3 or Cloudflare R2 in production.
  - Only served through a check-up photo endpoint that checks the viewer's gym, never from a public URL.
  - Deleting a photo, check-up or member also deletes the stored files.
- **Member Progress section:** stat tiles with the change since the first check-up, a chart per metric, history and a photo viewer.
- **Check-ups page:** members with a running membership who are due (owner-set interval, default 7 days), longest waiting first, with a "My members" filter for trainers.

Storage settings: `STORAGE_PROVIDER=local` (`STORAGE_DIR`, default `./uploads`) or `s3` (`S3_BUCKET`, `S3_REGION`, `S3_ENDPOINT_URL` for R2/MinIO, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`).

**Phase 5: AI plans & member page (done)**
- **AI plans:** trainers pick days per week, session length, equipment and extra instructions. Claude (`claude-opus-5-5`) writes a structured 4-week workout and diet plan.
  - **Inputs:** the member's age, sex, goal, diet preference, experience, medical notes (treated as hard constraints) and recent check-ups.
  - **Never sent:** name, phone or email.
  - **Request details:** structured output via a Pydantic schema, explicit effort, a cached system prompt, and a server-side refusal fallback. Refusals and API errors become clear messages for staff.
  - **Runs in the background:** the UI polls until the plan is ready. There's a monthly quota per gym (`AI_MONTHLY_PLAN_LIMIT`).
- **Review before members see it:**
  - Every plan is a draft until a trainer reviews it in the editor (workouts, exercises, meals, macros, notes) and publishes it.
  - Plans are versioned. Publishing a new version archives the old one, and published plans can be unpublished.
- **Member page `/p/{token}`:** a private, mobile-friendly page for the member.
  - Shows membership status and dates, their trainer, a "call the gym" button, progress (weight chart) and the published plan.
  - No login needed, rate-limited, not indexed by search engines, no referrer sent.
  - Never shows internal IDs, contact details or photos.
  - Staff can copy the link, send it on WhatsApp, replace it, or turn it off.

AI settings: `ANTHROPIC_API_KEY` (required to generate), `AI_MODEL` (default `claude-opus-5-5`), `AI_EFFORT` (default `medium`), `AI_MONTHLY_PLAN_LIMIT` (default 100). Roughly 3K input and 5K output tokens per plan, so about $0.10–0.15 each at Opus 5.5 prices.

**Phase 6: leads pipeline (done)**
- **Leads:** each has a source (walk-in, phone, Instagram, Facebook, Google, referral, website), an interest, the plan they asked about, an assigned person, a next follow-up and notes. Duplicate open leads with the same phone number are blocked.
- **Board:** a drag-and-drop Kanban board (New → Contacted → Trial booked → Trial done, plus Lost). There's also a list view, filters (mine, unassigned, source, follow-ups due) and stats (open leads, follow-ups due, 30-day new and joined, 90-day conversion rate). Moving a lead to Lost asks why; booking a trial takes an optional trial time.
- **Lead panel:** call and WhatsApp buttons, a stage switcher, and a timeline. You can log calls, WhatsApps, visits and notes with the next follow-up in one step. Logging contact with a new lead moves it to Contacted.
- **Convert to member:** creates the member from the lead, optionally selling the first membership, and opens the new member.
- **Website enquiry form** (`/join/{token}`):
  - A public form you can link from your website or Instagram. It's rate-limited and has a hidden honeypot field to catch spam bots.
  - Repeat enquiries from the same phone are added to the existing lead.
  - Staff get a notification for each new enquiry.
  - Turn it on or off and issue a new link from **Leads → Website form**.
- **Daily follow-up alerts:** each assigned staff member gets a notification for their due follow-ups. Owners and managers get one for unassigned leads. The sidebar badge counts due follow-ups.

**Phase 7: finance (done)**
- **Payments:**
  - Record money against a membership (cash, UPI, card, bank transfer, cheque or other, with a reference) or for something else, such as PT or merchandise.
  - Payments can be partial. Overpaying is refused.
  - Each gym gets its own sequential receipt numbers (`RCPT-00001`). They're issued atomically, so two people taking payments at once can't get the same number.
  - Payments are never deleted. A mistake is **voided** with a reason by a manager or owner; it stays on record and stops counting.
- **Take payment when selling:** onboarding, renewing and converting a lead can record the payment in the same step. A smaller amount leaves the rest as due.
- **Paid and balance** are shown on every membership. **Dues** lists every membership with money owed, oldest first, with WhatsApp "gentle reminder" and record-payment buttons.
- **Receipts:** a clean, always-light receipt page with **Print / Save PDF** and **Send on WhatsApp**. Browser printing replaces the server-side PDF from the original plan, which would have needed GTK system libraries.
- **Expenses:** categories (rent, salaries, utilities, equipment…), who it was paid to, payment method, and an optional bill photo or PDF (checked by its contents, stored privately).
- **Finance overview** (owners and managers): revenue, expenses, profit and outstanding dues for the month, with month-on-month change. Also a revenue vs expenses chart (6 or 12 months) and breakdowns by payment method and expense category.
- **Roles:** the front desk sees Payments and Dues. Expenses, the overview and voiding are for managers and owners. Trainers don't see finance.

**Phase 8: data import (done)**
- **What you can import:** plans, members, payments, check-ups and leads, from **CSV or Excel (.xlsx)**. Files can be up to 5 MB and 10,000 rows. Each type has a downloadable template.
- **Column matching:**
  - Columns are matched automatically from common names ("Mobile No", "Package", "Expiry Date", "Fees Paid"…).
  - Each field shows an example value from the file.
  - Required fields must be matched before you can continue.
- **Messy data is understood:**
  - dates like `05/10/2026`, `5 Oct 2026` or Excel dates (you choose day-first or month-first)
  - amounts like `₹1,800`
  - durations like "Quarterly" or "3 months"
  - free text such as "F", "GPay", "fat loss" or "insta"
- **Members:** importing a member also creates their membership (the end date is worked out from the plan if missing) and a payment with a receipt number for any amount paid.
- **Payments and check-ups** are matched to members by phone number.
- **Check before importing:** a dry run shows how many rows are new, already exist, or have problems, with the reason for each problem row and a preview. Nothing is saved until you confirm.
- **Duplicates:** rows already in Dunamis are skipped or updated. Members and leads are matched by phone, check-ups by member and date, and plans by name. Payments are never overwritten.
- **Background run with progress:**
  - Each row is saved on its own, so one bad row never undoes the rest.
  - Rows that fail can be downloaded as a CSV with the reason added, ready to fix and re-import.
  - You get a notification when the import finishes.
- **Roles:** imports are for owners and managers.

**Phase 9: analytics (done)**
- **Analytics page** for owners and managers. It covers the last 3, 6 or 12 months and can be filtered by branch; the filter is kept in the URL so a view can be shared.
- **Headline numbers:**
  - active members and new members this month, each compared with last month
  - revenue this month
  - renewal rate: of the memberships that ended, how many renewed
  - lead conversion
- **Members:** active members at the end of each month, plus how many joined and how many didn't renew. Each month's renewal rate is in the tooltip.
- **Renewals:**
  - members whose membership ends in the next 30 days and hasn't been renewed, with what they paid last time
  - renewal rate by month
  - active members by plan
- **Money:**
  - revenue and expenses as bars per month, with profit as a line
  - revenue by plan; payments not tied to a membership show as "Other payments"
- **Leads:** where the period's leads are in the pipeline, average days to convert, and conversion rate by source.
- **Progress:** each member's first and latest check-up in the period are compared, for members with at least two:
  - how many are on track for their goal (weight down for weight loss, muscle up for muscle gain, body fat or waist down otherwise)
  - average weight and body fat change, broken down by goal
- **How it's computed:** figures are calculated live from the source tables, using the same rules as member status. This is fast at single-gym scale. Nightly rollup tables can replace it later without changing the API.
- **Branch filter scope:** leads aren't tied to a branch, so they're always gym-wide. Expenses without a branch are left out when a branch is selected.

**Phase 10: launch readiness (done)**
- **Activity log** (Settings → Activity, owners only): who did what, written in the same transaction as the change itself.
  - Covers members, memberships, payments and voids, expenses, plans, staff and roles, branches, gym and reminder settings, imports, exports, published AI plans and deleted check-ups.
  - Edits record which fields changed. Medical notes and other sensitive values are never copied into the log.
  - Searchable and filterable by type.
- **CSV export** (Settings → Data, managers and owners): members, memberships, payments, expenses, plans, leads and check-ups.
  - Member and plan exports use the import's column names, so a gym can move its data into another account.
  - Every download is recorded in the activity log.
- **Error monitoring:** optional Sentry on the API, the worker and the web app, set up so no personal data is sent (no bodies, cookies, query strings or link tokens).
  - Request IDs appear on every response and log line; logs can be written as JSON.
  - New 404 and error pages report crashes and give the user a way back.
- **Hardening:**
  - Sign-in is rate-limited per IP and per account. Sign-up and invite links are rate-limited too.
  - Client IPs come only from trusted proxies.
  - Security headers on both the app and the API.
  - Production refuses to start with unsafe settings (weak secret, insecure cookies, SQLite, in-process scheduler).
  - Containers run as non-root, with health checks; there's a readiness check that includes the database.
  - Hosting providers' `postgres://` URLs are accepted as-is.
- **Deployment:** a one-click [Render Blueprint](render.yaml) and a [deploy guide](docs/deploy.md) covering Render, Vercel, your own server, environment variables, backups and a go-live checklist.
  - CI now also runs the migrations up and down on Postgres and builds both Docker images.

The full plan is in [`docs/plan.md`](docs/plan.md). Ideas for later: WhatsApp reminders through the Business API, online payments, a member app, and QR check-in.

## Deploy

See **[docs/deploy.md](docs/deploy.md)**. In short: an R2 bucket for uploads; the backend on Render via **New → Blueprint** ([render.yaml](render.yaml)); `frontend/` on Vercel with `BACKEND_URL` pointing at the API; then set `FRONTEND_URL` on Render to the Vercel address.

## Background jobs & email

| Setting | Values |
|---|---|
| `SCHEDULER` | `inprocess` (default; runs inside the API, good for dev/single server), `celery` (production), `off` |
| `EMAIL_PROVIDER` | `console` (default; prints emails to the API log), `smtp` (`SMTP_HOST/PORT/USERNAME/PASSWORD`), `resend` (`RESEND_API_KEY`) |
| `EMAIL_FROM_ADDRESS` | Sender address. The gym's name is used as the sender name. |

In production, run a worker that has the beat scheduler built in:
```bash
celery -A app.worker worker --beat --loglevel=info
```
`docker compose up` already starts this as the `worker` service, with Redis.

## Run locally (no Docker)

You need [uv](https://docs.astral.sh/uv/) and Node 20 or newer.

```bash
# API: http://localhost:8000/api/docs
cd backend
uv sync
uv run alembic upgrade head
uv run python scripts/seed.py        # optional demo gym (logins listed at the top of the script)
uv run uvicorn app.main:app --reload --port 8000
```

```bash
# Web: http://localhost:3000
cd frontend
npm install
npm run dev
```

The web app proxies `/api/*` to the API (see `next.config.ts`), so auth cookies stay first-party.

## Run with Docker (Postgres)

```bash
docker compose up --build
```

## Common tasks

| Task | Command |
|---|---|
| Backend tests | `cd backend && uv run pytest` |
| Backend lint/format | `uv run ruff check . && uv run ruff format .` |
| New migration after model changes | `uv run alembic revision --autogenerate -m "..."` then `uv run alembic upgrade head` |
| Regenerate frontend API types after API changes | `cd frontend && npm run gen:api` |
| Add a shadcn component | `cd frontend && npx shadcn@latest add <name>` |
| Frontend checks | `npm run lint && npm run typecheck && npm run build` |

## Conventions

- **Tenant data:**
  - Add `TenantMixin` to the model (it gives the `gym_id` column).
  - Access it only through a `TenantRepository` subclass built with `ctx.gym_id`.
  - A record from another gym then behaves exactly like a missing one (404).
  - Add an isolation test for every new resource in `tests/test_tenant_isolation.py`.
- **Permissions:** use the `CurrentContext`, `ManagerContext` or `OwnerContext` dependencies in `app/core/deps.py`. Roles are read from the database on every request, so changes apply immediately.
- **Backend modules** live in `app/modules/<name>/`, each with `models.py`, `schemas.py`, `repository.py` and `router.py`. Register new models in `app/models.py`.
- **shadcn/ui on Base UI:**
  - Compose with the `render` prop instead of `asChild`, e.g. `<Button nativeButton={false} render={<Link href="/" />} />`.
  - Use `SimpleSelect` for plain option lists.
