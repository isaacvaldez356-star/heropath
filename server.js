/**
 * HeroPath Backend — API REST + frontend estático
 * Stack: Node.js + Express + NeDB (embedded) + JWT
 * Puerto: 3001 (o PORT)
 */

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const Datastore = require("nedb-promises");
const path = require("path");
const fs = require("fs");

const {
  XP_SOURCES, RANKS, BRANCHES, COURSES, RESOURCES, BADGES, HABIT_MISSIONS,
  getCourse, getLesson,
} = require("./catalog");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "heropath_secret_dev_2026";
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, "data");

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production")
  console.warn("⚠️  JWT_SECRET no está definido: usa una clave propia en producción.");

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json({ limit: "100kb" }));

// ── Databases (embedded, no config needed) ────────────────
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
const store = name => Datastore.create({ filename: path.join(DATA_DIR, `${name}.db`), autoload: true });
const db = {
  users:    store("users"),
  progress: store("progress"),
  missions: store("missions"),
  posts:    store("posts"),
  badges:   store("badges"),
};

// Envuelve handlers async para no repetir try/catch
const route = fn => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(err => {
    console.error(err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

// ── Fechas y racha ────────────────────────────────────────
const dayKey = (d = new Date()) => d.toDateString();

async function touchStreak(user) {
  const today = dayKey();
  if (user.lastActive && dayKey(new Date(user.lastActive)) === today) return user;
  const yesterday = dayKey(new Date(Date.now() - 86400000));
  const streak = user.lastActive && dayKey(new Date(user.lastActive)) === yesterday ? (user.streak || 0) + 1 : 1;
  const recordStreak = Math.max(streak, user.recordStreak || 0);
  const lastActive = new Date().toISOString();
  await db.users.update({ _id: user._id }, { $set: { lastActive, streak, recordStreak } });
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
  const user = await db.users.findOne({ _id: payload.id });
  if (!user) return res.status(401).json({ error: "Usuario no encontrado" });
  req.user = { id: user._id, email: user.email };
  req.dbUser = await touchStreak(user);
  next();
});

// ── Rangos y XP ───────────────────────────────────────────
function getRank(xp) {
  return RANKS.findLast(r => xp >= r.min) || RANKS[0];
}

/**
 * Ejecuta una acción que puede otorgar XP y devuelve la respuesta enriquecida con
 * las recompensas obtenidas, la XP total, el rango y si hubo subida de rango.
 * Dentro de fn usa ctx.give(amount, label) para sumar XP.
 */
async function withRewards(userId, fn) {
  const before = await db.users.findOne({ _id: userId });
  const ctx = {
    rewards: [],
    async give(amount, label) {
      if (!amount) return;
      await db.users.update({ _id: userId }, { $inc: { xp: amount } });
      ctx.rewards.push({ label, xp: amount });
    },
  };
  const result = (await fn(ctx)) || {};
  await checkBadges(userId, ctx);
  const after = await db.users.findOne({ _id: userId });
  const from = getRank(before.xp || 0).name;
  const to = getRank(after.xp || 0).name;
  return {
    ...result,
    rewards: ctx.rewards,
    earned: ctx.rewards.reduce((s, r) => s + r.xp, 0),
    xp: after.xp || 0,
    rank: to,
    rankUp: from !== to ? { from, to } : null,
  };
}

// ── Progreso de cursos ────────────────────────────────────
const STEP_TYPES = ["lesson", "challenge", "exam"];

async function loadProgress(userId) {
  return db.progress.find({ userId });
}

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
  const recent = [...entries]
    .filter(e => STEP_TYPES.includes(e.type))
    .sort((a, b) => (b.completedAt || "").localeCompare(a.completedAt || ""));
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
  const entries = await loadProgress(userId);
  const states = computeCourseStates(entries);
  const course = getCourse(courseId);

  if (states[courseId].done && !entries.some(e => e.type === "course" && e.courseId === courseId)) {
    await db.progress.insert({ userId, type: "course", courseId, completedAt: new Date().toISOString() });
    await ctx.give(XP_SOURCES.course_complete, `Curso dominado: ${course.title}`);
  }

  const branch = BRANCHES.find(b => b.id === course.branchId);
  const playable = branch.courses.filter(c => states[c.id].availableCount > 0);
  if (playable.every(c => states[c.id].done) && !entries.some(e => e.type === "branch" && e.branchId === branch.id)) {
    await db.progress.insert({ userId, type: "branch", branchId: branch.id, completedAt: new Date().toISOString() });
    await ctx.give(XP_SOURCES.branch_mastered, `Rama dominada: ${branch.name}`);
  }

  const doc = await db.missions.findOne({ userId, date: dayKey() });
  const mission = doc?.missions.find(m => m.type === "advance" && m.courseId === courseId && !m.done);
  if (mission) await completeMission(userId, doc, mission.id, ctx);

  return computeCourseStates(await loadProgress(userId));
}

// ── Badges ────────────────────────────────────────────────
async function buildStats(userId) {
  const [user, entries, posts] = await Promise.all([
    db.users.findOne({ _id: userId }),
    loadProgress(userId),
    db.posts.count({ userId }),
  ]);
  return {
    xp: user.xp || 0,
    recordStreak: user.recordStreak || 0,
    lessons: entries.filter(e => e.type === "lesson").length,
    resources: entries.filter(e => e.type === "resource").length,
    coursesDone: entries.filter(e => e.type === "course").map(e => e.courseId),
    posts,
  };
}

async function checkBadges(userId, ctx) {
  // Repite porque la XP de un badge puede desbloquear otro (p. ej. Rango Héroe)
  for (let round = 0; round < 5; round++) {
    const earnedIds = (await db.badges.find({ userId })).map(b => b.badgeId);
    const stats = await buildStats(userId);
    const fresh = BADGES.filter(b => !earnedIds.includes(b.id) && b.check(stats));
    if (!fresh.length) return;
    for (const b of fresh) {
      await db.badges.insert({ userId, badgeId: b.id, earnedAt: new Date().toISOString() });
      await ctx.give(b.xp, `Badge: ${b.name}`);
    }
  }
}

// ═══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════

const signToken = user => jwt.sign({ id: user._id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
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

  if (await db.users.findOne({ email })) return res.status(409).json({ error: "Este email ya está registrado" });

  const hash = await bcrypt.hash(password, 10);
  const user = await db.users.insert({
    name, email, password: hash,
    xp: 0, streak: 1, recordStreak: 1,
    lastActive: new Date().toISOString(),
    createdAt: new Date().toISOString(),
  });

  res.status(201).json({
    message: "¡Bienvenido a HeroPath!",
    token: signToken(user),
    user: { id: user._id, name, email, xp: 0, rank: "Recluta", streak: 1 },
  });
}));

app.post("/api/auth/login", route(async (req, res) => {
  const email = normEmail(req.body.email);
  const password = String(req.body.password || "");
  if (!email || !password) return res.status(400).json({ error: "Email y contraseña requeridos" });

  const found = await db.users.findOne({ email });
  if (!found || !(await bcrypt.compare(password, found.password)))
    return res.status(401).json({ error: "Email o contraseña incorrectos" });

  const user = await touchStreak(found);
  res.json({
    token: signToken(user),
    user: { id: user._id, name: user.name, email, xp: user.xp || 0, rank: getRank(user.xp || 0).name, streak: user.streak },
  });
}));

app.get("/api/auth/me", auth, route(async (req, res) => {
  await checkBadges(req.user.id, { give: (amount) => db.users.update({ _id: req.user.id }, { $inc: { xp: amount } }) });
  const user = await db.users.findOne({ _id: req.user.id });
  const xp = user.xp || 0;
  const rank = getRank(xp);
  const nextRank = RANKS.find(r => r.min > xp);
  const [pos, badgesCount, entries] = await Promise.all([
    db.users.count({ xp: { $gt: xp } }),
    db.badges.count({ userId: user._id }),
    loadProgress(user._id),
  ]);
  res.json({
    id: user._id,
    name: user.name,
    email: user.email,
    xp,
    rank: rank.name,
    rankMin: rank.min,
    rankMax: rank.max === Infinity ? null : rank.max,
    nextRank: nextRank?.name || null,
    nextRankXP: nextRank?.min || null,
    streak: user.streak || 0,
    recordStreak: user.recordStreak || 0,
    pos: pos + 1,
    badgesCount,
    lessonsCompleted: entries.filter(e => e.type === "lesson").length,
    coursesCompleted: entries.filter(e => e.type === "course").length,
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

// GET /api/courses/:courseId/lessons/:n — contenido (sin respuestas del examen)
app.get("/api/courses/:courseId/lessons/:n", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  const { course, n, lesson, state, progress } = r;
  const available = state.lessons.filter(l => l.available);
  const idx = available.findIndex(l => l.n === n);
  const bestExam = await db.progress.find({ userId: req.user.id, type: "exam_attempt", courseId: course.id, lessonNumber: n });
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
    progress: {
      lesson: progress.lesson, challenge: progress.challenge, exam: progress.exam,
      bestScore: bestExam.reduce((m, a) => Math.max(m, a.score), 0),
    },
    prev: available[idx - 1] ? { n: available[idx - 1].n, title: available[idx - 1].title } : null,
    next: available[idx + 1] ? { n: available[idx + 1].n, title: available[idx + 1].title } : null,
  });
}));

const passScore = lesson => Math.ceil(lesson.exam.length * 0.75);
const stepKey = (req, course, n, type) => ({ userId: req.user.id, type, courseId: course.id, lessonNumber: n });

// POST /api/courses/:courseId/lessons/:n/complete — lección leída
app.post("/api/courses/:courseId/lessons/:n/complete", auth, route(async (req, res) => {
  const r = await resolveLesson(req, res);
  if (!r) return;
  if (r.progress.lesson) return res.json({ alreadyDone: true, rewards: [], earned: 0 });
  const out = await withRewards(req.user.id, async ctx => {
    await db.progress.insert({ ...stepKey(req, r.course, r.n, "lesson"), completedAt: new Date().toISOString() });
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

  const out = await withRewards(req.user.id, async ctx => {
    await db.progress.insert({ ...stepKey(req, r.course, r.n, "challenge"), report, completedAt: new Date().toISOString() });
    await ctx.give(XP_SOURCES.challenge_complete, "Reto entregado");
    if (req.body.share) {
      const text = `Reto completado · ${r.course.title}: ${r.lesson.challenge.title}\n\n${report}`.slice(0, 280);
      await db.posts.insert({
        userId: req.user.id, text, achievement: { type: "challenge", courseId: r.course.id, title: r.lesson.challenge.title },
        likes: [], comments: [], createdAt: new Date().toISOString(),
      });
    }
    await afterCourseProgress(req.user.id, r.course.id, ctx);
    return { message: "Reto entregado", shared: Boolean(req.body.share) };
  });
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
    await db.progress.insert({ ...stepKey(req, r.course, r.n, "exam_attempt"), score, total, passed, completedAt: new Date().toISOString() });
    if (passed && !r.progress.exam) {
      await db.progress.insert({ ...stepKey(req, r.course, r.n, "exam"), score, total, completedAt: new Date().toISOString() });
      await ctx.give(XP_SOURCES.exam_pass, "Examen aprobado");
      await afterCourseProgress(req.user.id, r.course.id, ctx);
    }
    return { score, total, passed, passScore: passScore(r.lesson), firstPass: passed && !r.progress.exam,
      message: passed ? "Examen aprobado 🏆" : "Sigue practicando" };
  });
  res.json(out);
}));

// GET /api/progress — historial crudo del usuario
app.get("/api/progress", auth, route(async (req, res) => {
  res.json(await loadProgress(req.user.id));
}));

// ═══════════════════════════════════════════════════════════
//  LIBRERÍA
// ═══════════════════════════════════════════════════════════

app.get("/api/library", auth, route(async (req, res) => {
  const done = await db.progress.find({ userId: req.user.id, type: "resource" });
  res.json(RESOURCES.map(r => ({ ...r, done: done.some(d => d.resourceId === r.id), xp: XP_SOURCES.resource_read })));
}));

app.post("/api/library/:id/complete", auth, route(async (req, res) => {
  const resource = RESOURCES.find(r => r.id === req.params.id);
  if (!resource) return res.status(404).json({ error: "Recurso no encontrado" });
  if (await db.progress.findOne({ userId: req.user.id, type: "resource", resourceId: resource.id }))
    return res.status(409).json({ error: "Recurso ya completado", alreadyDone: true });
  const out = await withRewards(req.user.id, async ctx => {
    await db.progress.insert({ userId: req.user.id, type: "resource", resourceId: resource.id, completedAt: new Date().toISOString() });
    await ctx.give(XP_SOURCES.resource_read, `Recurso: ${resource.title}`);
  });
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

async function seedDailyMissions(userId) {
  const today = dayKey();
  const existing = await db.missions.findOne({ userId, date: today });
  if (existing) return existing;

  // 1 misión de avance (si hay cursos con lecciones pendientes) + hábitos hasta completar 3
  const states = computeCourseStates(await loadProgress(userId));
  const advance = shuffle(COURSES.filter(c => states[c.id].unlocked && states[c.id].lessons.some(l => l.available && !l.mastered)))
    .slice(0, 1)
    .map(c => ({ type: "advance", courseId: c.id, title: `Avanza en ${c.title}`, branch: c.branchName, xp: 50, icon: c.icon }));
  const habits = shuffle(HABIT_MISSIONS).slice(0, 3 - advance.length);
  const missions = [...advance, ...habits].map((m, i) => ({ ...m, id: i + 1, done: false }));

  return db.missions.insert({ userId, date: today, missions, bonusClaimed: false, createdAt: new Date().toISOString() });
}

async function completeMission(userId, doc, missionId, ctx) {
  const missions = doc.missions.map(m => (m.id === missionId ? { ...m, done: true, doneAt: new Date().toISOString() } : m));
  const mission = missions.find(m => m.id === missionId);
  const allDone = missions.every(m => m.done);
  const giveBonus = allDone && !doc.bonusClaimed;
  await db.missions.update({ _id: doc._id }, { $set: { missions, bonusClaimed: doc.bonusClaimed || allDone } });
  await ctx.give(mission.xp, `Misión: ${mission.title}`);
  if (giveBonus) await ctx.give(XP_SOURCES.daily_bonus, "Bono diario: 3 misiones");
  return { allDone, bonusEarned: giveBonus ? XP_SOURCES.daily_bonus : 0 };
}

app.get("/api/missions/today", auth, route(async (req, res) => {
  const doc = await seedDailyMissions(req.user.id);
  res.json({ ...doc, completedCount: doc.missions.filter(m => m.done).length, bonusXP: XP_SOURCES.daily_bonus });
}));

app.patch("/api/missions/:missionId/complete", auth, route(async (req, res) => {
  const doc = await db.missions.findOne({ userId: req.user.id, date: dayKey() });
  if (!doc) return res.status(404).json({ error: "No hay misiones para hoy" });
  const mId = parseInt(req.params.missionId, 10);
  const mission = doc.missions.find(m => m.id === mId);
  if (!mission) return res.status(404).json({ error: "Misión no encontrada" });
  if (mission.done) return res.status(409).json({ error: "Misión ya completada" });
  if (mission.type === "advance")
    return res.status(400).json({ error: "Esta misión se completa al avanzar en el curso" });

  const out = await withRewards(req.user.id, ctx => completeMission(req.user.id, doc, mId, ctx));
  res.json({ message: "Misión completada", ...out });
}));

// ═══════════════════════════════════════════════════════════
//  COMUNIDAD
// ═══════════════════════════════════════════════════════════

async function enrichPosts(posts, meId) {
  const ids = [...new Set(posts.flatMap(p => [p.userId, ...p.comments.map(c => c.userId)]))];
  const users = await db.users.find({ _id: { $in: ids } });
  const byId = Object.fromEntries(users.map(u => [u._id, u]));
  return posts.map(p => {
    const u = byId[p.userId];
    return {
      _id: p._id, userId: p.userId, text: p.text, achievement: p.achievement, createdAt: p.createdAt,
      userName: u?.name || "Héroe anónimo",
      userRank: getRank(u?.xp || 0).name,
      likeCount: p.likes.length,
      likedByMe: p.likes.includes(meId),
      comments: p.comments.map(c => ({ ...c, userName: byId[c.userId]?.name || c.userName })),
    };
  });
}

app.get("/api/posts", auth, route(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
  const posts = await db.posts.find({}).sort({ createdAt: -1 }).limit(limit);
  res.json(await enrichPosts(posts, req.user.id));
}));

app.post("/api/posts", auth, route(async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (text.length < 5) return res.status(400).json({ error: "El texto debe tener al menos 5 caracteres" });
  if (text.length > 280) return res.status(400).json({ error: "Máximo 280 caracteres" });

  let post;
  const out = await withRewards(req.user.id, async () => {
    post = await db.posts.insert({ userId: req.user.id, text, achievement: null, likes: [], comments: [], createdAt: new Date().toISOString() });
  });
  const [enriched] = await enrichPosts([post], req.user.id);
  res.status(201).json({ ...enriched, ...out, _id: post._id });
}));

app.delete("/api/posts/:id", auth, route(async (req, res) => {
  const post = await db.posts.findOne({ _id: req.params.id });
  if (!post) return res.status(404).json({ error: "Post no encontrado" });
  if (post.userId !== req.user.id) return res.status(403).json({ error: "Solo puedes borrar tus publicaciones" });
  await db.posts.remove({ _id: post._id });
  res.json({ deleted: true });
}));

app.post("/api/posts/:id/like", auth, route(async (req, res) => {
  const post = await db.posts.findOne({ _id: req.params.id });
  if (!post) return res.status(404).json({ error: "Post no encontrado" });
  const liked = post.likes.includes(req.user.id);
  await db.posts.update({ _id: post._id }, liked ? { $pull: { likes: req.user.id } } : { $addToSet: { likes: req.user.id } });
  res.json({ liked: !liked, likeCount: post.likes.length + (liked ? -1 : 1) });
}));

app.post("/api/posts/:id/comment", auth, route(async (req, res) => {
  const text = String(req.body.text || "").trim();
  if (text.length < 2) return res.status(400).json({ error: "Comentario muy corto" });
  if (text.length > 280) return res.status(400).json({ error: "Máximo 280 caracteres" });
  const post = await db.posts.findOne({ _id: req.params.id });
  if (!post) return res.status(404).json({ error: "Post no encontrado" });

  const comment = { userId: req.user.id, userName: req.dbUser.name, text, createdAt: new Date().toISOString() };
  await db.posts.update({ _id: post._id }, { $push: { comments: comment } });
  res.status(201).json(comment);
}));

// ═══════════════════════════════════════════════════════════
//  RANKING
// ═══════════════════════════════════════════════════════════

app.get("/api/leaderboard", auth, route(async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit, 10) || 20, 100);
  const users = await db.users.find({}).sort({ xp: -1 }).limit(limit);
  const entry = (u, pos) => ({
    pos, id: u._id, name: u.name, xp: u.xp || 0, rank: getRank(u.xp || 0).name,
    streak: u.streak || 0, isMe: u._id === req.user.id,
  });
  const board = users.map((u, i) => entry(u, i + 1));

  let myEntry = board.find(u => u.isMe) || null;
  if (!myEntry) {
    const me = req.dbUser;
    myEntry = entry(me, (await db.users.count({ xp: { $gt: me.xp || 0 } })) + 1);
  }
  res.json({ leaderboard: board, myEntry, total: await db.users.count({}) });
}));

// ═══════════════════════════════════════════════════════════
//  BADGES Y XP
// ═══════════════════════════════════════════════════════════

app.get("/api/badges", auth, route(async (req, res) => {
  const earned = await db.badges.find({ userId: req.user.id });
  res.json(BADGES.map(({ check, ...b }) => {
    const e = earned.find(x => x.badgeId === b.id);
    return { ...b, earned: Boolean(e), earnedAt: e?.earnedAt || null };
  }));
}));

app.get("/api/xp/sources", (req, res) => res.json(XP_SOURCES));

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "HeroPath API", version: "2.0.0", timestamp: new Date().toISOString() });
});

app.use("/api", (req, res) => res.status(404).json({ error: "Ruta no encontrada" }));

// ── Frontend ──────────────────────────────────────────────
// Solo se sirven los HTML de la app (nunca la carpeta completa: contiene server.js, .env y data/)
app.get(["/", "/index.html"], (req, res) => res.sendFile(path.join(__dirname, "index.html")));
app.get("/leccion.html", (req, res) => res.sendFile(path.join(__dirname, "leccion.html")));

// ── Start ─────────────────────────────────────────────────
if (require.main === module) {
  app.listen(PORT, () => {
    console.log(`\n🏆 HeroPath corriendo en http://localhost:${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/api/health\n`);
  });
}

module.exports = { app, db, computeCourseStates };
