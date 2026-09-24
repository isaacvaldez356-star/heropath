/**
 * HeroPath — Catálogo estático
 * Ramas del árbol, cursos, recursos de la librería, badges y plantillas de misiones.
 * Cada nodo del árbol es un curso. El contenido de las lecciones vive en lessons.js.
 */

const LESSONS = require("./lessons");

// ── XP ────────────────────────────────────────────────────
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
  { name: "Recluta",  min: 0,     max: 999      },
  { name: "Guerrero", min: 1000,  max: 4999     },
  { name: "Héroe",    min: 5000,  max: 14999    },
  { name: "Leyenda",  min: 15000, max: 49999    },
  { name: "Inmortal", min: 50000, max: Infinity },
];

// ── Ramas y cursos ────────────────────────────────────────
// tier 1 siempre disponible; tier N se desbloquea al dominar un curso tier N-1 de la misma rama.
const BRANCHES = [
  { id: "body", name: "Cuerpo", icon: "ti-barbell", color: "#C0392B", courses: [
    { id: "atleta",  title: "Monje atleta",     tier: 1, icon: "ti-run",         hours: "2h 40m",
      lessons: ["Movimiento diario", "Fuerza básica en casa", "Movilidad", "Cardio zona 2", "Recuperación", "Tu plan semanal"] },
    { id: "hybrid",  title: "Hybrid Athlete",   tier: 2, icon: "ti-barbell",     hours: "8h 10m",
      lessons: ["Fuerza + resistencia", "Programación semanal", "Técnica de sentadilla", "Técnica de peso muerto", "Intervalos", "Nutrición para rendir", "Deload", "Tu primera prueba híbrida"] },
    { id: "skin",    title: "Skin Legendaria",  tier: 2, icon: "ti-star",        hours: "2h 45m",
      lessons: ["Los pilares de la piel", "Rutina básica", "Protector solar", "Alimentación y piel", "Sueño y estrés", "Errores comunes", "Rutina definitiva"] },
    { id: "optimiza",title: "Optimiza",         tier: 3, icon: "ti-adjustments", hours: "4h 00m",
      lessons: ["Mide lo que importa", "Sueño de élite", "Luz y ritmo circadiano", "Frío y calor", "Tu protocolo"] },
  ]},
  { id: "mind", name: "Mente", icon: "ti-brain", color: "#7B5EA7", courses: [
    { id: "salud",      title: "Salud Mental",       tier: 1, icon: "ti-heart-handshake", hours: "3h 10m",
      lessons: ["Tus pensamientos no son hechos", "Gestión del estrés", "Diario emocional", "Límites sanos", "Cuándo pedir ayuda", "Autocompasión", "Rutina de calma", "Tu kit de bienestar"] },
    { id: "ultraprod",  title: "Ultraproductividad", tier: 2, icon: "ti-brain",           hours: "5h 40m",
      lessons: ["Introducción al sistema", "El mito de la multitarea", "Bloques de tiempo", "La ley de Parkinson", "Elimina distracciones", "El sistema de prioridades", "Deep Work", "La sesión perfecta", "Revisión semanal", "Automatización inteligente", "Hábitos de alto rendimiento", "El sistema definitivo"] },
    { id: "estudiante", title: "Estudiante de 10",   tier: 2, icon: "ti-book",            hours: "3h 30m",
      lessons: ["Aprender a aprender", "Recuerdo activo", "Repetición espaciada", "Técnica Feynman", "Toma de apuntes", "Exámenes sin pánico", "Concentración", "Proyectos", "Tu sistema de estudio"] },
    { id: "pensador",   title: "Pensador sistémico", tier: 3, icon: "ti-hierarchy",       hours: "4h 00m",
      lessons: ["Qué es un sistema", "Bucles de retroalimentación", "Modelos mentales", "Segundo orden", "Decisiones"] },
  ]},
  { id: "social", name: "Social", icon: "ti-users", color: "#2BBFA0", courses: [
    { id: "social",    title: "Social Natural",  tier: 1, icon: "ti-users",      hours: "3h 50m",
      lessons: ["Escucha activa", "Iniciar conversaciones", "Preguntas abiertas", "Lenguaje corporal", "Recordar nombres", "Humor", "Conflictos", "Redes de valor", "Carisma auténtico"] },
    { id: "english",   title: "Heroes English",  tier: 2, icon: "ti-language",   hours: "12h 00m",
      lessons: ["Mentalidad de aprendiz", "Input comprensible", "Tu rutina de inglés", "Vocabulario útil", "Pronunciación", "Speaking diario", "Listening", "Writing", "Gramática práctica", "Series y podcasts", "Conversación real", "Nivel siguiente"] },
    { id: "oratoria",  title: "Oratoria",        tier: 2, icon: "ti-microphone", hours: "3h 20m",
      lessons: ["El miedo a hablar", "Estructura de un discurso", "Voz y pausas", "Historias", "Improvisación", "Tu primera charla"] },
    { id: "liderazgo", title: "Liderazgo épico", tier: 3, icon: "ti-crown",      hours: "4h 20m",
      lessons: ["Liderarte a ti", "Visión", "Delegar", "Feedback", "Cultura"] },
  ]},
  { id: "disc", name: "Disciplina", icon: "ti-flame", color: "#E67E22", courses: [
    { id: "rutina",     title: "Rutina legendaria", tier: 1, icon: "ti-sunrise", hours: "2h 30m",
      lessons: ["Sistemas, no metas", "Tu mañana ideal", "Hábitos atómicos", "Apilar hábitos", "La noche", "Revisión"] },
    { id: "modomonje",  title: "Modo monje",        tier: 2, icon: "ti-flame",   hours: "4h 30m",
      lessons: ["Dopamina y enfoque", "Ayuno de distracciones", "Ambiente", "Soledad productiva", "Tentaciones", "Recaídas", "Retiro de 7 días", "Mantenimiento", "Identidad", "Vuelve al mundo"] },
    { id: "antifragil", title: "Antifrágil",        tier: 3, icon: "ti-shield",  hours: "3h 00m",
      lessons: ["Qué es antifragilidad", "Estrés voluntario", "Opcionalidad", "Vía negativa", "Tu plan antifrágil"] },
  ]},
  { id: "ment", name: "Mentalidad", icon: "ti-sparkles", color: "#C9A84C", courses: [
    { id: "invoca",     title: "Invoca tus deseos",     tier: 1, icon: "ti-sparkles", hours: "3h 20m",
      lessons: ["Tu porqué", "Visualización con acción", "Metas claras", "Creencias", "Gratitud", "Afirmaciones útiles", "Obstáculos", "Tu mapa"] },
    { id: "espiritual", title: "Modo monje espiritual", tier: 2, icon: "ti-sun",      hours: "3h 00m",
      lessons: ["Atención plena", "Silencio", "Respiración", "Desapego", "Propósito", "Práctica diaria"] },
    { id: "identidad",  title: "Identidad heroica",     tier: 3, icon: "ti-helmet",   hours: "3h 00m",
      lessons: ["Quién eres", "Valores", "Historia personal", "Coherencia", "El héroe que eliges ser"] },
  ]},
  { id: "love", name: "Relaciones", icon: "ti-heart", color: "#C0729E", courses: [
    { id: "love",    title: "Heroes Love",       tier: 1, icon: "ti-heart",        hours: "5h 00m",
      lessons: ["Amor propio primero", "Comunicación en pareja", "Lenguajes del amor", "Conflictos sanos", "Confianza", "Citas con intención", "Límites", "Celos", "Crecer juntos", "Rupturas", "Tu relación ideal"] },
    { id: "amistad", title: "Amistad de hierro", tier: 2, icon: "ti-users-group",  hours: "2h 30m",
      lessons: ["El valor de la amistad", "Hacer amigos de adulto", "Mantener el contacto", "Ser buen amigo", "Tu círculo"] },
  ]},
];

const COURSES = BRANCHES.flatMap(b =>
  b.courses.map(c => ({
    ...c,
    branchId: b.id,
    branchName: b.name,
    color: b.color,
    lessons: c.lessons.map((title, i) => ({
      n: i + 1,
      title,
      available: Boolean(LESSONS[`${c.id}:${i + 1}`]),
    })),
  }))
);

const getCourse = id => COURSES.find(c => c.id === id);
const getLesson = (courseId, n) => LESSONS[`${courseId}:${n}`] || null;

// ── Librería ──────────────────────────────────────────────
const RESOURCES = [
  { id: "codigo-guerrero",   title: "El código del guerrero",   type: "Libro",    branch: "Disciplina", icon: "ti-book",        color: "#7B5EA7",
    summary: "Principios del Bushido aplicados a la vida moderna: honor, disciplina y constancia." },
  { id: "deep-work-mc",      title: "Deep work · masterclass",  type: "Video",    branch: "Mente",      icon: "ti-player-play", color: "#C0392B",
    summary: "Cómo diseñar bloques de concentración profunda y proteger tu atención." },
  { id: "morning-routine",   title: "Protocolo morning routine",type: "Guía PDF", branch: "Disciplina", icon: "ti-file-text",   color: "#E67E22",
    summary: "Checklist paso a paso para una mañana que te pone en modo héroe." },
  { id: "meditacion-heroe",  title: "Meditación del héroe",     type: "Audio",    branch: "Mentalidad", icon: "ti-headphones",  color: "#2BBFA0",
    summary: "Meditación guiada de 10 minutos para calmar la mente antes de actuar." },
  { id: "estoicismo",        title: "Estoicismo aplicado",      type: "Libro",    branch: "Mentalidad", icon: "ti-book",        color: "#C9A84C",
    summary: "Epicteto, Séneca y Marco Aurelio traducidos a decisiones del día a día." },
  { id: "nutricion",         title: "Nutrición legendaria",     type: "Guía PDF", branch: "Cuerpo",     icon: "ti-file-text",   color: "#C0392B",
    summary: "Proteína, plato equilibrado e hidratación sin dietas extremas." },
  { id: "comunicacion-poder",title: "Comunicación de poder",    type: "Video",    branch: "Social",     icon: "ti-player-play", color: "#2BBFA0",
    summary: "Voz, pausas y presencia para que te escuchen de verdad." },
  { id: "mentalidad-campeon",title: "Mentalidad de campeón",    type: "Audio",    branch: "Mentalidad", icon: "ti-headphones",  color: "#7B5EA7",
    summary: "Cómo piensan los atletas de élite ante la presión y el fracaso." },
];

// ── Badges ────────────────────────────────────────────────
// check(stats) → boolean. stats se construye en server.js (buildStats).
const BADGES = [
  { id: "primer_paso", name: "Primer paso",  icon: "ti-shoe", xp: 50,   desc: "Completa tu primera lección",            check: s => s.lessons >= 1 },
  { id: "invocador",   name: "Invocador",    icon: "ti-sparkles",   xp: 500,  desc: "Domina el curso Invoca tus deseos",      check: s => s.coursesDone.includes("invoca") },
  { id: "atleta",      name: "Atleta",       icon: "ti-barbell",    xp: 300,  desc: "Completa 10 lecciones",                  check: s => s.lessons >= 10 },
  { id: "erudito",     name: "Erudito",      icon: "ti-books",      xp: 200,  desc: "Completa 5 recursos de la librería",     check: s => s.resources >= 5 },
  { id: "voz_heroica", name: "Voz heroica",  icon: "ti-speakerphone", xp: 100, desc: "Publica 5 avances en la comunidad",     check: s => s.posts >= 5 },
  { id: "monje_b",     name: "Monje",        icon: "ti-peace",      xp: 200,  desc: "Mantén una racha de 7 días",             check: s => s.recordStreak >= 7 },
  { id: "constante",   name: "Constante",    icon: "ti-flame",      xp: 1000, desc: "Mantén una racha de 30 días",            check: s => s.recordStreak >= 30 },
  { id: "heroe_r",     name: "Rango Héroe",  icon: "ti-helmet",     xp: 500,  desc: "Alcanza 5,000 XP",                       check: s => s.xp >= 5000 },
  { id: "leyenda_b",   name: "Leyenda",      icon: "ti-crown",      xp: 1000, desc: "Alcanza 15,000 XP",                      check: s => s.xp >= 15000 },
  { id: "inmortal",    name: "Inmortal",     icon: "ti-star",       xp: 5000, desc: "Alcanza 50,000 XP",                      check: s => s.xp >= 50000 },
];

// ── Misiones diarias ──────────────────────────────────────
// "habit" y "surprise" se marcan a mano. "advance" se completa sola al terminar una lección del curso.
const HABIT_MISSIONS = [
  { type: "habit",    title: "20 minutos de meditación activa",       branch: "Disciplina", xp: 50,  icon: "ti-flame"  },
  { type: "habit",    title: "Lectura de 15 páginas",                 branch: "Mente",      xp: 50,  icon: "ti-book"   },
  { type: "habit",    title: "Escribe 3 cosas que agradeces hoy",     branch: "Mentalidad", xp: 50,  icon: "ti-pencil" },
  { type: "habit",    title: "30 minutos de entrenamiento",           branch: "Cuerpo",     xp: 50,  icon: "ti-barbell"},
  { type: "habit",    title: "Escribe a un amigo que no ves hace tiempo", branch: "Relaciones", xp: 50, icon: "ti-message-heart" },
  { type: "habit",    title: "Acuéstate antes de las 23:00",          branch: "Disciplina", xp: 50,  icon: "ti-moon"   },
  { type: "surprise", title: "Sal a caminar 30 minutos sin teléfono", branch: "Cuerpo",     xp: 150, icon: "ti-walk"   },
  { type: "surprise", title: "Una hora completa sin redes sociales",  branch: "Disciplina", xp: 150, icon: "ti-device-mobile-off" },
];

module.exports = {
  XP_SOURCES, RANKS, BRANCHES, COURSES, RESOURCES, BADGES, HABIT_MISSIONS,
  getCourse, getLesson,
};
