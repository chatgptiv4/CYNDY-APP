/* ============================================================
   CYNDY — STATUS.JS
   Real-time application status tracker for clients
   ============================================================ */

import {
  supabase, toast, fmtDate, fmtDateTime, relativeTime,
  APP_STATUS_LABELS, getSignedUrl, BUCKETS,
} from './config.js';

// Status → timeline stages
const TIMELINE_STAGES = [
  { status: 'draft',          icon: 'fa-file-pen',        label: 'Draft Created',        color: 'muted' },
  { status: 'submitted',      icon: 'fa-paper-plane',     label: 'Submitted',            color: 'info' },
  { status: 'docs_pending',   icon: 'fa-folder-open',     label: 'Documents Requested',  color: 'warning' },
  { status: 'docs_complete',  icon: 'fa-folder-check',    label: 'Documents Verified',   color: 'info' },
  { status: 'under_review',   icon: 'fa-magnifying-glass',label: 'Under Review',         color: 'gold' },
  { status: 'offer_received', icon: 'fa-envelope-open',   label: 'Offer Received',       color: 'success' },
  { status: 'accepted',       icon: 'fa-graduation-cap',  label: 'Accepted!',            color: 'success' },
];

const STATUS_ORDER = TIMELINE_STAGES.map(s => s.status);

let realtimeChannel = null;
let ctx = null;

// ─── INIT ─────────────────────────────────────────────────────
export async function initStatusPage(_ctx) {
  ctx = _ctx;

  await loadApplications();

  // Withdraw modal
  const withdrawBtn     = document.getElementById('withdrawBtn');
  const withdrawModal   = document.getElementById('withdrawModal');
  const withdrawClose   = document.getElementById('withdrawClose');
  const withdrawCancel  = document.getElementById('withdrawCancel');
  const withdrawConfirm = document.getElementById('withdrawConfirm');

  withdrawBtn?.addEventListener('click', () => withdrawModal?.classList.add('open'));
  withdrawClose?.addEventListener('click', () => withdrawModal?.classList.remove('open'));
  withdrawCancel?.addEventListener('click', () => withdrawModal?.classList.remove('open'));
  withdrawConfirm?.addEventListener('click', handleWithdraw);

  // Refresh
  document.getElementById('refreshBtn')?.addEventListener('click', loadApplications);

  // Download PDF (placeholder)
  document.getElementById('downloadPdfBtn')?.addEventListener('click', () => {
    toast('PDF generation coming soon.', 'info');
  });
}

// ─── LOAD APPLICATIONS ────────────────────────────────────────
async function loadApplications() {
  showSkeleton(true);

  const { data, error } = await supabase
    .from('applications')
    .select(`
      id, ref_code, status, submitted_at, updated_at, created_at,
      sec_personal_complete, sec_contact_complete, sec_family_complete,
      sec_education_complete, sec_english_complete, sec_employment_complete,
      sec_program_complete, sec_finance_complete, sec_travel_complete,
      sec_medical_complete, sec_criminal_complete, sec_reference_complete,
      sec_statement_complete, sec_documents_complete, sec_payment_complete,
      sec_declaration_complete, payment_status,
      programs:program_id ( name, university, country, intake, tuition_fee ),
      documents ( id, label, doc_type, status, storage_path ),
      application_notes ( id, note, is_internal, created_at ),
      audit_logs:audit_logs ( id, action, created_at )
    `)
    .eq('client_id', ctx.user.id)
    .order('created_at', { ascending: false });

  showSkeleton(false);

  if (error) {
    toast('Failed to load applications.', 'error');
    console.error(error);
    return;
  }

  if (!data || data.length === 0) {
    document.getElementById('statusContent').classList.remove('hidden');
    document.getElementById('statusLayout').classList.add('hidden');
    document.getElementById('noAppState').classList.remove('hidden');
    return;
  }

  document.getElementById('statusContent').classList.remove('hidden');

  if (data.length > 1) {
    renderAppPicker(data);
  }

  renderStatus(data[0]);
  subscribeRealtime(data[0].id);
}

// ─── APP PICKER ───────────────────────────────────────────────
function renderAppPicker(apps) {
  const picker = document.getElementById('appPicker');
  const grid   = document.getElementById('appPickerGrid');
  if (!picker || !grid) return;

  picker.classList.remove('hidden');
  grid.innerHTML = apps.map((app, i) => `
    <div class="app-selector-card ${i === 0 ? 'active' : ''}" data-id="${app.id}" onclick="selectApp('${app.id}')">
      <p class="app-sel-university">${app.programs?.university || 'No programme selected'}</p>
      <p class="app-sel-program">${app.programs?.name || 'Draft Application'}</p>
      <div class="app-sel-footer">
        <span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status] || app.status}</span>
        <span class="text-sm text-muted">${fmtDate(app.created_at)}</span>
      </div>
    </div>
  `).join('') + `
    <div class="app-selector-card app-add-card" onclick="location.href='/apply.html'">
      <i class="fa-solid fa-plus"></i>
      <span>New Application</span>
    </div>`;
}

// ─── RENDER STATUS ────────────────────────────────────────────
function renderStatus(app) {
  // Programme info
  const progName = app.programs?.name || 'Application in Progress';
  const uni      = app.programs?.university || 'University TBD';
  const country  = app.programs?.country || '';
  document.getElementById('statusRefCode').textContent     = `REF: ${app.ref_code}`;
  document.getElementById('statusProgramName').textContent = progName;
  document.getElementById('statusDestination').querySelector('span').textContent =
    [uni, country].filter(Boolean).join(' · ');

  // Completion %
  const fields = [
    'sec_personal_complete','sec_contact_complete','sec_family_complete',
    'sec_education_complete','sec_english_complete','sec_employment_complete',
    'sec_program_complete','sec_finance_complete','sec_travel_complete',
    'sec_medical_complete','sec_criminal_complete','sec_reference_complete',
    'sec_statement_complete','sec_documents_complete','sec_payment_complete',
    'sec_declaration_complete',
  ];
  const completed = fields.filter(f => app[f]).length;
  const pct = Math.round(completed / fields.length * 100);
  document.getElementById('statusPct').textContent        = `${pct}%`;
  document.getElementById('statusProgress').style.width  = `${pct}%`;

  // Status badge
  document.getElementById('statusBadgeWrap').innerHTML =
    `<span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status] || app.status}</span>`;

  // Dates
  document.getElementById('statusSubmitted').textContent = fmtDate(app.submitted_at) || 'Not yet submitted';
  document.getElementById('statusUpdated').textContent   = relativeTime(app.updated_at);

  // Disable edit if past draft
  if (app.status !== 'draft') {
    document.getElementById('editAppBtn')?.setAttribute('disabled', 'true');
  }

  // Hide withdraw if already withdrawn/rejected
  if (['rejected','withdrawn','accepted'].includes(app.status)) {
    document.getElementById('withdrawBtn')?.classList.add('hidden');
  }

  // Timeline
  renderTimeline(app.status, app);

  // Documents
  renderDocuments(app.documents || []);

  // App details sidebar
  renderDetails(app);

  // Activity feed
  renderActivity(app.audit_logs || []);

  // Team notes
  renderTeamNotes(app.application_notes?.filter(n => !n.is_internal) || []);
}

// ─── TIMELINE ─────────────────────────────────────────────────
function renderTimeline(currentStatus, app) {
  const container = document.getElementById('statusTimeline');
  if (!container) return;

  const currentIndex = STATUS_ORDER.indexOf(currentStatus);
  const isRejected   = currentStatus === 'rejected';
  const isWithdrawn  = currentStatus === 'withdrawn';

  container.innerHTML = '';

  TIMELINE_STAGES.forEach((stage, i) => {
    const isDone    = i < currentIndex;
    const isActive  = i === currentIndex;
    const isFuture  = i > currentIndex;

    const item = document.createElement('div');
    item.className = `timeline-item ${isDone ? 'completed' : ''} ${isActive ? 'active' : ''}`;

    const colorMap = { gold: 'var(--gold)', info: 'var(--info)', success: 'var(--success)', warning: 'var(--warning)', muted: 'var(--muted)' };
    const dotColor = isDone ? 'var(--success)' : isActive ? colorMap[stage.color] : 'var(--muted)';

    item.innerHTML = `
      <div class="timeline-dot" style="${isActive ? `background:${dotColor};border-color:${dotColor};` : isDone ? 'background:var(--success);border-color:var(--success);' : ''}">
        <i class="fa-solid ${isDone ? 'fa-check' : stage.icon}" style="color:${isDone ? 'white' : isActive ? 'white' : 'var(--muted)'};font-size:0.7rem"></i>
      </div>
      <div>
        <div style="font-weight:${isActive ? '600' : '500'};font-size:0.9375rem;color:${isActive ? colorMap[stage.color] : isFuture ? 'var(--muted)' : 'var(--text-primary)'}">
          ${stage.label}
        </div>
        ${isActive ? `<div class="timeline-date">Current stage</div>` : isDone ? `<div class="timeline-date">Completed</div>` : `<div class="timeline-date" style="color:var(--muted)">Pending</div>`}
      </div>`;
    container.appendChild(item);
  });

  if (isRejected) {
    container.insertAdjacentHTML('beforeend', `
      <div class="timeline-item">
        <div class="timeline-dot" style="background:var(--danger);border-color:var(--danger)">
          <i class="fa-solid fa-xmark" style="color:white;font-size:0.7rem"></i>
        </div>
        <div>
          <div style="font-weight:600;color:var(--danger)">Application Not Successful</div>
          <div class="timeline-date">${fmtDate(app.rejected_at) || ''}</div>
        </div>
      </div>`);
  }
}

// ─── DOCUMENTS ────────────────────────────────────────────────
function renderDocuments(docs) {
  const container = document.getElementById('docsChecklist');
  if (!container) return;

  if (!docs.length) {
    container.innerHTML = '<p class="text-sm text-muted">No documents uploaded yet.</p>';
    return;
  }

  const iconMap = {
    pending:  { icon: 'fa-clock',      color: 'var(--muted)' },
    uploaded: { icon: 'fa-hourglass',  color: 'var(--info)' },
    verified: { icon: 'fa-check',      color: 'var(--success)' },
    rejected: { icon: 'fa-xmark',      color: 'var(--danger)' },
    expired:  { icon: 'fa-triangle-exclamation', color: 'var(--warning)' },
  };

  container.innerHTML = docs.map(doc => {
    const { icon, color } = iconMap[doc.status] || iconMap.pending;
    return `
      <div class="doc-slot ${doc.status}" style="margin-bottom:var(--space-2)">
        <div class="doc-slot-header">
          <div class="doc-status-icon ${doc.status}">
            <i class="fa-solid ${icon}" style="color:${color}"></i>
          </div>
          <div>
            <div style="font-weight:500;font-size:0.875rem">${doc.label}</div>
            <div style="font-size:0.8rem;color:var(--muted);text-transform:capitalize">${doc.status}</div>
          </div>
        </div>
      </div>`;
  }).join('');
}

// ─── DETAILS SIDEBAR ──────────────────────────────────────────
function renderDetails(app) {
  const container = document.getElementById('appDetailRows');
  if (!container) return;

  const rows = [
    { key: 'Reference',     val: app.ref_code },
    { key: 'Status',        val: `<span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status]}</span>` },
    { key: 'University',    val: app.programs?.university || '—' },
    { key: 'Programme',     val: app.programs?.name || '—' },
    { key: 'Intake',        val: app.programs?.intake?.[0] || '—' },
    { key: 'Tuition Fee',   val: app.programs?.tuition_fee ? `£${Number(app.programs.tuition_fee).toLocaleString()}` : '—' },
    { key: 'Payment',       val: `<span class="badge badge-${app.payment_status === 'verified' ? 'success' : 'warning'}">${app.payment_status || 'pending'}</span>` },
    { key: 'Created',       val: fmtDate(app.created_at) },
    { key: 'Submitted',     val: fmtDate(app.submitted_at) || 'Not submitted' },
  ];

  container.innerHTML = rows.map(r => `
    <div class="detail-row">
      <span class="detail-key">${r.key}</span>
      <span class="detail-val">${r.val}</span>
    </div>`).join('');
}

// ─── ACTIVITY FEED ────────────────────────────────────────────
function renderActivity(logs) {
  const container = document.getElementById('activityFeed');
  if (!container) return;

  if (!logs.length) {
    container.innerHTML = '<p class="text-sm text-muted">No activity yet.</p>';
    return;
  }

  const colorMap = {
    submitted:             'gold',
    status_changed_to_under_review: 'gold',
    status_changed_to_accepted:     'success',
    status_changed_to_rejected:     'danger',
    worker_assigned:       'info',
  };

  container.innerHTML = logs.slice(0, 8).map(log => {
    const col = colorMap[log.action] || 'info';
    const label = log.action.replace(/_/g, ' ').replace('status changed to ', 'Status → ');
    return `
      <div class="activity-item">
        <div class="activity-dot ${col}"></div>
        <div>
          <div class="activity-text" style="text-transform:capitalize">${label}</div>
          <div class="activity-time">${relativeTime(log.created_at)}</div>
        </div>
      </div>`;
  }).join('');
}

// ─── TEAM NOTES ───────────────────────────────────────────────
function renderTeamNotes(notes) {
  const container = document.getElementById('teamNotes');
  if (!container) return;

  if (!notes.length) {
    container.innerHTML = '<p class="text-sm text-muted">No messages yet.</p>';
    return;
  }

  container.innerHTML = notes.map(n => `
    <div class="internal-note">
      <div class="internal-note-header">
        <span class="internal-note-author">Cyndy Team</span>
        <span class="internal-note-time">${fmtDateTime(n.created_at)}</span>
      </div>
      <p class="internal-note-text">${n.note}</p>
    </div>`).join('');
}

// ─── REALTIME SUBSCRIPTION ────────────────────────────────────
function subscribeRealtime(applicationId) {
  if (realtimeChannel) supabase.removeChannel(realtimeChannel);

  realtimeChannel = supabase
    .channel(`app-status-${applicationId}`)
    .on('postgres_changes', {
      event:  'UPDATE',
      schema: 'public',
      table:  'applications',
      filter: `id=eq.${applicationId}`,
    }, async (payload) => {
      toast('Application status updated!', 'success', 3000);
      await loadApplications();
    })
    .on('postgres_changes', {
      event:  'INSERT',
      schema: 'public',
      table:  'application_notes',
      filter: `application_id=eq.${applicationId}`,
    }, () => {
      toast('New message from team.', 'info', 3000);
      loadApplications();
    })
    .subscribe();
}

// ─── WITHDRAW ─────────────────────────────────────────────────
async function handleWithdraw() {
  const { data: apps } = await supabase
    .from('applications')
    .select('id')
    .eq('client_id', ctx.user.id)
    .in('status', ['draft','submitted','docs_pending','docs_complete','under_review'])
    .limit(1)
    .single();

  if (!apps) { toast('No active application to withdraw.', 'warning'); return; }

  const { error } = await supabase
    .from('applications')
    .update({ status: 'withdrawn' })
    .eq('id', apps.id);

  document.getElementById('withdrawModal')?.classList.remove('open');

  if (error) { toast('Failed to withdraw. Please try again.', 'error'); return; }

  await supabase.from('audit_logs').insert({
    application_id: apps.id,
    action:         'withdrawn_by_client',
    actor_id:       ctx.user.id,
  });

  toast('Application withdrawn.', 'warning');
  await loadApplications();
}

// ─── HELPERS ──────────────────────────────────────────────────
function showSkeleton(show) {
  document.getElementById('statusSkeleton')?.classList.toggle('hidden', !show);
  document.getElementById('statusContent')?.classList.toggle('hidden', show);
}
