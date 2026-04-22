/* ============================================================
   CYNDY EDUCATIONAL PATHWAYS — SUPABASE CONFIG & HELPERS
   ============================================================ */

import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js/+esm';

// ─── SUPABASE CREDENTIALS ─────────────────────────────────────
// Replace these with your actual project values from supabase.com
const SUPABASE_URL = 'https://pozntoywhvzpbkokbfxt.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBvem50b3l3aHZ6cGJrb2tiZnh0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY2NTYwNjcsImV4cCI6MjA5MjIzMjA2N30.1_b2H49DXvr5KMh-SAumOfLZ4FsVK9wJlIx6W51tUS4';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// ─── CONSTANTS ────────────────────────────────────────────────
export const ROLES = Object.freeze({
  CLIENT: 'client',
  WORKER: 'worker',
  ADMIN: 'admin',
});

export const APP_STATUS = Object.freeze({
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  DOCS_PENDING: 'docs_pending',
  DOCS_COMPLETE: 'docs_complete',
  UNDER_REVIEW: 'under_review',
  OFFER_RECEIVED: 'offer_received',
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  WITHDRAWN: 'withdrawn',
});

export const APP_STATUS_LABELS = {
  draft: 'Draft',
  submitted: 'Submitted',
  docs_pending: 'Docs Pending',
  docs_complete: 'Docs Complete',
  under_review: 'Under Review',
  offer_received: 'Offer Received',
  accepted: 'Accepted',
  rejected: 'Rejected',
  withdrawn: 'Withdrawn',
};

export const DOC_STATUS = Object.freeze({
  PENDING: 'pending',
  UPLOADED: 'uploaded',
  VERIFIED: 'verified',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});

// Application fee in GBP
export const APPLICATION_FEE_GBP = 150;

// Storage bucket names
export const BUCKETS = Object.freeze({
  DOCUMENTS: 'application-documents',
  RECEIPTS: 'payment-receipts',
});

// Max file sizes
export const MAX_FILE_SIZE_MB = 10;
export const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;

// Allowed MIME types
export const ALLOWED_DOC_TYPES = [
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// ─── TOAST HELPER ─────────────────────────────────────────────
/**
 * Show a toast notification using Toastify.
 * @param {string} msg   Message text
 * @param {'success'|'error'|'info'|'warning'} type
 * @param {number} duration  ms
 */
export function toast(msg, type = 'info', duration = 3500) {
  if (typeof Toastify === 'undefined') {
    console.warn('[toast]', type, msg);
    return;
  }
  const colors = {
    success: '#2E9E6B',
    error: '#C94040',
    warning: '#E8A838',
    info: '#378ADD',
  };
  Toastify({
    text: msg,
    duration,
    gravity: 'bottom',
    position: 'right',
    style: {
      background: colors[type] || colors.info,
      borderRadius: '10px',
      fontFamily: "'DM Sans', sans-serif",
      fontSize: '0.9rem',
      padding: '12px 18px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    },
    stopOnFocus: true,
  }).showToast();
}

// ─── CLIPBOARD HELPER ─────────────────────────────────────────
export async function copyToClipboard(text, label = 'Copied') {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label} copied!`, 'success', 1800);
  } catch {
    toast('Copy failed. Please copy manually.', 'error');
  }
}

// ─── DATE HELPERS ─────────────────────────────────────────────
/** Format ISO date string → "20 Apr 2026" */
export function fmtDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
  });
}

/** Format ISO date string → "20 Apr 2026, 14:35" */
export function fmtDateTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

/** Return relative time string → "3 days ago", "in 2 weeks" */
export function relativeTime(iso) {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(diff);
  const sign = diff > 0 ? -1 : 1;
  const rtf = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
  if (abs < 60_000) return rtf.format(sign, 'second');
  if (abs < 3_600_000) return rtf.format(Math.round(sign * abs / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(sign * abs / 3_600_000), 'hour');
  if (abs < 2_592_000_000) return rtf.format(Math.round(sign * abs / 86_400_000), 'day');
  return rtf.format(Math.round(sign * abs / 2_592_000_000), 'month');
}

/** Days until a deadline (negative = overdue) */
export function daysUntil(iso) {
  if (!iso) return null;
  return Math.round((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

/** Return CSS class for deadline urgency */
export function deadlineClass(iso) {
  const d = daysUntil(iso);
  if (d === null) return '';
  if (d < 0) return 'deadline-overdue';
  if (d < 3) return 'deadline-urgent';
  if (d < 14) return 'deadline-soon';
  return 'deadline-ok';
}

// ─── FILE HELPERS ─────────────────────────────────────────────
/** Format bytes → "2.4 MB" */
export function fmtBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Get file extension → "pdf" */
export function fileExt(filename) {
  return filename.split('.').pop().toLowerCase();
}

/** Return FontAwesome icon class for file type */
export function fileIcon(filename) {
  const ext = fileExt(filename);
  const map = {
    pdf: 'fa-file-pdf',
    doc: 'fa-file-word', docx: 'fa-file-word',
    xls: 'fa-file-excel', xlsx: 'fa-file-excel',
    jpg: 'fa-file-image', jpeg: 'fa-file-image',
    png: 'fa-file-image', webp: 'fa-file-image',
    zip: 'fa-file-zipper', rar: 'fa-file-zipper',
  };
  return `fa-solid ${map[ext] || 'fa-file'}`;
}

// ─── STRING HELPERS ───────────────────────────────────────────
/** Truncate text to N chars */
export function truncate(text, max = 50) {
  if (!text) return '';
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

/** Initials from full name → "JD" */
export function initials(name = '') {
  return name.trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

/** Sanitize HTML to plain text */
export function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

/** Debounce a function */
export function debounce(fn, ms = 300) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

// ─── STORAGE HELPERS ─────────────────────────────────────────
/**
 * Generate a unique storage path for an application document.
 * Path: applicationId/docType/timestamp-filename
 */
export function docStoragePath(applicationId, docType, filename) {
  const safe = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${applicationId}/${docType}/${Date.now()}-${safe}`;
}

/**
 * Get a signed URL for a private document.
 * @returns {string|null}
 */
export async function getSignedUrl(bucket, path, expiresIn = 3600) {
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, expiresIn);
  if (error) { console.error('[getSignedUrl]', error); return null; }
  return data.signedUrl;
}

// ─── DATABASE QUERY HELPERS ───────────────────────────────────

/**
 * Fetch all applications with joins (for worker/admin tables).
 * Returns {data, error}
 */
export async function fetchApplications(filters = {}) {
  let q = supabase
    .from('applications')
    .select(`
      id, ref_code, status, created_at, updated_at, submitted_at,
      payment_status, payment_verified_at, fee_amount, currency,
      assigned_worker_id,
      profiles:client_id ( id, full_name, email, phone, nationality ),
      programs:program_id ( id, name, university, country, intake, tuition_fee ),
      workers:assigned_worker_id ( id, full_name )
    `)
    .order('created_at', { ascending: false });

  if (filters.status) q = q.eq('status', filters.status);
  if (filters.worker) q = q.eq('assigned_worker_id', filters.worker);
  if (filters.search) {
    q = q.or(`ref_code.ilike.%${filters.search}%,profiles.full_name.ilike.%${filters.search}%`);
  }

  return q;
}

/**
 * Fetch a single application with all detail.
 */
export async function fetchApplication(id) {
  return supabase
    .from('applications')
    .select(`
      *,
      profiles:client_id (*),
      programs:program_id (*),
      workers:assigned_worker_id ( id, full_name, email ),
      documents (*),
      application_notes ( *, author:author_id ( full_name ) )
    `)
    .eq('id', id)
    .single();
}

/**
 * Update application status + log audit entry.
 */
export async function updateAppStatus(applicationId, newStatus, workerId, note = '') {
  const { error } = await supabase
    .from('applications')
    .update({ status: newStatus, updated_at: new Date().toISOString() })
    .eq('id', applicationId);

  if (error) return { error };

  // Log audit
  await supabase.from('audit_logs').insert({
    application_id: applicationId,
    action: `status_changed_to_${newStatus}`,
    actor_id: workerId,
    note,
  });

  return { error: null };
}

/**
 * Assign a worker to an application.
 */
export async function assignWorker(applicationId, workerId, actorId) {
  const { error } = await supabase
    .from('applications')
    .update({ assigned_worker_id: workerId, updated_at: new Date().toISOString() })
    .eq('id', applicationId);

  if (!error) {
    await supabase.from('audit_logs').insert({
      application_id: applicationId,
      action: 'worker_assigned',
      actor_id: actorId,
      note: `Assigned to worker ${workerId}`,
    });
  }
  return { error };
}

/**
 * Fetch dashboard stats for admin.
 */
export async function fetchAdminStats() {
  const [total, submitted, underReview, accepted, rejected] = await Promise.all([
    supabase.from('applications').select('id', { count: 'exact', head: true }),
    supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'submitted'),
    supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'under_review'),
    supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'accepted'),
    supabase.from('applications').select('id', { count: 'exact', head: true }).eq('status', 'rejected'),
  ]);
  return {
    total: total.count || 0,
    submitted: submitted.count || 0,
    underReview: underReview.count || 0,
    accepted: accepted.count || 0,
    rejected: rejected.count || 0,
  };
}

// ─── IMAGE COMPRESSION ────────────────────────────────────────
/**
 * Compress an image File using canvas before upload.
 * Non-image files pass through unchanged.
 * @param {File} file
 * @param {number} maxWidthPx
 * @param {number} quality 0-1
 * @returns {Promise<File>}
 */
export async function compressImage(file, maxWidthPx = 1800, quality = 0.82) {
  if (!file.type.startsWith('image/')) return file;

  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, maxWidthPx / img.width);
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() })),
        'image/jpeg',
        quality
      );
    };
    img.onerror = () => resolve(file); // fallback
    img.src = url;
  });
}

// ─── REF CODE GENERATOR ───────────────────────────────────────
/** Generate a human-readable reference code, e.g. "CEP-2026-A8K3" */
export function genRefCode() {
  const year = new Date().getFullYear();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `CEP-${year}-${rand}`;
}

// ─── COUNTRY LIST (for select fields) ────────────────────────
export const COUNTRIES = [
  'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda',
  'Argentina', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain',
  'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan', 'Bolivia',
  'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso',
  'Burundi', 'Cabo Verde', 'Cambodia', 'Cameroon', 'Canada', 'Central African Republic',
  'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo (DRC)', 'Congo (Republic)',
  'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Djibouti',
  'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea',
  'Eritrea', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon',
  'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada', 'Guatemala', 'Guinea',
  'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hungary', 'Iceland', 'India', 'Indonesia',
  'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan',
  'Kenya', 'Kiribati', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho',
  'Liberia', 'Libya', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi',
  'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania', 'Mauritius',
  'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco',
  'Mozambique', 'Myanmar', 'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand',
  'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia', 'Norway', 'Oman',
  'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru',
  'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda',
  'Saint Kitts and Nevis', 'Saint Lucia', 'Saint Vincent and the Grenadines', 'Samoa',
  'San Marino', 'Sao Tome and Principe', 'Saudi Arabia', 'Senegal', 'Serbia',
  'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands',
  'Somalia', 'South Africa', 'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan',
  'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania',
  'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Turkey',
  'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom',
  'United States', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela',
  'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe',
];
