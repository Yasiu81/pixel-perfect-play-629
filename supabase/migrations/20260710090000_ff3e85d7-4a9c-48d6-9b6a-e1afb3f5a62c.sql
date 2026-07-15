-- Log wysłanych automatycznych e-maili do rodzin (podsumowanie dnia po wizytach).
-- Wysyłkę realnie wykonuje Edge Function `send-family-visit-emails` (przez SMTP
-- skrzynki administracja@planseniora.pl — więc kopia i tak trafia do "Wysłane"
-- w Outlooku), a ten log daje dodatkowo wgląd w samej aplikacji: komu, kiedy,
-- za jakie wizyty i czy się udało.

CREATE TABLE public.family_email_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  recipient_email TEXT NOT NULL,
  senior_id UUID REFERENCES public.seniors(id) ON DELETE SET NULL,
  visit_date DATE NOT NULL,
  visit_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'sent', -- sent | failed
  error_message TEXT,
  sent_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX family_email_log_sent_at_idx ON public.family_email_log (sent_at DESC);

ALTER TABLE public.family_email_log ENABLE ROW LEVEL SECURITY;

-- Tylko koordynator widzi log wysyłek (dane rodziny/seniora)
CREATE POLICY "family_email_log_coordinator_select" ON public.family_email_log FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'));

-- Zapis robi wyłącznie Edge Function kluczem service_role (nie authenticated) —
-- brak polityki INSERT dla authenticated jest tu celowy.
