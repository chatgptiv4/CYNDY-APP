-- ============================================================
--  CYNDY EDUCATIONAL PATHWAYS — FULL DATABASE SCHEMA
--  Run in Supabase SQL Editor (PostgreSQL)
-- ============================================================

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ─── ENUM TYPES ────────────────────────────────────────────────
DO $$ BEGIN
    CREATE TYPE user_role      AS ENUM ('client','worker','admin');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE app_status     AS ENUM (
  'draft','submitted','docs_pending','docs_complete',
  'under_review','offer_received','accepted','rejected','withdrawn'
);
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE doc_status     AS ENUM ('pending','uploaded','verified','rejected','expired');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending','receipt_uploaded','verified','failed','refunded');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;
DO $$ BEGIN
    CREATE TYPE intake_season  AS ENUM ('january','may','september');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- ─── PROFILES (extends auth.users) ────────────────────────────
CREATE TABLE IF NOT EXISTS profiles (
  id               UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email            TEXT    NOT NULL UNIQUE,
  full_name        TEXT    NOT NULL,
  phone            TEXT,
  nationality      TEXT,
  role             user_role    NOT NULL DEFAULT 'client',
  pin_hash         TEXT,                          -- SHA-256 for worker/admin PIN
  is_blocked       BOOLEAN NOT NULL DEFAULT FALSE,
  avatar_url       TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can view their own profile" ON profiles;
CREATE POLICY "Users can view their own profile"
  ON profiles FOR SELECT USING (auth.uid() = id);
DROP POLICY IF EXISTS "Users can update their own profile" ON profiles;
CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE USING (auth.uid() = id);
-- Allow authenticated users to insert their own profile row (used by trigger + JS fallback)
DROP POLICY IF EXISTS "Users can insert their own profile" ON profiles;
CREATE POLICY "Users can insert their own profile"
  ON profiles FOR INSERT WITH CHECK (auth.uid() = id);

-- Function to safely get user role without triggering recursive RLS
CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS user_role
LANGUAGE sql
SECURITY DEFINER SET search_path = public
AS $$
  SELECT role FROM profiles WHERE id = auth.uid();
$$;

DROP POLICY IF EXISTS "Workers and admins can view all profiles" ON profiles;
CREATE POLICY "Workers and admins can view all profiles"
  ON profiles FOR SELECT
  USING (
    public.get_my_role() IN ('worker', 'admin')
  );

-- ─── PROGRAMS ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS programs (
  id              UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  university      TEXT         NOT NULL,
  country         TEXT         NOT NULL,
  name            TEXT         NOT NULL,
  level           TEXT         NOT NULL,         -- e.g. 'BSc', 'MSc', 'MBA', 'PhD'
  duration_years  NUMERIC(3,1),
  intake          intake_season[],               -- array of available intakes
  intake_deadline DATE,
  tuition_fee     NUMERIC(10,2),
  currency        CHAR(3)      NOT NULL DEFAULT 'GBP',
  language        TEXT         NOT NULL DEFAULT 'English',
  ielts_min       NUMERIC(3,1),
  toefl_min       INT,
  url             TEXT,
  source          TEXT,                          -- e.g. 'scraper','manual'
  is_active       BOOLEAN      NOT NULL DEFAULT TRUE,
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE programs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Everyone can read active programs" ON programs;
CREATE POLICY "Everyone can read active programs"
  ON programs FOR SELECT USING (is_active = TRUE);
DROP POLICY IF EXISTS "Admins can manage programs" ON programs;
CREATE POLICY "Admins can manage programs"
  ON programs FOR ALL
  USING ( public.get_my_role() = 'admin' );

-- ─── APPLICATIONS ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS applications (
  id                   UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  ref_code             TEXT         UNIQUE NOT NULL,
  client_id            UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  program_id           UUID         REFERENCES programs(id) ON DELETE SET NULL,
  assigned_worker_id   UUID         REFERENCES profiles(id) ON DELETE SET NULL,

  status               app_status   NOT NULL DEFAULT 'draft',
  payment_status       payment_status NOT NULL DEFAULT 'pending',
  payment_verified_at  TIMESTAMPTZ,
  fee_amount           NUMERIC(10,2) NOT NULL DEFAULT 150,
  currency             CHAR(3)      NOT NULL DEFAULT 'GBP',

  -- Section completion tracking (booleans per section)
  sec_personal_complete     BOOLEAN NOT NULL DEFAULT FALSE,
  sec_contact_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_family_complete       BOOLEAN NOT NULL DEFAULT FALSE,
  sec_education_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  sec_english_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_employment_complete   BOOLEAN NOT NULL DEFAULT FALSE,
  sec_program_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_finance_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_travel_complete       BOOLEAN NOT NULL DEFAULT FALSE,
  sec_medical_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_criminal_complete     BOOLEAN NOT NULL DEFAULT FALSE,
  sec_reference_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  sec_statement_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  sec_documents_complete    BOOLEAN NOT NULL DEFAULT FALSE,
  sec_payment_complete      BOOLEAN NOT NULL DEFAULT FALSE,
  sec_declaration_complete  BOOLEAN NOT NULL DEFAULT FALSE,

  -- Submission timestamps
  submitted_at         TIMESTAMPTZ,
  offer_received_at    TIMESTAMPTZ,
  accepted_at          TIMESTAMPTZ,
  rejected_at          TIMESTAMPTZ,

  created_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE applications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clients can view their own applications" ON applications;
CREATE POLICY "Clients can view their own applications"
  ON applications FOR SELECT USING (client_id = auth.uid());
DROP POLICY IF EXISTS "Clients can insert their own applications" ON applications;
CREATE POLICY "Clients can insert their own applications"
  ON applications FOR INSERT WITH CHECK (client_id = auth.uid());
DROP POLICY IF EXISTS "Clients can update their own draft applications" ON applications;
CREATE POLICY "Clients can update their own draft applications"
  ON applications FOR UPDATE
  USING (client_id = auth.uid() AND status = 'draft');
DROP POLICY IF EXISTS "Workers can view assigned applications" ON applications;
CREATE POLICY "Workers can view assigned applications"
  ON applications FOR SELECT
  USING (
    assigned_worker_id = auth.uid()
    OR public.get_my_role() = 'admin'
  );
DROP POLICY IF EXISTS "Workers can update application status" ON applications;
CREATE POLICY "Workers can update application status"
  ON applications FOR UPDATE
  USING ( public.get_my_role() IN ('worker', 'admin') );

-- ─── APPLICATION SECTIONS (JSONB data store) ──────────────────
CREATE TABLE IF NOT EXISTS application_sections (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID        NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  section_key    TEXT        NOT NULL,      -- e.g. 'personal', 'education'
  data           JSONB       NOT NULL DEFAULT '{}'::JSONB,
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(application_id, section_key)
);

ALTER TABLE application_sections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Application owners can manage sections" ON application_sections;
CREATE POLICY "Application owners can manage sections"
  ON application_sections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = application_id AND a.client_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Workers/admins can read sections" ON application_sections;
CREATE POLICY "Workers/admins can read sections"
  ON application_sections FOR SELECT
  USING ( public.get_my_role() IN ('worker', 'admin') );

-- ─── DOCUMENTS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID         NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  doc_type       TEXT         NOT NULL,     -- e.g. 'passport','transcript','ielts'
  label          TEXT         NOT NULL,
  storage_path   TEXT         NOT NULL,
  bucket         TEXT         NOT NULL DEFAULT 'application-documents',
  file_name      TEXT         NOT NULL,
  file_size      BIGINT,
  mime_type      TEXT,
  status         doc_status   NOT NULL DEFAULT 'uploaded',
  rejection_note TEXT,
  expires_at     DATE,
  uploaded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  reviewed_at    TIMESTAMPTZ,
  reviewed_by    UUID         REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clients can manage their documents" ON documents;
CREATE POLICY "Clients can manage their documents"
  ON documents FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = application_id AND a.client_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Workers/admins can review documents" ON documents;
CREATE POLICY "Workers/admins can review documents"
  ON documents FOR ALL
  USING ( public.get_my_role() IN ('worker', 'admin') );

-- ─── PAYMENT RECEIPTS ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS payment_receipts (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID         NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  storage_path   TEXT         NOT NULL,
  file_name      TEXT         NOT NULL,
  amount         NUMERIC(10,2),
  currency       CHAR(3)      NOT NULL DEFAULT 'GBP',
  payment_ref    TEXT,                   -- bank transfer reference
  uploaded_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  verified_at    TIMESTAMPTZ,
  verified_by    UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  notes          TEXT
);

ALTER TABLE payment_receipts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Clients can upload receipts" ON payment_receipts;
CREATE POLICY "Clients can upload receipts"
  ON payment_receipts FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = application_id AND a.client_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS "Workers/admins can verify receipts" ON payment_receipts;
CREATE POLICY "Workers/admins can verify receipts"
  ON payment_receipts FOR ALL
  USING ( public.get_my_role() IN ('worker', 'admin') );

-- ─── INTERNAL NOTES ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS application_notes (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID         NOT NULL REFERENCES applications(id) ON DELETE CASCADE,
  author_id      UUID         NOT NULL REFERENCES profiles(id) ON DELETE RESTRICT,
  note           TEXT         NOT NULL,
  is_internal    BOOLEAN      NOT NULL DEFAULT TRUE,  -- FALSE = visible to client
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE application_notes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Workers/admins can manage notes" ON application_notes;
CREATE POLICY "Workers/admins can manage notes"
  ON application_notes FOR ALL
  USING ( public.get_my_role() IN ('worker', 'admin') );
DROP POLICY IF EXISTS "Clients can view non-internal notes" ON application_notes;
CREATE POLICY "Clients can view non-internal notes"
  ON application_notes FOR SELECT
  USING (
    is_internal = FALSE
    AND EXISTS (
      SELECT 1 FROM applications a
      WHERE a.id = application_id AND a.client_id = auth.uid()
    )
  );

-- ─── AUDIT LOGS ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS audit_logs (
  id             BIGSERIAL    PRIMARY KEY,
  application_id UUID         REFERENCES applications(id) ON DELETE CASCADE,
  actor_id       UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  action         TEXT         NOT NULL,
  note           TEXT,
  metadata       JSONB,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can view all audit logs" ON audit_logs;
CREATE POLICY "Admins can view all audit logs"
  ON audit_logs FOR SELECT
  USING ( public.get_my_role() = 'admin' );
DROP POLICY IF EXISTS "Workers can view relevant audit logs" ON audit_logs;
CREATE POLICY "Workers can view relevant audit logs"
  ON audit_logs FOR SELECT
  USING (
    public.get_my_role() = 'worker'
    AND actor_id = auth.uid()
  );

-- ─── NOTIFICATIONS ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notifications (
  id             BIGSERIAL    PRIMARY KEY,
  user_id        UUID         NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title          TEXT         NOT NULL,
  body           TEXT,
  link           TEXT,
  is_read        BOOLEAN      NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Users can manage their own notifications" ON notifications;
CREATE POLICY "Users can manage their own notifications"
  ON notifications FOR ALL USING (user_id = auth.uid());

-- ─── PROGRAMS SCRAPER CACHE ───────────────────────────────────
CREATE TABLE IF NOT EXISTS scraper_jobs (
  id             UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  initiated_by   UUID         REFERENCES profiles(id) ON DELETE SET NULL,
  source_url     TEXT,
  status         TEXT         NOT NULL DEFAULT 'pending',  -- pending|running|done|error
  programs_found INT          NOT NULL DEFAULT 0,
  programs_saved INT          NOT NULL DEFAULT 0,
  error_msg      TEXT,
  started_at     TIMESTAMPTZ,
  finished_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

ALTER TABLE scraper_jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Admins can manage scraper jobs" ON scraper_jobs;
CREATE POLICY "Admins can manage scraper jobs"
  ON scraper_jobs FOR ALL
  USING ( public.get_my_role() = 'admin' );

-- ─── HELPER FUNCTIONS ─────────────────────────────────────────

-- 1. Auto-create a profile row whenever a new user signs up via Supabase Auth.
--    This is called by a trigger on auth.users so it works even if the JS fallback
--    fails (e.g. email verification is pending).
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER          -- runs as the DB owner, bypasses RLS
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    'client'
  )
  ON CONFLICT (id) DO NOTHING;   -- safe to re-run
  RETURN NEW;
END;
$$;

-- Attach the trigger to auth.users
CREATE OR REPLACE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 2. Auto-update updated_at on every row change
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_applications_updated_at
  BEFORE UPDATE ON applications
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER trg_programs_updated_at
  BEFORE UPDATE ON programs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- Application completion percentage view
CREATE OR REPLACE VIEW application_completion AS
SELECT
  id,
  ref_code,
  client_id,
  status,
  ROUND((
    (CASE WHEN sec_personal_complete    THEN 1 ELSE 0 END +
     CASE WHEN sec_contact_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_family_complete      THEN 1 ELSE 0 END +
     CASE WHEN sec_education_complete   THEN 1 ELSE 0 END +
     CASE WHEN sec_english_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_employment_complete  THEN 1 ELSE 0 END +
     CASE WHEN sec_program_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_finance_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_travel_complete      THEN 1 ELSE 0 END +
     CASE WHEN sec_medical_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_criminal_complete    THEN 1 ELSE 0 END +
     CASE WHEN sec_reference_complete   THEN 1 ELSE 0 END +
     CASE WHEN sec_statement_complete   THEN 1 ELSE 0 END +
     CASE WHEN sec_documents_complete   THEN 1 ELSE 0 END +
     CASE WHEN sec_payment_complete     THEN 1 ELSE 0 END +
     CASE WHEN sec_declaration_complete THEN 1 ELSE 0 END
    )::NUMERIC / 16 * 100
  ), 0) AS completion_pct
FROM applications;

-- ─── REALTIME ────────────────────────────────────────────────
-- Enable Realtime broadcasting for key tables.
-- These lines ARE safe to run in the SQL Editor.
ALTER PUBLICATION supabase_realtime ADD TABLE applications;
ALTER PUBLICATION supabase_realtime ADD TABLE documents;
ALTER PUBLICATION supabase_realtime ADD TABLE notifications;
ALTER PUBLICATION supabase_realtime ADD TABLE application_notes;

-- ─── STORAGE BUCKETS ─────────────────────────────────────────
-- Create in Supabase Dashboard > Storage:
-- Bucket: application-documents  (private)
-- Bucket: payment-receipts       (private)

-- ─── SAMPLE DATA (dev only — remove in production) ────────────
-- INSERT INTO programs (university, country, name, level, tuition_fee, currency)
-- VALUES
--   ('University of Manchester', 'United Kingdom', 'MSc Computer Science', 'MSc', 27000, 'GBP'),
--   ('Coventry University', 'United Kingdom', 'MBA International Business', 'MBA', 18000, 'GBP'),
--   ('University of Leeds', 'United Kingdom', 'BSc Data Science', 'BSc', 24000, 'GBP');
