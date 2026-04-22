/* ============================================================
   CYNDY — WORKER.JS
   Worker dashboard: applications table, document review,
   drawer detail, status changes, notes, bulk actions
   ============================================================ */

import {
  supabase, toast, fmtDate, fmtDateTime, relativeTime,
  APP_STATUS_LABELS, debounce, truncate, escapeHtml,
  fetchApplications, fetchApplication, updateAppStatus,
  getSignedUrl, BUCKETS,
} from './config.js';

let ctx        = null;
let allApps    = [];
let filteredApps = [];
let currentApp = null;
let page       = 1;
const PAGE_SIZE = 15;

// ─── INIT ─────────────────────────────────────────────────────
export async function initWorkerDashboard(_ctx) {
  ctx = _ctx;

  // Nav
  document.querySelectorAll('.nav-item[data-page]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
      item.classList.add('active');
      document.getElementById('dashPageTitle').textContent = item.querySelector('.nav-item-label')?.textContent || '';
    });
  });

  // Filters
  const tableSearch  = document.getElementById('tableSearch');
  const filterStatus = document.getElementById('filterStatus');
  tableSearch?.addEventListener('input', debounce(() => applyFilters(), 300));
  filterStatus?.addEventListener('change', () => applyFilters());
  document.getElementById('clearFiltersBtn')?.addEventListener('click', () => {
    if (tableSearch)  tableSearch.value  = '';
    if (filterStatus) filterStatus.value = '';
    applyFilters();
  });

  // Select all
  document.getElementById('selectAll')?.addEventListener('change', (e) => {
    document.querySelectorAll('.row-check').forEach(cb => cb.checked = e.target.checked);
    updateBulkBar();
  });

  // Notification button
  const notifBtn      = document.getElementById('notifBtn');
  const notifDropdown = document.getElementById('notifDropdown');
  notifBtn?.addEventListener('click', () => notifDropdown?.classList.toggle('open'));
  document.addEventListener('click', (e) => {
    if (!notifBtn?.contains(e.target) && !notifDropdown?.contains(e.target)) {
      notifDropdown?.classList.remove('open');
    }
  });

  // Drawer
  document.getElementById('drawerClose')?.addEventListener('click', closeDrawer);
  document.getElementById('appDrawerOverlay')?.addEventListener('click', (e) => {
    if (e.target === document.getElementById('appDrawerOverlay')) closeDrawer();
  });

  // Drawer tabs
  document.querySelectorAll('#drawerTabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#drawerTabs .tab-btn').forEach(b => {
        b.classList.remove('active');
        b.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.admin-tab-content').forEach(p => p.classList.remove('active'));
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      const tabId = btn.dataset.tab;
      document.getElementById(`tab-${tabId}`)?.classList.add('active');
    });
  });

  // Note buttons
  document.getElementById('addNoteBtn')?.addEventListener('click', () => addNote(true));
  document.getElementById('addClientNoteBtn')?.addEventListener('click', () => addNote(false));

  // Bulk actions
  document.getElementById('bulkMarkReview')?.addEventListener('click', bulkMarkReview);
  document.getElementById('bulkReject')?.addEventListener('click',     bulkReject);
  document.getElementById('bulkDownloadZip')?.addEventListener('click', () => toast('ZIP download requires backend integration.', 'info'));

  // Export
  document.getElementById('exportBtn')?.addEventListener('click', exportCsv);

  // Load data
  await loadDashboard();

  // Realtime
  subscribeRealtime();
}

// ─── LOAD DASHBOARD ───────────────────────────────────────────
async function loadDashboard() {
  await Promise.all([loadStats(), loadApplicationsList()]);
}

// ─── STATS ────────────────────────────────────────────────────
async function loadStats() {
  const workerId = ctx.user.id;
  const isAdmin  = ctx.profile.role === 'admin';

  const baseQuery = () => {
    let q = supabase.from('applications').select('id, status', { count: 'exact', head: false });
    if (!isAdmin) q = q.eq('assigned_worker_id', workerId);
    return q;
  };

  const [assigned, pending, completed, docsReview] = await Promise.all([
    baseQuery(),
    baseQuery().in('status', ['submitted','docs_pending','docs_complete']),
    baseQuery().in('status', ['accepted','rejected'])
      .gte('updated_at', new Date(Date.now() - 30*86400*1000).toISOString()),
    supabase.from('documents').select('id', { count: 'exact', head: true }).eq('status', 'uploaded'),
  ]);

  document.getElementById('statAssigned').textContent  = assigned.data?.length  || 0;
  document.getElementById('statPending').textContent   = pending.data?.length   || 0;
  document.getElementById('statCompleted').textContent = completed.data?.length || 0;
  document.getElementById('statDocsReview').textContent= docsReview.count       || 0;

  const pendingCount = document.getElementById('pendingCount');
  if (pendingCount) pendingCount.textContent = pending.data?.length || 0;
}

// ─── APPLICATIONS LIST ────────────────────────────────────────
async function loadApplicationsList() {
  const workerId = ctx.user.id;
  const isAdmin  = ctx.profile.role === 'admin';

  let q = supabase
    .from('applications')
    .select(`
      id, ref_code, status, submitted_at, updated_at, payment_status,
      profiles:client_id ( full_name, email, nationality ),
      programs:program_id ( name, university, country ),
      documents ( id, status )
    `)
    .order('updated_at', { ascending: false });

  if (!isAdmin) q = q.eq('assigned_worker_id', workerId);

  const { data, error } = await q;

  if (error) { toast('Failed to load applications.', 'error'); return; }
  allApps = data || [];
  applyFilters();
}

// ─── FILTERS ──────────────────────────────────────────────────
function applyFilters() {
  const search = document.getElementById('tableSearch')?.value.toLowerCase() || '';
  const status = document.getElementById('filterStatus')?.value || '';

  filteredApps = allApps.filter(app => {
    const matchSearch =
      !search ||
      app.ref_code?.toLowerCase().includes(search) ||
      app.profiles?.full_name?.toLowerCase().includes(search) ||
      app.profiles?.email?.toLowerCase().includes(search) ||
      app.programs?.name?.toLowerCase().includes(search);
    const matchStatus = !status || app.status === status;
    return matchSearch && matchStatus;
  });

  page = 1;
  renderTable();
}

// ─── RENDER TABLE ─────────────────────────────────────────────
function renderTable() {
  const tbody    = document.getElementById('appsTableBody');
  const countEl  = document.getElementById('tableCount');
  if (!tbody) return;

  const total    = filteredApps.length;
  const from     = (page - 1) * PAGE_SIZE;
  const to       = Math.min(from + PAGE_SIZE, total);
  const pageData = filteredApps.slice(from, to);

  if (countEl) countEl.textContent = `${total} application${total !== 1 ? 's' : ''}`;

  if (!pageData.length) {
    tbody.innerHTML = `<tr><td colspan="9">
      <div class="empty-state" style="padding:var(--space-12)">
        <div class="empty-state-icon">📋</div>
        <p class="empty-state-title">No applications found</p>
        <p class="text-muted text-sm">Try adjusting your filters.</p>
      </div>
    </td></tr>`;
    renderPagination(total);
    return;
  }

  tbody.innerHTML = pageData.map(app => {
    const docsTotal    = app.documents?.length || 0;
    const docsVerified = app.documents?.filter(d => d.status === 'verified').length || 0;
    const client       = app.profiles;
    const prog         = app.programs;

    return `
    <tr id="row-${app.id}" onclick="openDrawerById('${app.id}')" style="cursor:pointer">
      <td onclick="event.stopPropagation()">
        <input type="checkbox" class="row-checkbox row-check" data-id="${app.id}" onchange="updateBulkBar()" aria-label="Select ${app.ref_code}"/>
      </td>
      <td><code style="font-size:0.8rem;color:var(--gold)">${app.ref_code}</code></td>
      <td>
        <div style="font-weight:500">${escapeHtml(client?.full_name || '—')}</div>
        <div style="font-size:0.8rem;color:var(--muted)">${escapeHtml(client?.email || '')}</div>
        <div style="font-size:0.75rem;color:var(--muted)">${escapeHtml(client?.nationality || '')}</div>
      </td>
      <td>
        <div style="font-weight:500;font-size:0.875rem">${escapeHtml(prog?.name || '—')}</div>
        <div style="font-size:0.8rem;color:var(--muted)">${escapeHtml(prog?.university || '')}</div>
      </td>
      <td><span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status] || app.status}</span></td>
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-2)">
          <div class="progress-bar-track" style="width:60px;height:4px">
            <div class="progress-bar-fill" style="width:${docsTotal?Math.round(docsVerified/docsTotal*100):0}%"></div>
          </div>
          <span style="font-size:0.8rem;color:var(--muted)">${docsVerified}/${docsTotal}</span>
        </div>
      </td>
      <td>
        <span class="badge badge-${app.payment_status === 'verified' ? 'success' : app.payment_status === 'receipt_uploaded' ? 'warning' : 'muted'}">
          ${app.payment_status || 'pending'}
        </span>
      </td>
      <td style="font-size:0.875rem;color:var(--text-secondary)">${app.submitted_at ? fmtDate(app.submitted_at) : '—'}</td>
      <td>
        <div class="row-actions" onclick="event.stopPropagation()">
          <button class="row-action-btn gold" onclick="openDrawerById('${app.id}')" title="View details" aria-label="View ${app.ref_code}">
            <i class="fa-solid fa-eye" aria-hidden="true"></i>
          </button>
          <button class="row-action-btn success" onclick="quickStatus('${app.id}','accepted')" title="Accept" aria-label="Accept">
            <i class="fa-solid fa-check" aria-hidden="true"></i>
          </button>
          <button class="row-action-btn danger" onclick="quickStatus('${app.id}','rejected')" title="Reject" aria-label="Reject">
            <i class="fa-solid fa-xmark" aria-hidden="true"></i>
          </button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderPagination(total);
}

// ─── PAGINATION ───────────────────────────────────────────────
function renderPagination(total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const info     = document.getElementById('paginationInfo');
  const controls = document.getElementById('paginationControls');

  const from = Math.min((page - 1) * PAGE_SIZE + 1, total);
  const to   = Math.min(page * PAGE_SIZE, total);
  if (info) info.textContent = total ? `Showing ${from}–${to} of ${total}` : 'No results';
  if (!controls) return;

  controls.innerHTML = '';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'page-btn';
  prevBtn.innerHTML = '<i class="fa-solid fa-chevron-left"></i>';
  prevBtn.disabled = page === 1;
  prevBtn.addEventListener('click', () => { page--; renderTable(); });
  controls.appendChild(prevBtn);

  for (let p = Math.max(1, page - 2); p <= Math.min(totalPages, page + 2); p++) {
    const btn = document.createElement('button');
    btn.className = `page-btn ${p === page ? 'active' : ''}`;
    btn.textContent = p;
    btn.addEventListener('click', () => { page = p; renderTable(); });
    controls.appendChild(btn);
  }

  const nextBtn = document.createElement('button');
  nextBtn.className = 'page-btn';
  nextBtn.innerHTML = '<i class="fa-solid fa-chevron-right"></i>';
  nextBtn.disabled = page >= totalPages;
  nextBtn.addEventListener('click', () => { page++; renderTable(); });
  controls.appendChild(nextBtn);
}

// ─── DRAWER ───────────────────────────────────────────────────
window.openDrawerById = async function(id) {
  const overlay = document.getElementById('appDrawerOverlay');
  overlay?.classList.add('open');
  document.body.style.overflow = 'hidden';

  // Load full application
  const { data, error } = await fetchApplication(id);
  if (error || !data) { toast('Failed to load application.', 'error'); return; }
  currentApp = data;

  renderDrawer(data);
};

function closeDrawer() {
  document.getElementById('appDrawerOverlay')?.classList.remove('open');
  document.body.style.overflow = '';
  currentApp = null;
}

function renderDrawer(app) {
  document.getElementById('drawerRefCode').textContent = `REF: ${app.ref_code}`;
  document.getElementById('drawerTitle').textContent   = app.profiles?.full_name || 'Application Details';

  renderDrawerStatus(app);
  renderDrawerDetails(app);
  renderDrawerDocs(app.documents || []);
  renderDrawerNotes(app.application_notes || []);
  renderDrawerTimeline(app.status, app.audit_logs || []);

  // Quick action buttons
  document.getElementById('drawerAcceptBtn')?.addEventListener('click', () => quickStatus(app.id, 'accepted'));
  document.getElementById('drawerRejectBtn')?.addEventListener('click', () => quickStatus(app.id, 'rejected'));
  document.getElementById('drawerDownloadPdf')?.addEventListener('click', () => toast('PDF generation coming soon.', 'info'));
  document.getElementById('drawerDownloadZip')?.addEventListener('click', () => toast('ZIP download requires backend integration.', 'info'));
}

function renderDrawerStatus(app) {
  const grid = document.getElementById('drawerStatusGrid');
  if (!grid) return;

  const statuses = ['submitted','docs_pending','docs_complete','under_review','offer_received','accepted','rejected'];
  const colorMap = {
    accepted:       'success',
    rejected:       'danger',
    offer_received: 'info',
    under_review:   'gold',
  };

  grid.innerHTML = statuses.map(s => {
    const isCurrent = s === app.status;
    const col = colorMap[s] || 'ghost';
    return `<button class="status-option-btn btn-${col}" onclick="quickStatus('${app.id}','${s}')"
      style="${isCurrent ? 'border-width:2.5px;opacity:1' : 'opacity:0.6'}"
      aria-pressed="${isCurrent}" aria-label="Set status to ${APP_STATUS_LABELS[s]}">
      ${APP_STATUS_LABELS[s]}
    </button>`;
  }).join('');
}

function renderDrawerDetails(app) {
  const container = document.getElementById('drawerDetails');
  if (!container) return;

  const rows = [
    ['Status',       `<span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status]}</span>`],
    ['Applicant',    escapeHtml(app.profiles?.full_name || '—')],
    ['Email',        escapeHtml(app.profiles?.email || '—')],
    ['Phone',        escapeHtml(app.profiles?.phone || '—')],
    ['Nationality',  escapeHtml(app.profiles?.nationality || '—')],
    ['Programme',    escapeHtml(app.programs?.name || '—')],
    ['University',   escapeHtml(app.programs?.university || '—')],
    ['Country',      escapeHtml(app.programs?.country || '—')],
    ['Assigned To',  escapeHtml(app.workers?.full_name || 'Unassigned')],
    ['Payment',      `<span class="badge badge-${app.payment_status === 'verified' ? 'success' : 'warning'}">${app.payment_status || '—'}</span>`],
    ['Submitted',    fmtDateTime(app.submitted_at) || '—'],
    ['Last Updated', fmtDateTime(app.updated_at)],
  ];

  container.innerHTML = `<div class="info-grid">` +
    rows.map(([k,v]) => `
      <div class="info-item">
        <div class="info-label">${k}</div>
        <div class="info-value">${v}</div>
      </div>`).join('') +
    `</div>`;
}

function renderDrawerDocs(docs) {
  const container = document.getElementById('drawerDocs');
  if (!container) return;

  if (!docs.length) {
    container.innerHTML = '<p class="text-sm text-muted" style="padding:var(--space-4)">No documents uploaded.</p>';
    return;
  }

  container.innerHTML = docs.map(doc => `
    <div class="doc-review-item">
      <i class="fa-solid fa-file doc-review-icon" aria-hidden="true"></i>
      <div class="doc-review-info">
        <div class="doc-review-name">${escapeHtml(doc.label)}</div>
        <div class="doc-review-meta">Status: ${doc.status}</div>
      </div>
      <div class="doc-review-actions">
        <button class="btn btn-success btn-sm" onclick="reviewDoc('${doc.id}','verified')" aria-label="Verify document">
          <i class="fa-solid fa-check" aria-hidden="true"></i> Verify
        </button>
        <button class="btn btn-danger btn-sm" onclick="reviewDoc('${doc.id}','rejected')" aria-label="Reject document">
          <i class="fa-solid fa-xmark" aria-hidden="true"></i> Reject
        </button>
        <button class="btn btn-ghost btn-sm" onclick="viewDoc('${doc.id}','${doc.storage_path}')" aria-label="View document">
          <i class="fa-solid fa-eye" aria-hidden="true"></i>
        </button>
      </div>
    </div>`).join('');
}

function renderDrawerNotes(notes) {
  const container = document.getElementById('drawerNotes');
  if (!container) return;

  if (!notes.length) {
    container.innerHTML = '<p class="text-sm text-muted">No notes yet.</p>';
    return;
  }

  container.innerHTML = notes.map(n => `
    <div class="internal-note ${n.is_internal ? '' : 'client-visible'}" style="${!n.is_internal ? 'border-color:var(--gold-border)' : ''}">
      <div class="internal-note-header">
        <span class="internal-note-author">${escapeHtml(n.author?.full_name || 'Team')}</span>
        ${!n.is_internal ? '<span class="badge badge-gold" style="font-size:0.65rem;padding:2px 6px">Client visible</span>' : ''}
        <span class="internal-note-time">${relativeTime(n.created_at)}</span>
      </div>
      <p class="internal-note-text">${escapeHtml(n.note)}</p>
    </div>`).join('');
}

function renderDrawerTimeline(currentStatus, logs) {
  const container = document.getElementById('drawerTimeline');
  if (!container) return;

  container.innerHTML = logs.map(log => `
    <div class="timeline-item">
      <div class="timeline-dot"><i class="fa-solid fa-circle-dot" style="font-size:0.5rem;color:var(--gold)"></i></div>
      <div>
        <div style="font-weight:500;font-size:0.875rem;text-transform:capitalize">
          ${log.action.replace(/_/g,' ')}
        </div>
        <div class="timeline-date">${fmtDateTime(log.created_at)}</div>
        ${log.note ? `<div class="timeline-desc">${escapeHtml(log.note)}</div>` : ''}
      </div>
    </div>`).join('') || '<p class="text-sm text-muted">No timeline entries.</p>';
}

// ─── QUICK STATUS CHANGE ──────────────────────────────────────
window.quickStatus = async function(id, status) {
  const note = status === 'rejected'
    ? prompt('Reason for rejection (optional):') || ''
    : '';

  const { error } = await updateAppStatus(id, status, ctx.user.id, note);
  if (error) { toast(`Failed to update status.`, 'error'); return; }

  toast(`Status updated to "${APP_STATUS_LABELS[status]}".`, 'success');
  await loadDashboard();

  if (currentApp?.id === id) {
    const { data } = await fetchApplication(id);
    if (data) renderDrawer(data);
  }
};

// ─── ADD NOTE ─────────────────────────────────────────────────
async function addNote(isInternal) {
  const textarea = document.getElementById('noteTextarea');
  const note     = textarea?.value.trim();
  if (!note || !currentApp) { toast('Please enter a note.', 'warning'); return; }

  const { error } = await supabase.from('application_notes').insert({
    application_id: currentApp.id,
    author_id:      ctx.user.id,
    note,
    is_internal:    isInternal,
  });

  if (error) { toast('Failed to save note.', 'error'); return; }
  if (textarea) textarea.value = '';
  toast('Note added.', 'success');

  const { data } = await fetchApplication(currentApp.id);
  if (data) renderDrawerNotes(data.application_notes || []);
}

// ─── DOCUMENT REVIEW ─────────────────────────────────────────
window.reviewDoc = async function(docId, status) {
  const { error } = await supabase
    .from('documents')
    .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: ctx.user.id })
    .eq('id', docId);

  if (error) { toast('Failed to update document.', 'error'); return; }
  toast(`Document ${status}.`, status === 'verified' ? 'success' : 'warning');

  if (currentApp) {
    const { data } = await fetchApplication(currentApp.id);
    if (data) renderDrawerDocs(data.documents || []);
  }
};

window.viewDoc = async function(docId, path) {
  const url = await getSignedUrl(BUCKETS.DOCUMENTS, path);
  if (url) window.open(url, '_blank');
  else toast('Could not open document.', 'error');
};

// ─── BULK ACTIONS ─────────────────────────────────────────────
window.updateBulkBar = function() {
  const checked = document.querySelectorAll('.row-check:checked');
  const bar     = document.getElementById('bulkBar');
  const count   = document.getElementById('bulkCount');
  if (bar)   bar.classList.toggle('hidden', checked.length === 0);
  if (count) count.textContent = `${checked.length} selected`;
};

async function bulkMarkReview() {
  const ids = [...document.querySelectorAll('.row-check:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  await Promise.all(ids.map(id => updateAppStatus(id, 'under_review', ctx.user.id)));
  toast(`${ids.length} application(s) marked Under Review.`, 'success');
  await loadDashboard();
}

async function bulkReject() {
  const ids = [...document.querySelectorAll('.row-check:checked')].map(cb => cb.dataset.id);
  if (!ids.length) return;
  if (!confirm(`Reject ${ids.length} application(s)? This cannot be undone.`)) return;
  await Promise.all(ids.map(id => updateAppStatus(id, 'rejected', ctx.user.id)));
  toast(`${ids.length} application(s) rejected.`, 'warning');
  await loadDashboard();
}

// ─── EXPORT CSV ───────────────────────────────────────────────
function exportCsv() {
  const headers = ['Reference','Applicant','Email','Programme','University','Status','Submitted'];
  const rows    = filteredApps.map(app => [
    app.ref_code,
    app.profiles?.full_name || '',
    app.profiles?.email     || '',
    app.programs?.name      || '',
    app.programs?.university|| '',
    APP_STATUS_LABELS[app.status] || app.status,
    app.submitted_at ? fmtDate(app.submitted_at) : '',
  ]);

  const csv  = [headers, ...rows].map(r => r.map(c => `"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `cyndy-applications-${new Date().toISOString().slice(0,10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── REALTIME ─────────────────────────────────────────────────
function subscribeRealtime() {
  supabase.channel('worker-apps')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'applications' }, () => {
      loadDashboard();
    })
    .subscribe();
}
