"use client";

import { useMemo, useState } from "react";
import { GlyphIcon, Chevron } from "@/components/ui/icons";

export type PickerCustomer = { id: string; name: string };

/**
 * Customer selector for Cobrar: a row that opens a searchable bottom sheet.
 * Only id/name (+ pending ids, which stay disabled until synced).
 */
export function CustomerPicker({
  customers,
  customerId,
  pendingIds,
  onChange,
}: {
  customers: ReadonlyArray<PickerCustomer>;
  customerId: string | null;
  pendingIds: ReadonlyArray<string>;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const pending = useMemo(() => new Set(pendingIds), [pendingIds]);
  const selected = customers.find((c) => c.id === customerId) ?? null;
  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? customers.filter((c) => c.name.toLowerCase().includes(q)) : customers;
  }, [customers, query]);

  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted" id="cliente-label">
        Cliente
      </p>
      <button
        type="button"
        aria-labelledby="cliente-label"
        aria-haspopup="dialog"
        onClick={() => setOpen(true)}
        className="mt-2 flex min-h-14 w-full items-center gap-3 rounded-[var(--r-lg)] border border-border bg-surface px-3 text-left"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-ink" aria-hidden>
          <GlyphIcon name="users" />
        </span>
        <span className={`min-w-0 flex-1 truncate text-[15px] font-medium ${selected ? "text-ink" : "text-ink-muted"}`}>
          {selected ? selected.name : "Selecciona cliente"}
        </span>
        <Chevron />
      </button>
      {pendingIds.length > 0 && (
        <p className="mt-2 text-xs text-ink-muted">
          Los clientes marcados se están sincronizando y estarán disponibles en cuanto terminen.
        </p>
      )}

      {open && (
        <div className="fixed inset-0 z-[80] flex items-end justify-center">
          <button
            type="button"
            aria-label="Cerrar"
            className="absolute inset-0 bg-ink/40"
            onClick={() => setOpen(false)}
          />
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Selecciona cliente"
            className="relative flex max-h-[80dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-[28px] bg-bg pb-[max(0.75rem,env(safe-area-inset-bottom))]"
          >
            <div className="bg-hero px-4 pb-4 pt-4 text-on-hero">
              <p className="text-base font-semibold">Selecciona cliente</p>
              <label className="sr-only" htmlFor="cliente-buscar">
                Buscar cliente...
              </label>
              <input
                id="cliente-buscar"
                type="search"
                autoFocus
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar cliente..."
                className="mt-3 h-11 w-full rounded-[var(--r-pill)] bg-surface px-4 text-base text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-on-hero"
              />
            </div>
            <ul className="min-h-0 flex-1 divide-y divide-border overflow-y-auto">
              {list.map((c) => {
                const isPending = pending.has(c.id);
                const isSel = c.id === customerId;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      disabled={isPending}
                      aria-pressed={isSel}
                      onClick={() => {
                        onChange(c.id);
                        setOpen(false);
                      }}
                      className="flex min-h-14 w-full items-center justify-between gap-3 px-4 text-left disabled:opacity-50"
                    >
                      <span className="min-w-0 truncate text-[15px] font-medium text-ink">
                        {c.name}
                        {isPending ? <span className="ml-1 text-ink-muted">(sincronizando…)</span> : null}
                      </span>
                      {isSel ? <GlyphIcon name="check" /> : null}
                    </button>
                  </li>
                );
              })}
              {list.length === 0 && (
                <li className="px-4 py-4 text-sm text-ink-muted">No encontramos ese cliente.</li>
              )}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
