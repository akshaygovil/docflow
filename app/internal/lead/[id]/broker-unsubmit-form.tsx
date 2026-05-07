"use client";

import { useActionState, useRef, useState } from "react";
import { type UnsubmitState, unsubmitLeadAction } from "./actions";

export function BrokerUnsubmitForm({
  leadId,
  portalSubmitted,
}: {
  leadId: string;
  portalSubmitted: boolean;
}) {
  const [state, formAction, pending] = useActionState(
    unsubmitLeadAction.bind(null, leadId),
    null as UnsubmitState | null
  );
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const formRef = useRef<HTMLFormElement | null>(null);

  if (!portalSubmitted) {
    return (
      <p className="ui-body">
        The prospect has not submitted through the document portal yet.
      </p>
    );
  }

  return (
    <div className="ui-card-soft p-5">
      <h3 className="ui-h3">
        Reopen for edits
      </h3>
      <p className="mt-2 ui-body">
        If the prospect needs to add or replace documents after submitting, use
        this to clear the portal submission. They will be able to upload and
        remove files again until they submit once more.
      </p>
      <form ref={formRef} action={formAction} className="mt-4">
        <button
          type="button"
          disabled={pending}
          onClick={() => setIsConfirmOpen(true)}
          className="ui-btn-primary py-3 px-5 disabled:opacity-60"
        >
          {pending ? "Updating…" : "Allow prospect to edit and resubmit"}
        </button>
      </form>
      {state?.ok ? (
        <p className="mt-3 text-sm font-medium text-green-800" role="status">
          Portal submission cleared. The prospect can edit documents again.
        </p>
      ) : null}
      {state?.error ? (
        <p className="mt-3 text-sm text-red-800" role="alert">
          {state.error}
        </p>
      ) : null}

      {isConfirmOpen ? (
        <div className="ui-modal-backdrop">
          <div className="ui-modal">
            <h3 className="ui-h2">
              Allow edits and resubmission?
            </h3>
            <p className="ui-body mt-3">
              This will reopen the document portal for this prospect. They will
              be able to upload, remove, and resubmit documents again using the
              existing upload link.
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
                onClick={() => {
                  setIsConfirmOpen(false);
                  formRef.current?.requestSubmit();
                }}
                className="ui-btn-primary ui-btn-sm"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
