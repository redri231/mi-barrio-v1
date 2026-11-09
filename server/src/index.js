import 'dotenv/config';

import { createHmac, timingSafeEqual } from 'node:crypto';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { checkDatabase, pool } from './db.js';
import { createOtpProvider } from './otp-provider.js';
import { clearExpiredChallenges, consumeChallenge, issueChallenge, OtpError, validateOtpRequest, verifyChallenge } from './otp.js';
const otpProvider = createOtpProvider();
const cleanupTimer = setInterval(clearExpiredChallenges, 60_000);
cleanupTimer.unref();
const authTokenSecret = process.env.AUTH_TOKEN_SECRET;
if (!authTokenSecret || authTokenSecret.length < 32) {
  throw new Error('AUTH_TOKEN_SECRET must contain at least 32 random characters.');
}
const app = express();
const port = Number(process.env.PORT ?? 10000);
const allowedOrigins = new Set((process.env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean));
const serviceCategories = new Set(['gasfiteria', 'electricidad', 'cerrajeria', 'mascotas', 'clases', 'tiendas', 'otros']);
const uuidPattern = /^[0-9a-f-]{36}$/i;
const mutationWindows = new Map();

function limitMutations({ windowMs = 60_000, max = 10 } = {}) {
  return (request, response, next) => {
    const key = `${request.auth?.userId ?? request.ip}:${request.baseUrl}${request.path}`;
    const now = Date.now();
    if (mutationWindows.size > 5_000) {
      for (const [entryKey, entry] of mutationWindows) if (entry.resetAt <= now) mutationWindows.delete(entryKey);
    }
    const current = mutationWindows.get(key);
    if (!current || current.resetAt <= now) {
      mutationWindows.set(key, { count: 1, resetAt: now + windowMs });
      return next();
    }
    current.count += 1;
    if (current.count > max) return response.status(429).json({ error: 'RATE_LIMITED', message: 'Hiciste muchas solicitudes. Espera un momento e inténtalo de nuevo.' });
    return next();
  };
}

function parseCoordinates(input, maxAccuracy = 250) {
  const latitude = Number(input?.latitude);
  const longitude = Number(input?.longitude);
  const accuracy = Number(input?.accuracy_m);
  if (input?.mocked === true || input?.mocked === 'true') return { error: 'No se aceptan ubicaciones simuladas.' };
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90 || !Number.isFinite(longitude) || longitude < -180 || longitude > 180
    || !Number.isFinite(accuracy) || accuracy < 0 || accuracy > maxAccuracy) return { error: 'Activa una ubicación precisa para continuar.' };
  return { latitude, longitude, accuracy };
}

app.disable('x-powered-by');
app.set('trust proxy', process.env.TRUST_PROXY === 'true' ? 1 : false);
app.use(helmet());
app.use(cors({
  origin(origin, callback) {
    if (!origin || allowedOrigins.has(origin)) return callback(null, true);
    return callback(new Error('Origin is not allowed by CORS.'));
  },
}));
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_request, response) => response.json({ status: 'ok' }));

app.get('/health/ready', async (_request, response) => {
  try {
    const database = await checkDatabase();
    if (!database.postgisEnabled) return response.status(503).json({ status: 'degraded', database });
    return response.json({ status: 'ok', database });
  } catch {
    return response.status(503).json({ status: 'unavailable', database: { connected: false } });
  }
});

app.get('/api/v1/neighborhoods', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT quadrant_id, district_name, quadrant_code
      FROM neighborhood_quadrants
      ORDER BY district_name, quadrant_code
      LIMIT 500
    `);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'Neighborhood data is temporarily unavailable.' });
  }
});

function createAccessToken(user) {
  const now = Math.floor(Date.now() / 1000);
  const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
  const unsigned = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({
    sub: user.user_id,
    phone_number: user.phone_number,
    tier: user.tier,
    iat: now,
    exp: now + 60 * 60,
  })}`;
  const signature = createHmac('sha256', authTokenSecret).update(unsigned).digest('base64url');
  return `${unsigned}.${signature}`;
}

async function requireAccessToken(request, response, next) {
  if (!authTokenSecret) {
    return response.status(503).json({ error: 'AUTH_NOT_CONFIGURED', message: 'La autenticación no está disponible.' });
  }
  const [scheme, token] = (request.get('authorization') ?? '').split(' ');
  if (scheme !== 'Bearer' || !token) {
    return response.status(401).json({ error: 'AUTH_REQUIRED', message: 'Inicia sesión para consultar tu perfil.' });
  }
  let claims;
  try {
    const [encodedHeader, encodedPayload, encodedSignature, extra] = token.split('.');
    if (!encodedHeader || !encodedPayload || !encodedSignature || extra !== undefined) throw new Error('Invalid token.');
    const header = JSON.parse(Buffer.from(encodedHeader, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
    const expectedSignature = createHmac('sha256', authTokenSecret)
      .update(`${encodedHeader}.${encodedPayload}`)
      .digest();
    const providedSignature = Buffer.from(encodedSignature, 'base64url');
    if (header.alg !== 'HS256' || providedSignature.length !== expectedSignature.length
      || !timingSafeEqual(providedSignature, expectedSignature)
      || typeof claims.sub !== 'string' || !/^[0-9a-f-]{36}$/i.test(claims.sub)
      || typeof claims.exp !== 'number' || claims.exp <= Math.floor(Date.now() / 1000)) {
      throw new Error('Invalid or expired token.');
    }
  } catch {
    return response.status(401).json({ error: 'AUTH_INVALID', message: 'Tu sesión venció. Inicia sesión nuevamente.' });
  }
  try {
    const user = await pool.query('SELECT is_suspended FROM users WHERE user_id = $1 LIMIT 1', [claims.sub]);
    if (!user.rowCount) return response.status(401).json({ error: 'AUTH_USER_NOT_FOUND', message: 'Tu cuenta ya no está disponible.' });
    if (user.rows[0].is_suspended) return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' });
    request.auth = { userId: claims.sub };
    return next();
  } catch {
    return response.status(503).json({ error: 'AUTH_UNAVAILABLE', message: 'No pudimos verificar tu sesión. Inténtalo nuevamente.' });
  }
}

app.get('/api/v1/profile/me', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT
        u.user_id,
        u.full_name,
        u.tier,
        u.joined_at,
        u.is_suspended,
        q.district_name,
        q.quadrant_code,
        (
          SELECT COUNT(*)::int
          FROM vistos_buenos vb
          JOIN local_services service ON service.service_id = vb.service_id
          WHERE service.provider_id = u.user_id
        ) AS recommendations_received
      FROM users u
      LEFT JOIN neighborhood_quadrants q ON q.quadrant_id = u.quadrant_id
      WHERE u.user_id = $1
      LIMIT 1
    `, [request.auth.userId]);
    const user = result.rows[0];
    if (!user) return response.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'No encontramos tu perfil.' });
    if (user.is_suspended) return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' });
    return response.json({
      id: user.user_id,
      full_name: user.full_name,
      tier: user.tier,
      joined_at: user.joined_at,
      district_name: user.district_name,
      quadrant_code: user.quadrant_code,
      recommendations_received: user.recommendations_received,
    });
  } catch {
    return response.status(503).json({ error: 'PROFILE_UNAVAILABLE', message: 'No pudimos cargar tu perfil. Inténtalo nuevamente.' });
  }
});

app.get('/api/v1/profile/me/notification-preferences', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT notify_offers, notify_swaps, notify_tutorials, TRUE AS notify_emergency_sos
      FROM user_notification_preferences
      WHERE user_id = $1
      LIMIT 1
    `, [request.auth.userId]);
    return response.json(result.rows[0] ?? {
      notify_offers: true,
      notify_swaps: true,
      notify_tutorials: false,
      notify_emergency_sos: true,
    });
  } catch {
    return response.status(503).json({ error: 'PREFERENCES_UNAVAILABLE', message: 'No pudimos cargar tus preferencias de avisos.' });
  }
});

app.put('/api/v1/profile/me/notification-preferences', requireAccessToken, async (request, response) => {
  const { notify_offers: notifyOffers, notify_swaps: notifySwaps, notify_tutorials: notifyTutorials } = request.body ?? {};
  if (typeof notifyOffers !== 'boolean' || typeof notifySwaps !== 'boolean' || typeof notifyTutorials !== 'boolean') {
    return response.status(400).json({ error: 'INVALID_NOTIFICATION_PREFERENCES', message: 'Selecciona tus preferencias de avisos.' });
  }
  try {
    const result = await pool.query(`
      INSERT INTO user_notification_preferences (user_id, notify_offers, notify_swaps, notify_tutorials, notify_emergency_sos)
      VALUES ($1, $2, $3, $4, TRUE)
      ON CONFLICT (user_id) DO UPDATE SET
        notify_offers = EXCLUDED.notify_offers,
        notify_swaps = EXCLUDED.notify_swaps,
        notify_tutorials = EXCLUDED.notify_tutorials,
        notify_emergency_sos = TRUE
      RETURNING notify_offers, notify_swaps, notify_tutorials, notify_emergency_sos
    `, [request.auth.userId, notifyOffers, notifySwaps, notifyTutorials]);
    return response.json({ ...result.rows[0], notify_emergency_sos: true });
  } catch {
    return response.status(503).json({ error: 'PREFERENCES_UNAVAILABLE', message: 'No pudimos guardar tus preferencias de avisos.' });
  }
});

app.get('/api/v1/profile/me/trust-status', requireAccessToken, async (request, response) => {
  try {
    const [vouches, verification] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS count FROM user_vouches WHERE vouched_user_id = $1', [request.auth.userId]),
      pool.query(`SELECT status, submitted_at FROM residency_verifications WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 1`, [request.auth.userId]),
    ]);
    return response.json({ vouches_received: vouches.rows[0].count, residency_verification: verification.rows[0] ?? null });
  } catch {
    return response.status(503).json({ error: 'TRUST_STATUS_UNAVAILABLE', message: 'No pudimos cargar el estado de verificación.' });
  }
});

app.post('/api/v1/profile/me/residency-verifications/gps', requireAccessToken, limitMutations({ windowMs: 60 * 60_000, max: 3 }), async (request, response) => {
  const coordinates = parseCoordinates(request.body, 100);
  if (coordinates.error) return response.status(400).json({ error: 'INVALID_LOCATION', message: coordinates.error });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const profileResult = await client.query(`
      SELECT u.tier, u.quadrant_id, u.is_suspended,
        COALESCE(ST_Covers(assigned.polygon_geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)), FALSE) AS inside_assigned,
        (SELECT q.quadrant_id FROM neighborhood_quadrants q
          WHERE ST_Covers(q.polygon_geom, ST_SetSRID(ST_MakePoint($3, $2), 4326))
          ORDER BY q.district_name, q.quadrant_code LIMIT 1) AS located_quadrant_id
      FROM users u LEFT JOIN neighborhood_quadrants assigned ON assigned.quadrant_id = u.quadrant_id
      WHERE u.user_id = $1 FOR UPDATE OF u
    `, [request.auth.userId, coordinates.latitude, coordinates.longitude]);
    const user = profileResult.rows[0];
    if (!user || user.is_suspended) {
      await client.query('ROLLBACK');
      return response.status(user ? 403 : 404).json({ error: user ? 'ACCOUNT_SUSPENDED' : 'PROFILE_NOT_FOUND', message: user ? 'Esta cuenta está suspendida.' : 'No encontramos tu perfil.' });
    }
    if (user.tier !== 'level_1_basic') {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'ALREADY_VERIFIED', message: 'Tu cuenta ya alcanzó el nivel de residencia validada.' });
    }
    if (!user.quadrant_id && !user.located_quadrant_id) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'NO_QUADRANT_MATCH', message: 'Tu ubicación no está dentro de un cuadrante registrado. Contacta al equipo de Mi Barrio.' });
    }
    if (user.quadrant_id && !user.inside_assigned) {
      await client.query('ROLLBACK');
      return response.status(403).json({ error: 'LOCATION_OUTSIDE_QUADRANT', message: 'Debes estar dentro de tu cuadrante asignado para solicitar la verificación.' });
    }
    const quadrantId = user.quadrant_id ?? user.located_quadrant_id;
    if (!user.quadrant_id) await client.query('UPDATE users SET quadrant_id = $2, updated_at = NOW() WHERE user_id = $1', [request.auth.userId, quadrantId]);
    const pending = await client.query(`SELECT verification_id FROM residency_verifications WHERE user_id = $1 AND status = 'pending' LIMIT 1`, [request.auth.userId]);
    if (pending.rowCount) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'VERIFICATION_PENDING', message: 'Ya tienes una verificación de residencia pendiente.' });
    }
    const result = await client.query(`
      INSERT INTO residency_verifications (user_id, document_type, status)
      VALUES ($1, 'gps_passive', 'pending')
      RETURNING verification_id AS id, status, submitted_at
    `, [request.auth.userId]);
    await client.query('COMMIT');
    return response.status(202).json({ verification: result.rows[0], message: 'La solicitud quedó pendiente de revisión; la ubicación por sí sola no cambia tu nivel.' });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'VERIFICATION_UNAVAILABLE', message: 'No pudimos enviar la solicitud de residencia.' });
  } finally { client.release(); }
});

app.post('/api/v1/users/:userId/vouches', requireAccessToken, limitMutations({ windowMs: 60 * 60_000, max: 10 }), async (request, response) => {
  if (!uuidPattern.test(request.params.userId)) return response.status(400).json({ error: 'INVALID_USER_ID', message: 'El vecino no es válido.' });
  if (request.params.userId === request.auth.userId) return response.status(400).json({ error: 'SELF_VOUCH', message: 'No puedes darte un aval a ti mismo.' });
  try {
    const result = await pool.query(`
      INSERT INTO user_vouches (vouched_user_id, voucher_user_id)
      SELECT target.user_id, voter.user_id
      FROM users target JOIN users voter ON voter.user_id = $2
      WHERE target.user_id = $1 AND target.quadrant_id = voter.quadrant_id
        AND target.quadrant_id IS NOT NULL AND target.is_suspended = FALSE AND voter.is_suspended = FALSE
        AND voter.tier <> 'level_1_basic'
      ON CONFLICT (vouched_user_id, voucher_user_id) DO NOTHING
      RETURNING vouch_id
    `, [request.params.userId, request.auth.userId]);
    if (!result.rowCount) return response.status(409).json({ error: 'VOUCH_NOT_ACCEPTED', message: 'El aval requiere vecinos validados del mismo cuadrante y solo puede darse una vez.' });
    const count = await pool.query('SELECT COUNT(*)::int AS count FROM user_vouches WHERE vouched_user_id = $1', [request.params.userId]);
    return response.status(201).json({ vouched: true, vouches_received: count.rows[0].count });
  } catch {
    return response.status(503).json({ error: 'VOUCH_UNAVAILABLE', message: 'No pudimos registrar el aval vecinal.' });
  }
});

app.get('/api/v1/services/nearby', requireAccessToken, async (request, response) => {
  const { latitude, longitude, accuracy_m: accuracy, mocked, category: requestedCategory, q } = request.query;
  const lat = Number(latitude);
  const lon = Number(longitude);
  const accuracyMeters = Number(accuracy);
  if (typeof mocked === 'string' && mocked.toLowerCase() === 'true') return response.status(403).json({ error: 'MOCK_LOCATION', message: 'No podemos usar una ubicación simulada para buscar oficios.' });
  if (typeof latitude !== 'string' || typeof longitude !== 'string'
    || !Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 250) {
    return response.status(400).json({ error: 'INVALID_LOCATION', message: 'Activa una ubicación precisa para buscar oficios cercanos.' });
  }
  if (requestedCategory !== undefined && (typeof requestedCategory !== 'string' || !serviceCategories.has(requestedCategory))) {
    return response.status(400).json({ error: 'INVALID_CATEGORY', message: 'Selecciona una categoría válida.' });
  }
  if (q !== undefined && (typeof q !== 'string' || q.length > 80)) {
    return response.status(400).json({ error: 'INVALID_SEARCH', message: 'La búsqueda debe tener menos de 80 caracteres.' });
  }
  try {
    const userResult = await pool.query(`
      SELECT u.quadrant_id, u.is_suspended,
        COALESCE(ST_Covers(q.polygon_geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)), FALSE) AS inside_quadrant
      FROM users u
      LEFT JOIN neighborhood_quadrants q ON q.quadrant_id = u.quadrant_id
      WHERE u.user_id = $1
      LIMIT 1
    `, [request.auth.userId, lat, lon]);
    const user = userResult.rows[0];
    if (!user) return response.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'No encontramos tu perfil.' });
    if (user.is_suspended) return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' });
    if (!user.quadrant_id) return response.status(409).json({ error: 'QUADRANT_REQUIRED', message: 'Confirma tu barrio para ver los oficios de tu comunidad.' });
    if (!user.inside_quadrant) return response.status(403).json({ error: 'LOCATION_OUTSIDE_QUADRANT', message: 'Debes estar dentro de tu cuadrante validado para buscar oficios.' });

    const walkingOnly = request.query.walking_only !== 'false';
    const result = await pool.query(`
      SELECT
        s.service_id AS id,
        provider.full_name AS provider_name,
        provider.tier AS provider_tier,
        s.title,
        s.category,
        s.visto_bueno_count AS recommendations,
        s.created_at,
        ROUND(ST_Distance(s.service_location::geography, origin.point))::int AS distance_m
      FROM local_services s
      JOIN users provider ON provider.user_id = s.provider_id
      CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($4, $3), 4326)::geography AS point) origin
      WHERE provider.quadrant_id = $1
        AND provider.is_suspended = FALSE
        AND s.status = 'active'
        AND ($5::service_category_enum IS NULL OR s.category = $5)
        AND ($6 = '' OR (s.title || ' ' || provider.full_name) ILIKE '%' || $6 || '%')
        AND ST_DWithin(s.service_location::geography, origin.point, $7)
      ORDER BY ST_Distance(s.service_location::geography, origin.point), s.created_at DESC
      LIMIT 100
    `, [user.quadrant_id, request.auth.userId, lat, lon, requestedCategory ?? null, q ?? '', walkingOnly ? 1000 : 10_000]);
    return response.json({ data: result.rows, radius_m: walkingOnly ? 1000 : 10_000 });
  } catch {
    return response.status(503).json({ error: 'SERVICES_UNAVAILABLE', message: 'No pudimos cargar los oficios cercanos. Inténtalo nuevamente.' });
  }
});

app.get('/api/v1/services/:serviceId', requireAccessToken, async (request, response, next) => {
  if (request.params.serviceId === 'mine') return next('route');
  if (!uuidPattern.test(request.params.serviceId)) return response.status(400).json({ error: 'INVALID_SERVICE_ID', message: 'El oficio solicitado no es válido.' });
  try {
    const result = await pool.query(`
      SELECT
        s.service_id AS id,
        provider.full_name AS provider_name,
        provider.tier AS provider_tier,
        s.title,
        s.category,
        s.description,
        s.contact_phone,
        s.visto_bueno_count AS recommendations,
        s.created_at,
        provider.quadrant_id AS provider_quadrant_id,
        viewer.quadrant_id AS viewer_quadrant_id
      FROM local_services s
      JOIN users provider ON provider.user_id = s.provider_id
      JOIN users viewer ON viewer.user_id = $2
      WHERE s.service_id = $1
        AND s.status = 'active'
        AND provider.quadrant_id = viewer.quadrant_id
        AND provider.is_suspended = FALSE
        AND viewer.is_suspended = FALSE
      LIMIT 1
    `, [request.params.serviceId, request.auth.userId]);
    const service = result.rows[0];
    if (!service) return response.status(404).json({ error: 'SERVICE_NOT_FOUND', message: 'Este oficio ya no está disponible en tu cuadrante.' });
    return response.json({
      id: service.id,
      provider_name: service.provider_name,
      provider_tier: service.provider_tier,
      title: service.title,
      category: service.category,
      description: service.description,
      contact_phone: service.contact_phone,
      recommendations: service.recommendations,
      created_at: service.created_at,
    });
  } catch {
    return response.status(503).json({ error: 'SERVICE_UNAVAILABLE', message: 'No pudimos abrir este oficio. Inténtalo nuevamente.' });
  }
});

app.post('/api/v1/services', requireAccessToken, async (request, response) => {
  const { title: rawTitle, category, description: rawDescription, latitude, longitude, accuracy_m: accuracy, mocked } = request.body ?? {};
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  const lat = Number(latitude);
  const lon = Number(longitude);
  const accuracyMeters = Number(accuracy);
  if (title.length < 3 || title.length > 100 || description.length < 3 || description.length > 2000
    || typeof category !== 'string' || !serviceCategories.has(category)) {
    return response.status(400).json({ error: 'INVALID_SERVICE', message: 'Completa el oficio, la categoría y una descripción breve.' });
  }
  if (mocked === true) return response.status(403).json({ error: 'MOCK_LOCATION', message: 'No podemos publicar un oficio desde una ubicación simulada.' });
  if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lon) || lon < -180 || lon > 180
    || !Number.isFinite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 150) {
    return response.status(400).json({ error: 'INVALID_LOCATION', message: 'Necesitamos una ubicación precisa para publicar dentro de tu barrio.' });
  }
  try {
    const eligibility = await pool.query(`
      SELECT
        u.user_id,
        u.tier,
        u.phone_number,
        u.quadrant_id,
        u.is_suspended,
        COALESCE(ST_Covers(q.polygon_geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)), FALSE) AS inside_quadrant
      FROM users u
      LEFT JOIN neighborhood_quadrants q ON q.quadrant_id = u.quadrant_id
      WHERE u.user_id = $1
      LIMIT 1
    `, [request.auth.userId, lat, lon]);
    const user = eligibility.rows[0];
    if (!user) return response.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'No encontramos tu perfil.' });
    if (user.is_suspended) return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' });
    if (!user.quadrant_id) return response.status(409).json({ error: 'QUADRANT_REQUIRED', message: 'Confirma tu residencia antes de publicar un oficio.' });
    if (user.tier === 'level_1_basic') return response.status(403).json({ error: 'VERIFIED_NEIGHBOR_REQUIRED', message: 'Confirma que vives en el barrio antes de publicar.' });
    if (!user.inside_quadrant) return response.status(403).json({ error: 'LOCATION_OUTSIDE_QUADRANT', message: 'Solo puedes publicar un oficio desde tu cuadrante validado.' });

    const result = await pool.query(`
      INSERT INTO local_services (provider_id, title, category, description, contact_phone, service_location)
      VALUES ($1, $2, $3::service_category_enum, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326))
      RETURNING service_id AS id, title, category, status, created_at
    `, [request.auth.userId, title, category, description, user.phone_number, lat, lon]);
    return response.status(201).json({ service: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'SERVICE_CREATE_UNAVAILABLE', message: 'No pudimos publicar tu oficio. Inténtalo nuevamente.' });
  }
});

app.get('/api/v1/services/mine', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT service_id AS id, title, category, description, visto_bueno_count AS recommendations, status, created_at
      FROM local_services WHERE provider_id = $1 ORDER BY created_at DESC LIMIT 100
    `, [request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'MY_SERVICES_UNAVAILABLE', message: 'No pudimos cargar tus publicaciones.' });
  }
});

app.patch('/api/v1/services/:serviceId', requireAccessToken, limitMutations({ max: 20 }), async (request, response) => {
  if (!uuidPattern.test(request.params.serviceId)) return response.status(400).json({ error: 'INVALID_SERVICE_ID', message: 'El oficio no es válido.' });
  const { title: rawTitle, category, description: rawDescription, status } = request.body ?? {};
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const description = typeof rawDescription === 'string' ? rawDescription.trim() : '';
  if (title.length < 3 || title.length > 100 || description.length < 3 || description.length > 2000 || !serviceCategories.has(category) || !['active', 'resolved'].includes(status)) {
    return response.status(400).json({ error: 'INVALID_SERVICE_UPDATE', message: 'Revisa el título, categoría, descripción y estado.' });
  }
  try {
    const result = await pool.query(`
      UPDATE local_services SET title = $3, category = $4::service_category_enum, description = $5, status = $6, updated_at = NOW()
      WHERE service_id = $1 AND provider_id = $2 AND status IN ('active', 'resolved')
      RETURNING service_id AS id, title, category, description, visto_bueno_count AS recommendations, status
    `, [request.params.serviceId, request.auth.userId, title, category, description, status]);
    if (!result.rowCount) return response.status(404).json({ error: 'SERVICE_NOT_EDITABLE', message: 'La publicación no existe o está en revisión.' });
    return response.json({ service: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'SERVICE_UPDATE_UNAVAILABLE', message: 'No pudimos actualizar tu oficio.' });
  }
});

app.post('/api/v1/services/:serviceId/vouches', requireAccessToken, async (request, response) => {
  if (!uuidPattern.test(request.params.serviceId)) return response.status(400).json({ error: 'INVALID_SERVICE_ID', message: 'El oficio solicitado no es válido.' });
  let client;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    const voterResult = await client.query(
      'SELECT tier, quadrant_id, is_suspended FROM users WHERE user_id = $1 FOR UPDATE',
      [request.auth.userId],
    );
    const voter = voterResult.rows[0];
    if (!voter || voter.is_suspended) {
      await client.query('ROLLBACK');
      return response.status(voter ? 403 : 404).json({ error: voter ? 'ACCOUNT_SUSPENDED' : 'PROFILE_NOT_FOUND', message: voter ? 'Esta cuenta está suspendida.' : 'No encontramos tu perfil.' });
    }
    if (voter.tier === 'level_1_basic') {
      await client.query('ROLLBACK');
      return response.status(403).json({ error: 'VERIFIED_NEIGHBOR_REQUIRED', message: 'Solo los vecinos validados pueden dar Visto Bueno.' });
    }
    const serviceResult = await client.query(`
      SELECT provider.quadrant_id, service.status
      FROM local_services service
      JOIN users provider ON provider.user_id = service.provider_id
      WHERE service.service_id = $1
      FOR UPDATE OF service
    `, [request.params.serviceId]);
    const service = serviceResult.rows[0];
    if (!service || service.status !== 'active') {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'SERVICE_NOT_FOUND', message: 'Este oficio ya no está disponible.' });
    }
    if (!voter.quadrant_id || voter.quadrant_id !== service.quadrant_id) {
      await client.query('ROLLBACK');
      return response.status(403).json({ error: 'SAME_QUADRANT_REQUIRED', message: 'Solo puedes recomendar oficios de tu mismo cuadrante.' });
    }
    const insertResult = await client.query(`
      INSERT INTO vistos_buenos (service_id, voter_user_id)
      VALUES ($1, $2)
      ON CONFLICT (service_id, voter_user_id) DO NOTHING
      RETURNING visto_bueno_id
    `, [request.params.serviceId, request.auth.userId]);
    if (insertResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'VOUCH_ALREADY_EXISTS', message: 'Ya diste tu Visto Bueno a este oficio.' });
    }
    const countResult = await client.query('SELECT visto_bueno_count FROM local_services WHERE service_id = $1', [request.params.serviceId]);
    await client.query('COMMIT');
    return response.json({ recommendations: countResult.rows[0].visto_bueno_count });
  } catch {
    if (client) await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'VOUCH_UNAVAILABLE', message: 'No pudimos guardar tu Visto Bueno.' });
  } finally {
    client?.release();
  }
});

app.post('/api/v1/services/:serviceId/reports', requireAccessToken, async (request, response) => {
  if (!uuidPattern.test(request.params.serviceId)) return response.status(400).json({ error: 'INVALID_SERVICE_ID', message: 'El oficio solicitado no es válido.' });
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim() : '';
  if (reason.length > 500) return response.status(400).json({ error: 'INVALID_REPORT', message: 'El motivo debe tener menos de 500 caracteres.' });
  try {
    const result = await pool.query(`
      INSERT INTO community_reports (reporter_id, target_content_id, target_type, reason)
      SELECT $1, service.service_id, 'service', $3
      FROM local_services service
      JOIN users provider ON provider.user_id = service.provider_id
      JOIN users reporter ON reporter.user_id = $1
      WHERE service.service_id = $2
        AND service.status = 'active'
        AND reporter.tier <> 'level_1_basic'
        AND reporter.is_suspended = FALSE
        AND reporter.quadrant_id = provider.quadrant_id
      ON CONFLICT (reporter_id, target_content_id, target_type) DO NOTHING
      RETURNING report_id
    `, [request.auth.userId, request.params.serviceId, reason || 'Publicación sospechosa.']);
    if (result.rowCount === 0) {
      return response.status(409).json({ error: 'REPORT_NOT_ACCEPTED', message: 'Verifica tu barrio, revisa si ya reportaste este oficio o si ya no está disponible.' });
    }
    const statusResult = await pool.query('SELECT status FROM local_services WHERE service_id = $1', [request.params.serviceId]);
    return response.status(201).json({ reported: true, status: statusResult.rows[0]?.status ?? 'hidden_in_review' });
  } catch {
    return response.status(503).json({ error: 'REPORT_UNAVAILABLE', message: 'No pudimos enviar tu reporte.' });
  }
});

app.get('/api/v1/neighbors', requireAccessToken, async (request, response) => {
  try {
    const currentResult = await pool.query(`
      SELECT u.quadrant_id, u.is_suspended, q.district_name, q.quadrant_code
      FROM users u
      LEFT JOIN neighborhood_quadrants q ON q.quadrant_id = u.quadrant_id
      WHERE u.user_id = $1
      LIMIT 1
    `, [request.auth.userId]);
    const currentUser = currentResult.rows[0];
    if (!currentUser) return response.status(404).json({ error: 'PROFILE_NOT_FOUND', message: 'No encontramos tu perfil.' });
    if (currentUser.is_suspended) return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta está suspendida.' });
    if (!currentUser.quadrant_id) {
      return response.json({ neighborhood: null, data: [] });
    }

    const result = await pool.query(`
      SELECT u.user_id AS id, u.full_name, u.tier, u.joined_at
      FROM users u
      WHERE u.quadrant_id = $1
        AND u.user_id <> $2
        AND u.is_suspended = FALSE
      ORDER BY u.joined_at DESC, u.full_name ASC
      LIMIT 100
    `, [currentUser.quadrant_id, request.auth.userId]);

    return response.json({
      neighborhood: { district_name: currentUser.district_name, quadrant_code: currentUser.quadrant_code },
      data: result.rows,
    });
  } catch {
    return response.status(503).json({ error: 'NEIGHBORS_UNAVAILABLE', message: 'No pudimos cargar el directorio vecinal. Inténtalo nuevamente.' });
  }
});

app.get('/api/v1/home/activity', requireAccessToken, async (request, response) => {
  try {
    const userResult = await pool.query('SELECT quadrant_id, is_suspended FROM users WHERE user_id = $1', [request.auth.userId]);
    const user = userResult.rows[0];
    if (!user || user.is_suspended) return response.status(user ? 403 : 404).json({ error: 'PROFILE_UNAVAILABLE', message: 'No encontramos un perfil activo.' });
    if (!user.quadrant_id) return response.json({ data: [] });
    const result = await pool.query(`
      SELECT * FROM (
        SELECT 'swap'::text AS type, s.swap_id AS id, s.title, s.created_at
        FROM neighborhood_swaps s JOIN users author ON author.user_id = s.author_id
        WHERE author.quadrant_id = $1 AND author.is_suspended = FALSE AND s.status = 'active'
        UNION ALL
        SELECT 'tool'::text AS type, t.tool_id AS id, t.tool_name AS title, t.created_at
        FROM shared_tools t JOIN users owner ON owner.user_id = t.owner_id
        WHERE owner.quadrant_id = $1 AND owner.is_suspended = FALSE AND t.is_available = TRUE
        UNION ALL
        SELECT 'purchase'::text AS type, p.purchase_id AS id, p.title, p.created_at
        FROM group_purchases p JOIN users organizer ON organizer.user_id = p.organizer_id
        WHERE organizer.quadrant_id = $1 AND organizer.is_suspended = FALSE AND p.status = 'active' AND p.deadline >= CURRENT_DATE
        UNION ALL
        SELECT 'service'::text AS type, s.service_id AS id, s.title, s.created_at
        FROM local_services s JOIN users provider ON provider.user_id = s.provider_id
        WHERE provider.quadrant_id = $1 AND provider.is_suspended = FALSE AND s.status = 'active'
      ) activity ORDER BY created_at DESC LIMIT 8
    `, [user.quadrant_id]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'ACTIVITY_UNAVAILABLE', message: 'No pudimos cargar la actividad del barrio.' });
  }
});

async function getCommunityLocation(userId, coordinates, response) {
  const result = await pool.query(`
    SELECT u.user_id, u.tier, u.quadrant_id, u.phone_number, u.is_suspended,
      COALESCE(ST_Covers(q.polygon_geom, ST_SetSRID(ST_MakePoint($3, $2), 4326)), FALSE) AS inside_quadrant
    FROM users u
    LEFT JOIN neighborhood_quadrants q ON q.quadrant_id = u.quadrant_id
    WHERE u.user_id = $1 LIMIT 1
  `, [userId, coordinates.latitude, coordinates.longitude]);
  const user = result.rows[0];
  if (!user || user.is_suspended) {
    response.status(user ? 403 : 404).json({ error: user ? 'ACCOUNT_SUSPENDED' : 'PROFILE_NOT_FOUND', message: user ? 'Esta cuenta está suspendida.' : 'No encontramos tu perfil.' });
    return null;
  }
  if (!user.quadrant_id) {
    response.status(409).json({ error: 'QUADRANT_REQUIRED', message: 'Confirma tu barrio para usar esta función.' });
    return null;
  }
  if (!user.inside_quadrant) {
    response.status(403).json({ error: 'LOCATION_OUTSIDE_QUADRANT', message: 'Debes estar dentro de tu cuadrante validado.' });
    return null;
  }
  return user;
}

function requireVerifiedTier(user, response) {
  if (user.tier === 'level_1_basic') {
    response.status(403).json({ error: 'VERIFIED_NEIGHBOR_REQUIRED', message: 'Confirma tu residencia para participar en esta función.' });
    return false;
  }
  return true;
}

function requireVerificationReviewer(request, response, next) {
  const configured = process.env.VERIFICATION_REVIEW_TOKEN;
  const supplied = request.get('x-verification-review-token') ?? '';
  if (!configured || configured.length < 32) return response.status(503).json({ error: 'REVIEW_NOT_CONFIGURED', message: 'La revisión de verificaciones no está configurada.' });
  const expectedDigest = createHmac('sha256', 'verification-review-compare').update(configured).digest();
  const suppliedDigest = createHmac('sha256', 'verification-review-compare').update(supplied).digest();
  if (!supplied || !timingSafeEqual(expectedDigest, suppliedDigest)) return response.status(401).json({ error: 'REVIEW_UNAUTHORIZED', message: 'No tienes permiso para revisar verificaciones.' });
  return next();
}

app.patch('/api/v1/admin/residency-verifications/:verificationId', requireVerificationReviewer, async (request, response) => {
  if (!uuidPattern.test(request.params.verificationId) || !['approved', 'purged'].includes(request.body?.status)) {
    return response.status(400).json({ error: 'INVALID_REVIEW', message: 'Selecciona un resultado válido para esta revisión.' });
  }
  const status = request.body.status;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE residency_verifications
      SET status = $2, reviewed_at = NOW()
      WHERE verification_id = $1 AND status = 'pending'
      RETURNING user_id
    `, [request.params.verificationId, status]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'VERIFICATION_NOT_PENDING', message: 'No encontramos una solicitud pendiente.' });
    }
    if (status === 'approved') await client.query("UPDATE users SET tier = 'level_2_verified', updated_at = NOW() WHERE user_id = $1 AND tier = 'level_1_basic'", [result.rows[0].user_id]);
    await client.query('COMMIT');
    return response.json({ reviewed: true, status });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'REVIEW_UNAVAILABLE', message: 'No pudimos completar la revisión.' });
  } finally { client.release(); }
});

app.post('/api/v1/admin/users/:userId/approve-tier-3', requireVerificationReviewer, async (request, response) => {
  if (!uuidPattern.test(request.params.userId)) return response.status(400).json({ error: 'INVALID_USER_ID', message: 'El usuario no es válido.' });
  const specialty = typeof request.body?.brigade_specialty === 'string' ? request.body.brigade_specialty.trim() : '';
  if (specialty.length > 100) return response.status(400).json({ error: 'INVALID_SPECIALTY', message: 'La especialidad debe tener menos de 100 caracteres.' });
  try {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query(`
        SELECT u.user_id, u.quadrant_id, u.tier, u.is_suspended,
          (SELECT COUNT(*)::int FROM user_vouches v JOIN users voter ON voter.user_id = v.voucher_user_id
            WHERE v.vouched_user_id = u.user_id AND voter.quadrant_id = u.quadrant_id AND voter.tier <> 'level_1_basic' AND voter.is_suspended = FALSE) AS vouches
        FROM users u WHERE u.user_id = $1 FOR UPDATE
      `, [request.params.userId]);
      const user = result.rows[0];
      if (!user || user.is_suspended || !user.quadrant_id || user.tier !== 'level_2_verified') {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'TIER_REVIEW_NOT_ALLOWED', message: 'El usuario debe ser un vecino validado y activo.' });
      }
      if (Number(user.vouches) < 3) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'VOUCHES_REQUIRED', message: 'Se requieren tres avales únicos de vecinos validados del mismo cuadrante.' });
      }
      await client.query("UPDATE users SET tier = 'level_3_provider_brigade', updated_at = NOW() WHERE user_id = $1", [user.user_id]);
      if (specialty) await client.query(`
        INSERT INTO neighborhood_brigades (user_id, specialty, quadrant_id, is_active)
        SELECT $1, $2, $3, TRUE
        WHERE NOT EXISTS (SELECT 1 FROM neighborhood_brigades WHERE user_id = $1 AND quadrant_id = $3 AND specialty = $2)
      `, [user.user_id, specialty, user.quadrant_id]);
      await client.query('COMMIT');
      return response.json({ approved: true, tier: 'level_3_provider_brigade', brigade: Boolean(specialty) });
    } catch (error) {
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally { client.release(); }
  } catch {
    return response.status(503).json({ error: 'TIER_REVIEW_UNAVAILABLE', message: 'No pudimos revisar el cambio de nivel.' });
  }
});

app.patch('/api/v1/admin/users/:userId/suspension', requireVerificationReviewer, async (request, response) => {
  if (!uuidPattern.test(request.params.userId) || typeof request.body?.is_suspended !== 'boolean') return response.status(400).json({ error: 'INVALID_SUSPENSION', message: 'Selecciona un usuario y estado válidos.' });
  try {
    const result = await pool.query('UPDATE users SET is_suspended = $2, updated_at = NOW() WHERE user_id = $1 RETURNING user_id AS id, is_suspended', [request.params.userId, request.body.is_suspended]);
    if (!result.rowCount) return response.status(404).json({ error: 'USER_NOT_FOUND', message: 'No encontramos al usuario.' });
    return response.json({ user: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'SUSPENSION_UNAVAILABLE', message: 'No pudimos actualizar el estado de la cuenta.' });
  }
});

app.patch('/api/v1/admin/emergency/sos/:alertId/review', requireVerificationReviewer, async (request, response) => {
  if (!uuidPattern.test(request.params.alertId) || !['resolved', 'cancelled_false_alarm'].includes(request.body?.status)) return response.status(400).json({ error: 'INVALID_SOS_REVIEW', message: 'Selecciona un resultado válido para la alerta.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await client.query(`
      UPDATE sos_alerts SET status = $2::emergency_status_enum, resolved_at = NOW()
      WHERE alert_id = $1 AND status = 'active' RETURNING alert_id AS id, sender_id
    `, [request.params.alertId, request.body.status]);
    if (!result.rowCount) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'SOS_NOT_ACTIVE', message: 'No encontramos una alerta activa para revisar.' });
    }
    if (request.body.status === 'cancelled_false_alarm') await client.query('UPDATE users SET is_suspended = TRUE, updated_at = NOW() WHERE user_id = $1', [result.rows[0].sender_id]);
    await client.query('COMMIT');
    return response.json({ reviewed: true, status: request.body.status, user_suspended: request.body.status === 'cancelled_false_alarm' });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'SOS_REVIEW_UNAVAILABLE', message: 'No pudimos revisar la alerta.' });
  } finally { client.release(); }
});

app.get('/api/v1/community/swaps', requireAccessToken, async (request, response) => {
  const coordinates = parseCoordinates(request.query);
  if (coordinates.error) return response.status(400).json({ error: 'INVALID_LOCATION', message: coordinates.error });
  try {
    const viewer = await getCommunityLocation(request.auth.userId, coordinates, response);
    if (!viewer) return;
    const radius = request.query.walking_only === 'false' ? 10_000 : 1000;
    const result = await pool.query(`
      SELECT s.swap_id AS id, s.kind, s.title, s.details, s.is_urgent AS urgent,
        author.full_name AS author, author.tier AS author_tier, s.status, s.created_at,
        ROUND(ST_Distance(s.location::geography, origin.point))::int AS distance_m
      FROM neighborhood_swaps s
      JOIN users author ON author.user_id = s.author_id
      CROSS JOIN (SELECT ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography AS point) origin
      WHERE author.quadrant_id = $1 AND author.is_suspended = FALSE AND s.status = 'active'
        AND ST_DWithin(s.location::geography, origin.point, $4)
      ORDER BY s.is_urgent DESC, ST_Distance(s.location::geography, origin.point), s.created_at DESC
      LIMIT 100
    `, [viewer.quadrant_id, coordinates.latitude, coordinates.longitude, radius]);
    return response.json({ data: result.rows, radius_m: radius });
  } catch {
    return response.status(503).json({ error: 'SWAPS_UNAVAILABLE', message: 'No pudimos cargar la ayuda vecinal.' });
  }
});

app.post('/api/v1/community/swaps', requireAccessToken, limitMutations({ windowMs: 10 * 60_000, max: 8 }), async (request, response) => {
  const { kind, title: rawTitle, details: rawDetails, is_urgent: isUrgent } = request.body ?? {};
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const details = typeof rawDetails === 'string' ? rawDetails.trim() : '';
  const coordinates = parseCoordinates(request.body, 150);
  if (!['need', 'offer'].includes(kind) || title.length < 3 || title.length > 150 || details.length > 2000 || typeof isUrgent !== 'boolean') {
    return response.status(400).json({ error: 'INVALID_SWAP', message: 'Completa el tipo, el título y los detalles de la publicación.' });
  }
  if (coordinates.error) return response.status(400).json({ error: 'INVALID_LOCATION', message: coordinates.error });
  const unverifiedCrisisTerms = /\b(terremoto|sismo|incendio|explosi[oó]n|bomba|atentado|toque de queda|derrumbe|tsunami)\b/i;
  const crisisFlagged = unverifiedCrisisTerms.test(`${title} ${details}`);
  const contentStatus = crisisFlagged ? 'hidden_in_review' : 'active';
  try {
    const user = await getCommunityLocation(request.auth.userId, coordinates, response);
    if (!user || !requireVerifiedTier(user, response)) return;
    const result = await pool.query(`
      INSERT INTO neighborhood_swaps (author_id, kind, title, details, is_urgent, location, status)
      VALUES ($1, $2::swap_kind_enum, $3, $4, $5, ST_SetSRID(ST_MakePoint($7, $6), 4326), $8::content_status_enum)
      RETURNING swap_id AS id, kind, title, details, is_urgent AS urgent, status, created_at
    `, [request.auth.userId, kind, title, details || null, isUrgent && kind === 'need', coordinates.latitude, coordinates.longitude, contentStatus]);
    return response.status(crisisFlagged ? 202 : 201).json({ swap: result.rows[0], warning: crisisFlagged ? 'La publicación contiene una afirmación sobre una emergencia y quedó oculta hasta su revisión. Para una emergencia real llama a los servicios oficiales.' : undefined });
  } catch {
    return response.status(503).json({ error: 'SWAP_CREATE_UNAVAILABLE', message: 'No pudimos publicar esta ayuda.' });
  }
});

app.patch('/api/v1/admin/community/:contentType/:contentId/review', requireVerificationReviewer, async (request, response) => {
  const { contentType, contentId } = request.params;
  const status = request.body?.status;
  if (!['service', 'swap'].includes(contentType) || !uuidPattern.test(contentId) || !['active', 'blocked'].includes(status)) {
    return response.status(400).json({ error: 'INVALID_MODERATION_REVIEW', message: 'Selecciona una publicación y estado válidos.' });
  }
  const table = contentType === 'service' ? 'local_services' : 'neighborhood_swaps';
  const idColumn = contentType === 'service' ? 'service_id' : 'swap_id';
  try {
    const result = await pool.query(`UPDATE ${table} SET status = $2::content_status_enum WHERE ${idColumn} = $1 AND status = 'hidden_in_review' RETURNING ${idColumn} AS id, status`, [contentId, status]);
    if (!result.rowCount) return response.status(404).json({ error: 'CONTENT_NOT_PENDING', message: 'No encontramos una publicación pendiente de revisión.' });
    return response.json({ reviewed: true, content: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'MODERATION_REVIEW_UNAVAILABLE', message: 'No pudimos revisar la publicación.' });
  }
});

app.post('/api/v1/community/swaps/:swapId/interest', requireAccessToken, limitMutations({ max: 10 }), async (request, response) => {
  if (!uuidPattern.test(request.params.swapId)) return response.status(400).json({ error: 'INVALID_SWAP_ID', message: 'La publicación no es válida.' });
  try {
    const viewerResult = await pool.query('SELECT tier, quadrant_id, phone_number, is_suspended FROM users WHERE user_id = $1', [request.auth.userId]);
    const viewer = viewerResult.rows[0];
    if (!viewer || viewer.is_suspended) return response.status(viewer ? 403 : 404).json({ error: 'PROFILE_NOT_FOUND', message: 'No encontramos tu perfil activo.' });
    if (!requireVerifiedTier(viewer, response)) return;
    const target = await pool.query(`
      SELECT author.user_id, author.quadrant_id, author.phone_number
      FROM neighborhood_swaps s JOIN users author ON author.user_id = s.author_id
      WHERE s.swap_id = $1 AND s.status = 'active' AND author.is_suspended = FALSE
    `, [request.params.swapId]);
    const author = target.rows[0];
    if (!author || !viewer.quadrant_id || viewer.quadrant_id !== author.quadrant_id) return response.status(404).json({ error: 'SWAP_NOT_AVAILABLE', message: 'Esta publicación no está disponible en tu cuadrante.' });
    if (author.user_id === request.auth.userId) return response.status(400).json({ error: 'OWN_SWAP', message: 'No puedes responder a tu propia publicación.' });
    return response.json({ interested: true, contact_phone: author.phone_number });
  } catch {
    return response.status(503).json({ error: 'SWAP_INTEREST_UNAVAILABLE', message: 'No pudimos responder a esta publicación.' });
  }
});

app.post('/api/v1/community/swaps/:swapId/reports', requireAccessToken, limitMutations({ max: 5 }), async (request, response) => {
  if (!uuidPattern.test(request.params.swapId)) return response.status(400).json({ error: 'INVALID_SWAP_ID', message: 'La publicación no es válida.' });
  try {
    const result = await pool.query(`
      INSERT INTO community_reports (reporter_id, target_content_id, target_type, reason)
      SELECT $1, s.swap_id, 'swap', 'Publicación sospechosa.'
      FROM neighborhood_swaps s JOIN users author ON author.user_id = s.author_id
      JOIN users reporter ON reporter.user_id = $1
      WHERE s.swap_id = $2 AND s.status = 'active' AND author.quadrant_id = reporter.quadrant_id
        AND reporter.tier <> 'level_1_basic' AND reporter.is_suspended = FALSE
      ON CONFLICT (reporter_id, target_content_id, target_type) DO NOTHING RETURNING report_id
    `, [request.auth.userId, request.params.swapId]);
    if (!result.rowCount) return response.status(409).json({ error: 'REPORT_NOT_ACCEPTED', message: 'Valida tu barrio o confirma que no reportaste esta publicación antes.' });
    return response.status(201).json({ reported: true });
  } catch {
    return response.status(503).json({ error: 'REPORT_UNAVAILABLE', message: 'No pudimos enviar tu reporte.' });
  }
});

app.get('/api/v1/community/tools', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT t.tool_id AS id, t.tool_name AS name, t.is_available AS available, owner.full_name AS owner, owner.user_id AS owner_id
      FROM shared_tools t JOIN users owner ON owner.user_id = t.owner_id
      JOIN users viewer ON viewer.user_id = $1
      WHERE owner.quadrant_id = viewer.quadrant_id AND owner.is_suspended = FALSE AND viewer.is_suspended = FALSE
      ORDER BY t.is_available DESC, t.created_at DESC LIMIT 100
    `, [request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'TOOLS_UNAVAILABLE', message: 'No pudimos cargar las herramientas compartidas.' });
  }
});

app.get('/api/v1/community/my-tool-requests', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT r.request_id AS id, r.tool_id, r.status, t.tool_name AS name
      FROM tool_borrow_requests r JOIN shared_tools t ON t.tool_id = r.tool_id
      WHERE r.borrower_id = $1 AND r.status <> 'returned' ORDER BY r.requested_at DESC
    `, [request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'MY_TOOL_REQUESTS_UNAVAILABLE', message: 'No pudimos cargar tus solicitudes de préstamo.' });
  }
});

app.post('/api/v1/community/tools', requireAccessToken, limitMutations({ windowMs: 10 * 60_000, max: 8 }), async (request, response) => {
  const name = typeof request.body?.tool_name === 'string' ? request.body.tool_name.trim() : '';
  const coordinates = parseCoordinates(request.body, 150);
  if (name.length < 2 || name.length > 100) return response.status(400).json({ error: 'INVALID_TOOL', message: 'Escribe un nombre de herramienta válido.' });
  if (coordinates.error) return response.status(400).json({ error: 'INVALID_LOCATION', message: coordinates.error });
  try {
    const user = await getCommunityLocation(request.auth.userId, coordinates, response);
    if (!user || !requireVerifiedTier(user, response)) return;
    const result = await pool.query(`
      INSERT INTO shared_tools (owner_id, tool_name, location)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326))
      RETURNING tool_id AS id, tool_name AS name, is_available AS available, created_at
    `, [request.auth.userId, name, coordinates.latitude, coordinates.longitude]);
    return response.status(201).json({ tool: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'TOOL_CREATE_UNAVAILABLE', message: 'No pudimos publicar la herramienta.' });
  }
});

app.post('/api/v1/community/tools/:toolId/requests', requireAccessToken, limitMutations({ max: 8 }), async (request, response) => {
  if (!uuidPattern.test(request.params.toolId)) return response.status(400).json({ error: 'INVALID_TOOL_ID', message: 'La herramienta no es válida.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const toolResult = await client.query(`
      SELECT t.tool_id, t.owner_id, t.is_available, owner.quadrant_id AS owner_quadrant,
        borrower.quadrant_id AS borrower_quadrant, borrower.tier AS borrower_tier, borrower.is_suspended
      FROM shared_tools t JOIN users owner ON owner.user_id = t.owner_id
      JOIN users borrower ON borrower.user_id = $1 WHERE t.tool_id = $2
      FOR UPDATE OF t
    `, [request.auth.userId, request.params.toolId]);
    const tool = toolResult.rows[0];
    if (!tool || !tool.is_available || tool.owner_id === request.auth.userId || tool.is_suspended || tool.borrower_tier === 'level_1_basic' || tool.owner_quadrant !== tool.borrower_quadrant) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'TOOL_REQUEST_NOT_ACCEPTED', message: 'La herramienta no está disponible o necesitas estar validado en el mismo cuadrante.' });
    }
    const existing = await client.query("SELECT request_id FROM tool_borrow_requests WHERE tool_id = $1 AND borrower_id = $2 AND status <> 'returned' LIMIT 1", [tool.tool_id, request.auth.userId]);
    if (existing.rowCount) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'TOOL_REQUEST_EXISTS', message: 'Ya tienes una solicitud activa para esta herramienta.' });
    }
    const result = await client.query('INSERT INTO tool_borrow_requests (tool_id, borrower_id) VALUES ($1, $2) RETURNING request_id AS id, status', [tool.tool_id, request.auth.userId]);
    await client.query('COMMIT');
    return response.status(201).json({ request: result.rows[0] });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'TOOL_REQUEST_UNAVAILABLE', message: 'No pudimos pedir esta herramienta.' });
  } finally { client.release(); }
});

app.get('/api/v1/community/tools/:toolId/requests', requireAccessToken, async (request, response) => {
  if (!uuidPattern.test(request.params.toolId)) return response.status(400).json({ error: 'INVALID_TOOL_ID', message: 'La herramienta no es válida.' });
  try {
    const result = await pool.query(`
      SELECT r.request_id AS id, r.status, r.requested_at, borrower.full_name AS borrower
      FROM tool_borrow_requests r JOIN shared_tools t ON t.tool_id = r.tool_id
      JOIN users borrower ON borrower.user_id = r.borrower_id
      WHERE r.tool_id = $1 AND t.owner_id = $2 ORDER BY r.requested_at DESC LIMIT 50
    `, [request.params.toolId, request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'TOOL_REQUESTS_UNAVAILABLE', message: 'No pudimos consultar las solicitudes.' });
  }
});

app.patch('/api/v1/community/tool-requests/:requestId', requireAccessToken, limitMutations({ max: 20 }), async (request, response) => {
  if (!uuidPattern.test(request.params.requestId) || !['accepted', 'returned'].includes(request.body?.status)) return response.status(400).json({ error: 'INVALID_TOOL_REQUEST', message: 'Selecciona un estado válido.' });
  const nextStatus = request.body.status;
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const requestResult = await client.query(`
      SELECT r.request_id, r.status, r.tool_id, t.is_available
      FROM tool_borrow_requests r JOIN shared_tools t ON t.tool_id = r.tool_id
      WHERE r.request_id = $1 AND t.owner_id = $2 FOR UPDATE OF r, t
    `, [request.params.requestId, request.auth.userId]);
    const borrow = requestResult.rows[0];
    if (!borrow || (nextStatus === 'accepted' && (borrow.status !== 'pending' || !borrow.is_available))
      || (nextStatus === 'returned' && borrow.status !== 'accepted')) {
      await client.query('ROLLBACK');
      return response.status(409).json({ error: 'TOOL_REQUEST_TRANSITION_INVALID', message: 'La solicitud ya cambió o no permite esta acción.' });
    }
    await client.query('UPDATE tool_borrow_requests SET status = $2 WHERE request_id = $1', [borrow.request_id, nextStatus]);
    await client.query('UPDATE shared_tools SET is_available = $2 WHERE tool_id = $1', [borrow.tool_id, nextStatus === 'returned']);
    await client.query('COMMIT');
    return response.json({ id: borrow.request_id, status: nextStatus, available: nextStatus === 'returned' });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'TOOL_REQUEST_UPDATE_UNAVAILABLE', message: 'No pudimos actualizar la solicitud.' });
  } finally { client.release(); }
});

app.get('/api/v1/community/purchases', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT p.purchase_id AS id, p.organizer_id, p.title, p.provider_name AS provider,
        p.savings_description AS savings, p.target_participants AS target,
        p.current_participants AS current, p.deadline,
        EXISTS (SELECT 1 FROM group_purchase_members m WHERE m.purchase_id = p.purchase_id AND m.user_id = $1) AS joined
      FROM group_purchases p JOIN users organizer ON organizer.user_id = p.organizer_id
      JOIN users viewer ON viewer.user_id = $1
      WHERE p.status = 'active' AND p.deadline >= CURRENT_DATE
        AND organizer.quadrant_id = viewer.quadrant_id AND organizer.is_suspended = FALSE AND viewer.is_suspended = FALSE
      ORDER BY p.deadline ASC LIMIT 100
    `, [request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'PURCHASES_UNAVAILABLE', message: 'No pudimos cargar las compras grupales.' });
  }
});

app.post('/api/v1/community/purchases', requireAccessToken, limitMutations({ windowMs: 10 * 60_000, max: 4 }), async (request, response) => {
  const { title: rawTitle, provider_name: rawProvider, savings_description: rawSavings, target_participants: target, deadline } = request.body ?? {};
  const title = typeof rawTitle === 'string' ? rawTitle.trim() : '';
  const provider = typeof rawProvider === 'string' ? rawProvider.trim() : '';
  const savings = typeof rawSavings === 'string' ? rawSavings.trim() : '';
  const deadlineDate = typeof deadline === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(deadline) ? deadline : '';
  if (title.length < 3 || title.length > 150 || provider.length < 2 || provider.length > 120 || savings.length < 3 || savings.length > 100
    || !Number.isInteger(target) || target < 2 || target > 500 || !deadlineDate || deadlineDate <= new Date().toISOString().slice(0, 10)) {
    return response.status(400).json({ error: 'INVALID_PURCHASE', message: 'Revisa el título, proveedor, meta de vecinos y fecha límite.' });
  }
  try {
    const user = await pool.query('SELECT tier, quadrant_id, is_suspended FROM users WHERE user_id = $1', [request.auth.userId]);
    const organizer = user.rows[0];
    if (!organizer || organizer.is_suspended) return response.status(403).json({ error: 'PROFILE_UNAVAILABLE', message: 'No encontramos un perfil activo.' });
    if (!organizer.quadrant_id || !requireVerifiedTier(organizer, response)) return;
    const result = await pool.query(`
      INSERT INTO group_purchases (organizer_id, title, provider_name, savings_description, target_participants, current_participants, deadline)
      VALUES ($1, $2, $3, $4, $5, 1, $6)
      RETURNING purchase_id AS id, title, provider_name AS provider, savings_description AS savings,
        target_participants AS target, current_participants AS current, deadline
    `, [request.auth.userId, title, provider, savings, target, deadlineDate]);
    await pool.query('INSERT INTO group_purchase_members (purchase_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [result.rows[0].id, request.auth.userId]);
    return response.status(201).json({ purchase: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'PURCHASE_CREATE_UNAVAILABLE', message: 'No pudimos crear la compra grupal.' });
  }
});

app.post('/api/v1/community/purchases/:purchaseId/membership', requireAccessToken, limitMutations({ max: 10 }), async (request, response) => {
  if (!uuidPattern.test(request.params.purchaseId)) return response.status(400).json({ error: 'INVALID_PURCHASE_ID', message: 'La compra no es válida.' });
  const join = request.body?.join;
  if (typeof join !== 'boolean') return response.status(400).json({ error: 'INVALID_MEMBERSHIP', message: 'Indica si deseas unirte o salir de la compra.' });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const userResult = await client.query('SELECT tier, quadrant_id, is_suspended FROM users WHERE user_id = $1 FOR UPDATE', [request.auth.userId]);
    const user = userResult.rows[0];
    if (!user || user.is_suspended || !user.quadrant_id || !requireVerifiedTier(user, response)) {
      await client.query('ROLLBACK');
      if (!response.headersSent) response.status(403).json({ error: 'PROFILE_UNAVAILABLE', message: 'Valida tu residencia para participar.' });
      return;
    }
    const purchaseResult = await client.query(`
      SELECT p.purchase_id, p.organizer_id, p.target_participants, p.current_participants
      FROM group_purchases p JOIN users organizer ON organizer.user_id = p.organizer_id
      WHERE p.purchase_id = $1 AND p.status = 'active' AND p.deadline >= CURRENT_DATE AND organizer.quadrant_id = $2
      FOR UPDATE OF p
    `, [request.params.purchaseId, user.quadrant_id]);
    const purchase = purchaseResult.rows[0];
    if (!purchase) {
      await client.query('ROLLBACK');
      return response.status(404).json({ error: 'PURCHASE_NOT_FOUND', message: 'La compra ya no está disponible en tu cuadrante.' });
    }
    if (purchase.organizer_id === request.auth.userId) {
      await client.query('ROLLBACK');
      return response.status(400).json({ error: 'PURCHASE_ORGANIZER', message: 'Ya organizas esta compra.' });
    }
    if (join) {
      if (purchase.current_participants >= purchase.target_participants) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'PURCHASE_FULL', message: 'La compra alcanzó su meta de participantes.' });
      }
      const inserted = await client.query('INSERT INTO group_purchase_members (purchase_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id', [purchase.purchase_id, request.auth.userId]);
      if (!inserted.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'ALREADY_JOINED', message: 'Ya formas parte de esta compra.' });
      }
      await client.query('UPDATE group_purchases SET current_participants = current_participants + 1 WHERE purchase_id = $1', [purchase.purchase_id]);
    } else {
      const removed = await client.query('DELETE FROM group_purchase_members WHERE purchase_id = $1 AND user_id = $2 RETURNING user_id', [purchase.purchase_id, request.auth.userId]);
      if (!removed.rowCount) {
        await client.query('ROLLBACK');
        return response.status(409).json({ error: 'NOT_JOINED', message: 'No formas parte de esta compra.' });
      }
      await client.query('UPDATE group_purchases SET current_participants = GREATEST(1, current_participants - 1) WHERE purchase_id = $1', [purchase.purchase_id]);
    }
    const count = await client.query('SELECT current_participants AS current FROM group_purchases WHERE purchase_id = $1', [purchase.purchase_id]);
    await client.query('COMMIT');
    return response.json({ joined: join, current: count.rows[0].current });
  } catch {
    await client.query('ROLLBACK').catch(() => {});
    return response.status(503).json({ error: 'MEMBERSHIP_UNAVAILABLE', message: 'No pudimos actualizar tu participación.' });
  } finally { client.release(); }
});

app.get('/api/v1/tutorials', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`
      SELECT t.tutorial_id AS id, t.title, t.duration_minutes::text || ' min' AS duration,
        t.author_name AS author, t.is_official_protocol AS is_official_protocol, t.steps,
        EXISTS (SELECT 1 FROM offline_saved_tutorials s WHERE s.tutorial_id = t.tutorial_id AND s.user_id = $1) AS saved
      FROM community_tutorials t ORDER BY t.is_official_protocol DESC, t.created_at DESC LIMIT 200
    `, [request.auth.userId]);
    return response.json({ data: result.rows });
  } catch {
    return response.status(503).json({ error: 'TUTORIALS_UNAVAILABLE', message: 'No pudimos cargar las guías comunitarias.' });
  }
});

app.post('/api/v1/tutorials', requireAccessToken, limitMutations({ windowMs: 60 * 60_000, max: 3 }), async (request, response) => {
  const title = typeof request.body?.title === 'string' ? request.body.title.trim() : '';
  const minutes = Number(request.body?.duration_minutes);
  const steps = request.body?.steps;
  if (title.length < 4 || title.length > 150 || !Number.isInteger(minutes) || minutes < 1 || minutes > 120
    || !Array.isArray(steps) || steps.length < 2 || steps.length > 20
    || steps.some((step) => typeof step !== 'string' || step.trim().length < 3 || step.length > 500)) {
    return response.status(400).json({ error: 'INVALID_TUTORIAL', message: 'Incluye un título, duración y de 2 a 20 pasos claros.' });
  }
  try {
    const user = await pool.query('SELECT full_name, tier, is_suspended FROM users WHERE user_id = $1', [request.auth.userId]);
    const author = user.rows[0];
    if (!author || author.is_suspended) return response.status(403).json({ error: 'PROFILE_UNAVAILABLE', message: 'No encontramos un perfil activo.' });
    if (author.tier === 'level_1_basic') return response.status(403).json({ error: 'VERIFIED_NEIGHBOR_REQUIRED', message: 'Valida tu residencia para compartir una guía.' });
    const result = await pool.query(`
      INSERT INTO community_tutorials (title, duration_minutes, author_name, is_official_protocol, steps)
      VALUES ($1, $2, $3, FALSE, $4::jsonb)
      RETURNING tutorial_id AS id, title, duration_minutes::text || ' min' AS duration, author_name AS author,
        is_official_protocol, steps, created_at
    `, [title, minutes, author.full_name, JSON.stringify(steps.map((step) => step.trim()))]);
    return response.status(201).json({ tutorial: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'TUTORIAL_CREATE_UNAVAILABLE', message: 'No pudimos publicar la guía.' });
  }
});

app.put('/api/v1/tutorials/:tutorialId/saved', requireAccessToken, limitMutations({ max: 30 }), async (request, response) => {
  if (!uuidPattern.test(request.params.tutorialId) || typeof request.body?.saved !== 'boolean') return response.status(400).json({ error: 'INVALID_SAVED_TUTORIAL', message: 'La guía o el cambio no son válidos.' });
  try {
    if (request.body.saved) {
      const result = await pool.query(`
        INSERT INTO offline_saved_tutorials (user_id, tutorial_id)
        SELECT $1, tutorial_id FROM community_tutorials WHERE tutorial_id = $2
        ON CONFLICT DO NOTHING RETURNING tutorial_id
      `, [request.auth.userId, request.params.tutorialId]);
      if (!result.rowCount) {
        const exists = await pool.query('SELECT 1 FROM community_tutorials WHERE tutorial_id = $1', [request.params.tutorialId]);
        if (!exists.rowCount) return response.status(404).json({ error: 'TUTORIAL_NOT_FOUND', message: 'La guía ya no está disponible.' });
      }
    } else {
      await pool.query('DELETE FROM offline_saved_tutorials WHERE user_id = $1 AND tutorial_id = $2', [request.auth.userId, request.params.tutorialId]);
    }
    return response.json({ saved: request.body.saved });
  } catch {
    return response.status(503).json({ error: 'TUTORIAL_SAVE_UNAVAILABLE', message: 'No pudimos actualizar tus guías guardadas.' });
  }
});

app.get('/api/v1/emergency/nearby', requireAccessToken, async (request, response) => {
  try {
    const userResult = await pool.query('SELECT quadrant_id, is_suspended FROM users WHERE user_id = $1', [request.auth.userId]);
    const user = userResult.rows[0];
    if (!user || user.is_suspended) return response.status(user ? 403 : 404).json({ error: 'PROFILE_UNAVAILABLE', message: 'No encontramos un perfil activo.' });
    if (!user.quadrant_id) return response.json({ alerts: [], brigades: [] });
    const [alerts, brigades] = await Promise.all([
      pool.query(`
        SELECT a.alert_id AS id, a.status, a.created_at, a.channel_used AS channel, sender.full_name AS sender,
          ST_Y(a.alert_location) AS latitude, ST_X(a.alert_location) AS longitude
        FROM sos_alerts a JOIN users sender ON sender.user_id = a.sender_id
        WHERE a.quadrant_id = $1 AND a.sender_id <> $2 AND a.status = 'active' AND a.created_at > NOW() - INTERVAL '24 hours'
          AND sender.is_suspended = FALSE
        ORDER BY a.created_at DESC LIMIT 50
      `, [user.quadrant_id, request.auth.userId]),
      pool.query(`
        SELECT b.brigade_id AS id, b.specialty, u.full_name, u.tier
        FROM neighborhood_brigades b JOIN users u ON u.user_id = b.user_id
        WHERE b.quadrant_id = $1 AND b.is_active = TRUE AND u.is_suspended = FALSE
        ORDER BY u.tier DESC, u.full_name LIMIT 100
      `, [user.quadrant_id]),
    ]);
    return response.json({ alerts: alerts.rows, brigades: brigades.rows });
  } catch {
    return response.status(503).json({ error: 'EMERGENCY_DIRECTORY_UNAVAILABLE', message: 'No pudimos cargar los contactos de emergencia.' });
  }
});

app.get('/api/v1/emergency/me', requireAccessToken, async (request, response) => {
  try {
    const result = await pool.query(`SELECT alert_id AS id, status, created_at FROM sos_alerts WHERE sender_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1`, [request.auth.userId]);
    return response.json({ alert: result.rows[0] ?? null });
  } catch {
    return response.status(503).json({ error: 'SOS_STATUS_UNAVAILABLE', message: 'No pudimos consultar tu alerta activa.' });
  }
});

app.post('/api/v1/emergency/sos', requireAccessToken, limitMutations({ windowMs: 5 * 60_000, max: 1 }), async (request, response) => {
  const coordinates = parseCoordinates(request.body, 100);
  if (coordinates.error) return response.status(400).json({ error: 'INVALID_LOCATION', message: coordinates.error });
  try {
    const user = await getCommunityLocation(request.auth.userId, coordinates, response);
    if (!user) return;
    const activeAlert = await pool.query(`SELECT alert_id FROM sos_alerts WHERE sender_id = $1 AND status = 'active' LIMIT 1`, [request.auth.userId]);
    if (activeAlert.rowCount) return response.status(409).json({ error: 'SOS_ALREADY_ACTIVE', message: 'Ya tienes una alerta SOS activa.' });
    const result = await pool.query(`
      INSERT INTO sos_alerts (sender_id, quadrant_id, alert_location, channel_used, notified_neighbors_count)
      VALUES ($1, $2, ST_SetSRID(ST_MakePoint($4, $3), 4326), 'internet_push', 0)
      RETURNING alert_id AS id, status, created_at
    `, [request.auth.userId, user.quadrant_id, coordinates.latitude, coordinates.longitude]);
    return response.status(201).json({ alert: result.rows[0], delivery: 'recorded_only', message: 'La alerta quedó registrada. El envío push y la malla offline aún no están configurados.' });
  } catch {
    return response.status(503).json({ error: 'SOS_UNAVAILABLE', message: 'No pudimos registrar el SOS. Llama directamente a los servicios de emergencia.' });
  }
});

app.post('/api/v1/emergency/sos/:alertId/reports', requireAccessToken, limitMutations({ max: 5 }), async (request, response) => {
  if (!uuidPattern.test(request.params.alertId)) return response.status(400).json({ error: 'INVALID_ALERT_ID', message: 'La alerta no es válida.' });
  const reason = typeof request.body?.reason === 'string' ? request.body.reason.trim().slice(0, 500) : 'Posible falsa alarma.';
  try {
    const inserted = await pool.query(`
      INSERT INTO community_reports (reporter_id, target_content_id, target_type, reason)
      SELECT reporter.user_id, alert.alert_id, 'sos_alert', $3
      FROM sos_alerts alert JOIN users reporter ON reporter.user_id = $1
      WHERE alert.alert_id = $2 AND alert.status = 'active' AND alert.quadrant_id = reporter.quadrant_id
        AND reporter.tier <> 'level_1_basic' AND reporter.is_suspended = FALSE AND alert.sender_id <> reporter.user_id
      ON CONFLICT (reporter_id, target_content_id, target_type) DO NOTHING RETURNING report_id
    `, [request.auth.userId, request.params.alertId, reason]);
    if (!inserted.rowCount) return response.status(409).json({ error: 'SOS_REPORT_NOT_ACCEPTED', message: 'Valida tu residencia o confirma que no hayas reportado esta alerta.' });
    const count = await pool.query("SELECT COUNT(*)::int AS count FROM community_reports WHERE target_content_id = $1 AND target_type = 'sos_alert'", [request.params.alertId]);
    return response.status(201).json({ reported: true, reports: count.rows[0].count, needs_review: count.rows[0].count >= 3 });
  } catch {
    return response.status(503).json({ error: 'SOS_REPORT_UNAVAILABLE', message: 'No pudimos enviar el reporte.' });
  }
});

app.post('/api/v1/emergency/sos/:alertId/resolve', requireAccessToken, limitMutations({ max: 10 }), async (request, response) => {
  if (!uuidPattern.test(request.params.alertId)) return response.status(400).json({ error: 'INVALID_ALERT_ID', message: 'La alerta no es válida.' });
  try {
    const result = await pool.query(`
      UPDATE sos_alerts a SET status = 'resolved', resolved_at = NOW()
      WHERE a.alert_id = $1 AND a.status = 'active'
        AND (a.sender_id = $2 OR EXISTS (SELECT 1 FROM neighborhood_brigades b WHERE b.user_id = $2 AND b.quadrant_id = a.quadrant_id AND b.is_active = TRUE))
      RETURNING alert_id AS id, status, resolved_at
    `, [request.params.alertId, request.auth.userId]);
    if (!result.rowCount) return response.status(404).json({ error: 'ALERT_NOT_FOUND', message: 'La alerta no está activa o no tienes autorización para cerrarla.' });
    return response.json({ alert: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'SOS_RESOLVE_UNAVAILABLE', message: 'No pudimos cerrar la alerta.' });
  }
});

app.post('/api/v1/emergency/sos/:alertId/cancel', requireAccessToken, limitMutations({ max: 10 }), async (request, response) => {
  if (!uuidPattern.test(request.params.alertId)) return response.status(400).json({ error: 'INVALID_ALERT_ID', message: 'La alerta no es válida.' });
  try {
    const result = await pool.query(`
      UPDATE sos_alerts SET status = 'cancelled_false_alarm', resolved_at = NOW()
      WHERE alert_id = $1 AND sender_id = $2 AND status = 'active'
      RETURNING alert_id AS id, status, resolved_at
    `, [request.params.alertId, request.auth.userId]);
    if (!result.rowCount) return response.status(404).json({ error: 'ALERT_NOT_FOUND', message: 'No encontramos una alerta activa tuya.' });
    return response.json({ alert: result.rows[0] });
  } catch {
    return response.status(503).json({ error: 'SOS_CANCEL_UNAVAILABLE', message: 'No pudimos cancelar la alerta.' });
  }
});

app.post('/auth/otp/request', async (request, response, next) => {
  let requestedPhone;
  try {
    const { phone_number: phone, full_name: fullName, installation_id: installationId } = request.body ?? {};
    validateOtpRequest({ phone, fullName, installationId, ip: request.ip });
    requestedPhone = phone;
    const challenge = issueChallenge({ phone, fullName, installationId });
    const delivery = await otpProvider.sendOtp({ phoneNumber: phone, code: challenge.code });
    return response.status(200).json({
      message: delivery.demoCode ? 'Código generado para desarrollo. No se envió ningún SMS.' : 'Si el número puede registrarse, enviaremos un código.',
      ...(process.env.NODE_ENV === 'development' && delivery.demoCode ? { demo_code: delivery.demoCode } : {}),
      ...(delivery.demoCode ? { demo_only: true } : {}),
    });
  } catch (error) {
    if (requestedPhone) consumeChallenge(requestedPhone);
    if (error instanceof OtpError || error.status) {
      return response.status(error.status ?? 503).json({ error: error.code ?? 'OTP_UNAVAILABLE', message: error.message });
    }
    return next(error);
  }
});

app.post('/auth/otp/verify', async (request, response, next) => {
  const { phone_number: phone, code } = request.body ?? {};
  if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone) || typeof code !== 'string' || !/^\d{6}$/.test(code)) {
    return response.status(400).json({ error: 'INVALID_OTP_REQUEST', message: 'Ingresa el teléfono y el código de seis dígitos.' });
  }
  let client;
  try {
    const challenge = verifyChallenge({ phone, code, ip: request.ip });
    client = await pool.connect();
    await client.query('BEGIN');
    let result = await client.query(
      'SELECT user_id, full_name, phone_number, tier, is_suspended FROM users WHERE phone_number = $1 FOR UPDATE',
      [phone],
    );
    let user = result.rows[0];
    if (!user && challenge.fullName) {
      result = await client.query(
        `INSERT INTO users (full_name, phone_number, hardware_device_hash, tier)
         VALUES ($1, $2, $3, 'level_1_basic')
         ON CONFLICT (phone_number) DO NOTHING
         RETURNING user_id, full_name, phone_number, tier, is_suspended`,
        [challenge.fullName, phone, challenge.installationHash],
      );
      user = result.rows[0];
      if (!user) {
        result = await client.query(
          'SELECT user_id, full_name, phone_number, tier, is_suspended FROM users WHERE phone_number = $1 FOR UPDATE',
          [phone],
        );
        user = result.rows[0];
      }
    }
    if (!user) {
      await client.query('ROLLBACK');
      consumeChallenge(phone);
      return response.status(401).json({ error: 'ACCOUNT_NOT_FOUND', message: 'No encontramos una cuenta con ese número. Regístrate primero.' });
    }
    if (user.is_suspended) {
      await client.query('ROLLBACK');
      consumeChallenge(phone);
      return response.status(403).json({ error: 'ACCOUNT_SUSPENDED', message: 'Esta cuenta no puede iniciar sesión. Contacta al equipo de Mi Barrio.' });
    }
    await client.query('COMMIT');
    consumeChallenge(phone);
    return response.json({
      access_token: createAccessToken(user),
      user: { id: user.user_id, full_name: user.full_name, phone_number: user.phone_number, tier: user.tier },
    });
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => {});
    if (error instanceof OtpError) return response.status(error.status).json({ error: error.code, message: error.message });
    return next(error);
  } finally {
    client?.release();
  }
});

app.use((_request, response) => response.status(404).json({ error: 'Route not found.' }));

app.use((error, _request, response, _next) => {
  if (error?.message === 'Origin is not allowed by CORS.') return response.status(403).json({ error: 'Origin is not allowed.' });
  if (error?.type === 'entity.too.large') return response.status(413).json({ error: 'Request body is too large.' });
  if (error?.type === 'entity.parse.failed' || (error instanceof SyntaxError && 'body' in error)) return response.status(400).json({ error: 'Invalid JSON body.' });
  console.error('Unhandled API request error.');
  return response.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(port, '0.0.0.0', () => console.log(`Mi Barrio API listening on port ${port}`));

async function shutdown() {
  clearInterval(cleanupTimer);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
