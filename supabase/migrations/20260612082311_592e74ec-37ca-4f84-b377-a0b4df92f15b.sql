
-- 1. Rozszerzenia
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS supabase_vault;

-- 2. Klucz szyfrujący w Vault (tylko jeśli jeszcze nie istnieje)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'pesel_encryption_key') THEN
    PERFORM vault.create_secret(
      encode(extensions.gen_random_bytes(32), 'base64'),
      'pesel_encryption_key',
      'Klucz symetryczny do szyfrowania numerów PESEL w tabeli seniors'
    );
  END IF;
END $$;

-- 3. Tabela audit_log
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  table_name text NOT NULL,
  record_id uuid,
  operation text NOT NULL,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT ON public.audit_log TO authenticated;
GRANT ALL ON public.audit_log TO service_role;

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Koordynator widzi audit_log" ON public.audit_log;
CREATE POLICY "Koordynator widzi audit_log"
  ON public.audit_log FOR SELECT
  TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

CREATE INDEX IF NOT EXISTS audit_log_table_record_idx
  ON public.audit_log (table_name, record_id, created_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_user_idx
  ON public.audit_log (user_id, created_at DESC);

-- 4. Zamiana kolumny pesel na zaszyfrowaną bytea
ALTER TABLE public.seniors DROP COLUMN IF EXISTS pesel;
ALTER TABLE public.seniors ADD COLUMN pesel_encrypted bytea;

-- 5. Funkcja pobierająca klucz z Vault
CREATE OR REPLACE FUNCTION public._get_pesel_key()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, vault
AS $$
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'pesel_encryption_key' LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public._get_pesel_key() FROM PUBLIC, anon, authenticated;

-- 6. Zapis PESEL (tylko koordynator)
CREATE OR REPLACE FUNCTION public.set_senior_pesel(_senior_id uuid, _pesel text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _key text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'coordinator') THEN
    RAISE EXCEPTION 'Brak uprawnień: tylko koordynator może zapisywać PESEL';
  END IF;

  IF _pesel IS NULL OR length(_pesel) = 0 THEN
    UPDATE public.seniors SET pesel_encrypted = NULL WHERE id = _senior_id;
  ELSE
    _key := public._get_pesel_key();
    UPDATE public.seniors
       SET pesel_encrypted = extensions.pgp_sym_encrypt(_pesel, _key)
     WHERE id = _senior_id;
  END IF;

  INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
  VALUES (auth.uid(), 'seniors', _senior_id, 'UPDATE_PESEL', jsonb_build_object('cleared', _pesel IS NULL));
END;
$$;

REVOKE ALL ON FUNCTION public.set_senior_pesel(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_senior_pesel(uuid, text) TO authenticated;

-- 7. Odczyt PESEL (tylko koordynator) + audyt
CREATE OR REPLACE FUNCTION public.get_senior_pesel(_senior_id uuid)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  _key text;
  _enc bytea;
  _result text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'coordinator') THEN
    RAISE EXCEPTION 'Brak uprawnień: tylko koordynator może odczytywać PESEL';
  END IF;

  SELECT pesel_encrypted INTO _enc FROM public.seniors WHERE id = _senior_id;
  IF _enc IS NULL THEN
    _result := NULL;
  ELSE
    _key := public._get_pesel_key();
    _result := extensions.pgp_sym_decrypt(_enc, _key);
  END IF;

  INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
  VALUES (auth.uid(), 'seniors', _senior_id, 'READ_PESEL', jsonb_build_object('found', _enc IS NOT NULL));

  RETURN _result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_senior_pesel(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_senior_pesel(uuid) TO authenticated;

-- 8. Trigger audytujący zapisy na seniors
CREATE OR REPLACE FUNCTION public.audit_seniors_changes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _rec_id uuid;
BEGIN
  _rec_id := COALESCE(NEW.id, OLD.id);
  INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
  VALUES (
    auth.uid(),
    'seniors',
    _rec_id,
    TG_OP,
    CASE
      WHEN TG_OP = 'DELETE' THEN jsonb_build_object('imie', OLD.imie, 'nazwisko', OLD.nazwisko)
      WHEN TG_OP = 'INSERT' THEN jsonb_build_object('imie', NEW.imie, 'nazwisko', NEW.nazwisko)
      ELSE jsonb_build_object('imie', NEW.imie, 'nazwisko', NEW.nazwisko)
    END
  );
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_seniors ON public.seniors;
CREATE TRIGGER trg_audit_seniors
  AFTER INSERT OR UPDATE OR DELETE ON public.seniors
  FOR EACH ROW EXECUTE FUNCTION public.audit_seniors_changes();
