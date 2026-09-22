"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { RemoteProductImage } from "@/data/http/mappers";
import { getPwaAuthSession } from "@/data/http/session";
import { getPwaApi } from "@/data/pwa/api";
import {
  addProductImages,
  discardPendingMedia,
  listPendingMedia,
  queueImageRemove,
  reorderProductImages,
  setPrimaryImage,
  type UploadProgress,
} from "@/data/pwa/product-images";
import { NetworkError } from "@/data/errors";
import type { LocalPendingMedia } from "@/data/local/types";
import {
  MAX_IMAGES_PER_PRODUCT,
  imageErrorMessage,
  validateImageFile,
} from "@/data/media/validate";
import { sortImages } from "@/data/media/urls";
import { ProductImageView } from "./ProductImageView";

type Props = {
  productId: string;
  images: RemoteProductImage[];
  onChanged: () => void;
};

type NewFile = {
  key: string;
  file: File;
  preview: string;
  status: "ready" | "uploading" | "failed" | "queued";
  progress: number;
  error: string | null;
};

let fileKey = 0;

export function ProductImageManager({ productId, images, onChanged }: Props) {
  const [files, setFiles] = useState<NewFile[]>([]);
  const [pending, setPending] = useState<LocalPendingMedia[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const businessId = getPwaAuthSession().businessId;

  const reloadPending = useCallback(async () => {
    if (!businessId) return;
    try {
      setPending(await listPendingMedia(businessId, productId));
    } catch {
      /* best-effort */
    }
  }, [businessId, productId]);

  useEffect(() => {
    void reloadPending();
    return () => {
      setFiles((current) => {
        for (const f of current) URL.revokeObjectURL(f.preview);
        return current;
      });
    };
  }, [reloadPending]);

  const ordered = sortImages(images ?? []);
  const remaining =
    MAX_IMAGES_PER_PRODUCT - ordered.length - pending.length - files.length;

  function pickFiles(list: FileList | File[]) {
    const picked = Array.from(list);
    setFiles((current) => {
      const room = Math.max(
        0,
        MAX_IMAGES_PER_PRODUCT - ordered.length - pending.length - current.length,
      );
      const next = [...current];
      for (const file of picked.slice(0, room)) {
        const check = validateImageFile(file);
        fileKey += 1;
        next.push({
          key: `new-${fileKey}`,
          file,
          preview: URL.createObjectURL(file),
          status: check.ok ? "ready" : "failed",
          progress: 0,
          error: check.ok ? null : imageErrorMessage(check.error),
        });
      }
      if (picked.length > room) {
        setError(`Un producto acepta máximo ${MAX_IMAGES_PER_PRODUCT} fotos.`);
      }
      return next;
    });
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadAll() {
    if (busy) return;
    const ready = files.filter((f) => f.status === "ready");
    if (ready.length === 0) return;
    setBusy(true);
    setError(null);
    setFiles((current) =>
      current.map((f) => (f.status === "ready" ? { ...f, status: "uploading" as const } : f)),
    );
    try {
      const result = await addProductImages(
        productId,
        ready.map((f) => f.file),
        {
          onFileProgress: (name, p: UploadProgress) => {
            const ratio = p.total > 0 ? p.loaded / p.total : 0;
            setFiles((current) =>
              current.map((f) =>
                f.file.name === name && f.status === "uploading"
                  ? { ...f, progress: ratio }
                  : f,
              ),
            );
          },
        },
      );
      if (result.mode === "offline") {
        // Blobs live in pendingMedia now; drop the local previews.
        const names = new Set(ready.map((f) => f.file.name));
        setFiles((current) => current.filter((f) => !names.has(f.file.name)));
      } else if (result.failed.length > 0) {
        setFiles((current) =>
          current
            .filter((f) => result.failed.some((x) => x.name === f.file.name))
            .map((f) => {
              const failed = result.failed.find((x) => x.name === f.file.name);
              return { ...f, status: "failed" as const, error: failed?.error ?? null };
            }),
        );
        setError(
          `${result.uploaded.length} de ${ready.length} fotos cargadas. Reintenta las fallidas.`,
        );
      } else {
        setFiles((current) => current.filter((f) => f.status !== "uploading"));
      }
      await reloadPending();
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudieron subir las fotos.");
      setFiles((current) =>
        current.map((f) =>
          f.status === "uploading" ? { ...f, status: "ready" as const, progress: 0 } : f,
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  async function removeRemote(imageId: string) {
    setError(null);
    try {
      await getPwaApi().products.removeImage(productId, imageId);
      setConfirmDelete(null);
      onChanged();
    } catch (e) {
      if (!(e instanceof NetworkError)) {
        setError(e instanceof Error ? e.message : "No se pudo eliminar.");
        return;
      }
      try {
        await queueImageRemove(productId, imageId);
        setConfirmDelete(null);
        onChanged();
      } catch (queueError) {
        setError(
          queueError instanceof Error ? queueError.message : "No se pudo eliminar.",
        );
      }
    }
  }

  async function makePrimary(imageId: string) {
    setError(null);
    try {
      await setPrimaryImage(productId, imageId);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo actualizar.");
    }
  }

  async function move(imageId: string, direction: -1 | 1) {
    const ids = ordered.map((img) => img.id);
    const at = ids.indexOf(imageId);
    const to = at + direction;
    if (at < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    const [moved] = next.splice(at, 1);
    if (moved) next.splice(to, 0, moved);
    setError(null);
    try {
      await reorderProductImages(productId, next);
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo reordenar.");
    }
  }

  async function discardPending(id: string) {
    if (!businessId) return;
    await discardPendingMedia(businessId, id);
    await reloadPending();
    onChanged();
  }

  return (
    <section aria-label="Fotos del producto" className="flex flex-col gap-3">
      <h2 className="text-sm font-semibold text-ink/60">Fotos</h2>

      {ordered.length === 0 && pending.length === 0 && files.length === 0 && (
        <p className="text-sm text-ink/60">Sin fotos todavía.</p>
      )}

      <ul className="grid grid-cols-3 gap-2">
        {ordered.map((img, index) => (
          <li key={img.id} className="flex flex-col gap-1">
            <ProductImageView
              secureUrl={img.secureUrl}
              alt={img.altText || `Foto ${index + 1}`}
              variant="thumb"
              className="aspect-square w-full"
            />
            <div className="flex items-center gap-1">
              {img.isPrimary ? (
                <span className="rounded-full bg-cta px-2 py-0.5 text-[11px] font-semibold text-white">
                  Portada
                </span>
              ) : (
                <button
                  type="button"
                  onClick={() => void makePrimary(img.id)}
                  className="rounded-full border border-ink/10 px-2 py-0.5 text-[11px] font-semibold"
                  aria-label={`Usar como portada la foto ${index + 1}`}
                >
                  Portada
                </button>
              )}
              <button
                type="button"
                onClick={() => void move(img.id, -1)}
                disabled={index === 0}
                className="min-h-11 min-w-11 rounded-[14px] border border-ink/10 disabled:opacity-40"
                aria-label="Mover a la izquierda"
              >
                ←
              </button>
              <button
                type="button"
                onClick={() => void move(img.id, 1)}
                disabled={index === ordered.length - 1}
                className="min-h-11 min-w-11 rounded-[14px] border border-ink/10 disabled:opacity-40"
                aria-label="Mover a la derecha"
              >
                →
              </button>
              {confirmDelete === img.id ? (
                <button
                  type="button"
                  onClick={() => void removeRemote(img.id)}
                  className="min-h-11 rounded-[14px] bg-danger px-3 text-xs font-semibold text-white"
                >
                  Confirmar
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmDelete(img.id)}
                  className="min-h-11 min-w-11 rounded-[14px] border border-ink/10 text-danger"
                  aria-label={`Eliminar foto ${index + 1}`}
                >
                  ×
                </button>
              )}
            </div>
          </li>
        ))}

        {pending.map((row) => (
          <li key={row.id} className="flex flex-col gap-1">
            <div className="flex aspect-square w-full items-center justify-center rounded-2xl border border-dashed border-ink/20 bg-ink/[0.04] px-2 text-center">
              <p className="text-xs text-ink/60">
                ⏳ {row.fileName}
                <br />
                Se subirá al sincronizar
              </p>
            </div>
            <button
              type="button"
              onClick={() => void discardPending(row.id)}
              className="min-h-11 rounded-[14px] border border-ink/10 text-xs font-semibold text-danger"
            >
              Descartar
            </button>
          </li>
        ))}

        {files.map((f) => (
          <li key={f.key} className="flex flex-col gap-1">
            <div className="relative aspect-square w-full overflow-hidden rounded-2xl border border-ink/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={f.preview} alt="" className="h-full w-full object-cover" />
              {f.status === "uploading" && (
                <div className="absolute inset-x-0 bottom-0 h-1.5 bg-ink/10">
                  <div
                    className="h-full bg-cta transition-all"
                    style={{ width: `${Math.round(f.progress * 100)}%` }}
                  />
                </div>
              )}
            </div>
            {f.status === "failed" ? (
              <div className="flex flex-col gap-1">
                <p className="text-xs text-danger">{f.error ?? "No se pudo subir."}</p>
                <button
                  type="button"
                  onClick={() =>
                    setFiles((current) =>
                      current.map((x) =>
                        x.key === f.key
                          ? { ...x, status: "ready" as const, error: null, progress: 0 }
                          : x,
                      ),
                    )
                  }
                  className="min-h-11 rounded-[14px] border border-ink/10 text-xs font-semibold"
                >
                  Reintentar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() =>
                  setFiles((current) => current.filter((x) => x.key !== f.key))
                }
                className="min-h-11 rounded-[14px] border border-ink/10 text-xs font-semibold"
              >
                Quitar
              </button>
            )}
          </li>
        ))}
      </ul>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragOver(false);
          if (e.dataTransfer.files.length > 0) pickFiles(e.dataTransfer.files);
        }}
        className={`rounded-2xl border border-dashed p-4 text-center ${
          dragOver ? "border-cta bg-cta/5" : "border-ink/20"
        }`}
      >
        <input
          ref={inputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          aria-label="Seleccionar fotos del producto"
          onChange={(e) => {
            if (e.target.files) pickFiles(e.target.files);
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={remaining <= 0}
          className="min-h-11 w-full rounded-[14px] border border-ink/10 bg-surface text-sm font-semibold disabled:opacity-40"
        >
          Agregar fotos ({Math.max(0, remaining)} libres)
        </button>
        <p className="mt-1 text-xs text-ink/55">JPG, PNG o WebP · máx 5 MB c/u</p>
      </div>

      {files.some((f) => f.status === "ready") && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void uploadAll()}
          className="min-h-11 w-full rounded-[14px] bg-cta text-sm font-semibold text-white disabled:opacity-40"
        >
          Subir fotos
        </button>
      )}

      {error && <p className="text-sm text-danger">{error}</p>}
    </section>
  );
}
