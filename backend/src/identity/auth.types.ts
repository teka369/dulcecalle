export type AuthedUser = { id: string; email: string };

export type BusinessContext = {
  userId: string;
  businessId: string;
  role: "owner" | "staff";
  timezone: string;
};

/** Read-only customer portal. Not a User / membership. */
export type CustomerAuth = {
  customerId: string;
  businessId: string;
};

/** Explicit read scope for the customer portal ledger (never a staff role). */
export type PortalLedgerScope = {
  kind: "portal";
  customerId: string;
  businessId: string;
  timezone: string;
};
