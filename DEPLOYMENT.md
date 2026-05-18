# Deploy en Vercel + Turso

Esta guía deja el proyecto listo para producción/QA usando:

- **Vercel** para frontend estático + API serverless.
- **Turso/libSQL** como base de datos persistente.
- **Google OAuth/Gmail API** con credenciales por variables de entorno.

> Privacidad: la app no guarda el historial completo de movimientos Gmail. Sí guarda tokens OAuth, sesiones, categorías, reglas, movimientos manuales y overrides. Trata la base Turso como información privada.

## 0. Archivos de entorno de ejemplo

Hay tres plantillas:

```text
.env.example          # desarrollo local con DB local o Turso opcional
.env.turso.example    # valores mínimos para probar Turso desde local
.env.vercel.example   # variables para configurar en Vercel
```

No edites esos ejemplos con secretos reales. Copia uno a `.env` para uso local:

```bash
cp .env.example .env
```

Como el proyecto no usa `dotenv`, para correr local leyendo `.env` usa:

```bash
set -a
source .env
set +a
npm start
```

## 1. Crear la base en Turso

Instala e inicia sesión en Turso si aún no lo hiciste:

```bash
curl -sSfL https://get.tur.so/install.sh | bash
turso auth login
```

Crea la base:

```bash
turso db create orderexpenses
```

Obtén la URL:

```bash
turso db show orderexpenses --url
```

Genera un token:

```bash
turso db tokens create orderexpenses
```

Guarda esos valores como:

```bash
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
```

## 2. Subir o inicializar la DB

### Opción A — Recomendada para QA limpio

No migres datos locales. Solo configura `TURSO_DATABASE_URL` y `TURSO_AUTH_TOKEN`. La app crea las tablas automáticamente al iniciar.

Úsala si no necesitas conservar sesiones/tokens/reglas/categorías locales.

### Opción B — Copiar tu DB local actual a Turso

Úsala solo si quieres conservar configuración local, tokens, categorías, reglas, movimientos manuales y overrides.

1. Detén el servidor local.
2. Asegúrate de tener `sqlite3`:

```bash
sqlite3 --version
```

3. Exporta la DB local:

```bash
mkdir -p tmp
sqlite3 data/finance.db .dump > tmp/finance.sql
```

4. Importa el dump en una DB Turso vacía:

```bash
turso db shell orderexpenses < tmp/finance.sql
```

5. Elimina el dump local porque puede contener tokens/datos privados:

```bash
rm tmp/finance.sql
```

Si la DB Turso ya fue inicializada y el dump falla por tablas existentes, lo más limpio es crear una DB nueva vacía o importar manualmente solo los `INSERT` que necesitas.

## 3. Probar Turso desde local

Copia el ejemplo:

```bash
cp .env.turso.example .env
```

Reemplaza:

```text
TURSO_DATABASE_URL=...
TURSO_AUTH_TOKEN=...
```

Luego corre:

```bash
set -a
source .env
set +a
npm test
npm start
```

Abre:

```text
http://127.0.0.1:3000
```

## 4. Configurar Google OAuth para Vercel

En Google Cloud Console:

1. Abre tu proyecto.
2. Habilita **Gmail API**.
3. En OAuth consent screen, mantén **Testing** si es QA y agrega los correos permitidos como test users.
4. Crea o edita un OAuth Client tipo **Web application**.
5. Agrega estos valores:

Authorized JavaScript origins:

```text
https://TU-DOMINIO.vercel.app
```

Authorized redirect URIs:

```text
https://TU-DOMINIO.vercel.app/auth/google/callback
```

6. Copia:

```text
GOOGLE_CLIENT_ID
GOOGLE_CLIENT_SECRET
```

La app también sigue soportando el archivo local `data/google-credentials.json`, pero para Vercel debes usar variables de entorno.

## 5. Configurar Vercel

Importa el repo `ggabrielgp/orderexpenses` desde el dashboard de Vercel o con CLI:

```bash
npm i -g vercel
vercel login
vercel link
```

En Vercel → Project Settings → Environment Variables, agrega los valores de `.env.vercel.example` reemplazados:

```text
NODE_ENV=production
APP_BASE_URL=https://TU-DOMINIO.vercel.app
TURSO_DATABASE_URL=libsql://...
TURSO_AUTH_TOKEN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REDIRECT_URI=https://TU-DOMINIO.vercel.app/auth/google/callback
SESSION_COOKIE_NAME=finance_session
SESSION_TTL_DAYS=30
COOKIE_SECURE=true
ALLOW_UNSAFE_HOST=true
```

Configura esas variables para los ambientes que usarás:

- **Production**
- **Preview** si vas a probar branches/PRs
- **Development** solo si usarás `vercel dev`

## 6. Deploy

Desde local:

```bash
vercel
```

Para producción:

```bash
vercel --prod
```

O usa el deploy automático desde GitHub al hacer push a `main`.

## 7. Validación post-deploy

1. Abre la URL de Vercel.
2. Verifica `/api/gmail/status` desde el navegador:

```text
https://TU-DOMINIO.vercel.app/api/gmail/status
```

Debe responder JSON.

3. En la app, presiona **Conectar Gmail**.
4. Google debe volver a:

```text
https://TU-DOMINIO.vercel.app/auth/google/callback
```

5. Sincroniza el periodo.
6. Valida:
   - movimientos visibles;
   - categorías personalizadas;
   - reglas por comercio;
   - desconectar/conectar Gmail;
   - otro usuario/test user no ve tus datos.

## 8. Problemas comunes

### `redirect_uri_mismatch`

El valor de Google Cloud debe coincidir exactamente con:

```text
GOOGLE_REDIRECT_URI=https://TU-DOMINIO.vercel.app/auth/google/callback
```

Incluye protocolo `https`, dominio correcto y path completo.

### `Missing Google OAuth credentials`

Faltan `GOOGLE_CLIENT_ID` o `GOOGLE_CLIENT_SECRET` en Vercel.

### `Gmail no está conectado todavía`

El usuario todavía no completó OAuth o el token fue eliminado.

### Error de Turso/libSQL

Revisa:

```text
TURSO_DATABASE_URL
TURSO_AUTH_TOKEN
```

También confirma que el token pertenece a la DB correcta. En Vercel la app falla rápido si `TURSO_DATABASE_URL` no está configurado, para evitar usar una DB local efímera serverless.

### Cookies no persisten

En Vercel usa:

```text
COOKIE_SECURE=true
APP_BASE_URL=https://TU-DOMINIO.vercel.app
```

### El callback `/auth/google/callback` no llega a la API

El repo incluye `vercel.json` para reescribir `/auth/*` hacia la función serverless. Asegúrate de desplegar esa versión.

### Preview deployments dan 403 en POST/PATCH/DELETE

La app valida `Origin` para mutaciones. En Vercel se permite `APP_BASE_URL` y también el dominio automático `VERCEL_URL` del deployment actual. Si usas un dominio custom para preview, configura `APP_BASE_URL` para ese ambiente.
