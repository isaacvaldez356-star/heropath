# HeroPath

App de desarrollo personal gamificada: un árbol de habilidades con 6 ramas, cursos con lecciones (lección → reto → examen), XP, rangos, rachas, misiones diarias, badges, librería y comunidad.

Se despliega en **Vercel** (frontend estático + API como función serverless) con **Supabase** (Postgres) como base de datos. En local funciona sin configurar nada gracias a PGlite (Postgres embebido).

## Stack
- **Runtime:** Node.js 20+
- **API:** Express (en Vercel corre como función en `api/index.js`)
- **Base de datos:** Postgres — Supabase en producción, PGlite en local y tests
- **Auth:** JWT (30 días) + bcryptjs
- **Frontend:** React 18 + Babel standalone (sin build), en `public/`

## Estructura

| Archivo | Qué contiene |
|---------|--------------|
| `server.js` | API REST, lógica de progreso, XP, badges y misiones. En local también sirve `public/`. |
| `db.js` | Conexión: `pg` si hay `DATABASE_URL`, PGlite si no. Aplica el esquema al arrancar. |
| `supabase/schema.sql` | Tablas, índices únicos anti‑duplicados y RLS. Idempotente. |
| `api/index.js` | Entrada de la función de Vercel. |
| `vercel.json` | Sirve `public/` y envía `/api/*` a la función. |
| `catalog.js` | Ramas, cursos (temario), recursos de la librería, badges, misiones y valores de XP. |
| `lessons/` | Contenido de las lecciones, un archivo por rama (`cuerpo.js`, `mente.js`…). `index.js` los une. |
| `public/index.html` | App principal: Inicio, Árbol, Escuela, Librería, Comunidad y Perfil. |
| `public/leccion.html` | Reproductor de lección: `leccion.html?course=<id>&lesson=<n>`. |
| `test/api.test.js` | Tests de integración de la API. |

---

## Desarrollo local

```bash
npm install
npm start          # http://localhost:3001 (PGlite en data/)
npm test           # tests de la API
```

Para probar contra Supabase en local, copia `.env.example` a `.env` y rellena `DATABASE_URL`.

---

## Despliegue: Supabase + Vercel

### 1. Supabase
1. Crea un proyecto en [supabase.com](https://supabase.com) y guarda la contraseña de la base de datos.
2. *(Opcional)* En **SQL Editor** pega y ejecuta `supabase/schema.sql`. Si no, el servidor lo aplica solo en el primer arranque.
3. En **Connect → Connection string** copia la del **Transaction pooler** (puerto `6543`) y sustituye `[YOUR-PASSWORD]`. Es la adecuada para funciones serverless.

### 2. Vercel
1. En [vercel.com](https://vercel.com) → **Add New → Project** → importa este repositorio de GitHub. Framework preset: **Other** (no hace falta build).
2. En **Settings → Environment Variables** añade:
   - `DATABASE_URL` → la cadena del pooler de Supabase
   - `JWT_SECRET` → una clave larga aleatoria (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`). Es obligatoria: sin ella la API no arranca.
3. Deploy. Comprueba `https://<tu-proyecto>.vercel.app/api/health` → `"db": "postgres"`.

Cada push a la rama principal se despliega solo; las demás ramas generan previews.

### Seguridad
- Las tablas tienen **RLS activado sin políticas**: la API REST pública de Supabase (clave `anon`) no puede leer ni escribir nada. Solo el backend, que se conecta como `postgres`, accede a los datos.
- Nunca pongas la `DATABASE_URL` ni la `service_role` key en el frontend.

### Railway (alternativa)
El `Procfile` sigue funcionando: define `DATABASE_URL` y `JWT_SECRET` en Railway y la app sirve API y frontend desde el mismo dominio.

## Cómo funciona el progreso

- Cada **nodo del árbol es un curso**. Los cursos de **tier 1** están abiertos; un curso de **tier N** se desbloquea al **dominar** un curso de tier N‑1 de la misma rama.
- Cada lección tiene 3 fases: **lección** (+50 XP), **reto** (+100 XP) y **examen** (+150 XP, se aprueba con el 75%). El reto puede dejarse para después.
- Un curso está **dominado** cuando todas sus lecciones disponibles tienen las 3 fases (+300 XP). Una rama está dominada cuando todos sus cursos con contenido lo están (+1,000 XP).
- Las lecciones sin contenido en `lessons/` aparecen como **Próximamente** y no cuentan para el porcentaje.
- Toda la XP se calcula en el servidor y cada paso se premia **una sola vez**. El examen se corrige en el servidor: el cliente nunca recibe las respuestas correctas.

### Añadir una lección
Agrega una entrada `"<courseId>:<n>"` en el archivo de su rama dentro de `lessons/` siguiendo la estructura de las existentes. `n` es la posición en el temario del curso (`catalog.js`). El título debe coincidir con el del temario. El test `npm test` valida la estructura.

---

## Endpoints

Todos requieren `Authorization: Bearer <token>` salvo auth, `/api/xp/sources` y `/api/health`. Las acciones que dan XP responden con `{ rewards: [{label, xp}], earned, xp, rank, rankUp }`.

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registro (`name`, `email`, `password`) |
| POST | `/api/auth/login` | Login, devuelve JWT |
| GET  | `/api/auth/me` | Perfil: XP, rango, racha, posición, lecciones y cursos completados |

### Cursos y lecciones
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/catalog` | Árbol completo con estado de cada curso + siguiente lección recomendada |
| GET  | `/api/courses/:courseId` | Curso con sus lecciones y progreso |
| GET  | `/api/courses/:courseId/lessons/:n` | Contenido de la lección (sin respuestas) y progreso |
| POST | `/api/courses/:courseId/lessons/:n/complete` | Marca la lección como leída |
| POST | `/api/courses/:courseId/lessons/:n/challenge` | Entrega el reto (`report`, `share` opcional para publicarlo) |
| POST | `/api/courses/:courseId/lessons/:n/exam/check` | Corrige una pregunta (`question`, `answer`) para feedback inmediato |
| POST | `/api/courses/:courseId/lessons/:n/exam` | Envía el examen completo (`answers: [índices]`) |
| GET  | `/api/progress` | Historial crudo del usuario |

### Misiones diarias
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET   | `/api/missions/today` | 3 misiones del día (1 de avance en un curso + hábitos) |
| PATCH | `/api/missions/:id/complete` | Completa una misión de hábito. Las de avance se completan solas al avanzar en su curso |

### Librería
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/library` | Recursos y si ya los completaste |
| POST | `/api/library/:id/complete` | Completa un recurso (+25 XP, una vez) |

### Comunidad y ranking
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET    | `/api/posts` | Feed con likes y comentarios |
| POST   | `/api/posts` | Crear publicación (5–280 caracteres) |
| DELETE | `/api/posts/:id` | Borrar una publicación propia |
| POST   | `/api/posts/:id/like` | Dar/quitar like |
| POST   | `/api/posts/:id/comment` | Comentar |
| GET    | `/api/leaderboard` | Top por XP + tu posición |

### Badges, XP y sistema
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/badges` | Badges obtenidos y bloqueados (se otorgan automáticamente) |
| GET | `/api/xp/sources` | Valores de XP |
| GET | `/api/health` | Estado del servidor |

---

## Sistema de XP

| Acción | XP |
|--------|----|
| Lección completada | +50 |
| Reto entregado | +100 |
| Examen aprobado | +150 |
| Curso dominado | +300 |
| Rama dominada | +1,000 |
| Misión diaria | +50 (sorpresa +150) |
| Bono diario (todas las misiones) | +75 |
| Recurso de librería | +25 |
| Badges | +50 a +5,000 |

## Rangos

| Rango | XP requerida |
|-------|-------------|
| Recluta | 0 – 999 |
| Guerrero | 1,000 – 4,999 |
| Héroe | 5,000 – 14,999 |
| Leyenda | 15,000 – 49,999 |
| Inmortal | 50,000+ |

## Badges

Primer paso · Invocador · Atleta (10 lecciones) · Erudito (5 recursos) · Voz heroica (5 publicaciones) · Monje (racha 7) · Constante (racha 30) · Rango Héroe · Leyenda · Inmortal. Las condiciones están en `catalog.js`.

---

## Próximos pasos
1. Escribir el resto de lecciones en `lessons/` (hoy hay 36: todos los cursos tienen contenido; los de tier 1 y 2 tienen al menos 2 lecciones).
2. Añadir rate limiting (`express-rate-limit`) en login y registro.
3. Retos semanales y "jefe del mes" (los valores de XP ya están definidos en `catalog.js`).
