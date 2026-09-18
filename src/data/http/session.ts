/**
 * In-memory auth/tenancy for the HTTP adapter.
 * Not used by the Dexie PWA. Tokens never go in NEXT_PUBLIC_*.
 */
export class HttpSession {
  accessToken: string | null = null;
  refreshToken: string | null = null;
  businessId: string | null = null;
  userId: string | null = null;

  clear(): void {
    this.accessToken = null;
    this.refreshToken = null;
    this.businessId = null;
    this.userId = null;
  }

  selectBusiness(businessId: string): void {
    this.businessId = businessId;
  }
}
