/**
 * HeroPath — Contenido de lecciones (un archivo por rama)
 * Clave: "<courseId>:<número de lección>". Las lecciones que no están aquí aparecen como "Próximamente".
 *
 * Estructura:
 *   title, subtitle, duration, learn[], summary[]
 *   sections[]: { type: "intro"|"concept"|"quote"|"rules"|"tip", ... }
 *   challenge: { title, desc, steps[] }
 *   exam[]: { q, opts[], correct, exp }   ← "correct" nunca se envía al cliente
 */

module.exports = {
  ...require("./cuerpo"),
  ...require("./mente"),
  ...require("./social"),
  ...require("./disciplina"),
  ...require("./mentalidad"),
  ...require("./relaciones"),
};
