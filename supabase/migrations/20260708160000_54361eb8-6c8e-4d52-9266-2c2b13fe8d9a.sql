-- Pozwala każdemu zalogowanemu użytkownikowi (koordynator/opiekun) zapisać
-- WŁASNE zdarzenie logowania do audit_log (operation = 'LOGIN', user_id = auth.uid()).
-- Odczyt audit_log pozostaje zastrzeżony wyłącznie dla koordynatora (patrz migracja 20260612).

CREATE POLICY "audit_log_self_login_insert" ON public.audit_log FOR INSERT TO authenticated
  WITH CHECK (
    operation = 'LOGIN'
    AND user_id = auth.uid()
    AND table_name = 'auth_session'
  );
