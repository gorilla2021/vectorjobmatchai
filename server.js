require('dotenv').config();
const express = require('express');
const session = require('express-session');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { sendVerificationEmail } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Resume text extraction
async function extractResumeText(filePath, mimetype) {
  if (mimetype === 'application/pdf') {
    const pdfParse = require('pdf-parse');
    const buffer = fs.readFileSync(filePath);
    const data = await pdfParse(buffer);
    return data.text;
  }
  if (mimetype === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const mammoth = require('mammoth');
    const result = await mammoth.extractRawText({ path: filePath });
    return result.value;
  }
  // plain text
  return fs.readFileSync(filePath, 'utf8');
}

// Multer — resume uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, 'uploads')),
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

app.use(express.json({ limit: '2mb' }));
app.use(express.urlencoded({ extended: true }));
app.set('trust proxy', 1);
app.use(session({
  secret: process.env.SESSION_SECRET || 'vm-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 7 * 24 * 60 * 60 * 1000,
    secure: process.env.NODE_ENV === 'production',
    sameSite: process.env.NODE_ENV === 'production' ? 'none' : 'lax',
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

// ── Auth middleware ──────────────────────────────────────────────
function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.redirect('/');
}

// ── Routes ───────────────────────────────────────────────────────

// Register
app.post('/api/register', upload.single('resume'), async (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name || !email || !phone || !req.file) {
    return res.status(400).json({ error: 'All fields and resume are required.' });
  }

  let resumeText = '';
  try {
    resumeText = await extractResumeText(req.file.path, req.file.mimetype);
  } catch (e) {
    resumeText = '';
  }

  const token = uuidv4();
  try {
    const existing = db.prepare('SELECT id, verified FROM users WHERE email = ?').get(email);
    if (existing) {
      if (existing.verified) return res.status(400).json({ error: 'This email is already registered and verified. Please go back and use the tool.' });
      // Resend verification
      db.prepare('UPDATE users SET verify_token=?, full_name=?, phone=?, resume_filename=?, resume_text=? WHERE email=?')
        .run(token, full_name, phone, req.file.filename, resumeText, email);
    } else {
      db.prepare('INSERT INTO users (full_name, email, phone, resume_filename, resume_text, verify_token) VALUES (?,?,?,?,?,?)')
        .run(full_name, email, phone, req.file.filename, resumeText, token);
    }
    if (process.env.SKIP_EMAIL !== 'true') {
      await sendVerificationEmail(email, full_name, token, BASE_URL);
    }
    res.json({ ok: true, token: process.env.SKIP_EMAIL === 'true' ? token : undefined });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Verify email
app.get('/verify', (req, res) => {
  const { token } = req.query;
  const user = db.prepare('SELECT * FROM users WHERE verify_token = ?').get(token);
  if (!user) return res.redirect('/?error=invalid-token');
  db.prepare('UPDATE users SET verified=1, verify_token=NULL WHERE id=?').run(user.id);
  req.session.userId = user.id;
  res.redirect('/dashboard.html');
});

// Resend / magic login link
app.post('/api/resend-verification', async (req, res) => {
  const { email } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'No account found with that email. Please register first.' });
  const token = uuidv4();
  db.prepare('UPDATE users SET verify_token=? WHERE id=?').run(token, user.id);
  try {
    await sendVerificationEmail(email, user.full_name, token, BASE_URL);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to send email: ' + e.message });
  }
});

// Session check
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, full_name, email, resume_text FROM users WHERE id=?').get(req.session.userId);
  res.json(user);
});

// Logout
app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// AI Analysis
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { job_description } = req.body;
  if (!job_description) return res.status(400).json({ error: 'Job description required.' });

  const user = db.prepare('SELECT * FROM users WHERE id=?').get(req.session.userId);
  if (!user.resume_text) return res.status(400).json({ error: 'No resume text found. Please re-register with your resume.' });

  const resumeText = (user.resume_text || '').substring(0, 4000);
  const jdText = job_description.substring(0, 3000);
  const prompt = buildPrompt(resumeText, jdText);

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 55000);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timeout);

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const raw = data.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    const result = JSON.parse(raw);

    db.prepare('INSERT INTO analyses (user_id, job_description, result_json) VALUES (?,?,?)')
      .run(user.id, job_description, JSON.stringify(result));

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

function buildPrompt(resumeText, jobDescription) {
  return `You are a professional career coach and resume expert. Analyze the candidate's resume against the job description with strict accuracy.

RULES:
1. Only reference skills/requirements EXPLICITLY stated in the job description. Never infer or add from outside knowledge.
2. Distinguish required vs. preferred/bonus qualifications — missing preferred items are NOT gaps.
3. Support ALL career backgrounds (IT, non-IT, healthcare, finance, education, etc.).
4. Use exact wording from the job description when citing requirements.
5. The roadmap must be realistic, specific, and tailored to THIS candidate's actual gaps.

JOB DESCRIPTION:
${jobDescription}

CANDIDATE RESUME:
${resumeText}

Return ONLY valid JSON (no markdown, no code blocks):
{
  "score": <0-100>,
  "verdict": "<one sentence overall assessment>",
  "fit_level": "<Poor Fit | Partial Fit | Strong Fit | Exceptional Fit>",
  "match_breakdown": [
    { "label": "<skill or requirement>", "status": "match|partial|gap", "detail": "<detail using JD wording>" }
  ],
  "missing_skills": [
    { "skill": "<skill name>", "importance": "required|preferred", "how_to_close": "<specific action to close this gap>" }
  ],
  "ats_risk": {
    "score": "<Low|Medium|High>",
    "explanation": "<2-3 sentences on ATS keyword density, formatting, and scanability issues>",
    "issues": ["<specific issue 1>", "<specific issue 2>"]
  },
  "resume_improvements": [
    { "section": "<Resume section>", "issue": "<what's weak>", "suggestion": "<specific rewrite or fix>" }
  ],
  "roadmap": {
    "summary": "<2 sentences on the overall plan>",
    "days_1_30": [
      { "action": "<specific action>", "why": "<why this helps for this job>" }
    ],
    "days_31_60": [
      { "action": "<specific action>", "why": "<why this helps>" }
    ],
    "days_61_90": [
      { "action": "<specific action>", "why": "<why this helps>" }
    ]
  },
  "recommendation": "<3-4 sentences recruiter-facing summary>"
}`;
}

// ── Admin Routes ─────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vectormatch-admin-2025';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'vm-admin-token-secret';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ token: ADMIN_TOKEN });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, full_name, email, phone, resume_filename, verified, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

app.get('/api/admin/analyses', requireAdmin, (req, res) => {
  const analyses = db.prepare(`
    SELECT a.id, a.job_description, a.result_json, a.created_at,
           u.full_name, u.email
    FROM analyses a JOIN users u ON a.user_id = u.id
    ORDER BY a.created_at DESC
  `).all();
  res.json({ analyses });
});

app.get('/api/admin/export/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, full_name, email, phone, verified, created_at FROM users ORDER BY created_at DESC').all();
  const csv = ['ID,Full Name,Email,Phone,Verified,Registered']
    .concat(users.map(u => `${u.id},"${u.full_name}","${u.email}","${u.phone}",${u.verified ? 'Yes' : 'No'},"${u.created_at}"`))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vectormatch-users.csv"');
  res.send(csv);
});

app.get('/api/admin/export/analyses', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT a.id, u.full_name, u.email, a.job_description, a.result_json, a.created_at
    FROM analyses a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC
  `).all();
  const csv = ['ID,User,Email,Score,Fit Level,Job Description (first 200 chars),Date']
    .concat(rows.map(r => {
      let score = '', fit = '';
      try { const j = JSON.parse(r.result_json); score = j.score; fit = j.fit_level || ''; } catch(e){}
      const jd = r.job_description.replace(/"/g, '""').substring(0, 200);
      return `${r.id},"${r.full_name}","${r.email}",${score},"${fit}","${jd}","${r.created_at}"`;
    }))
    .join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vectormatch-analyses.csv"');
  res.send(csv);
});

app.listen(PORT, () => console.log(`VectorMatch AI running at ${BASE_URL}`));
