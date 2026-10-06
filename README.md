# Zafferan API

The backend is an Express REST API using PostgreSQL. It owns authentication, user data, menu data, and order price calculation. Neon is the recommended free hosted database.

## Live API

The production API runs as a Neon Function:

```text
https://br-frosty-pond-b5rm1um5-api.compute.c-7.us-east-2.aws.neon.tech
```

- Health check: `/health`
- API base URL: `/api/v1`
- Runtime: Node.js 24
- Database: PostgreSQL 18 on the same Neon branch

## Commands

```powershell
npm install
$env:DATABASE_URL = 'postgresql://user:password@host/database?sslmode=require'
npm run dev   # reload on source changes
npm start     # normal server
npm test      # isolated in-memory API tests
```

The health endpoint is `GET http://localhost:3000/health`. API routes are under `/api/v1`. Database tables and sample data are created automatically at startup.

## Deploy to Neon Functions

Authenticate and link the repository once:

```powershell
neon auth
neon link --project-id curly-base-08899469 --branch production -y --no-env-pull --no-config
```

Deploy the Fetch-compatible Express entry point:

```powershell
neon functions deploy api --src src/function.js --runtime nodejs24 --wait
```

Neon injects `DATABASE_URL` automatically. Configure production environment values with repeated `--env KEY=VALUE` flags when they change. Never commit the database password or password-reset secret.

## Data and security

- Passwords are hashed with bcrypt.
- Access tokens are random opaque values; only SHA-256 hashes are stored.
- Sessions expire after 30 days by default and are revoked on logout or password reset.
- Every address, favorite, order, notification, and profile query is scoped to the authenticated user.
- Order prices are loaded from the database. Client-supplied totals are ignored.
- `Idempotency-Key` prevents duplicate orders when the app retries a checkout request.
- Auth and password-reset routes have a basic in-memory rate limit.

For production, replace the development OTP flow with an SMS provider, restrict `CORS_ORIGIN` if a browser frontend is added, and configure managed backups. The live deployment uses an undisclosed reset secret, so password reset remains unavailable to end users until an SMS provider is connected.
