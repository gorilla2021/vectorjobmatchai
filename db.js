const path = require('path');
const fs = require('fs');

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

async function initDb(pool) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      full_name TEXT NOT NULL,
      email TEXT UNIQUE NOT NULL,
      phone TEXT NOT NULL,
      verified INTEGER DEFAULT 0,
      magic_token TEXT,
      token_expires TEXT,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS'),
      updated_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS resumes (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      filename TEXT NOT NULL,
      original_name TEXT NOT NULL,
      resume_text TEXT,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
    );
    CREATE TABLE IF NOT EXISTS analyses (
      id SERIAL PRIMARY KEY,
      user_id INTEGER NOT NULL REFERENCES users(id),
      resume_id INTEGER REFERENCES resumes(id),
      job_description TEXT NOT NULL,
      job_title TEXT,
      result_json TEXT NOT NULL,
      score INTEGER,
      created_at TEXT DEFAULT to_char(now(),'YYYY-MM-DD HH24:MI:SS')
    );
  `);
}

const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

module.exports = { pool, initDb };
