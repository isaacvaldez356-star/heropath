/**
 * HeroPath Backend — API REST completa
 * Stack: Node.js + Express + NeDB (embedded) + JWT
 * Puerto: 3001
 */

require("dotenv").config();
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const Datastore = require("nedb-promises");
const path = require("path");

const app = express();
const PORT = process.env.PORT || 3001;
const JWT_SECRET = process.env.JWT_SECRET || "heropath_secret_dev_2026";

// ── Middleware ────────────────────────────────────────────
app.use(cors());
app.use(express.json());

// ── Databases (embedded, no config needed) ────────────────
const db = {
  users:     Datastore.create({ filename: "./data/users.db",     autoload: true }),
  progress:  Datastore.create({ filename: "./data/progress.db",  autoload: true }),
  missions:  Datastore.create({ filename: "./data/missions.db",  autoload: true }),
  posts:     Datastore.create({ filename: "./data/posts.db",     autoload: true }),
  badges:    Datastore.create({ filename: "./data/badges.db",    autoload: true }),
};

// ── Auth Middleware ───────────────────────────────────────
const auth = (req, res, next) => {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Token requerido" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: "Token inválido o expirado" });
  }
};

// ── XP Helper ─────────────────────────────────────────────
const XP_SOURCES = {
  lesson_complete:    50,
  challenge_complete: 100,
  exam_pass:          150,
  course_complete:    300,
  branch_mastered:    1000,
  daily_bonus:        75,
  weekly_challenge:   400,
  monthly_boss:       2000,
  resource_read:      25,
};

const RANKS = [
  { name: "Recluta",  min: 0,     max: 999   },
  { name: "Guerrero", min: 1000,  max: 4999  },
  { name: "Héroe",    min: 5000,  max: 14999 },
  { name: "Leyenda",  min: 15000, max: 49999 },
  { name: "Inmortal", min: 50000, max: Infinity },
];

function getRank(xp) {
  return RANKS.findLast(r => xp >= r.min) || RANKS[0];
}

async function addXP(userId, amount, source) {
  const user = await db.users.findOne({ _id: userId });
  if (!user) return null;
  const newXP = (user.xp || 0) + amount;
  const oldRank = getRank(user.xp || 0);
  const newRank = getRank(newXP);
  const rankUp = oldRank.name !== newRank.name;
  await db.users.update({ _id: userId }, { $set: { xp: newXP } });
  return { newXP, oldRank, newRank, rankUp, source, amount };
}

// ═══════════════════════════════════════════════════════════
//  AUTH ROUTES
// ═══════════════════════════════════════════════════════════

// POST /api/auth/register
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ error: "Nombre, email y contraseña requeridos" });
    if (password.length < 6)
      return res.status(400).json({ error: "La contraseña debe tener al menos 6 caracteres" });

    const existing = await db.users.findOne({ email });
    if (existing) return res.status(409).json({ error: "Este email ya está registrado" });

    const hash = await bcrypt.hash(password, 10);
    const user = await db.users.insert({
      name,
      email,
      password: hash,
      xp: 0,
      streak: 0,
      lastActive: null,
      recordStreak: 0,
      createdAt: new Date().toISOString(),
      activeBranches: [],
    });

    // Seed daily missions for new user
    await seedDailyMissions(user._id);

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    res.status(201).json({
      message: "¡Bienvenido a HeroPath!",
      token,
      user: { id: user._id, name, email, xp: 0, rank: "Recluta", streak: 0 },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/auth/login
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ error: "Email y contraseña requeridos" });

    const user = await db.users.findOne({ email });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: "Contraseña incorrecta" });

    // Update streak
    const today = new Date().toDateString();
    let streak = user.streak || 0;
    if (user.lastActive) {
      const last = new Date(user.lastActive).toDateString();
      const yesterday = new Date(Date.now() - 86400000).toDateString();
      if (last === yesterday) streak += 1;
      else if (last !== today) streak = 1;
    } else {
      streak = 1;
    }
    const recordStreak = Math.max(streak, user.recordStreak || 0);
    await db.users.update({ _id: user._id }, { $set: { lastActive: new Date().toISOString(), streak, recordStreak } });

    const token = jwt.sign({ id: user._id, email }, JWT_SECRET, { expiresIn: "7d" });
    const rank = getRank(user.xp || 0);
    res.json({
      token,
      user: { id: user._id, name: user.name, email, xp: user.xp, rank: rank.name, streak },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/auth/me
app.get("/api/auth/me", auth, async (req, res) => {
  try {
    const user = await db.users.findOne({ _id: req.user.id });
    if (!user) return res.status(404).json({ error: "Usuario no encontrado" });
    const rank = getRank(user.xp || 0);
    const nextRank = RANKS.find(r => r.min > (user.xp || 0));
    res.json({
      id: user._id,
      name: user.name,
      email: user.email,
      xp: user.xp || 0,
      rank: rank.name,
      rankMin: rank.min,
      rankMax: rank.max,
      nextRank: nextRank?.name || null,
      nextRankXP: nextRank?.min || null,
      streak: user.streak || 0,
      recordStreak: user.recordStreak || 0,
      createdAt: user.createdAt,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  PROGRESS ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/progress — all user progress
app.get("/api/progress", auth, async (req, res) => {
  try {
    const progress = await db.progress.find({ userId: req.user.id });
    res.json(progress);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/progress/lesson — complete a lesson
app.post("/api/progress/lesson", auth, async (req, res) => {
  try {
    const { courseId, lessonId, lessonNumber } = req.body;
    if (!courseId || !lessonId)
      return res.status(400).json({ error: "courseId y lessonId requeridos" });

    // Check if already done
    const existing = await db.progress.findOne({ userId: req.user.id, courseId, lessonId, type: "lesson" });
    if (existing) return res.status(409).json({ error: "Lección ya completada", alreadyDone: true });

    await db.progress.insert({
      userId: req.user.id,
      courseId,
      lessonId,
      lessonNumber,
      type: "lesson",
      completedAt: new Date().toISOString(),
    });

    const xpResult = await addXP(req.user.id, XP_SOURCES.lesson_complete, "lesson_complete");
    res.json({ message: "Lección completada", xp: xpResult, earned: XP_SOURCES.lesson_complete });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/progress/challenge — submit challenge
app.post("/api/progress/challenge", auth, async (req, res) => {
  try {
    const { courseId, lessonId, report } = req.body;
    if (!courseId || !lessonId || !report)
      return res.status(400).json({ error: "courseId, lessonId y report requeridos" });
    if (report.trim().length < 10)
      return res.status(400).json({ error: "El reporte debe tener al menos 10 caracteres" });

    const existing = await db.progress.findOne({ userId: req.user.id, courseId, lessonId, type: "challenge" });
    if (existing) return res.status(409).json({ error: "Reto ya entregado", alreadyDone: true });

    await db.progress.insert({
      userId: req.user.id,
      courseId,
      lessonId,
      type: "challenge",
      report: report.trim(),
      completedAt: new Date().toISOString(),
    });

    const xpResult = await addXP(req.user.id, XP_SOURCES.challenge_complete, "challenge_complete");
    res.json({ message: "Reto entregado", xp: xpResult, earned: XP_SOURCES.challenge_complete });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/progress/exam — submit exam results
app.post("/api/progress/exam", auth, async (req, res) => {
  try {
    const { courseId, lessonId, score, total, passed } = req.body;
    if (courseId === undefined || lessonId === undefined || score === undefined)
      return res.status(400).json({ error: "courseId, lessonId, score requeridos" });

    await db.progress.insert({
      userId: req.user.id,
      courseId,
      lessonId,
      type: "exam",
      score,
      total,
      passed,
      completedAt: new Date().toISOString(),
    });

    let xpResult = null;
    if (passed) {
      xpResult = await addXP(req.user.id, XP_SOURCES.exam_pass, "exam_pass");
    }
    res.json({ message: passed ? "Examen aprobado 🏆" : "Sigue practicando", xp: xpResult, earned: passed ? XP_SOURCES.exam_pass : 0, passed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/progress/course/:courseId — course summary
app.get("/api/progress/course/:courseId", auth, async (req, res) => {
  try {
    const entries = await db.progress.find({ userId: req.user.id, courseId: req.params.courseId });
    const lessons = entries.filter(e => e.type === "lesson");
    const challenges = entries.filter(e => e.type === "challenge");
    const exams = entries.filter(e => e.type === "exam" && e.passed);
    res.json({ courseId: req.params.courseId, lessonsCompleted: lessons.length, challengesCompleted: challenges.length, examsPassed: exams.length, entries });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  MISSIONS ROUTES
// ═══════════════════════════════════════════════════════════

const MISSION_TEMPLATES = [
  { type: "advance",  title: "Completa una lección de Hybrid Athlete", branch: "Cuerpo",     xp: 50, icon: "ti-barbell" },
  { type: "habit",    title: "20 minutos de meditación activa",         branch: "Disciplina", xp: 50, icon: "ti-flame"   },
  { type: "advance",  title: "Avanza en Ultraproductividad",            branch: "Mente",      xp: 50, icon: "ti-brain"   },
  { type: "habit",    title: "Lectura de 15 páginas de la librería",    branch: "Mente",      xp: 50, icon: "ti-book"    },
  { type: "advance",  title: "Lección de Heroes English",               branch: "Social",     xp: 50, icon: "ti-language"},
  { type: "surprise", title: "Sal a caminar 30 minutos sin teléfono",   branch: "Cuerpo",    xp:150, icon: "ti-walk"    },
  { type: "habit",    title: "Escribe 3 cosas que agradeces hoy",       branch: "Mentalidad", xp: 50, icon: "ti-pencil"  },
];

async function seedDailyMissions(userId) {
  const today = new Date().toDateString();
  const existing = await db.missions.findOne({ userId, date: today });
  if (existing) return;

  const shuffled = MISSION_TEMPLATES.sort(() => 0.5 - Math.random());
  const daily = shuffled.slice(0, 3).map((m, i) => ({ ...m, id: i + 1, done: false }));

  await db.missions.insert({ userId, date: today, missions: daily, bonusClaimed: false, createdAt: new Date().toISOString() });
}

// GET /api/missions/today
app.get("/api/missions/today", auth, async (req, res) => {
  try {
    await seedDailyMissions(req.user.id);
    const today = new Date().toDateString();
    const doc = await db.missions.findOne({ userId: req.user.id, date: today });
    const completedCount = doc.missions.filter(m => m.done).length;
    res.json({ ...doc, completedCount, bonusXP: XP_SOURCES.daily_bonus });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/missions/:missionId/complete
app.patch("/api/missions/:missionId/complete", auth, async (req, res) => {
  try {
    const today = new Date().toDateString();
    const doc = await db.missions.findOne({ userId: req.user.id, date: today });
    if (!doc) return res.status(404).json({ error: "No hay misiones para hoy" });

    const mId = parseInt(req.params.missionId);
    const mission = doc.missions.find(m => m.id === mId);
    if (!mission) return res.status(404).json({ error: "Misión no encontrada" });
    if (mission.done) return res.status(409).json({ error: "Misión ya completada" });

    const updatedMissions = doc.missions.map(m => m.id === mId ? { ...m, done: true } : m);
    const allDone = updatedMissions.every(m => m.done);
    let bonusClaimed = doc.bonusClaimed;
    let bonusXP = 0;

    await db.missions.update({ _id: doc._id }, { $set: { missions: updatedMissions, bonusClaimed: allDone || bonusClaimed } });

    const xpResult = await addXP(req.user.id, mission.xp, "mission_complete");

    if (allDone && !bonusClaimed) {
      await addXP(req.user.id, XP_SOURCES.daily_bonus, "daily_bonus");
      bonusXP = XP_SOURCES.daily_bonus;
    }

    res.json({ message: "Misión completada", earned: mission.xp, bonusEarned: bonusXP, allDone, xp: xpResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  COMMUNITY / POSTS ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/posts — feed
app.get("/api/posts", auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const posts = await db.posts.find({}).sort({ createdAt: -1 }).limit(limit);
    // Enrich with user name
    const enriched = await Promise.all(posts.map(async p => {
      const u = await db.users.findOne({ _id: p.userId });
      return { ...p, userName: u?.name || "Héroe anónimo", userRank: getRank(u?.xp || 0).name };
    }));
    res.json(enriched);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts — create post
app.post("/api/posts", auth, async (req, res) => {
  try {
    const { text, achievement } = req.body;
    if (!text || text.trim().length < 5)
      return res.status(400).json({ error: "El texto debe tener al menos 5 caracteres" });
    if (text.length > 280)
      return res.status(400).json({ error: "Máximo 280 caracteres" });

    const user = await db.users.findOne({ _id: req.user.id });
    const post = await db.posts.insert({
      userId: req.user.id,
      text: text.trim(),
      achievement: achievement || null,
      likes: [],
      comments: [],
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ ...post, userName: user.name, userRank: getRank(user.xp || 0).name });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts/:id/like — toggle like
app.post("/api/posts/:id/like", auth, async (req, res) => {
  try {
    const post = await db.posts.findOne({ _id: req.params.id });
    if (!post) return res.status(404).json({ error: "Post no encontrado" });

    const liked = post.likes.includes(req.user.id);
    const newLikes = liked
      ? post.likes.filter(id => id !== req.user.id)
      : [...post.likes, req.user.id];

    await db.posts.update({ _id: req.params.id }, { $set: { likes: newLikes } });
    res.json({ liked: !liked, likeCount: newLikes.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/posts/:id/comment
app.post("/api/posts/:id/comment", auth, async (req, res) => {
  try {
    const { text } = req.body;
    if (!text || text.trim().length < 2)
      return res.status(400).json({ error: "Comentario muy corto" });

    const user = await db.users.findOne({ _id: req.user.id });
    const comment = { userId: req.user.id, userName: user.name, text: text.trim(), createdAt: new Date().toISOString() };

    await db.posts.update({ _id: req.params.id }, { $push: { comments: comment } });
    res.status(201).json(comment);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  LEADERBOARD ROUTES
// ═══════════════════════════════════════════════════════════

// GET /api/leaderboard — top users by XP
app.get("/api/leaderboard", auth, async (req, res) => {
  try {
    const limit = parseInt(req.query.limit) || 20;
    const users = await db.users.find({}).sort({ xp: -1 }).limit(limit);
    const board = users.map((u, i) => ({
      pos: i + 1,
      id: u._id,
      name: u.name,
      xp: u.xp || 0,
      rank: getRank(u.xp || 0).name,
      streak: u.streak || 0,
      isMe: u._id === req.user.id,
    }));

    // Find current user position if not in top
    const myPos = board.findIndex(u => u.isMe);
    let myEntry = null;
    if (myPos === -1) {
      const allUsers = await db.users.find({}).sort({ xp: -1 });
      const myIdx = allUsers.findIndex(u => u._id === req.user.id);
      const me = allUsers[myIdx];
      if (me) myEntry = { pos: myIdx + 1, id: me._id, name: me.name, xp: me.xp || 0, rank: getRank(me.xp || 0).name, streak: me.streak || 0, isMe: true };
    }

    res.json({ leaderboard: board, myEntry, total: await db.users.count({}) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  BADGES ROUTES
// ═══════════════════════════════════════════════════════════

const BADGE_DEFINITIONS = [
  { id: "invocador",  name: "Invocador",       icon: "ti-sparkles", xp: 500,  condition: "complete_course_invoca" },
  { id: "constante",  name: "Constante",        icon: "ti-flame",    xp: 1000, condition: "monthly_boss" },
  { id: "atleta",     name: "Atleta",           icon: "ti-barbell",  xp: 300,  condition: "complete_lesson_10" },
  { id: "monje_b",    name: "Monje",            icon: "ti-peace",    xp: 200,  condition: "streak_7" },
  { id: "heroe_r",    name: "Rango Héroe",      icon: "ti-helmet",   xp: 500,  condition: "reach_5000xp" },
  { id: "leyenda_b",  name: "Leyenda",          icon: "ti-crown",    xp: 1000, condition: "reach_15000xp" },
  { id: "inmortal",   name: "Inmortal",         icon: "ti-star",     xp: 5000, condition: "reach_50000xp" },
];

// GET /api/badges — user badges
app.get("/api/badges", auth, async (req, res) => {
  try {
    const earned = await db.badges.find({ userId: req.user.id });
    const earnedIds = earned.map(b => b.badgeId);
    const all = BADGE_DEFINITIONS.map(b => ({
      ...b,
      earned: earnedIds.includes(b.id),
      earnedAt: earned.find(e => e.badgeId === b.id)?.earnedAt || null,
    }));
    res.json(all);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/badges/award — award a badge (internal or admin)
app.post("/api/badges/award", auth, async (req, res) => {
  try {
    const { badgeId } = req.body;
    const badge = BADGE_DEFINITIONS.find(b => b.id === badgeId);
    if (!badge) return res.status(404).json({ error: "Badge no encontrado" });

    const existing = await db.badges.findOne({ userId: req.user.id, badgeId });
    if (existing) return res.status(409).json({ error: "Badge ya otorgado" });

    await db.badges.insert({ userId: req.user.id, badgeId, earnedAt: new Date().toISOString() });
    const xpResult = await addXP(req.user.id, badge.xp, `badge_${badgeId}`);

    res.status(201).json({ message: `Badge "${badge.name}" desbloqueado`, badge, xp: xpResult });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════════════════════
//  XP ROUTES
// ═══════════════════════════════════════════════════════════

// POST /api/xp/add — manually add XP (for custom actions)
app.post("/api/xp/add", auth, async (req, res) => {
  try {
    const { source } = req.body;
    const amount = XP_SOURCES[source];
    if (!amount) return res.status(400).json({ error: "Fuente de XP no válida", validSources: Object.keys(XP_SOURCES) });

    const result = await addXP(req.user.id, amount, source);
    res.json({ earned: amount, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/xp/sources — list all XP sources and values
app.get("/api/xp/sources", (req, res) => {
  res.json(XP_SOURCES);
});

// ═══════════════════════════════════════════════════════════
//  HEALTH CHECK
// ═══════════════════════════════════════════════════════════
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", app: "HeroPath API", version: "1.0.0", timestamp: new Date().toISOString() });
});

// ── Start ─────────────────────────────────────────────────
const fs = require("fs");
if (!fs.existsSync("./data")) fs.mkdirSync("./data");

app.listen(PORT, () => {
  console.log(`\n🏆 HeroPath API corriendo en http://localhost:${PORT}`);
  console.log(`   Health: http://localhost:${PORT}/api/health\n`);
});
