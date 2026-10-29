# Security

What the app already does:
- Passwords: scrypt with a random salt per user (never stored or logged in plain text). Minimum 10 characters. Login lockout after 5 failures per email and IP.
- Sign-in: signed JWT in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production). The token names a server-side session, so signing out, deactivating a user or changing a password revokes it immediately. Optional authenticator-app two-factor sign-in.
- Staff access by role and permission, checked on the server for every request. API keys are least-privilege and can't manage staff or other keys.
- Card and bank numbers never touch this app (Stripe Checkout). Stripe webhooks are signature-verified. Prices, tax and totals are always computed on the server.
- Security headers (CSP, HSTS in production, no framing, nosniff, referrer policy), per-IP rate limits, input validation (zod), sanitised rich text, image re-encoding on upload, SSRF guard on outbound URLs, CSRF defences (Origin and Fetch-Metadata checks plus SameSite).
- A security log (Settings → Security) records sign-ins, failed sign-ins, staff, role, key and webhook changes.

You must do these when you go live (no app can do them for you):
1. Serve everything over HTTPS only and set `NODE_ENV=production`, `STOREFRONT_URL=https://…`.
2. Set a long random `APP_SECRET` in `backend/.env` (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`). Changing it later signs everyone out and makes saved 2FA secrets unreadable (owners can reset 2FA).
3. Turn on two-factor sign-in for every Owner and Administrator.
4. Don't expose MySQL to the internet; use a firewall and a strong DB password (change the compose defaults). Keep `backend/.env` out of git (it is ignored) and `chmod 600` it.
5. Put the site behind a CDN or WAF (for example Cloudflare) for DDoS protection and bot filtering.
6. Run the API and the web app as a non-root user, keep Node and packages updated (`npm audit`), and take automatic encrypted database backups (restore-test them).
7. In Stripe: restrict the API key to what you need, turn on Radar rules, and add the webhook endpoint secret.
8. Rotate any key that was ever pasted into chat, email or a screenshot.

Known limits: rate limits and login lockout are in memory (single server; use a shared store if you scale out). Webhook retries run in-process and are lost on restart (the delivery log shows what failed). `npm audit` reports a vulnerability in the Prisma command-line tool's dependency (`deepmerge-ts`); it affects developer commands, not the running site.
