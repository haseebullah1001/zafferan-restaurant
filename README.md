# Zafferan API

The backend is an Express REST API using PostgreSQL. It owns authentication, user data, menu data, and order price calculation. Neon is the recommended free hosted database.

## Commands

```powershell
npm install
$env:DATABASE_URL = 'postgresql://user:password@host/database?sslmode=require'
npm run dev   # reload on source changes
npm start     # normal server
npm test      # isolated in-memory API tests
```

The health endpoint is `GET http://localhost:3000/health`. API routes are under `/api/v1`. Database tables and sample data are created automatically at startup.

## Data and security

- Passwords are hashed with bcrypt.
- Access tokens are random opaque values; only SHA-256 hashes are stored.
- Sessions expire after 30 days by default and are revoked on logout or password reset.
- Every address, favorite, order, notification, and profile query is scoped to the authenticated user.
- Order prices are loaded from the database. Client-supplied totals are ignored.
- `Idempotency-Key` prevents duplicate orders when the app retries a checkout request.
- Auth and password-reset routes have a basic in-memory rate limit.

For production, place the service behind HTTPS, set `NODE_ENV=production`, replace the development OTP flow with an SMS provider, restrict `CORS_ORIGIN`, and use managed backups for the database (or migrate the schema to a managed SQL service).
