-- Rodzina może zgłosić zapotrzebowanie (np. "dodatkowa złota rączka na czwartek")
-- z poziomu Strefy Klienta. Trafia jako additional_orders ze statusem 'do_akceptacji'
-- widoczne koordynatorowi w Monitorze Wizyt do zaakceptowania/odrzucenia.
--
-- Wartości enuma 'do_akceptacji' i 'odrzucona' zostały dodane w POPRZEDNIEJ,
-- osobnej migracji (20260709105000) — musiały być w osobnej transakcji.

ALTER TABLE public.additional_orders
  ADD COLUMN requested_by UUID REFERENCES public.profiles(id),
  ADD COLUMN requested_by_family BOOLEAN NOT NULL DEFAULT false;

-- Rodzina może dodać zgłoszenie WYŁĄCZNIE dla seniora, do którego ma dostęp
-- (dowolny poziom — to prośba, nie dane finansowe), zawsze ze statusem 'do_akceptacji'.
CREATE POLICY "additional_orders_family_insert" ON public.additional_orders FOR INSERT TO authenticated
  WITH CHECK (
    status = 'do_akceptacji'
    AND requested_by = auth.uid()
    AND requested_by_family = true
    AND EXISTS (
      SELECT 1 FROM public.family_access fa
      WHERE fa.senior_id = additional_orders.senior_id AND fa.user_id = auth.uid()
    )
  );

-- Rodzina widzi WYŁĄCZNIE własne zgłoszenia (żeby śledzić status), nie widzi
-- pozostałych zleceń dodatkowych utworzonych przez koordynatora.
CREATE POLICY "additional_orders_family_select_own" ON public.additional_orders FOR SELECT TO authenticated
  USING (requested_by_family = true AND requested_by = auth.uid());
