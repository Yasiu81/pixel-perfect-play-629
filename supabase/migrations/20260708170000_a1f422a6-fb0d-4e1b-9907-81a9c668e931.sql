-- Rozliczenia kadrowo-księgowe opiekunów: stawka godzinowa + opcjonalny VAT
-- ustawiane przez koordynatora, oraz miesięczne rozliczenia z załączoną
-- fakturą wystawioną zewnętrznie (KSeF) przez opiekuna.

ALTER TABLE public.profiles
  ADD COLUMN stawka_h NUMERIC(10,2),
  ADD COLUMN stawka_vat NUMERIC(5,2); -- np. 23.00, 8.00, 0.00; NULL = nie dotyczy (np. umowa zlecenie)

CREATE TABLE public.caregiver_invoices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  month DATE NOT NULL, -- zawsze pierwszy dzień miesiąca, np. 2026-07-01
  hours NUMERIC(10,2) NOT NULL DEFAULT 0,
  stawka_h NUMERIC(10,2),
  vat_rate NUMERIC(5,2),
  kwota_netto NUMERIC(10,2),
  kwota_brutto NUMERIC(10,2),
  file_path TEXT,
  file_name TEXT,
  status TEXT NOT NULL DEFAULT 'oczekuje', -- oczekuje | zaakceptowana | zaplacona
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (caregiver_id, month)
);

CREATE TRIGGER caregiver_invoices_updated_at
  BEFORE UPDATE ON public.caregiver_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.caregiver_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "caregiver_invoices_coordinator_all" ON public.caregiver_invoices FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

CREATE INDEX caregiver_invoices_caregiver_month_idx ON public.caregiver_invoices (caregiver_id, month);
