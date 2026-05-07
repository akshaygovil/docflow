import { createClient } from "@supabase/supabase-js";

function getEnv(name: string): string {
    const value = process.env[name];
    if (!value) {
        throw new Error(`Missing required environment variable: ${name}`);
    }
    return value;
}

export function getSupabaseAdmin() {
    return createClient(getEnv("SUPABASE_URL"), getEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });
}

export function getPrivateBucketName() {
    return getEnv("SUPABASE_PRIVATE_BUCKET");
}

export function getN8nWebhookUrlUploaded() {
    return getEnv("N8N_WEBHOOK_URL_UPLOADED");
}

export function getN8nWebhookUrlSubmitted() {
    return getEnv("N8N_WEBHOOK_URL_SUBMITTED");
}
