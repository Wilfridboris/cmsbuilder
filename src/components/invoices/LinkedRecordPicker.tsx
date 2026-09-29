"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  searchRelationRecords,
  RecordApiError,
  type RelationRecordLabel,
} from "@/lib/data/records-client";

/**
 * LinkedRecordPicker (Story 12.2) — an accessible dialog that links ANY tenant
 * record to an invoice draft as its customer. The Admin picks a table from the
 * org's schema (passed as client-safe `{ key, label }` from the server page), then
 * typeahead-searches that table's records by their display label via the existing
 * `/api/records/search` endpoint (Story 3.7), and selects one.
 *
 * Schema-agnostic (FR82): it never assumes a "customers" table or any semantic
 * field. It emits `{ id, label }` for the chosen record; line items are always
 * left empty for the Admin to add (no field mapping, no seeding from record data).
 *
 * The dialog body is a SEPARATE component (`PickerBody`) rendered only while open,
 * so its search state initializes fresh on each open (no reset-in-effect) and is
 * torn down on close. Built to the a11y baseline: labelled dialog + inputs and
 * keyboard-operable results.
 */

type OrgTable = { key: string; label: string };

export function LinkedRecordPicker({
  slug,
  tables,
  open,
  onOpenChange,
  onSelect,
}: {
  slug: string;
  tables: OrgTable[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (record: { id: string; label: string }) => void;
}) {
  const t = useTranslations("Invoices");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent closeLabel={t("pickerCancel")} className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{t("pickerTitle")}</DialogTitle>
          <DialogDescription>{t("customerSubtitle")}</DialogDescription>
        </DialogHeader>

        {open ? (
          <PickerBody
            slug={slug}
            tables={tables}
            onCancel={() => onOpenChange(false)}
            onSelect={(record) => {
              onSelect(record);
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The search body — mounted only while the dialog is open, so its state starts
 * clean each time (no reset-in-effect). All setState happens inside the debounced
 * timeout callback (async), never synchronously in the effect body.
 */
function PickerBody({
  slug,
  tables,
  onCancel,
  onSelect,
}: {
  slug: string;
  tables: OrgTable[];
  onCancel: () => void;
  onSelect: (record: { id: string; label: string }) => void;
}) {
  const t = useTranslations("Invoices");

  const [tableKey, setTableKey] = useState<string>(
    tables.length === 1 ? tables[0].key : "",
  );
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<RelationRecordLabel[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tableSelectId = useId();
  const searchId = useId();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounced search whenever the chosen table or query changes. No synchronous
  // setState in the body — the spinner + results are set inside the timeout.
  useEffect(() => {
    if (tableKey === "") {
      return;
    }
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      setError(null);
      try {
        const found = await searchRelationRecords(slug, tableKey, query);
        setResults(found);
      } catch (err) {
        const code = err instanceof RecordApiError ? err.code : "genericError";
        setError(t(`error.${errorKey(code)}`));
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 250);
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [tableKey, query, slug, t]);

  if (tables.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("pickerNoTables")}</p>;
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-2">
        <Label htmlFor={tableSelectId}>{t("pickerTableLabel")}</Label>
        <Select
          value={tableKey === "" ? undefined : tableKey}
          onValueChange={(v) => {
            setTableKey(v);
            setResults([]);
          }}
        >
          <SelectTrigger id={tableSelectId} className="min-h-12 w-full">
            <SelectValue placeholder={t("pickerTablePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            {tables.map((table) => (
              <SelectItem key={table.key} value={table.key}>
                {table.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor={searchId}>{t("pickerSearchLabel")}</Label>
        <div className="relative">
          <Search
            aria-hidden="true"
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <Input
            id={searchId}
            value={query}
            disabled={tableKey === ""}
            placeholder={t("pickerSearchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            className="min-h-12 pl-9"
          />
        </div>
      </div>

      <div
        className="max-h-64 overflow-y-auto rounded-md border border-border"
        role="listbox"
        aria-label={t("pickerSearchLabel")}
        aria-busy={searching}
      >
        {searching ? (
          <p className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            {t("pickerSearching")}
          </p>
        ) : error ? (
          <p role="alert" className="p-3 text-sm text-destructive">
            {error}
          </p>
        ) : tableKey === "" ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("pickerTablePlaceholder")}
          </p>
        ) : results.length === 0 ? (
          <p className="p-3 text-sm text-muted-foreground">
            {t("pickerNoResults")}
          </p>
        ) : (
          <ul className="flex flex-col">
            {results.map((record) => (
              <li key={record.id}>
                <button
                  type="button"
                  role="option"
                  aria-selected="false"
                  onClick={() => onSelect({ id: record.id, label: record.label })}
                  className="flex min-h-12 w-full items-center px-3 py-2 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none"
                >
                  {record.label}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          onClick={onCancel}
        >
          {t("pickerCancel")}
        </Button>
      </div>
    </div>
  );
}

/** Map a records-client error code to a key present in the Invoices.error catalog. */
function errorKey(code: string): string {
  const known = new Set([
    "forbidden",
    "unauthorized",
    "loadFailed",
    "genericError",
  ]);
  return known.has(code) ? code : "genericError";
}
