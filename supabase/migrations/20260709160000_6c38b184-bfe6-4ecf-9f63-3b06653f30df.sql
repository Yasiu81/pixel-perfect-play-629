-- Zdjęcie profilowe opiekuna (avatar), wgrywane przez koordynatora na podstawie
-- identyfikatora. Bucket publiczny (niska wrażliwość — samo zdjęcie twarzy do
-- rozpoznania w liście/czacie), zapis zastrzeżony wyłącznie dla koordynatora.

ALTER TABLE public.profiles ADD COLUMN avatar_path TEXT;

INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "avatars_coordinator_insert" ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'coordinator'));

CREATE POLICY "avatars_coordinator_update" ON storage.objects FOR UPDATE TO authenticated
  USING (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'coordinator'));

CREATE POLICY "avatars_coordinator_delete" ON storage.objects FOR DELETE TO authenticated
  USING (bucket_id = 'avatars' AND public.has_role(auth.uid(), 'coordinator'));

-- Odczyt: bucket jest publiczny (obsłużone przez flagę public=true na poziomie
-- Storage), ta polityka dodatkowo pozwala też na odczyt przez zwykłe zapytania authenticated.
CREATE POLICY "avatars_read_all" ON storage.objects FOR SELECT TO authenticated, anon
  USING (bucket_id = 'avatars');
