const pptxgen = require("pptxgenjs");

const pres = new pptxgen();
pres.layout = 'LAYOUT_16x9';
pres.title = 'VectorMatch AI';

// Color palette
const C = {
  dark:    '0F0C29',
  purple:  '302B63',
  primary: '6C3FFF',
  accent:  '00D4AA',
  white:   'FFFFFF',
  light:   'F4F6FB',
  slate:   '64748B',
  card:    'FFFFFF',
  border:  'E2E8F0',
};

// ── Slide 1: Title ────────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  // Purple gradient block left side
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 4.5, h: 5.625, fill: { color: C.purple } });
  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 4.5, h: 5.625, fill: { color: C.primary, transparency: 60 } });

  // Logo circle
  s.addShape(pres.shapes.OVAL, { x: 1.5, y: 0.8, w: 1.5, h: 1.5, fill: { color: C.primary } });
  s.addText('🎯', { x: 1.5, y: 0.8, w: 1.5, h: 1.5, fontSize: 36, align: 'center', valign: 'middle' });

  // Logo text
  s.addText([
    { text: 'VectorMatch', options: { bold: true, color: C.white } },
    { text: '.AI', options: { bold: true, color: C.accent } },
  ], { x: 0.3, y: 2.5, w: 3.9, h: 0.7, fontSize: 28, align: 'center' });

  // Tagline on left
  s.addText('AI-Powered Resume\nCareer Matching', { x: 0.3, y: 3.3, w: 3.9, h: 1.0, fontSize: 14, color: 'CADCFC', align: 'center' });

  // Right side content
  s.addText('Smarter Job Matching.\nFaster Career Growth.', { x: 5.0, y: 1.2, w: 4.7, h: 1.4, fontSize: 30, bold: true, color: C.white });
  s.addText('VectorMatch AI instantly analyzes your resume against any job description — giving you a match score, skills gap analysis, ATS readiness, and a personalized 60–90 day career roadmap.', {
    x: 5.0, y: 2.8, w: 4.7, h: 1.5, fontSize: 13, color: 'CADCFC', align: 'left'
  });

  // Stats row
  const stats = [['5-Part', 'AI Analysis'], ['30 sec', 'Results'], ['All', 'Career Fields']];
  stats.forEach(([val, lbl], i) => {
    const x = 5.0 + i * 1.6;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 4.4, w: 1.4, h: 0.85, fill: { color: C.primary, transparency: 70 }, line: { color: C.primary, width: 1 } });
    s.addText(val, { x, y: 4.4, w: 1.4, h: 0.4, fontSize: 16, bold: true, color: C.accent, align: 'center', valign: 'bottom', margin: 0 });
    s.addText(lbl, { x, y: 4.8, w: 1.4, h: 0.3, fontSize: 9, color: C.white, align: 'center', margin: 0 });
  });

  s.addText('Live Demo — 2025', { x: 5.0, y: 5.3, w: 4.7, h: 0.25, fontSize: 10, color: C.slate, align: 'left' });
}

// ── Slide 2: Problem ──────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.light };

  s.addText('The Problem', { x: 0.5, y: 0.3, w: 9, h: 0.6, fontSize: 32, bold: true, color: C.dark, align: 'center' });
  s.addText('Job seekers are applying blindly — without knowing how well they match', { x: 0.5, y: 0.95, w: 9, h: 0.35, fontSize: 14, color: C.slate, align: 'center' });

  const problems = [
    { icon: '📄', title: 'Resume Mismatch', desc: 'Candidates submit resumes without knowing if their skills match the job requirements' },
    { icon: '🤖', title: 'ATS Rejection', desc: 'Over 75% of resumes are rejected by Applicant Tracking Systems before a human reads them' },
    { icon: '🎯', title: 'No Roadmap', desc: 'Job seekers have no clear path to close skill gaps and improve their chances' },
    { icon: '⏱️', title: 'Wasted Time', desc: 'Hours spent on applications that had no chance of success due to poor fit' },
  ];

  problems.forEach(({ icon, title, desc }, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 4.8;
    const y = 1.5 + row * 1.8;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.3, h: 1.5, fill: { color: C.white }, line: { color: C.border, width: 1 }, shadow: { type: 'outer', color: '000000', blur: 6, offset: 2, angle: 135, opacity: 0.08 } });
    s.addText(icon, { x, y: y + 0.1, w: 1.0, h: 1.3, fontSize: 28, align: 'center', valign: 'middle' });
    s.addText(title, { x: x + 1.0, y: y + 0.15, w: 3.1, h: 0.35, fontSize: 13, bold: true, color: C.dark });
    s.addText(desc, { x: x + 1.0, y: y + 0.5, w: 3.1, h: 0.85, fontSize: 10.5, color: C.slate });
  });
}

// ── Slide 3: Solution ─────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addText('The Solution', { x: 0.5, y: 0.3, w: 9, h: 0.55, fontSize: 32, bold: true, color: C.white, align: 'center' });
  s.addText('VectorMatch AI — 5-Part Instant Analysis', { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 14, color: C.accent, align: 'center' });

  const features = [
    { icon: '📊', title: 'Match Score', desc: '0–100 compatibility score with fit level rating' },
    { icon: '🔍', title: 'Skills Gap', desc: 'Missing required vs preferred skills with action steps' },
    { icon: '🤖', title: 'ATS Risk', desc: 'Keyword density and formatting analysis' },
    { icon: '✏️', title: 'Resume Fixes', desc: 'Section-by-section improvement suggestions' },
    { icon: '🗺️', title: '60–90 Day Roadmap', desc: 'Personalized monthly career action plan' },
  ];

  features.forEach(({ icon, title, desc }, i) => {
    const x = 0.3 + i * 1.88;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.45, w: 1.7, h: 3.6, fill: { color: C.primary, transparency: 80 }, line: { color: C.primary, width: 1 } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.6, y: 1.6, w: 0.5, h: 0.5, fill: { color: C.accent } });
    s.addText(icon, { x: x + 0.6, y: 1.6, w: 0.5, h: 0.5, fontSize: 14, align: 'center', valign: 'middle' });
    s.addText(title, { x, y: 2.2, w: 1.7, h: 0.5, fontSize: 11, bold: true, color: C.white, align: 'center' });
    s.addText(desc, { x, y: 2.75, w: 1.7, h: 1.8, fontSize: 9.5, color: 'CADCFC', align: 'center' });
    s.addText(`0${i + 1}`, { x, y: 4.6, w: 1.7, h: 0.35, fontSize: 20, bold: true, color: C.accent, align: 'center', transparency: 40 });
  });
}

// ── Slide 4: How It Works ─────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.light };

  s.addText('How It Works', { x: 0.5, y: 0.3, w: 9, h: 0.55, fontSize: 32, bold: true, color: C.dark, align: 'center' });
  s.addText('Simple 4-step process — results in under 30 seconds', { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 13, color: C.slate, align: 'center' });

  const steps = [
    { n: '1', icon: '📧', title: 'Enter Email', desc: 'Email-first flow. New users register with name, phone, resume. Returning users get a magic link.' },
    { n: '2', icon: '📄', title: 'Upload Resume', desc: 'Upload PDF, DOCX, or TXT. AI extracts and stores your resume text securely.' },
    { n: '3', icon: '📋', title: 'Paste Job Description', desc: 'Copy any job posting and paste it into the analyzer — works for all career fields.' },
    { n: '4', icon: '🎯', title: 'Get AI Analysis', desc: 'Receive your match score, skills gap, ATS risk report, improvements, and 60–90 day roadmap.' },
  ];

  steps.forEach(({ n, icon, title, desc }, i) => {
    const x = 0.35 + i * 2.33;
    // Connector arrow
    if (i < 3) {
      s.addShape(pres.shapes.LINE, { x: x + 2.05, y: 2.5, w: 0.28, h: 0, line: { color: C.primary, width: 2 } });
    }
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.45, w: 2.1, h: 3.7, fill: { color: C.white }, line: { color: C.border, width: 1 }, shadow: { type: 'outer', color: '000000', blur: 5, offset: 2, angle: 135, opacity: 0.07 } });
    s.addShape(pres.shapes.OVAL, { x: x + 0.8, y: 1.6, w: 0.5, h: 0.5, fill: { color: C.primary } });
    s.addText(n, { x: x + 0.8, y: 1.6, w: 0.5, h: 0.5, fontSize: 14, bold: true, color: C.white, align: 'center', valign: 'middle' });
    s.addText(icon, { x, y: 2.25, w: 2.1, h: 0.5, fontSize: 24, align: 'center' });
    s.addText(title, { x, y: 2.85, w: 2.1, h: 0.4, fontSize: 12, bold: true, color: C.dark, align: 'center' });
    s.addText(desc, { x: x + 0.1, y: 3.3, w: 1.9, h: 1.7, fontSize: 9.5, color: C.slate, align: 'center' });
  });
}

// ── Slide 5: Tech Stack ───────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addText('Technology Stack', { x: 0.5, y: 0.3, w: 9, h: 0.55, fontSize: 32, bold: true, color: C.white, align: 'center' });
  s.addText('Modern, scalable, and cost-effective architecture', { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 13, color: C.accent, align: 'center' });

  const categories = [
    { label: 'AI Engine', color: '6C3FFF', items: ['Anthropic Claude AI', 'claude-haiku model', 'NLP Analysis', 'JSON structured output'] },
    { label: 'Backend', color: '0891B2', items: ['Node.js + Express', 'SQLite Database', 'Magic Link Auth', 'REST API'] },
    { label: 'Frontend', color: '059669', items: ['HTML5 / CSS3 / JS', 'Responsive Design', 'No framework needed', 'Mobile friendly'] },
    { label: 'Infrastructure', color: 'DC2626', items: ['Railway (cloud host)', 'GitHub CI/CD', 'GoDaddy Domain', 'Auto-deploy'] },
    { label: 'Security', color: 'D97706', items: ['Passwordless login', 'Email verification', 'HTTPS / SSL', 'Token-based admin'] },
  ];

  categories.forEach(({ label, color, items }, i) => {
    const x = 0.3 + i * 1.9;
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.45, w: 1.7, h: 0.35, fill: { color } });
    s.addText(label, { x, y: 1.45, w: 1.7, h: 0.35, fontSize: 10, bold: true, color: C.white, align: 'center', valign: 'middle', margin: 0 });
    s.addShape(pres.shapes.RECTANGLE, { x, y: 1.8, w: 1.7, h: 3.2, fill: { color: C.purple } });
    items.forEach((item, j) => {
      s.addText('• ' + item, { x: x + 0.1, y: 1.9 + j * 0.7, w: 1.5, h: 0.6, fontSize: 10, color: 'CADCFC' });
    });
  });
}

// ── Slide 6: Live Demo ────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.light };

  s.addText('Live Demo', { x: 0.5, y: 0.3, w: 9, h: 0.55, fontSize: 32, bold: true, color: C.dark, align: 'center' });
  s.addText('See VectorMatch AI in action', { x: 0.5, y: 0.9, w: 9, h: 0.35, fontSize: 13, color: C.slate, align: 'center' });

  // URL box
  s.addShape(pres.shapes.RECTANGLE, { x: 2.0, y: 1.45, w: 6, h: 0.65, fill: { color: C.dark }, line: { color: C.primary, width: 2 } });
  s.addText('🌐  vectormatch-production.up.railway.app', { x: 2.0, y: 1.45, w: 6, h: 0.65, fontSize: 13, bold: true, color: C.accent, align: 'center', valign: 'middle' });

  const demoSteps = [
    { step: 'Step 1', action: 'Enter email address', detail: 'Email-first flow detects new vs returning user' },
    { step: 'Step 2', action: 'Fill registration form', detail: 'Name, phone, upload resume (PDF/DOCX/TXT)' },
    { step: 'Step 3', action: 'Verify & access dashboard', detail: 'Magic link login — no password required' },
    { step: 'Step 4', action: 'Paste job description', detail: 'Any job posting from any industry' },
    { step: 'Step 5', action: 'View AI results', detail: 'Score, gaps, ATS risk, fixes, 60–90 day roadmap' },
    { step: 'Admin', action: 'View collected data', detail: 'Users, resumes, analyses — export to CSV' },
  ];

  demoSteps.forEach(({ step, action, detail }, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = 0.4 + col * 4.8;
    const y = 2.3 + row * 1.05;
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 4.3, h: 0.85, fill: { color: C.white }, line: { color: C.border, width: 1 } });
    s.addShape(pres.shapes.RECTANGLE, { x, y, w: 0.85, h: 0.85, fill: { color: C.primary } });
    s.addText(step, { x, y, w: 0.85, h: 0.85, fontSize: 9, bold: true, color: C.white, align: 'center', valign: 'middle' });
    s.addText(action, { x: x + 0.95, y: y + 0.05, w: 3.25, h: 0.35, fontSize: 11, bold: true, color: C.dark });
    s.addText(detail, { x: x + 0.95, y: y + 0.42, w: 3.25, h: 0.35, fontSize: 9.5, color: C.slate });
  });
}

// ── Slide 7: Closing ──────────────────────────────────────────────
{
  const s = pres.addSlide();
  s.background = { color: C.dark };

  s.addShape(pres.shapes.RECTANGLE, { x: 0, y: 0, w: 10, h: 5.625, fill: { color: C.primary, transparency: 85 } });

  s.addShape(pres.shapes.OVAL, { x: 4.25, y: 0.6, w: 1.5, h: 1.5, fill: { color: C.primary } });
  s.addText('🎯', { x: 4.25, y: 0.6, w: 1.5, h: 1.5, fontSize: 36, align: 'center', valign: 'middle' });

  s.addText([
    { text: 'VectorMatch', options: { bold: true, color: C.white } },
    { text: '.AI', options: { bold: true, color: C.accent } },
  ], { x: 1, y: 2.3, w: 8, h: 0.7, fontSize: 36, align: 'center' });

  s.addText('AI-Powered Resume Matching for Every Career', { x: 1, y: 3.1, w: 8, h: 0.45, fontSize: 16, color: 'CADCFC', align: 'center' });

  s.addShape(pres.shapes.RECTANGLE, { x: 3.0, y: 3.75, w: 4, h: 0.55, fill: { color: C.accent } });
  s.addText('Try it live: vectormatch-production.up.railway.app', { x: 3.0, y: 3.75, w: 4, h: 0.55, fontSize: 11, bold: true, color: C.dark, align: 'center', valign: 'middle' });

  s.addText('Built with Node.js · Claude AI · Railway · SQLite · GoDaddy', { x: 1, y: 4.5, w: 8, h: 0.3, fontSize: 10, color: C.slate, align: 'center' });
}

pres.writeFile({ fileName: 'VectorMatch-AI-Demo.pptx' })
  .then(() => console.log('✅ VectorMatch-AI-Demo.pptx created'))
  .catch(e => console.error(e));
