# Plan Seniora — pełna paczka aktualizacji (stan na 10 lipca 2026)

To jest **kompletna, świeża kopia całego repo** ze wszystkimi zmianami — łącznie
z tymi z checkpointu, który już masz (`plan-seniora-checkpoint-2026-07-09.zip`),
**i wszystkim, co powstało po nim**. Możesz więc po prostu użyć TEGO pliku i
zignorować poprzedni checkpoint — nie trzeba ich łączyć.

`node_modules`, `.git`, `.vercel` są wyłączone (odtworzysz przez `npm install` / git).

---

## Jak wgrać

1. Rozpakuj folder `pixel-perfect-play-629` na wierzch swojego lokalnego,
   sklonowanego repo (nadpisując pliki), zachowując swój `.git`.
2. `npm install`
3. Zastosuj **wszystkie** migracje z sekcji niżej, **w podanej kolejności**
   (prawdopodobnie żadna z nich nie została jeszcze wgrana na Supabase, skoro
   nie miałeś dostępu do komputera).
4. Wdróż Edge Function (sekcja niżej).
5. Odśwież typy Supabase.
6. `npx tsc --noEmit` i `npx vite build` — oba powinny przejść czysto.
7. `git add -A`, commit, push.

---

## Migracje SQL — zastosuj w tej kolejności

Wszystkie poniższe powstały w tej sesji (od Etapu 2 do teraz) i **prawdopodobnie
żadna jeszcze nie jest zastosowana** na Twoim Supabase:

| # | Plik | Co robi |
|---|---|---|
| 1 | `20260708090000_..._42e8ba0c.sql` | Tabela `additional_orders` (zlecenia dodatkowe) |
| 2 | `20260708120000_..._6c167d9b.sql` | Kategorie dokumentów seniora (`senior_documents.kategoria`) |
| 3 | `20260708150000_..._fde07324.sql` | Umiejętności opiekuna (`profiles.umiejetnosci`) |
| 4 | `20260708160000_..._54361eb8.sql` | RLS: self-insert logowania do `audit_log` |
| 5 | `20260708170000_..._a1f422a6.sql` | Rozliczenia opiekunów (`stawka_h`, `stawka_vat`, tabela `caregiver_invoices`) |
| 6 | `20260709090000_..._333a06bf.sql` | **Blokada edycji wstecznej** — tabela `period_locks`, funkcja `is_month_locked()`, RESTRICTIVE policies na `visits`/`additional_orders` |
| 7 | `20260709100000_..._6f586f3a.sql` | Poziomy dostępu rodziny (`family_access.dostep_finansowy/opiekunczy`) + RLS na log odczytu dokumentów |
| 8 | `20260709105000_..._60ab3d8b.sql` | **Standalone** — nowe wartości enuma statusu zlecenia (`do_akceptacji`, `odrzucona`) — musi iść osobno przez ograniczenie Postgresa (ALTER TYPE ADD VALUE) |
| 9 | `20260709110000_..._66bed600.sql` | Zgłoszenia rodziny → `additional_orders.requested_by` + RLS |
| 10 | `20260709150000_..._d502b687.sql` | **Czat koordynator↔opiekun** — tabela `messages`, RLS, powiadomienia, Realtime |
| 11 | `20260709160000_..._6c38b184.sql` | Zdjęcia profilowe opiekunów (`profiles.avatar_path`, bucket `avatars`) |
| 12 | `20260709170000_..._30e1a865.sql` | **Utwardzenie bezpieczeństwa** — serwerowe przeliczanie `hours_billed`, blokada zmiany kolumn przez opiekuna (wizyty/czynności/czat) |
| 13 | `20260710090000_..._ff3e85d7.sql` | Log wysłanych e-maili do rodzin (`family_email_log`) |

Zastosuj przez `supabase db push` (jeśli masz CLI podpięte) albo wklejając
każdy plik po kolei w Supabase Dashboard → SQL Editor.

**Migracja #8 musi wejść jako osobna operacja** (Postgres nie pozwala użyć
nowej wartości enuma w tej samej transakcji, w której ją dodano) — jeśli
używasz `supabase db push`, kolejność plików już to zapewnia automatycznie.

---

## Po migracjach

```bash
supabase gen types typescript --project-id rdzhczahchvrfbtgiycu > src/integrations/supabase/types.ts
```
To usunie większość „nowych" błędów TS, które zobaczysz przy `tsc --noEmit`
przed odświeżeniem typów — to oczekiwane, nie są to prawdziwe bugi.

---

## Edge Function — e-mail do rodzin (osobny krok, nie SQL)

Folder: `supabase/functions/send-family-visit-emails/` — **pełna instrukcja
jest w `README.md` w tym folderze**, w skrócie:

1. W M365 Admin Center sprawdź/włącz "Authenticated SMTP" dla
   administracja@planseniora.pl (może wymagać hasła aplikacji przy MFA).
2. `supabase link --project-ref rdzhczahchvrfbtgiycu`
3. `supabase secrets set SMTP_HOST=smtp.office365.com SMTP_PORT=587 SMTP_USER=administracja@planseniora.pl SMTP_PASSWORD="..."`
4. `supabase functions deploy send-family-visit-emails`
5. Harmonogram: Supabase Dashboard → Database → Cron Jobs → wywołuj tę funkcję
   raz dziennie (np. 20:00 czasu PL).
6. Test ręczny bez czekania na harmonogram: przycisk „Wyślij teraz za ten
   dzień" w zakładce **Historia** w aplikacji.

---

## Pełna lista zmienionych/nowych plików źródłowych

**Nowe:**
- `src/components/VisitsMap.tsx` — mapa Leaflet (Monitor Wizyt)
- `src/components/CaregiverAvatar.tsx` — avatar ze zdjęciem/inicjałami
- `src/components/NotificationBell.tsx` — centrum powiadomień koordynatora
- `src/routes/_authenticated/_coordinator/historia.tsx` — historia logowań/audytu, blokady miesięcy, log e-maili
- `src/routes/_authenticated/_coordinator/czat.tsx` — czat koordynator↔opiekun
- `src/routes/_authenticated/_coordinator/ustawienia.tsx` — ustawienia konta
- `src/lib/offlineQueue.ts` — kolejka offline (IndexedDB)
- `src/hooks/useOfflineSync.ts` — hook synchronizacji offline
- `supabase/functions/send-family-visit-emails/` — Edge Function + README

**Zmienione (nadpisz w całości):**
- `package.json` — dodane `leaflet`, `react-leaflet`, `@types/leaflet`
- `src/components/CoordinatorSidebar.tsx` — Czat, Historia, Ustawienia aktywne + badge nieprzeczytanych
- `src/routes/__root.tsx` — zapis logowania do `audit_log`
- `src/routes/_authenticated/_coordinator.tsx` — dzwonek powiadomień w nagłówku
- `src/routes/_authenticated/_coordinator/wizyty.tsx` — Etap 2 (mapa, filtry dnia, zlecenia dodatkowe, akceptacja zgłoszeń rodziny, baner blokady miesiąca)
- `src/routes/_authenticated/_coordinator/seniorzy_.$id.tsx` — kalendarz (opiekun/godziny/druk/zlecenia), dokumenty wg kategorii, poziomy dostępu rodziny + log dostępu, baner blokady miesiąca
- `src/routes/_authenticated/_coordinator/opiekunowie.tsx` — wyszukiwarka, rozliczenia, avatar
- `src/routes/_authenticated/_coordinator/raporty.tsx` — zakładka „Incydenty i uwagi"
- `src/routes/_authenticated/opiekun.tsx` — tryb offline (NFC/GPS/czynności/SOS/czat), avatar-ready
- `src/routes/strefa/pulpit.tsx` — poziomy dostępu, „Zgłoś zapotrzebowanie", log odczytu dokumentów

---

## Testy do zrobienia po wdrożeniu (ważne, bezpieczeństwo)

1. **Zaloguj się jako opiekun** i spróbuj (przez np. edytor request w devtools
   albo normalnie w apce) zmienić coś w cudzej wizycie — powinno się nie udać.
2. **Zamelduj/wymelduj wizytę** — sprawdź, że `hours_billed` liczy się poprawnie
   (teraz liczone serwerowo, nie z tego co wyśle telefon).
3. **Zamknij testowy miesiąc** w Historii, spróbuj edytować wizytę z tego
   miesiąca — powinieneś dostać czytelny komunikat, nie surowy błąd.
4. **Zaloguj się jako rodzina** (konto testowe) — sprawdź czy widać imię i
   nazwisko opiekuna przy wizycie (to był potencjalny problem, o którym pisałem
   wcześniej — możliwe że polityka `profiles` wymaga poprawki, zobacz niżej).
5. Uruchom w Supabase SQL Editor i **wklej mi wynik** — to jedyny sposób,
   żebym dokończył pełny audyt RLS (nie mam wglądu w tabele, których migracji
   nie ma w repo):

```sql
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies where schemaname in ('public','storage')
order by schemaname, tablename, policyname;
```
```sql
select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relkind='r' and not c.relrowsecurity;
```

---

## Co nadal czeka (nie w tej paczce)

- Pełny audyt RLS (czeka na zapytania wyżej)
- Paczka dla MOPS (czeka na wzór formatu CAS)
- Moduł fakturowania dla klientów prywatnych (czeka na jedno pytanie o zakres)
- Własna domena `app.planseniora.pl`, żywy test NFC, test push na Androidzie — Twoje działania
