import { StateBlock } from "./StateBlock";

/** B3: list read failed with nothing local to show. Never an empty state. */
export function ListErrorState({ message, online, onRetry }: { message: string | null; online: boolean; onRetry: () => void }) {
  return (
    <StateBlock
      kind={online ? "error" : "offline-miss"}
      title={online ? "No se pudo cargar." : "Sin conexión."}
      body={online ? (message && message !== "Sin conexión." ? message : "El servidor no respondió. Tus datos no se han perdido.") : "No hay datos guardados en este teléfono todavía."}
      action={
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center justify-center rounded-[var(--r-md)] bg-cta px-4 text-sm font-semibold text-cta-fg"
        >
          Reintentar
        </button>
      }
    />
  );
}
