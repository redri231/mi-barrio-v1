# Mi Barrio API

Small Node API that gives the Expo app a safe path to Render Postgres. PostgreSQL credentials belong only in this server's environment. Never add `DATABASE_URL` to an `EXPO_PUBLIC_*` variable or commit a real connection string.

## Local setup

1. From `server/`, install dependencies with `npm install`.
2. Copy `.env.example` to `.env` and set `DATABASE_URL` to the database's **External Database URL** from Render. Use `?sslmode=verify-full` for TLS with certificate and hostname validation. The deployed Render service should use the internal URL without this query option.
3. Set `AUTH_TOKEN_SECRET` to a random value of at least 32 characters. For real SMS, set `OTP_PROVIDER=twilio` and the three `TWILIO_*` credentials in `server/.env`. Without provider credentials, leave `OTP_PROVIDER=disabled`; OTP requests return `503` instead of showing a simulated code. Configure `EXPO_PUBLIC_API_URL=http://localhost:10000` in the ignored root `.env.development.local`.
4. Run `npm run dev` from `server/` and `npx expo start` from the project root. Check `http://localhost:10000/health/ready` for PostgreSQL and PostGIS readiness.

The app uses `10.0.2.2` for Android Emulator and the Expo development server's host address for a physical device when the configured API URL is `localhost`. For a physical device, run Expo in LAN mode and allow port 10000 through the computer's firewall; the phone and computer must be on the same network.

Keep `.env` private. Local development runs outside Render's private network, so it must use the external URL and the database's external access rules.

## Deploy on Render

Create a **Web Service** from this repository with:

- **Root Directory:** `server`
- **Region:** Virginia (same region as the existing database)
- **Node Version:** `24.21.0` (`NODE_VERSION`)
- **Build Command:** `npm ci`
- **Start Command:** `npm start`
- **Health Check Path:** `/health/ready`
- **Environment:** `DATABASE_URL` set from the database's **Internal Database URL**, `NODE_ENV=production`, `AUTH_TOKEN_SECRET` set to a random secret of 32+ characters, and `OTP_PROVIDER=twilio` with `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_PHONE_NUMBER` configured as private secrets. If Twilio credentials are not ready, use `OTP_PROVIDER=disabled`; OTP login will remain unavailable. Set `VERIFICATION_REVIEW_TOKEN` only if an authorized operator will use protected review routes. Configure `CORS_ORIGINS` if browser access is needed.
- **Port:** leave `PORT` unset; Render supplies it and the API falls back to `10000` for local use.

Place the API and database in the same Render region/account, then use the internal URL. Render provides `PORT`; the service binds to `0.0.0.0` and uses that value. Once deployed, set the mobile app's `EXPO_PUBLIC_API_URL` to the API's HTTPS `onrender.com` URL, without a trailing slash.

## Routes

- `GET /health`: process liveness; does not require database availability.
- `GET /health/ready`: database readiness and PostGIS capability check.
- `GET /api/v1/neighborhoods`: reads the public quadrant identifier, district and code from `neighborhood_quadrants`.
- `GET /api/v1/profile/me/notification-preferences`: returns the authenticated user's preferences, defaulting to offers/swaps enabled, tutorials disabled and emergency alerts enabled.
- `PUT /api/v1/profile/me/notification-preferences`: saves offers, swaps and tutorial preferences in the existing `user_notification_preferences` table. Emergency alerts remain enabled.
- `GET /api/v1/profile/me/trust-status`: returns received neighbor vouches and the latest residency-review state.
- `POST /api/v1/profile/me/residency-verifications/gps`: assigns a user without a quadrant to the polygon containing their current location, then creates a pending GPS verification. It does not raise their trust tier automatically.
- `POST /api/v1/users/:userId/vouches`: records a single endorsement from a verified neighbor in the same quadrant.
- `GET /api/v1/neighbors`: requires a signed access token and lists up to 100 active users in the signed-in user's quadrant. It returns names and trust tiers only, never phone numbers or exact locations. Users without an assigned quadrant receive an empty directory.
- `GET /api/v1/home/activity`: returns active services, swaps, tools and purchases in the signed-in user's quadrant.
- `GET /api/v1/community/swaps`, `POST /api/v1/community/swaps`, `POST /api/v1/community/swaps/:swapId/interest`, and `POST /api/v1/community/swaps/:swapId/reports`: browse and publish location-checked mutual aid; interest reveals a same-quadrant author's phone only after the user opts in. Posts containing unverified crisis claims are held for moderation.
- `GET /api/v1/community/tools`, `POST /api/v1/community/tools`, `POST /api/v1/community/tools/:toolId/requests`: list, share and request tools in the user's quadrant.
- `GET /api/v1/community/purchases`, `POST /api/v1/community/purchases`, `POST /api/v1/community/purchases/:purchaseId/membership`: manage purchase groups and participant counts transactionally.
- `GET /api/v1/tutorials`, `POST /api/v1/tutorials`, `PUT /api/v1/tutorials/:tutorialId/saved`: read written community guides, publish a text guide as a verified neighbor, and persist the user's offline-save selection.
- `GET /api/v1/emergency/nearby`, `GET /api/v1/emergency/me`, `POST /api/v1/emergency/sos`, `POST /api/v1/emergency/sos/:alertId/reports`, `POST /api/v1/emergency/sos/:alertId/resolve`, `POST /api/v1/emergency/sos/:alertId/cancel`: list quadrant brigades/alerts and persist, report or close a location-checked SOS. Exact alert coordinates are returned to quadrants only after the sender opts in by activating SOS.
- `GET /api/v1/services/nearby`: requires an access token and coordinates with reported accuracy. Returns active services in the user's quadrant, only while the device is inside the validated quadrant. The walking toggle filters a 1 km straight-line radius; expanded search uses 10 km. Exact service coordinates are never returned.
- `GET /api/v1/services/:serviceId`: returns a service's public details and contact phone only to a signed-in neighbor in the same quadrant.
- `GET /api/v1/services/mine`, `PATCH /api/v1/services/:serviceId`: list and edit the signed-in user's ads, or pause/reactivate them without deleting rows. Ads under moderation cannot be edited by their owner.
- `POST /api/v1/services`: creates an active service with the existing `local_services` table. The backend requires a verified user, a non-simulated location inside their quadrant, and accuracy up to 150 m.
- `POST /api/v1/services/:serviceId/vouches`: stores one Visto Bueno per verified neighbor through `vistos_buenos`; the existing database trigger maintains the counter.
- `POST /api/v1/services/:serviceId/reports`: records a community report in `community_reports`; existing uniqueness and moderation triggers govern duplicates and hide thresholds.
- `GET /api/v1/community/my-tool-requests`, `GET /api/v1/community/tools/:toolId/requests`, `PATCH /api/v1/community/tool-requests/:requestId`: check personal requests and let a tool owner accept a loan or mark a return.
- `POST /auth/otp/request`: generates an in-memory, six-digit challenge with a five-minute expiry and sends it through Twilio. It never returns the code.
- `POST /auth/otp/verify`: validates the code on the server, allows at most five wrong attempts per challenge, creates a level-1 user after successful registration verification, or logs in an existing user. It returns a signed access token valid for one hour.

There is no simulated OTP provider. The app does not display demo codes. Challenges, rate limits and verification states stay in process memory; restarting the server clears them, so use a shared store before deploying multiple instances. With `OTP_PROVIDER=disabled`, OTP endpoints return `503` until Twilio credentials are configured.

The current PostgreSQL schema has no OTP challenge table. OTP lifecycle states (`pending`, `verified`, `expired`, `locked`, `consumed`) therefore remain transient in memory; `residency_verifications.status` belongs to residency review and is not used for authentication. No tables or migrations were changed. The `users` insert uses existing fields and hashes the app's persistent installation UUID into `hardware_device_hash`.

The provider contract lives behind `createOtpProvider()`. Twilio is the current real SMS adapter; another provider can be added behind the same contract without changing the mobile routes. Private endpoints validate the signed access token with the shared authentication middleware.

Moderation and trust-level approvals are manual and require `VERIFICATION_REVIEW_TOKEN` set to a random secret of at least 32 characters in the API environment. Send it only from an authorized operator through `x-verification-review-token`. `PATCH /api/v1/admin/residency-verifications/:verificationId` accepts `{"status":"approved"}` or `{"status":"purged"}`; approval promotes an active level-1 user to level 2. `PATCH /api/v1/admin/community/:contentType/:contentId/review` accepts `{"status":"active"}` or `{"status":"blocked"}` for held services/swaps. `POST /api/v1/admin/users/:userId/approve-tier-3` requires three unique same-quadrant vouches; an operator must separately verify the user's identity before calling it. Optional `brigade_specialty` also registers an active brigade. `PATCH /api/v1/admin/emergency/sos/:alertId/review` can close an alert as resolved or confirmed false alarm; confirmed false alarms suspend the sender. `PATCH /api/v1/admin/users/:userId/suspension` can also suspend or reinstate an account. The schema has no admin audit table, so operational review records must be kept outside PostgreSQL.

The neighborhood mutation rate limiter is in process memory and resets on restart; use a shared limiter if deploying multiple instances. Database schema was not modified.

The Expo app requests foreground location only when a user searches, publishes, submits residency verification, or activates SOS. Set no additional public environment variable for location. `expo-location` is configured with a while-in-use permission message in the root `app.json`. Exact points are used only for server-side geofence checks and SOS storage; ordinary listings omit exact coordinates. The distance shown in the MVP is a straight-line estimate, not a routed walking distance. Mock-location flags are checked by the app and API, but client-reported device signals are not a substitute for platform attestation.

The SOS endpoint records an alert and shares its exact point with authenticated users in the same quadrant after the sender opts in. The app polls the active-alert endpoint every 15 seconds while the emergency screen is open; there are no background or push notifications, and `sos_alerts.notified_neighbors_count` stays zero. Offline Bluetooth/Wi-Fi mesh is not implemented. The app provides direct phone links for Peru's police (105), firefighters (116) and SAMU (106). Do not present the database record as a delivered alert outside the open app screen.
