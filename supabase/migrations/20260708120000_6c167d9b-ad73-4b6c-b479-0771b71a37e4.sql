-- Podział dokumentów seniora na kategorie: decyzje MOPS / umowy / RODO / medyczne / FV / inne

CREATE TYPE public.document_category AS ENUM (
  'decyzja_mops',
  'umowa',
  'rodo',
  'medyczne',
  'faktura',
  'inne'
);

ALTER TABLE public.senior_documents
  ADD COLUMN kategoria public.document_category NOT NULL DEFAULT 'inne';

CREATE INDEX senior_documents_kategoria_idx ON public.senior_documents (kategoria);
