/* ============================================================
   CYNDY — APPLY.JS
   16-section application wizard: navigation, auto-save,
   validation, section rendering, final submit
   ============================================================ */

import {
  supabase, toast, fmtDate, COUNTRIES, genRefCode,
  compressImage, fmtBytes, MAX_FILE_SIZE_BYTES, docStoragePath, BUCKETS,
} from './config.js';
import { getSession } from './auth.js';

// ─── SECTION METADATA ────────────────────────────────────────
const SECTIONS = [
  { id: 1,  key: 'personal',    label: 'Personal Details' },
  { id: 2,  key: 'contact',     label: 'Contact Details' },
  { id: 3,  key: 'family',      label: 'Family Background' },
  { id: 4,  key: 'education',   label: 'Academic History' },
  { id: 5,  key: 'english',     label: 'English Proficiency' },
  { id: 6,  key: 'employment',  label: 'Work Experience' },
  { id: 7,  key: 'program',     label: 'Programme Choice' },
  { id: 8,  key: 'finance',     label: 'Financial Declaration' },
  { id: 9,  key: 'travel',      label: 'Travel History' },
  { id: 10, key: 'medical',     label: 'Medical Information' },
  { id: 11, key: 'criminal',    label: 'Criminal Record' },
  { id: 12, key: 'reference',   label: 'References' },
  { id: 13, key: 'statement',   label: 'Personal Statement' },
  { id: 14, key: 'documents',   label: 'Documents Upload' },
  { id: 15, key: 'payment',     label: 'Application Fee' },
  { id: 16, key: 'declaration', label: 'Declaration & Submit' },
];

// ─── STATE ────────────────────────────────────────────────────
let currentSection = 1;
let applicationId  = null;
let sectionData    = {};  // in-memory cache of section data
let saveTimer      = null;
let userId         = null;

// ─── INIT ─────────────────────────────────────────────────────
export async function initApplyWizard(ctx) {
  userId = ctx.user.id;

  // Populate country selects
  populateCountrySelects();

  // Build section dots nav
  renderSectionDots();

  // Load or create application
  await loadOrCreateApplication();

  // Wire nav buttons for pre-rendered sections (1 & 2)
  document.getElementById('s1_next')?.addEventListener('click', () => navigateTo(2));
  document.getElementById('s2_prev')?.addEventListener('click', () => navigateTo(1));
  document.getElementById('s2_next')?.addEventListener('click', () => navigateTo(3));

  // Render dynamic sections 3-16
  renderDynamicSections();

  // Auto-save on field change
  document.querySelectorAll('.wizard-panel input, .wizard-panel select, .wizard-panel textarea')
    .forEach(el => el.addEventListener('change', () => scheduleAutoSave()));

  // Show first section
  showSection(1);
}

// ─── LOAD / CREATE APPLICATION ────────────────────────────────
async function loadOrCreateApplication() {
  // Check for existing draft
  const { data: existing } = await supabase
    .from('applications')
    .select('id, ref_code, status, application_sections(*)')
    .eq('client_id', userId)
    .eq('status', 'draft')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (existing) {
    applicationId = existing.id;
    // Restore section data from DB
    if (existing.application_sections) {
      existing.application_sections.forEach(s => {
        sectionData[s.section_key] = s.data;
      });
      populateFieldsFromData();
    }
    toast('Draft restored.', 'info', 2000);
  } else {
    // Create a new draft
    const refCode = genRefCode();
    const { data: newApp, error } = await supabase
      .from('applications')
      .insert({ client_id: userId, ref_code: refCode, status: 'draft' })
      .select('id, ref_code')
      .single();

    if (error) { toast('Failed to create application. Please refresh.', 'error'); return; }
    applicationId = newApp.id;
  }
}

// ─── SECTION DOTS ─────────────────────────────────────────────
function renderSectionDots() {
  const container = document.getElementById('sectionsDots');
  if (!container) return;

  SECTIONS.forEach(sec => {
    const btn = document.createElement('button');
    btn.className = 'section-dot';
    btn.id        = `dot-${sec.id}`;
    btn.textContent = sec.id;
    btn.setAttribute('role', 'tab');
    btn.setAttribute('aria-label', `Section ${sec.id}: ${sec.label}`);
    btn.setAttribute('aria-controls', `panel-${sec.id}`);
    btn.addEventListener('click', () => {
      // Only allow jumping to completed or current
      if (sec.id <= currentSection || isCompleted(sec.key)) navigateTo(sec.id);
    });
    container.appendChild(btn);
  });
}

function updateDots() {
  SECTIONS.forEach(sec => {
    const dot = document.getElementById(`dot-${sec.id}`);
    if (!dot) return;
    dot.classList.remove('active','completed','na');
    if (sec.id === currentSection) dot.classList.add('active');
    else if (isCompleted(sec.key)) dot.classList.add('completed');
  });
}

function isCompleted(key) {
  return !!(sectionData[key] && Object.keys(sectionData[key]).length > 0);
}

// ─── NAVIGATION ───────────────────────────────────────────────
function showSection(num) {
  // Hide all panels
  document.querySelectorAll('.wizard-panel').forEach(p => p.classList.add('hidden'));

  const panel = document.getElementById(`panel-${num}`);
  if (panel) {
    panel.classList.remove('hidden');
    panel.classList.add('animate-slideUp');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  currentSection = num;
  const sec = SECTIONS[num - 1];

  // Update header
  const numEl  = document.getElementById('currentSectionNum');
  const nameEl = document.getElementById('currentSectionName');
  if (numEl)  numEl.textContent  = num;
  if (nameEl) nameEl.textContent = sec?.label || '';

  // Update progress
  const completed  = SECTIONS.filter(s => isCompleted(s.key)).length;
  const pct        = Math.round((completed / SECTIONS.length) * 100);
  const pctEl      = document.getElementById('progressPct');
  const barEl      = document.getElementById('progressBar');
  if (pctEl) pctEl.textContent = `${pct}% complete`;
  if (barEl) barEl.style.width = `${pct}%`;

  updateDots();
}

async function navigateTo(num) {
  // Validate current before advancing
  if (num > currentSection) {
    const valid = validateSection(currentSection);
    if (!valid) return;
    // Save current section data
    await saveSection(currentSection);
  }
  showSection(num);
}

// ─── VALIDATION ───────────────────────────────────────────────
function validateSection(num) {
  const panel = document.getElementById(`panel-${num}`);
  if (!panel) return true;

  const required = panel.querySelectorAll('[required]');
  let valid = true;

  required.forEach(el => {
    el.classList.remove('error');
    if (!el.value.trim()) {
      el.classList.add('error');
      valid = false;
    }
  });

  if (!valid) toast('Please fill in all required fields before continuing.', 'warning');
  return valid;
}

// ─── SAVE SECTION ─────────────────────────────────────────────
async function saveSection(num) {
  if (!applicationId) return;
  const panel   = document.getElementById(`panel-${num}`);
  if (!panel) return;

  const key    = SECTIONS[num - 1]?.key;
  const inputs = panel.querySelectorAll('input, select, textarea');
  const data   = {};

  inputs.forEach(el => {
    if (el.id) data[el.id] = el.type === 'checkbox' ? el.checked : el.value;
  });

  sectionData[key] = data;
  setAutosaveStatus('saving');

  // Upsert section data
  const { error } = await supabase
    .from('application_sections')
    .upsert({
      application_id: applicationId,
      section_key:    key,
      data,
      updated_at:     new Date().toISOString(),
    }, { onConflict: 'application_id,section_key' });

  if (error) {
    console.error('[saveSection]', error);
    setAutosaveStatus('error');
    return;
  }

  // Mark section complete on application row
  const completionField = `sec_${key}_complete`;
  await supabase
    .from('applications')
    .update({ [completionField]: true })
    .eq('id', applicationId);

  setAutosaveStatus('saved');
}

// ─── AUTO-SAVE ────────────────────────────────────────────────
function scheduleAutoSave() {
  setAutosaveStatus('saving');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveSection(currentSection), 1500);
}

function setAutosaveStatus(status) {
  const el   = document.getElementById('autosaveIndicator');
  const text = document.getElementById('autosaveText');
  if (!el || !text) return;
  el.className = `wizard-autosave ${status}`;
  const map = {
    saving: 'Saving…',
    saved:  'All changes saved',
    error:  'Save failed — check connection',
  };
  text.textContent = map[status] || '';
}

// ─── POPULATE FIELDS FROM SAVED DATA ─────────────────────────
function populateFieldsFromData() {
  Object.entries(sectionData).forEach(([key, data]) => {
    if (!data) return;
    Object.entries(data).forEach(([fieldId, value]) => {
      const el = document.getElementById(fieldId);
      if (!el) return;
      if (el.type === 'checkbox') el.checked = value;
      else el.value = value;
    });
  });
}

// ─── COUNTRY SELECT POPULATION ────────────────────────────────
function populateCountrySelects() {
  const selects = document.querySelectorAll(
    '#s1_nationality, #s1_birthCountry, #s1_passportCountry, #s2_country'
  );
  selects.forEach(sel => {
    COUNTRIES.forEach(c => {
      const opt = document.createElement('option');
      opt.value = c; opt.textContent = c;
      sel.appendChild(opt);
    });
  });
}

// ─── DYNAMIC SECTIONS 3–16 ────────────────────────────────────
function renderDynamicSections() {
  const container = document.getElementById('dynamicPanels');
  if (!container) return;

  // Section 3: Family Background
  container.insertAdjacentHTML('beforeend', buildFamilySection());
  // Section 4: Academic History
  container.insertAdjacentHTML('beforeend', buildEducationSection());
  // Section 5: English Proficiency
  container.insertAdjacentHTML('beforeend', buildEnglishSection());
  // Section 6: Work Experience
  container.insertAdjacentHTML('beforeend', buildEmploymentSection());
  // Section 7: Programme Choice
  container.insertAdjacentHTML('beforeend', buildProgramSection());
  // Section 8: Financial Declaration
  container.insertAdjacentHTML('beforeend', buildFinanceSection());
  // Section 9: Travel History
  container.insertAdjacentHTML('beforeend', buildTravelSection());
  // Section 10: Medical
  container.insertAdjacentHTML('beforeend', buildMedicalSection());
  // Section 11: Criminal Record
  container.insertAdjacentHTML('beforeend', buildCriminalSection());
  // Section 12: References
  container.insertAdjacentHTML('beforeend', buildReferenceSection());
  // Section 13: Personal Statement
  container.insertAdjacentHTML('beforeend', buildStatementSection());
  // Section 14: Documents Upload
  container.insertAdjacentHTML('beforeend', buildDocumentsSection());
  // Section 15: Payment
  container.insertAdjacentHTML('beforeend', buildPaymentSection());
  // Section 16: Declaration & Submit
  container.insertAdjacentHTML('beforeend', buildDeclarationSection());

  // Wire nav buttons for dynamic sections
  for (let i = 3; i <= 16; i++) {
    const prev = document.getElementById(`s${i}_prev`);
    const next = document.getElementById(`s${i}_next`);
    if (i < 16) {
      prev?.addEventListener('click', () => navigateTo(i - 1));
      next?.addEventListener('click', () => navigateTo(i + 1));
    } else {
      // Last section: submit
      prev?.addEventListener('click', () => navigateTo(15));
      document.getElementById('submitAppBtn')?.addEventListener('click', submitApplication);
    }
  }

  // Populate country selects in dynamic sections
  ['s9_countryVisited'].forEach(id => {
    const el = document.getElementById(id);
    if (el) COUNTRIES.forEach(c => { const o = document.createElement('option'); o.value=c; o.textContent=c; el.appendChild(o); });
  });

  // Auto-save on dynamic fields
  document.querySelectorAll('.wizard-panel input, .wizard-panel select, .wizard-panel textarea')
    .forEach(el => el.addEventListener('change', () => scheduleAutoSave()));
}

// ─── SECTION BUILDERS ─────────────────────────────────────────
function sectionWrap(num, title, subtitle, bodyHtml) {
  const isLast = num === 16;
  return `
  <section class="wizard-panel hidden animate-slideUp" id="panel-${num}" aria-labelledby="sec${num}-title">
    <div class="wizard-panel-header">
      <div class="section-header" style="margin-bottom:0;border-bottom:none;padding-bottom:0">
        <div class="section-num">${num}</div>
        <h2 class="section-title" id="sec${num}-title">${title}</h2>
        <p class="section-subtitle">${subtitle}</p>
      </div>
    </div>
    <div class="wizard-panel-body">${bodyHtml}</div>
    <div class="wizard-panel-footer">
      <button class="wizard-nav-prev" id="s${num}_prev" aria-label="Previous section">
        <i class="fa-solid fa-arrow-left" aria-hidden="true"></i> Previous
      </button>
      ${isLast
        ? `<button class="btn btn-gold" id="submitAppBtn" aria-label="Submit application">
             <i class="fa-solid fa-paper-plane" aria-hidden="true"></i> Submit Application
           </button>`
        : `<button class="btn btn-gold" id="s${num}_next" aria-label="Save and continue">
             Save &amp; Continue <i class="fa-solid fa-arrow-right" aria-hidden="true"></i>
           </button>`}
    </div>
  </section>`;
}

function buildFamilySection() {
  return sectionWrap(3, 'Family Background', 'Information about your parents/guardians.', `
    <h3 class="subsection-title"><i class="fa-solid fa-person"></i> Father / Male Guardian</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="s3_fatherName">Full Name</label>
        <input type="text" id="s3_fatherName" class="form-control" placeholder="John Doe"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_fatherOccupation">Occupation</label>
        <input type="text" id="s3_fatherOccupation" class="form-control"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_fatherPhone">Phone</label>
        <input type="tel" id="s3_fatherPhone" class="form-control"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_fatherNationality">Nationality</label>
        <input type="text" id="s3_fatherNationality" class="form-control"/>
      </div>
    </div>
    <h3 class="subsection-title"><i class="fa-solid fa-person-dress"></i> Mother / Female Guardian</h3>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="s3_motherName">Full Name</label>
        <input type="text" id="s3_motherName" class="form-control"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_motherOccupation">Occupation</label>
        <input type="text" id="s3_motherOccupation" class="form-control"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_motherPhone">Phone</label>
        <input type="tel" id="s3_motherPhone" class="form-control"/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s3_motherNationality">Nationality</label>
        <input type="text" id="s3_motherNationality" class="form-control"/>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="s3_numSiblings">Number of Siblings</label>
      <input type="number" id="s3_numSiblings" class="form-control" min="0" max="30" placeholder="0"/>
    </div>`);
}

function buildEducationSection() {
  return sectionWrap(4, 'Academic History', 'List all secondary and post-secondary education you have completed.', `
    <div class="repeat-group" id="eduGroup1">
      <div class="repeat-group-header">
        <h3 class="repeat-group-title">Education Entry 1</h3>
      </div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label" for="s4_inst1">Institution Name <span class="required">*</span></label>
          <input type="text" id="s4_inst1" class="form-control" required placeholder="University of Lagos"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s4_qual1">Qualification <span class="required">*</span></label>
          <select id="s4_qual1" class="form-control" required>
            <option value="">Select…</option>
            <option>WAEC / SSCE</option><option>A-Levels</option>
            <option>OND / HND</option><option>BSc / BA / BEng</option>
            <option>MSc / MA / MBA</option><option>PhD</option>
            <option>Other</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="s4_field1">Field of Study <span class="required">*</span></label>
          <input type="text" id="s4_field1" class="form-control" required placeholder="Computer Science"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s4_grade1">Grade / Classification</label>
          <input type="text" id="s4_grade1" class="form-control" placeholder="2:1, Merit, 3.5 GPA…"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s4_start1">Start Date</label>
          <input type="month" id="s4_start1" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s4_end1">End Date</label>
          <input type="month" id="s4_end1" class="form-control"/>
        </div>
      </div>
    </div>
    <button class="btn btn-ghost btn-sm" id="addEduBtn" type="button">
      <i class="fa-solid fa-plus"></i> Add Another Institution
    </button>`);
}

function buildEnglishSection() {
  return sectionWrap(5, 'English Proficiency', 'Provide details of your English language test results.', `
    <div class="form-group">
      <label class="form-label" for="s5_englishFirst">Is English your first language? <span class="required">*</span></label>
      <select id="s5_englishFirst" class="form-control" required>
        <option value="">Select…</option>
        <option value="yes">Yes</option>
        <option value="no">No</option>
      </select>
    </div>
    <div id="s5_testSection">
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label" for="s5_testType">Test Type <span class="required">*</span></label>
          <select id="s5_testType" class="form-control">
            <option value="">Select…</option>
            <option>IELTS Academic</option><option>IELTS General</option>
            <option>TOEFL iBT</option><option>PTE Academic</option>
            <option>Duolingo English Test</option><option>Cambridge B2 / C1 / C2</option>
            <option>OET</option><option>GRE (Verbal)</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_overallScore">Overall Score</label>
          <input type="text" id="s5_overallScore" class="form-control" placeholder="e.g. 7.0"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_listening">Listening</label>
          <input type="text" id="s5_listening" class="form-control" placeholder="e.g. 7.5"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_reading">Reading</label>
          <input type="text" id="s5_reading" class="form-control" placeholder="e.g. 7.0"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_writing">Writing</label>
          <input type="text" id="s5_writing" class="form-control" placeholder="e.g. 6.5"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_speaking">Speaking</label>
          <input type="text" id="s5_speaking" class="form-control" placeholder="e.g. 7.0"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_testDate">Test Date</label>
          <input type="date" id="s5_testDate" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s5_refNum">Reference / Certificate No.</label>
          <input type="text" id="s5_refNum" class="form-control"/>
        </div>
      </div>
    </div>`);
}

function buildEmploymentSection() {
  return sectionWrap(6, 'Work Experience', 'List your current and previous employment (if any).', `
    <label class="na-toggle-wrap" id="s6_naToggle">
      <div class="toggle-switch">
        <input type="checkbox" id="s6_noExperience"/>
        <span class="toggle-slider"></span>
      </div>
      <span>I have no work experience to declare</span>
    </label>
    <div id="s6_workSection">
      <div class="repeat-group">
        <div class="repeat-group-header"><h3 class="repeat-group-title">Employment 1</h3></div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="s6_employer1">Employer Name</label>
            <input type="text" id="s6_employer1" class="form-control"/>
          </div>
          <div class="form-group">
            <label class="form-label" for="s6_jobTitle1">Job Title</label>
            <input type="text" id="s6_jobTitle1" class="form-control"/>
          </div>
          <div class="form-group">
            <label class="form-label" for="s6_empStart1">Start Date</label>
            <input type="month" id="s6_empStart1" class="form-control"/>
          </div>
          <div class="form-group">
            <label class="form-label" for="s6_empEnd1">End Date</label>
            <input type="month" id="s6_empEnd1" class="form-control" placeholder="Leave blank if current"/>
          </div>
        </div>
        <div class="form-group">
          <label class="form-label" for="s6_duties1">Key Responsibilities</label>
          <textarea id="s6_duties1" class="form-control" rows="3" placeholder="Brief description of your role…"></textarea>
        </div>
      </div>
    </div>`);
}

function buildProgramSection() {
  return sectionWrap(7, 'Programme Choice', 'Which course and university are you applying to?', `
    <div class="form-group" style="margin-bottom:var(--space-6)">
      <label class="form-label" for="s7_programSearch">Search Programmes</label>
      <div class="search-bar">
        <i class="fa-solid fa-magnifying-glass fa" aria-hidden="true"></i>
        <input type="text" id="s7_programSearch" placeholder="Search by university, course, or country…" autocomplete="off"/>
      </div>
      <div id="s7_programResults" class="card" style="margin-top:var(--space-3);display:none;padding:var(--space-3);max-height:280px;overflow-y:auto"></div>
    </div>
    <div id="s7_selectedProgram" class="card" style="display:none;border-color:var(--gold-border);background:var(--gold-dim)">
      <div style="display:flex;align-items:center;justify-content:space-between">
        <div>
          <p style="font-size:0.8rem;color:var(--muted)" id="s7_selUni">University</p>
          <p style="font-weight:600;font-size:1.05rem" id="s7_selProgName">Programme Name</p>
          <p style="font-size:0.875rem;color:var(--text-secondary);margin-top:4px" id="s7_selMeta">Level · Intake · Fee</p>
        </div>
        <button type="button" class="btn btn-ghost btn-sm" id="s7_clearProgram">Change</button>
      </div>
    </div>
    <input type="hidden" id="s7_programId"/>
    <div class="form-grid-2" style="margin-top:var(--space-6)">
      <div class="form-group">
        <label class="form-label" for="s7_intake">Preferred Intake <span class="required">*</span></label>
        <select id="s7_intake" class="form-control" required>
          <option value="">Select…</option>
          <option value="september">September</option>
          <option value="january">January</option>
          <option value="may">May</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label" for="s7_intakeYear">Intake Year <span class="required">*</span></label>
        <select id="s7_intakeYear" class="form-control" required>
          <option value="">Select…</option>
          <option value="2025">2025</option>
          <option value="2026">2026</option>
          <option value="2027">2027</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="s7_studyMotivation">Why this programme?</label>
      <textarea id="s7_studyMotivation" class="form-control" rows="4" placeholder="Briefly explain your motivation for this choice…"></textarea>
    </div>`);
}

function buildFinanceSection() {
  return sectionWrap(8, 'Financial Declaration', 'How will you fund your studies?', `
    <div class="form-group">
      <label class="form-label" for="s8_fundingSource">Primary Funding Source <span class="required">*</span></label>
      <select id="s8_fundingSource" class="form-control" required>
        <option value="">Select…</option>
        <option>Self-funded / Personal savings</option>
        <option>Family sponsor</option>
        <option>Government scholarship</option>
        <option>University scholarship</option>
        <option>Bank loan</option>
        <option>Employer sponsorship</option>
        <option>NGO / Foundation grant</option>
        <option>Combination</option>
      </select>
    </div>
    <div class="form-grid-2">
      <div class="form-group">
        <label class="form-label" for="s8_availableFunds">Available Funds <span class="required">*</span></label>
        <input type="number" id="s8_availableFunds" class="form-control" placeholder="e.g. 25000" min="0" required/>
      </div>
      <div class="form-group">
        <label class="form-label" for="s8_currency">Currency</label>
        <select id="s8_currency" class="form-control">
          <option value="GBP">GBP £</option>
          <option value="USD">USD $</option>
          <option value="EUR">EUR €</option>
          <option value="NGN">NGN ₦</option>
          <option value="GHS">GHS ₵</option>
          <option value="ZAR">ZAR R</option>
          <option value="KES">KES KSh</option>
        </select>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="s8_sponsorName">Sponsor Name (if applicable)</label>
      <input type="text" id="s8_sponsorName" class="form-control" placeholder="Full name of sponsor or organisation"/>
    </div>
    <div class="form-group">
      <label class="form-label" for="s8_sponsorRelation">Sponsor Relationship</label>
      <select id="s8_sponsorRelation" class="form-control">
        <option value="">N/A</option>
        <option>Parent</option><option>Sibling</option>
        <option>Guardian</option><option>Employer</option>
        <option>Government</option><option>Organisation</option>
      </select>
    </div>`);
}

function buildTravelSection() {
  return sectionWrap(9, 'Travel History', 'Have you previously visited any countries outside your home country?', `
    <label class="na-toggle-wrap">
      <div class="toggle-switch">
        <input type="checkbox" id="s9_noTravel"/>
        <span class="toggle-slider"></span>
      </div>
      <span>I have not travelled outside my home country</span>
    </label>
    <div id="s9_travelSection">
      <div class="repeat-group">
        <div class="repeat-group-header"><h3 class="repeat-group-title">Visit 1</h3></div>
        <div class="form-grid-2">
          <div class="form-group">
            <label class="form-label" for="s9_countryVisited">Country Visited</label>
            <select id="s9_countryVisited" class="form-control"><option value="">Select…</option></select>
          </div>
          <div class="form-group">
            <label class="form-label" for="s9_visitPurpose">Purpose</label>
            <select id="s9_visitPurpose" class="form-control">
              <option>Tourism</option><option>Business</option>
              <option>Study</option><option>Medical</option>
              <option>Transit</option><option>Other</option>
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="s9_visitFrom">From</label>
            <input type="month" id="s9_visitFrom" class="form-control"/>
          </div>
          <div class="form-group">
            <label class="form-label" for="s9_visitTo">To</label>
            <input type="month" id="s9_visitTo" class="form-control"/>
          </div>
        </div>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="s9_visaRefusal">Have you ever been refused a visa? <span class="required">*</span></label>
      <select id="s9_visaRefusal" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
    <div class="form-group hidden" id="s9_refusalDetails">
      <label class="form-label" for="s9_visaRefusalDetails">Please provide details</label>
      <textarea id="s9_visaRefusalDetails" class="form-control" rows="3"></textarea>
    </div>`);
}

function buildMedicalSection() {
  return sectionWrap(10, 'Medical Information', 'Information required for welfare and student visa applications.', `
    <div class="form-group">
      <label class="form-label" for="s10_conditions">Do you have any medical conditions the university should be aware of? <span class="required">*</span></label>
      <select id="s10_conditions" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
    <div class="form-group hidden" id="s10_condDetails">
      <label class="form-label" for="s10_conditionDetails">Please describe</label>
      <textarea id="s10_conditionDetails" class="form-control" rows="3" placeholder="Only share what is relevant to your studies or need for support services."></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="s10_disability">Do you have a disability or learning difficulty? <span class="required">*</span></label>
      <select id="s10_disability" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes — I may need support</option>
      </select>
    </div>
    <div class="form-group">
      <label class="form-label" for="s10_tb">Have you lived or worked in a country with a high TB rate in the last 6 months? <span class="required">*</span></label>
      <select id="s10_tb" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes — I will obtain a TB test certificate</option>
      </select>
    </div>`);
}

function buildCriminalSection() {
  return sectionWrap(11, 'Criminal Record', 'Providing false information is a serious offence. All declarations are subject to verification.', `
    <div class="form-group">
      <label class="form-label" for="s11_convicted">Have you ever been convicted of a criminal offence? <span class="required">*</span></label>
      <select id="s11_convicted" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
    <div class="form-group hidden" id="s11_convDetails">
      <label class="form-label" for="s11_convictionDetails">Please provide full details</label>
      <textarea id="s11_convictionDetails" class="form-control" rows="4"></textarea>
    </div>
    <div class="form-group">
      <label class="form-label" for="s11_deportation">Have you ever been deported or removed from any country? <span class="required">*</span></label>
      <select id="s11_deportation" class="form-control" required>
        <option value="">Select…</option>
        <option value="no">No</option>
        <option value="yes">Yes</option>
      </select>
    </div>
    <div class="card" style="border-color:var(--warning-dim);background:var(--warning-dim);margin-top:var(--space-5)">
      <p style="font-size:0.875rem;color:var(--warning)">
        <i class="fa-solid fa-triangle-exclamation" style="margin-right:6px"></i>
        Disclosure of relevant information does not automatically disqualify your application.
        Dishonest declarations may result in visa refusal and application cancellation.
      </p>
    </div>`);
}

function buildReferenceSection() {
  return sectionWrap(12, 'References', 'Provide at least two academic or professional referees.', `
    <div class="repeat-group">
      <div class="repeat-group-header"><h3 class="repeat-group-title">Reference 1 (Academic Preferred)</h3></div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label" for="s12_ref1Name">Full Name <span class="required">*</span></label>
          <input type="text" id="s12_ref1Name" class="form-control" required/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref1Title">Title / Position <span class="required">*</span></label>
          <input type="text" id="s12_ref1Title" class="form-control" required placeholder="e.g. Professor, Head of Department"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref1Institute">Institution / Organisation <span class="required">*</span></label>
          <input type="text" id="s12_ref1Institute" class="form-control" required/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref1Email">Email <span class="required">*</span></label>
          <input type="email" id="s12_ref1Email" class="form-control" required/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref1Phone">Phone</label>
          <input type="tel" id="s12_ref1Phone" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref1Relation">Relationship to You</label>
          <select id="s12_ref1Relation" class="form-control">
            <option>Academic supervisor</option><option>Lecturer</option>
            <option>Employer</option><option>Manager</option><option>Other</option>
          </select>
        </div>
      </div>
    </div>
    <div class="repeat-group">
      <div class="repeat-group-header"><h3 class="repeat-group-title">Reference 2</h3></div>
      <div class="form-grid-2">
        <div class="form-group">
          <label class="form-label" for="s12_ref2Name">Full Name</label>
          <input type="text" id="s12_ref2Name" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref2Title">Title / Position</label>
          <input type="text" id="s12_ref2Title" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref2Email">Email</label>
          <input type="email" id="s12_ref2Email" class="form-control"/>
        </div>
        <div class="form-group">
          <label class="form-label" for="s12_ref2Phone">Phone</label>
          <input type="tel" id="s12_ref2Phone" class="form-control"/>
        </div>
      </div>
    </div>`);
}

function buildStatementSection() {
  return sectionWrap(13, 'Personal Statement', 'Tell us about yourself, your goals, and why you want to study abroad.', `
    <div class="form-group">
      <label class="form-label" for="s13_statement">Personal Statement <span class="required">*</span></label>
      <textarea id="s13_statement" class="form-control" rows="14"
        required minlength="300" maxlength="4000"
        placeholder="Write 300–4,000 characters about your academic background, career goals, why you chose this programme, and how studying abroad will help you achieve your ambitions…"></textarea>
      <div style="display:flex;justify-content:space-between;margin-top:6px">
        <span class="form-hint">Minimum 300 characters</span>
        <span class="form-hint" id="s13_charCount">0 / 4000</span>
      </div>
    </div>
    <div class="form-group">
      <label class="form-label" for="s13_careerGoals">Career Goals After Graduation <span class="required">*</span></label>
      <textarea id="s13_careerGoals" class="form-control" rows="4" required
        placeholder="Where do you see yourself 5 years after graduating?"></textarea>
    </div>`);
}

function buildDocumentsSection() {
  const docs = [
    { key:'passport_bio',  label:'Passport Biographic Page', hint:'Clear scan of the photo page' },
    { key:'transcript',    label:'Academic Transcripts',      hint:'All qualification transcripts' },
    { key:'certificate',   label:'Degree / School Certificate', hint:'Final award certificates' },
    { key:'english_cert',  label:'English Language Certificate', hint:'IELTS, TOEFL, or equivalent' },
    { key:'cv',            label:'CV / Résumé',               hint:'Current CV, max 2 pages' },
    { key:'ref_letter1',   label:'Reference Letter 1',        hint:'On official letterhead' },
    { key:'ref_letter2',   label:'Reference Letter 2',        hint:'On official letterhead' },
    { key:'bank_statement',label:'Bank Statement / Proof of Funds', hint:'Last 3 months' },
    { key:'photo',         label:'Passport-sized Photo',      hint:'White background, recent' },
  ];

  const slotsHtml = docs.map(d => `
    <div class="doc-slot" id="docSlot_${d.key}" data-doc="${d.key}">
      <div class="doc-slot-header">
        <div class="doc-status-icon pending" id="docIcon_${d.key}" aria-hidden="true">
          <i class="fa-solid fa-clock"></i>
        </div>
        <div style="flex:1">
          <div style="font-weight:600;font-size:0.9375rem">${d.label}</div>
          <div style="font-size:0.8125rem;color:var(--muted);margin-top:2px">${d.hint} · PDF or Image · Max 10 MB</div>
        </div>
        <div id="docActions_${d.key}">
          <label class="btn btn-ghost btn-sm" for="docInput_${d.key}" style="cursor:pointer">
            <i class="fa-solid fa-upload" aria-hidden="true"></i> Upload
          </label>
          <input type="file" id="docInput_${d.key}" class="hidden" accept=".pdf,.jpg,.jpeg,.png,.webp"
            data-doc="${d.key}" data-label="${d.label}"/>
        </div>
      </div>
      <div class="upload-progress-item hidden" id="docProgress_${d.key}">
        <div class="upload-progress-header">
          <span class="upload-progress-name" id="docProgressName_${d.key}"></span>
          <span class="upload-progress-pct" id="docProgressPct_${d.key}">0%</span>
        </div>
        <div class="progress-bar-track"><div class="progress-bar-fill" id="docProgressBar_${d.key}" style="width:0%"></div></div>
      </div>
    </div>`).join('');

  return sectionWrap(14, 'Documents Upload', 'Upload all required supporting documents. Files are encrypted and stored securely.', slotsHtml);
}

function buildPaymentSection() {
  return sectionWrap(15, 'Application Fee', 'A one-time, non-refundable application fee of £150 is required to process your application.', `
    <div class="payment-summary">
      <div class="payment-summary-header">
        <i class="fa-solid fa-receipt" style="color:var(--gold)" aria-hidden="true"></i>
        <h3 class="payment-summary-title">Payment Summary</h3>
      </div>
      <div class="payment-line-items">
        <div class="payment-line">
          <span class="pline-label">Application Processing Fee</span>
          <span class="pline-amount">£150.00</span>
        </div>
        <div class="payment-line">
          <span class="pline-label">VAT (0%)</span>
          <span class="pline-amount">£0.00</span>
        </div>
        <div class="payment-line total">
          <span class="pline-label">Total Due</span>
          <span class="pline-amount">£150.00</span>
        </div>
      </div>
    </div>

    <h3 class="subsection-title"><i class="fa-solid fa-building-columns"></i> Bank Transfer Details</h3>
    <div class="bank-details">
      <div class="bank-detail-row">
        <span class="bank-key">Bank Name</span>
        <span class="bank-val">Barclays Bank UK
          <button class="copy-btn" onclick="navigator.clipboard.writeText('Barclays Bank UK')" aria-label="Copy bank name"><i class="fa-solid fa-copy"></i></button>
        </span>
      </div>
      <div class="bank-detail-row">
        <span class="bank-key">Account Name</span>
        <span class="bank-val">Cyndy Educational Pathways Ltd
          <button class="copy-btn" onclick="navigator.clipboard.writeText('Cyndy Educational Pathways Ltd')" aria-label="Copy account name"><i class="fa-solid fa-copy"></i></button>
        </span>
      </div>
      <div class="bank-detail-row">
        <span class="bank-key">Sort Code</span>
        <span class="bank-val">20-00-00
          <button class="copy-btn" onclick="navigator.clipboard.writeText('20-00-00')" aria-label="Copy sort code"><i class="fa-solid fa-copy"></i></button>
        </span>
      </div>
      <div class="bank-detail-row">
        <span class="bank-key">Account Number</span>
        <span class="bank-val">12345678
          <button class="copy-btn" onclick="navigator.clipboard.writeText('12345678')" aria-label="Copy account number"><i class="fa-solid fa-copy"></i></button>
        </span>
      </div>
      <div class="bank-detail-row">
        <span class="bank-key">IBAN / SWIFT</span>
        <span class="bank-val">GB00BARC00000012345678
          <button class="copy-btn" onclick="navigator.clipboard.writeText('GB00BARC00000012345678')" aria-label="Copy IBAN"><i class="fa-solid fa-copy"></i></button>
        </span>
      </div>
    </div>
    <p class="form-hint" style="margin-bottom:var(--space-5)">
      Use your application reference code as the payment reference so we can match your payment quickly.
    </p>

    <div class="form-group">
      <label class="form-label" for="s15_payRef">Payment Reference Used <span class="required">*</span></label>
      <input type="text" id="s15_payRef" class="form-control" required placeholder="e.g. CEP-2026-XXXX"/>
    </div>

    <div class="form-group">
      <label class="form-label">Upload Payment Receipt <span class="required">*</span></label>
      <div class="drop-zone" id="receiptDropzone" style="padding:var(--space-6)">
        <div class="drop-icon"><i class="fa-solid fa-file-invoice" aria-hidden="true"></i></div>
        <p class="drop-title">Upload Bank Receipt</p>
        <p class="drop-subtitle">PDF or image, max 10 MB</p>
        <input type="file" id="receiptFile" accept=".pdf,.jpg,.jpeg,.png" class="hidden"/>
      </div>
      <div id="receiptPreview" class="hidden"></div>
    </div>`);
}

function buildDeclarationSection() {
  return sectionWrap(16, 'Declaration & Submit', 'Please read and confirm the following declaration before submitting your application.', `
    <div class="card" style="border-color:var(--gold-border);margin-bottom:var(--space-6)">
      <h3 style="font-family:var(--font-display);font-size:1.1rem;margin-bottom:var(--space-4)">Declaration</h3>
      <p style="font-size:0.9rem;color:var(--text-secondary);line-height:1.8">
        I declare that the information provided in this application is true, accurate, and complete to the best of my knowledge. I understand that providing false or misleading information may result in the rejection of my application, withdrawal of any offer of admission, and possible reporting to the relevant authorities.
        <br/><br/>
        I consent to Cyndy Educational Pathways processing my personal data for the purpose of managing my application, communicating with partner universities on my behalf, and providing me with relevant updates and notifications.
        <br/><br/>
        I understand that the application fee of £150 is non-refundable once my application has been submitted and processed.
      </p>
    </div>

    <div style="display:flex;flex-direction:column;gap:var(--space-4)">
      <label style="display:flex;align-items:flex-start;gap:var(--space-3);cursor:pointer">
        <input type="checkbox" id="s16_agree1" required style="margin-top:3px;flex-shrink:0"/>
        <span style="font-size:0.9375rem">I confirm that all information provided is accurate and complete.</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:var(--space-3);cursor:pointer">
        <input type="checkbox" id="s16_agree2" required style="margin-top:3px;flex-shrink:0"/>
        <span style="font-size:0.9375rem">I consent to my data being processed as described in the Privacy Policy.</span>
      </label>
      <label style="display:flex;align-items:flex-start;gap:var(--space-3);cursor:pointer">
        <input type="checkbox" id="s16_agree3" required style="margin-top:3px;flex-shrink:0"/>
        <span style="font-size:0.9375rem">I understand the application fee (£150) is non-refundable.</span>
      </label>
    </div>

    <div style="margin-top:var(--space-6)">
      <label class="form-label" for="s16_signature">Full Legal Name (acts as digital signature) <span class="required">*</span></label>
      <input type="text" id="s16_signature" class="form-control" required
        placeholder="Type your full legal name as it appears on your passport"/>
    </div>
    <div class="form-group">
      <label class="form-label" for="s16_signDate">Date <span class="required">*</span></label>
      <input type="date" id="s16_signDate" class="form-control" required/>
    </div>`);
}

// ─── SUBMIT APPLICATION ───────────────────────────────────────
async function submitApplication() {
  // Validate declaration
  const agree1 = document.getElementById('s16_agree1')?.checked;
  const agree2 = document.getElementById('s16_agree2')?.checked;
  const agree3 = document.getElementById('s16_agree3')?.checked;
  const sig    = document.getElementById('s16_signature')?.value.trim();

  if (!agree1 || !agree2 || !agree3) {
    toast('Please confirm all three declarations.', 'warning'); return;
  }
  if (!sig) {
    toast('Please type your full legal name as a digital signature.', 'warning'); return;
  }

  // Save final section
  await saveSection(16);

  const btn = document.getElementById('submitAppBtn');
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Submitting…'; }

  const { error } = await supabase
    .from('applications')
    .update({
      status:       'submitted',
      submitted_at: new Date().toISOString(),
    })
    .eq('id', applicationId);

  if (error) {
    toast('Submission failed. Please try again.', 'error');
    if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Submit Application'; }
    return;
  }

  // Audit log
  await supabase.from('audit_logs').insert({
    application_id: applicationId,
    action:         'submitted',
    actor_id:       userId,
  });

  // Show success
  document.getElementById('wizardHeader')?.classList.add('hidden');
  document.getElementById('wizardPanels')?.classList.add('hidden');

  const success = document.getElementById('submitSuccess');
  if (success) {
    success.classList.remove('hidden');
    // Get ref code
    const { data } = await supabase
      .from('applications').select('ref_code').eq('id', applicationId).single();
    const refEl = document.getElementById('submitRefCode');
    if (refEl && data) refEl.textContent = data.ref_code;
  }
}
