CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, imie, nazwisko)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'imie', ''),
    COALESCE(NEW.raw_user_meta_data->>'nazwisko', '')
  );
  -- Nowe konta NIE otrzymują automatycznie żadnej roli.
  -- Rolę koordynatora nadaje się ręcznie w SQL Editor po pierwszej rejestracji:
  --   INSERT INTO user_roles (user_id, role)
  --   SELECT id, 'coordinator' FROM auth.users WHERE email = 'twoj@email.pl';
  -- Kolejnym użytkownikom rolę nadaje koordynator z poziomu panelu.
  RETURN NEW;
END;
$function$;