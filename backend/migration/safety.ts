const TEST_HOST = /(127\.0\.0\.1|localhost|\[::1\])/i;
const PROD_HINT =
  /(neon\.tech|supabase|amazonaws|rds\.|azure|railway\.app|render\.com|prisma\.io|prod)/i;

export function assertTestImportEnv(url: string | undefined): void {
  if (process.env.MIGRATION_ENV !== "TEST") {
    throw new Error("Import refused: MIGRATION_ENV must be TEST (dry-run only).");
  }
  if (!url) throw new Error("Import refused: DATABASE_URL missing.");
  if (PROD_HINT.test(url) || !TEST_HOST.test(url)) {
    throw new Error("Import refused: DATABASE_URL is not a local TEST database.");
  }
}
