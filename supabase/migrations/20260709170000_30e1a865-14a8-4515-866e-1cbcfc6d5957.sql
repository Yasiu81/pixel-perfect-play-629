-- Utwardzenie RLS: dotychczasowe polityki UPDATE ograniczają WIERSZE
-- (np. "caregiver_id = auth.uid()"), ale nie KOLUMNY. Opiekun mógł więc
-- teoretycznie w ramach własnej wizyty zmienić dowolne pole — łącznie z
-- godzinami rozliczeniowymi, terminem wizyty czy przypisaniem seniora/opiekuna.
-- Poniższe triggery domykają tę lukę bez naruszania uprawnień koordynatora.

-- 1) Godziny rozliczeniowe (hours_billed) liczone WYŁĄCZNIE po stronie bazy,
--    na podstawie realnych actual_start/actual_end — klient nie może już
--    przesłać dowolnej wartości. Zachowuje regułę 50/10 z aplikacji opiekuna.
CREATE OR REPLACE FUNCTION public.calc_hours_billed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.actual_start IS NOT NULL AND NEW.actual_end IS NOT NULL THEN
    NEW.hours_billed := GREATEST(0, FLOOR(EXTRACT(EPOCH FROM (NEW.actual_end - NEW.actual_start)) / 3600));
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER visits_calc_hours_billed
  BEFORE INSERT OR UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.calc_hours_billed();

-- 2) Opiekun nie może zmienić terminu wizyty, przypisania seniora ani opiekuna
--    (to wyłącznie decyzja koordynatora). Koordynator nie jest tym ograniczony.
CREATE OR REPLACE FUNCTION public.restrict_caregiver_visit_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'coordinator') THEN
    RETURN NEW;
  END IF;

  IF NEW.planned_start IS DISTINCT FROM OLD.planned_start
     OR NEW.planned_end IS DISTINCT FROM OLD.planned_end
     OR NEW.senior_id IS DISTINCT FROM OLD.senior_id
     OR NEW.caregiver_id IS DISTINCT FROM OLD.caregiver_id
  THEN
    RAISE EXCEPTION 'Opiekun nie może zmieniać terminu, seniora ani przypisania wizyty.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER visits_restrict_caregiver_update
  BEFORE UPDATE ON public.visits
  FOR EACH ROW EXECUTE FUNCTION public.restrict_caregiver_visit_update();

-- 3) Czynności wizyty: opiekun może zaznaczyć wykonanie, dodać uwagę i odpowiedź,
--    ale nie może zmienić nazwy czynności ani wyłączyć flagi "wymaga odpowiedzi"
--    (to ustawia koordynator).
CREATE OR REPLACE FUNCTION public.restrict_caregiver_task_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'coordinator') THEN
    RETURN NEW;
  END IF;

  IF NEW.task_name IS DISTINCT FROM OLD.task_name
     OR NEW.requires_response IS DISTINCT FROM OLD.requires_response
     OR NEW.visit_id IS DISTINCT FROM OLD.visit_id
  THEN
    RAISE EXCEPTION 'Opiekun nie może zmienić nazwy czynności ani wymogu odpowiedzi.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER visit_tasks_restrict_caregiver_update
  BEFORE UPDATE ON public.visit_tasks
  FOR EACH ROW EXECUTE FUNCTION public.restrict_caregiver_task_update();

-- 4) Czat: strona NIE będąca nadawcą może zmienić wyłącznie read_at
--    (oznaczenie jako przeczytane) — nie może podmienić treści wiadomości.
CREATE OR REPLACE FUNCTION public.restrict_message_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.has_role(auth.uid(), 'coordinator') THEN
    RETURN NEW; -- koordynator może np. skorygować własną pomyłkę
  END IF;

  IF NEW.body IS DISTINCT FROM OLD.body
     OR NEW.sender_id IS DISTINCT FROM OLD.sender_id
     OR NEW.caregiver_id IS DISTINCT FROM OLD.caregiver_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
  THEN
    RAISE EXCEPTION 'Można zmienić wyłącznie status przeczytania wiadomości.';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_restrict_update
  BEFORE UPDATE ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.restrict_message_update();
