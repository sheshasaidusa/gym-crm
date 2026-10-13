# Keep your data: Neon (database) + Cloudflare R2 (photos)

The free Render database expires after 30 days, and Render's free API deletes uploaded files on
every redeploy. This moves both to services that keep them. The app code already supports
this; it is only settings.

Total cost: **$0** at test scale (Neon free, R2 free 10 GB). The API can stay on Render's free plan
(it just sleeps when idle).

## 1. Database on Neon

1. Sign up at neon.com and **Create project**. Name it `gym-crm`, pick the region closest to your
   Render API (e.g. Singapore for an Indian gym).
2. In the project's **Connect** panel, turn **Connection pooling OFF** and copy the string. It
   looks like `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`.
   Use the *direct* (non-pooled) one: the API opens its own pool, and migrations need a direct
   connection. (A `-pooler` URL also works; the app switches off prepared statements for it.)
3. Render dashboard → **gym-crm-api → Environment** → set `DATABASE_URL` to that string.
   If Render shows it as managed by the blueprint and won't let you edit it, remove the
   `databases:` block and the `fromDatabase` entry from `render.yaml` first (or detach it in the
   Blueprint settings), then set the variable by hand.
4. Save. Render redeploys; the container runs `alembic upgrade head` on start and creates every
   table in Neon.

Neon's free plan pauses the database after 5 idle minutes, so the first request after a quiet
spell takes a second or two longer. Data is never deleted. Free storage is 0.5 GB; upgrade
when you near it.

## 2. Photos on Cloudflare R2

1. Sign up at cloudflare.com, then **R2 Object Storage → Create bucket** (name `gym-crm-photos`,
   keep it **private**; do not enable public access).
2. **R2 → Manage API tokens → Create API token** with *Object Read & Write* on that bucket.
   Copy the **Access Key ID**, **Secret Access Key**, and the **S3 endpoint** shown on the token
   page (`https://<account-id>.r2.cloudflarestorage.com`). The secret is shown once.
3. On Render → **gym-crm-api → Environment**, add:

   | Variable | Value |
   |---|---|
   | `STORAGE_PROVIDER` | `s3` |
   | `S3_BUCKET` | `gym-crm-photos` |
   | `S3_ENDPOINT_URL` | the endpoint from step 2 |
   | `S3_REGION` | `auto` |
   | `S3_ACCESS_KEY_ID` | the access key id |
   | `S3_SECRET_ACCESS_KEY` | the secret |

4. Save and let it redeploy. Upload a check-up photo and confirm it appears after a redeploy.

Photos stay private: the API checks who is asking and then streams the file or hands out a
5-minute signed link.

## 3. Fill it with demo data, then clear it

With the Neon URL in hand, from your computer:

```bash
# Create the demo gym and one login for every role (random passwords are printed once)
DATABASE_URL="<your neon url>" uv run --directory backend python scripts/reset_demo.py --yes

# When you're done testing: empty the database again
DATABASE_URL="<your neon url>" uv run --directory backend python scripts/reset_demo.py --yes --wipe-only
```

`reset_demo.py` deletes everything in the database it is pointed at. Never run it against a
database that holds real members.

## Later: when a real gym goes live

- Move Neon to the **Launch** plan (pay as you use) and turn off scale-to-zero, or use Render's
  paid Postgres, and make sure backups are on.
- Put the API on a paid Render plan so it doesn't sleep.
- Remove the demo accounts (`--wipe-only`) before real data goes in.
