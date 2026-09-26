import { FormEvent, useEffect, useState } from "react";

type Result = {
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  magnetUrl: string;
  infoUrl?: string;
  guid?: string;
};

const bytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();

  let data: any;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!response.ok) {
    throw new Error(data?.detail || data?.error || text || response.statusText);
  }

  return data;
}

export default function App() {
  const [query, setQuery] = useState("The Last of Us");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [quota, setQuota] = useState<any>(null);
  const [task, setTask] = useState<any>(null);
  const [files, setFiles] = useState<any[]>([]);
  const [error, setError] = useState("");

  const loadSeedr = async () => {
    try {
      const q = await request<any>("/api/seedr/quota");
      const f = await request<any>("/api/seedr/files");
      const t = await request<any>("/api/seedr/tasks");

      setQuota(q);
      setFiles(f?.files || []);
      if (t?.tasks?.length) setTask(t.tasks[0]);
    } catch (err: any) {
      setError(err.message);
    }
  };

  const search = async () => {
    if (!query.trim()) return;

    setLoading(true);
    setError("");

    try {
      setResults(
        await request<Result[]>(
          `/api/search?q=${encodeURIComponent(query.trim())}&limit=20`,
        ),
      );
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadSeedr();
  }, []);

  useEffect(() => {
    if (!task?.id) return;

    const timer = window.setInterval(async () => {
      try {
        const current = await request<any>(
          `/api/seedr/tasks/${encodeURIComponent(task.id)}`,
        );
        setTask(current.task);

        if (current.status === "completed") {
          window.clearInterval(timer);
          void loadSeedr();
        }
      } catch {
        // Ignore transient polling errors.
      }
    }, 3000);

    return () => window.clearInterval(timer);
  }, [task?.id]);

  const add = async (result: Result) => {
    setError("");

    try {
      const created = await request<any>("/api/seedr/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          magnet: result.magnetUrl,
          size: result.size,
        }),
      });

      setTask(created);
      await loadSeedr();
    } catch (err: any) {
      setError(err.message);
    }
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    void search();
  };

  return (
    <main className="shell">
      <header className="header">
        <div>
          <h1>SeedFlow</h1>
          <p>Lightweight 1337x → Seedr</p>
        </div>

        {quota && (
          <div className="quota">
            <strong>{bytes(quota.remainingSpace)} free</strong>
            <span>
              {bytes(quota.usedSpace)} / {bytes(quota.maxSpace)}
            </span>
          </div>
        )}
      </header>

      <form className="search" onSubmit={submit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search torrents"
        />
        <button disabled={loading}>
          {loading ? "Searching…" : "Search"}
        </button>
      </form>

      {error && <div className="error">{error}</div>}

      {task && (
        <section className="panel">
          <div className="row">
            <strong>{task.title || "Seedr download"}</strong>
            <span>{task.progress ?? 0}%</span>
          </div>
          <div className="progress">
            <div style={{ width: `${task.progress ?? 0}%` }} />
          </div>
          <small>{task.state || "processing"}</small>
        </section>
      )}

      <section className="results">
        {results.map((result) => (
          <article className="card" key={result.guid || result.magnetUrl}>
            <h2>{result.title}</h2>
            <p className="meta">
              {bytes(result.size)} · ↑ {result.seeders} · ↓ {result.leechers}
            </p>

            <div className="actions">
              <button onClick={() => void add(result)}>
                Send to Seedr
              </button>

              {result.infoUrl && (
                <a href={result.infoUrl} target="_blank" rel="noreferrer">
                  Source
                </a>
              )}
            </div>
          </article>
        ))}
      </section>

      <section className="panel">
        <h2>My Cloud Files</h2>

        {files.length ? (
          <div className="file-list">
            {files.map((file: any) => (
              <div className="file" key={file.id}>
                <span>{file.name}</span>
                <span>{bytes(file.size)}</span>
              </div>
            ))}
          </div>
        ) : (
          <p className="muted">No files yet.</p>
        )}
      </section>
    </main>
  );
}
