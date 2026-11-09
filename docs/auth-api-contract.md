# Autenticación OTP de Mi Barrio

El registro y el inicio de sesión conservan `POST /auth/otp/request` y `POST /auth/otp/verify`. El backend genera códigos aleatorios de seis dígitos, los guarda como HMAC en memoria durante cinco minutos y los valida del lado servidor. La app móvil nunca genera, recibe ni muestra el código.

## Proveedor SMS

El adaptador actual usa Twilio Programmable Messaging. Configura solo en el backend:

- `OTP_PROVIDER=twilio`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER` en formato E.164, por ejemplo `+1...`
- `AUTH_TOKEN_SECRET`, una cadena aleatoria de al menos 32 caracteres

Si Twilio no está configurado, conserva `OTP_PROVIDER=disabled`: las rutas OTP responderán `503` y no crearán cuentas. El proveedor simulado fue retirado; no existe código universal ni modo de revelar el OTP.

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

El esquema existente no contiene tabla de desafíos OTP. Los hashes, estados y límites se mantienen en memoria del proceso; al reiniciar el servidor se pierden. Es apto para un único proceso MVP; antes de escalar a múltiples instancias debe moverse a almacenamiento compartido con TTL y límites atómicos. El OTP nunca se guarda en PostgreSQL ni en logs.
