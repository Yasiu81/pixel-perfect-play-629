# Kartoteka seniora + bezpieczne odsłanianie PESEL

## 1. Baza — kolumna `pesel_last2` (bez spamu audit logu)

Pokazanie zamaskowanego PESEL-a w tabeli wymaga znajomości ostatnich 2 cyfr. Wywoływanie `get_senior_pesel` dla każdego wiersza zalałoby `audit_log` wpisami `READ_PESEL` przy każdym odświeżeniu listy — to anty-wzorzec audytowy.

Rozwiązanie: dodać jawną kolumnę `seniors.pesel_last2 text` (max 2 znaki), uzupełnianą atomowo przez `set_senior_pesel` razem z `pesel_encrypted`. Ostatnie 2 cyfry PESEL nie są daną wrażliwą w rozumieniu RODO (nie pozwalają na identyfikację), więc mogą być czytane przez normalny SELECT pod RLS — bez logowania.

Migracja:
- `ALTER TABLE seniors ADD COLUMN pesel_last2 text` (z `CHECK (pesel_last2 IS NULL OR pesel_last2 ~ '^\d{2}$')`)
- Aktualizacja `set_senior_pesel` — przy zapisie/czyszczeniu PESEL ustawia też `pesel_last2`
- Backfill istniejących rekordów (jeśli są — w tej chwili baza pusta, więc no-op)

## 2. Tabela `/seniorzy` — maska zamiast surowych danych

W kolumnie PESEL wyświetlać `•••••••••42` na podstawie `pesel_last2`, albo `—` gdy brak. Bez przycisku „Pokaż" w tabeli — pełny odczyt wymaga otwarcia kartoteki.

Przycisk „Otwórz" w wierszu → `Link to="/seniorzy/$id"` (zamiast obecnego `disabled`).

## 3. Nowa trasa `/seniorzy/$id` — kartoteka

Plik: `src/routes/_authenticated/_coordinator/seniorzy.$id.tsx`

Zawartość MVP:
- Nagłówek: imię + nazwisko + badge statusu + przycisk „Wróć do listy"
- Sekcja **Dane osobowe**: imię, nazwisko, telefon, telefon rodziny, **PESEL z przyciskiem „Pokaż PESEL"**
- Sekcja **Adres**: adres + lat/lng + link do Google Maps
- Sekcja **Decyzja MOPS**: numer/data/od/do
- Sekcja **Godziny i stawka**: min/max h, stawka
- Sekcja **Notatka techniczna**

Zakładkę „Historia wizyt" i pasek postępu godzin dodam w kolejnym kroku — najpierw sama kartoteka + reveal.

## 4. Przycisk „Pokaż PESEL" — auto-ukrywanie

Komponent `PeselReveal` — lokalny stan + `useQuery` wywoływane wyłącznie on-demand (`enabled: false`, `refetch()` po kliknięciu):

- Stan zamknięty: maska `•••••••••XX` + przycisk „Pokaż PESEL"
- Po kliknięciu: `supabase.rpc('get_senior_pesel', { _senior_id })` → pokazuje pełny PESEL + odlicznik „Ukryje się za 10s"
- **Auto-ukrycie po 10 sekundach** (`setTimeout` z czyszczeniem na unmount)
- **Auto-ukrycie przy odmontowaniu** (cleanup w `useEffect`) — wyjście z kartoteki = brak PESEL-a w pamięci komponentu
- Po ukryciu trzeba kliknąć ponownie — każdy odczyt loguje się w `audit_log` jako `READ_PESEL` przez RPC (bez zmian w SQL)
- Przycisk „Ukryj teraz" obok odliczania

Brak `clipboard.writeText`, brak zapisu do `localStorage`/`sessionStorage`, brak logów do konsoli.

## 5. Co NIE wchodzi w ten krok

- Edycja seniora (przyjdzie razem z historią wizyt)
- Pasek postępu godzin w danym miesiącu (wymaga modułu wizyt)
- Historia wizyt (osobna zakładka — czeka na moduł wizyt)

## Pliki

- `supabase/migrations/<timestamp>_pesel_last2.sql` — nowa kolumna + update funkcji `set_senior_pesel`
- `src/routes/_authenticated/_coordinator/seniorzy.tsx` — kolumna PESEL z maską, przycisk „Otwórz" jako `<Link>`
- `src/routes/_authenticated/_coordinator/seniorzy.$id.tsx` — nowa trasa, kartoteka, `PeselReveal`

Po wdrożeniu zatrzymam się — sprawdzisz w przeglądarce (dodanie seniora z PESEL → maska w tabeli → wejście w kartotekę → reveal → odliczanie → auto-ukrycie).
