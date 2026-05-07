export default function UploadTokenNotFound() {
  return (
    <div className="ui-page flex items-center justify-center px-4">
      <div className="ui-card w-full max-w-lg p-8 text-center">
        <h1 className="ui-h2">Invalid Upload Link</h1>
        <p className="ui-body mt-3">
          This link is invalid or has expired. Please contact your mortgage broker for a
          new secure upload link.
        </p>
      </div>
    </div>
  );
}
