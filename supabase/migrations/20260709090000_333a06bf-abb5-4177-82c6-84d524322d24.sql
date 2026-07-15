-- Zamknięcie okresu rozliczeniowego (miesiąca) przez koordynatora.
-- Po zamknięciu: żadna wizyta ani zlecenie dodatkowe z tego miesiąca nie może
-- być dodane, zmienione ani usunięte (RESTRICTIVE policy — dotyczy KAŻDEJ roli,
-- w tym koordynatora i opiekuna). Odblokowanie = świadome usunięcie wpisu przez
-- koordynatora w UI (rejestrowane w audit_log jak wszystkie zmiany w tej tabeli).

CREATE TABLE public.period_locks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month DATE NOT NULL UNIQUE, -- zawsze pierwszy dzień miesiąca, np. 2026-07-01
  locked_by UUID REFERENCES public.profiles(id),
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  notes TEXT
);

ALTER TABLE public.period_locks ENABLE ROW LEVEL SECURITY;

-- Odczyt: każdy zalogowany (koordynator + opiekun z aplikacji mobilnej muszą móc
-- sprawdzić, czy dany miesiąc jest zamknięty, np. przy synchronizacji offline).
CREATE POLICY "period_locks_select_all_authenticated" ON public.period_locks FOR SELECT TO authenticated
  USING (true);
CREATE POLICY "period_locks_coordinator_insert" ON public.period_locks FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
CREATE POLICY "period_locks_coordinator_delete" ON public.period_locks FOR DELETE TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

CREATE OR REPLACE FUNCTION public.is_month_locked(_d date)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.period_locks pl
    WHERE date_trunc('month', pl.month) = date_trunc('month', _d)
  );
$$;

-- VISITS: blokada wstecznej edycji/usunięcia/dodania w zamkniętym miesiącu
CREATE POLICY "visits_block_locked_insert" ON public.visits AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_month_locked(planned_start::date));
CREATE POLICY "visits_block_locked_update" ON public.visits AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_month_locked(planned_start::date))
  WITH CHECK (NOT public.is_month_locked(planned_start::date));
CREATE POLICY "visits_block_locked_delete" ON public.visits AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_month_locked(planned_start::date));

-- ADDITIONAL_ORDERS: to samo dla zleceń dodatkowych
CREATE POLICY "additional_orders_block_locked_insert" ON public.additional_orders AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (NOT public.is_month_locked(scheduled_date));
CREATE POLICY "additional_orders_block_locked_update" ON public.additional_orders AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (NOT public.is_month_locked(scheduled_date))
  WITH CHECK (NOT public.is_month_locked(scheduled_date));
CREATE POLICY "additional_orders_block_locked_delete" ON public.additional_orders AS RESTRICTIVE FOR DELETE TO authenticated
  USING (NOT public.is_month_locked(scheduled_date));

-- Rejestruj zamknięcie/otwarcie miesiąca w audit_log (spójnie z resztą systemu)
CREATE OR REPLACE FUNCTION public.audit_period_locks_changes()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
    VALUES (auth.uid(), 'period_locks', NEW.id, 'LOCK_MONTH', jsonb_build_object('month', NEW.month));
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.audit_log (user_id, table_name, record_id, operation, details)
    VALUES (auth.uid(), 'period_locks', OLD.id, 'UNLOCK_MONTH', jsonb_build_object('month', OLD.month));
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER period_locks_audit
  AFTER INSERT OR DELETE ON public.period_locks
  FOR EACH ROW EXECUTE FUNCTION public.audit_period_locks_changes();
