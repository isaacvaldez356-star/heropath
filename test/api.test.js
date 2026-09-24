const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "heropath-test-"));
const { app } = require("../server");
const LESSONS = require("../lessons");
const { COURSES } = require("../catalog");

let server, base, token;

async function call(method, url, body, tok = token) {
  const headers = { "Content-Type": "application/json" };
  if (tok) headers.Authorization = `Bearer ${tok}`;
  const r = await fetch(base + url, { method, headers, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, body: await r.json() };
}

before(async () => {
  server = app.listen(0);
  await new Promise(r => server.once("listening", r));
  base = `http://127.0.0.1:${server.address().port}`;
  const reg = await call("POST", "/api/auth/register", { name: "Alex", email: "Alex@HeroPath.com", password: "hero123" }, null);
  assert.equal(reg.status, 201);
  token = reg.body.token;
});

after(() => {
  server.close();
  fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
});

test("todas las lecciones tienen contenido válido y enlazan a un curso existente", () => {
  for (const [key, l] of Object.entries(LESSONS)) {
    const [courseId, n] = key.split(":");
    const course = COURSES.find(c => c.id === courseId);
    assert.ok(course, `curso ${courseId}`);
    assert.ok(course.lessons[n - 1], `${key} existe en el temario`);
    assert.equal(l.title, course.lessons[n - 1].title, `${key}: el título coincide con el temario`);
    assert.ok(l.sections.length && l.challenge.steps.length && l.exam.length >= 4, key);
    for (const q of l.exam) assert.ok(q.correct >= 0 && q.correct < q.opts.length, `${key}: ${q.q}`);
  }
});

test("login ignora mayúsculas del email y /me devuelve posición", async () => {
  const r = await call("POST", "/api/auth/login", { email: "alex@heropath.com", password: "hero123" }, null);
  assert.equal(r.status, 200);
  const me = await call("GET", "/api/auth/me");
  assert.equal(me.body.pos, 1);
  assert.equal(me.body.rank, "Recluta");
});

test("tier 2 bloqueado hasta dominar un curso tier 1 de la rama", async () => {
  let cat = await call("GET", "/api/catalog");
  const mind = cat.body.branches.find(b => b.id === "mind");
  assert.equal(mind.courses.find(c => c.id === "ultraprod").status, "locked");
  assert.equal((await call("GET", "/api/courses/ultraprod/lessons/7")).status, 403);
  assert.equal((await call("GET", "/api/courses/salud/lessons/3")).status, 404, "lección sin contenido");

  // Lección → examen → reto en Salud Mental (tier 1)
  const lesson = await call("GET", "/api/courses/salud/lessons/1");
  assert.equal(lesson.status, 200);
  assert.equal(lesson.body.lesson.exam[0].correct, undefined, "no filtra respuestas");

  assert.equal((await call("POST", "/api/courses/salud/lessons/1/exam", { answers: [0, 0, 0, 0] })).status, 400, "requiere leer la lección");

  const done = await call("POST", "/api/courses/salud/lessons/1/complete");
  assert.equal(done.body.earned >= 50, true);
  const again = await call("POST", "/api/courses/salud/lessons/1/complete");
  assert.equal(again.body.earned, 0, "no se puede farmear XP");

  const fail = await call("POST", "/api/courses/salud/lessons/1/exam", { answers: [0, 1, 0, 0] });
  assert.equal(fail.body.passed, false);
  assert.equal(fail.body.earned, 0);

  const check = await call("POST", "/api/courses/salud/lessons/1/exam/check", { question: 0, answer: 1 });
  assert.equal(check.body.correct, true);

  const answers = LESSONS["salud:1"].exam.map(q => q.correct);
  const pass = await call("POST", "/api/courses/salud/lessons/1/exam", { answers });
  assert.equal(pass.body.passed, true);
  assert.ok(pass.body.rewards.some(r => r.label === "Examen aprobado"));
  const pass2 = await call("POST", "/api/courses/salud/lessons/1/exam", { answers });
  assert.equal(pass2.body.earned, 0, "XP de examen solo una vez");

  const ch = await call("POST", "/api/courses/salud/lessons/1/challenge", { report: "Registré tres pensamientos y los cuestioné", share: true });
  assert.equal(ch.status, 200);
  assert.ok(!ch.body.rewards.some(r => r.label.startsWith("Curso dominado")), "aún falta la lección 2");

  // Lección 2 completa → curso dominado
  await call("POST", "/api/courses/salud/lessons/2/complete");
  await call("POST", "/api/courses/salud/lessons/2/exam", { answers: LESSONS["salud:2"].exam.map(q => q.correct) });
  const ch2 = await call("POST", "/api/courses/salud/lessons/2/challenge", { report: "Practiqué la respiración 4-6 cada día" });
  assert.ok(ch2.body.rewards.some(r => r.label.startsWith("Curso dominado")), "curso dominado al completar todo");

  cat = await call("GET", "/api/catalog");
  const mind2 = cat.body.branches.find(b => b.id === "mind");
  assert.equal(mind2.courses.find(c => c.id === "salud").status, "done");
  assert.equal(mind2.courses.find(c => c.id === "ultraprod").status, "new");
  assert.equal(mind2.courses.find(c => c.id === "pensador").status, "locked");

  const feed = await call("GET", "/api/posts");
  assert.equal(feed.body.length, 1, "el reto compartido aparece en el feed");

  const badges = await call("GET", "/api/badges");
  assert.ok(badges.body.find(b => b.id === "primer_paso").earned);
});

test("misiones: las de hábito se marcan a mano, las de avance no", async () => {
  const today = await call("GET", "/api/missions/today");
  assert.equal(today.body.missions.length, 3);
  for (const m of today.body.missions) {
    const r = await call("PATCH", `/api/missions/${m.id}/complete`);
    if (m.type === "advance") assert.equal(r.status, 400);
    else assert.equal(r.status, 200);
  }
});

test("librería otorga XP una sola vez por recurso", async () => {
  const lib = await call("GET", "/api/library");
  const id = lib.body[0].id;
  assert.equal((await call("POST", `/api/library/${id}/complete`)).body.earned >= 25, true);
  assert.equal((await call("POST", `/api/library/${id}/complete`)).status, 409);
});

test("comunidad: like, comentario y solo el autor borra", async () => {
  const post = await call("POST", "/api/posts", { text: "Hoy hice mi sesión de deep work" });
  assert.equal(post.status, 201);
  const like = await call("POST", `/api/posts/${post.body._id}/like`);
  assert.deepEqual(like.body, { liked: true, likeCount: 1 });
  assert.equal((await call("POST", `/api/posts/${post.body._id}/comment`, { text: "¡Bien!" })).status, 201);

  const other = await call("POST", "/api/auth/register", { name: "Sam", email: "sam@heropath.com", password: "hero123" }, null);
  assert.equal((await call("DELETE", `/api/posts/${post.body._id}`, null, other.body.token)).status, 403);
  assert.equal((await call("DELETE", `/api/posts/${post.body._id}`)).status, 200);
});

test("endpoints de trampa eliminados", async () => {
  assert.equal((await call("POST", "/api/xp/add", { source: "monthly_boss" })).status, 404);
  assert.equal((await call("POST", "/api/badges/award", { badgeId: "inmortal" })).status, 404);
});
