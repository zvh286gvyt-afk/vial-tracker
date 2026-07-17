# Vial Tracker

A simple app to track vitamin vial inventory and expiration dates. Add a vitamin,
it defaults to a 28-day shelf life, and you get a reminder 7 days before a batch
expires so you know it's time to reorder. Works as an installable app on your
phone's home screen, with real push notifications even when the app is closed.

## How it works

- Each vitamin ("Vitamin B12", "Glutathione", etc.) has a shelf life in days (28 by default).
- Every time you receive stock, you add a "batch" (quantity + date received). The
  app calculates that batch's expiration date automatically.
- "Use 1" subtracts from the earliest-expiring batch first.
- Inventory count = total vials across all non-expired batches for that vitamin.
- Once a day, the server checks every batch. Any batch expiring within 7 days
  triggers a push notification (once per batch) telling you to order more.

## Running it locally

Requires Python 3.9+.

```
pip install -r requirements.txt
cp .env.example .env      # then fill in VAPID keys (see below)
python3 app.py
```

Open http://127.0.0.1:5001 in your browser.

### Generating VAPID keys (only needed once)

Push notifications require a VAPID key pair. Generate one with:

```
python3 -c "
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.backends import default_backend
import base64

def b64url(b): return base64.urlsafe_b64encode(b).rstrip(b'=').decode()

priv = ec.generate_private_key(ec.SECP256R1(), default_backend())
pub = priv.public_key()
priv_raw = priv.private_numbers().private_value.to_bytes(32, 'big')
pub_raw = pub.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)

print('VAPID_PRIVATE_KEY=' + b64url(priv_raw))
print('VAPID_PUBLIC_KEY=' + b64url(pub_raw))
"
```

Paste the two lines into your `.env` file (or your host's environment variables).
Keep the private key secret — don't commit `.env` to git (it's already in `.gitignore`).

## Deploying for free (so notifications work even when the app is closed)

**Render.com** (recommended — free tier, simple git-based deploy):

1. Push this folder to a GitHub repo (public or private).
2. Go to https://render.com → New → Web Service → connect your repo.
3. Settings:
   - Build command: `pip install -r requirements.txt`
   - Start command: `gunicorn app:app` (add `gunicorn` to requirements.txt first — see note below)
   - Instance type: Free
4. Add environment variables in Render's dashboard:
   - `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_CLAIMS_EMAIL` (your email as `mailto:you@example.com`)
   - `CRON_SECRET` — any random string, e.g. generate with `python3 -c "import secrets; print(secrets.token_hex(16))"`
5. Deploy. Render gives you a URL like `https://vial-tracker.onrender.com`.

(`gunicorn` is already included in `requirements.txt` as the production server.)

**Important data note**: Render's free tier does not include a persistent disk,
so the `data/store.json` file can reset when the service redeploys or restarts
after long inactivity. This is fine for getting started, but if you want data to
never be lost, let me know and I can switch storage to a free hosted database
(e.g. a free Postgres on Render/Supabase) — a quick follow-up change.

### Setting up the daily expiration check

Render's free tier doesn't run background cron jobs reliably on its own, so use a
free external scheduler to "ping" the check endpoint once a day:

1. Go to https://cron-job.org (free, no credit card) and create an account.
2. Create a new cron job:
   - URL: `https://YOUR-APP.onrender.com/api/cron/check-expirations?key=YOUR_CRON_SECRET`
   - Schedule: once daily (e.g. 8:00 AM)
3. Save. That's it — every day it hits your endpoint, which checks all vials and
   sends push notifications for anything expiring within 7 days.

## Installing on your phone (so it acts like a real app)

1. Open your deployed URL in Safari (iPhone) or Chrome (Android).
2. Tap Share → "Add to Home Screen" (iPhone) or the install prompt / menu →
   "Install app" (Android/Chrome).
3. Open the app from the home screen icon, tap the 🔔 button once to allow
   notifications.

## Project structure

```
app.py              Flask backend (API + push notifications)
storage.py          Simple JSON file storage
public/             Frontend (PWA): index.html, app.js, styles.css,
                     manifest.json, service-worker.js
data/store.json     Your data (created automatically on first run)
```
