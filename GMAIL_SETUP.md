# Gmail OAuth setup

This app reads Banco de Chile emails through Gmail with read-only OAuth. It is privacy-first: Gmail-derived movements are parsed at runtime for the selected period and are not stored as a permanent transaction history. The app stores local configuration such as OAuth tokens, category rules, custom categories, manual movements, and per-movement corrections/overrides.

The local server binds to `127.0.0.1` by default because it handles private finance and Gmail data.

## 1. Create Google credentials

1. Go to Google Cloud Console.
2. Create/select a project.
3. Enable **Gmail API**.
4. Configure OAuth consent screen in **Testing** mode.
5. Add your Gmail account as a test user.
6. Create an OAuth client:
   - Type: **Web application**
   - Authorized redirect URI for local use: `http://127.0.0.1:3000/auth/google/callback`
7. Download the JSON credentials.

## 2. Save credentials locally

Save the downloaded file as:

```text
data/google-credentials.json
```

The `data/` folder is ignored by git.

## 3. Run and connect

```bash
npm start
```

Open:

```text
http://127.0.0.1:3000
```

Then press:

```text
Conectar Gmail
```

OAuth tokens, profile data, sessions, category rules, custom categories, manual movements, and movement overrides are stored in the local SQLite database configured by `DB_PATH` or the default:

```text
data/finance.db
```

## Useful environment variables

```bash
PORT=3000
HOST=127.0.0.1
DB_PATH=data/finance.db
GOOGLE_CREDENTIALS_PATH=data/google-credentials.json
```

For a QA/public URL, configure these explicitly:

```bash
HOST=0.0.0.0
ALLOW_UNSAFE_HOST=true
APP_BASE_URL=https://your-qa-domain.example
GOOGLE_REDIRECT_URI=https://your-qa-domain.example/auth/google/callback
COOKIE_SECURE=true
```

Only use non-loopback hosting if you understand the privacy and security implications.

## Security notes

- OAuth uses a per-session `state` value stored in SQLite to validate callbacks.
- Tokens are scoped by user email and stored locally in SQLite.
- Gmail search is limited to Banco de Chile transactional messages for the selected period.
- The app does not expose arbitrary Gmail search through the UI/API.
- Do not commit `data/`, database files, credentials, OAuth tokens, or local Pi runtime caches.

## Scope used

```text
https://www.googleapis.com/auth/gmail.readonly
```

The app only reads Gmail messages. It does not send, delete, or modify emails.
