import { FormEvent, useEffect, useMemo, useState } from "react";
import {
  Cloud, Download, Folder, Search, RefreshCw, HardDrive, Plus, Moon, Sun,
  History, Activity, SlidersHorizontal, ExternalLink, Users, Database,
  ChevronRight, File, FileArchive, Film, Music, FileText, CheckCircle2,
  AlertTriangle, X, Link2, Loader2, Trash2, Copy, Check, Layers
} from "lucide-react";

type Result = {
  title: string;
  size: number;
  seeders: number;
  leechers: number;
  magnetUrl: string;
  infoUrl?: string;
  sourceUrl?: string;
  infoHash?: string;
  guid?: string;
  indexer?: string;
  protocol?: string;
  publishDate?: string;
};

type SeedrFile = {
  id: string;
  name: string;
  size: number;
  folderId: string;
  folderPath: string;
  url?: string | null;
};

type ActivityItem = {
  id: number;
  time: number;
  text: string;
  kind: "search" | "download" | "system";
};

const bytes = (value: number) => {
  if (!value) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const index = Math.min(4, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
};

const formatDate = (value?: string) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const text = await response.text();
  let data: any;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) throw new Error(data?.detail || data?.error || text || response.statusText);
  return data;
}

function fileIcon(name: string) {
  const lower = name.toLowerCase();
  if (/\.(mp4|mkv|m4v|webm|mov|avi|m3u8|ts)$/.test(lower)) return <Film className="icon video" />;
  if (/\.(mp3|wav|flac|aac|ogg|m4a|opus)$/.test(lower)) return <Music className="icon audio" />;
  if (/\.(zip|rar|7z|tar|gz|bz2|iso)$/.test(lower)) return <FileArchive className="icon archive" />;
  if (/\.(pdf|txt|md|json|csv|srt|vtt|ass|sub)$/.test(lower)) return <FileText className="icon document" />;
  return <File className="icon" />;
}

export default function App() {
  const [activeTab, setActiveTab] = useState<"search" | "transfers" | "files" | "activity" | "storage">("search");
  const [theme, setTheme] = useState<"dark" | "dim" | "light">("dark");
  const [query, setQuery] = useState("The Last of Us");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [quota, setQuota] = useState<any>(null);
  const [tasks, setTasks] = useState<any[]>([]);
  const [task, setTask] = useState<any>(null);
  const [files, setFiles] = useState<SeedrFile[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [minSeeders, setMinSeeders] = useState(0);
  const [sortBy, setSortBy] = useState<"seeds" | "size" | "time">("seeds");
  const [sortDirection, setSortDirection] = useState<"desc" | "asc">("desc");
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      const value = JSON.parse(localStorage.getItem("seedflow_recent_searches") || "[]");
      return Array.isArray(value) ? value.slice(0, 7) : [];
    } catch { return []; }
  });
  const [showRecent, setShowRecent] = useState(false);
  const [magnetModal, setMagnetModal] = useState(false);
  const [magnet, setMagnet] = useState("");
  const [adding, setAdding] = useState(false);
  const [copied, setCopied] = useState(false);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);

  const addActivity = (text: string, kind: ActivityItem["kind"]) => {
    setActivity(prev => [{ id: Date.now(), time: Date.now(), text, kind }, ...prev].slice(0, 100));
  };

  const loadSeedr = async () => {
    try {
      const [q, t, f] = await Promise.all([
        request<any>("/api/seedr/quota"),
        request<any>("/api/seedr/tasks"),
        request<any>("/api/seedr/files")
      ]);
      setQuota(q);
      const list = Array.isArray(t?.tasks) ? t.tasks : [];
      setTasks(list);
      setTask(list[0] || null);
      setFiles(Array.isArray(f?.files) ? f.files : []);
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    void loadSeedr();
  }, []);

  useEffect(() => {
    if (!task?.id) return;
    const timer = window.setInterval(async () => {
      try {
        const current = await request<any>(`/api/seedr/tasks/${encodeURIComponent(task.id)}`);
        setTask(current.task);
        if (current.status === "completed") {
          addActivity(`Seedr completed: ${current.task?.title || current.task?.name || "download"}`, "download");
          await loadSeedr();
        }
      } catch {}
    }, 3000);
    return () => window.clearInterval(timer);
  }, [task?.id]);

  const saveRecent = (value: string) => {
    const next = [value, ...recentSearches.filter(x => x.toLowerCase() !== value.toLowerCase())].slice(0, 7);
    setRecentSearches(next);
    try { localStorage.setItem("seedflow_recent_searches", JSON.stringify(next)); } catch {}
  };

  const search = async (event?: FormEvent) => {
    event?.preventDefault();
    const value = query.trim();
    if (value.length < 2) {
      setError("Enter at least 2 characters to search.");
      return;
    }
    setLoading(true);
    setError("");
    setShowRecent(false);
    try {
      const data = await request<Result[]>(`/api/search?q=${encodeURIComponent(value)}&limit=20`);
      setResults(data);
      setSearched(true);
      saveRecent(value);
      addActivity(`Searched for “${value}” — ${data.length} results`, "search");
      if (!data.length) setError("No torrent results were returned.");
    } catch (err: any) {
      setResults([]);
      setSearched(true);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const addToSeedr = async (result: Result) => {
    setError("");
    try {
      setAdding(true);
      const created = await request<any>("/api/seedr/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: result.magnetUrl, size: result.size })
      });
      setTask(created);
      addActivity(`Added to Seedr: ${result.title}`, "download");
      setActiveTab("transfers");
      await loadSeedr();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const addMagnet = async () => {
    if (!magnet.trim()) return;
    try {
      setAdding(true);
      const created = await request<any>("/api/seedr/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ magnet: magnet.trim() })
      });
      setTask(created);
      addActivity("Added a magnet link to Seedr", "download");
      setMagnet("");
      setMagnetModal(false);
      setActiveTab("transfers");
      await loadSeedr();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setAdding(false);
    }
  };

  const filteredResults = useMemo(() => {
    const list = results.filter(r => Number(r.seeders) >= minSeeders);
    list.sort((a, b) => {
      const av = sortBy === "seeds" ? a.seeders : sortBy === "size" ? a.size : new Date(a.publishDate || 0).getTime();
      const bv = sortBy === "seeds" ? b.seeders : sortBy === "size" ? b.size : new Date(b.publishDate || 0).getTime();
      return sortDirection === "desc" ? bv - av : av - bv;
    });
    return list;
  }, [results, minSeeders, sortBy, sortDirection]);

  const folders = useMemo(() => {
    const map = new Map<string, { id: string; name: string; path: string; files: SeedrFile[] }>();
    for (const file of files) {
      const id = file.folderId || "__root__";
      const path = file.folderPath || "/";
      const name = path.split("/").filter(Boolean).pop() || "Root Files";
      if (!map.has(id)) map.set(id, { id, name, path, files: [] });
      map.get(id)!.files.push(file);
    }
    return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [files]);

  const currentFolder = selectedFolder ? folders.find(f => f.id === selectedFolder) : null;

  const cancelTask = async (id: string | number) => {
    try {
      await request(`/api/seedr/tasks/${encodeURIComponent(String(id))}`, { method: "DELETE" });
      addActivity("Cancelled Seedr task", "system");
      setTask(null);
      await loadSeedr();
    } catch (err: any) {
      setError(err.message);
    }
  };

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><Cloud size={20} fill="currentColor" /></div>
          <div>
            <div className="brand-row">
              <h1>SeedFlow</h1>
              <span className="badge">SEEDR</span>
            </div>
            <p>Cloud Torrent & Media Streaming</p>
          </div>
        </div>

        <div className="top-stats">
          {quota && (
            <button className="stat-pill" onClick={() => setActiveTab("storage")}>
              <HardDrive size={14} />
              <span>{bytes(quota.usedSpace)} / {bytes(quota.maxSpace)}</span>
              <strong>{bytes(quota.remainingSpace)} free</strong>
            </button>
          )}
        </div>

        <div className="top-actions">
          <button className="primary" onClick={() => setMagnetModal(true)}><Plus size={16} /> <span>Add Magnet</span></button>
          <button className="icon-btn" onClick={() => setTheme(theme === "dark" ? "dim" : theme === "dim" ? "light" : "dark")} title="Theme">
            {theme === "light" ? <Sun size={17} /> : <Moon size={17} />}
          </button>
        </div>
      </header>

      <nav className="desktop-nav">
        {([
          ["search", Search, "Search"],
          ["transfers", Download, "Transfers & Seedbox"],
          ["files", Folder, `My Cloud Files (${files.length})`],
          ["activity", History, "Activity Log"],
          ["storage", HardDrive, "Storage & Quota"]
        ] as const).map(([id, Icon, label]) => (
          <button key={id} onClick={() => setActiveTab(id as any)} className={activeTab === id ? "active" : ""}>
            <Icon size={15} /> {label}
            {id === "transfers" && task && <span className="nav-count">1</span>}
          </button>
        ))}
      </nav>

      <main className="content">
        {error && (
          <div className="alert error">
            <AlertTriangle size={16} />
            <span>{error}</span>
            <button className="alert-close" onClick={() => setError("")}><X size={15} /></button>
          </div>
        )}

        {activeTab === "search" && (
          <section className="space">
            <div className="panel search-panel">
              <div className="section-heading">
                <div>
                  <h2><Search size={19} /> Search Torrents</h2>
                  <p>Search 1337x directly and send a result to your Seedr cloud.</p>
                </div>
              </div>
              <form onSubmit={search} className="search-form">
                <div className="search-input-wrap">
                  <Search size={16} />
                  <input
                    value={query}
                    onFocus={() => { if (!searched && recentSearches.length) setShowRecent(true); }}
                    onChange={e => { setQuery(e.target.value); setError(""); if (!searched && recentSearches.length) setShowRecent(true); }}
                    placeholder="Search movies, TV, music, software..."
                  />
                  {showRecent && !searched && recentSearches.length > 0 && (
                    <div className="recent-menu">
                      <div className="recent-title">Recent Searches</div>
                      {recentSearches.map((item, i) => (
                        <button key={item} type="button" onMouseDown={e => e.preventDefault()} onClick={() => { setQuery(item); setShowRecent(false); setSearched(false); window.setTimeout(() => void search(), 0); }}>
                          <span>{i + 1}</span>{item}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <button className="primary search-btn" disabled={loading}>
                  {loading ? <><Loader2 size={16} className="spin" /> Searching…</> : <><Search size={16} /> Search</>}
                </button>
              </form>
            </div>

            {results.length > 0 && (
              <div className="result-toolbar">
                <span>{filteredResults.length} of {results.length} results</span>
                <div>
                  <select value={minSeeders} onChange={e => setMinSeeders(Number(e.target.value))}>
                    <option value={0}>All seeders</option><option value={1}>1+ seeders</option><option value={5}>5+ seeders</option><option value={10}>10+ seeders</option><option value={50}>50+ seeders</option>
                  </select>
                  <select value={sortBy} onChange={e => setSortBy(e.target.value as any)}>
                    <option value="seeds">Seeds</option><option value="size">Size</option><option value="time">Time</option>
                  </select>
                  <select value={sortDirection} onChange={e => setSortDirection(e.target.value as any)}>
                    <option value="desc">Descending</option><option value="asc">Ascending</option>
                  </select>
                  <SlidersHorizontal size={15} />
                </div>
              </div>
            )}

            <div className="results">
              {filteredResults.map((result, index) => (
                <article className="result-card" key={result.guid || result.magnetUrl || index}>
                  <div className="result-main">
                    <div className="result-icon"><Database size={17} /></div>
                    <div className="result-info">
                      <h3>{result.title}</h3>
                      <div className="submeta">
                        <span>{result.indexer || "1337x"}</span>
                        {result.publishDate && <span>{formatDate(result.publishDate)}</span>}
                        {result.protocol && <span>{result.protocol}</span>}
                        {result.infoHash && <span className="hash">{result.infoHash}</span>}
                      </div>
                      <div className="metrics">
                        <span>{bytes(result.size)}</span>
                        <span className="seed"><Users size={13} /> {result.seeders} seeders</span>
                        <span>{result.leechers} leechers</span>
                      </div>
                    </div>
                  </div>
                  <div className="result-actions">
                    {result.infoUrl && <a href={result.infoUrl} target="_blank" rel="noreferrer" className="icon-btn" title="Source"><ExternalLink size={15} /></a>}
                    <button className="primary" disabled={adding} onClick={() => void addToSeedr(result)}><Download size={15} /> Send to Seedr</button>
                  </div>
                </article>
              ))}
              {!loading && searched && !filteredResults.length && !error && (
                <div className="empty"><Search size={38} /><strong>No results</strong><span>Try a broader query or lower the seeder filter.</span></div>
              )}
            </div>
          </section>
        )}

        {activeTab === "transfers" && (
          <section className="space">
            <div className="panel section-header">
              <div><h2><Download size={19} /> Ongoing Downloads & Active Tasks</h2><p>Track Seedr cloud downloads with live progress.</p></div>
              <button className="primary" onClick={() => setMagnetModal(true)}><Plus size={15} /> Add Magnet</button>
            </div>
            {task ? (
              <div className="task-card">
                <div className="task-head">
                  <div><div className="status-line"><Cloud size={15} /> <span>Downloading with Seedr</span><b>{task.state || "processing"}</b></div><h3>{task.title || task.name || "Seedr download"}</h3></div>
                  <button className="danger" onClick={() => void cancelTask(task.id)}><X size={14} /> Cancel</button>
                </div>
                <div className="progress-row"><span>Seedr progress</span><strong>{Number(task.progress || 0).toFixed(1)}%</strong></div>
                <div className="progress"><div style={{width: `${Math.max(0, Math.min(100, Number(task.progress || 0)))}%`}} /></div>
                <div className="task-meta"><span>Task {task.id ?? "created"}</span><span>{task.size ? bytes(Number(task.size)) : "Cloud task"}</span></div>
              </div>
            ) : (
              <div className="empty"><Download size={38} /><strong>No active Seedr downloads</strong><span>Start a torrent from Search or Add Magnet.</span></div>
            )}
            {tasks.length > 0 && (
              <div className="panel task-list"><h3>Recent Seedr Tasks</h3>{tasks.map((item, i) => <div className="task-row" key={item.id || i}><span>{item.title || item.name || `Task ${item.id}`}</span><span>{item.state || item.status || "processing"}</span><span>{item.progress ?? 0}%</span></div>)}</div>
            )}
          </section>
        )}

        {activeTab === "files" && (
          <section className="space">
            <div className="panel library-header">
              <div>
                <div className="section-heading"><div><h2><Cloud size={19} /> Seedr Library</h2><p>Completed files stored in your Seedr cloud.</p></div></div>
                {quota && <div className="quota-grid"><div><small>Consumed</small><strong>{bytes(quota.usedSpace)}</strong></div><div><small>Remaining</small><strong className="green">{bytes(quota.remainingSpace)}</strong></div><div><small>Total</small><strong>{bytes(quota.maxSpace)}</strong></div></div>}
              </div>
              <button className="secondary" onClick={() => void loadSeedr()} disabled={filesLoading}><RefreshCw size={14} className={filesLoading ? "spin" : ""} /> Refresh Seedr</button>
            </div>

            {currentFolder ? (
              <div className="panel">
                <div className="folder-toolbar"><button className="secondary" onClick={() => setSelectedFolder(null)}><ChevronRight size={14} className="back-icon" /> Back to folders</button><div><strong>{currentFolder.name}</strong><small>{currentFolder.files.length} files · {bytes(currentFolder.files.reduce((s, f) => s + f.size, 0))}</small></div></div>
                <div className="file-list">{currentFolder.files.map(file => <div className="file-row" key={file.id}><div className="file-name">{fileIcon(file.name)}<div><strong>{file.name}</strong><small>{bytes(file.size)}</small></div></div>{file.url ? <a className="secondary" href={file.url} target="_blank" rel="noreferrer"><Download size={14} /> Download</a> : <span className="muted">Cloud file</span>}</div>)}</div>
              </div>
            ) : folders.length ? (
              <div className="folder-grid">{folders.map(folder => {
                const single = folder.files.length === 1;
                return <button className="folder-card" key={folder.id} onClick={() => setSelectedFolder(folder.id)}>
                  <div className="folder-icon">{single ? fileIcon(folder.files[0].name) : <Folder size={21} />}</div>
                  <div><strong>{single ? folder.files[0].name : folder.name}</strong><small>{folder.files.length} file{folder.files.length === 1 ? "" : "s"} · {bytes(folder.files.reduce((s, f) => s + f.size, 0))}</small></div>
                  <ChevronRight size={16} />
                </button>;
              })}</div>
            ) : (
              <div className="empty"><Folder size={38} /><strong>No completed files yet</strong><span>Seedr files will appear here after a download completes.</span></div>
            )}
          </section>
        )}

        {activeTab === "activity" && (
          <section className="space">
            <div className="panel section-header"><div><h2><History size={19} /> Activity Log</h2><p>Recent activity from this SeedFlow session.</p></div><button className="secondary" onClick={() => setActivity([])}><Trash2 size={14} /> Clear</button></div>
            {activity.length ? <div className="panel activity-list">{activity.map(item => <div className="activity-row" key={item.id}><div className={`activity-icon ${item.kind}`}>{item.kind === "search" ? <Search size={14} /> : item.kind === "download" ? <Download size={14} /> : <Activity size={14} />}</div><div><strong>{item.text}</strong><small>{new Date(item.time).toLocaleString()}</small></div></div>)}</div> : <div className="empty"><History size={38} /><strong>No activity yet</strong><span>Your searches and Seedr actions will appear here.</span></div>}
          </section>
        )}

        {activeTab === "storage" && (
          <section className="space">
            <div className="panel section-header"><div><h2><HardDrive size={19} /> Seedr Storage & Quota</h2><p>Your Seedr account storage, rather than local Render disk, controls available cloud space.</p></div><button className="secondary" onClick={() => void loadSeedr()}><RefreshCw size={14} /> Refresh</button></div>
            {quota ? <><div className="quota-cards"><div className="quota-card"><small>Used Storage</small><strong>{bytes(quota.usedSpace)}</strong><span>{Math.round((quota.usedSpace / quota.maxSpace) * 100)}% used</span></div><div className="quota-card"><small>Available Free Space</small><strong className="green">{bytes(quota.remainingSpace)}</strong><span>Ready for the next Seedr task</span></div><div className="quota-card"><small>Total Seedr Storage</small><strong>{bytes(quota.maxSpace)}</strong><span>Free account quota</span></div></div><div className="panel quota-progress"><div className="progress-row"><span>Storage utilization</span><strong>{Math.round((quota.usedSpace / quota.maxSpace) * 100)}%</strong></div><div className="progress"><div style={{width: `${Math.min(100, quota.usedSpace / quota.maxSpace * 100)}%`}} /></div></div></> : <div className="empty"><HardDrive size={38} /><strong>Quota unavailable</strong><span>Refresh to query Seedr.</span></div>}
          </section>
        )}
      </main>

      <button className="mobile-fab" onClick={() => setMagnetModal(true)}><Plus size={23} /></button>
      <nav className="mobile-nav">
        <button className={activeTab === "search" ? "active" : ""} onClick={() => setActiveTab("search")}><Search size={19} /><span>Search</span></button>
        <button className={activeTab === "transfers" ? "active" : ""} onClick={() => setActiveTab("transfers")}><Download size={19} /><span>Transfers</span>{task && <i>1</i>}</button>
        <button className={activeTab === "files" ? "active" : ""} onClick={() => setActiveTab("files")}><Folder size={19} /><span>Files</span></button>
        <button className={activeTab === "activity" ? "active" : ""} onClick={() => setActiveTab("activity")}><Layers size={19} /><span>More</span></button>
      </nav>

      {magnetModal && (
        <div className="modal-backdrop" onClick={() => !adding && setMagnetModal(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-head"><div><h2><Link2 size={18} /> Add Magnet</h2><p>Add a magnet directly to your Seedr cloud.</p></div><button className="icon-btn" onClick={() => setMagnetModal(false)} disabled={adding}><X size={17} /></button></div>
            <textarea value={magnet} onChange={e => setMagnet(e.target.value)} placeholder="magnet:?xt=urn:btih:..." />
            <div className="modal-note"><CheckCircle2 size={15} /> The torrent will be added to your configured Seedr library folder.</div>
            <div className="modal-actions"><button className="secondary" onClick={() => setMagnetModal(false)}>Cancel</button><button className="primary" onClick={() => void addMagnet()} disabled={!magnet.trim() || adding}>{adding ? <><Loader2 size={15} className="spin" /> Adding…</> : <><Plus size={15} /> Add to Seedr</>}</button></div>
          </div>
        </div>
      )}

      <footer className="footer"><span>SeedFlow</span><span>1337x → Seedr</span><span>Render lightweight mode</span></footer>
    </div>
  );
}
