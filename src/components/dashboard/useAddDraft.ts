import { useState } from "react";

import type { FieldDefinition } from "@/types/db";
import { blankDraftForFields, type Draft } from "@/lib/forms/field-input";

/**
 * The single lifted add-record draft shared by the inline adder and the modal
 * (Story 3.2) — so switching between them preserves what the user typed.
 *
 * Extracted from `RecordsView`. `reset()` clears the draft and closes the modal;
 * it runs after a successful add and, via the render-time "adjust state on prop
 * change" pattern, whenever the active table changes (fields always match the
 * current schema without a cascading render). `formResetKey` bumps on every reset
 * and is used as the `AddRecordForm` `key`, so its per-field validation error
 * state remounts fresh — otherwise a stale "invalid" alert can linger.
 */
export function useAddDraft(tableKey: string, visibleFields: FieldDefinition[]) {
  const [draft, setDraft] = useState<Draft>(() =>
    blankDraftForFields(visibleFields),
  );
  const [modalOpen, setModalOpen] = useState(false);
  const [formResetKey, setFormResetKey] = useState(0);

  const reset = () => {
    setDraft(blankDraftForFields(visibleFields));
    setModalOpen(false);
    setFormResetKey((k) => k + 1);
  };

  const [seenTableKey, setSeenTableKey] = useState(tableKey);
  if (seenTableKey !== tableKey) {
    setSeenTableKey(tableKey);
    reset();
  }

  return { draft, setDraft, modalOpen, setModalOpen, formResetKey, reset };
}
