import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PREP_VERSION, prepTaskDefs, requiredStaticDocuments } from "@/data/pwa/offline-prep";

describe("R2-B B1 + B4: CustomerLoginForm accessibility/form semantics and /mas/portal in PREP (PREP_VERSION = 11)", () => {
  it("B1: CustomerLoginForm uses <form onSubmit>, type='submit', role='alert', aria-invalid, and errorText", () => {
    const form = readFileSync("src/components/customer/CustomerLoginForm.tsx", "utf8");
    expect(form).toContain("<form");
    expect(form).toContain("onSubmit=");
    expect(form).toContain('type="submit"');
    expect(form).toContain('role="alert"');
    expect(form).toContain("aria-invalid={error ? true : undefined}");
    expect(form).toContain('id="customer-login-error"');
    expect(form).toContain("errorText(");
    expect(form).not.toContain("Nombre");
  });

  it("B4: /mas/portal is included in requiredStaticDocuments() and PREP_VERSION is 11", () => {
    expect(PREP_VERSION).toBe(11);
    expect(requiredStaticDocuments()).toContain("/mas/portal");
    expect(prepTaskDefs().map((d) => d.key)).toContain("doc:/mas/portal");
  });
});
