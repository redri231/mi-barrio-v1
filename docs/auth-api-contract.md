# Contrato de API para acceso por OTP

La app móvil de Mi Barrio ya contiene las pantallas de registro e inicio de sesión. Ambas usan OTP por SMS y requieren un backend configurado mediante `EXPO_PUBLIC_API_URL`. El cliente no genera ni acepta códigos locales de prueba.

**Estado actual:** el backend define las dos rutas, pero responden `501` hasta seleccionar y configurar un proveedor SMS y completar el flujo de desafíos/sesión. No enviar a producción como autenticación disponible mientras sigan en ese estado.

## Solicitar código

`POST /auth/otp/request`

```json
{
  "phone_number": "+51999111222",
  "full_name": "Nombre Apellido"
}
```

`full_name` se omite al iniciar sesión. La respuesta debe ser `200` o `202` con un mensaje genérico que no revele si el teléfono ya tiene cuenta:

```json
{ "message": "Si el número puede registrarse, enviaremos un código." }
```

El servidor envía un OTP de seis dígitos con vencimiento corto, limita la frecuencia por teléfono, instalación/IP y ventana temporal, invalida códigos previos al reenviar y no registra el código en logs. Al crear cuenta, valida nombre y número y crea el perfil básico una vez que el código se confirme.

## Verificar código

`POST /auth/otp/verify`

```json
{
  "phone_number": "+51999111222",
  "code": "483921"
}
```

Respuesta exitosa:

```json
{
  "access_token": "<token de acceso>",
  "refresh_token": "<token de renovación opcional>",
  "user": {
    "id": "uuid",
    "full_name": "Nombre Apellido",
    "phone_number": "+51999111222"
  }
}
```

El servidor debe comparar el OTP de forma segura, aplicar límites a intentos fallidos, consumir el código tras usarlo y emitir una sesión de nivel 1. Para errores de validación/autenticación responder `400` o `401`; para límite temporal responder `429`, preferiblemente con `Retry-After`. No devolver tokens de administración al cliente.

## Configuración móvil

Definir `EXPO_PUBLIC_API_URL` como la URL HTTPS del backend en el entorno de Expo (por ejemplo, en `.env.local` para desarrollo; no incluir secretos en variables `EXPO_PUBLIC_*`). La app guarda la sesión con `expo-secure-store` en iOS/Android. En web usa `sessionStorage`, que tiene una protección distinta y no debe usarse para secretos duraderos.
