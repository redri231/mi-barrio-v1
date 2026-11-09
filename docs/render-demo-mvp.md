# Deploy de demostracion del MVP en Render

Esta guia convierte temporalmente el Web Service actual en un entorno de desarrollo para una demostracion controlada. El backend conserva la validacion que impide arrancar con OTP simulado cuando `NODE_ENV=production`.

## Variables del Web Service

En Render abre el servicio de la API, entra a **Environment** y configura:

| Variable | Valor |
| --- | --- |
| `NODE_ENV` | `development` |
| `OTP_PROVIDER` | `simulated` |
| `OTP_DEMO_MODE` | `true` |
| `DATABASE_URL` | Conserva la URL de la base asignada a este servicio |
| `AUTH_TOKEN_SECRET` | Conserva un secreto aleatorio de al menos 32 caracteres |

Conserva las demas variables que el servicio ya utiliza. No agregues `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` ni `TWILIO_PHONE_NUMBER`: el proveedor simulado no usa un servicio de mensajeria.

Guarda los cambios y deja que Render despliegue el servicio. Confirma que inicia y consulta `https://<servicio>.onrender.com/health/ready`.

## APK de demostracion

La API devuelve `demo_code` y `demo_only` unicamente cuando el proveedor simulado esta habilitado en desarrollo. La app conserva y muestra el codigo solo cuando recibe ambas propiedades. Despues de subir los cambios de la app, crea e instala un APK nuevo.

En el entorno EAS `preview`, configura `EXPO_PUBLIC_API_URL` con la URL HTTPS del Web Service, sin `/` final. Esa variable se incorpora al APK durante la compilacion.

## Limites de seguridad

El modo simulado permite verificar un numero sin demostrar que el usuario controla ese telefono. Usa solo datos de prueba y no compartas el servicio/APK con usuarios externos ni lo conectes a datos personales. Antes de un lanzamiento formal, configura `NODE_ENV=production` y un proveedor SMS real o deja OTP deshabilitado hasta integrar uno.

No se modifican tablas ni se ejecutan migraciones.
