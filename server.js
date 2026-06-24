require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const { pool, initDb } = require('./db');
const { sendVerificationEmail, sendMagicLinkEmail } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

async function extractResumeText(filePath, mimetype) {
  try {
    if (mimetype === 'application/pdf') {
      const pdfParse = require('pdf-parse');
      const buffer = fs.readFileSync(filePath);
      const data = await pdfParse(buffer);
      return data.text;
    }
    if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
        filePath.endsWith('.docx')) {
      const mammoth = require('mammoth');
      const result = await mammoth.extractRawText({ path: filePath });
      return result.value;
    }
    return fs.readFileSync(filePath, 'utf8');
  } catch(e) {
    return '';
  }
}

const uploadsDir = path.join(__dirname, 'uploads');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.txt'];
    if (allowed.includes(path.extname(file.originalname).toLowerCase())) cb(null, true);
    else cb(new Error('Only PDF, DOC, DOCX, or TXT files allowed'));
  },
});

app.set('trust proxy', 1);
app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: process.env.SESSION_SECRET || 'vm-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));

const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const authLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Too many requests. Try again in an hour.' } });

app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Please sign in to continue.' });
}

// ── Check email ──────────────────────────────────────────────────
app.post('/api/check-email', authLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });
  try {
    const { rows } = await pool.query('SELECT id, full_name, phone, verified FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.json({ status: 'new' });
    const user = rows[0];
    const { rows: resumeRows } = await pool.query(
      'SELECT id, original_name FROM resumes WHERE user_id = $1 AND is_active = 1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );
    res.json({
      status: 'returning',
      full_name: user.full_name,
      phone: user.phone,
      verified: user.verified,
      resume: resumeRows.length ? { id: resumeRows[0].id, name: resumeRows[0].original_name } : null,
    });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Register ─────────────────────────────────────────────────────
app.post('/api/register', authLimiter, upload.single('resume'), async (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name || !email || !phone || !req.file)
    return res.status(400).json({ error: 'All fields and resume are required.' });

  const resumeText = await extractResumeText(req.file.path, req.file.mimetype);
  const token = uuidv4();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (full_name, email, phone, magic_token, token_expires) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [full_name, email, phone, token, expires]
    );
    await pool.query(
      'INSERT INTO resumes (user_id, filename, original_name, resume_text) VALUES ($1,$2,$3,$4)',
      [rows[0].id, req.file.filename, req.file.originalname, resumeText]
    );
    if (process.env.SKIP_EMAIL === 'true') return res.json({ ok: true, token });
    await sendVerificationEmail(email, full_name, token, BASE_URL);
    res.json({ ok: true });
  } catch(e) {
    if (e.message && (e.message.includes('UNIQUE') || e.message.includes('unique')))
      return res.status(400).json({ error: 'This email is already registered. Please use the sign-in option instead.' });
    res.status(500).json({ error: e.message });
  }
});

// ── Send magic link (returning user) ─────────────────────────────
app.post('/api/send-magic-link', authLimiter, upload.single('resume'), async (req, res) => {
  const { email, full_name, phone } = req.body;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (!rows.length) return res.status(404).json({ error: 'User not found.' });
    const user = rows[0];

    await pool.query(
      "UPDATE users SET full_name=$1, phone=$2, updated_at=to_char(now(),'YYYY-MM-DD HH24:MI:SS') WHERE id=$3",
      [full_name || user.full_name, phone || user.phone, user.id]
    );

    if (req.file) {
      const resumeText = await extractResumeText(req.file.path, req.file.mimetype);
      await pool.query('UPDATE resumes SET is_active=0 WHERE user_id=$1', [user.id]);
      await pool.query(
        'INSERT INTO resumes (user_id, filename, original_name, resume_text) VALUES ($1,$2,$3,$4)',
        [user.id, req.file.filename, req.file.originalname, resumeText]
      );
    }

    const token = uuidv4();
    const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    await pool.query('UPDATE users SET magic_token=$1, token_expires=$2 WHERE id=$3', [token, expires, user.id]);

    if (process.env.SKIP_EMAIL === 'true') return res.json({ ok: true, token });
    try {
      await sendMagicLinkEmail(email, user.full_name, token, BASE_URL);
      res.json({ ok: true });
    } catch(e) {
      console.error('Email failed:', e.message);
      return res.json({ ok: true, token });
    }
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── Verify token ─────────────────────────────────────────────────
app.get('/verify', async (req, res) => {
  const { token } = req.query;
  try {
    const { rows } = await pool.query('SELECT * FROM users WHERE magic_token = $1', [token]);
    if (!rows.length) return res.redirect('/?error=invalid-token');
    const user = rows[0];
    if (user.token_expires && new Date(user.token_expires) < new Date())
      return res.redirect('/?error=expired-token');
    await pool.query('UPDATE users SET verified=1, magic_token=NULL, token_expires=NULL WHERE id=$1', [user.id]);
    req.session.userId = user.id;
    res.redirect('/dashboard.html');
  } catch(e) { res.redirect('/?error=server-error'); }
});

// ── Me ───────────────────────────────────────────────────────────
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, full_name, email, phone FROM users WHERE id=$1', [req.session.userId]);
    const { rows: rr } = await pool.query(
      'SELECT id, original_name, created_at FROM resumes WHERE user_id=$1 AND is_active=1 ORDER BY created_at DESC LIMIT 1',
      [req.session.userId]
    );
    res.json({ ...rows[0], resume: rr[0] || null });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.post('/api/logout', (req, res) => req.session.destroy(() => res.json({ ok: true })));

// ── Analysis history ─────────────────────────────────────────────
app.get('/api/analyses', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.job_title, a.score, a.created_at, r.original_name as resume_name
      FROM analyses a LEFT JOIN resumes r ON a.resume_id = r.id
      WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 20
    `, [req.session.userId]);
    res.json({ analyses: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/analyses/:id', requireAuth, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT * FROM analyses WHERE id=$1 AND user_id=$2', [req.params.id, req.session.userId]);
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    res.json({ ...rows[0], result: JSON.parse(rows[0].result_json) });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// ── AI Analysis ──────────────────────────────────────────────────
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { job_description } = req.body;
  if (!job_description) return res.status(400).json({ error: 'Job description required.' });

  try {
    const { rows } = await pool.query(
      'SELECT * FROM resumes WHERE user_id=$1 AND is_active=1 ORDER BY created_at DESC LIMIT 1',
      [req.session.userId]
    );
    if (!rows.length || !rows[0].resume_text)
      return res.status(400).json({ error: 'No resume found. Please upload your resume first.' });

    const resume = rows[0];
    const prompt = buildPrompt(resume.resume_text.substring(0, 4000), job_description.substring(0, 3000));

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 6000, messages: [{ role: 'user', content: prompt }] }),
    });
    clearTimeout(timeout);

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const raw = data.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    let result;
    try { result = JSON.parse(raw); }
    catch(e) { return res.status(500).json({ error: 'AI returned an unexpected response. Please try again.' }); }

    const jobTitle = job_description.split('\n')[0].substring(0, 100).trim() || 'Analysis';
    await pool.query(
      'INSERT INTO analyses (user_id, resume_id, job_description, job_title, result_json, score) VALUES ($1,$2,$3,$4,$5,$6)',
      [req.session.userId, resume.id, job_description, jobTitle, JSON.stringify(result), result.score || 0]
    );
    res.json(result);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

function buildPrompt(resumeText, jobDescription) {
  return `You are a professional career coach and resume expert. Analyze the candidate's resume against the job description with strict accuracy.

RULES:
1. Only reference skills/requirements EXPLICITLY stated in the job description.
2. Distinguish required vs. preferred qualifications.
3. Support ALL career backgrounds.
4. Use exact wording from the job description when citing requirements.
5. The roadmap must be realistic and tailored to THIS candidate's actual gaps.

JOB DESCRIPTION:
${jobDescription}

CANDIDATE RESUME:
${resumeText}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "score": <0-100>,
  "verdict": "<one sentence overall assessment>",
  "fit_level": "<Poor Fit | Partial Fit | Strong Fit | Exceptional Fit>",
  "match_breakdown": [{ "label": "<skill>", "status": "match|partial|gap", "detail": "<detail>" }],
  "missing_skills": [{ "skill": "<name>", "importance": "required|preferred", "how_to_close": "<action>" }],
  "ats_risk": { "score": "<Low|Medium|High>", "explanation": "<2-3 sentences>", "issues": ["<issue>"] },
  "resume_improvements": [{ "section": "<section>", "issue": "<what is weak>", "suggestion": "<fix>" }],
  "roadmap": {
    "summary": "<2 sentences>",
    "days_1_30": [{ "action": "<action>", "why": "<why>" }],
    "days_31_60": [{ "action": "<action>", "why": "<why>" }],
    "days_61_90": [{ "action": "<action>", "why": "<why>" }]
  },
  "recommendation": "<3-4 sentences>"
}`;
}

// ── Admin ────────────────────────────────────────────────────────
function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'];
  if (token !== (process.env.ADMIN_TOKEN || 'vm-admin-token-secret')) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', adminLimiter, (req, res) => {
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vectormatch-admin-2025';
  const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'vm-admin-token-secret';
  if (req.body.password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ token: ADMIN_TOKEN });
});

app.get('/api/admin/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, full_name, email, phone, verified, created_at FROM users ORDER BY created_at DESC');
    res.json({ users: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/analyses', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, a.job_title, a.job_description, a.score, a.result_json, a.created_at,
             u.full_name, u.email, r.original_name as resume_name
      FROM analyses a JOIN users u ON a.user_id = u.id
      LEFT JOIN resumes r ON a.resume_id = r.id ORDER BY a.created_at DESC
    `);
    res.json({ analyses: rows });
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/export/users', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query('SELECT id, full_name, email, phone, verified, created_at FROM users ORDER BY created_at DESC');
    const csv = ['ID,Full Name,Email,Phone,Verified,Registered']
      .concat(rows.map(u => `${u.id},"${u.full_name}","${u.email}","${u.phone}",${u.verified ? 'Yes' : 'No'},"${u.created_at}"`))
      .join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="vectormatch-users.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

app.get('/api/admin/export/analyses', requireAdmin, async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT a.id, u.full_name, u.email, a.job_title, a.score, a.job_description, a.created_at
      FROM analyses a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC
    `);
    const csv = ['ID,User,Email,Job Title,Score,Job Description (200 chars),Date']
      .concat(rows.map(r => {
        const jd = (r.job_description || '').replace(/"/g, '""').substring(0, 200);
        return `${r.id},"${r.full_name}","${r.email}","${r.job_title || ''}",${r.score},"${jd}","${r.created_at}"`;
      })).join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="vectormatch-analyses.csv"');
    res.send(csv);
  } catch(e) { res.status(500).json({ error: e.message }); }
});

// Global error handler
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File exceeds maximum size limit of 5MB.' });
  if (err.message && err.message.includes('Only PDF')) return res.status(400).json({ error: 'Unsupported file type. Please upload PDF, DOC, DOCX, or TXT.' });
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

// ── Start ────────────────────────────────────────────────────────
if (require.main === module) {
  initDb(pool)
    .then(() => app.listen(PORT, () => console.log(`VectorMatch AI running at ${BASE_URL}`)))
    .catch(err => { console.error('DB init failed:', err.message); process.exit(1); });
}

module.exports = app;
