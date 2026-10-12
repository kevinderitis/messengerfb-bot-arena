# Messenger Bot Arena

Automatización de Facebook Messenger con Playwright, MongoDB y panel administrativo.

## Stack

| Capa | Tecnología |
|------|-----------|
| Runtime | Node.js 20.14+ (ESM) |
| Backend | Express 4 |
| Base de datos | MongoDB + Mongoose 8 |
| Automatización | Playwright (Chromium persistente) |
| Auth panel | JWT en cookie httpOnly + bcryptjs |
| Scheduler | node-cron |
| Logging | pino + pino-pretty |
| Frontend | SPA estática (HTML/CSS/JS vanilla) |

## Instalación

```bash
# 1. Instalar dependencias
npm install

# 2. Instalar Chromium para Playwright
npx playwright install chromium

# 3. Configurar variables de entorno
cp .env.example .env
# Editar .env con tus valores

# 4. Asegurar que MongoDB esté corriendo
#    mongodb://127.0.0.1:27017/messenger_automation

# 5. Iniciar
npm start
# o en desarrollo:
npm run dev
```

## Windows

```bat
start.bat
```

El script verifica Node.js, instala dependencias si es necesario, abre el navegador en `http://localhost:3000/admin` e inicia el servidor.

### Inicio automático en Windows

1. Abra el Programador de tareas (`taskschd.msc`)
2. Cree una tarea básica que ejecute `start.bat` al iniciar sesión
3. **Importante**: la tarea debe ejecutarse con la sesión de usuario activa para que el navegador sea visible durante el login manual

### Requisitos para login manual

- El servidor debe ejecutarse en una sesión de usuario interactiva (no como servicio de Windows sin sesión)
- La variable `MESSENGER_HEADLESS` debe ser `false` (por defecto)
- El navegador Chromium se abrirá visible para que el usuario complete el login

## Primer uso

1. Abra `http://localhost:3000/admin`
2. Inicie sesión con las credenciales de `.env` (por defecto: `admin` / `admin`)
3. Pulse **Conectar Messenger**
4. Complete el login de Facebook en la ventana de Chromium que se abre
5. Si Facebook solicita verificación adicional, complétela manualmente
6. El panel actualizará el estado a `connected` cuando Messenger esté disponible

## API HTTP

### Enviar mensaje

```bash
POST /api/messenger/send
Content-Type: application/json
Authorization: Bearer <MESSENGER_API_TOKEN>

{
  "recipientType": "group",
  "recipientId": "IDENTIFICADOR_REAL_DEL_GRUPO",
  "message": "Hola, este es un mensaje automático."
}
```

### Consultar estado

```bash
GET /api/messenger/status
Authorization: Bearer <MESSENGER_API_TOKEN>
```

### Ejemplo Node.js

Ver `examples/send-message.mjs`.

## Estructura del proyecto

```
messengerfb-bot-arena/
├── public/admin.html          # Panel administrativo SPA
├── scripts/create-admin.mjs   # Crear usuario admin manualmente
├── src/
│   ├── index.js               # Entry point
│   ├── config.js              # Configuración centralizada
│   ├── models/                # Modelos Mongoose
│   ├── routes/                # Rutas Express
│   ├── services/
│   │   ├── MessengerService.js # Servicio principal de Playwright
│   │   ├── Scheduler.js       # Programación de mensajes
│   │   └── selectors.js       # Selectores centralizados
│   └── utils/                 # Logger, locks
├── test/                      # Pruebas (node:test)
├── examples/                  # Ejemplos de uso
├── start.bat                  # Lanzador Windows
└── .env.example               # Plantilla de configuración
```

## Perfil persistente

El perfil de Chromium se almacena en `./data/messenger-profile` (configurable con `MESSENGER_BROWSER_PROFILE`). Este directorio:

- Está excluido de Git (`.gitignore`)
- Contiene las cookies y sesión de Facebook
- No debe compartirse ni exponerse
- Puede eliminarse para forzar un nuevo login

## Pruebas

```bash
npm test              # Tests unitarios
npm run test:integration  # Tests de integración (requieren servidor + Facebook real)
```

## Variables de entorno

Ver `.env.example` para la lista completa.

## Seguridad

- Las contraseñas del panel se almacenan con bcrypt (10 rondas)
- El token de API es independiente de las credenciales del panel
- El perfil del navegador está protegido con archivo de bloqueo
- No se almacenan contraseñas de Facebook ni cookies en MongoDB
- En producción, cambie `ADMIN_PASSWORD`, `ADMIN_JWT_SECRET` y `MESSENGER_API_TOKEN`

## Limitaciones

- La automatización depende de la interfaz web de Facebook; cambios en la UI pueden requerizar actualización de selectores
- El login manual es necesario la primera vez y cuando la sesión expira
- Los mensajes grupales requieren que el bot ya sea miembro del grupo
- No se soporta envío de imágenes ni archivos adjuntos
