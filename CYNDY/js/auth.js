/* ============================================================
   CYNDY EDUCATIONAL PATHWAYS — AUTH MODULE
   Handles: login, signup, PIN confirm, role guards, session
   ============================================================ */

import { supabase, ROLES, toast } from './config.js';

// ─── ROLE → HOME PAGE MAP ─────────────────────────────────────
const ROLE_HOME = {
  [ROLES.CLIENT]: '/apply.html',
  [ROLES.WORKER]: '/worker.html',
  [ROLES.ADMIN]: '/admin.html',
};

// ─── GET CURRENT SESSION ──────────────────────────────────────
/**
 * Returns { session, user, profile } or null.
 */
export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) return null;

  const profile = await getProfile(session.user.id);
  return { session, user: session.user, profile };
}

// ─── GET PROFILE ──────────────────────────────────────────────
export async function getProfile(userId) {
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn('[getProfile] Profile not found, attempting auto-heal...', error.message);
      // Auto-heal: If profile doesn't exist, try to create it.
      const { data: userData } = await supabase.auth.getUser();
      if (userData?.user) {
        const fallbackProfile = {
          id: userId,
          email: userData.user.email,
          full_name: userData.user.user_metadata?.full_name || userData.user.email.split('@')[0],
          role: ROLES.CLIENT,
        };
        const { data: newProfile, error: insertErr } = await supabase
          .from('profiles')
          .upsert(fallbackProfile, { onConflict: 'id', ignoreDuplicates: false })
          .select()
          .single();

        if (!insertErr && newProfile) {
          console.log('[getProfile] Auto-heal successful');
          return newProfile;
        }
        
        console.error('[getProfile] Auto-heal failed:', insertErr);
        toast(`Database Error: Could not load or create profile. ${insertErr?.message || ''}`, 'error', 5000);
      }
      return null;
    }
    return data;
  } catch (e) {
    console.error('[getProfile] exception:', e.message);
    toast(`Exception loading profile: ${e.message}`, 'error', 5000);
    return null;
  }
}

// ─── ROUTE GUARDS ─────────────────────────────────────────────
/**
 * Guard a page — redirects if not authenticated or wrong role.
 * Call at top of each protected page script.
 *
 * @param {string[]} allowedRoles  e.g. [ROLES.CLIENT]
 * @returns {Promise<{session, user, profile}>}
 */
export async function requireAuth(allowedRoles = []) {
  const ctx = await getSession();

  if (!ctx) {
    window.location.href = '/index.html?auth=required';
    return null;
  }

  // If we couldn't load the profile at all, we show an error instead of immediately
  // bouncing to unauthorized, which creates a frustrating loop.
  if (!ctx.profile) {
    document.body.innerHTML = `
      <div style="padding: 50px; text-align: center; font-family: sans-serif; color: white;">
        <h2 style="color: #C94040;">Profile Error</h2>
        <p>Your authentication session exists, but your database profile could not be loaded or created.</p>
        <p>Check the browser console or the error toast for details.</p>
        <button onclick="localStorage.clear(); sessionStorage.clear(); window.location.href='/index.html'" style="padding: 10px 20px; margin-top: 20px; background: #D4A847; border: none; cursor: pointer; border-radius: 5px;">Clear Session & Go Home</button>
      </div>
    `;
    return null;
  }

  if (allowedRoles.length > 0 && !allowedRoles.includes(ctx.profile.role)) {
    window.location.href = '/unauthorized.html';
    return null;
  }

  return ctx;
}

/**
 * Redirect logged-in users away from the landing page.
 * If the profiles table is missing (schema not yet run), silently skips.
 */
export async function redirectIfLoggedIn() {
  try {
    const ctx = await getSession();
    if (!ctx) return;
    // If profile couldn't be loaded but user is authed, still redirect to apply
    const home = ROLE_HOME[ctx.profile?.role] || '/apply.html';
    window.location.href = home;
  } catch (e) {
    console.warn('[redirectIfLoggedIn]', e.message);
  }
}

// ─── SIGN UP ──────────────────────────────────────────────────
/**
 * Register a new client account.
 * @param {object} fields  { email, password, fullName, phone, nationality }
 */
export async function signUp({ email, password, fullName, phone = '', nationality = '' }) {
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
      emailRedirectTo: `${window.location.origin}/index.html?verified=1`,
    },
  });

  if (error) throw error;

  // Insert profile row manually (as a fallback — Supabase trigger handles this automatically
  // once the schema is applied. This JS insert is a belt-and-braces measure).
  if (data.user) {
    try {
      await supabase.from('profiles').upsert({
        id: data.user.id,
        email,
        full_name: fullName,
        phone,
        nationality,
        role: ROLES.CLIENT,
      }, { onConflict: 'id', ignoreDuplicates: true });
    } catch (profileErr) {
      // Non-fatal — the DB trigger will handle it once schema is applied
      console.warn('[signUp profile upsert]', profileErr);
    }
  }

  return data;
}

// ─── SIGN IN ──────────────────────────────────────────────────
/**
 * Sign in with email + password.
 * Returns { session, user, profile }.
 */
export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const profile = await getProfile(data.user.id);

  // Check account is active
  if (profile?.is_blocked) {
    await supabase.auth.signOut();
    throw new Error('Your account has been suspended. Please contact support.');
  }

  return { session: data.session, user: data.user, profile };
}

// ─── SIGN OUT ─────────────────────────────────────────────────
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('[signOut]', error);
  window.location.href = '/index.html';
}

// ─── FORGOT PASSWORD ──────────────────────────────────────────
export async function sendPasswordReset(email) {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/index.html?reset=1`,
  });
  if (error) throw error;
}

// ─── UPDATE PASSWORD ──────────────────────────────────────────
export async function updatePassword(newPassword) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// ─── WORKER / ADMIN — PIN VERIFICATION ───────────────────────
/**
 * Verify a worker/admin PIN stored in profiles.pin_hash.
 * We compare a SHA-256 hash of the supplied PIN.
 */
export async function verifyPin(userId, pin) {
  const hash = await sha256(pin);
  const { data, error } = await supabase
    .from('profiles')
    .select('pin_hash')
    .eq('id', userId)
    .single();

  if (error || !data) return false;
  return data.pin_hash === hash;
}

/**
 * Set/update a worker/admin PIN.
 */
export async function setPin(userId, pin) {
  const hash = await sha256(pin);
  const { error } = await supabase
    .from('profiles')
    .update({ pin_hash: hash })
    .eq('id', userId);
  if (error) throw error;
}

/** SHA-256 hex digest */
async function sha256(str) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ─── PASSWORD STRENGTH ────────────────────────────────────────
/**
 * Returns a score 0-3 for password strength.
 * 0 = weak, 3 = strong
 */
export function passwordStrength(password) {
  let score = 0;
  if (password.length >= 8) score++;
  if (/[A-Z]/.test(password) && /[a-z]/.test(password)) score++;
  if (/\d/.test(password)) score++;
  if (/[^A-Za-z0-9]/.test(password)) score++;
  return Math.min(3, score);
}

export const PW_STRENGTH_LABELS = ['Weak', 'Fair', 'Good', 'Strong'];

// ─── AUTH MODAL CONTROLLER ────────────────────────────────────
/**
 * Wire up the auth modal on the landing page.
 * Expects specific element IDs in index.html.
 */
export function initAuthModal() {
  const overlay = document.getElementById('authModal');
  const tabLogin = document.getElementById('tabLogin');
  const tabSignup = document.getElementById('tabSignup');
  const panelLogin = document.getElementById('panelLogin');
  const panelSignup = document.getElementById('panelSignup');
  const btnClose = document.getElementById('authModalClose');
  const btnOpenLogin = document.querySelectorAll('[data-auth="login"]');
  const btnOpenSignup = document.querySelectorAll('[data-auth="signup"]');

  if (!overlay) return;

  // Open/close helpers
  function openModal(tab = 'login') {
    overlay.classList.add('open');
    switchTab(tab);
    document.body.style.overflow = 'hidden';
  }
  function closeModal() {
    overlay.classList.remove('open');
    document.body.style.overflow = '';
  }
  function switchTab(tab) {
    const isLogin = tab === 'login';
    tabLogin?.classList.toggle('active', isLogin);
    tabSignup?.classList.toggle('active', !isLogin);
    panelLogin?.classList.toggle('hidden', !isLogin);
    panelSignup?.classList.toggle('hidden', isLogin);
  }

  btnClose?.addEventListener('click', closeModal);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeModal(); });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });

  tabLogin?.addEventListener('click', () => switchTab('login'));
  tabSignup?.addEventListener('click', () => switchTab('signup'));

  btnOpenLogin.forEach(b => b.addEventListener('click', () => openModal('login')));
  btnOpenSignup.forEach(b => b.addEventListener('click', () => openModal('signup')));

  // ── Login form ──
  const loginForm = document.getElementById('loginForm');
  loginForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const btn = loginForm.querySelector('[type=submit]');

    setLoading(btn, true);
    try {
      const { profile } = await signIn(email, password);
      toast('Welcome back! Redirecting…', 'success');
      setTimeout(() => { window.location.href = ROLE_HOME[profile?.role] || '/apply.html'; }, 900);
    } catch (err) {
      toast(formatAuthError(err.message), 'error');
    } finally {
      setLoading(btn, false);
    }
  });

  // ── Signup form ──
  const signupForm = document.getElementById('signupForm');
  const pwInput = document.getElementById('signupPassword');
  const pwStrengthSegs = document.querySelectorAll('.pw-strength-seg');
  const pwStrengthLabel = document.getElementById('pwStrengthLabel');

  pwInput?.addEventListener('input', () => {
    const score = passwordStrength(pwInput.value);
    pwStrengthSegs.forEach((seg, i) => {
      seg.classList.remove('active-0', 'active-1', 'active-2', 'active-3');
      if (i <= score - 1) seg.classList.add(`active-${Math.min(score - 1, 3)}`);
    });
    if (pwStrengthLabel) pwStrengthLabel.textContent = pwInput.value ? PW_STRENGTH_LABELS[Math.min(score, 3)] : '';
  });

  signupForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fullName = document.getElementById('signupName').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const phone = document.getElementById('signupPhone')?.value.trim() || '';
    const nationality = document.getElementById('signupNationality')?.value || '';
    const password = pwInput.value;
    const confirm = document.getElementById('signupConfirm').value;
    const btn = signupForm.querySelector('[type=submit]');

    if (password !== confirm) { toast('Passwords do not match.', 'error'); return; }
    if (passwordStrength(password) < 1) { toast('Please use a stronger password.', 'error'); return; }

    setLoading(btn, true);
    try {
      await signUp({ email, password, fullName, phone, nationality });
      toast('Account created! Please check your email to verify.', 'success', 6000);
      switchTab('login');
    } catch (err) {
      toast(formatAuthError(err.message), 'error');
    } finally {
      setLoading(btn, false);
    }
  });

  // ── Forgot password ──
  const forgotLink = document.getElementById('forgotPasswordLink');
  forgotLink?.addEventListener('click', async () => {
    const email = document.getElementById('loginEmail')?.value.trim();
    if (!email) { toast('Please enter your email first.', 'warning'); return; }
    try {
      await sendPasswordReset(email);
      toast('Password reset link sent to your email.', 'success', 5000);
    } catch (err) {
      toast(formatAuthError(err.message), 'error');
    }
  });

  // ── Toggle password visibility ──
  document.querySelectorAll('[data-pw-toggle]').forEach(btn => {
    btn.addEventListener('click', () => {
      const targetId = btn.dataset.pwToggle;
      const input = document.getElementById(targetId);
      if (!input) return;
      const isText = input.type === 'text';
      input.type = isText ? 'password' : 'text';
      btn.querySelector('i')?.classList.toggle('fa-eye', isText);
      btn.querySelector('i')?.classList.toggle('fa-eye-slash', !isText);
    });
  });

  // Make openModal accessible globally (for CTA buttons etc)
  window.openAuthModal = openModal;
}

// ─── PIN MODAL CONTROLLER ─────────────────────────────────────
/**
 * Show PIN entry modal for worker/admin secondary auth.
 */
export function initPinModal(userId, onSuccess) {
  const overlay = document.getElementById('pinModal');
  const inputs = document.querySelectorAll('.pin-input');
  const form = document.getElementById('pinForm');

  if (!overlay || !inputs.length) return;

  overlay.classList.add('open');
  inputs[0]?.focus();

  // Auto-advance on digit input
  inputs.forEach((inp, i) => {
    inp.addEventListener('input', () => {
      inp.value = inp.value.replace(/\D/, '').slice(-1);
      if (inp.value && i < inputs.length - 1) inputs[i + 1].focus();
    });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && i > 0) inputs[i - 1].focus();
    });
  });

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const pin = Array.from(inputs).map(i => i.value).join('');
    if (pin.length < 4) { toast('Enter your 4-digit PIN.', 'warning'); return; }

    const btn = form.querySelector('[type=submit]');
    setLoading(btn, true);
    const ok = await verifyPin(userId, pin);
    setLoading(btn, false);

    if (ok) {
      overlay.classList.remove('open');
      onSuccess?.();
    } else {
      toast('Incorrect PIN. Please try again.', 'error');
      inputs.forEach(i => { i.value = ''; });
      inputs[0].focus();
    }
  });
}

// ─── HELPERS ──────────────────────────────────────────────────
function setLoading(btn, loading) {
  if (!btn) return;
  btn.disabled = loading;
  const spinner = btn.querySelector('.spinner');
  const label = btn.querySelector('.btn-label');
  if (spinner) spinner.style.display = loading ? 'inline-block' : 'none';
  if (label) label.style.opacity = loading ? '0.5' : '1';
}

function formatAuthError(msg) {
  if (!msg) return 'An error occurred. Please try again.';
  if (msg.includes('Invalid login credentials')) return 'Email or password is incorrect.';
  if (msg.includes('Email not confirmed')) return 'Please verify your email first.';
  if (msg.includes('already registered')) return 'This email is already in use. Please log in.';
  if (msg.includes('Password should be')) return 'Password must be at least 6 characters.';
  return msg;
}

// ─── SESSION LISTENER ─────────────────────────────────────────
/**
 * Listen for auth state changes (called once on app init).
 */
export function onAuthChange(callback) {
  supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}
