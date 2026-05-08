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
```

`ACCOUNT_ENFORCE_BALANCE=1` makes managed API keys validate only while the account wallet has a positive balance. Stats reconciles managed-key rows from `usage_history` into wallet debits before `/api/auth/validate`, before protected `/api/user/*` requests, and when the account balance, ledger, or key list is loaded.

This project was created using `bun init` in bun v1.3.11. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
