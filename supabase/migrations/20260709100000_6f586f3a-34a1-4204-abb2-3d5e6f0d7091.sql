-- Poziomy dostępu rodziny w Strefie Klienta:
-- dostep_opiekunczy: wizyty, raporty, kalendarz, parametry życiowe (domyślnie zawsze true)
-- dostep_finansowy: Dokumenty (w tym Faktury) + saldo godzin / stawka seniora

ALTER TABLE public.family_access
  ADD COLUMN dostep_opiekunczy BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN dostep_finansowy BOOLEAN NOT NULL DEFAULT true;

-- Pozwala zalogowanemu użytkownikowi (w tym rodzinie) zapisać WŁASNE zdarzenie
-- odczytu dokumentu do audit_log — do logu dostępu widocznego koordynatorowi
-- w zakładce Rodzina (wymóg RODO/kontroli MOPS).
CREATE POLICY "audit_log_self_read_document_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    operation = 'READ_DOCUMENT'
    AND user_id = auth.uid()
    AND table_name = 'senior_documents'
  );
