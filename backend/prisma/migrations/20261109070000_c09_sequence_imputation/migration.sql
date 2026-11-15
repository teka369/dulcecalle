-- C09-PR3.1 (ADDITIVE ONLY): sequence kind for the saldo a favor imputation
-- receipt DC-I-NNNNNN (C09-QA-01, SPEC-C09 §2). `POST customers/:id/credit/apply`
-- has no parent operation, so its `allocation` receipt takes its own
-- per-business number. Only ADD VALUE: no UPDATE, DELETE, DROP or RENAME.
ALTER TYPE "SequenceKind" ADD VALUE IF NOT EXISTS 'imputation';
