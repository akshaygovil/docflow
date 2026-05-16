import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { isDocumentPortalSubmitted } from "@/lib/docflow";
import { getPrivateBucketName, getSupabaseAdmin } from "@/lib/supabase-admin";
import { BrokerUnsubmitForm } from "./broker-unsubmit-form";

export const dynamic = "force-dynamic";

const uuidSchema = z.string().uuid();

type UnknownRecord = Record<string, unknown>;

type PageProps = {
    params: Promise<{ id: string }>;
};

function formatWhen(iso: string | null | undefined): string {
    if (!iso) return "—";

    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);

    return date.toLocaleString(undefined, {
        dateStyle: "medium",
        timeStyle: "short",
    });
}

function formatCurrency(value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";

    return new Intl.NumberFormat("en-AU", {
        style: "currency",
        currency: "AUD",
        maximumFractionDigits: 0,
    }).format(number);
}

function formatNumber(value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";

    return new Intl.NumberFormat("en-AU").format(number);
}

function formatPercent(value: unknown): string {
    const number = Number(value);
    if (!Number.isFinite(number)) return "—";

    const percent = number > 1 ? number : number * 100;
    return `${percent.toFixed(1)}%`;
}

function humanize(value: string | null | undefined): string {
    if (!value) return "—";

    const labels: Record<string, string> = {
        "1_3": "1–3 months",
        "3_6": "3–6 months",
        "6plus": "6+ months",

        asap: "ASAP",
        later: "Later",

        full_time: "Full-time",
        part_time: "Part-time",
        casual: "Casual",
        self_employed: "Self-employed",
        contractor: "Contractor",

        buy: "Buying property",
        refinance: "Refinancing",
        investment: "Investment property",

        new: "New",
        attempting_contact: "Attempting contact",
        awaiting_documents: "Awaiting documents",
        contacted: "Contacted",
        replied: "Replied",
        qualified: "Qualified",
        nurturing: "Nurturing",
        booked: "Booked",
        won: "Won",
        lost: "Lost",
        spam: "Spam",
        duplicate: "Duplicate",

        uploaded: "Uploaded",
        verified: "Verified",
        invalid: "Needs attention",
        pending: "Pending",
    };

    return (
        labels[value] ??
        value
            .replace(/_/g, " ")
            .replace(/\b\w/g, (char) => char.toUpperCase())
    );
}

function getString(record: UnknownRecord | null | undefined, key: string): string {
    const value = record?.[key];
    return typeof value === "string" ? value : "";
}

function getBoolean(record: UnknownRecord | null | undefined, key: string): boolean {
    return record?.[key] === true;
}

function getObject(value: unknown): UnknownRecord {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }

    return value as UnknownRecord;
}

function getRawInputs(lead: UnknownRecord): UnknownRecord {
    return getObject(lead.raw_inputs);
}

function getMetaOriginalFilename(row: UnknownRecord): string | null {
    const metadata = getObject(row.metadata);
    const name = metadata.original_filename;

    return typeof name === "string" && name.trim() ? name : null;
}

function getStatusTone(status: string | null | undefined): string {
    switch (status) {
        case "qualified":
        case "booked":
        case "won":
            return "bg-emerald-50 text-emerald-700 ring-emerald-200";

        case "awaiting_documents":
        case "attempting_contact":
        case "replied":
            return "bg-blue-50 text-blue-700 ring-blue-200";

        case "lost":
        case "spam":
            return "bg-rose-50 text-rose-700 ring-rose-200";

        case "nurturing":
            return "bg-amber-50 text-amber-800 ring-amber-200";

        default:
            return "bg-slate-100 text-slate-700 ring-slate-200";
    }
}

function compactJson(value: unknown): string {
    if (value === null || value === undefined) return "—";

    try {
        return JSON.stringify(value, null, 2);
    } catch {
        return String(value);
    }
}

function calculateCombinedIncome(rawInputs: UnknownRecord): number | null {
    const firstIncome = Number(rawInputs.annualIncome ?? 0);
    const secondIncome = Number(rawInputs.secondIncome ?? 0);

    if (!Number.isFinite(firstIncome) && !Number.isFinite(secondIncome)) {
        return null;
    }

    return firstIncome + secondIncome;
}

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
        .maybeSingle<UnknownRecord>();

    if (leadError || !lead) {
        notFound();
    }

    const contactId = lead.contact_id as string | null | undefined;

    let contact: UnknownRecord | null = null;

    if (contactId) {
        const { data } = await supabase
            .from("contacts")
            .select("*")
            .eq("id", contactId)
            .maybeSingle<UnknownRecord>();

        contact = data ?? null;
    }

    const { data: fileRows } = await supabase
        .from("lead_files")
        .select("*")
        .eq("lead_id", id)
        .order("created_at", { ascending: true })
        .returns<UnknownRecord[]>();

    const files = fileRows ?? [];

    let defaultBucket = "";

    try {
        defaultBucket = getPrivateBucketName();
    } catch {
        defaultBucket = "";
    }

    const filesWithUrls = await Promise.all(
        files.map(async (row) => {
            const path = row.storage_path as string | undefined;
            const bucket = (row.storage_bucket as string) || defaultBucket || null;

            if (!path || !bucket) {
                return {
                    row,
                    signedUrl: null as string | null,
                };
            }

            const { data } = await supabase.storage
                .from(bucket)
                .createSignedUrl(path, 3600);

            return {
                row,
                signedUrl: data?.signedUrl ?? null,
            };
        })
    );

    const metadata = getObject(lead.metadata);
    const rawInputs = getRawInputs(lead);

    const portalSubmitted = isDocumentPortalSubmitted(metadata ?? null);

    const baseUrl =
        process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
        (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");

    const uploadToken = lead.document_upload_token as string | undefined;
    const portalPath = uploadToken ? `/upload/${uploadToken}` : null;
    const portalUrl = portalPath && baseUrl ? `${baseUrl}${portalPath}` : null;

    const status = getString(lead, "status");

    const fullName =
        getString(contact, "full_name") ||
        [getString(contact, "first_name"), getString(contact, "last_name")]
            .filter(Boolean)
            .join(" ") ||
        "Unnamed prospect";

    const email = getString(contact, "email");
    const phone = getString(contact, "phone_e164") || getString(contact, "phone");

    const combinedIncome = calculateCombinedIncome(rawInputs);

    return (
        <div className="min-h-screen bg-slate-50 text-slate-950">
            <header className="border-b border-slate-200 bg-white">
                <div className="mx-auto max-w-5xl px-4 py-6 sm:px-6 lg:px-8">
                    <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                        <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-2">
                                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                                    Internal Lead File
                                </p>

                                <StatusPill
                                    label={humanize(status)}
                                    tone={getStatusTone(status)}
                                />

                                <StatusPill
                                    label={
                                        portalSubmitted ? "Portal submitted" : "Portal not submitted"
                                    }
                                    tone={
                                        portalSubmitted
                                            ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                                            : "bg-slate-100 text-slate-700 ring-slate-200"
                                    }
                                />
                            </div>

                            <h1 className="mt-3 truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">
                                {fullName}
                            </h1>

                            <div className="mt-2 space-y-1 text-sm text-slate-600">
                                <p>{email || "No email provided"}</p>
                                <p>{phone || "No phone provided"}</p>
                            </div>
                        </div>

                        <div className="flex shrink-0 flex-wrap gap-2">
                            {portalUrl ? (
                                <a
                                    href={portalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white transition hover:bg-slate-800"
                                >
                                    Open portal
                                </a>
                            ) : null}

                            <Link
                                href="/"
                                className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                            >
                                Home
                            </Link>
                        </div>
                    </div>
                </div>
            </header>

            <main className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:px-6 lg:px-8">
                <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                    <MetricCard
                        label="Property price"
                        value={formatCurrency(rawInputs.propertyPrice)}
                        helper="Target purchase"
                    />

                    <MetricCard
                        label="Deposit"
                        value={formatCurrency(rawInputs.deposit)}
                        helper="Cash contribution"
                    />

                    <MetricCard
                        label="Income"
                        value={combinedIncome === null ? "—" : formatCurrency(combinedIncome)}
                        helper={
                            getBoolean(rawInputs, "hasSecondApplicant")
                                ? "Combined annual"
                                : "Annual income"
                        }
                    />

                    <MetricCard
                        label="Timeline"
                        value={humanize(rawInputs.buyTimeline as string)}
                        helper="Buying timeframe"
                    />
                </section>

                <Card>
                    <SectionHeader
                        eyebrow="Broker summary"
                        title="Lead snapshot"
                        description="The key information a broker needs to understand the opportunity quickly."
                    />

                    <div className="mt-6 space-y-3">
                        <DetailRow label="Prospect" value={fullName} />
                        <DetailRow label="Email" value={email || "—"} />
                        <DetailRow label="Phone" value={phone || "—"} />
                        <DetailRow label="Goal" value={humanize(lead.goal as string)} />
                        <DetailRow label="Status" value={humanize(status)} />
                        <DetailRow label="Source" value={humanize(lead.source as string)} />
                        <DetailRow
                            label="Form type"
                            value={humanize(lead.form_type as string)}
                        />
                    </div>
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Mortgage details"
                        title="Application information"
                        description="Formatted from raw_inputs so the broker does not need to read JSON."
                    />

                    <div className="mt-6 space-y-3">
                        <DetailRow
                            label="Property price"
                            value={formatCurrency(rawInputs.propertyPrice)}
                        />
                        <DetailRow label="Deposit" value={formatCurrency(rawInputs.deposit)} />
                        <DetailRow
                            label="Annual income"
                            value={formatCurrency(rawInputs.annualIncome)}
                        />
                        <DetailRow
                            label="Second applicant"
                            value={getBoolean(rawInputs, "hasSecondApplicant") ? "Yes" : "No"}
                        />
                        <DetailRow
                            label="Second income"
                            value={formatCurrency(rawInputs.secondIncome)}
                        />
                        <DetailRow
                            label="Combined income"
                            value={combinedIncome === null ? "—" : formatCurrency(combinedIncome)}
                        />
                        <DetailRow
                            label="Monthly debts"
                            value={formatCurrency(rawInputs.monthlyDebts)}
                        />
                        <DetailRow
                            label="Employment type"
                            value={humanize(rawInputs.employmentType as string)}
                        />
                        <DetailRow
                            label="Buying timeline"
                            value={humanize(rawInputs.buyTimeline as string)}
                        />

                        {rawInputs.listingUrl ? (
                            <DetailRow
                                label="Listing URL"
                                value={
                                    <a
                                        href={String(rawInputs.listingUrl)}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all font-medium text-blue-700 hover:underline"
                                    >
                                        {String(rawInputs.listingUrl)}
                                    </a>
                                }
                            />
                        ) : (
                            <DetailRow label="Listing URL" value="—" />
                        )}
                    </div>
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Document portal"
                        title="Upload status"
                        description="Shows whether the prospect has submitted documents and gives the broker access to the upload link."
                    />

                    <div className="mt-6 space-y-3">
                        <DetailRow
                            label="Portal status"
                            value={portalSubmitted ? "Submitted" : "Not submitted"}
                        />

                        <DetailRow
                            label="Upload link"
                            value={
                                portalUrl ? (
                                    <a
                                        href={portalUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="break-all font-medium text-blue-700 hover:underline"
                                    >
                                        {portalUrl}
                                    </a>
                                ) : portalPath ? (
                                    <span className="break-all font-mono text-xs">{portalPath}</span>
                                ) : (
                                    "No document upload token"
                                )
                            }
                        />

                        <DetailRow
                            label="Lead ID"
                            value={<span className="font-mono text-xs">{id}</span>}
                        />
                    </div>

                    <div className="mt-6 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                        <BrokerUnsubmitForm
                            leadId={id}
                            portalSubmitted={portalSubmitted}
                        />
                    </div>
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Files"
                        title={`Uploaded documents (${files.length})`}
                        description="Each download link is a temporary signed URL for private storage."
                    />

                    {filesWithUrls.length === 0 ? (
                        <EmptyState
                            title="No documents uploaded yet"
                            description="When the prospect uploads files, they will appear here."
                        />
                    ) : (
                        <div className="mt-6 space-y-3">
                            {filesWithUrls.map(({ row, signedUrl }, index) => {
                                const fallbackName =
                                    String(row.storage_path ?? "file").split("/").pop() || "file";

                                const name = getMetaOriginalFilename(row) ?? fallbackName;

                                return (
                                    <div
                                        key={String(row.id ?? index)}
                                        className="rounded-2xl border border-slate-200 bg-white p-4"
                                    >
                                        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                            <div className="min-w-0">
                                                <p className="break-words text-sm font-semibold text-slate-950">
                                                    {name}
                                                </p>

                                                <div className="mt-3 flex flex-wrap gap-2">
                                                    <MiniBadge>
                                                        {humanize(row.category as string)}
                                                    </MiniBadge>
                                                    <MiniBadge>
                                                        {humanize(row.document_type as string)}
                                                    </MiniBadge>
                                                    <MiniBadge>{humanize(row.status as string)}</MiniBadge>
                                                </div>
                                            </div>

                                            {signedUrl ? (
                                                <a
                                                    href={signedUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="shrink-0 rounded-full border border-slate-200 px-4 py-2 text-center text-sm font-medium text-slate-700 transition hover:bg-slate-50"
                                                >
                                                    Download
                                                </a>
                                            ) : (
                                                <span className="text-sm text-slate-400">No link</span>
                                            )}
                                        </div>

                                        <div className="mt-4 space-y-2 border-t border-slate-100 pt-4">
                                            <CompactRow
                                                label="Category"
                                                value={humanize(row.category as string)}
                                            />
                                            <CompactRow
                                                label="Document type"
                                                value={humanize(row.document_type as string)}
                                            />
                                            <CompactRow
                                                label="Status"
                                                value={humanize(row.status as string)}
                                            />
                                            <CompactRow
                                                label="Uploaded"
                                                value={formatWhen(
                                                    (row.uploaded_at as string) ||
                                                    (row.created_at as string)
                                                )}
                                            />
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Activity"
                        title="Lead timeline"
                        description="Important timestamps for the lead and contact record."
                    />

                    <div className="mt-6 space-y-3">
                        <DetailRow
                            label="Latest inbound"
                            value={formatWhen(lead.latest_inbound_at as string)}
                        />
                        <DetailRow
                            label="Latest outbound"
                            value={formatWhen(lead.latest_outbound_at as string)}
                        />
                        <DetailRow
                            label="Last contacted"
                            value={formatWhen(lead.last_contacted_at as string)}
                        />
                        <DetailRow
                            label="Lead created"
                            value={formatWhen(lead.created_at as string)}
                        />
                        <DetailRow
                            label="Lead updated"
                            value={formatWhen(lead.updated_at as string)}
                        />
                        <DetailRow
                            label="Contact created"
                            value={formatWhen(contact?.created_at as string)}
                        />
                        <DetailRow
                            label="Contact updated"
                            value={formatWhen(contact?.updated_at as string)}
                        />
                    </div>
                </Card>

                <Card>
                    <SectionHeader
                        eyebrow="Advanced"
                        title="System data"
                        description="Readable structured data for debugging. Raw JSON is still available, but hidden by default."
                    />

                    <div className="mt-6 space-y-4">
                        <ReadableDataPanel title="Raw inputs" value={lead.raw_inputs} defaultOpen />
                        <ReadableDataPanel title="Preview estimate" value={lead.preview_estimate} />
                        <ReadableDataPanel title="Full result" value={lead.full_result} />
                        <ReadableDataPanel title="Metadata" value={lead.metadata} />
                        <ReadableDataPanel title="Contact preferences" value={contact?.preferences} />
                        <ReadableDataPanel title="Contact tags" value={contact?.tags} />
                    </div>
                </Card>
            </main>
        </div>
    );
}

function Card({ children }: { children: React.ReactNode }) {
    return (
        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            {children}
        </section>
    );
}

function SectionHeader({
    eyebrow,
    title,
    description,
}: {
    eyebrow: string;
    title: string;
    description?: string;
}) {
    return (
        <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
                {eyebrow}
            </p>

            <h2 className="mt-1 text-lg font-semibold tracking-tight text-slate-950">
                {title}
            </h2>

            {description ? (
                <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">
                    {description}
                </p>
            ) : null}
        </div>
    );
}

function MetricCard({
    label,
    value,
    helper,
}: {
    label: string;
    value: string;
    helper: string;
}) {
    return (
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
            </p>

            <p className="mt-2 truncate text-2xl font-semibold tracking-tight text-slate-950">
                {value}
            </p>

            <p className="mt-1 truncate text-sm text-slate-500">{helper}</p>
        </div>
    );
}

function DetailRow({
    label,
    value,
}: {
    label: string;
    value: React.ReactNode;
}) {
    const display =
        value === null || value === undefined || value === "" ? "—" : value;

    return (
        <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                {label}
            </p>

            <div className="mt-1 break-words text-sm font-medium leading-6 text-slate-950">
                {display}
            </div>
        </div>
    );
}

function CompactRow({
    label,
    value,
}: {
    label: string;
    value: React.ReactNode;
}) {
    const display =
        value === null || value === undefined || value === "" ? "—" : value;

    return (
        <div className="flex flex-col gap-1 text-sm sm:flex-row sm:items-start sm:justify-between">
            <span className="text-slate-500">{label}</span>
            <span className="break-words font-medium text-slate-900 sm:text-right">
                {display}
            </span>
        </div>
    );
}

function StatusPill({
    label,
    tone,
}: {
    label: string;
    tone: string;
}) {
    return (
        <span
            className={`inline-flex items-center rounded-full px-3 py-1 text-xs font-semibold ring-1 ${tone}`}
        >
            {label}
        </span>
    );
}

function MiniBadge({ children }: { children: React.ReactNode }) {
    return (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">
            {children}
        </span>
    );
}

function EmptyState({
    title,
    description,
}: {
    title: string;
    description: string;
}) {
    return (
        <div className="mt-6 rounded-2xl border border-dashed border-slate-300 bg-slate-50 p-6 text-center">
            <p className="text-sm font-semibold text-slate-800">{title}</p>
            <p className="mt-1 text-sm text-slate-500">{description}</p>
        </div>
    );
}

function ReadableDataPanel({
    title,
    value,
    defaultOpen = false,
}: {
    title: string;
    value: unknown;
    defaultOpen?: boolean;
}) {
    const hasValue = value !== null && value !== undefined;

    return (
        <details
            open={defaultOpen}
            className="group rounded-2xl border border-slate-200 bg-slate-50"
        >
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
                <div>
                    <p className="text-sm font-semibold text-slate-900">{title}</p>
                    <p className="text-xs text-slate-500">
                        {hasValue ? "View structured data" : "No data available"}
                    </p>
                </div>

                <span className="text-sm text-slate-400 transition group-open:rotate-180">
                    ↓
                </span>
            </summary>

            <div className="border-t border-slate-200 p-4">
                {!hasValue ? (
                    <p className="text-sm text-slate-500">—</p>
                ) : (
                    <ReadableValue value={value} />
                )}

                <details className="mt-4 rounded-xl border border-slate-200 bg-white">
                    <summary className="cursor-pointer px-3 py-2 text-xs font-medium uppercase tracking-wide text-slate-500">
                        Raw JSON
                    </summary>

                    <pre className="max-h-96 overflow-auto border-t border-slate-100 p-3 text-xs leading-relaxed text-slate-700">
                        {compactJson(value)}
                    </pre>
                </details>
            </div>
        </details>
    );
}

function ReadableValue({ value }: { value: unknown }) {
    if (value === null || value === undefined) {
        return <span className="text-sm text-slate-500">—</span>;
    }

    if (typeof value === "string") {
        return <span className="text-sm text-slate-800">{humanize(value)}</span>;
    }

    if (typeof value === "number") {
        return <span className="text-sm text-slate-800">{formatNumber(value)}</span>;
    }

    if (typeof value === "boolean") {
        return <span className="text-sm text-slate-800">{value ? "Yes" : "No"}</span>;
    }

    if (Array.isArray(value)) {
        if (value.length === 0) {
            return <span className="text-sm text-slate-500">Empty list</span>;
        }

        return (
            <div className="space-y-2">
                {value.map((item, index) => (
                    <div
                        key={index}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                        <ReadableValue value={item} />
                    </div>
                ))}
            </div>
        );
    }

    if (typeof value === "object") {
        const entries = Object.entries(value as UnknownRecord);

        if (entries.length === 0) {
            return <span className="text-sm text-slate-500">Empty object</span>;
        }

        return (
            <div className="space-y-2">
                {entries.map(([key, item]) => (
                    <div
                        key={key}
                        className="rounded-xl border border-slate-200 bg-white p-3"
                    >
                        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                            {humanize(key)}
                        </p>

                        <div className="mt-1 min-w-0 break-words text-sm leading-6 text-slate-900">
                            <ReadableValue value={formatSmartValue(key, item)} />
                        </div>
                    </div>
                ))}
            </div>
        );
    }

    return <span className="text-sm text-slate-800">{String(value)}</span>;
}

function formatSmartValue(key: string, value: unknown): unknown {
    const lowerKey = key.toLowerCase();

    if (
        lowerKey.includes("price") ||
        lowerKey.includes("income") ||
        lowerKey.includes("deposit") ||
        lowerKey.includes("debt") ||
        lowerKey.includes("loan") ||
        lowerKey.includes("amount") ||
        lowerKey.includes("repayment")
    ) {
        const number = Number(value);
        if (Number.isFinite(number)) return formatCurrency(number);
    }

    if (
        lowerKey.includes("rate") ||
        lowerKey.includes("percent") ||
        lowerKey.includes("ratio") ||
        lowerKey.includes("lvr")
    ) {
        const number = Number(value);
        if (Number.isFinite(number)) return formatPercent(number);
    }

    if (
        lowerKey.includes("created") ||
        lowerKey.includes("updated") ||
        lowerKey.includes("submitted") ||
        lowerKey.includes("received") ||
        lowerKey.includes("sent_at") ||
        lowerKey.includes("uploaded") ||
        lowerKey.endsWith("_at")
    ) {
        if (typeof value === "string") return formatWhen(value);
    }

    if (typeof value === "string") {
        return humanize(value);
    }

    return value;
}