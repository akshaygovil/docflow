import { notFound } from "next/navigation";
import {
    existingFileFromLeadFileRow,
    isDocumentPortalSubmitted,
    uploadTokenSchema,
} from "@/lib/docflow";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import UploadPortalClient from "./upload-portal-client";

type UploadPageProps = {
    params: Promise<{
        token: string;
    }>;
};

type LeadRecord = {
    id: string;
    contact_id: string | null;
    goal: string | null;
    document_upload_token: string;
    metadata: Record<string, unknown> | null;
};

type ContactRecord = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
};

type LeadFileRow = {
    id: string;
    category: string;
    document_type: string | null;
    storage_path: string;
    metadata: unknown;
    created_at: string;
};

export default async function UploadPage({ params }: UploadPageProps) {
    const { token } = await params;
    const validatedToken = uploadTokenSchema.safeParse(token);

    if (!validatedToken.success) {
        notFound();
    }

    const supabase = getSupabaseAdmin();

    const { data: lead, error: leadError } = await supabase
        .from("leads")
        .select("id, contact_id, goal, document_upload_token, metadata")
        .eq("document_upload_token", validatedToken.data)
        .single<LeadRecord>();

    if (leadError || !lead) {
        notFound();
    }

    const { data: fileRows } = await supabase
        .from("lead_files")
        .select("id, category, document_type, storage_path, metadata, created_at")
        .eq("lead_id", lead.id)
        .order("created_at", { ascending: true })
        .returns<LeadFileRow[]>();

    const initialFiles = (fileRows ?? [])
        .filter((row) => {
            const m = row.metadata as { uploaded_via?: string } | null | undefined;
            if (m == null) return true;
            return m.uploaded_via === "docflow_portal";
        })
        .map((row) => existingFileFromLeadFileRow(row));
    const portalSubmitted = isDocumentPortalSubmitted(lead.metadata);

    let fullName = "Valued Client";
    let email = "";

    if (lead.contact_id) {
        const { data: contact } = await supabase
            .from("contacts")
            .select("id, first_name, last_name, email")
            .eq("id", lead.contact_id)
            .maybeSingle<ContactRecord>();

        if (contact) {
            const name = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
            fullName = name || "Valued Client";
            email = contact.email ?? "";
        }
    }

    return (
        <UploadPortalClient
            application={{
                id: lead.id,
                token: lead.document_upload_token,
                fullName,
                email,
                applicationType: lead.goal ?? "Mortgage Application",
            }}
            initialFiles={initialFiles}
            portalSubmittedInitially={portalSubmitted}
        />
    );
}
