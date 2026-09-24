# HeroPath

App de desarrollo personal gamificada: un árbol de habilidades con 6 ramas, cursos con lecciones (lección → reto → examen), XP, rangos, rachas, misiones diarias, badges, librería y comunidad.

El mismo servidor Node sirve la API y el frontend (`index.html` + `leccion.html`).

## Stack
- **Runtime:** Node.js 18+
- **Framework:** Express
- **Base de datos:** NeDB (embebida, archivos en `data/` o `DATA_DIR`)
- **Auth:** JWT (30 días) + bcryptjs
- **Frontend:** React 18 + Babel standalone (sin build)

## Estructura

| Archivo | Qué contiene |
|---------|--------------|
| `server.js` | API REST, lógica de progreso, XP, badges y misiones. Sirve los HTML. |
| `catalog.js` | Ramas, cursos (temario), recursos de la librería, badges, misiones y valores de XP. |
| `lessons.js` | Contenido de las lecciones (secciones, reto y examen). |
| `index.html` | App principal: Inicio, Árbol, Escuela, Librería, Comunidad y Perfil. |
| `leccion.html` | Reproductor de lección: `leccion.html?course=<id>&lesson=<n>`. |
| `test/api.test.js` | Tests de integración de la API. |

---

## Arranque

```bash
npm install
npm start          # http://localhost:3001
npm test           # tests de la API
```

Abre `http://localhost:3001` y crea una cuenta.

### Variables de entorno (.env)

```
PORT=3001
JWT_SECRET=cambia_esto_en_produccion
NODE_ENV=production
DATA_DIR=/data     # opcional: carpeta de la base de datos
```

### Despliegue en Railway
El `Procfile` arranca `node server.js`. El sistema de archivos de Railway es efímero: monta un **Volume** y apunta `DATA_DIR` a él, o los usuarios se perderán en cada deploy.

Si el frontend se abre desde otro dominio, apunta por defecto a `https://lovely-magic-production-a3a2.up.railway.app`. Para usar otro backend: `localStorage.setItem("hp_api","https://tu-backend")`.

---

## Cómo funciona el progreso

- Cada **nodo del árbol es un curso**. Los cursos de **tier 1** están abiertos; un curso de **tier N** se desbloquea al **dominar** un curso de tier N‑1 de la misma rama.
- Cada lección tiene 3 fases: **lección** (+50 XP), **reto** (+100 XP) y **examen** (+150 XP, se aprueba con el 75%). El reto puede dejarse para después.
- Un curso está **dominado** cuando todas sus lecciones disponibles tienen las 3 fases (+300 XP). Una rama está dominada cuando todos sus cursos con contenido lo están (+1,000 XP).
- Las lecciones sin contenido en `lessons.js` aparecen como **Próximamente** y no cuentan para el porcentaje.
- Toda la XP se calcula en el servidor y cada paso se premia **una sola vez**. El examen se corrige en el servidor: el cliente nunca recibe las respuestas correctas.

### Añadir una lección
Agrega una entrada `"<courseId>:<n>"` en `lessons.js` siguiendo la estructura de las existentes. `n` es la posición en el temario del curso (`catalog.js`). El test `npm test` valida la estructura.

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
1. Escribir el resto de lecciones en `lessons.js` (hoy hay 16: la primera de cada curso de tier 1 y 2, más Deep Work).
2. Migrar NeDB a **PostgreSQL** (Supabase) o **MongoDB Atlas** cuando crezca el número de usuarios.
3. Añadir rate limiting (`express-rate-limit`) en login y registro.
4. Retos semanales y "jefe del mes" (los valores de XP ya están definidos en `catalog.js`).
