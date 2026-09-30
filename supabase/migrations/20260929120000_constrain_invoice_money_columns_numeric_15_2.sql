-- Retro [X6] — Constrain invoice & credit-note MONEY columns to numeric(15,2).
--
-- The money columns were declared as unconstrained `numeric` (arbitrary precision/scale).
-- The canonical TS money math (src/lib/invoicing/tax.ts) always rounds to cents, and the
-- issuance gate (assertIssuable) reconciles the stored figures against a fresh computation
-- with a STRICT equality. That strict compare is brittle to the unbounded scale: any value
-- written by a path other than the canonical one (a future migration, a manual fix) could
-- carry >2 decimals and then fail issuance with `totalsMismatch`. Pinning the scale to
-- (15,2) — matching invoice_payments.amount, which was already numeric(15,2) — makes the
-- stored scale match the computation and removes that footgun.
--
-- Scope: only the true MONEY columns (subtotal, tax_total, total, unit_price, line amount,
-- tax base, tax amount). `quantity` (a count that may legitimately be fractional) and
-- `rate` (a tax rate such as 0.13) are intentionally left as unconstrained `numeric`.
--
-- Safe/idempotent: every existing value is already cent-rounded by the canonical helper, so
-- the type tightening cannot lose data. ALTER COLUMN TYPE is DDL (it does not fire the
-- row-level immutability triggers on issued invoices/credit notes). 15 integer digits ahead
-- of the decimal comfortably exceed any realistic invoice total.

-- Invoices parent totals.
alter table public.invoices
  alter column subtotal  type numeric(15, 2),
  alter column tax_total type numeric(15, 2),
  alter column total     type numeric(15, 2);

-- Invoice line items.
alter table public.invoice_line_items
  alter column unit_price type numeric(15, 2),
  alter column amount     type numeric(15, 2);

-- Invoice tax lines.
alter table public.invoice_tax_lines
  alter column base       type numeric(15, 2),
  alter column tax_amount type numeric(15, 2);

-- Credit-note parent totals.
alter table public.credit_notes
  alter column subtotal  type numeric(15, 2),
  alter column tax_total type numeric(15, 2),
  alter column total     type numeric(15, 2);

-- Credit-note line items.
alter table public.credit_note_line_items
  alter column unit_price type numeric(15, 2),
  alter column amount     type numeric(15, 2);

-- Credit-note tax lines.
alter table public.credit_note_tax_lines
  alter column base       type numeric(15, 2),
  alter column tax_amount type numeric(15, 2);
