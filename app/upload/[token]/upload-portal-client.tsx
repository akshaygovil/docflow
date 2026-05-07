"use client";

import {
    useCallback,
    useMemo,
    useState,
    type ChangeEvent,
    type DragEvent,
} from "react";
import {
    DOC_CATEGORIES,
    PORTAL_SECTIONS,
    type ExistingPortalFile,
} from "@/lib/docflow";

type ApplicationView = {
    id: string;
    token: string;
    fullName: string;
    email: string;
    applicationType: string;
};

type PortalCategory = (typeof DOC_CATEGORIES)[number];

type UploadedFile = {
    id: string;
    fileName: string;
    category: string;
    filePath: string;
    createdAt?: string;
};

type UploadItem = {
    localId: string;
    portalCategory: PortalCategory;
    fileName: string;
    progress: number;
    status: "uploading" | "uploaded" | "error";
    error?: string;
    uploadedFile?: UploadedFile;
};

const ACCEPT =
    ".pdf,.jpg,.jpeg,.png,.doc,.docx,application/pdf,image/jpeg,image/png";

function existingToUploadItems(files: ExistingPortalFile[]): UploadItem[] {
    return files.map((f) => ({
        localId: f.id,
        portalCategory: f.portalCategory,
        fileName: f.fileName,
        progress: 100,
        status: "uploaded" as const,
        uploadedFile: {
            id: f.id,
            fileName: f.fileName,
            category: f.crmCategory,
            filePath: f.filePath,
            createdAt: f.createdAt,
        },
    }));
}

export default function UploadPortalClient({
    application,
    initialFiles,
    portalSubmittedInitially,
}: {
    application: ApplicationView;
    initialFiles: ExistingPortalFile[];
    portalSubmittedInitially: boolean;
}) {
    const [uploadItems, setUploadItems] = useState<UploadItem[]>(() =>
        existingToUploadItems(initialFiles)
    );
    const [activeDropKey, setActiveDropKey] = useState<PortalCategory | null>(
        null
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isConfirmOpen, setIsConfirmOpen] = useState(false);
    const [submitState, setSubmitState] = useState<{
        ok: boolean;
        message: string;
    } | null>(null);

    const portalComplete = portalSubmittedInitially || !!submitState?.ok;

    const uploadedFiles = useMemo(
        () =>
            uploadItems
                .filter(
                    (
                        item
                    ): item is UploadItem & { uploadedFile: UploadedFile } =>
                        item.status === "uploaded" && Boolean(item.uploadedFile)
                )
                .map((item) => item.uploadedFile),
        [uploadItems]
    );

    const sectionsWithUploads = useMemo(() => {
        const keys = new Set<PortalCategory>();
        for (const item of uploadItems) {
            if (item.status === "uploaded" && item.uploadedFile) {
                keys.add(item.portalCategory);
            }
        }
        return keys.size;
    }, [uploadItems]);

    const uploadOneFile = useCallback(
        async (portalCategory: PortalCategory, file: File) => {
            const localId = crypto.randomUUID();

            setUploadItems((prev) => [
                ...prev,
                {
                    localId,
                    portalCategory,
                    fileName: file.name,
                    progress: 8,
                    status: "uploading",
                },
            ]);

            const timer = window.setInterval(() => {
                setUploadItems((prev) =>
                    prev.map((item) =>
                        item.localId === localId && item.status === "uploading"
                            ? {
                                ...item,
                                progress: Math.min(item.progress + 14, 92),
                            }
                            : item
                    )
                );
            }, 220);

            try {
                const formData = new FormData();
                formData.append("token", application.token);
                formData.append("category", portalCategory);
                formData.append("files", file);

                const response = await fetch("/api/upload", {
                    method: "POST",
                    body: formData,
                });
                const result = await response.json();

                if (!response.ok) {
                    throw new Error(result?.error ?? "Upload failed.");
                }

                const uploaded = result.uploaded?.[0] as UploadedFile | undefined;
                if (!uploaded) {
                    throw new Error("Unexpected upload response.");
                }

                setUploadItems((prev) =>
                    prev.map((item) =>
                        item.localId === localId
                            ? {
                                ...item,
                                progress: 100,
                                status: "uploaded",
                                uploadedFile: uploaded,
                            }
                            : item
                    )
                );
            } catch (error) {
                setUploadItems((prev) =>
                    prev.map((item) =>
                        item.localId === localId
                            ? {
                                ...item,
                                progress: 0,
                                status: "error",
                                error:
                                    error instanceof Error ? error.message : "Upload failed.",
                            }
                            : item
                    )
                );
            } finally {
                window.clearInterval(timer);
            }
        },
        [application.token]
    );

    const handleFiles = useCallback(
        async (portalCategory: PortalCategory, files: File[]) => {
            if (!files.length || portalComplete) return;
            const list = Array.from(files);
            setSubmitState(null);
            for (const file of list) {
                await uploadOneFile(portalCategory, file);
            }
        },
        [portalComplete, uploadOneFile]
    );

    const onInputChange =
        (portalCategory: PortalCategory) =>
            (event: ChangeEvent<HTMLInputElement>) => {
                const list = event.target.files;
                if (!list?.length) return;
                void handleFiles(portalCategory, Array.from(list));
                event.target.value = "";
            };

    const onDragOver = (e: DragEvent, key: PortalCategory) => {
        if (portalComplete) return;
        e.preventDefault();
        e.stopPropagation();
        setActiveDropKey(key);
    };

    const onDragLeave = (e: DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setActiveDropKey(null);
    };

    const onDrop = (e: DragEvent, portalCategory: PortalCategory) => {
        if (portalComplete) return;
        e.preventDefault();
        e.stopPropagation();
        setActiveDropKey(null);
        const files = Array.from(e.dataTransfer.files);
        if (files.length) void handleFiles(portalCategory, files);
    };

    const removeUploadedFile = async (file: UploadedFile) => {
        if (portalComplete) return;
        setSubmitState(null);
        const response = await fetch("/api/upload", {
            method: "DELETE",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify({ token: application.token, fileId: file.id }),
        });

        if (!response.ok) {
            const payload = await response.json();
            throw new Error(payload?.error ?? "Failed to remove file.");
        }

        setUploadItems((prev) =>
            prev.filter((item) => item.uploadedFile?.id !== file.id)
        );
    };

    const submitPortal = async () => {
        if (!uploadedFiles.length || isSubmitting || portalComplete) return;

        setIsSubmitting(true);
        setSubmitState(null);

        try {
            const response = await fetch("/api/submit", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({ token: application.token }),
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error ?? "Submission failed.");
            }

            setSubmitState({
                ok: true,
                message: "Thank you — your documents were submitted successfully.",
            });
            window.scrollTo({ top: 0, behavior: "smooth" });
        } catch (error) {
            setSubmitState({
                ok: false,
                message:
                    error instanceof Error ? error.message : "Submission failed.",
            });
        } finally {
            setIsSubmitting(false);
        }
    };

    const onSubmitClick = () => {
        if (!uploadedFiles.length || isSubmitting || portalComplete) return;
        setIsConfirmOpen(true);
    };

    const onConfirmSubmit = () => {
        setIsConfirmOpen(false);
        void submitPortal();
    };

    return (
        <div className="ui-page">
            <header className="sticky top-0 z-20 border-b border-slate-200/80 bg-white/90 backdrop-blur-md">
                <div className="ui-shell flex items-center justify-between gap-4 py-3">
                    <p className="ui-h3">
                        Document upload
                    </p>
                    <div className="flex items-center gap-2 ui-meta">
                        <span className="hidden sm:inline">Progress</span>
                        <span className="ui-chip tabular-nums">
                            {sectionsWithUploads} / {PORTAL_SECTIONS.length} sections
                        </span>
                    </div>
                </div>
                <div className="h-0.5 w-full bg-slate-100" aria-hidden>
                    <div
                        className="h-full bg-blue-700 transition-[width] duration-500 ease-out"
                        style={{
                            width: `${(sectionsWithUploads / PORTAL_SECTIONS.length) * 100}%`,
                        }}
                    />
                </div>
            </header>

            <main className="ui-shell pb-32 pt-8 sm:pt-12">
                {portalSubmittedInitially && !submitState?.ok ? (
                    <div
                        className="ui-card ui-body mb-8 px-5 py-4"
                        role="status"
                    >
                        You&apos;ve already submitted your documents for this link. Your
                        files stay on file with your broker — contact them if you need to
                        add or replace anything.
                    </div>
                ) : null}
                {submitState?.ok ? (
                    <div
                        className="ui-success mb-8 flex items-start gap-3 px-5 py-4"
                        role="status"
                    >
                        <CheckCircleIcon />
                        <div>
                            <p className="font-semibold">Documents submitted successfully</p>
                            <p className="mt-0.5 text-emerald-800/80">
                                Your broker has been notified and will review your documents.
                            </p>
                        </div>
                    </div>
                ) : null}

                <div className="mb-12 border-b border-slate-200/80 pb-10">
                    <h1 className="ui-title">
                        Hi {application.fullName},
                    </h1>
                    <p className="ui-body mt-3 max-w-2xl">
                        Upload your documents below. Each section is optional unless your
                        broker asked for it — add files where they apply to you.
                    </p>
                    <p className="ui-body mt-3">
                        {application.email}
                        <span className="mx-2 text-slate-300">·</span>
                        {application.applicationType}
                    </p>
                </div>

                <div className="flex flex-col gap-8 sm:gap-10">
                    {PORTAL_SECTIONS.map((section, index) => {
                        const items = uploadItems.filter(
                            (u) => u.portalCategory === section.key
                        );
                        const inputId = `file-${section.key}`;
                        const isActive = activeDropKey === section.key;

                        return (
                            <section
                                key={section.key}
                                id={`section-${section.key}`}
                                className="ui-card-soft scroll-mt-28 p-5 sm:p-6"
                            >
                                <div className="flex gap-4">
                                    <div
                                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-600 shadow-sm"
                                        aria-hidden
                                    >
                                        {index + 1}
                                    </div>
                                    <div className="min-w-0 flex-1 space-y-4">
                                        <div>
                                            <h2 className="ui-h2">
                                                {section.title}
                                            </h2>
                                            <p className="ui-body mt-2">
                                                {section.description}
                                            </p>
                                        </div>

                                        <label
                                            htmlFor={inputId}
                                            onDragOver={(e) => onDragOver(e, section.key)}
                                            onDragLeave={onDragLeave}
                                            onDrop={(e) => onDrop(e, section.key)}
                                            className={`group relative flex flex-col items-center justify-center rounded-xl border-2 border-dashed px-5 py-10 transition-all duration-200 ${portalComplete
                                                ? "cursor-not-allowed border-slate-200 bg-slate-50/80 opacity-60"
                                                : `cursor-pointer ${isActive
                                                    ? "border-blue-700 bg-white shadow-[0_0_0_4px_rgba(29,78,216,0.12)]"
                                                    : "border-slate-300/90 bg-white hover:border-blue-700 hover:bg-slate-50"
                                                }`
                                                }`}
                                        >
                                            <input
                                                id={inputId}
                                                type="file"
                                                multiple
                                                accept={ACCEPT}
                                                className="sr-only"
                                                onChange={onInputChange(section.key)}
                                                disabled={portalComplete}
                                            />
                                            <div className="rounded-full bg-slate-100 p-3 text-slate-500 transition-all duration-200 group-hover:bg-blue-50 group-hover:text-blue-700">
                                                <UploadCloudIcon />
                                            </div>
                                            <p className="mt-4 text-center text-sm font-medium text-slate-800">
                                                Drop files here, or{" "}
                                                <span className="text-blue-700 underline decoration-blue-300 underline-offset-2 transition-all duration-200 group-hover:decoration-blue-700">
                                                    browse
                                                </span>
                                            </p>
                                            <p className="ui-meta mt-1.5 text-center">
                                                PDF, JPG, PNG, Word · up to 10MB each
                                            </p>
                                        </label>

                                        {items.length > 0 ? (
                                            <ul className="space-y-2">
                                                {items.map((item) => (
                                                    <li
                                                        key={item.localId}
                                                        className="ui-card overflow-hidden"
                                                    >
                                                        <div className="flex items-start justify-between gap-3 px-4 py-3">
                                                            <div className="min-w-0 flex-1">
                                                                <p className="truncate text-sm font-medium text-slate-900">
                                                                    {item.fileName}
                                                                </p>
                                                            </div>
                                                            {item.status === "uploaded" &&
                                                                item.uploadedFile &&
                                                                !portalComplete ? (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => {
                                                                        void removeUploadedFile(item.uploadedFile as UploadedFile);
                                                                    }}
                                                                    className="rounded-md bg-red-50 px-2.5 py-1 text-xs font-medium text-red-600 transition-all duration-200 hover:bg-red-100 hover:text-red-700"
                                                                >
                                                                    Remove
                                                                </button>
                                                            ) : null}
                                                        </div>
                                                        <div className="px-4 pb-1.5">
                                                            <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                                                                <div
                                                                    className={`h-full rounded-full transition-all duration-500 ${item.status === "error" ? "bg-red-500" : "bg-blue-600"
                                                                        }`}
                                                                    style={{ width: `${item.progress}%` }}
                                                                />
                                                            </div>
                                                        </div>
                                                        <p className="ui-meta px-4 pt-1 pb-2">
                                                            {item.status === "uploaded"
                                                                ? "Uploaded"
                                                                : item.status === "error"
                                                                    ? item.error
                                                                    : `Uploading… ${item.progress}%`}
                                                        </p>
                                                    </li>
                                                ))}
                                            </ul>
                                        ) : null}
                                    </div>
                                </div>
                            </section>
                        );
                    })}
                </div>

                <div className="mt-14 border-t border-slate-200/80 pt-8">
                    <button
                        onClick={onSubmitClick}
                        type="button"
                        disabled={
                            !uploadedFiles.length ||
                            isSubmitting ||
                            portalComplete
                        }
                        className="ui-btn-primary w-full py-3 px-5 cursor-pointer"
                    >
                        {isSubmitting
                            ? "Submitting…"
                            : portalSubmittedInitially || submitState?.ok
                                ? "Submitted"
                                : "Submit documents"}
                    </button>

                    {submitState && !submitState.ok ? (
                        <p
                            className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900"
                            role="alert"
                        >
                            {submitState.message}
                        </p>
                    ) : null}
                </div>
            </main>

            {isConfirmOpen ? (
                <div className="ui-modal-backdrop">
                    <div className="ui-modal">
                        <h3 className="ui-h2">
                            Confirm final submission
                        </h3>
                        <p className="ui-body mt-3">
                            Once submitted, you will not be able to edit, remove, or upload
                            additional documents from this link.
                        </p>
                        <p className="ui-body mt-2">
                            Please confirm you are ready to submit all uploaded files.
                        </p>
                        <div className="mt-6 flex justify-end gap-2">
                            <button
                                type="button"
                                onClick={() => setIsConfirmOpen(false)}
                                className="ui-btn-secondary"
                            >
                                Cancel
                            </button>
                            <button
                                type="button"
                                onClick={onConfirmSubmit}
                                className="ui-btn-primary ui-btn-sm"
                            >
                                Confirm and submit
                            </button>
                        </div>
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function UploadCloudIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden
        >
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" x2="12" y1="3" y2="15" />
        </svg>
    );
}

function CheckCircleIcon() {
    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="mt-0.5 shrink-0"
            aria-hidden
        >
            <circle cx="12" cy="12" r="10" />
            <path d="m9 12 2 2 4-4" />
        </svg>
    );
}
