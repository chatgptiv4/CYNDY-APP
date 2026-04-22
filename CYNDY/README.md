# Cyndy Educational Pathways — Platform Setup Guide

## 🚀 Quick Start

### 1. Set Up Supabase

1. Go to [supabase.com](https://supabase.com) and create a free project.
2. In the **SQL Editor**, paste and run the contents of `schema.sql`.
3. Go to **Storage** and create two **private** buckets:
   - `application-documents`
   - `payment-receipts`
4. Go to **Authentication → Settings** and configure your email templates.
5. Enable **Realtime** for: `applications`, `documents`, `notifications`, `application_notes`.

### 2. Configure Credentials

Open `js/config.js` and replace:

```js
const SUPABASE_URL  = 'https://YOUR_PROJECT_REF.supabase.co';
const SUPABASE_ANON = 'YOUR_ANON_PUBLIC_KEY';
```

Find these values in your Supabase project under **Project Settings → API**.

### 3. Serve the App

Since the app uses ES Modules (`type="module"`), you **must** serve it over HTTP (not by opening files directly). Use any static server:

```bash
# Using Python
python -m http.server 8080

# Using Node.js
npx serve .

# Using VS Code Live Server
# Right-click index.html → Open with Live Server
```

Then open: **http://localhost:8080**

---

## 📁 File Structure

```
CYNDY/
├── index.html           # Landing page + auth modal
├── apply.html           # 16-section application wizard (client)
├── status.html          # Real-time application status tracker (client)
├── worker.html          # Worker dashboard
├── admin.html           # Admin dashboard
├── unauthorized.html    # 403 page
├── offline.html         # Offline PWA fallback
├── sw.js                # Service Worker (PWA)
├── manifest.json        # PWA manifest
├── schema.sql           # Full PostgreSQL database schema
├── README.md            # This file
│
├── css/
│   ├── main.css         # Design system (variables, components, utilities)
│   ├── landing.css      # Landing page + auth modal styles
│   ├── portal.css       # Apply wizard + status tracker styles
│   └── dashboard.css    # Worker + admin dashboard styles
│
├── js/
│   ├── config.js        # Supabase client, constants, utility helpers
│   ├── auth.js          # Authentication, guards, PIN, modal controller
│   ├── apply.js         # 16-section wizard logic & auto-save
│   ├── status.js        # Real-time status tracker
│   ├── worker.js        # Worker dashboard (tables, drawer, review)
│   └── admin.js         # Admin dashboard (charts, scraper, audit)
│
└── assets/
    ├── logo.svg         # SVG logo
    ├── favicon.ico      # (placeholder — add your own)
    ├── icon-192.png     # PWA icon (add your own)
    └── icon-512.png     # PWA icon (add your own)
```

---

## 👥 User Roles

| Role   | Access                                         |
|--------|------------------------------------------------|
| Client | Apply wizard, document upload, status tracking |
| Worker | Applications table, document review, notes     |
| Admin  | Everything + charts, workers, scraper, audit   |

### Creating the First Admin

1. Sign up via the landing page (creates a `client` account).
2. In Supabase SQL Editor run:
   ```sql
   UPDATE profiles SET role = 'admin' WHERE email = 'your@email.com';
   ```
3. (Optional) Set an admin PIN:
   ```sql
   -- SHA-256 of your PIN. Use a tool to generate the hash.
   UPDATE profiles SET pin_hash = 'SHA256_HASH_OF_YOUR_PIN' WHERE email = 'your@email.com';
   ```

### Creating Workers

From the admin panel → **Workers** → **Invite Worker**, then update the role manually:
```sql
UPDATE profiles SET role = 'worker' WHERE email = 'worker@email.com';
```

---

## 🔐 Security Notes

- All storage buckets are **private**. Documents are accessed via signed URLs (1 hour expiry).
- Row-Level Security (RLS) is enabled on all tables — clients can only see their own data.
- Worker/Admin access is protected by PIN (SHA-256 hashed, stored in `profiles.pin_hash`).
- Blocked accounts (`is_blocked = true`) are rejected at login.
- All status changes and actions are logged in `audit_logs`.

---

## ⚡ PWA Features

- **Installable** on mobile and desktop via browser prompt.
- **Offline** support — cached pages stay accessible; data syncs on reconnect.
- **Push notifications** — integrated service worker (requires push subscription setup).
- **Shortcuts** — "My Applications" and "New Application" shortcuts on home screen.

---

## 📦 External Dependencies (CDN)

| Library              | Purpose                  |
|----------------------|--------------------------|
| Supabase JS          | Database, Auth, Storage, Realtime |
| Font Awesome 6       | Icons                    |
| Toastify JS          | Toast notifications      |
| Chart.js 4           | Admin analytics charts   |
| Dropzone 6           | File drag-and-drop       |
| Google Fonts         | Cormorant Garamond + DM Sans |

---

## 🛠 Customisation

- **Colours**: Edit CSS variables in `css/main.css` (`:root` block).
- **Application Fee**: Change `APPLICATION_FEE_GBP` in `js/config.js`.
- **Bank Details**: Update the bank details in `js/apply.js` → `buildPaymentSection()`.
- **Document Types**: Edit the `docs` array in `js/apply.js` → `buildDocumentsSection()`.
- **Sections**: All 16 section forms are in `js/apply.js` → `buildXxxSection()` functions.

---

## 📧 Contact

**Cyndy Educational Pathways Ltd**  
info@cyndyedupathways.com
