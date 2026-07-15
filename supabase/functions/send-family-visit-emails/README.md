# send-family-visit-emails

Wysyła raz dziennie e-mail podsumowujący do rodziny każdego seniora z zakończoną
tego dnia wizytą (godziny + wykonane czynności + notatka opiekunki), tylko do
osób z `dostep_opiekunczy = true` w `family_access`. Wysyłka idzie przez SMTP
skrzynki **administracja@planseniora.pl** — kopia trafia też do „Wysłane” w Outlooku.

## 1. Sprawdź / włącz SMTP AUTH dla skrzynki (ważne!)

Microsoft 365 domyślnie wyłącza zwykłe logowanie SMTP dla nowych skrzynek.
W M365 Admin Center → Users → administracja@planseniora.pl → Mail → Manage
email apps → upewnij się, że **"Authenticated SMTP"** jest włączone.
Jeśli na koncie jest MFA — będziesz potrzebować **hasła aplikacji** (App
Password) zamiast zwykłego hasła logowania.

## 2. Ustaw sekrety (NIGDY nie wpisuj tego do plików w repo!)

```bash
supabase link --project-ref rdzhczahchvrfbtgiycu
supabase secrets set SMTP_HOST=smtp.office365.com
supabase secrets set SMTP_PORT=587
supabase secrets set SMTP_USER=administracja@planseniora.pl
supabase secrets set SMTP_PASSWORD="<hasło lub hasło aplikacji>"
```

(`config.toml` w repo ma inny `project_id` — placeholder z szablonu. Zawsze
linkuj ręcznie do właściwego projektu przed `deploy`/`secrets set`.)

## 3. Wdróż funkcję

```bash
supabase functions deploy send-family-visit-emails
```

## 4. Test ręczny (bez czekania na harmonogram)

```bash
curl -X POST \
  https://rdzhczahchvrfbtgiycu.supabase.co/functions/v1/send-family-visit-emails \
  -H "Authorization: Bearer <SERVICE_ROLE_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"date": "2026-07-10"}'
```

Albo po prostu przycisk **„Wyślij teraz za ten dzień"** w zakładce Historia
w aplikacji — robi dokładnie to samo.

## 5. Harmonogram (codziennie, automatycznie)

Najprościej przez **Supabase Dashboard → Database → Cron Jobs → Create job**
(nowsza funkcja Supabase, nie wymaga wklejania service_role key do SQL):
- Typ: "Edge Function"
- Funkcja: `send-family-visit-emails`
- Harmonogram: np. `0 19 * * *` (19:00 UTC ≈ 20:00/21:00 czasu PL, do dostosowania)
- Body: `{}` (funkcja sama weźmie dzisiejszą datę)

Jeśli Twój plan Supabase nie ma jeszcze tej opcji w Dashboardzie, alternatywa
to `pg_cron` + `pg_net` wywołujące funkcję przez `net.http_post(...)` — ale
wymaga to wpisania `SERVICE_ROLE_KEY` w SQL Editorze **ręcznie, nie przez plik
migracji w repo** (żeby sekret nie trafił do gita). Daj znać, jeśli wolisz tę
opcję, to przygotuję dokładny SQL do wklejenia bezpośrednio w Supabase.

## Co jeśli SMTP przez Outlooka jednak nie zadziała?

Jeśli po włączeniu SMTP AUTH nadal będą błędy (częste w M365 przez rosnące
restrykcje Microsoftu), da się to przełączyć na Resend/SendGrid zmieniając
tylko kilka linii w `index.ts` (reszta logiki — pobieranie wizyt, rodzin,
budowanie treści, logowanie do `family_email_log` — zostaje bez zmian).
