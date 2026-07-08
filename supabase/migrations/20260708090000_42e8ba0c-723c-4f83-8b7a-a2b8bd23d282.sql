-- Zlecenia dodatkowe: usługi wykraczające poza standardowe wizyty opiekunek
-- (np. transport medyczny, usługa złotej rączki), niezwiązane z listą opiekunek.

CREATE TYPE public.additional_order_status AS ENUM ('planned', 'active', 'completed');

CREATE TABLE public.additional_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  senior_id UUID NOT NULL REFERENCES public.seniors(id) ON DELETE CASCADE,
  order_type TEXT NOT NULL, -- np. 'transport_medyczny', 'zlota_raczka', 'inne'
  description TEXT,
  contractor TEXT, -- wykonawca: dowolny tekst, niekoniecznie opiekun z systemu
  scheduled_date DATE NOT NULL,
  scheduled_start TIME,
  scheduled_end TIME,
  status public.additional_order_status NOT NULL DEFAULT 'planned',
  cost NUMERIC,
  notes TEXT,
  created_by UUID REFERENCES public.profiles(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TRIGGER additional_orders_updated_at
  BEFORE UPDATE ON public.additional_orders
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE INDEX additional_orders_scheduled_date_idx ON public.additional_orders (scheduled_date);
CREATE INDEX additional_orders_senior_id_idx ON public.additional_orders (senior_id);

ALTER TABLE public.additional_orders ENABLE ROW LEVEL SECURITY;

-- Na tym etapie: tylko koordynator ma dostęp (opiekunki i rodzina nie widzą zleceń dodatkowych)
CREATE POLICY "additional_orders_coordinator_all" ON public.additional_orders FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));
