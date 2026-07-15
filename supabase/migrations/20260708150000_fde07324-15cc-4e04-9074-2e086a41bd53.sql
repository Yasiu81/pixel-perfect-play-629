-- Umiejętności opiekuna: wolne tagi wpisywane przez koordynatora (do wyszukiwarki
-- w panelu Opiekunowie, obok istniejących szkoleń w caregiver_trainings).

ALTER TABLE public.profiles
  ADD COLUMN umiejetnosci text[] NOT NULL DEFAULT '{}';

CREATE INDEX profiles_umiejetnosci_idx ON public.profiles USING GIN (umiejetnosci);
