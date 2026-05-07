import { z } from "zod";

export const DOC_CATEGORIES = [
  "id",
  "payslips",
  "bank_statements",
  "tax_returns",
  "employment_docs",
  "other",
] as const;

export const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024;
export const MAX_FILES_PER_REQUEST = 10;

export const uploadTokenSchema = z
  .string()
  .trim()
  .min(6)
  .max(128)
  .regex(/^[a-zA-Z0-9_-]+$/);

export const uploadCategorySchema = z.enum(DOC_CATEGORIES);

/** Maps portal picker values → `lead_files.category` / `lead_files.document_type` (your CRM enums). */
export const PORTAL_CATEGORY_TO_LEAD_FILE: Record<
  (typeof DOC_CATEGORIES)[number],
  { category: string; document_type: string }
> = {
  id: { category: "identity", document_type: "identity_document" },
  payslips: { category: "income", document_type: "payslip" },
  bank_statements: { category: "banking", document_type: "bank_statement" },
  tax_returns: { category: "income", document_type: "tax_return" },
  employment_docs: { category: "income", document_type: "employment_record" },
  other: { category: "other", document_type: "unspecified" },
};

export type LeadFileMetadata = {
  original_filename: string;
  portal_category: (typeof DOC_CATEGORIES)[number];
  mime_type: string;
  uploaded_via: "docflow_portal";
};

/** One scrollable “question” per section — labels are user-facing copy for the portal. */
export const PORTAL_SECTIONS: Array<{
  key: (typeof DOC_CATEGORIES)[number];
  title: string;
  description: string;
}> = [
  {
    key: "id",
    title: "Proof of identity",
    description: "Government-issued ID (e.g. passport or driving licence). Clear photos or scans are fine.",
  },
  {
    key: "payslips",
    title: "Payslips",
    description: "Recent payslips showing your income. Usually the last 3 months.",
  },
  {
    key: "bank_statements",
    title: "Bank statements",
    description: "Statements for the accounts you use for income and outgoings.",
  },
  {
    key: "tax_returns",
    title: "Tax returns",
    description: "SA302s or tax returns if you’re self-employed or have additional income.",
  },
  {
    key: "employment_docs",
    title: "Employment documents",
    description: "Contract, employer letter, or other proof of employment if relevant.",
  },
  {
    key: "other",
    title: "Anything else",
    description: "Other documents your broker asked for. Add a short note in the filename if helpful.",
  },
];

export const deleteFilePayloadSchema = z.object({
  token: uploadTokenSchema,
  fileId: z.string().trim().min(1).max(128),
});

export const submitPayloadSchema = z.object({
  token: uploadTokenSchema,
});

/** Serializable row for hydrating the portal from `lead_files` (passed server → client). */
export type ExistingPortalFile = {
  id: string;
  portalCategory: (typeof DOC_CATEGORIES)[number];
  fileName: string;
  filePath: string;
  crmCategory: string;
  createdAt: string;
};

export function isDocumentPortalSubmitted(
  metadata: Record<string, unknown> | null | undefined
): boolean {
  if (!metadata || typeof metadata !== "object") return false;
  const dp = metadata.document_portal;
  if (!dp || typeof dp !== "object") return false;
  return Boolean((dp as { submitted_at?: string }).submitted_at);
}

/** Removes `document_portal.submitted_at` so the prospect can upload/edit again. */
export function clearDocumentPortalSubmission(
  metadata: Record<string, unknown> | null | undefined
): Record<string, unknown> {
  const base =
    metadata && typeof metadata === "object" ? { ...metadata } : {};
  const dp =
    base.document_portal && typeof base.document_portal === "object"
      ? { ...(base.document_portal as Record<string, unknown>) }
      : {};
  delete dp.submitted_at;
  if (Object.keys(dp).length === 0) {
    const rest = { ...base };
    delete rest.document_portal;
    return rest;
  }
  return { ...base, document_portal: dp };
}

export function parsePortalCategoryFromMetadata(
  metadata: unknown
): (typeof DOC_CATEGORIES)[number] | null {
  if (!metadata || typeof metadata !== "object") return null;
  const raw = (metadata as Record<string, unknown>).portal_category;
  const parsed = uploadCategorySchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function inferPortalCategoryFromLeadFileRow(row: {
  category: string;
  document_type: string | null;
}): (typeof DOC_CATEGORIES)[number] {
  const docType = row.document_type ?? "";
  for (const key of DOC_CATEGORIES) {
    const m = PORTAL_CATEGORY_TO_LEAD_FILE[key];
    if (m.category === row.category && m.document_type === docType) {
      return key;
    }
  }
  for (const key of DOC_CATEGORIES) {
    if (PORTAL_CATEGORY_TO_LEAD_FILE[key].category === row.category) {
      return key;
    }
  }
  return "other";
}

export function existingFileFromLeadFileRow(row: {
  id: string;
  category: string;
  document_type: string | null;
  storage_path: string;
  metadata: unknown;
  created_at: string;
}): ExistingPortalFile {
  const portalCategory =
    parsePortalCategoryFromMetadata(row.metadata) ??
    inferPortalCategoryFromLeadFileRow({
      category: row.category,
      document_type: row.document_type,
    });

  const meta = row.metadata as Partial<LeadFileMetadata> | null;
  const pathTail = row.storage_path.split("/").pop() ?? "document";
  const fileName = meta?.original_filename ?? pathTail;

  return {
    id: row.id,
    portalCategory,
    fileName,
    filePath: row.storage_path,
    crmCategory: row.category,
    createdAt: row.created_at,
  };
}

const ALLOWED_FILE_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

export function sanitizeFileName(fileName: string): string {
  return fileName
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/\.{2,}/g, ".")
    .slice(0, 120);
}

export function assertValidIncomingFiles(files: FormDataEntryValue[]): File[] {
  if (files.length < 1 || files.length > MAX_FILES_PER_REQUEST) {
    throw new Error("Invalid number of files");
  }

  const parsedFiles: File[] = [];

  for (const entry of files) {
    if (!(entry instanceof File)) {
      throw new Error("Invalid file payload");
    }

    if (!ALLOWED_FILE_TYPES.has(entry.type)) {
      throw new Error(`Unsupported file type: ${entry.type}`);
    }

    if (entry.size <= 0 || entry.size > MAX_FILE_SIZE_BYTES) {
      throw new Error(`Invalid file size: ${entry.name}`);
    }

    parsedFiles.push(entry);
  }

  return parsedFiles;
}
