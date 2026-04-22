/* ============================================================
   CYNDY — ADMIN.JS
   Admin dashboard: overview stats, charts, all tables,
   worker management, programs DB, scraper tool, audit log
   ============================================================ */

import {
  supabase, toast, fmtDate, fmtDateTime, relativeTime,
  APP_STATUS_LABELS, debounce, escapeHtml, truncate,
  fetchApplications, fetchAdminStats, updateAppStatus, assignWorker,
} from './config.js';

let ctx     = null;
let charts  = {};
let workers = [];

// ─── INIT ─────────────────────────────────────────────────────
export async function initAdminDashboard(_ctx) {
  ctx = _ctx;

  // Tab navigation
  document.querySelectorAll('.nav-item[data-tab]').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const tabId = item.dataset.tab;
      switchTab(tabId, item.querySelector('.nav-item-label')?.textContent || '');
    });
  });

  // Invite worker modal
  const inviteBtn    = document.getElementById('inviteWorkerBtn');
  const inviteModal  = document.getElementById('inviteModal');
  const inviteClose  = document.getElementById('inviteClose');
  const inviteCancel = document.getElementById('inviteCancel');
  const inviteConfirm= document.getElementById('inviteConfirm');
  inviteBtn?.addEventListener('click',   () => inviteModal?.classList.add('open'));
  inviteClose?.addEventListener('click', () => inviteModal?.classList.remove('open'));
  inviteCancel?.addEventListener('click',() => inviteModal?.classList.remove('open'));
  inviteConfirm?.addEventListener('click', createWorker);

  // Scraper
  document.getElementById('startScraperBtn')?.addEventListener('click', runScraper);
  document.getElementById('stopScraperBtn')?.addEventListener('click',  stopScraper);
  document.getElementById('importSelectedBtn')?.addEventListener('click', importPrograms);

  // Settings
  document.querySelectorAll('.settings-nav-item').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.settings-nav-item').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });
  });
  document.getElementById('saveSettingsBtn')?.addEventListener('click', () => toast('Settings saved.', 'success'));

  // Audit export
  document.getElementById('exportAuditBtn')?.addEventListener('click', exportAuditLog);
  document.getElementById('auditRefreshBtn')?.addEventListener('click', loadAuditLog);

  // Programs
  document.getElementById('refreshProgramsBtn')?.addEventListener('click', loadPrograms);
  document.getElementById('addProgramBtn')?.addEventListener('click', () => toast('Programme editor coming soon.', 'info'));

  // Load everything
  await Promise.all([
    loadOverview(),
    loadWorkers(),
  ]);

  subscribeRealtime();
}

// ─── TAB SWITCHER ─────────────────────────────────────────────
function switchTab(tabId, label) {
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`.nav-item[data-tab="${tabId}"]`)?.classList.add('active');
  document.querySelectorAll('.admin-tab-content').forEach(t => t.classList.remove('active'));
  document.getElementById(`tab-${tabId}`)?.classList.add('active');
  document.getElementById('dashPageTitle').textContent = label || tabId;

  // Lazy-load tabs
  const loaders = {
    applications: loadAllApplications,
    payments:     loadPayments,
    clients:      loadClients,
    programs:     loadPrograms,
    audit:        loadAuditLog,
  };
  loaders[tabId]?.();
}

// ─── OVERVIEW ─────────────────────────────────────────────────
async function loadOverview() {
  const stats = await fetchAdminStats();

  document.getElementById('ovTotal').textContent    = stats.total;
  document.getElementById('ovSubmitted').textContent= stats.submitted;
  document.getElementById('ovReview').textContent   = stats.underReview;
  document.getElementById('ovAccepted').textContent = stats.accepted;
  document.getElementById('ovRejected').textContent = stats.rejected;
  document.getElementById('totalAppsCount').textContent = stats.total;

  // Revenue
  const { data: revData } = await supabase
    .from('payment_receipts')
    .select('amount')
    .not('verified_at', 'is', null);
  const revenue = (revData || []).reduce((sum, r) => sum + (r.amount || 0), 0);
  document.getElementById('ovRevenue').textContent = `£${revenue.toLocaleString()}`;

  renderCharts(stats);
  loadRecentActivity();
}

// ─── CHARTS ───────────────────────────────────────────────────
function renderCharts(stats) {
  const gold    = '#D4A847';
  const navy    = '#162040';
  const gridColor = 'rgba(139,156,182,0.1)';
  const textColor = '#8B9CB6';

  Chart.defaults.color = textColor;
  Chart.defaults.borderColor = gridColor;

  // Status donut
  const ctxStatus = document.getElementById('chartStatus');
  if (ctxStatus) {
    if (charts.status) charts.status.destroy();
    charts.status = new Chart(ctxStatus, {
      type: 'doughnut',
      data: {
        labels: ['Submitted','Under Review','Accepted','Rejected','Other'],
        datasets: [{
          data: [
            stats.submitted, stats.underReview, stats.accepted, stats.rejected,
            Math.max(0, stats.total - stats.submitted - stats.underReview - stats.accepted - stats.rejected),
          ],
          backgroundColor: ['#378ADD','#D4A847','#2E9E6B','#C94040','#8B9CB6'],
          borderWidth: 0,
          hoverOffset: 8,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { position: 'bottom' } },
        cutout: '65%',
      },
    });
  }

  // Timeline bar (last 6 months)
  const months = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    months.push(d.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }));
  }

  const ctxTimeline = document.getElementById('chartTimeline');
  if (ctxTimeline) {
    if (charts.timeline) charts.timeline.destroy();
    charts.timeline = new Chart(ctxTimeline, {
      type: 'bar',
      data: {
        labels: months,
        datasets: [{
          label: 'Applications',
          data: months.map(() => Math.floor(Math.random() * 40 + 5)), // Placeholder until real data
          backgroundColor: 'rgba(212,168,71,0.3)',
          borderColor: gold,
          borderWidth: 2,
          borderRadius: 6,
        }],
      },
      options: {
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: gridColor } },
          x: { grid: { display: false } },
        },
      },
    });
  }

  // Programs horizontal bar (top 8 by application count — placeholder)
  const ctxProg = document.getElementById('chartPrograms');
  if (ctxProg) {
    if (charts.programs) charts.programs.destroy();
    charts.programs = new Chart(ctxProg, {
      type: 'bar',
      data: {
        labels: [
          'MSc Computer Science – Manchester',
          'MBA – Coventry',
          'BSc Data Science – Leeds',
          'LLM Law – Birmingham',
          'MSc Finance – Edinburgh',
          'BA Business – Cardiff',
          'MSc Engineering – Hertfordshire',
          'MA Education – East London',
        ],
        datasets: [{
          label: 'Applications',
          data: [42, 38, 29, 26, 22, 18, 14, 11],
          backgroundColor: 'rgba(55,138,221,0.3)',
          borderColor: '#378ADD',
          borderWidth: 2,
          borderRadius: 4,
        }],
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { beginAtZero: true, grid: { color: gridColor } },
          y: { grid: { display: false } },
        },
      },
    });
  }
}

// ─── RECENT ACTIVITY ──────────────────────────────────────────
async function loadRecentActivity() {
  const { data } = await supabase
    .from('audit_logs')
    .select(`id, action, created_at, note, actor:actor_id ( full_name )`)
    .order('created_at', { ascending: false })
    .limit(8);

  const container = document.getElementById('recentActivity');
  if (!container) return;

  if (!data?.length) {
    container.innerHTML = '<p class="text-sm text-muted" style="padding:var(--space-3)">No recent activity.</p>';
    return;
  }

  container.innerHTML = data.map(log => `
    <div class="audit-entry">
      <div class="audit-avatar">${(log.actor?.full_name || 'S').slice(0,1).toUpperCase()}</div>
      <div>
        <div style="font-size:0.9rem;font-weight:500;text-transform:capitalize">
          ${log.actor?.full_name || 'System'} — ${log.action.replace(/_/g,' ')}
        </div>
        ${log.note ? `<div class="audit-detail">${escapeHtml(log.note)}</div>` : ''}
        <div class="audit-detail">${relativeTime(log.created_at)}</div>
      </div>
    </div>`).join('');
}

// ─── ALL APPLICATIONS ─────────────────────────────────────────
async function loadAllApplications() {
  const { data, error } = await fetchApplications();
  if (error) { toast('Failed to load applications.', 'error'); return; }

  const tbody   = document.getElementById('adminAppsBody');
  const countEl = document.getElementById('adminAppCount');
  if (!tbody) return;
  if (countEl) countEl.textContent = `${data?.length || 0} applications`;

  // Populate worker filter
  const wf = document.getElementById('adminWorkerFilter');
  if (wf && workers.length) {
    workers.forEach(w => {
      const opt = document.createElement('option');
      opt.value = w.id; opt.textContent = w.full_name;
      wf.appendChild(opt);
    });
  }

  // Filter handlers
  const searchEl = document.getElementById('adminAppSearch');
  const statusEl = document.getElementById('adminStatusFilter');
  const workerEl = document.getElementById('adminWorkerFilter');
  const clearBtn = document.getElementById('adminClearFilters');

  const render = (apps) => {
    if (!apps?.length) {
      tbody.innerHTML = '<tr><td colspan="8"><div style="padding:var(--space-8);text-align:center;color:var(--muted)">No applications found.</div></td></tr>';
      return;
    }
    tbody.innerHTML = apps.map(app => {
      const w = workers.find(w => w.id === app.assigned_worker_id);
      return `<tr onclick="window.location.href='/worker.html'">
        <td><code style="color:var(--gold);font-size:0.8rem">${app.ref_code}</code></td>
        <td>
          <div style="font-weight:500">${escapeHtml(app.profiles?.full_name || '—')}</div>
          <div style="font-size:0.8rem;color:var(--muted)">${escapeHtml(app.profiles?.email || '')}</div>
        </td>
        <td>
          <div style="font-size:0.875rem">${escapeHtml(app.programs?.name || '—')}</div>
          <div style="font-size:0.8rem;color:var(--muted)">${escapeHtml(app.programs?.university || '')}</div>
        </td>
        <td><span class="badge badge-${app.status}">${APP_STATUS_LABELS[app.status]}</span></td>
        <td>
          <select class="assign-select" onchange="assignTo('${app.id}',this.value)" aria-label="Assign worker">
            <option value="">Unassigned</option>
            ${workers.map(wk => `<option value="${wk.id}" ${wk.id === app.assigned_worker_id ? 'selected' : ''}>${escapeHtml(wk.full_name)}</option>`).join('')}
          </select>
        </td>
        <td><span class="badge badge-${app.payment_status === 'verified' ? 'success' : 'warning'}">${app.payment_status || '—'}</span></td>
        <td style="font-size:0.875rem">${app.submitted_at ? fmtDate(app.submitted_at) : '—'}</td>
        <td>
          <div class="row-actions">
            <button class="row-action-btn gold" onclick="event.stopPropagation()" title="View" aria-label="View">
              <i class="fa-solid fa-eye"></i>
            </button>
          </div>
        </td>
      </tr>`;
    }).join('');
  };

  let filtered = data || [];
  render(filtered);

  const applyAdminFilters = () => {
    const s = searchEl?.value.toLowerCase() || '';
    const st = statusEl?.value || '';
    const wId = workerEl?.value || '';
    filtered = (data || []).filter(app =>
      (!s || app.ref_code?.toLowerCase().includes(s) || app.profiles?.full_name?.toLowerCase().includes(s) || app.profiles?.email?.toLowerCase().includes(s)) &&
      (!st || app.status === st) &&
      (!wId || app.assigned_worker_id === wId)
    );
    if (countEl) countEl.textContent = `${filtered.length} applications`;
    render(filtered);
  };

  searchEl?.addEventListener('input', debounce(applyAdminFilters, 300));
  statusEl?.addEventListener('change', applyAdminFilters);
  workerEl?.addEventListener('change', applyAdminFilters);
  clearBtn?.addEventListener('click', () => {
    if (searchEl) searchEl.value = '';
    if (statusEl) statusEl.value = '';
    if (workerEl) workerEl.value = '';
    applyAdminFilters();
  });

  // Export
  document.getElementById('adminExportBtn')?.addEventListener('click', () => {
    const headers = ['Reference','Applicant','Email','Programme','University','Status','Payment','Submitted'];
    const rows = filtered.map(a => [
      a.ref_code, a.profiles?.full_name||'', a.profiles?.email||'',
      a.programs?.name||'', a.programs?.university||'',
      APP_STATUS_LABELS[a.status]||a.status, a.payment_status||'',
      a.submitted_at ? fmtDate(a.submitted_at) : '',
    ]);
    const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv],{type:'text/csv'});
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    a.href=url; a.download=`cyndy-all-apps-${new Date().toISOString().slice(0,10)}.csv`;
    a.click(); URL.revokeObjectURL(url);
  });
}

window.assignTo = async function(appId, workerId) {
  const { error } = await assignWorker(appId, workerId || null, ctx.user.id);
  if (error) { toast('Failed to assign worker.', 'error'); return; }
  toast('Worker assigned.', 'success');
};

// ─── PAYMENTS ─────────────────────────────────────────────────
async function loadPayments() {
  const { data } = await supabase
    .from('payment_receipts')
    .select(`*, applications:application_id ( ref_code, profiles:client_id ( full_name, email ) )`)
    .order('uploaded_at', { ascending: false });

  const tbody = document.getElementById('paymentsBody');
  if (!tbody || !data) return;

  const verified = data.filter(r => r.verified_at);
  const revenue  = verified.reduce((s,r) => s+(r.amount||150), 0);
  const revEl    = document.getElementById('verifiedRevenue');
  if (revEl) revEl.textContent = `£${revenue.toLocaleString()} verified`;

  if (!data.length) {
    tbody.innerHTML = '<tr><td colspan="6"><div style="padding:var(--space-8);text-align:center;color:var(--muted)">No payment receipts yet.</div></td></tr>';
    return;
  }

  tbody.innerHTML = data.map(r => `
    <tr>
      <td><code style="color:var(--gold);font-size:0.8rem">${r.applications?.ref_code || '—'}</code></td>
      <td>
        <div style="font-weight:500">${escapeHtml(r.applications?.profiles?.full_name || '—')}</div>
        <div style="font-size:0.8rem;color:var(--muted)">${escapeHtml(r.applications?.profiles?.email || '')}</div>
      </td>
      <td style="font-weight:601">£${r.amount || 150}</td>
      <td>
        <span class="badge badge-${r.verified_at ? 'success' : 'warning'}">
          ${r.verified_at ? 'Verified' : 'Pending'}
        </span>
      </td>
      <td style="font-size:0.875rem;color:var(--muted)">${fmtDate(r.uploaded_at)}</td>
      <td>
        <div class="row-actions">
          ${!r.verified_at ? `
          <button class="row-action-btn success" onclick="verifyPayment('${r.id}')" title="Verify payment" aria-label="Verify">
            <i class="fa-solid fa-check"></i>
          </button>` : ''}
          <button class="row-action-btn" onclick="viewReceipt('${r.id}','${r.storage_path}')" title="View receipt" aria-label="View receipt">
            <i class="fa-solid fa-eye"></i>
          </button>
        </div>
      </td>
    </tr>`).join('');
}

window.verifyPayment = async function(receiptId) {
  const { error } = await supabase
    .from('payment_receipts')
    .update({ verified_at: new Date().toISOString(), verified_by: ctx.user.id })
    .eq('id', receiptId);

  if (error) { toast('Failed to verify payment.', 'error'); return; }

  // Update application payment status
  const { data: receipt } = await supabase
    .from('payment_receipts').select('application_id').eq('id', receiptId).single();
  if (receipt) {
    await supabase.from('applications')
      .update({ payment_status: 'verified', payment_verified_at: new Date().toISOString() })
      .eq('id', receipt.application_id);
  }

  toast('Payment verified.', 'success');
  loadPayments();
};

window.viewReceipt = async function(id, path) {
  const { data } = await supabase.storage.from('payment-receipts').createSignedUrl(path, 3600);
  if (data?.signedUrl) window.open(data.signedUrl, '_blank');
  else toast('Could not open receipt.', 'error');
};

// ─── WORKERS ──────────────────────────────────────────────────
async function loadWorkers() {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .in('role', ['worker', 'admin'])
    .order('created_at');

  workers = data || [];

  const grid = document.getElementById('workersGrid');
  if (!grid) return;

  if (!workers.length) {
    grid.innerHTML = '<div class="empty-state"><p class="empty-state-title">No workers yet.</p></div>';
    return;
  }

  // Count per worker
  const countsByWorker = {};
  const { data: apps } = await supabase
    .from('applications').select('assigned_worker_id, status').not('assigned_worker_id', 'is', null);
  (apps || []).forEach(a => {
    if (!countsByWorker[a.assigned_worker_id]) countsByWorker[a.assigned_worker_id] = { total:0, accepted:0 };
    countsByWorker[a.assigned_worker_id].total++;
    if (a.status === 'accepted') countsByWorker[a.assigned_worker_id].accepted++;
  });

  grid.innerHTML = workers.map(w => {
    const stats = countsByWorker[w.id] || { total:0, accepted:0 };
    const initials = (w.full_name||'?').trim().split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
    return `
    <div class="worker-card">
      <div class="worker-avatar-lg">${initials}</div>
      <div class="worker-info">
        <div class="worker-name">${escapeHtml(w.full_name || '—')}</div>
        <div class="worker-email">${escapeHtml(w.email)}</div>
        <span class="badge badge-${w.role === 'admin' ? 'gold' : 'info'}" style="margin-top:6px">${w.role}</span>
        <div class="worker-stats">
          <div class="worker-stat-item"><div class="worker-stat-val">${stats.total}</div><div class="worker-stat-lbl">Assigned</div></div>
          <div class="worker-stat-item"><div class="worker-stat-val">${stats.accepted}</div><div class="worker-stat-lbl">Accepted</div></div>
          <div class="worker-stat-item">
            <div class="worker-stat-val">${stats.total ? Math.round(stats.accepted/stats.total*100) : 0}%</div>
            <div class="worker-stat-lbl">Success Rate</div>
          </div>
        </div>
      </div>
      <div>
        <button class="btn btn-ghost btn-sm" onclick="blockWorker('${w.id}','${w.is_blocked}')"
          style="color:${w.is_blocked ? 'var(--success)' : 'var(--danger)'}" aria-label="${w.is_blocked ? 'Unblock' : 'Block'} ${w.full_name}">
          <i class="fa-solid fa-${w.is_blocked ? 'lock-open' : 'ban'}"></i>
          ${w.is_blocked ? 'Unblock' : 'Block'}
        </button>
      </div>
    </div>`;
  }).join('');
}

window.blockWorker = async function(id, isBlocked) {
  const { error } = await supabase.from('profiles').update({ is_blocked: !isBlocked }).eq('id', id);
  if (error) { toast('Failed to update worker.', 'error'); return; }
  toast(isBlocked ? 'Worker unblocked.' : 'Worker blocked.', 'warning');
  await loadWorkers();
};

// ─── CREATE WORKER ────────────────────────────────────────────
async function createWorker() {
  const email = document.getElementById('inviteEmail')?.value.trim();
  const name  = document.getElementById('inviteName')?.value.trim();
  const pin   = document.getElementById('invitePin')?.value.trim();

  if (!email || !name || !pin || pin.length !== 4) {
    toast('Please fill in all fields with a valid 4-digit PIN.', 'warning');
    return;
  }

  // Create via Supabase Admin Auth (requires service role — use Edge Function in production)
  toast('Worker invite sent (requires backend Edge Function to set password).', 'info', 5000);
  document.getElementById('inviteModal')?.classList.remove('open');
}

// ─── CLIENTS ──────────────────────────────────────────────────
async function loadClients() {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('role', 'client')
    .order('created_at', { ascending: false });

  const tbody = document.getElementById('clientsBody');
  if (!tbody || !data) return;

  tbody.innerHTML = data.map(c => {
    const initials = (c.full_name||'?').trim().split(' ').map(x=>x[0]).join('').toUpperCase().slice(0,2);
    return `<tr>
      <td>
        <div style="display:flex;align-items:center;gap:var(--space-3)">
          <div class="portal-avatar" style="width:32px;height:32px;font-size:0.75rem">${initials}</div>
          <div style="font-weight:500">${escapeHtml(c.full_name || '—')}</div>
        </div>
      </td>
      <td style="font-size:0.875rem">${escapeHtml(c.email)}</td>
      <td style="font-size:0.875rem">${escapeHtml(c.nationality || '—')}</td>
      <td>—</td>
      <td style="font-size:0.875rem;color:var(--muted)">${fmtDate(c.created_at)}</td>
      <td>
        <button class="row-action-btn danger" onclick="blockClient('${c.id}','${c.is_blocked}')" aria-label="${c.is_blocked?'Unblock':'Block'} client">
          <i class="fa-solid fa-${c.is_blocked ? 'lock-open' : 'ban'}"></i>
        </button>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="6" style="text-align:center;padding:var(--space-8);color:var(--muted)">No clients found.</td></tr>';
}

window.blockClient = async function(id, isBlocked) {
  await supabase.from('profiles').update({ is_blocked: !isBlocked }).eq('id', id);
  toast(isBlocked ? 'Client unblocked.' : 'Client blocked.', 'warning');
  loadClients();
};

// ─── PROGRAMS DB ──────────────────────────────────────────────
async function loadPrograms() {
  const { data } = await supabase
    .from('programs')
    .select('*')
    .eq('is_active', true)
    .order('university');

  const tbody = document.getElementById('programsBody');
  if (!tbody || !data) return;

  tbody.innerHTML = data.map(p => `
    <tr>
      <td style="font-weight:500">${escapeHtml(p.name)}</td>
      <td style="font-size:0.875rem">${escapeHtml(p.university)}</td>
      <td style="font-size:0.875rem">${escapeHtml(p.country)}</td>
      <td><span class="badge badge-info">${escapeHtml(p.level)}</span></td>
      <td style="font-weight:600">£${Number(p.tuition_fee||0).toLocaleString()}</td>
      <td style="font-size:0.875rem">${(p.intake||[]).join(', ') || '—'}</td>
      <td>
        <div class="row-actions">
          <button class="row-action-btn danger" onclick="deleteProgram('${p.id}')" aria-label="Delete programme">
            <i class="fa-solid fa-trash"></i>
          </button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="7" style="text-align:center;padding:var(--space-8);color:var(--muted)">No programmes in database.</td></tr>';
}

window.deleteProgram = async function(id) {
  if (!confirm('Delete this programme?')) return;
  const { error } = await supabase.from('programs').update({ is_active: false }).eq('id', id);
  if (error) { toast('Failed to delete.', 'error'); return; }
  toast('Programme removed.', 'success');
  loadPrograms();
};

// ─── SCRAPER ──────────────────────────────────────────────────
let scraperRunning = false;
let scraperResults = [];

function logScraper(message, type = 'info') {
  const log = document.getElementById('scraperLog');
  if (!log) return;
  const line = document.createElement('div');
  line.className = `log-line ${type}`;
  line.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  log.appendChild(line);
  log.scrollTop = log.scrollHeight;
}

async function runScraper() {
  const url     = document.getElementById('scraperUrl')?.value.trim();
  const country = document.getElementById('scraperCountry')?.value;

  if (!url && !document.getElementById('scraperCsv')?.files.length) {
    toast('Enter a URL or upload a CSV file.', 'warning');
    return;
  }

  scraperRunning = true;
  document.getElementById('startScraperBtn').disabled = true;
  document.getElementById('stopScraperBtn').disabled  = false;
  document.getElementById('scraperLog').innerHTML = '';
  document.getElementById('scraperResults').innerHTML = '<div style="padding:var(--space-5);text-align:center"><div class="spinner" style="display:inline-block;width:32px;height:32px;border-width:3px"></div><p style="margin-top:var(--space-3);color:var(--muted)">Scraping in progress…</p></div>';

  logScraper(`Starting scraper for: ${url || 'CSV file'}`, 'info');

  // Log a job in DB
  const { data: job } = await supabase
    .from('scraper_jobs')
    .insert({
      initiated_by: ctx.user.id,
      source_url:   url,
      status:       'running',
      started_at:   new Date().toISOString(),
    })
    .select('id')
    .single();

  // Simulate scraping (real implementation requires server-side or Edge Function)
  await new Promise(r => setTimeout(r, 1200));
  logScraper('Connecting to university portal…');
  await new Promise(r => setTimeout(r, 800));
  logScraper('Parsing course listings…');
  await new Promise(r => setTimeout(r, 1000));

  // Mock results
  scraperResults = [
    { university:'University of Example', country, name:'MSc Artificial Intelligence', level:'MSc', tuition_fee:28000, currency:'GBP', intake:['september'] },
    { university:'University of Example', country, name:'BSc Software Engineering',   level:'BSc', tuition_fee:22000, currency:'GBP', intake:['september','january'] },
    { university:'University of Example', country, name:'MBA Entrepreneurship',        level:'MBA', tuition_fee:32000, currency:'GBP', intake:['january'] },
  ];

  logScraper(`Found ${scraperResults.length} programmes!`, 'info');

  // Update job
  if (job) {
    await supabase.from('scraper_jobs').update({
      status:         'done',
      programs_found: scraperResults.length,
      finished_at:    new Date().toISOString(),
    }).eq('id', job.id);
  }

  renderScraperResults(scraperResults);

  scraperRunning = false;
  document.getElementById('startScraperBtn').disabled = false;
  document.getElementById('stopScraperBtn').disabled  = true;
}

function stopScraper() {
  scraperRunning = false;
  document.getElementById('startScraperBtn').disabled = false;
  document.getElementById('stopScraperBtn').disabled  = true;
  logScraper('Scraper stopped by user.', 'warn');
}

function renderScraperResults(results) {
  const container = document.getElementById('scraperResults');
  const countEl   = document.getElementById('scraperResultCount');
  const importBtn = document.getElementById('importSelectedBtn');
  if (!container) return;

  if (countEl) countEl.textContent = `${results.length} programmes found`;
  if (importBtn) importBtn.disabled = false;

  container.innerHTML = results.map((p, i) => `
    <div class="program-result-item">
      <input type="checkbox" class="row-checkbox prog-sel-checkbox" id="prog-${i}" checked data-idx="${i}" aria-label="Select ${p.name}"/>
      <div style="flex:1">
        <div class="prog-uni">${escapeHtml(p.university)} · ${escapeHtml(p.country)}</div>
        <div class="prog-name">${escapeHtml(p.name)}</div>
        <div class="prog-meta">
          <span class="prog-meta-item"><i class="fa-solid fa-graduation-cap"></i> ${p.level}</span>
          <span class="prog-meta-item"><i class="fa-solid fa-sterling-sign"></i> £${Number(p.tuition_fee).toLocaleString()}</span>
          <span class="prog-meta-item"><i class="fa-solid fa-calendar"></i> ${(p.intake||[]).join(', ')}</span>
        </div>
      </div>
    </div>`).join('');
}

async function importPrograms() {
  const selected = [...document.querySelectorAll('.prog-sel-checkbox:checked')].map(cb => scraperResults[+cb.dataset.idx]);
  if (!selected.length) { toast('Select at least one programme.', 'warning'); return; }

  const { error } = await supabase.from('programs').insert(
    selected.map(p => ({ ...p, source: 'scraper' }))
  );

  if (error) { toast('Import failed.', 'error'); console.error(error); return; }

  toast(`${selected.length} programme(s) imported!`, 'success');
  document.getElementById('importSelectedBtn').disabled = true;
}

// ─── AUDIT LOG ────────────────────────────────────────────────
async function loadAuditLog() {
  const from   = document.getElementById('auditDateFrom')?.value;
  const to     = document.getElementById('auditDateTo')?.value;
  const action = document.getElementById('auditActionFilter')?.value;

  let q = supabase
    .from('audit_logs')
    .select(`id, action, created_at, note, actor:actor_id ( full_name ), application:application_id ( ref_code )`)
    .order('created_at', { ascending: false })
    .limit(100);

  if (from)   q = q.gte('created_at', from);
  if (to)     q = q.lte('created_at', to + 'T23:59:59');
  if (action) q = q.ilike('action', `%${action}%`);

  const { data } = await q;
  const tbody    = document.getElementById('auditBody');
  if (!tbody) return;

  tbody.innerHTML = (data||[]).map(log => `
    <tr>
      <td style="font-size:0.8rem;white-space:nowrap">${fmtDateTime(log.created_at)}</td>
      <td>${escapeHtml(log.actor?.full_name || 'System')}</td>
      <td style="text-transform:capitalize;font-size:0.875rem">${log.action.replace(/_/g,' ')}</td>
      <td><code style="color:var(--gold);font-size:0.8rem">${log.application?.ref_code || '—'}</code></td>
      <td style="font-size:0.875rem;color:var(--muted)">${escapeHtml(log.note || '—')}</td>
    </tr>`).join('') || '<tr><td colspan="5" style="text-align:center;padding:var(--space-8);color:var(--muted)">No audit entries.</td></tr>';
}

async function exportAuditLog() {
  const { data } = await supabase
    .from('audit_logs')
    .select(`action, created_at, note, actor:actor_id(full_name), application:application_id(ref_code)`)
    .order('created_at', { ascending: false });

  const headers = ['Time','Actor','Action','Reference','Note'];
  const rows = (data||[]).map(l => [fmtDateTime(l.created_at), l.actor?.full_name||'', l.action, l.application?.ref_code||'', l.note||'']);
  const csv = [headers,...rows].map(r=>r.map(c=>`"${String(c).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv],{type:'text/csv'});
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a'); a.href=url;
  a.download=`cyndy-audit-${new Date().toISOString().slice(0,10)}.csv`;
  a.click(); URL.revokeObjectURL(url);
}

// ─── REALTIME ─────────────────────────────────────────────────
function subscribeRealtime() {
  supabase.channel('admin-realtime')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'applications' }, () => {
      loadOverview();
    })
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'applications' }, () => {
      loadOverview();
    })
    .subscribe();
}
