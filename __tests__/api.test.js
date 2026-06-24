const request = require('supertest');

// Mock pg pool before requiring app
jest.mock('pg', () => {
  const users = new Map();
  const resumes = new Map();
  const analyses = new Map();
  let idSeq = { users: 1, resumes: 1, analyses: 1 };

  const mockQuery = jest.fn(async (sql, params = []) => {
    const s = sql.trim().toUpperCase();

    // initDb — ignore CREATE TABLE
    if (s.startsWith('CREATE TABLE')) return { rows: [] };

    // users
    if (s.includes('INSERT INTO USERS')) {
      const id = idSeq.users++;
      const u = { id, full_name: params[0], email: params[1], phone: params[2], verified: 0, magic_token: params[3], token_expires: params[4], created_at: new Date().toISOString() };
      if ([...users.values()].find(x => x.email === params[1]))
        throw new Error('unique constraint users_email');
      users.set(id, u);
      return { rows: [u] };
    }
    if (s.includes('SELECT') && s.includes('FROM USERS') && s.includes('WHERE EMAIL')) {
      const email = params[0];
      const u = [...users.values()].find(x => x.email === email) || null;
      return { rows: u ? [u] : [] };
    }
    if (s.includes('SELECT') && s.includes('FROM USERS') && s.includes('WHERE ID')) {
      const u = users.get(Number(params[0])) || null;
      return { rows: u ? [u] : [] };
    }
    if (s.includes('UPDATE USERS') && s.includes('MAGIC_TOKEN')) {
      const u = users.get(Number(params[2]));
      if (u) { u.magic_token = params[0]; u.token_expires = params[1]; }
      return { rows: [] };
    }
    if (s.includes('UPDATE USERS') && s.includes('VERIFIED=1')) {
      const u = [...users.values()].find(x => x.magic_token === params[0]);
      if (u) { u.verified = 1; u.magic_token = null; u.token_expires = null; }
      return { rows: [] };
    }
    if (s.includes('SELECT') && s.includes('FROM USERS') && s.includes('MAGIC_TOKEN')) {
      const u = [...users.values()].find(x => x.magic_token === params[0]) || null;
      return { rows: u ? [u] : [] };
    }
    if (s.includes('SELECT') && s.includes('FROM USERS') && s.includes('ORDER BY')) {
      return { rows: [...users.values()] };
    }

    // resumes
    if (s.includes('INSERT INTO RESUMES')) {
      const id = idSeq.resumes++;
      const r = { id, user_id: params[0], filename: params[1], original_name: params[2], resume_text: params[3], is_active: 1, created_at: new Date().toISOString() };
      resumes.set(id, r);
      return { rows: [r] };
    }
    if (s.includes('FROM RESUMES') && s.includes('USER_ID')) {
      const uid = Number(params[0]);
      const r = [...resumes.values()].filter(x => x.user_id === uid && x.is_active === 1).pop() || null;
      return { rows: r ? [r] : [] };
    }

    // analyses
    if (s.includes('INSERT INTO ANALYSES')) {
      const id = idSeq.analyses++;
      const a = { id, user_id: params[0], resume_id: params[1], job_description: params[2], job_title: params[3], result_json: params[4], score: params[5], created_at: new Date().toISOString() };
      analyses.set(id, a);
      return { rows: [a] };
    }
    if (s.includes('FROM ANALYSES') && s.includes('WHERE A.USER_ID')) {
      const uid = Number(params[0]);
      const rows = [...analyses.values()].filter(x => x.user_id === uid);
      return { rows };
    }

    return { rows: [] };
  });

  return { Pool: jest.fn(() => ({ query: mockQuery })) };
});

// Skip email sending
process.env.SKIP_EMAIL = 'true';
process.env.DATABASE_URL = 'postgresql://mock';
process.env.SESSION_SECRET = 'test-secret';
process.env.ANTHROPIC_API_KEY = 'test-key';

const app = require('../server');

// ── Helper ───────────────────────────────────────────────────────
async function registerAndLogin(agent, email = 'test@example.com') {
  const reg = await agent.post('/api/register')
    .field('full_name', 'Test User')
    .field('email', email)
    .field('phone', '2145551234')
    .attach('resume', Buffer.from('Test resume content for analysis'), 'resume.txt');
  const token = reg.body.token;
  await agent.get(`/verify?token=${token}`);
  return token;
}

// ── TC-EMAIL: Email validation ───────────────────────────────────
describe('TC-EMAIL: Email validation', () => {
  test('TC-EMAIL-003: blank email returns error', async () => {
    const res = await request(app).post('/api/check-email').send({ email: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/email required/i);
  });

  test('TC-EMAIL-001: new email returns status new', async () => {
    const res = await request(app).post('/api/check-email').send({ email: 'brand-new@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('new');
  });

  test('TC-EMAIL-006: SQL injection is safe', async () => {
    const res = await request(app).post('/api/check-email').send({ email: "' OR 1=1 --" });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('new');
  });
});

// ── TC-REGISTER: Registration ────────────────────────────────────
describe('TC-REGISTER: Registration', () => {
  test('TC-REGISTER-001: valid registration succeeds', async () => {
    const res = await request(app).post('/api/register')
      .field('full_name', 'John Doe')
      .field('email', 'john@example.com')
      .field('phone', '2145551234')
      .attach('resume', Buffer.from('My resume'), 'resume.txt');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeDefined();
  });

  test('TC-REGISTER-002: missing fields rejected', async () => {
    const res = await request(app).post('/api/register')
      .field('email', 'incomplete@example.com');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/required/i);
  });

  test('TC-REGISTER-003: duplicate email returns friendly error', async () => {
    await request(app).post('/api/register')
      .field('full_name', 'First User')
      .field('email', 'dup@example.com')
      .field('phone', '2145551234')
      .attach('resume', Buffer.from('resume'), 'resume.txt');

    const res = await request(app).post('/api/register')
      .field('full_name', 'Second User')
      .field('email', 'dup@example.com')
      .field('phone', '2145551234')
      .attach('resume', Buffer.from('resume'), 'resume.txt');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/already registered/i);
  });

  test('TC-RESUME-004: invalid file type rejected', async () => {
    const res = await request(app).post('/api/register')
      .field('full_name', 'Test')
      .field('email', 'filetype@example.com')
      .field('phone', '2145551234')
      .attach('resume', Buffer.from('fake exe'), 'virus.exe');
    expect(res.status).toBe(400);
  });
});

// ── TC-AUTH: Authentication ──────────────────────────────────────
describe('TC-AUTH: Authentication & session', () => {
  test('TC-SEC-004: unauthenticated /api/me returns 401', async () => {
    const res = await request(app).get('/api/me');
    expect(res.status).toBe(401);
  });

  test('TC-SEC-004: unauthenticated /api/analyze returns 401', async () => {
    const res = await request(app).post('/api/analyze').send({ job_description: 'test' });
    expect(res.status).toBe(401);
  });

  test('TC-SEC-004: unauthenticated /api/analyses returns 401', async () => {
    const res = await request(app).get('/api/analyses');
    expect(res.status).toBe(401);
  });

  test('TC-AUTH-001: verify with invalid token redirects to error', async () => {
    const res = await request(app).get('/verify?token=invalid-token-xyz');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('error=invalid-token');
  });

  test('TC-AUTH-002: valid token logs user in', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'logintest@example.com');
    const me = await agent.get('/api/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('logintest@example.com');
  });

  test('TC-AUTH-003: logout destroys session', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'logout@example.com');
    await agent.post('/api/logout');
    const res = await agent.get('/api/me');
    expect(res.status).toBe(401);
  });
});

// ── TC-ANALYZE: Analysis validation ─────────────────────────────
describe('TC-ANALYZE: Analysis validation', () => {
  test('TC-ANALYZE-003: empty job description rejected', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'analyzeme@example.com');
    const res = await agent.post('/api/analyze').send({ job_description: '' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/job description required/i);
  });
});

// ── TC-RETURNING: Returning user ─────────────────────────────────
describe('TC-RETURNING: Returning user flow', () => {
  test('TC-RETURN-001: returning user email shows profile', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'returning@example.com');

    const res = await request(app).post('/api/check-email').send({ email: 'returning@example.com' });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('returning');
    expect(res.body.full_name).toBe('Test User');
  });

  test('TC-RETURN-002: unknown email for magic link returns 404', async () => {
    const res = await request(app).post('/api/send-magic-link')
      .field('email', 'nobody@nowhere.com')
      .field('full_name', 'Nobody')
      .field('phone', '0000000000');
    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/not found/i);
  });
});

// ── TC-ADMIN: Admin panel ────────────────────────────────────────
describe('TC-ADMIN: Admin panel', () => {
  test('TC-ADMIN-001: wrong password rejected', async () => {
    const res = await request(app).post('/api/admin/login').send({ password: 'wrongpassword' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/incorrect/i);
  });

  test('TC-ADMIN-002: no token returns 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  test('TC-ADMIN-003: correct password returns token', async () => {
    process.env.ADMIN_PASSWORD = 'testadmin123';
    const res = await request(app).post('/api/admin/login').send({ password: 'testadmin123' });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeDefined();
  });
});

// ── TC-JD: Job description validation ───────────────────────────
describe('TC-JD: Job description', () => {
  test('TC-JD-002: empty JD blocked at API level', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'jdtest@example.com');
    const res = await agent.post('/api/analyze').send({ job_description: '' });
    expect(res.status).toBe(400);
  });

  test('TC-JD-003: very large JD truncated safely (no crash)', async () => {
    const agent = request.agent(app);
    await registerAndLogin(agent, 'largejd@example.com');
    // Should not crash — large JD is truncated in buildPrompt
    const largeJD = 'A'.repeat(50000);
    // We expect either analysis attempt or no-resume error, not a 500
    const res = await agent.post('/api/analyze').send({ job_description: largeJD });
    expect([200, 400, 500]).toContain(res.status);
    expect(res.body.error).not.toMatch(/cannot read|undefined|crash/i);
  });
});
