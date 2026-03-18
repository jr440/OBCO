# Automated Quote Submission Setup (Cloudflare)

This project now includes a Cloudflare Pages Function endpoint at:

- `/api/quote`

The endpoint file is:

- `functions/api/quote.js`

It sends accepted quote requests to your email using Resend.
The endpoint now requires Cloudflare Turnstile verification.

## 0) Create Cloudflare Turnstile widget

1. In Cloudflare Dashboard, open Turnstile.
2. Create a widget for your domain.
3. Copy the Site Key and Secret Key.

You need:

- Site Key (frontend, in `contact.html` via `window.OB_TURNSTILE_SITE_KEY`)
- Secret Key (backend, Cloudflare Pages env var `TURNSTILE_SECRET_KEY`)

## 1) Create Resend account and sender

1. Create a Resend account: https://resend.com
2. Add and verify your domain (recommended) or a sender address.
3. Create an API key.

## 2) Set Cloudflare Pages environment variables

In Cloudflare Dashboard -> Pages -> your project -> Settings -> Environment variables, add:

- `RESEND_API_KEY` = your Resend API key
- `QUOTE_TO_EMAIL` = where leads should be delivered (example: `jesse@obandco.com.au`)
- `QUOTE_FROM_EMAIL` = verified sender in Resend (example: `quotes@obandco.com.au`)
- `TURNSTILE_SECRET_KEY` = Cloudflare Turnstile secret key
- `TURNSTILE_EXPECTED_HOSTNAME` = optional strict hostname check (example: `obandco.com.au`)

Set these for both `Production` and `Preview` if desired.

## 2.1) Set frontend Turnstile site key

In `contact.html`, define this before the main script block:

```html
<script>
  window.OB_TURNSTILE_SITE_KEY = "your_turnstile_site_key";
</script>
```

You can place it in `<head>` under the Turnstile script include.

## 3) Deploy

Redeploy your Pages project after adding environment variables.

## 4) Test the flow

1. Go to `quote.html`
2. Generate a quote
3. Click `Accept Quote & Continue`
4. Submit on `contact.html`

Expected result:

- You receive an email with quote reference, price, customer details, and settings.
- The form only submits when the Turnstile anti-spam check is completed and valid.

## 5) Fallback behavior

If `/api/quote` is unavailable or fails, `contact.html` automatically falls back to opening a pre-filled `mailto:` draft.

## Optional: Use another endpoint

If you later move the API elsewhere, define this before the main script in `contact.html`:

```html
<script>
  window.OB_QUOTE_ENDPOINT = "https://your-api.example.com/quote";
</script>
```
