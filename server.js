/**
 * HeroPath Backend — API REST + frontend estático
 * Stack: Node.js + Express + Postgres (Supabase, o PGlite en local) + JWT
 * Local: `npm start` → http://localhost:3001 · Vercel: api/index.js exporta esta app.
 */

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const db = require("./db");
const {
  XP_SOURCES, RANKS, BRANCHES, COURSES, RESOURCES, BADGES, HABIT_MISSIONS,
  getCourse, getLesson,
} = require("./catalog");

const app = express();
const PORT = process.env.PORT || 3001;
const PROD = process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL);
const JWT_SECRET = process.env.JWT_SECRET || (PROD ? null : "heropath_secret_dev_2026");

if (!JWT_SECRET) throw new Error("Falta la variable de entorno JWT_SECRET (obligatoria en producción).");

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// Envuelve handlers async para no repetir try/catch
const route = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = v => UUID_RE.test(String(v));

// ── Columnas (snake_case en la base → camelCase en la API) ─
const USER_COLS = `id, name, email, password, xp, streak, record_streak as "recordStreak",
  last_active as "lastActive", created_at as "createdAt"`;
const PROGRESS_COLS = `type, course_id as "courseId", lesson_number as "lessonNumber", branch_id as "branchId",
  resource_id as "resourceId", report, score, total, passed, completed_at as "completedAt"`;

const getUser = id => db.one(`select ${USER_COLS} from users where id = $1`, [id]);

/** Inserta un registro de progreso. Devuelve false si ya existía (índice único) → no hay que premiarlo. */
async function insertProgress(userId, f) {
  const r = await db.query(
    `insert into progress (user_id, type, course_id, lesson_number, branch_id, resource_id, report, score, total, passed)
     values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     on conflict do nothing returning id`,
    [userId, f.type, f.courseId ?? null, f.lessonNumber ?? null, f.branchId ?? null, f.resourceId ?? null,
      f.report ?? null, f.score ?? null, f.total ?? null, f.passed ?? null]
  );
  return r.rows.length > 0;
}

// ── Fechas y racha ────────────────────────────────────────
const dayKey = (d = new Date()) => d.toDateString();

async function touchStreak(user) {
  const today = dayKey();
  if (user.lastActive && dayKey(new Date(user.lastActive)) === today) return user;
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const streak = user.lastActive && dayKey(new Date(user.lastActive)) === yesterday ? (user.streak || 0) + 1 : 1;
  const recordStreak = Math.max(streak, user.recordStreak || 0);
  const lastActive = new Date();
  await db.query("update users set last_active = $2, streak = $3, record_streak = $4 where id = $1",
    [user.id, lastActive, streak, recordStreak]);
  return { ...user, lastActive, streak, recordStreak };
}

// ── Auth Middleware ───────────────────────────────────────
const auth = route(async (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token requerido" });
  let payload;
  try {
    payload = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: "Token inválido o expirado" });
  }
  const user = isUuid(payload.id) ? await getUser(payload.id) : null;
  if (!user) return res.status(401).json({ error: "Usuario no encontrado" });
  req.user = { id: user.id, email: user.email };
  req.dbUser = await touchStreak(user);
  next();
});

// ── Rangos y XP ───────────────────────────────────────────
function getRank(xp) {
  return RANKS.findLast(r => xp >= r.min) || RANKS[0];
}

const addXP = (userId, amount) => db.query("update users set xp = xp + $2 where id = $1", [userId, amount]);

/**
 * Ejecuta una acción que puede otorgar XP y devuelve la respuesta enriquecida con
 * las recompensas obtenidas, la XP total, el rango y si hubo subida de rango.
 * Dentro de fn usa ctx.give(amount, label) para sumar XP.
 */
async function withRewards(userId, fn) {
  const before = await getUser(userId);
  const ctx = {
    rewards: [],
    async give(amount, label) {
      if (!amount) return;
      await addXP(userId, amount);
      ctx.rewards.push({ label, xp: amount });
    },
  };
  const result = (await fn(ctx)) || {};
  await checkBadges(userId, ctx);
  const after = await getUser(userId);
  const from = getRank(before.xp).name;
  const to = getRank(after.xp).name;
  return {
    ...result,
    rewards: ctx.rewards,
    earned: ctx.rewards.reduce((s, r) => s + r.xp, 0),
    xp: after.xp,
    rank: to,
    rankUp: from !== to ? { from, to } : null,
  };
}

// ── Progreso de cursos ────────────────────────────────────
const STEP_TYPES = ["lesson", "challenge", "exam"];

const loadProgress = userId =>
  db.many(`select ${PROGRESS_COLS} from progress where user_id = $1 and type <> 'exam_attempt'`, [userId]);

/** Calcula el estado de cada curso a partir del progreso del usuario. */
function computeCourseStates(entries) {
  const done = new Set(
    entries.filter(e => STEP_TYPES.includes(e.type)).map(e => `${e.courseId}:${e.lessonNumber}:${e.type}`)
  );
  const states = {};
  for (const c of COURSES) {
    const available = c.lessons.filter(l => l.available);
    const lessons = c.lessons.map(l => {
      const steps = Object.fromEntries(STEP_TYPES.map(t => [t, done.has(`${c.id}:${l.n}:${t}`)]));
      return { ...l, ...steps, mastered: STEP_TYPES.every(t => steps[t]) };
    });
    const totalSteps = available.length * STEP_TYPES.length;
    const doneSteps = lessons.filter(l => l.available).reduce((s, l) => s + STEP_TYPES.filter(t => l[t]).length, 0);
    states[c.id] = {
      lessons,
      availableCount: available.length,
      masteredCount: lessons.filter(l => l.mastered).length,
      pct: totalSteps ? Math.round((doneSteps / totalSteps) * 100) : 0,
      done: totalSteps > 0 && doneSteps === totalSteps,
      started: doneSteps > 0,
    };
  }
  // Desbloqueo por tiers: tier 1 siempre; tier N si hay un curso tier N-1 dominado en la rama
  for (const b of BRANCHES) {
    for (const c of b.courses) {
      states[c.id].unlocked = c.tier === 1 ||
        b.courses.some(o => o.tier === c.tier - 1 && states[o.id].done);
    }
  }
  for (const c of COURSES) {
    const s = states[c.id];
    s.status = !s.unlocked ? "locked"
      : s.availableCount === 0 ? "soon"
      : s.done ? "done"
      : s.started ? "progress"
      : "new";
  }
  return states;
}

function publicCourse(c, state) {
  return {
    id: c.id, title: c.title, tier: c.tier, icon: c.icon, hours: c.hours,
    color: c.color, branchId: c.branchId, branchName: c.branchName,
    totalLessons: c.lessons.length,
    availableLessons: state.availableCount,
    masteredLessons: state.masteredCount,
    pct: state.pct, status: state.status, unlocked: state.unlocked,
  };
}

/** Siguiente lección recomendada: la primera pendiente del curso empezado más reciente. */
function nextLessonFor(states, entries) {
  const recent = entries
    .filter(e => STEP_TYPES.includes(e.type))
    .sort((a, b) => new Date(b.completedAt) - new Date(a.completedAt));
  const order = [...new Set(recent.map(e => e.courseId)), ...COURSES.map(c => c.id)];
  for (const id of order) {
    const s = states[id];
    if (!s || !s.unlocked) continue;
    const l = s.lessons.find(l => l.available && !l.mastered);
    if (l) {
      const c = getCourse(id);
      return { courseId: id, courseTitle: c.title, color: c.color, icon: c.icon, lessonNumber: l.n, lessonTitle: l.title, pct: s.pct,
        step: !l.lesson ? "lesson" : !l.challenge ? "challenge" : "exam" };
    }
  }
  return null;
}

/** Tras cualquier avance en un curso: curso dominado, rama dominada y misiones de avance. */
async function afterCourseProgress(userId, courseId, ctx) {
  const states = computeCourseStates(await loadProgress(userId));
  const course = getCourse(courseId);

  if (states[courseId].done && await insertProgress(userId, { type: "course", courseId }))
    await ctx.give(XP_SOURCES.course_complete, `Curso dominado: ${course.title}`);

  const branch = BRANCHES.find(b => b.id === course.branchId);
  const playable = branch.courses.filter(c => states[c.id].availableCount > 0);
  if (playable.every(c => states[c.id].done) && await insertProgress(userId, { type: "branch", branchId: branch.id }))
    await ctx.give(XP_SOURCES.branch_mastered, `Rama dominada: ${branch.name}`);

  const doc = await getMissions(userId);
  const mission = doc?.missions.find(m => m.type === "advance" && m.courseId === courseId && !m.done);
  if (mission) await completeMission(userId, doc, mission.id, ctx);
}

// ── Badges ────────────────────────────────────────────────
async function buildStats(userId) {
  const s = await db.one(
    `select u.xp, u.record_streak as "recordStreak",
       (select count(*)::int from progress where user_id = u.id and type = 'lesson')   as lessons,
       (select count(*)::int from progress where user_id = u.id and type = 'resource') as resources,
       (select count(*)::int from posts    where user_id = u.id)                       as posts,
       coalesce((select array_agg(course_id) from progress where user_id = u.id and type = 'course'), '{}') as "coursesDone"
     from users u where u.id = $1`, [userId]);
  return s;
}

async function checkBadges(userId, ctx) {
  // Repite porque la XP de un badge puede desbloquear otro (p. ej. Rango Héroe)
  for (let round = 0; round < 5; round++) {
    const earnedIds = (await db.many("select badge_id from badges where user_id = $1", [userId])).map(b => b.badge_id);
    const stats = await buildStats(userId);
    const fresh = BADGES.filter(b => !earnedIds.includes(b.id) && b.check(stats));
    if (!fresh.length) return;
    for (const b of fresh) {
      const r = await db.query("insert into badges (user_id, badge_id) values ($1, $2) on conflict do nothing returning badge_id", [userId, b.id]);
      if (r.rows.length) await ctx.give(b.xp, `Badge: ${b.name}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════

const signToken = user => jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
const normEmail = e => String(e || "").trim().toLowerCase();

app.post("/api/auth/register", route(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const email = normEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!name || !email || !password)
    return res.status(400).json({ error: "Nombre, email y contraseña requeridos" });
  if (name.length < 2 || name.length > 30)
    return res.status(400).json({ error: "El nombre debe tener entre 2 y 30 caracteres" });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return res.status(400).json({ error: "Email no válido" });
  if (password.length < 6)
    return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });

  const hash = await bcrypt.hash(password, 10);
  const user = await db.one(
    `insert into users (name, email, password, streak, record_streak, last_active)
     values ($1, $2, $3, 1, 1, now()) on conflict (email) do nothing returning id, email`,
    [name, email, hash]);
  if (!user) return res.status(409).json({ error: "Este email ya está registrado" });

  res.status(201).json({
    message: "¡Bienvenido a HeroPath!",
    token: signToken(user),
    user: { id: user.id, name, email, xp: 0, rank: "Recluta", streak: 1 },
  });
}));

app.post("/api/auth/login", route(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });

  const found = await db.one(`select ${USER_COLS} from users where email = $1`, [email]);
  if (!found || !(await bcrypt.compare(password, found.password)))
    return res.status(401).json({ error: "Email o contraseña incorrectos" });

  const user = await touchStreak(found);
  res.json({
    token: signToken(user),
    user: { id: user.id, name: user.name, email, xp: user.xp, rank: getRank(user.xp).name, streak: user.streak },
  });
}));

app.get("/api/auth/me", auth, route(async (req, res) => {
  await checkBadges(req.user.id, { give: amount => addXP(req.user.id, amount) });
  const user = await getUser(req.user.id);
  const rank = getRank(user.xp);
  const nextRank = RANKS.find(r => r.min > user.xp);
  const s = await db.one(
    `select (select count(*)::int from users where xp > $2) as above,
       (select count(*)::int from badges where user_id = $1) as badges,
       (select count(*)::int from progress where user_id = $1 and type = 'lesson') as lessons,
       (select count(*)::int from progress where user_id = $1 and type = 'course') as courses`,
    [user.id, user.xp]);
  res.json({
    id: user.id,
    name: user.name,
    email: user.email,
    xp: user.xp,
    rank: rank.name,
    rankMin: rank.min,
    rankMax: rank.max === Infinity ? null : rank.max,
    nextRank: nextRank?.name || null,
    nextRankXP: nextRank?.min || null,
    streak: user.streak,
    recordStreak: user.recordStreak,
    pos: s.above + 1,
    badgesCount: s.badges,
    lessonsCompleted: s.lessons,
    coursesCompleted: s.courses,
    createdAt: user.createdAt,
  });
}));

// ═══════════════════════════════════════════════════════════
//  CATÁLOGO Y CURSOS
// ═══════════════════════════════════════════════════════════

// GET /api/catalog — árbol completo con el estado del usuario + siguiente lección
app.get("/api/catalog", auth, route(async (req, res) => {
  const entries = await loadProgress(req.user.id);
  const states = computeCourseStates(entries);
  const branches = BRANCHES.map(b => {
    const courses = b.courses.map(c => publicCourse(getCourse(c.id), states[c.id]));
    const playable = courses.filter(c => c.availableLessons > 0);
    const pct = playable.length ? Math.round(playable.reduce((s, c) => s + c.pct, 0) / playable.length) : 0;
    return { id: b.id, name: b.name, icon: b.icon, color: b.color, pct, courses };
  });
  res.json({ branches, next: nextLessonFor(states, entries) });
}));

// GET /api/courses/:courseId — detalle con lecciones
app.get("/api/courses/:courseId", auth, route(async (req, res) => {
  const c = getCourse(req.params.courseId);
  if (!c) return res.status(404).json({ error: "Curso no encontrado" });
  const state = computeCourseStates(await loadProgress(req.user.id))[c.id];
  res.json({ ...publicCourse(c, state), lessons: state.lessons });
}));

/** Carga curso + lección + estado y valida acceso. Devuelve null si ya respondió con error. */
async function resolveLesson(req, res) {
  const c = getCourse(req.params.courseId);
  const n = parseInt(req.params.n, 10);
  if (!c) return res.status(404).json({ error: "Curso no encontrado" }), null;
  const lesson = getLesson(c.id, n);
  if (!lesson) return res.status(404).json({ error: "Esta lección estará disponible próximamente" }), null;
  const states = computeCourseStates(await loadProgress(req.user.id));
  if (!states[c.id].unlocked)
    return res.status(403).json({ error: "Curso bloqueado: domina un curso del nivel anterior en esta rama" }), null;
  return { course: c, n, lesson, state: states[c.id], progress: states[c.id].lessons.find(l => l.n === n) };
}

const passScore = lesson => Math.ceil(lesson.exam.length * 0.75);
const step = (course, n, type) => ({ type, courseId: course.id, lessonNumber: n });

// GET /api/courses/:courseId/lessons/:n — contenido (sin respuestas del examen)
app.get("/api/courses/:courseId/lessons/:n", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  const { course, n, lesson, state, progress } = r;
  const available = state.lessons.filter(l => l.available);
  const idx = available.findIndex(l => l.n === n);
  const best = await db.one(
    `select coalesce(max(score), 0)::int as score from progress
     where user_id = $1 and type = 'exam_attempt' and course_id = $2 and lesson_number = $3`,
    [req.user.id, course.id, n]);
  res.json({
    course: { ...publicCourse(course, state), lessons: state.lessons },
    lesson: {
      number: n,
      title: lesson.title,
      subtitle: lesson.subtitle,
      duration: lesson.duration,
      learn: lesson.learn,
      sections: lesson.sections,
      summary: lesson.summary,
      challenge: lesson.challenge,
      exam: lesson.exam.map(({ q, opts }) => ({ q, opts })),
      passScore: passScore(lesson),
      xp: { lesson: XP_SOURCES.lesson_complete, challenge: XP_SOURCES.challenge_complete, exam: XP_SOURCES.exam_pass },
    },
    progress: { lesson: progress.lesson, challenge: progress.challenge, exam: progress.exam, bestScore: best.score },
    prev: available[idx - 1] ? { n: available[idx - 1].n, title: available[idx - 1].title } : null,
    next: available[idx + 1] ? { n: available[idx + 1].n, title: available[idx + 1].title } : null,
  });
}));

// POST /api/courses/:courseId/lessons/:n/complete — lección leída
app.post("/api/courses/:courseId/lessons/:n/complete", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  if (r.progress.lesson) return res.json({ alreadyDone: true, rewards: [], earned: 0 });
  const out = await withRewards(req.user.id, async ctx => {
    if (!(await insertProgress(req.user.id, step(r.course, r.n, "lesson")))) return { alreadyDone: true };
    await ctx.give(XP_SOURCES.lesson_complete, "Lección completada");
    await afterCourseProgress(req.user.id, r.course.id, ctx);
    return { message: "Lección completada" };
  });
  res.json(out);
}));

// POST /api/courses/:courseId/lessons/:n/challenge — entregar reto
app.post("/api/courses/:courseId/lessons/:n/challenge", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  const report = String(req.body.report || "").trim();
  if (report.length < 10) return res.status(400).json({ error: "El reporte debe tener al menos 10 caracteres" });
  if (report.length > 1000) return res.status(400).json({ error: "El reporte no puede superar 1000 caracteres" });
  if (!r.progress.lesson) return res.status(400).json({ error: "Primero completa la lección" });
  if (r.progress.challenge) return res.status(409).json({ error: "Reto ya entregado", alreadyDone: true });

  let duplicate = false;
  const out = await withRewards(req.user.id, async ctx => {
    if (!(await insertProgress(req.user.id, { ...step(r.course, r.n, "challenge"), report }))) {
      duplicate = true;
      return;
    }
    await ctx.give(XP_SOURCES.challenge_complete, "Reto entregado");
    if (req.body.share) {
      const text = `Reto completado · ${r.course.title}: ${r.lesson.challenge.title}\n\n${report}`.slice(0, 280);
      await db.query("insert into posts (user_id, text, achievement) values ($1, $2, $3)", [
        req.user.id, text, JSON.stringify({ type: "challenge", courseId: r.course.id, title: r.lesson.challenge.title }),
      ]);
    }
    await afterCourseProgress(req.user.id, r.course.id, ctx);
    return { message: "Reto entregado", shared: Boolean(req.body.share) };
  });
  if (duplicate) return res.status(409).json({ error: "Reto ya entregado", alreadyDone: true });
  res.json(out);
}));

// POST /api/courses/:courseId/lessons/:n/exam/check — corregir una pregunta (feedback inmediato)
app.post("/api/courses/:courseId/lessons/:n/exam/check", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  const q = r.lesson.exam[req.body.question];
  if (!q) return res.status(400).json({ error: "Pregunta no válida" });
  res.json({ correct: req.body.answer === q.correct, correctIndex: q.correct, exp: q.exp });
}));

// POST /api/courses/:courseId/lessons/:n/exam — enviar examen completo { answers: [índices] }
app.post("/api/courses/:courseId/lessons/:n/exam", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  const answers = req.body.answers;
  if (!Array.isArray(answers) || answers.length !== r.lesson.exam.length)
    return res.status(400).json({ error: `Envía ${r.lesson.exam.length} respuestas` });
  if (!r.progress.lesson) return res.status(400).json({ error: "Primero completa la lección" });

  const score = r.lesson.exam.filter((q, i) => answers[i] === q.correct).length;
  const total = r.lesson.exam.length;
  const passed = score >= passScore(r.lesson);

  const out = await withRewards(req.user.id, async ctx => {
    await insertProgress(req.user.id, { ...step(r.course, r.n, "exam_attempt"), score, total, passed });
    const firstPass = passed && await insertProgress(req.user.id, { ...step(r.course, r.n, "exam"), score, total, passed });
    if (firstPass) {
      await ctx.give(XP_SOURCES.exam_pass, "Examen aprobado");
      await afterCourseProgress(req.user.id, r.course.id, ctx);
    }
    return { score, total, passed, passScore: passScore(r.lesson), firstPass,
      message: passed ? "Examen aprobado 🏆" : "Sigue practicando" };
  });
  res.json(out);
}));

// GET /api/progress — historial del usuario (incluye intentos de examen)
app.get("/api/progress", auth, route(async (req, res) => {
  res.json(await db.many(`select ${PROGRESS_COLS} from progress where user_id = $1 order by completed_at`, [req.user.id]));
}));

// ═══════════════════════════════════════════════════════════
//  LIBRERÍA
// ═══════════════════════════════════════════════════════════

app.get("/api/library", auth, route(async (req, res) => {
  const done = new Set((await db.many(
    "select resource_id from progress where user_id = $1 and type = 'resource'", [req.user.id])).map(d => d.resource_id));
  res.json(RESOURCES.map(r => ({ ...r, done: done.has(r.id), xp: XP_SOURCES.resource_read })));
}));

app.post("/api/library/:id/complete", auth, route(async (req, res) => {
  const resource = RESOURCES.find(r => r.id === req.params.id);
  if (!resource) return res.status(404).json({ error: "Recurso no encontrado" });
  let duplicate = false;
  const out = await withRewards(req.user.id, async ctx => {
    if (!(await insertProgress(req.user.id, { type: "resource", resourceId: resource.id }))) {
      duplicate = true;
      return;
    }
    await ctx.give(XP_SOURCES.resource_read, `Recurso: ${resource.title}`);
  });
  if (duplicate) return res.status(409).json({ error: "Recurso ya completado", alreadyDone: true });
  res.json(out);
}));

// ═══════════════════════════════════════════════════════════
//  MISIONES DIARIAS
// ═══════════════════════════════════════════════════════════

const shuffle = arr => {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

const getMissions = userId =>
  db.one(`select day as date, missions, bonus_claimed as "bonusClaimed" from missions where user_id = $1 and day = $2`,
    [userId, dayKey()]);

async function seedDailyMissions(userId) {
  const existing = await getMissions(userId);
  if (existing) return existing;

  // 1 misión de avance (si hay cursos con lecciones pendientes) + hábitos hasta completar 3
  const states = computeCourseStates(await loadProgress(userId));
  const advance = shuffle(COURSES.filter(c => states[c.id].unlocked && states[c.id].lessons.some(l => l.available && !l.mastered)))
    .slice(0, 1)
    .map(c => ({ type: "advance", courseId: c.id, title: `Avanza en ${c.title}`, branch: c.branchName, xp: 50, icon: c.icon }));
  const habits = shuffle(HABIT_MISSIONS).slice(0, 3 - advance.length);
  const missions = [...advance, ...habits].map((m, i) => ({ ...m, id: i + 1, done: false }));

  await db.query("insert into missions (user_id, day, missions) values ($1, $2, $3) on conflict do nothing",
    [userId, dayKey(), JSON.stringify(missions)]);
  return getMissions(userId);
}

/** Marca una misión. Usa el documento leído como condición para no premiar dos veces en peticiones simultáneas. */
async function completeMission(userId, doc, missionId, ctx) {
  const missions = doc.missions.map(m => (m.id === missionId ? { ...m, done: true, doneAt: new Date().toISOString() } : m));
  const mission = missions.find(m => m.id === missionId);
  const allDone = missions.every(m => m.done);
  const giveBonus = allDone && !doc.bonusClaimed;
  const r = await db.query(
    `update missions set missions = $3, bonus_claimed = $4
     where user_id = $1 and day = $2 and missions = $5::jsonb returning day`,
    [userId, doc.date, JSON.stringify(missions), doc.bonusClaimed || allDone, JSON.stringify(doc.missions)]);
  if (!r.rows.length) return { conflict: true };
  await ctx.give(mission.xp, `Misión: ${mission.title}`);
  if (giveBonus) await ctx.give(XP_SOURCES.daily_bonus, "Bono diario: 3 misiones");
  return { allDone, bonusEarned: giveBonus ? XP_SOURCES.daily_bonus : 0 };
}

app.get("/api/missions/today", auth, route(async (req, res) => {
  const doc = await seedDailyMissions(req.user.id);
  res.json({ ...doc, completedCount: doc.missions.filter(m => m.done).length, bonusXP: XP_SOURCES.daily_bonus });
}));

app.patch("/api/missions/:missionId/complete", auth, route(async (req, res) => {
  const doc = await getMissions(req.user.id);
  if (!doc) return res.status(404).json({ error: "No hay misiones para hoy" });
  const mId = parseInt(req.params.missionId, 10);
  const mission = doc.missions.find(m => m.id === mId);
  if (!mission) return res.status(404).json({ error: "Misión no encontrada" });
  if (mission.done) return res.status(409).json({ error: "Misión ya completada" });
  if (mission.type === "advance")
    return res.status(400).json({ error: "Esta misión se completa al avanzar en el curso" });

  const out = await withRewards(req.user.id, ctx => completeMission(req.user.id, doc, mId, ctx));
  if (out.conflict) return res.status(409).json({ error: "Misión ya completada" });
  res.json({ message: "Misión completada", ...out });
}));

// ═══════════════════════════════════════════════════════════
//  COMUNIDAD
// ═══════════════════════════════════════════════════════════

const POST_SELECT = `
  select p.id as "_id", p.user_id as "userId", p.text, p.achievement, p.created_at as "createdAt",
    u.name as "userName", u.xp as "userXp",
    (select count(*)::int from post_likes l where l.post_id = p.id) as "likeCount",
    exists (select 1 from post_likes l where l.post_id = p.id and l.user_id = $1) as "likedByMe"
  from posts p join users u on u.id = p.user_id`;

async function withComments(posts) {
  if (!posts.length) return [];
  const comments = await db.many(
    `select c.post_id as "postId", c.user_id as "userId", u.name as "userName", c.text, c.created_at as "createdAt"
     from post_comments c join users u on u.id = c.user_id
     where c.post_id = any($1::uuid[]) order by c.created_at`, [posts.map(p => p._id)]);
  return posts.map(({ userXp, ...p }) => ({
    ...p,
    userRank: getRank(userXp).name,
    comments: comments.filter(c => c.postId === p._id).map(({ postId, ...c }) => c),
  }));
}

app.get("/api/posts", auth, route(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const posts = await db.many(`${POST_SELECT} order by p.created_at desc limit $2`, [req.user.id, limit]);
  res.json(await withComments(posts));
}));

app.post("/api/posts", auth, route(async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (text.length < 5) return res.status(400).json({ error: "El texto debe tener al menos 5 caracteres" });
  if (text.length > 280) return res.status(400).json({ error: "Máximo 280 caracteres" });

  let id;
  const out = await withRewards(req.user.id, async () => {
    ({ id } = await db.one("insert into posts (user_id, text) values ($1, $2) returning id", [req.user.id, text]));
  });
  const [post] = await withComments(await db.many(`${POST_SELECT} where p.id = $2`, [req.user.id, id]));
  res.status(201).json({ ...post, ...out });
}));

app.delete("/api/posts/:id", auth, route(async (req, res) => {
  const post = isUuid(req.params.id) && await db.one("select user_id from posts where id = $1", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Post no encontrado" });
  if (post.user_id !== req.user.id) return res.status(403).json({ error: "Solo puedes borrar tus publicaciones" });
  await db.query("delete from posts where id = $1", [req.params.id]);
  res.json({ deleted: true });
}));

app.post("/api/posts/:id/like", auth, route(async (req, res) => {
  const post = isUuid(req.params.id) && await db.one("select id from posts where id = $1", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Post no encontrado" });
  const removed = await db.query("delete from post_likes where post_id = $1 and user_id = $2 returning post_id", [post.id, req.user.id]);
  if (!removed.rows.length)
    await db.query("insert into post_likes (post_id, user_id) values ($1, $2) on conflict do nothing", [post.id, req.user.id]);
  const { count } = await db.one("select count(*)::int as count from post_likes where post_id = $1", [post.id]);
  res.json({ liked: !removed.rows.length, likeCount: count });
}));

app.post("/api/posts/:id/comment", auth, route(async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (text.length < 2) return res.status(400).json({ error: "Comentario muy corto" });
  if (text.length > 280) return res.status(400).json({ error: "Máximo 280 caracteres" });
  const post = isUuid(req.params.id) && await db.one("select id from posts where id = $1", [req.params.id]);
  if (!post) return res.status(404).json({ error: "Post no encontrado" });

  const c = await db.one(
    `insert into post_comments (post_id, user_id, text) values ($1, $2, $3) returning created_at as "createdAt"`,
    [post.id, req.user.id, text]);
  res.status(201).json({ userId: req.user.id, userName: req.dbUser.name, text, createdAt: c.createdAt });
}));

// ═══════════════════════════════════════════════════════════
//  RANKING
// ═══════════════════════════════════════════════════════════

app.get("/api/leaderboard", auth, route(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const users = await db.many("select id, name, xp, streak from users order by xp desc, created_at limit $1", [limit]);
  const entry = (u, pos) => ({
    pos, id: u.id, name: u.name, xp: u.xp, rank: getRank(u.xp).name, streak: u.streak, isMe: u.id === req.user.id,
  });
  const board = users.map((u, i) => entry(u, i + 1));

  let myEntry = board.find(u => u.isMe) || null;
  if (!myEntry) {
    const me = req.dbUser;
    const { above } = await db.one("select count(*)::int as above from users where xp > $1", [me.xp]);
    myEntry = entry(me, above + 1);
  }
  const { total } = await db.one("select count(*)::int as total from users");
  res.json({ leaderboard: board, myEntry, total });
}));

// ═══════════════════════════════════════════════════════════
//  BADGES Y XP
// ═══════════════════════════════════════════════════════════

app.get("/api/badges", auth, route(async (req, res) => {
  const earned = await db.many(`select badge_id, earned_at as "earnedAt" from badges where user_id = $1`, [req.user.id]);
  res.json(BADGES.map(({ check, ...b }) => {
    const e = earned.find(x => x.badge_id === b.id);
    return { ...b, earned: Boolean(e), earnedAt: e?.earnedAt || null };
  }));
}));

app.get("/api/xp/sources", (req, res) => res.json(XP_SOURCES));

app.get("/api/health", route(async (req, res) => {
  await db.query("select 1");
  res.json({ status: "ok", app: "HeroPath API", version: "3.0.0", db: process.env.DATABASE_URL ? "postgres" : "pglite",
    timestamp: new Date().toISOString() });
}));

app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ── Frontend ──────────────────────────────────────────────
// En Vercel los HTML de public/ se sirven como estáticos; aquí para local y Railway.
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

// ── Start ─────────────────────────────────────────────────
if (require.main === module) {
  db.init().then(() => {
    app.listen(PORT, () => {
      console.log(`\n🏆 HeroPath corriendo en http://localhost:${PORT}`);
      console.log(`   Base de datos: ${process.env.DATABASE_URL ? "Postgres (DATABASE_URL)" : "PGlite local"}\n`);
    });
  }).catch(err => {
    console.error("No se pudo conectar a la base de datos:", err.message);
    process.exit(1);
  });
}

module.exports = { app, db, computeCourseStates };
