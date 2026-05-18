# Order Expenses

Privacy-first personal expense dashboard for Banco de Chile Gmail movements.

## What it does

- Connects Gmail with read-only OAuth.
- Reads Banco de Chile transactional emails for the selected period.
- Parses movements at runtime instead of storing every Gmail-derived expense permanently.
- Stores only local configuration and user-authored data:
  - OAuth sessions/tokens/profile data
  - manual movements
  - movement corrections/overrides
  - hidden movement flags
  - category rules by counterparty
  - custom categories and colors
  - view/budget preferences where applicable

## Requirements

- Node.js >= 24
- Gmail API OAuth credentials

## Install

```bash
npm install
```

## Run locally

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

For development with watch mode:

```bash
npm run dev
```

## Test

```bash
npm test
```

## Gmail setup

See [`GMAIL_SETUP.md`](./GMAIL_SETUP.md).

## Local data

By default the app stores local runtime/configuration data in:

```text
data/finance.db
```

The `data/` folder is intentionally ignored by git because it can contain private financial data and OAuth credentials.

## Important privacy note

This app is designed so Gmail-derived expenses are parsed for the current view/period and are not stored as a permanent full transaction history. User-created configuration, rules, manual movements, and corrections are stored locally so the app can remember the user's decisions.
