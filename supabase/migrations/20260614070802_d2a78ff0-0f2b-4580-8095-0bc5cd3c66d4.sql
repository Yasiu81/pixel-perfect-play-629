ALTER TABLE public.visits ALTER COLUMN hours_billed DROP NOT NULL;
ALTER TABLE public.visits ALTER COLUMN hours_billed DROP DEFAULT;
UPDATE public.visits SET hours_billed = NULL WHERE hours_billed = 0 AND status IN ('planned','active');