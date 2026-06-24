require('dotenv').config();
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const fetch = require('node-fetch');
const { v4: uuidv4 } = require('uuid');
const db = require('./db');
const { sendVerificationEmail, sendMagicLinkEmail } = require('./mailer');

const app = express();
const PORT = process.env.PORT || 3000;
const BASE_URL = process.env.BASE_URL || `http://localhost:${PORT}`;

// Resume text extraction
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

// Multer
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

// Rate limiting
const adminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: { error: 'Too many attempts. Try again in 15 minutes.' } });
const authLimiter  = rateLimit({ windowMs: 60 * 60 * 1000, max: 20, message: { error: 'Too many requests. Try again in an hour.' } });
app.use(express.static(path.join(__dirname, 'public')));


function requireAuth(req, res, next) {
  if (req.session.userId) return next();
  res.status(401).json({ error: 'Please sign in to continue.' });
}

// ── Check email (step 1) ─────────────────────────────────────────
app.post('/api/check-email', authLimiter, (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required.' });
  const user = db.prepare('SELECT id, full_name, phone, verified FROM users WHERE email = ?').get(email);
  if (!user) return res.json({ status: 'new' });
  const activeResume = db.prepare('SELECT id, original_name FROM resumes WHERE user_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(user.id);
  res.json({
    status: 'returning',
    full_name: user.full_name,
    phone: user.phone,
    verified: user.verified,
    resume: activeResume ? { id: activeResume.id, name: activeResume.original_name } : null,
  });
});

// ── Register (new user) ──────────────────────────────────────────
app.post('/api/register', authLimiter, upload.single('resume'), async (req, res) => {
  const { full_name, email, phone } = req.body;
  if (!full_name || !email || !phone || !req.file) {
    return res.status(400).json({ error: 'All fields and resume are required.' });
  }
  const resumeText = await extractResumeText(req.file.path, req.file.mimetype);
  const token = uuidv4();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  try {
    db.prepare('INSERT INTO users (full_name, email, phone, magic_token, token_expires) VALUES (?,?,?,?,?)')
      .run(full_name, email, phone, token, expires);
    const userId = db.prepare('SELECT id FROM users WHERE email = ?').get(email).id;
    db.prepare('INSERT INTO resumes (user_id, filename, original_name, resume_text) VALUES (?,?,?,?)')
      .run(userId, req.file.filename, req.file.originalname, resumeText);
    if (process.env.SKIP_EMAIL === 'true') {
      return res.json({ ok: true, token });
    }
    await sendVerificationEmail(email, full_name, token, BASE_URL);
    res.json({ ok: true });
  } catch (e) {
    if (e.message && e.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'This email is already registered. Please use the sign-in option instead.' });
    }
    res.status(500).json({ error: e.message });
  }
});

// ── Returning user — send magic link ────────────────────────────
app.post('/api/send-magic-link', authLimiter, upload.single('resume'), async (req, res) => {
  const { email, full_name, phone, use_existing_resume } = req.body;
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (!user) return res.status(404).json({ error: 'User not found.' });

  db.prepare('UPDATE users SET full_name=?, phone=?, updated_at=datetime("now") WHERE id=?')
    .run(full_name || user.full_name, phone || user.phone, user.id);

  if (req.file) {
    const resumeText = await extractResumeText(req.file.path, req.file.mimetype);
    db.prepare('UPDATE resumes SET is_active=0 WHERE user_id=?').run(user.id);
    db.prepare('INSERT INTO resumes (user_id, filename, original_name, resume_text) VALUES (?,?,?,?)')
      .run(user.id, req.file.filename, req.file.originalname, resumeText);
  }

  const token = uuidv4();
  const expires = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
  db.prepare('UPDATE users SET magic_token=?, token_expires=? WHERE id=?').run(token, expires, user.id);

  if (process.env.SKIP_EMAIL === 'true') {
    return res.json({ ok: true, token });
  }
  try {
    await sendMagicLinkEmail(email, user.full_name, token, BASE_URL);
    res.json({ ok: true });
  } catch(e) {
    res.status(500).json({ error: 'Failed to send email: ' + e.message });
  }
});

// ── Verify / magic link ──────────────────────────────────────────
app.get('/verify', (req, res) => {
  const { token } = req.query;
  const user = db.prepare('SELECT * FROM users WHERE magic_token = ?').get(token);
  if (!user) return res.redirect('/?error=invalid-token');
  if (user.token_expires && new Date(user.token_expires) < new Date()) {
    return res.redirect('/?error=expired-token');
  }
  db.prepare('UPDATE users SET verified=1, magic_token=NULL, token_expires=NULL WHERE id=?').run(user.id);
  req.session.userId = user.id;
  res.redirect('/dashboard.html');
});

// ── Session / me ─────────────────────────────────────────────────
app.get('/api/me', requireAuth, (req, res) => {
  const user = db.prepare('SELECT id, full_name, email, phone FROM users WHERE id=?').get(req.session.userId);
  const resume = db.prepare('SELECT id, original_name, created_at FROM resumes WHERE user_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1').get(req.session.userId);
  res.json({ ...user, resume });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

// ── Analysis history ─────────────────────────────────────────────
app.get('/api/analyses', requireAuth, (req, res) => {
  const analyses = db.prepare(`
    SELECT a.id, a.job_title, a.score, a.created_at, r.original_name as resume_name
    FROM analyses a
    LEFT JOIN resumes r ON a.resume_id = r.id
    WHERE a.user_id = ?
    ORDER BY a.created_at DESC
    LIMIT 20
  `).all(req.session.userId);
  res.json({ analyses });
});

app.get('/api/analyses/:id', requireAuth, (req, res) => {
  const analysis = db.prepare('SELECT * FROM analyses WHERE id=? AND user_id=?').get(req.params.id, req.session.userId);
  if (!analysis) return res.status(404).json({ error: 'Not found' });
  res.json({ ...analysis, result: JSON.parse(analysis.result_json) });
});

// ── AI Analysis ──────────────────────────────────────────────────
app.post('/api/analyze', requireAuth, async (req, res) => {
  const { job_description } = req.body;
  if (!job_description) return res.status(400).json({ error: 'Job description required.' });

  const resume = db.prepare('SELECT * FROM resumes WHERE user_id=? AND is_active=1 ORDER BY created_at DESC LIMIT 1').get(req.session.userId);
  if (!resume || !resume.resume_text) return res.status(400).json({ error: 'No resume found. Please upload your resume first.' });

  const resumeText = resume.resume_text.substring(0, 4000);
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
        max_tokens: 6000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    clearTimeout(timeout);

    const data = await response.json();
    if (data.error) return res.status(500).json({ error: data.error.message || JSON.stringify(data.error) });

    const raw = data.content[0].text.replace(/```json/g, '').replace(/```/g, '').trim();
    let result;
    try { result = JSON.parse(raw); }
    catch(e) { return res.status(500).json({ error: 'AI returned an unexpected response. Please try again.' }); }

    const jobTitle = job_description.split('\n')[0].substring(0, 100).trim() || 'Analysis';
    db.prepare('INSERT INTO analyses (user_id, resume_id, job_description, job_title, result_json, score) VALUES (?,?,?,?,?,?)')
      .run(req.session.userId, resume.id, job_description, jobTitle, JSON.stringify(result), result.score || 0);

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
    { "skill": "<skill name>", "importance": "required|preferred", "how_to_close": "<specific action>" }
  ],
  "ats_risk": {
    "score": "<Low|Medium|High>",
    "explanation": "<2-3 sentences on ATS keyword density and formatting>",
    "issues": ["<issue 1>", "<issue 2>"]
  },
  "resume_improvements": [
    { "section": "<Resume section>", "issue": "<what is weak>", "suggestion": "<specific fix>" }
  ],
  "roadmap": {
    "summary": "<2 sentences on the overall plan>",
    "days_1_30": [{ "action": "<action>", "why": "<why this helps>" }],
    "days_31_60": [{ "action": "<action>", "why": "<why this helps>" }],
    "days_61_90": [{ "action": "<action>", "why": "<why this helps>" }]
  },
  "recommendation": "<3-4 sentences recruiter-facing summary>"
}`;
}

// ── Admin ────────────────────────────────────────────────────────
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'vectormatch-admin-2025';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || 'vm-admin-token-secret';

function requireAdmin(req, res, next) {
  const token = req.headers['x-admin-token'] || req.query.token;
  if (token !== ADMIN_TOKEN) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.post('/api/admin/login', adminLimiter, (req, res) => {
  const { password } = req.body;
  if (password !== ADMIN_PASSWORD) return res.status(401).json({ error: 'Incorrect password' });
  res.json({ token: ADMIN_TOKEN });
});

app.get('/api/admin/users', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, full_name, email, phone, verified, created_at FROM users ORDER BY created_at DESC').all();
  res.json({ users });
});

app.get('/api/admin/analyses', requireAdmin, (req, res) => {
  const analyses = db.prepare(`
    SELECT a.id, a.job_title, a.job_description, a.score, a.result_json, a.created_at,
           u.full_name, u.email, r.original_name as resume_name
    FROM analyses a
    JOIN users u ON a.user_id = u.id
    LEFT JOIN resumes r ON a.resume_id = r.id
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
    SELECT a.id, u.full_name, u.email, a.job_title, a.score, a.job_description, a.created_at
    FROM analyses a JOIN users u ON a.user_id = u.id ORDER BY a.created_at DESC
  `).all();
  const csv = ['ID,User,Email,Job Title,Score,Job Description (200 chars),Date']
    .concat(rows.map(r => {
      const jd = (r.job_description || '').replace(/"/g, '""').substring(0, 200);
      return `${r.id},"${r.full_name}","${r.email}","${r.job_title || ''}",${r.score},"${jd}","${r.created_at}"`;
    })).join('\n');
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="vectormatch-analyses.csv"');
  res.send(csv);
});

// Global error handler — must be last
app.use((err, req, res, next) => {
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(400).json({ error: 'File exceeds maximum size limit of 5MB.' });
  if (err.message && err.message.includes('Only PDF')) return res.status(400).json({ error: 'Unsupported file type. Please upload PDF, DOC, DOCX, or TXT.' });
  if (err.status === 413) return res.status(413).json({ error: 'Request too large.' });
  res.status(500).json({ error: 'An unexpected error occurred.' });
});

app.listen(PORT, () => console.log(`VectorMatch AI running at ${BASE_URL}`));
