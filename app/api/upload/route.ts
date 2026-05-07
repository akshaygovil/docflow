import { NextResponse } from "next/server";
import {
    assertValidIncomingFiles,
    deleteFilePayloadSchema,
    isDocumentPortalSubmitted,
    PORTAL_CATEGORY_TO_LEAD_FILE,
    sanitizeFileName,
    uploadCategorySchema,
    uploadTokenSchema,
    type LeadFileMetadata,
} from "@/lib/docflow";
import { getPrivateBucketName, getSupabaseAdmin, getN8nWebhookUrlUploaded } from "@/lib/supabase-admin";

export const runtime = "nodejs";

type LeadForUpload = {
    id: string;
    contact_id: string | null;
    status: string;
    metadata: Record<string, unknown> | null;
};

export async function POST(request: Request) {
    try {
        const formData = await request.formData();
        const token = uploadTokenSchema.parse(formData.get("token"));
        const portalCategory = uploadCategorySchema.parse(formData.get("category"));
        const files = assertValidIncomingFiles(formData.getAll("files"));

        const supabase = getSupabaseAdmin();
        const bucketName = getPrivateBucketName();
        const { category: crmCategory, document_type: documentType } =
            PORTAL_CATEGORY_TO_LEAD_FILE[portalCategory];

        const { data: lead, error: leadError } = await supabase
            .from("leads")
            .select("id, contact_id, status, metadata")
            .eq("document_upload_token", token)
            .maybeSingle<LeadForUpload>();

        if (leadError || !lead) {
            return NextResponse.json({ error: "Invalid upload token." }, { status: 404 });
        }

        if (isDocumentPortalSubmitted(lead.metadata)) {
            return NextResponse.json(
                { error: "Documents for this lead have already been submitted." },
                { status: 409 }
            );
        }

        if (lead.status === "won" || lead.status === "lost") {
            return NextResponse.json(
                { error: "This lead is closed; uploads are disabled." },
                { status: 409 }
            );
        }

        const uploadedRecords: Array<{
            id: string;
            fileName: string;
            filePath: string;
            category: string;
            createdAt: string;
        }> = [];

        for (const file of files) {
            const safeFileName = sanitizeFileName(file.name);
            if (!safeFileName) {
                return NextResponse.json({ error: "Invalid filename detected." }, { status: 400 });
            }

            const storagePath = `${lead.id}/${crypto.randomUUID()}-${safeFileName}`;
            const storedFileName = storagePath.split("/").pop();

            const { error: uploadError } = await supabase.storage
                .from(bucketName)
                .upload(storagePath, file, {
                    cacheControl: "3600",
                    upsert: false,
                    contentType: file.type,
                });

            if (uploadError) {
                return NextResponse.json({ error: "Unable to store uploaded file." }, { status: 500 });
            }

            const fileMetadata: LeadFileMetadata = {
                original_filename: safeFileName,
                portal_category: portalCategory,
                mime_type: file.type,
                uploaded_via: "docflow_portal",
            };

            const { data: insertedFile, error: insertError } = await supabase
                .from("lead_files")
                .insert({
                    lead_id: lead.id,
                    contact_id: lead.contact_id,
                    category: crmCategory,
                    document_type: documentType,
                    status: "uploaded",
                    storage_bucket: bucketName,
                    storage_path: storagePath,
                    original_file_name: safeFileName,
                    stored_file_name: storedFileName,
                    metadata: fileMetadata,
                })
                .select("id, category, storage_path, metadata, created_at")
                .single<{
                    id: string;
                    category: string;
                    storage_path: string;
                    metadata: LeadFileMetadata | null;
                    created_at: string;
                }>();

            if (insertError || !insertedFile) {
                console.log(insertError)
                await supabase.storage.from(bucketName).remove([storagePath]);
                return NextResponse.json({ error: "Unable to save file metadata." }, { status: 500 });
            }

            const webhookUrl = getN8nWebhookUrlUploaded();

            uploadedRecords.push({
                id: insertedFile.id,
                fileName: insertedFile.metadata?.original_filename ?? safeFileName,
                filePath: insertedFile.storage_path,
                category: insertedFile.category,
                createdAt: insertedFile.created_at,
            });

            fetch(webhookUrl, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET!,
                },
                body: JSON.stringify({
                    lead_id: lead.id,
                    file_id: insertedFile.id,
                    document_type: documentType,
                    storage_path: insertedFile.storage_path,
                    mime_type: file.type,
                }),
            }).catch(err => {
                console.error("n8n webhook failed", err);
            });
        }

        return NextResponse.json({ uploaded: uploadedRecords }, { status: 200 });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid upload request." },
            { status: 400 }
        );
    }
}

export async function DELETE(request: Request) {
    try {
        const body = await request.json();
        const parsed = deleteFilePayloadSchema.parse(body);

        const supabase = getSupabaseAdmin();
        const defaultBucket = getPrivateBucketName();

        const { data: lead, error: leadError } = await supabase
            .from("leads")
            .select("id, metadata")
            .eq("document_upload_token", parsed.token)
            .maybeSingle<{ id: string; metadata: Record<string, unknown> | null }>();

        if (leadError || !lead) {
            return NextResponse.json({ error: "Invalid upload token." }, { status: 404 });
        }

        if (isDocumentPortalSubmitted(lead.metadata)) {
            return NextResponse.json(
                { error: "Documents have already been submitted; removal is disabled." },
                { status: 409 }
            );
        }

        const { data: fileRecord, error: fileError } = await supabase
            .from("lead_files")
            .select("id, storage_path, storage_bucket")
            .eq("id", parsed.fileId)
            .eq("lead_id", lead.id)
            .maybeSingle<{ id: string; storage_path: string; storage_bucket: string | null }>();

        if (fileError || !fileRecord) {
            return NextResponse.json({ error: "File not found." }, { status: 404 });
        }

        const bucket = fileRecord.storage_bucket ?? defaultBucket;

        const { error: removeStorageError } = await supabase.storage
            .from(bucket)
            .remove([fileRecord.storage_path]);

        if (removeStorageError) {
            return NextResponse.json({ error: "Unable to remove file." }, { status: 500 });
        }

        const { error: deleteMetadataError } = await supabase
            .from("lead_files")
            .delete()
            .eq("id", fileRecord.id);

        if (deleteMetadataError) {
            return NextResponse.json({ error: "Unable to remove file metadata." }, { status: 500 });
        }

        return NextResponse.json({ ok: true });
    } catch (error) {
        return NextResponse.json(
            { error: error instanceof Error ? error.message : "Invalid delete request." },
            { status: 400 }
        );
    }
}
