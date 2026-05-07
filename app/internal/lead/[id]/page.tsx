import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isDocumentPortalSubmitted } from "@/lib/docflow";
import { getPrivateBucketName, getSupabaseAdmin } from "@/lib/supabase-admin";
import { BrokerUnsubmitForm } from "./broker-unsubmit-form";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

function formatWhen(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return String(iso);
  }
}

function JsonPanel({
  title,
  value,
}: {
  title: string;
  value: unknown;
}) {
  if (value === null || value === undefined) {
    return (
      <section className="ui-card p-4">
        <h3 className="ui-meta font-semibold uppercase tracking-wide">
          {title}
        </h3>
        <p className="mt-2 ui-body">—</p>
      </section>
    );
  }
  return (
    <section className="ui-card p-4">
      <h3 className="ui-meta font-semibold uppercase tracking-wide">
        {title}
      </h3>
      <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-800">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function InternalLeadPage({ params }: PageProps) {
  const { id } = await params;
  if (!uuidSchema.safeParse(id).success) {
    notFound();
  }

  const supabase = getSupabaseAdmin();

  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("*")
    .eq("id", id)
    .maybeSingle<Record<string, unknown>>();

  if (leadError || !lead) {
    notFound();
  }

  const contactId = lead.contact_id as string | null | undefined;
  let contact: Record<string, unknown> | null = null;
  if (contactId) {
    const { data: c } = await supabase
      .from("contacts")
      .select("*")
      .eq("id", contactId)
      .maybeSingle<Record<string, unknown>>();
    contact = c ?? null;
  }

  const { data: fileRows } = await supabase
    .from("lead_files")
    .select("*")
    .eq("lead_id", id)
    .order("created_at", { ascending: true })
    .returns<Record<string, unknown>[]>();

  const files = fileRows ?? [];
  let defaultBucket: string;
  try {
    defaultBucket = getPrivateBucketName();
  } catch {
    defaultBucket = "";
  }

  const filesWithUrls: Array<{
    row: Record<string, unknown>;
    signedUrl: string | null;
  }> = [];

  for (const row of files) {
    const path = row.storage_path as string | undefined;
    const bucket = (row.storage_bucket as string) || defaultBucket || null;
    if (!path || !bucket) {
      filesWithUrls.push({ row, signedUrl: null });
      continue;
    }
    const { data: signed } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 3600);
    filesWithUrls.push({ row, signedUrl: signed?.signedUrl ?? null });
  }

  const metadata = lead.metadata as Record<string, unknown> | null | undefined;
  const portalSubmitted = isDocumentPortalSubmitted(metadata ?? null);

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

  const uploadToken = lead.document_upload_token as string | undefined;
  const portalPath =
    uploadToken && uploadToken.length > 0
      ? `/upload/${uploadToken}`
      : null;

  return (
    <div className="ui-page">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl flex-col gap-4 px-4 py-6 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div>
            <p className="ui-meta font-semibold uppercase tracking-wide">
              Internal · Lead
            </p>
            <h1 className="mt-1 font-mono text-lg text-slate-900">{id}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-chip">
              {(lead.status as string) ?? "—"}
            </span>
            <span
              className={`rounded-full px-3 py-1 text-xs font-medium ${
                portalSubmitted
                  ? "bg-green-100 text-green-900"
                  : "bg-slate-200 text-slate-700"
              }`}
            >
              Portal: {portalSubmitted ? "Submitted" : "Not submitted"}
            </span>
            <Link
              href="/"
              className="ui-link"
            >
              Home
            </Link>
          </div>
        </div>
      </header>

      <main className="ui-shell-wide space-y-8 py-8">
        <p className="ui-body">
          This page is for broker use. Protect it in production (e.g. VPN, SSO,
          or reverse-proxy auth).
        </p>

        <section className="ui-card p-6">
          <h2 className="ui-h3">Contact</h2>
          {!contact ? (
            <p className="mt-2 ui-body">No linked contact.</p>
          ) : (
            <div className="mt-4 space-y-6">
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Full name" value={contact.full_name as string} />
                <Field label="First name" value={contact.first_name as string} />
                <Field label="Last name" value={contact.last_name as string} />
                <Field label="Email" value={contact.email as string} />
                <Field label="Phone" value={contact.phone as string} />
                <Field
                  label="Phone (E.164)"
                  value={contact.phone_e164 as string}
                />
                <Field
                  label="Created"
                  value={formatWhen(contact.created_at as string)}
                />
                <Field
                  label="Updated"
                  value={formatWhen(contact.updated_at as string)}
                />
              </div>
              <JsonPanel title="Preferences" value={contact.preferences} />
              <JsonPanel title="Tags" value={contact.tags} />
            </div>
          )}
        </section>

        <section className="ui-card p-6">
          <h2 className="ui-h3">Lead</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Field label="Source" value={lead.source as string} />
            <Field label="Form type" value={lead.form_type as string} />
            <Field label="Goal" value={lead.goal as string} />
            <Field label="Status" value={lead.status as string} />
            <Field
              label="Latest inbound"
              value={formatWhen(lead.latest_inbound_at as string)}
            />
            <Field
              label="Latest outbound"
              value={formatWhen(lead.latest_outbound_at as string)}
            />
            <Field
              label="Last contacted"
              value={formatWhen(lead.last_contacted_at as string)}
            />
            <Field
              label="Created"
              value={formatWhen(lead.created_at as string)}
            />
            <Field
              label="Updated"
              value={formatWhen(lead.updated_at as string)}
            />
          </div>

          <div className="mt-6 rounded-lg border border-slate-100 bg-slate-50 p-4">
            <p className="ui-meta font-semibold uppercase tracking-wide">
              Prospect upload link
            </p>
            {portalPath ? (
              <div className="mt-2 space-y-2 text-sm">
                <p className="font-mono text-slate-800">{portalPath}</p>
                {baseUrl ? (
                  <a
                    href={`${baseUrl}${portalPath}`}
                    className="ui-link inline-block"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Open upload portal
                  </a>
                ) : (
                  <p className="ui-meta">
                    Set{" "}
                    <code className="rounded bg-white px-1">NEXT_PUBLIC_APP_URL</code>{" "}
                    for a full URL.
                  </p>
                )}
              </div>
            ) : (
              <p className="mt-2 ui-body">
                No document upload token on this lead.
              </p>
            )}
          </div>

          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            <JsonPanel title="raw_inputs" value={lead.raw_inputs} />
            <JsonPanel title="preview_estimate" value={lead.preview_estimate} />
            <JsonPanel title="full_result" value={lead.full_result} />
            <JsonPanel title="metadata" value={lead.metadata} />
          </div>
        </section>

        <section className="ui-card p-6">
          <h2 className="ui-h3">
            Files ({files.length})
          </h2>
          {files.length === 0 ? (
            <p className="mt-2 ui-body">No files uploaded yet.</p>
          ) : (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[640px] text-left text-sm">
                <thead>
                  <tr className="border-b border-slate-200 text-xs uppercase text-slate-500">
                    <th className="pb-2 pr-3 font-medium">File</th>
                    <th className="pb-2 pr-3 font-medium">Category</th>
                    <th className="pb-2 pr-3 font-medium">Type</th>
                    <th className="pb-2 pr-3 font-medium">Status</th>
                    <th className="pb-2 font-medium">Download</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {filesWithUrls.map(({ row, signedUrl }, i) => {
                    const meta = row.metadata as
                      | { original_filename?: string }
                      | undefined;
                    const name =
                      meta?.original_filename ??
                      String(row.storage_path ?? "file").split("/").pop() ??
                      "file";
                    return (
                      <tr key={String(row.id ?? i)} className="align-top">
                        <td className="py-3 pr-3 font-medium text-slate-900">
                          {name}
                        </td>
                        <td className="py-3 pr-3 text-slate-700">
                          {String(row.category ?? "—")}
                        </td>
                        <td className="py-3 pr-3 text-slate-700">
                          {String(row.document_type ?? "—")}
                        </td>
                        <td className="py-3 pr-3 text-slate-700">
                          {String(row.status ?? "—")}
                        </td>
                        <td className="py-3">
                          {signedUrl ? (
                            <a
                              href={signedUrl}
                              className="font-medium text-blue-600 hover:underline"
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              Download
                            </a>
                          ) : (
                            <span className="text-slate-400">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="ui-card p-6">
          <h2 className="ui-h3">
            Document portal actions
          </h2>
          <div className="mt-4">
            <BrokerUnsubmitForm
              leadId={id}
              portalSubmitted={portalSubmitted}
            />
          </div>
        </section>
      </main>
    </div>
  );
}

function Field({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  const display =
    value === null || value === undefined || value === ""
      ? "—"
      : String(value);
  return (
    <div>
      <p className="text-xs font-medium text-slate-500">{label}</p>
      <p className="mt-0.5 text-sm text-slate-900">{display}</p>
    </div>
  );
}
