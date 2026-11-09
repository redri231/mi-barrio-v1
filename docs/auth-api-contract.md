# Autenticación OTP de Mi Barrio

El registro y el inicio de sesión conservan `POST /auth/otp/request` y `POST /auth/otp/verify`. El backend genera códigos aleatorios de seis dígitos, los guarda como HMAC en memoria durante cinco minutos y los valida del lado servidor. En el modo simulado, el código solo se devuelve al cliente en desarrollo explícito.

## SMS simulado para desarrollo

Para desarrollo local configura `NODE_ENV=development`, `OTP_PROVIDER=simulated` y `OTP_DEMO_MODE=true` solo en `server/.env`. El backend genera el código real del desafío y lo devuelve como `demo_code`; la pantalla de verificación de una app `__DEV__` lo muestra y lo rellena. No se envía SMS y no existe código fijo.

El servidor rechaza el proveedor simulado si `NODE_ENV=production`, y también rechaza `OTP_DEMO_MODE=true` en producción. La app solo muestra el código cuando su bundle está en modo de desarrollo.

## Proveedor SMS real

El adaptador actual usa Twilio Programmable Messaging. Configura solo en el backend:

- `OTP_PROVIDER=twilio`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` en formato E.164, por ejemplo `+1...`
- `AUTH_TOKEN_SECRET`, una cadena aleatoria de al menos 32 caracteres

Para producción usa `OTP_PROVIDER=twilio`, quita `OTP_DEMO_MODE` o déjalo en `false`, y configura las credenciales. Si no hay proveedor configurado, `OTP_PROVIDER=disabled` hace que las rutas respondan `503` sin crear cuentas.

## Solicitar un código

`POST /auth/otp/request`

```json
{
  "phone_number": "+51999111222",
  "full_name": "Nombre Apellido",
  "installation_id": "uuid-persistente-de-la-instalacion"
}
```

`full_name` se omite al iniciar sesión. `installation_id` es un UUID aleatorio persistido por la app; el servidor guarda en `users.hardware_device_hash` un SHA-256 del identificador.

## Verificar

`POST /auth/otp/verify`

```json
{
  "phone_number": "+51999111222",
  "code": "483921"
}
```

El servidor permite hasta cinco intentos incorrectos y limita solicitudes por teléfono e IP, además de verificaciones por IP. La respuesta exitosa incluye un JWT firmado por una hora y el perfil. El usuario nuevo se crea en `users` con nivel `level_1_basic` solo después de verificar correctamente el SMS. Para iniciar sesión, el número debe existir previamente.

## Estado y límites operativos

El esquema existente no contiene tabla de desafíos OTP. Los hashes, estados y límites se mantienen en memoria del proceso; al reiniciar el servidor se pierden. Es apto para un único proceso MVP; antes de escalar a múltiples instancias debe moverse a almacenamiento compartido con TTL y límites atómicos. El OTP nunca se guarda en PostgreSQL ni en logs. En modo simulado el código se entrega en la respuesta local y queda guardado temporalmente en SecureStore hasta completar o reiniciar el registro.
