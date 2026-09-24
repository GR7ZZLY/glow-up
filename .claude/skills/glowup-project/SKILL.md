---
name: glowup-project
description: Contexto y reglas de desarrollo del proyecto Glow Up, sistema de automatización para salón de belleza. Usar cuando se trabaje en cualquier parte del proyecto Glow Up.
---

# Glow Up — Contexto del proyecto

## 1. Objetivo

Glow Up es un proyecto real de automatización para un pequeño salón de belleza.

Objetivo final:

TikTok
→ WhatsApp
→ WhatsApp Cloud API / Meta
→ Webhook
→ Backend Node.js + Express
→ Supabase / PostgreSQL
→ Clientes, conversaciones, mensajes, servicios y citas
→ Google Calendar
→ Dashboard administrativo
→ IA para automatización

El proyecto debe construirse progresivamente.

NO implementar todo de una vez.

---

## 2. Usuario desarrollador

El desarrollador está aprendiendo programación y backend.

Aunque estudia Ingeniería de Sistemas, necesita explicaciones prácticas y sencillas.

Prioridad:

1. Que funcione.
2. Que pueda entenderlo.
3. Que sea mantenible.
4. Evitar complejidad innecesaria.
5. Reducir consumo innecesario de tokens.

No asumir conocimientos avanzados.

---

## 3. Regla principal de desarrollo

Trabajar siempre por etapas:

PLANEAR
→ IMPLEMENTAR
→ PROBAR
→ CORREGIR
→ CONTINUAR

Nunca generar cientos de líneas de código si el siguiente paso puede resolverse con unas pocas.

No implementar tecnologías futuras antes de necesitarlas.

---

## 4. Stack objetivo

Backend:

- Node.js
- Express

Base de datos:

- Supabase
- PostgreSQL

Mensajería:

- WhatsApp Cloud API
- Meta

Agenda:

- Google Calendar

Hosting:

- Render

IA futura:

- Gemini u otra API disponible

Frontend:

- HTML
- CSS
- JavaScript

El stack puede evolucionar si existe una razón técnica clara.

---

## 5. Estado actual

Proyecto local:

GlowUp-Automatizacion

Ruta:

C:\Users\Yoshiro\Desktop\GlowUp-Automatizacion

Repositorio GitHub:

GR7ZZLY/glow-up (rama main)

Archivos principales:

- package.json ("type": "commonjs", "start": "node server.js")
- package-lock.json
- server.js (punto de entrada)
- .env (NUNCA subido a GitHub, confirmado)
- .gitignore
- .claude/skills/glowup-project/SKILL.md

Servidor:

- Local: `npm start` → http://localhost:3000
- Producción: https://glow-up-js07.onrender.com (Render, plan Free)
- Puerto: `const PORT = process.env.PORT || 3000;`

Supabase (tablas creadas):

- clientes
- conversaciones
- mensajes
- servicios
- citas
- cita_servicios

Webhook de WhatsApp:

- URL configurada en Meta: https://glow-up-js07.onrender.com/webhook
- Probado OK el 24/09/2026 con el botón "Probar" de Meta: el mensaje llegó a Render y se guardó en Supabase (mensajes.id 13), reutilizando la conversación existente del mismo cliente.
- ngrok ya NO se usa.
- Función `enviarMensajeWhatsApp(telefono, texto)` en `server.js` (fetch nativo a Graph API v25.0).
- `POST /webhook` responde automáticamente "Hola, en un momento te atendemos." si la conversación está en `BOT_ACTIVO`, y lo guarda como `BOT`. En `ATENCION_HUMANA` no responde. Si el envío falla, solo `console.error` y Meta sigue recibiendo 200.
- Probado OK el 24/09/2026 localmente y en Render.

Endpoints existentes: revisar server.js antes de crear uno nuevo, para no duplicar rutas.

---

## 6. Próximo objetivo inmediato

Pendientes, en este orden:

a) Verificar la firma `X-Hub-Signature-256` en `POST /webhook` usando el App Secret (hoy cualquiera que conozca la URL puede simular mensajes). Obligatorio antes de clientes reales.
b) Evitar que el bot repita la misma respuesta a cada mensaje del cliente.
c) Evitar duplicados si Meta reenvía un evento (usar el id del mensaje de WhatsApp).
d) Mejorar la respuesta del bot (ej. lista de servicios), con lógica simple, sin IA.

---

# 7. Datos del negocio

Nombre:

Glow Up

WhatsApp:

+51 987 140 537

TikTok:

@glowup_beautype

Horario:

Todos los días
10:00 AM - 9:00 PM

Adelanto:

50%

---

# 8. Servicios

## CABELLO

- Alisado Orgánico — Desde S/200
- Alisado Vegetal / Termo Vital — Desde S/300
- Alisado Diamond — Desde S/350
- Botox Capilar — Desde S/100
- Tratamiento Antifrizz y Porosidad — Desde S/150
- Bioplastia — Desde S/150
- Tinte de cabello — Desde S/100
- Tinte de raíz — Desde S/80
- Baño de color — Desde S/100
- Babylights — Desde S/350
- Mechas — Desde S/350
- Corrección de color — Desde S/200
- Planchado — Desde S/40
- Cepillado / Brushing — Desde S/40
- Peinado — Desde S/50

## MANICURE

- Manicure clásica — S/25
- Gel — S/30
- Rubber — S/40
- Acrílicas — S/50
- Polygel — S/60
- Soft Gel — S/60
- Retiro de producto — Desde S/10
- Diseño / Nail Art — Desde S/10

## PEDICURE

- Pedicure semipermanente — Desde S/40
- Retiro de producto — Desde S/10
- Diseño de uñas — Desde S/10

## PESTAÑAS

- Lifting clásico — S/40
- Lifting efecto rímel — S/50
- Lifting coreano — S/80
- Extensiones de pestañas clásicas — S/50
- Extensiones de pestañas rímel — S/80
- Extensiones tecnológicas — S/70
- Retiro de extensiones — S/15

## CEJAS

- Perfilado de cejas — S/10
- Diseño de cejas — S/15
- Laminado de cejas — S/30
- Laminado + perfilado — S/35
- Tinte de cejas — S/25

---

# 9. Regla de precios

Existen dos tipos:

FIJO

DESDE

Ejemplo:

Manicure clásica:

precio: 25
tipo_precio: FIJO

Alisado Orgánico:

precio: 200
tipo_precio: DESDE

Nunca convertir un precio "Desde" en precio definitivo.

No inventar precios.

---

# 10. Duración

Actualmente NO conocemos las duraciones exactas de todos los servicios.

No inventar duraciones.

La duración puede ser NULL en la base de datos.

---

# 11. Citas

Una cita puede tener múltiples servicios.

Ejemplo:

Cliente:
María

Cita:
10:00 AM

Servicios:

- Manicure
- Pedicure
- Diseño de uñas

La arquitectura debe permitir:

citas
↓
cita_servicios
↓
varios servicios

---

# 12. Estados de citas

Estados previstos:

- Pendiente
- Esperando adelanto
- Comprobante recibido
- Confirmada
- Cancelada

No implementar todos hasta que sean necesarios.

---

# 13. Conversaciones

Estados previstos:

- BOT ACTIVO
- ATENCIÓN HUMANA
- PENDIENTE
- CERRADA

Cuando un trabajador tome una conversación:

BOT ACTIVO
↓
ATENCIÓN HUMANA

Durante ATENCIÓN HUMANA el bot no debe responder automáticamente.

---

# 14. Entidades

Ya creadas en Supabase:

clientes
conversaciones
mensajes
servicios
citas
cita_servicios

Pendiente:

pagos → no crear hasta que se necesite gestionar adelantos.

---

# 15. Dashboard futuro

Dashboard administrativo:

- Chat en Vivo
- Citas
- Clientes
- Servicios
- Métricas
- Configuración

Debe permitir posteriormente:

- visualizar conversaciones
- visualizar mensajes
- gestionar clientes
- gestionar servicios
- gestionar citas
- gestionar adelantos
- controlar atención humana
- consultar métricas

No construir el dashboard completo todavía.

---

# 16. Reglas de IA

La IA se incorporará posteriormente.

No utilizar IA para resolver problemas que pueden resolverse con lógica sencilla.

Ejemplo:

Consultar precio de un servicio conocido:

NO necesita IA.

Clasificar una intención compleja del cliente:

Puede utilizar IA posteriormente.

Priorizar lógica determinista antes que IA.

---

# 17. Reglas contra datos inventados

Nunca inventar:

- precios
- duración
- trabajadores
- horarios individuales
- políticas de cancelación
- métodos de pago
- disponibilidad
- promociones
- información legal
- datos de clientes

Si falta información:

1. Preguntar.
2. O dejar el campo configurable.
3. O utilizar NULL cuando corresponda.

Nunca asumir.

---

# 18. Forma de responder al desarrollador

Cuando el desarrollador solicite una tarea:

1. Identificar el siguiente paso mínimo.
2. Explicar brevemente qué se hará.
3. Indicar exactamente qué archivo modificar.
4. Proporcionar solamente el código necesario.
5. Indicar el comando para probarlo.
6. Indicar el resultado esperado.

No entregar implementaciones gigantes si no son necesarias.

---

# 19. Manejo de errores

Si existe un error:

1. Explicar qué significa.
2. Identificar la causa probable.
3. Proponer la corrección mínima.
4. Volver a probar.
5. No modificar múltiples partes sin necesidad.

---

# 20. Dependencias

Antes de instalar una dependencia nueva:

Explicar:

- qué hace
- por qué se necesita
- si existe una alternativa sin instalarla

No instalar paquetes innecesarios.

---

# 21. Seguridad

Nunca colocar:

- API keys
- tokens
- contraseñas
- secretos
- credenciales

directamente en el código.

Local: usar .env (actualmente tiene 5 variables).

Producción: las mismas variables están cargadas en Render → Environment.

Si se agrega una variable nueva al .env, también hay que agregarla en Render, o fallará en producción.

No agregar PORT en Render (Render la asigna solo).

Nunca subir .env al repositorio.

Nunca pegar el contenido del .env en chats.

---

# 22. Arquitectura progresiva

ETAPA 1: Node.js + Express ✅
ETAPA 2: API REST básica
ETAPA 3: Estructuración del backend
ETAPA 4: Supabase ✅
ETAPA 5: WhatsApp Cloud API (recepción ✅ / envío ✅)
ETAPA 6: Webhooks ✅
ETAPA 7: Gestión de conversaciones (en progreso)
ETAPA 8: Google Calendar
ETAPA 9: Dashboard
ETAPA 10: IA
ETAPA 11: Render ✅ (adelantada para tener una URL fija del webhook en vez de ngrok)

Las etapas pueden ajustarse si existe una razón técnica.

---

# 23. Principio de simplicidad

Preferir:

código simple
→ estructura clara
→ pocas dependencias
→ funciones pequeñas
→ nombres claros

Evitar:

arquitecturas excesivamente complejas
microservicios innecesarios
frameworks innecesarios
dependencias innecesarias
IA para tareas simples

---

# 24. Objetivo final

El sistema debe convertirse progresivamente en una plataforma donde Glow Up pueda:

- recibir clientes desde WhatsApp
- responder consultas
- mostrar servicios
- identificar servicios solicitados
- registrar clientes
- gestionar conversaciones
- permitir intervención humana
- recibir adelantos
- registrar citas
- sincronizar Google Calendar
- administrar citas
- consultar métricas
- utilizar IA cuando realmente aporte valor

Pero todo debe construirse progresivamente y ser probado antes de avanzar.

---

# 25. Decisiones técnicas confirmadas

Formato de teléfono: `clientes.telefono` se guarda como código de país + número, sin `+`, sin espacios ni guiones (ej. `51999888777`) — igual al formato que entrega WhatsApp Cloud API en el campo `from` de los mensajes entrantes. Decisión tomada para evitar conversiones innecesarias al conectar el webhook.

Valor de `mensajes.remitente`: para mensajes entrantes de WhatsApp se usa `CLIENTE`, y para respuestas automáticas se usa `BOT` — consistente con la nomenclatura ya usada en `conversaciones.estado` (`BOT_ACTIVO`, `ATENCION_HUMANA`). No existe todavía un tercer valor para atención humana con trabajador identificado, porque no hay tabla de trabajadores/usuarios en el sistema; esa es una decisión pendiente y separada, no tomar todavía.

Limitación conocida del webhook de WhatsApp: mientras la app de Meta esté en modo Desarrollo (sin publicar), Meta NO reenvía mensajes reales de WhatsApp al webhook — solo eventos sintéticos disparados manualmente con el botón "Probar" del panel de Meta. Esto fue confirmado probando ambos casos: el botón "Probar" sí llega a `POST /webhook` y guarda correctamente en la base de datos, pero un mensaje real enviado desde WhatsApp (con doble check de entregado) nunca llega.

Para recibir mensajes reales de clientes se necesita: (1) Verificación de Negocio de la empresa ante Meta (documentos legales del negocio), y (2) Revisión de la app (App Review) y publicación. Esto es una decisión pendiente que le corresponde a la dueña del negocio, no una tarea técnica de desarrollo — no iniciar sin su aprobación explícita.

Mientras tanto, el desarrollo y las pruebas del webhook continúan usando el botón "Probar" del panel de Meta, que simula el flujo completo de forma equivalente.

Despliegue en Render (24/09/2026):

- Servicio: glow-up, plan Free, región Oregon.
- Build Command: `npm install`. Start Command: `node server.js`.
- Render asigna el puerto (actualmente 10000) mediante `process.env.PORT`.
- En los logs de Render aparece `injected env (0) from .env`: es normal, porque en Render no existe archivo .env; las variables llegan desde la configuración de Render.
- El plan Free "duerme" el servidor tras ~15 minutos sin uso; la primera petición puede tardar ~50 segundos. Aceptable para pruebas; revisar antes de atender clientes reales.
- Cada `git push` a main puede disparar un nuevo deploy automático en Render.
- Los logs en Render: menú izquierdo → Logs. Solo muestran lo que el código imprime con console.log ("Request logs" no está disponible en el plan Free).

Token de WhatsApp: permanente, generado con el usuario del sistema "glowup-bot" en el portafolio comercial "GlowUp" (business_id 1642748234116647), con permisos `whatsapp_business_messaging` y `whatsapp_business_management`. Guardado en `WHATSAPP_ACCESS_TOKEN` (.env y Render).

Para administrar el portafolio GlowUp hay que entrar a business.facebook.com con la cuenta principal de Facebook, NO con la cuenta vinculada de Instagram (esa solo ve el portafolio GR1ZZLY, que no tiene la app).

En modo desarrollo solo se puede enviar a números agregados como destinatarios de prueba, y el texto libre requiere que el cliente haya escrito en las últimas 24 horas.

Para probar el webhook sin Meta se puede simular un evento con PowerShell (Invoke-RestMethod a /webhook con un JSON de entry/changes/value/messages).