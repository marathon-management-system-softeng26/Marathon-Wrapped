-- =====================================================================
-- MNC Marathon Simulation System — Initial PostgreSQL / Supabase Schema
-- =====================================================================

-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. ENUMS
CREATE TYPE user_role AS ENUM ('admin', 'runner');
CREATE TYPE registration_status AS ENUM ('pending', 'official', 'rejected');
CREATE TYPE finish_status AS ENUM ('no_result', 'finished', 'manual');
CREATE TYPE webhook_aspect_type AS ENUM ('create', 'update', 'delete');

-- 2. PROFILES (Mirrors auth.users)
CREATE TABLE public.profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    phone TEXT NOT NULL,
    role user_role NOT NULL DEFAULT 'runner',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 3. EVENTS
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    event_date TIMESTAMPTZ NOT NULL,
    location TEXT NOT NULL,
    track_detail TEXT,
    banner_url TEXT,
    created_by UUID NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. CATEGORIES
CREATE TABLE public.categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
    name TEXT NOT NULL, -- e.g. 'Full Marathon', 'Half Marathon', '10K', '5K'
    code TEXT NOT NULL, -- e.g. 'FM', 'HM', '10K', '5K'
    distance_km NUMERIC(5, 2) NOT NULL,
    price NUMERIC(12, 2) NOT NULL DEFAULT 0.00,
    quota INT NOT NULL CHECK (quota > 0),
    requires_certificate BOOLEAN NOT NULL DEFAULT false,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_event_category_code UNIQUE (event_id, code)
);

-- 5. REGISTRATIONS
CREATE TABLE public.registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    category_id UUID NOT NULL REFERENCES public.categories(id) ON DELETE RESTRICT,
    status registration_status NOT NULL DEFAULT 'pending',
    bib_number TEXT UNIQUE,
    emergency_contact_name TEXT,
    emergency_contact_phone TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT unique_user_category_reg UNIQUE (user_id, category_id)
);

-- 6. CERTIFICATES (Eligibility proof)
CREATE TABLE public.certificates (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    file_type TEXT NOT NULL,
    file_size_bytes BIGINT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 7. PAYMENT PROOFS (Manual QRIS receipts)
CREATE TABLE public.payment_proofs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    reviewed_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
    review_note TEXT,
    reviewed_at TIMESTAMPTZ
);

-- 8. STRAVA CONNECTIONS
CREATE TABLE public.strava_connections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL UNIQUE REFERENCES public.profiles(id) ON DELETE CASCADE,
    athlete_id TEXT NOT NULL UNIQUE,
    access_token TEXT NOT NULL,
    refresh_token TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    scope TEXT NOT NULL DEFAULT 'activity:read',
    connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. RACE RESULTS
CREATE TABLE public.race_results (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    registration_id UUID NOT NULL UNIQUE REFERENCES public.registrations(id) ON DELETE RESTRICT,
    strava_activity_id TEXT UNIQUE,
    finish_status finish_status NOT NULL DEFAULT 'no_result',
    start_time TIMESTAMPTZ,
    finish_time TIMESTAMPTZ,
    elapsed_time INTERVAL,
    distance_km NUMERIC(6, 3),
    avg_pace_min_per_km NUMERIC(4, 2),
    is_manual_override BOOLEAN NOT NULL DEFAULT false,
    manual_override_by UUID REFERENCES public.profiles(id),
    manual_override_reason TEXT,
    recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 10. WEBHOOK EVENTS (Strava audit and replay log)
CREATE TABLE public.webhook_events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_object_id TEXT NOT NULL,
    athlete_id TEXT NOT NULL,
    aspect_type webhook_aspect_type NOT NULL,
    raw_payload JSONB NOT NULL,
    processed BOOLEAN NOT NULL DEFAULT false,
    processing_error TEXT,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =====================================================================
-- INDEXES
-- =====================================================================
CREATE INDEX idx_strava_connections_athlete_id ON public.strava_connections(athlete_id);
CREATE INDEX idx_webhook_events_athlete_processed ON public.webhook_events(athlete_id, processed);
CREATE INDEX idx_registrations_category_status ON public.registrations(category_id, status);
CREATE INDEX idx_registrations_user_id ON public.registrations(user_id);
CREATE INDEX idx_race_results_registration_id ON public.race_results(registration_id);
CREATE INDEX idx_race_results_finish_status ON public.race_results(finish_status);

-- =====================================================================
-- TRIGGERS & FUNCTIONS
-- =====================================================================

-- Trigger 1: Global Sequential Bib Generation & Immutability Check (NFR3)
CREATE OR REPLACE FUNCTION generate_and_lock_bib()
RETURNS TRIGGER AS $$
DECLARE
    target_event_id UUID;
    next_bib_num INT;
BEGIN
    -- Enforce immutability once bib is assigned
    IF OLD.bib_number IS NOT NULL AND NEW.bib_number <> OLD.bib_number THEN
        RAISE EXCEPTION 'Bib numbers are immutable once issued (NFR3).';
    END IF;

    -- When approving registration to 'official', assign global sequential number
    IF NEW.status = 'official' AND NEW.bib_number IS NULL THEN
        SELECT event_id INTO target_event_id 
        FROM public.categories 
        WHERE id = NEW.category_id;

        SELECT COALESCE(MAX(NULLIF(regexp_replace(r.bib_number, '\D', '', 'g'), '')::INT), 1000) + 1
        INTO next_bib_num
        FROM public.registrations r
        JOIN public.categories c ON r.category_id = c.id
        WHERE c.event_id = target_event_id 
          AND r.bib_number IS NOT NULL;

        NEW.bib_number := next_bib_num::TEXT;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_generate_and_lock_bib
BEFORE UPDATE ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION generate_and_lock_bib();

-- Trigger 2: Quota Lock (Counts Pending + Official)
CREATE OR REPLACE FUNCTION check_category_quota()
RETURNS TRIGGER AS $$
DECLARE
    cat_quota INT;
    active_count INT;
BEGIN
    SELECT quota INTO cat_quota FROM public.categories WHERE id = NEW.category_id;
    
    SELECT COUNT(*) INTO active_count
    FROM public.registrations
    WHERE category_id = NEW.category_id AND status IN ('pending', 'official');

    IF active_count >= cat_quota THEN
        RAISE EXCEPTION 'Category quota has been reached. No further registrations can be accepted.';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_check_category_quota
BEFORE INSERT ON public.registrations
FOR EACH ROW
EXECUTE FUNCTION check_category_quota();

-- Trigger 3: Sync Auth Users to Profiles
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO public.profiles (id, name, email, phone, role)
    VALUES (
        NEW.id,
        COALESCE(NEW.raw_user_meta_data->>'name', 'Runner'),
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'phone', ''),
        COALESCE((NEW.raw_user_meta_data->>'role')::user_role, 'runner')
    );
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.handle_new_user();

-- =====================================================================
-- ROW LEVEL SECURITY (RLS)
-- =====================================================================
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.certificates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payment_proofs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.race_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- Helper to check if current user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
    RETURN EXISTS (
        SELECT 1 FROM public.profiles
        WHERE id = auth.uid() AND role = 'admin'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Profiles: Public can view runner profiles, users edit their own, admins edit all
CREATE POLICY "Profiles viewable by authenticated users" ON public.profiles
    FOR SELECT TO authenticated USING (true);

CREATE POLICY "Users can update own profile" ON public.profiles
    FOR UPDATE TO authenticated USING (auth.uid() = id);

-- Events & Categories: Viewable by all, write by admin
CREATE POLICY "Events are viewable by everyone" ON public.events
    FOR SELECT TO public USING (true);

CREATE POLICY "Events editable by admin" ON public.events
    FOR ALL TO authenticated USING (public.is_admin());

CREATE POLICY "Categories viewable by everyone" ON public.categories
    FOR SELECT TO public USING (true);

CREATE POLICY "Categories editable by admin" ON public.categories
    FOR ALL TO authenticated USING (public.is_admin());

-- Registrations: User can view and create own, Admin can view and edit all
CREATE POLICY "Users view own registrations" ON public.registrations
    FOR SELECT TO authenticated USING (auth.uid() = user_id OR public.is_admin());

CREATE POLICY "Users create own registrations" ON public.registrations
    FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Admins update registrations" ON public.registrations
    FOR UPDATE TO authenticated USING (public.is_admin());

-- Certificates & Payment Proofs: Owner or admin only (NFR2)
CREATE POLICY "Certificates owner and admin view" ON public.certificates
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.registrations r
            WHERE r.id = registration_id AND (r.user_id = auth.uid() OR public.is_admin())
        )
    );

CREATE POLICY "Certificates insert by owner" ON public.certificates
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.registrations r
            WHERE r.id = registration_id AND r.user_id = auth.uid()
        )
    );

CREATE POLICY "Payment proofs owner and admin view" ON public.payment_proofs
    FOR SELECT TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.registrations r
            WHERE r.id = registration_id AND (r.user_id = auth.uid() OR public.is_admin())
        )
    );

CREATE POLICY "Payment proofs insert by owner" ON public.payment_proofs
    FOR INSERT TO authenticated
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.registrations r
            WHERE r.id = registration_id AND r.user_id = auth.uid()
        )
    );

CREATE POLICY "Payment proofs review update by admin" ON public.payment_proofs
    FOR UPDATE TO authenticated USING (public.is_admin());

-- Strava Connections: Owner only
CREATE POLICY "Strava connections owner view" ON public.strava_connections
    FOR SELECT TO authenticated USING (auth.uid() = user_id);

CREATE POLICY "Strava connections owner modify" ON public.strava_connections
    FOR ALL TO authenticated USING (auth.uid() = user_id);

-- Race Results: Public can view for dashboard, admin can update/override
CREATE POLICY "Race results viewable by everyone" ON public.race_results
    FOR SELECT TO public USING (true);

CREATE POLICY "Race results editable by admin" ON public.race_results
    FOR ALL TO authenticated USING (public.is_admin());
