"use client";

import { useEffect, useState } from "react";
import { formatCop } from "@/domain/money";
import type { Customer } from "@/domain/types";
import { customerRepository } from "@/repositories";

export default function ClientesPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);

  useEffect(() => {
    void customerRepository.list().then(setCustomers);
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-[22px] font-semibold">Clientes</h1>
      {customers.length === 0 ? (
        <p className="text-sm text-ink/60">No hay clientes aún.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {customers.map((c) => (
            <li
              key={c.id}
              className="rounded-2xl border border-ink/[0.08] bg-white p-4"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium">{c.name}</span>
                <span
                  className={`text-sm font-semibold ${c.debt > 0 ? "text-accent" : "text-ink/50"}`}
                >
                  {formatCop(c.debt)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
