import { NextResponse } from "next/server";
import {
    isDocumentPortalSubmitted,
    submitPayloadSchema,
    type LeadFileMetadata,
} from "@/lib/docflow";
import { getN8nWebhookUrlSubmitted, getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type LeadRecord = {
    id: string;
    contact_id: string | null;
    goal: string | null;
    document_upload_token: string;
    status: string;
    metadata: Record<string, unknown> | null;
};

type ContactRecord = {
    id: string;
    first_name: string | null;
    last_name: string | null;
    email: string | null;
};

type FileRecord = {
    id: string;
    category: string;
    document_type: string | null;
    storage_bucket: string | null;
    storage_path: string;
    metadata: LeadFileMetadata | Record<string, unknown> | null;
    created_at: string;
};

export async function POST(request: Request) {
    try {
        const parsedBody = submitPayloadSchema.parse(await request.json());
        const supabase = getSupabaseAdmin();

        const { data: lead, error: leadError } = await supabase
            .from("leads")
            .select("id, contact_id, goal, document_upload_token, status, metadata")
            .eq("document_upload_token", parsedBody.token)
            .single<LeadRecord>();

        if (leadError || !lead) {
            return NextResponse.json({ error: "Invalid upload token." }, { status: 404 });
        }

        if (isDocumentPortalSubmitted(lead.metadata)) {
            return NextResponse.json(
                { error: "This lead has already been submitted through the document portal." },
                { status: 409 }
            );
        }

        let resolvedName = "Valued Client";
        let resolvedEmail = "";

        if (lead.contact_id) {
            const { data: contact } = await supabase
                .from("contacts")
                .select("id, first_name, last_name, email")
                .eq("id", lead.contact_id)
                .maybeSingle<ContactRecord>();

            if (contact) {
                const builtName = `${contact.first_name ?? ""} ${contact.last_name ?? ""}`.trim();
                resolvedName = builtName || "Valued Client";
                resolvedEmail = contact.email ?? "";
            }
        }

        const { data: files, error: filesError } = await supabase
            .from("lead_files")
            .select("id, category, document_type, storage_bucket, storage_path, metadata, created_at")
            .eq("lead_id", lead.id)
            .order("created_at", { ascending: true })
            .returns<FileRecord[]>();

        if (filesError) {
            return NextResponse.json(
                { error: "Unable to load file metadata for submission." },
                { status: 500 }
            );
        }

        if (!files || files.length === 0) {
            return NextResponse.json(
                { error: "At least one uploaded file is required before submission." },
                { status: 400 }
            );
        }

        const existingMeta = lead.metadata && typeof lead.metadata === "object" ? { ...lead.metadata } : {};
        const existingDp =
            existingMeta.document_portal && typeof existingMeta.document_portal === "object"
                ? { ...(existingMeta.document_portal as Record<string, unknown>) }
                : {};

        const newMetadata: Record<string, unknown> = {
            ...existingMeta,
            document_portal: {
                ...existingDp,
                submitted_at: new Date().toISOString(),
                source: "docflow_portal",
            },
        };

        const leadUpdate: { metadata: Record<string, unknown>; status?: string } = {
            metadata: newMetadata,
        };

        if (lead.status === "awaiting_documents") {
            leadUpdate.status = "qualified";
        }

        const { error: updateError } = await supabase.from("leads").update(leadUpdate).eq("id", lead.id);

        if (updateError) {
            return NextResponse.json(
                { error: "Unable to update lead after submission." },
                { status: 500 }
            );
        }

        const webhookUrl = getN8nWebhookUrlSubmitted();

        const webhookPayload = {
            leadId: lead.id,
            applicationId: lead.id,
            contactId: lead.contact_id,
            token: lead.document_upload_token,
            name: resolvedName,
            email: resolvedEmail,
            applicationType: lead.goal ?? "Mortgage Application",
            files: files.map((file) => {
                const meta = file.metadata as LeadFileMetadata | null;
                return {
                    id: file.id,
                    category: file.category,
                    documentType: file.document_type,
                    storageBucket: file.storage_bucket,
                    storagePath: file.storage_path,
                    fileName: meta?.original_filename ?? null,
                    createdAt: file.created_at,
                };
            }),
        };

        const webhookResponse = await fetch(webhookUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(webhookPayload),
        });

        if (!webhookResponse.ok) {
            return NextResponse.json(
                { error: "Submission saved, but automation webhook failed." },
                { status: 502 }
            );
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid submit request." },
            { status: 400 }
        );
    }
}
