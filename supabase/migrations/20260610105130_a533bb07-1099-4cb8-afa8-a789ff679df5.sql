
-- =========================
-- ENUMS
-- =========================
CREATE TYPE public.app_role AS ENUM ('coordinator', 'caregiver');
CREATE TYPE public.visit_status AS ENUM ('planned', 'active', 'completed', 'alert', 'requires_verification');
CREATE TYPE public.senior_status AS ENUM ('aktywny', 'wygasa', 'nieaktywny');
CREATE TYPE public.alert_type AS ENUM ('gps_mismatch', 'nfc_mismatch', 'late_start', 'early_end', 'sos', 'missing_nfc');

-- =========================
-- updated_at helper
-- =========================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SET search_path = public;

-- =========================
-- PROFILES (1:1 z auth.users)
-- =========================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  imie TEXT NOT NULL DEFAULT '',
  nazwisko TEXT NOT NULL DEFAULT '',
  email TEXT,
  telefon TEXT,
  dzielnice TEXT[] DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.profiles TO authenticated;
GRANT ALL ON public.profiles TO service_role;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- USER ROLES
-- =========================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role public.app_role NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

GRANT SELECT ON public.user_roles TO authenticated;
GRANT ALL ON public.user_roles TO service_role;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Security definer: sprawdza rolę bez rekursji RLS
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role public.app_role)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;

-- =========================
-- SENIORS
-- =========================
CREATE TABLE public.seniors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  imie TEXT NOT NULL,
  nazwisko TEXT NOT NULL,
  pesel TEXT,
  telefon TEXT,
  telefon_rodziny TEXT,
  adres TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  notatka_techniczna TEXT,
  nfc_uid TEXT UNIQUE,
  decyzja_nr TEXT,
  decyzja_data DATE,
  decyzja_od DATE,
  decyzja_do DATE,
  godziny_min INTEGER NOT NULL DEFAULT 0,
  godziny_max INTEGER NOT NULL DEFAULT 0,
  stawka_h NUMERIC(10,2) NOT NULL DEFAULT 0,
  plan_wsparcia JSONB DEFAULT '[]'::jsonb,
  opiekun_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  status public.senior_status NOT NULL DEFAULT 'aktywny',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.seniors TO authenticated;
GRANT ALL ON public.seniors TO service_role;
ALTER TABLE public.seniors ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_seniors_opiekun ON public.seniors(opiekun_id);
CREATE INDEX idx_seniors_status ON public.seniors(status);

CREATE TRIGGER trg_seniors_updated_at
  BEFORE UPDATE ON public.seniors
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- VISITS
-- =========================
CREATE TABLE public.visits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id UUID NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  planned_start TIMESTAMPTZ NOT NULL,
  planned_end TIMESTAMPTZ NOT NULL,
  actual_start TIMESTAMPTZ,
  actual_end TIMESTAMPTZ,
  status public.visit_status NOT NULL DEFAULT 'planned',
  nfc_verified_entry BOOLEAN NOT NULL DEFAULT FALSE,
  nfc_verified_exit BOOLEAN NOT NULL DEFAULT FALSE,
  gps_verified_entry BOOLEAN NOT NULL DEFAULT FALSE,
  gps_verified_exit BOOLEAN NOT NULL DEFAULT FALSE,
  gps_distance_entry_m INTEGER,
  gps_distance_exit_m INTEGER,
  hours_billed INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visits TO authenticated;
GRANT ALL ON public.visits TO service_role;
ALTER TABLE public.visits ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_visits_senior ON public.visits(senior_id);
CREATE INDEX idx_visits_caregiver ON public.visits(caregiver_id);
CREATE INDEX idx_visits_planned_start ON public.visits(planned_start);
CREATE INDEX idx_visits_status ON public.visits(status);

CREATE TRIGGER trg_visits_updated_at
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =========================
-- VISIT TASKS
-- =========================
CREATE TABLE public.visit_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  task_name TEXT NOT NULL,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_tasks TO authenticated;
GRANT ALL ON public.visit_tasks TO service_role;
ALTER TABLE public.visit_tasks ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_visit_tasks_visit ON public.visit_tasks(visit_id);

-- =========================
-- ALERTS
-- =========================
CREATE TABLE public.alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID REFERENCES public.visits(id) ON DELETE CASCADE,
  senior_id UUID REFERENCES public.seniors(id) ON DELETE CASCADE,
  caregiver_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  type public.alert_type NOT NULL,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved BOOLEAN NOT NULL DEFAULT FALSE,
  resolved_by UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.alerts TO authenticated;
GRANT ALL ON public.alerts TO service_role;
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_alerts_resolved ON public.alerts(resolved);
CREATE INDEX idx_alerts_visit ON public.alerts(visit_id);

-- =========================
-- VISIT PHOTOS
-- =========================
CREATE TABLE public.visit_photos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  visit_id UUID NOT NULL REFERENCES public.visits(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.visit_photos TO authenticated;
GRANT ALL ON public.visit_photos TO service_role;
ALTER TABLE public.visit_photos ENABLE ROW LEVEL SECURITY;
CREATE INDEX idx_visit_photos_visit ON public.visit_photos(visit_id);

-- =========================
-- RLS POLICIES
-- =========================

-- PROFILES: każdy widzi swój profil; koordynator widzi i edytuje wszystkie
CREATE POLICY "profiles_self_select" ON public.profiles FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "profiles_self_update" ON public.profiles FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "profiles_coordinator_insert" ON public.profiles FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "profiles_coordinator_delete" ON public.profiles FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

-- USER_ROLES: użytkownik widzi swoje role; koordynator widzi/zarządza wszystkimi
CREATE POLICY "user_roles_self_select" ON public.user_roles FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'coordinator'));
-- INSERT/UPDATE/DELETE: tylko koordynator (zapobiega samoeskalacji uprawnień)
-- Brak grantów INSERT/UPDATE/DELETE dla authenticated — robi to wyłącznie service_role / koordynator przez serwer

-- SENIORS: koordynator wszystko; opiekun widzi tylko swoich
CREATE POLICY "seniors_coordinator_all" ON public.seniors FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "seniors_caregiver_select" ON public.seniors FOR SELECT TO authenticated
  USING (opiekun_id = auth.uid());

-- VISITS: koordynator wszystko; opiekun widzi i aktualizuje swoje
CREATE POLICY "visits_coordinator_all" ON public.visits FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "visits_caregiver_select" ON public.visits FOR SELECT TO authenticated
  USING (caregiver_id = auth.uid());
CREATE POLICY "visits_caregiver_update" ON public.visits FOR UPDATE TO authenticated
  USING (caregiver_id = auth.uid())
  WITH CHECK (caregiver_id = auth.uid());

-- VISIT_TASKS: koordynator wszystko; opiekun widzi i edytuje czynności swoich wizyt
CREATE POLICY "visit_tasks_coordinator_all" ON public.visit_tasks FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "visit_tasks_caregiver_select" ON public.visit_tasks FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()));
CREATE POLICY "visit_tasks_caregiver_modify" ON public.visit_tasks FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()))
  WITH CHECK (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()));
CREATE POLICY "visit_tasks_caregiver_insert" ON public.visit_tasks FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()));

-- ALERTS: koordynator wszystko; opiekun widzi swoje
CREATE POLICY "alerts_coordinator_all" ON public.alerts FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "alerts_caregiver_select" ON public.alerts FOR SELECT TO authenticated
  USING (caregiver_id = auth.uid());
CREATE POLICY "alerts_caregiver_insert" ON public.alerts FOR INSERT TO authenticated
  WITH CHECK (caregiver_id = auth.uid());

-- VISIT_PHOTOS: koordynator wszystko; opiekun widzi i dodaje do swoich wizyt
CREATE POLICY "visit_photos_coordinator_all" ON public.visit_photos FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "visit_photos_caregiver_select" ON public.visit_photos FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()));
CREATE POLICY "visit_photos_caregiver_insert" ON public.visit_photos FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM public.visits v WHERE v.id = visit_id AND v.caregiver_id = auth.uid()));

-- =========================
-- AUTO-CREATE PROFILE ON SIGNUP
-- =========================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, imie, nazwisko)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'imie', ''),
    COALESCE(NEW.raw_user_meta_data->>'nazwisko', '')
  );
  -- Pierwszy zarejestrowany użytkownik dostaje rolę koordynatora; pozostali nie dostają nic (koordynator nadaje ręcznie)
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE role = 'coordinator') THEN
    INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'coordinator');
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();
