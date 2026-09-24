/**
 * HeroPath — conexión a Postgres
 * - Con DATABASE_URL (Supabase u otro Postgres): usa el driver "pg".
 * - Sin DATABASE_URL: usa PGlite (Postgres embebido) guardado en DATA_DIR. Ideal para desarrollo y tests.
 * En ambos casos aplica supabase/schema.sql al arrancar.
 */

const fs = require("fs");
const path = require("path");

const SCHEMA = fs.readFileSync(path.join(__dirname, "supabase", "schema.sql"), "utf8");

let client = null;
let ready = null;

async function connect() {
  if (process.env.DATABASE_URL) {
    const { Pool } = require("pg");
    const url = process.env.DATABASE_URL;
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url) || /sslmode=disable/.test(url);
    const pool = new Pool({
      connectionString: url,
      ssl: local ? false : { rejectUnauthorized: false },
      max: Number(process.env.DB_POOL_MAX) || 3, // pocas conexiones: en Vercel cada función abre su propio pool
    });
    client = { query: (text, params) => pool.query(text, params), exec: sql => pool.query(sql), end: () => pool.end() };
  } else {
    const { PGlite } = await import("@electric-sql/pglite");
    const dir = process.env.DATA_DIR || path.join(__dirname, "data");
    fs.mkdirSync(dir, { recursive: true });
    const pg = new PGlite(path.join(dir, "pglite"));
    client = { query: (text, params) => pg.query(text, params), exec: sql => pg.exec(sql), end: () => pg.close() };
  }
  await client.exec(SCHEMA);
}

/** Espera a que la base esté lista (conexión + esquema). Se llama una vez por arranque. */
function init() {
  if (!ready) ready = connect().catch(err => { ready = null; throw err; });
  return ready;
}

async function query(text, params = []) {
  await init();
  return client.query(text, params);
}

const many = async (text, params) => (await query(text, params)).rows;
const one = async (text, params) => (await query(text, params)).rows[0] || null;

async function close() {
  if (client) await client.end();
  client = null;
  ready = null;
}

module.exports = { init, query, many, one, close };
