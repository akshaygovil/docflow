export default function Home() {
  return (
    <div className="ui-page flex items-center justify-center px-4">
      <main className="ui-card w-full max-w-2xl p-8">
        <h1 className="ui-h2">DocFlow Upload Portal</h1>
        <p className="ui-body mt-3">
          This portal is accessed via secure tokenized links. Open your personalized
          upload URL in the format:
        </p>
        <p className="mt-4 rounded-lg bg-slate-50 p-3 font-mono text-sm text-slate-700">
          /upload/&lt;token&gt;
        </p>
      </main>
    </div>
  );
}
