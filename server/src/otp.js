import { createHash, createHmac, randomBytes, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

const OTP_TTL_MS = 5 * 60 * 1000;
const MAX_VERIFY_ATTEMPTS = 5;
const PHONE_WINDOW_MS = 15 * 60 * 1000;
const REQUEST_COOLDOWN_MS = 60 * 1000;
const challenges = new Map();
const otpHashSecret = randomBytes(32);
const phoneRequests = new Map();
const ipRequests = new Map();
const ipVerifications = new Map();

export class OtpError extends Error {
  constructor(message, status = 400, code = 'OTP_INVALID') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function digest(code, salt) {
  return createHmac('sha256', otpHashSecret).update(`${salt}:${code}`).digest();
}

function consumeRateLimit(map, key, limit, windowMs) {
  const now = Date.now();
  const recent = (map.get(key) ?? []).filter((timestamp) => now - timestamp < windowMs);
  if (recent.length >= limit) {
    map.set(key, recent);
    return false;
  }
  recent.push(now);
  map.set(key, recent);
  return true;
}

function prune() {
  const now = Date.now();
  for (const [phone, challenge] of challenges) {
    if (challenge.expiresAt + OTP_TTL_MS < now) challenges.delete(phone);
  }
  for (const map of [phoneRequests, ipRequests, ipVerifications]) {
    for (const [key, times] of map) {
      const recent = times.filter((timestamp) => now - timestamp < PHONE_WINDOW_MS);
      if (recent.length) map.set(key, recent);
      else map.delete(key);
    }
  }
}

export function validateOtpRequest({ phone, fullName, installationId, ip }) {
  if (typeof phone !== 'string' || !/^\+[1-9]\d{7,14}$/.test(phone)) {
    throw new OtpError('Ingresa un número de teléfono válido.', 400, 'INVALID_PHONE');
  }
  if (fullName !== undefined && (typeof fullName !== 'string' || fullName.trim().length < 2 || fullName.trim().length > 120)) {
    throw new OtpError('El nombre debe tener entre 2 y 120 caracteres.', 400, 'INVALID_NAME');
  }
  if (typeof installationId !== 'string' || !/^[\w-]{16,100}$/.test(installationId)) {
    throw new OtpError('No se pudo identificar esta instalación. Actualiza la app e inténtalo nuevamente.', 400, 'INVALID_INSTALLATION');
  }
  prune();
  const prior = phoneRequests.get(phone) ?? [];
  if (prior.length && Date.now() - prior[prior.length - 1] < REQUEST_COOLDOWN_MS) {
    throw new OtpError('Espera un minuto antes de solicitar otro código.', 429, 'OTP_RATE_LIMIT');
  }
  if (!consumeRateLimit(phoneRequests, phone, 3, PHONE_WINDOW_MS) || !consumeRateLimit(ipRequests, ip, 20, PHONE_WINDOW_MS)) {
    throw new OtpError('Hiciste varias solicitudes. Espera antes de volver a probar.', 429, 'OTP_RATE_LIMIT');
  }
}

export function issueChallenge({ phone, fullName, installationId }) {
  const code = String(randomInt(100000, 1000000));
  const salt = randomUUID();
  challenges.set(phone, {
    salt,
    codeHash: digest(code, salt),
    fullName: fullName?.trim() || null,
    installationHash: createHash('sha256').update(installationId).digest('hex'),
    expiresAt: Date.now() + OTP_TTL_MS,
    attempts: 0,
    status: 'pending',
  });
  return { code, expiresInSeconds: OTP_TTL_MS / 1000 };
}

export function verifyChallenge({ phone, code, ip }) {
  prune();
  if (!consumeRateLimit(ipVerifications, ip, 30, PHONE_WINDOW_MS)) {
    throw new OtpError('Hiciste varios intentos. Espera antes de volver a probar.', 429, 'OTP_RATE_LIMIT');
  }
  const challenge = challenges.get(phone);
  if (!challenge || challenge.status !== 'pending') {
    throw new OtpError('El código no es correcto o ya venció.', 401);
  }
  if (Date.now() >= challenge.expiresAt) {
    challenge.status = 'expired';
    challenges.delete(phone);
    throw new OtpError('El código venció. Solicita uno nuevo.', 401, 'OTP_EXPIRED');
  }
  challenge.attempts += 1;
  const candidate = digest(String(code), challenge.salt);
  const valid = candidate.length === challenge.codeHash.length && timingSafeEqual(candidate, challenge.codeHash);
  if (!valid) {
    if (challenge.attempts >= MAX_VERIFY_ATTEMPTS) {
      challenge.status = 'locked';
      challenges.delete(phone);
    }
    throw new OtpError('El código no es correcto o ya venció.', 401);
  }
  challenge.status = 'verified';
  return { ...challenge };
}

export function consumeChallenge(phone) {
  const challenge = challenges.get(phone);
  if (challenge) challenge.status = 'consumed';
  challenges.delete(phone);
}

export function clearExpiredChallenges() {
  prune();
}
