ALTER TABLE public.seniors ADD COLUMN IF NOT EXISTS pesel_last2 text;
ALTER TABLE public.seniors DROP CONSTRAINT IF EXISTS seniors_pesel_last2_chk;
ALTER TABLE public.seniors ADD CONSTRAINT seniors_pesel_last2_chk CHECK (pesel_last2 IS NULL OR pesel_last2 ~ '^[0-9]{2}$');

CREATE OR REPLACE FUNCTION public.set_senior_pesel(_senior_id uuid, _pesel text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _key text;
  _last2 text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'coordinator') THEN
    RAISE EXCEPTION 'Brak uprawnień: tylko koordynator może zapisywać PESEL';
  END IF;

  IF _pesel IS NULL OR length(_pesel) = 0 THEN
    UPDATE public.seniors
       SET pesel_encrypted = NULL,
           pesel_last2 = NULL
     WHERE id = _senior_id;
  ELSE
    IF _pesel !~ '^[0-9]{11}$' THEN
      RAISE EXCEPTION 'PESEL musi mieć 11 cyfr';
    END IF;
    _key := public._get_pesel_key();
    _last2 := right(_pesel, 2);
    UPDATE public.seniors
       SET pesel_encrypted = extensions.pgp_sym_encrypt(_pesel, _key),
           pesel_last2 = _last2
     WHERE id = _senior_id;
  END IF;

  INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
  VALUES (auth.uid(), 'seniors', _senior_id, 'UPDATE_PESEL', jsonb_build_object('cleared', _pesel IS NULL));
END;
$function$;