# Deploying Dunamis

The app has five parts:

| Part | What it is | Notes |
|---|---|---|
| **web** | Next.js (`frontend/`) | Browsers only talk to this. It proxies `/api/*` to the API, so login cookies stay first-party. |
| **api** | FastAPI (`backend/`) | Runs database migrations on start. Health check: `/api/health/ready`. |
| **worker** | Celery with the beat scheduler (same image as the API) | Sends membership reminders every hour. **Run exactly one.** |
| **Postgres 16** | The database | |
| **Redis** | The job queue | |

Uploaded files (progress photos, expense bills, import files) go to **S3 or Cloudflare R2**. Container disks are wiped on every deploy.

## Option A: Vercel (web) + Render (everything else). This is the setup in this repo.

### 1. Storage bucket (Cloudflare R2)

1. In Cloudflare, go to **R2 → Create bucket** and name it, for example, `gym-crm-uploads`. Leave public access **off**.
2. Go to **R2 → Manage API tokens → Create API token**:
   - Permission: **Object Read & Write**
   - Scope: only this bucket
3. Keep these three values for the next step: the **Access Key ID**, the **Secret Access Key**, and the endpoint `https://<account id>.r2.cloudflarestorage.com`.

### 2. Backend on Render

1. In Render, choose **New → Blueprint**, connect GitHub and pick this repo. [`render.yaml`](../render.yaml) creates Postgres, Redis, `gym-crm-api` and `gym-crm-worker`.
2. Fill in what Render asks for:
   - `FRONTEND_URL`: use `https://example.com` for now; you'll fix it in step 4.
   - `S3_BUCKET`, `S3_ENDPOINT_URL`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`: from step 1.
   - `JWT_SECRET` is generated for you.
3. Apply. The first build takes a few minutes. When it finishes, open `https://<your api>.onrender.com/api/health/ready`; it should say `ok`.

### 3. Web app on Vercel

1. **Add New → Project**, import the repo, and set **Root Directory** to `frontend`.
2. Add one environment variable before deploying: `BACKEND_URL` = the API's address from step 2, e.g. `https://gym-crm-api.onrender.com`. Proxy rewrites are fixed at build time, so redeploy after changing it.
3. Deploy, then note the address Vercel gives you, e.g. `https://gym-crm.vercel.app`.

### 4. Connect the two

1. In Render, go to **Env Groups → gym-crm-backend** and set `FRONTEND_URL` to the Vercel address.
2. Save and redeploy the API and the worker. Invite and preview links use this address.
3. Open the Vercel address and **sign up**: the first account creates your gym.

### Later

- **Email reminders:** verify a domain in [Resend](https://resend.com). Then set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and `EMAIL_FROM_ADDRESS` in the env group.
- **Custom domain:** add it in Vercel, then update `FRONTEND_URL`.
- **Optional services:**
  - Sentry: `SENTRY_DSN` in Render, plus `NEXT_PUBLIC_SENTRY_DSN` and `SENTRY_DSN` in Vercel.
  - AI plans: `ANTHROPIC_API_KEY` in Render.

> **Cost:** Vercel's free tier covers the web app. On Render you pay for the API, the worker, Postgres and Redis. The Blueprint page shows the total before you confirm. Free Render instances sleep when idle, which stops reminders, so use paid plans for the API and the worker.

## Option B: everything on Render

Add this service to `render.yaml`:

```yaml
  - type: web
    name: gym-crm-web
    runtime: docker
    plan: starter
    rootDir: frontend
    healthCheckPath: /login
    envVars:
      - key: BACKEND_URL # build-time; private network
        fromService: { type: web, name: gym-crm-api, property: hostport }
```

Then set `FRONTEND_URL` to the web service's address.

## Option C: your own server (Docker)

```bash
docker compose up --build
```

[`docker-compose.yml`](../docker-compose.yml) runs everything locally.

For a server, copy it and then:
- Set `ENVIRONMENT=production`, a strong `JWT_SECRET` and `COOKIE_SECURE=true`.
- Configure S3 or R2.
- Put the web container behind a TLS proxy such as Caddy or nginx.
- Set `TRUSTED_PROXY_HOPS=2` when that proxy appends to `X-Forwarded-For`.
- Don't publish the database or Redis ports.

## Environment variables

These are set on the API and the worker. See [`backend/.env.example`](../backend/.env.example) for all of them.

| Variable | Production value |
|---|---|
| `ENVIRONMENT` | `production`. This turns on startup checks: the API refuses to start without a strong `JWT_SECRET`, `COOKIE_SECURE=true`, Postgres, and `SCHEDULER=celery` (or `off`). |
| `DATABASE_URL` | A Postgres URL. `postgres://…` from your host is fine; the right driver is filled in automatically. |
| `REDIS_URL` | The Redis URL. |
| `JWT_SECRET` | 32+ random characters. Changing it signs everyone out. |
| `COOKIE_SECURE` | `true` |
| `SCHEDULER` | `celery`, with exactly one worker running |
| `FRONTEND_URL` | Public web address. Used in invite and preview links, and in emails. |
| `TRUSTED_PROXY_HOPS` | `2` behind a load balancer + Next.js. Used for rate limiting. |
| `EMAIL_PROVIDER` | `resend` (needs `RESEND_API_KEY`) or `smtp` (needs `SMTP_*`) |
| `EMAIL_FROM_ADDRESS` | An address on a domain you've verified with your email provider |
| `STORAGE_PROVIDER` | `s3`, plus `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY`. For **R2**, also set `S3_ENDPOINT_URL=https://<account>.r2.cloudflarestorage.com` and `S3_REGION=auto`. Keep the bucket **private**: the API checks permissions, then hands out links that expire after 5 minutes. |
| `ANTHROPIC_API_KEY` | Optional. Turns on AI workout and diet plans. |
| `SENTRY_DSN` | Optional. Turns on error reporting. |
| `LOG_JSON` | `true` for log collectors |

## Error monitoring and logs

- **Sentry:** create a project and set `SENTRY_DSN`.
  - API and worker: set it on both.
  - Web app: set `NEXT_PUBLIC_SENTRY_DSN` (browser, needed at build time) and `SENTRY_DSN` (server).
- **What's sent to Sentry:** request bodies, cookies, query strings, user details and the secret tokens in preview and invite links are all removed before anything leaves the app.
- **Request IDs:** every API response carries an `X-Request-ID`, and every log line includes it. Quote it when tracing a problem.
- **Health checks:**
  - `/api/health` answers if the process is up.
  - `/api/health/ready` also checks the database.

## Backups

- **Database:** turn on your host's daily Postgres backups and test a restore once. Render keeps point-in-time backups on paid Postgres plans.
- **Uploaded files:** turn on versioning, or a lifecycle backup, for the S3/R2 bucket.
- **For gym owners:** each gym can download all its data as CSV from **Settings → Data**.

## Before going live

- [ ] Production deploy is green and `/api/health/ready` returns `ok`.
- [ ] Signing up creates a gym; inviting a staff member sends a working link (check `FRONTEND_URL`).
- [ ] A test reminder email arrives (**Reminders → Send emails now**) and isn't in spam (check SPF and DKIM for your domain).
- [ ] Uploading a progress photo still works after a redeploy (S3/R2 configured).
- [ ] An error shows up in Sentry. Try a wrong API route from the browser console and check the logs too.
- [ ] Database backups are on.
- [ ] Only one worker is running, otherwise reminders could be sent twice. The reminder log stops duplicates, but don't rely on that.
