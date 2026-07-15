-- Czat koordynator ↔ opiekun. Jeden wątek na opiekuna (caregiver_id) —
-- każdy koordynator widzi i może odpisywać we wszystkich wątkach ("wspólna
-- skrzynka biura"), opiekun widzi wyłącznie swój własny wątek.

CREATE TABLE public.messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  caregiver_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE, -- do którego wątku (opiekuna) należy
  sender_id UUID NOT NULL REFERENCES public.profiles(id),
  body TEXT NOT NULL,
  read_at TIMESTAMPTZ, -- kiedy przeczytane przez drugą stronę
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX messages_caregiver_id_idx ON public.messages (caregiver_id, created_at);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Koordynator: pełny dostęp do wszystkich wątków (odczyt, wysyłanie, oznaczanie jako przeczytane)
CREATE POLICY "messages_coordinator_all" ON public.messages FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'coordinator'))
  WITH CHECK (public.has_role(auth.uid(), 'coordinator'));

-- Opiekun: widzi tylko własny wątek
CREATE POLICY "messages_caregiver_select_own" ON public.messages FOR SELECT TO authenticated
  USING (caregiver_id = auth.uid());

-- Opiekun: może pisać tylko we własnym wątku, wyłącznie jako nadawca = on sam
CREATE POLICY "messages_caregiver_insert_own" ON public.messages FOR INSERT TO authenticated
  WITH CHECK (caregiver_id = auth.uid() AND sender_id = auth.uid());

-- Opiekun: może oznaczyć jako przeczytane WYŁĄCZNIE wiadomości od koordynatora w swoim wątku
CREATE POLICY "messages_caregiver_mark_read" ON public.messages FOR UPDATE TO authenticated
  USING (caregiver_id = auth.uid() AND sender_id <> auth.uid())
  WITH CHECK (caregiver_id = auth.uid() AND sender_id <> auth.uid());

-- Włącz Realtime dla czatu (live odświeżanie po obu stronach)
ALTER PUBLICATION supabase_realtime ADD TABLE public.messages;

-- Powiadomienie (i tym samym push, przez istniejący mechanizm notifications+Realtime)
-- przy każdej nowej wiadomości: opiekun -> wszyscy koordynatorzy, koordynator -> ten opiekun.
CREATE OR REPLACE FUNCTION public.notify_on_new_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  sender_name text;
BEGIN
  SELECT trim(coalesce(imie, '') || ' ' || coalesce(nazwisko, ''))
    INTO sender_name FROM public.profiles WHERE id = NEW.sender_id;

  IF NEW.sender_id = NEW.caregiver_id THEN
    -- Nadawca = opiekun -> powiadom wszystkich koordynatorów
    INSERT INTO public.notifications (user_id, tytul, tresc, url)
    SELECT ur.user_id,
           'Nowa wiadomość od ' || COALESCE(NULLIF(sender_name, ''), 'opiekuna'),
           left(NEW.body, 200),
           '/czat?opiekun=' || NEW.caregiver_id
    FROM public.user_roles ur WHERE ur.role = 'coordinator';
  ELSE
    -- Nadawca = koordynator -> powiadom opiekuna wątku
    INSERT INTO public.notifications (user_id, tytul, tresc, url)
    VALUES (NEW.caregiver_id, 'Nowa wiadomość od koordynatora', left(NEW.body, 200), '/opiekun');
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER messages_notify_trigger
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.notify_on_new_message();
