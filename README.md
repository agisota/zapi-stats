# zapi-stats

To install dependencies:

```bash
bun install
```

To run:

```bash
bun run index.ts
```

## Account / billing environment

```bash
ACCOUNT_DB_PATH=/data/zapi-stats-state/account.sqlite
ACCOUNT_ENFORCE_BALANCE=1
CORS_ALLOWED_ORIGINS=https://stats.api.zed.md
OMNIROUTE_RW_DB_PATH=/data/omniroute/storage.sqlite
DVNET_API_BASE_URL=https://api.dv.net
DVNET_API_KEY=...
DVNET_WEBHOOK_SECRET=...
MAGIC_LINK_PROVIDER=resend
MAGIC_LINK_BASE_URL=https://stats.api.zed.md
MAGIC_LINK_FROM="API ZED <login@api.zed.md>"
MAGIC_LINK_TTL_MINUTES=15
RESEND_API_KEY=...
```

`ACCOUNT_ENFORCE_BALANCE=1` makes managed API keys validate only while the account wallet has a positive balance. Stats reconciles managed-key rows from `usage_history` into wallet debits before `/api/auth/validate`, before protected `/api/user/*` requests, and when the account balance, ledger, or key list is loaded.

Production email login is enabled only when a verified magic-link sender is configured. With `MAGIC_LINK_PROVIDER=resend`, Stats sends a one-time link through Resend's `/emails` API; the link uses the URL fragment `/magic#token=...` so the raw token is not sent in HTTP request logs. The sender domain in `MAGIC_LINK_FROM` must be verified in the email provider before enabling it for real users.

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
