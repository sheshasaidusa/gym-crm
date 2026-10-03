# Deploy to Render

`render.yaml` in the repo root creates three things: a Postgres database (`gym-crm-db`), the API
(`gym-crm-api`) and the web app (`gym-crm-web`).

## Steps

1. Push the branch to GitHub.
2. In Render: **New → Blueprint**, connect the repo and pick the branch with `render.yaml`.
3. Render asks for `ANTHROPIC_API_KEY`. Leave it blank to skip AI plans (you can add it later).
4. Click **Apply**. The first build takes a few minutes.
5. Open `https://gym-crm-web.onrender.com`, use **Sign up** to create your gym, then log in.

If Render says a service name is taken, it adds a suffix to the URL. Then update `FRONTEND_URL` and
`CORS_ORIGINS` on the API service and `BACKEND_URL` on the web service to the real addresses.
`BACKEND_URL` is read at build time, so redeploy the web service after changing it.

## Free-plan limits

- Free web services sleep after 15 minutes idle; the first visit afterwards takes about a minute.
- The free Postgres database is deleted after 30 days. Use a paid plan to keep data.
- Uploaded progress photos are written to the container's disk and are lost on every deploy. Set
  `STORAGE_PROVIDER=s3` (works with Cloudflare R2) for real use.
- Emails are only printed to the API log (`EMAIL_PROVIDER=console`). Set `resend` or `smtp` to send.
- Reminders run inside the API (`SCHEDULER=inprocess`), so they only fire while it is awake.
  For real use, use a paid plan and a Celery worker (see the README).
