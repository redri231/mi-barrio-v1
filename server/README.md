# Mi Barrio API

Small Node API that gives the Expo app a safe path to Render Postgres. PostgreSQL credentials belong only in this server's environment. Never add `DATABASE_URL` to an `EXPO_PUBLIC_*` variable or commit a real connection string.

## Local setup

1. From `server/`, install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the database's **External Database URL** from Render. Use `?sslmode=verify-full` for TLS with certificate and hostname validation. The deployed Render service should use the internal URL without this query option.
3. Run `npm run dev`.
4. Check `http://localhost:10000/health/ready`. It returns whether PostgreSQL is connected and whether PostGIS is enabled, without returning the database name or credentials.

Keep `.env` private. Local development runs outside Render's private network, so it must use the external URL and the database's external access rules.

## Deploy on Render

Create a **Web Service** from this repository with:

- **Root Directory:** `server`
- **Region:** Virginia (same region as the existing database)
- **Node Version:** `24.21.0` (`NODE_VERSION`)
- **Build Command:** `npm ci`
- **Start Command:** `npm start`
- **Health Check Path:** `/health/ready`
- **Environment:** `DATABASE_URL` set from the database's **Internal Database URL** and `NODE_ENV=production`; set `CORS_ORIGINS` to the deployed web client's origin if browser access is needed.
- **Port:** leave `PORT` unset; Render supplies it and the API falls back to `10000` for local use.

Place the API and database in the same Render region/account, then use the internal URL. Render provides `PORT`; the service binds to `0.0.0.0` and uses that value. Once deployed, set the mobile app's `EXPO_PUBLIC_API_URL` to the API's HTTPS `onrender.com` URL, without a trailing slash.

## Routes

- `GET /health`: process liveness; does not require database availability.
- `GET /health/ready`: database readiness and PostGIS capability check.
- `GET /api/v1/neighborhoods`: reads the public quadrant identifier, district and code from `neighborhood_quadrants`.
- `POST /auth/otp/request` and `POST /auth/otp/verify`: return `501` until an SMS verification provider and challenge flow are configured; they never accept a demo code.

The OTP contract in `docs/auth-api-contract.md` still requires a server-side SMS provider and account creation flow. No successful OTP response is stubbed.
