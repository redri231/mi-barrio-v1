# Mi Barrio API

Small Node API that gives the Expo app a safe path to Render Postgres. PostgreSQL credentials belong only in this server's environment. Never add `DATABASE_URL` to an `EXPO_PUBLIC_*` variable or commit a real connection string.

## Local setup

1. From `server/`, install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the database's **External Database URL** from Render. For external connections, require TLS with `?sslmode=require`.
3. Run `npm run dev`.
4. Check `http://localhost:10000/health/ready`. It returns whether PostgreSQL is connected and whether PostGIS is enabled, without returning the database name or credentials.

Keep `.env` private. Local development runs outside Render's private network, so it must use the external URL and the database's external access rules.

## Deploy on Render

Create a **Web Service** from this repository with:

- **Root Directory:** `server`
- **Build Command:** `npm install`
- **Start Command:** `npm start`
- **Environment:** `DATABASE_URL` set from the database's **Internal Database URL**; `CORS_ORIGINS` set to the deployed web client's origin if web access is needed.

Place the API and database in the same Render region/account, then use the internal URL. Render provides `PORT`; the service binds to `0.0.0.0` and uses that value. Once deployed, set the mobile app's `EXPO_PUBLIC_API_URL` to the API's HTTPS `onrender.com` URL, without a trailing slash.

## Routes

- `GET /health`: process liveness; does not require database availability.
- `GET /health/ready`: database readiness and PostGIS capability check.
- `GET /api/v1/neighborhoods`: reads the public quadrant identifier, district and code from `neighborhood_quadrants`.

The OTP routes in `docs/auth-api-contract.md` still require a server-side SMS provider and account creation flow. They are not stubbed as successful responses.
