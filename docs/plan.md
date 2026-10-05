# Dunamis — Product Plan & Tech Stack

## Context
We are building a gym-management CRM from scratch; the `gym-crm` folder is empty. It is a **multi-gym SaaS**: any gym owner signs up and gets an isolated workspace. In it they can:
- onboard members and design their own membership plans
- log weekly check-ups
- manage leads
- track revenue and expenses, and see analytics

Members are reminded automatically before their membership expires. Each member gets a **shareable preview link**, with no login needed, that shows their AI-generated workout and diet plan, their trainer and their progress. Owners can **import** their existing data from spreadsheets.

Decisions so far:
- responsive web app built with **shadcn/ui**
- **FastAPI** backend
- payments recorded manually (no gateway in v1)
- **no attendance module** in v1

---

## 1. Feature modules (v1)

| Module | What it does |
|---|---|
| **Auth & gym setup** | Owner signs up and creates a gym (tenant) plus branches. Invites staff with roles: Owner, Manager, Trainer, Front desk. |
| **Customizable plans** | Owner builds any plan: name, a duration as a number plus a unit (days, weeks, months or years, e.g. 1 month, 3 months, 1 year), price, joining fee, tax %, included services (PT sessions, diet consult, locker), max freeze days, active or archived. Supports discounts and coupons per membership. |
| **Members (onboarding)** | Personal details, emergency contact, medical notes, goal, diet preference (veg, non-veg, vegan), experience level, assigned trainer, plan, start date, photo. End date is auto-calculated from the plan. Search, filters and tags. Statuses: Active, Expiring soon, Expired, Frozen. |
| **Membership expiry reminders** | A daily scheduled job finds memberships expiring in N days. Owners configure N per gym; the default is 7, 3, 1 and 0 days before, plus 3 days after. It sends the member a reminder by email (and WhatsApp in phase 2), alerts the owner in-app, and builds a "Renewals due" list on the dashboard. Every send is logged so nobody gets the same reminder twice. Owners can edit the templates. |
| **Weekly check-ups** | Weight, body fat %, muscle mass, BMI (auto-calculated), measurements, progress photos and trainer notes. Progress charts per member. A "check-up due" flag appears when 7 days have passed. |
| **AI plans** | A trainer clicks "Generate plan". The Claude API produces a structured weekly workout plan and diet plan from the member's profile, goal, diet preference, medical notes and latest check-ups. The trainer reviews and edits it, then publishes it. Each plan is versioned, so a new one can be generated after each check-up. |
| **Member preview link** | A unique, unguessable link per member (`/p/{token}`) opens a read-only mobile page. It shows the gym's branding, the member's name, plan and expiry date with a renew-by notice, the assigned trainer's name, photo and contact, the current AI workout and diet plan, and check-up progress charts. Staff can copy, share on WhatsApp or email it, revoke it and regenerate it. |
| **Leads** | Lead sources: walk-in, call, Instagram, referral, website form. A Kanban pipeline moves each lead through New → Contacted → Trial booked → Trial done → Converted or Lost. Follow-up reminders, notes and an assigned staff member. One-click convert to member. |
| **Finance** | Record payments against memberships (method, date, receipt number). Track expenses by category and see pending dues. PDF receipts. |
| **Analytics dashboard** | Active members, new signups, renewals vs churn, upcoming expiries, lead funnel and conversion by source, revenue vs expenses vs profit per month, revenue by plan, and check-up progress across members. Filters for date range and branch. |
| **Data import** | Upload a CSV or Excel file of members, plans, payments, leads or check-ups. Steps: map columns (with auto-suggested mapping) → validate and preview with errors per row → choose how duplicates are handled (by phone or email: skip or update) → import runs in the background → summary and an error file to download. Downloadable templates for each entity. |
| **Audit & export** | Activity log and CSV export. |

---

## 2. Tech stack

### Frontend
- **Next.js 15 (React + TypeScript)**, responsive.
- **shadcn/ui** (Radix + Tailwind CSS) as the component system:
  - Data Table (TanStack Table) for members, leads and payments
  - Form + **React Hook Form + Zod** for onboarding, plans and check-ups
  - Dialog and Sheet for quick-add drawers
  - **shadcn Charts** (Recharts) for analytics and progress
  - Calendar and Date Picker
  - Sonner toasts
  - Command palette for global search
  - Kanban for leads, built with **dnd-kit** and shadcn Cards
- **TanStack Query** for server state. A typed API client is generated from FastAPI's OpenAPI spec with **openapi-typescript**.
- The member preview page is a lightweight public Next.js route, rendered on the server and optimised for mobile.

### Backend (FastAPI)
- **FastAPI + Pydantic v2**, running on Uvicorn/Gunicorn and async throughout.
- **SQLAlchemy 2.0 (async) + asyncpg** for the database, and **Alembic** for migrations.
- **Auth:** JWT access and refresh tokens (PyJWT), argon2 password hashing (pwdlib), and role-based permissions through FastAPI dependencies.
- **Multi-tenancy:**
  - Every tenant table has a `gym_id` column.
  - A `get_current_tenant` dependency plus a scoped repository/session filter ensures every query is filtered by gym.
  - Postgres **Row-Level Security** acts as a second guard.
- **Celery + Redis** with **Celery Beat** for background jobs:
  - the daily expiry-reminder run
  - imports
  - AI plan generation
  - nightly analytics rollups
  - PDF and CSV generation
- **pandas + openpyxl** to parse imports.
- **WeasyPrint** for PDF receipts.
- **SQLAdmin** for an internal super-admin panel.

### AI (plan generation)
- The **Anthropic Python SDK** (`anthropic`) calls the model **`claude-opus-5-5`** in a Celery task.
- **Structured output:** `client.messages.parse(..., output_format=WorkoutDietPlan)` with a Pydantic schema, so the response comes back as validated JSON. The schema covers:
  - days, then exercises with sets, reps and rest
  - meals, with items and calories
  - macros
  - notes
- Set `output_config={"effort": "medium"}` explicitly. Adaptive thinking is the default on this model.
- **Refusal fallback:** add the server-side `fallbacks: "default"` option (beta `server-side-fallback-2026-07-01`), and always check `stop_reason` before using the output.
- **Prompt caching:** put a fixed system prompt (trainer persona, safety rules, output conventions) first and cache it with `cache_control`; member data goes after it.
- **Safety:**
  - Medical notes and injuries are passed in as constraints.
  - The plan is always reviewed by a trainer before publishing.
  - The member page carries a disclaimer.
- **Estimated cost:** roughly 3K input and 4–6K output tokens per plan, so about **$0.10–0.15 per plan** at $4/$20 per million tokens. Bulk regeneration can use the Message Batches API for 50% off.
- Each gym gets a monthly generation quota, which ties into SaaS pricing tiers later.

### Data & storage
- **PostgreSQL 16** is the main database.
- **Redis** for cache, the job broker and rate limiting (including on the public preview route).
- **Analytics:** nightly rollups into `daily_gym_stats` and `monthly_finance_summary` tables.
- **S3 or Cloudflare R2** for photos, import files and receipts, using presigned URLs.

### Notifications
- **Email:** Resend or AWS SES, with Jinja2 templates.
- **WhatsApp** in phase 2: Meta WhatsApp Cloud API, or Twilio or Interakt, using approved templates for expiry reminders and plan links.

### Infra & DevOps
- **Docker** + docker-compose for local development (web, api, worker, beat, postgres, redis).
- **Hosting:**
  - **Start:** Render or Railway for the API and workers, Vercel for the frontend.
  - **Scale:** AWS ECS Fargate with RDS, ElastiCache, S3 and CloudFront.
- **GitHub Actions** for CI. **Sentry** for the API and frontend. **Better Stack or Grafana** for uptime and metrics.

### Quality
- **Backend:** pytest + pytest-asyncio + httpx test client + factory-boy, ruff, mypy.
- **Frontend:** Vitest, Playwright, ESLint and Prettier.

---

## 3. Core data model
```
Gym(id, name, logo_url, brand_color, timezone, reminder_offsets int[], created_at)
Branch(id, gym_id, name, address)
User(id, email, password_hash, name) ── StaffMembership(user_id, gym_id, branch_id, role)
Plan(id, gym_id, name, duration_value, duration_unit[day|week|month|year], price,
     joining_fee, tax_pct, services jsonb, max_freeze_days, is_active)
Member(id, gym_id, branch_id, name, phone, email, dob, gender, goal, diet_pref,
       experience_level, medical_notes, trainer_id, status, photo_url, joined_at,
       preview_token (unique, random 32B), preview_enabled)
Membership(id, gym_id, member_id, plan_id, start_date, end_date, status,
           price, discount, frozen_days)
Payment(id, gym_id, membership_id, member_id, amount, method, paid_at, receipt_no, recorded_by)
Expense(id, gym_id, branch_id, category, amount, vendor, spent_at, notes, attachment_url)
CheckUp(id, gym_id, member_id, date, weight, body_fat, muscle_mass, bmi, measurements jsonb,
        photos[], notes, recorded_by)
AIPlan(id, gym_id, member_id, version, status[draft|published|archived], workout jsonb,
       diet jsonb, model, input_tokens, output_tokens, created_by, published_at)
Lead(id, gym_id, name, phone, email, source, stage, interest, assigned_to,
     next_follow_up_at, lost_reason, converted_member_id)
LeadActivity(id, lead_id, type, content, created_by, created_at)
ReminderLog(id, gym_id, membership_id, offset_days, channel, status, sent_at)  -- unique(membership_id, offset_days, channel)
ImportJob(id, gym_id, entity, file_url, mapping jsonb, status, total, succeeded, failed,
          error_file_url, created_by)
DailyGymStats / MonthlyFinanceSummary, AuditLog
```
Indexes: `gym_id` on every table, plus `(gym_id, end_date)` on Membership for the reminder query and `(gym_id, paid_at)` on Payment.

---

## 4. Project structure
```
gym-crm/
  backend/
    app/
      main.py, core/ (config, security, db, tenancy deps, celery_app)
      modules/
        auth/  gyms/  plans/  members/  memberships/  checkups/
        ai_plans/  leads/  finance/  analytics/  imports/
        notifications/  public_preview/  audit/
          (each: models.py, schemas.py, repository.py, service.py, router.py, tasks.py)
    alembic/   tests/
  frontend/
    app/(auth)/  app/(dashboard)/{members,plans,leads,checkups,finance,analytics,imports,settings}
    app/p/[token]/        public member preview
    components/ui/        shadcn components
    lib/api/              generated client
  docker-compose.yml   .github/workflows/ci.yml
```

---

## 5. Build phases
1. **Foundation (week 1–2):**
   - repo, Docker and CI
   - FastAPI skeleton with async SQLAlchemy and Alembic
   - Next.js with shadcn/ui set up
   - auth, gyms, branches, roles and tenant scoping
2. **Plans & members (week 3–4):** customizable plan builder, member onboarding, membership lifecycle (end date, freeze, renew).
3. **Reminders (week 5):** Celery Beat daily job, email templates, reminder log, owner alerts, renewals-due list.
4. **Check-ups (week 5–6):** check-up form, progress charts, due flags.
5. **AI plans + preview link (week 6–7):** Claude generation task, editor to review and publish, public `/p/{token}` page, share, revoke.
6. **Leads (week 8):** Kanban pipeline, follow-ups, convert to member.
7. **Finance (week 9):** payments, expenses, dues, PDF receipts.
8. **Import (week 10):** upload, column mapping, preview, background import, error report.
9. **Analytics (week 11):** rollups and the shadcn charts dashboard.
10. **Launch (week 12):** audit log, export, Sentry, deploy.
11. **Later:** WhatsApp reminders, online payments (Razorpay or Stripe), member PWA, attendance or QR check-in, SaaS billing for gyms, AWS migration.

---

## 6. Verification
- **Tenant isolation tests:** a user from gym A gets a 404 on every gym B resource. These run in CI for every router.
- **Plan duration math:** months crossing month-end, leap years, freeze extensions.
- **Reminders:**
  - Freeze time and run the Beat task.
  - Check that the right members get exactly one reminder per offset.
  - A rerun sends nothing new (idempotency).
- **AI plans:** with a mocked Anthropic client, check that the parsed output matches the schema. Then make one real call with a sample member to review quality. Check that `stop_reason` handling and fallbacks work.
- **Preview link:** a valid token renders the page, a revoked token returns 404, the route is rate-limited, and it exposes no internal IDs or other members' data.
- **Import:** test with a messy sample CSV (bad dates, duplicates, missing columns). Check the counts and the error file.
- **Playwright end-to-end flow:**
  1. Sign up a gym.
  2. Create a 3-month plan.
  3. Import 50 members.
  4. Add a check-up.
  5. Generate and publish an AI plan.
  6. Open the preview link.
  7. Convert a lead.
  8. Record a payment and an expense.
  9. Confirm the dashboard totals.
- **Local run:** `docker compose up`, then open localhost:3000. Load-test the list and dashboard endpoints with Locust on seeded data.
