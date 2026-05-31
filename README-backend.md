# HeroPath Backend API

Backend completo para la app HeroPath. Node.js + Express + NeDB (base de datos embebida, sin configuración).

## Stack
- **Runtime:** Node.js 18+
- **Framework:** Express
- **Base de datos:** NeDB (embebida, archivos locales en `/data`)
- **Auth:** JWT (jsonwebtoken)
- **Seguridad:** bcryptjs para contraseñas

---

## Instalación y arranque

```bash
npm install
node server.js
# API corriendo en http://localhost:3001
```

Para producción, cambia `JWT_SECRET` en `.env`.

---

## Endpoints

### Auth
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/auth/register` | Registro de usuario |
| POST | `/api/auth/login` | Login, devuelve JWT |
| GET  | `/api/auth/me` | Perfil del usuario autenticado |

### Progreso (requiere Bearer token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/progress` | Todo el progreso del usuario |
| POST | `/api/progress/lesson` | Marcar lección como completada (+50 XP) |
| POST | `/api/progress/challenge` | Entregar reto con reporte (+100 XP) |
| POST | `/api/progress/exam` | Enviar resultado de examen (+150 XP si aprueba) |
| GET  | `/api/progress/course/:id` | Resumen de un curso |

### Misiones diarias (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/missions/today` | Misiones del día (se generan automáticamente) |
| PATCH | `/api/missions/:id/complete` | Marcar misión como completada |

### Comunidad (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/posts` | Feed de publicaciones |
| POST | `/api/posts` | Crear publicación |
| POST | `/api/posts/:id/like` | Dar/quitar like |
| POST | `/api/posts/:id/comment` | Comentar publicación |

### Ranking (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/leaderboard` | Top usuarios por XP |

### Badges (requiere token)
| Método | Ruta | Descripción |
|--------|------|-------------|
| GET  | `/api/badges` | Badges del usuario (obtenidos y bloqueados) |
| POST | `/api/badges/award` | Otorgar un badge |

### XP
| Método | Ruta | Descripción |
|--------|------|-------------|
| POST | `/api/xp/add` | Añadir XP por fuente |
| GET  | `/api/xp/sources` | Lista de fuentes y valores de XP |

### Sistema
| Método | Ruta |
|--------|------|
| GET  | `/api/health` |

---

## Sistema de XP

| Acción | XP |
|--------|----|
| Lección completada | +50 |
| Reto entregado | +100 |
| Examen aprobado | +150 |
| Curso completo | +300 |
| Rama dominada | +1,000 |
| Bono diario (3 misiones) | +75 |
| Reto semanal | +400 |
| Jefe del mes | +2,000 |
| Recurso de librería | +25 |

## Rangos

| Rango | XP requerida |
|-------|-------------|
| Recluta | 0 – 999 |
| Guerrero | 1,000 – 4,999 |
| Héroe | 5,000 – 14,999 |
| Leyenda | 15,000 – 49,999 |
| Inmortal | 50,000+ |

---

## Ejemplos de uso

```bash
# Registro
curl -X POST http://localhost:3001/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Alex","email":"alex@heropath.com","password":"hero123"}'

# Login
curl -X POST http://localhost:3001/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"alex@heropath.com","password":"hero123"}'

# Misiones del día
curl http://localhost:3001/api/missions/today \
  -H "Authorization: Bearer TU_TOKEN"

# Completar lección
curl -X POST http://localhost:3001/api/progress/lesson \
  -H "Authorization: Bearer TU_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"courseId":"ultraprod","lessonId":"lesson_7","lessonNumber":7}'
```

---

## Variables de entorno (.env)

```
PORT=3001
JWT_SECRET=cambia_esto_en_produccion
NODE_ENV=development
```

---

## Para escalar a producción

1. Reemplaza NeDB con **MongoDB Atlas** o **PostgreSQL** (Supabase)
2. Despliega en **Railway**, **Render** o **Fly.io**
3. Añade rate limiting con `express-rate-limit`
4. Conecta con la app de React Native
