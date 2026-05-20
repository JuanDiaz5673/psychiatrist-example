# Deploying Wisteria Counseling to Cloudflare Pages

## One-time setup (before first deploy with the API)

The booking flow now needs **one secret**: `CAL_API_KEY`. Without it, `/api/*`
endpoints will 500 and the calendar will show "Request failed."

### Add the secret to Cloudflare Pages

1. Open the Cloudflare dashboard → **Workers & Pages** → your project
   (`psychiatrist-example` or whatever you named it).
2. **Settings** → **Variables and Secrets** → **Add**.
3. Type: **Secret** (NOT plaintext — secret values are encrypted at rest).
4. Variable name: `CAL_API_KEY`
5. Value: your Cal API key (the `cal_live_...` string).
6. Apply to: **Production** (and Preview if you use preview deploys).
7. Save.

After adding the secret you must **redeploy** for it to take effect — push a
commit or trigger "Retry deployment" from the dashboard.

### Verify

After deploy:

```bash
curl https://your-domain.example/api/event-type
```

Should return JSON starting with `{"ok":true,"eventType":{...}}`.
If you see `"CAL_API_KEY not configured on this environment"` the secret
wasn't applied — re-check the dashboard and redeploy.

---

## Local dev

The Cloudflare Functions only run on Cloudflare. For local dev there's
a Python proxy that mimics them exactly:

```bash
python scripts/dev_server.py
# → http://localhost:5174
```

It reads `CAL_API_KEY` from `.dev.vars` (preferred) or `.env`. Both are
gitignored.

To run on port 5173 (matching the Claude Code preview tool):
```bash
DEV_PORT=5173 python scripts/dev_server.py
```

---

## How the booking flow works end to end

```
Browser (booking.html + booking.js)
        │
        │   GET /api/event-type    (event title, custom intake questions)
        │   GET /api/slots         (available time slots for a month)
        │   POST /api/book         (submit a booking)
        ▼
Cloudflare Pages Functions (functions/api/*.js)
        │   Adds Authorization: Bearer $CAL_API_KEY header
        ▼
Cal.com REST API (api.cal.com/v2)
        │
        ▼
Saudia's Cal account → confirmation email + calendar invite to client
```

The Cal API key is never exposed to the browser. Frontend only ever
talks to `/api/*` on the same domain.

---

## Rotating the Cal API key

Since the current key was pasted in chat for setup, rotate it once
deployed:

1. Cal.com → **Settings** → **Developer** → **API keys** → delete the
   current one.
2. Create a new key.
3. Cloudflare Pages → **Settings** → **Variables and Secrets** → edit
   `CAL_API_KEY` with the new value.
4. Trigger a redeploy.
5. Update your local `.dev.vars` and `.env` files.

---

---

## Branded confirmation email (Resend pipeline)

The booking page sends a Wisteria-branded HTML email to the client via Resend,
triggered by a Cal.com webhook. Setup:

### 1. Add secrets to Cloudflare Pages

Under **Settings → Variables and Secrets**, add as **secrets**:

| Name | Value |
|---|---|
| `CAL_API_KEY` | Cal personal API key (already done) |
| `RESEND_API_KEY` | Resend API key (`re_xxx...`) |
| `CAL_WEBHOOK_SECRET` | Long random string — paste the SAME value into Cal's webhook config below |

Redeploy after adding.

### 2. Configure the Cal webhook

In Cal.com dashboard → **Settings → Developer → Webhooks → New**:

- **Subscriber URL:** `https://<your-domain>/api/cal-webhook`
- **Event Triggers:** `BOOKING_CREATED` only
- **Secret:** the same value you set for `CAL_WEBHOOK_SECRET`
- Enabled: yes

### 3. Sender domain (production)

For now `functions/api/_email.js` sends from `onboarding@resend.dev` — Resend's
sandbox. **This only delivers to the Resend account owner's address.** Real
clients won't receive emails until you verify a real domain.

To swap to production:
1. In Resend: Domains → Add `wisteriacounseling.com` → add the DNS records they show you.
2. Once green-checked, edit `functions/api/_email.js`:
   ```js
   const FROM_EMAIL = "Wisteria Counseling <hello@wisteriacounseling.com>";
   const REPLY_TO   = "Wisteriaconseling@gmail.com";
   ```
3. Also update `scripts/dev_server.py` (the `from` and `reply_to` lines in `_send_via_resend`).
4. Commit + redeploy.

### 4. Test locally

With `RESEND_API_KEY` in `.env` or `.dev.vars`:

```bash
python scripts/dev_server.py
# In another terminal, simulate a Cal webhook:
curl -X POST http://127.0.0.1:5173/api/cal-webhook \
  -H 'Content-Type: application/json' \
  -d @scripts/fixtures/cal-webhook-sample.json
```

(See `scripts/fixtures/cal-webhook-sample.json` for the sample payload format.)

---

## Things you can tweak without code changes

These are all editable via the Cal.com dashboard (Event Types →
**Initial consultation**) — the booking page will pick up the change
on next page load because it fetches event-type info live:

- Title and description
- Duration (currently 50 min)
- Buffer before/after sessions
- Minimum booking notice
- Working hours (Schedules)
- Intake questions — labels, options, required/optional
- Hide / show / reorder questions

If you change the **slug**, update `EVENT_TYPE_SLUG` in
`functions/api/_shared.js` and `scripts/dev_server.py`. The numeric
`EVENT_TYPE_ID` does not change.
