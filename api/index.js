// Vercel: todas las rutas /api/* llegan a esta función (ver vercel.json), que ejecuta la app Express.
module.exports = require("../server").app;
