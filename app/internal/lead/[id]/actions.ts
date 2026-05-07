"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import {
  clearDocumentPortalSubmission,
  isDocumentPortalSubmitted,
} from "@/lib/docflow";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const uuidSchema = z.string().uuid();

export type UnsubmitState = { ok?: boolean; error?: string };

export async function unsubmitLeadAction(
  leadId: string,
  prev: UnsubmitState | null,
  formData: FormData
): Promise<UnsubmitState> {
  void prev;
  void formData;
  const parsed = uuidSchema.safeParse(leadId);
  if (!parsed.success) {
    return { error: "Invalid lead id." };
  }

  const supabase = getSupabaseAdmin();
  const { data: lead, error } = await supabase
    .from("leads")
    .select("id, status, metadata")
    .eq("id", leadId)
    .maybeSingle<{ id: string; status: string; metadata: Record<string, unknown> | null }>();

  if (error || !lead) {
    return { error: "Lead not found." };
  }

  if (!isDocumentPortalSubmitted(lead.metadata)) {
    return {
      error:
        "This lead is not marked as submitted in the document portal — nothing to reopen.",
    };
  }

  const newMetadata = clearDocumentPortalSubmission(lead.metadata);
  const terminal = new Set(["won", "lost"]);
  const updates: { metadata: Record<string, unknown>; status?: string } = {
    metadata: newMetadata,
  };
  if (!terminal.has(lead.status)) {
    updates.status = "awaiting_documents";
  }

  const { error: updateError } = await supabase
    .from("leads")
    .update(updates)
    .eq("id", leadId);

  if (updateError) {
    return { error: "Could not update lead." };
  }

  revalidatePath(`/internal/lead/${leadId}`);
  return { ok: true };
}
