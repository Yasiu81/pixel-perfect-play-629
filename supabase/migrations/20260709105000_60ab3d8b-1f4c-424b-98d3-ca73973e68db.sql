-- UWAGA: ALTER TYPE ... ADD VALUE MUSI być w osobnej transakcji/migracji —
-- patrz analogiczna, już znana pułapka z app_role przy migracji 20260625 (family_access).
-- Nowe statusy zlecenia dodatkowego: zgłoszone przez rodzinę (do akceptacji) / odrzucone.

ALTER TYPE public.additional_order_status ADD VALUE IF NOT EXISTS 'do_akceptacji';
ALTER TYPE public.additional_order_status ADD VALUE IF NOT EXISTS 'odrzucona';
