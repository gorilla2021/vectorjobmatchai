const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');

const dataDir = path.join(__dirname, 'data');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const db = new Database(path.join(dataDir, 'vectormatch.db'));

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    full_name TEXT NOT NULL,
    email TEXT UNIQUE NOT NULL,
    phone TEXT NOT NULL,
    verified INTEGER DEFAULT 0,
    magic_token TEXT,
    token_expires TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS resumes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    filename TEXT NOT NULL,
    original_name TEXT NOT NULL,
    resume_text TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    resume_id INTEGER,
    job_description TEXT NOT NULL,
    job_title TEXT,
    result_json TEXT NOT NULL,
    score INTEGER,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (resume_id) REFERENCES resumes(id)
  );
`);

// Migrate existing data if resumes table was just created
try {
  const cols = db.prepare("PRAGMA table_info(users)").all().map(c => c.name);
  if (cols.includes('resume_filename')) {
    const users = db.prepare("SELECT id, resume_filename, resume_text FROM users WHERE resume_filename IS NOT NULL").all();
    const insertResume = db.prepare("INSERT OR IGNORE INTO resumes (user_id, filename, original_name, resume_text) VALUES (?,?,?,?)");
    users.forEach(u => insertResume.run(u.id, u.resume_filename, u.resume_filename, u.resume_text));
  }
} catch(e) {}

module.exports = db;
