import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";

type Tab = "sessions" | "queue" | "downloads" | "settings";
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";

interface Job {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  outputFile: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

interface Settings {
  credentialsConfigured: boolean;
  encryptionReady: boolean;
  port: number;
}

const navigation: Array<{ id: Tab; label: string; marker: string }> = [
  { id: "sessions", label: "Sessions", marker: "01" },
  { id: "queue", label: "Queue", marker: "02" },
  { id: "downloads", label: "Downloads", marker: "03" },
  { id: "settings", label: "Settings", marker: "04" }
];

async function api<T>(url: string, options?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers }
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({ error: "Request failed" })) as { error?: string };
    throw new Error(body.error || `Request failed (${response.status})`);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

function sessionName(url: string): string {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "F1 TV session";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return "F1 TV session";
  }
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function Notice({ tone = "neutral", children }: { tone?: "neutral" | "error" | "success"; children: React.ReactNode }) {
  return <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

function SessionPanel({ configured, onQueued, onOpenSettings }: {
  configured: boolean;
  onQueued: (job: Job) => void;
  onOpenSettings: () => void;
}) {
  const [url, setUrl] = useState("");
  const [quality, setQuality] = useState("best");
  const [audio, setAudio] = useState("eng");
  const [channel, setChannel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { job } = await api<{ job: Job }>("/api/jobs", {
        method: "POST",
        body: JSON.stringify({ url, quality, audio, ...(channel.trim() ? { channel: channel.trim() } : {}) })
      });
      setUrl("");
      setChannel("");
      onQueued(job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not queue the session");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel session-panel">
      <div className="eyebrow">Direct session</div>
      <h2>Send a race to your tablet.</h2>
      <p className="lede">Paste an F1 TV replay URL. The server handles the download and keeps the finished MP4 ready for this device.</p>

      {!configured && (
        <Notice tone="neutral">
          <span>F1 TV credentials are not configured yet.</span>
          <button className="link-button" onClick={onOpenSettings}>Open settings</button>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}

      <form className="session-form" onSubmit={submit}>
        <label className="field field--wide">
          <span>Session URL</span>
          <input
            type="url"
            inputMode="url"
            value={url}
            onChange={(event) => setUrl(event.target.value)}
            placeholder="https://f1tv.formula1.com/detail/..."
            required
          />
        </label>
        <div className="field-row">
          <label className="field">
            <span>Quality</span>
            <select value={quality} onChange={(event) => setQuality(event.target.value)}>
              <option value="best">Best available</option>
              <option value="1920x1080">1080p</option>
              <option value="1280x720">720p</option>
              <option value="854x480">480p</option>
            </select>
          </label>
          <label className="field">
            <span>Audio</span>
            <select value={audio} onChange={(event) => setAudio(event.target.value)}>
              <option value="eng">English</option>
              <option value="nld">Dutch</option>
              <option value="deu">German</option>
              <option value="fra">French</option>
              <option value="por">Portuguese</option>
              <option value="spa">Spanish</option>
            </select>
          </label>
        </div>
        <label className="field field--wide">
          <span>Feed <small>optional</small></span>
          <input value={channel} onChange={(event) => setChannel(event.target.value)} placeholder="F1 LIVE, INTERNATIONAL, driver name…" />
        </label>
        <button className="primary-button" disabled={!configured || busy}>
          <span>{busy ? "Adding…" : "Add to queue"}</span>
          <span aria-hidden="true">→</span>
        </button>
      </form>

      <div className="catalog-note">
        <span className="catalog-note__number">NEXT</span>
        <div>
          <strong>Full session browser</strong>
          <p>Season, event, and session discovery will land through the same download adapter. Direct URLs remain the reliable fallback.</p>
        </div>
      </div>
    </section>
  );
}

function QueuePanel({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: string) => Promise<void> }) {
  const activeJobs = jobs.filter((job) => job.status !== "completed");
  return (
    <section className="panel">
      <div className="section-heading">
        <div>
          <div className="eyebrow">Download queue</div>
          <h2>One clean line.</h2>
        </div>
        <span className="count-chip">{activeJobs.length} jobs</span>
      </div>

      {activeJobs.length === 0 ? (
        <div className="empty-state"><span>00</span><p>No queued downloads. Add a session when you’re ready.</p></div>
      ) : (
        <div className="job-list">
          {activeJobs.map((job) => (
            <article className="job-card" key={job.id}>
              <div className="job-card__top">
                <div>
                  <span className={`status status--${job.status}`}>{job.status}</span>
                  <h3>{sessionName(job.url)}</h3>
                </div>
                <span className="job-time">{relativeTime(job.createdAt)}</span>
              </div>
              <div className="progress-track" aria-label={`${job.progress}% complete`}>
                <span style={{ width: `${job.progress}%` }} />
              </div>
              <div className="job-meta">
                <span>{job.quality === "best" ? "Best quality" : job.quality}</span>
                <span>{job.audio.toUpperCase()}</span>
                {job.channel && <span>{job.channel}</span>}
              </div>
              <div className="job-card__footer">
                <p>{job.message}</p>
                {(job.status === "queued" || job.status === "running") && (
                  <button className="quiet-button" onClick={() => void onCancel(job.id)}>Cancel</button>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function DownloadsPanel({ jobs }: { jobs: Job[] }) {
  const downloads = jobs.filter((job) => job.status === "completed" && job.outputFile);
  return (
    <section className="panel">
      <div className="section-heading">
        <div><div className="eyebrow">MP4 library</div><h2>Ready to watch.</h2></div>
        <span className="count-chip">{downloads.length} files</span>
      </div>
      {downloads.length === 0 ? (
        <div className="empty-state"><span>MP4</span><p>Completed sessions will appear here.</p></div>
      ) : (
        <div className="download-grid">
          {downloads.map((job) => (
            <article className="download-card" key={job.id}>
              <div className="download-card__flag" aria-hidden="true" />
              <div className="status status--completed">ready</div>
              <h3>{sessionName(job.url)}</h3>
              <p>{job.quality === "best" ? "Best available quality" : job.quality} · {job.audio.toUpperCase()}</p>
              <div className="download-actions">
                <a className="primary-button primary-button--small" href={`/api/downloads/${job.id}/file`}>Play</a>
                <a className="quiet-button" href={`/api/downloads/${job.id}/file?download=1`}>Save MP4</a>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

function SettingsPanel({ settings, onChanged }: { settings: Settings; onChanged: () => Promise<void> }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/api/settings/credentials", { method: "PUT", body: JSON.stringify({ username, password }) });
      setUsername(""); setPassword(""); setMessage("Credentials encrypted and saved.");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not save credentials");
    } finally { setBusy(false); }
  }

  async function remove() {
    if (!window.confirm("Remove the stored F1 TV credentials?")) return;
    setBusy(true); setError(""); setMessage("");
    try {
      await api("/api/settings/credentials", { method: "DELETE" });
      setMessage("Stored credentials removed.");
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not remove credentials");
    } finally { setBusy(false); }
  }

  return (
    <section className="panel settings-panel">
      <div className="eyebrow">Private configuration</div>
      <h2>F1 TV account.</h2>
      <p className="lede">Values are encrypted before they reach disk and are never returned to the browser. Saving replaces the previous account.</p>
      <div className="credential-state">
        <span className={`state-dot ${settings.credentialsConfigured ? "state-dot--ok" : ""}`} />
        <div><strong>{settings.credentialsConfigured ? "Credentials configured" : "No credentials stored"}</strong><small>Encryption {settings.encryptionReady ? "ready" : "not configured"}</small></div>
      </div>
      {message && <Notice tone="success">{message}</Notice>}
      {error && <Notice tone="error">{error}</Notice>}
      <form className="session-form" onSubmit={save}>
        <label className="field field--wide"><span>F1 TV username</span><input autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} required /></label>
        <label className="field field--wide"><span>F1 TV password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <div className="settings-actions">
          <button className="primary-button" disabled={busy || !settings.encryptionReady}>{busy ? "Saving…" : "Encrypt & save"}</button>
          {settings.credentialsConfigured && <button type="button" className="quiet-button quiet-button--danger" disabled={busy} onClick={() => void remove()}>Remove</button>}
        </div>
      </form>
    </section>
  );
}

export function App() {
  const [tab, setTab] = useState<Tab>("sessions");
  const [jobs, setJobs] = useState<Job[]>([]);
  const [settings, setSettings] = useState<Settings>({ credentialsConfigured: false, encryptionReady: false, port: 43729 });
  const [online, setOnline] = useState(true);

  const refreshSettings = useCallback(async () => {
    const next = await api<Settings>("/api/settings");
    setSettings(next);
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const response = await api<{ jobs: Job[] }>("/api/jobs");
      setJobs(response.jobs);
      setOnline(true);
    } catch { setOnline(false); }
  }, []);

  useEffect(() => {
    void refreshSettings().catch(() => setOnline(false));
    void refreshJobs();
    const interval = window.setInterval(() => void refreshJobs(), 1500);
    return () => window.clearInterval(interval);
  }, [refreshJobs, refreshSettings]);

  const activeCount = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "running").length, [jobs]);

  async function cancel(id: string) {
    await api(`/api/jobs/${id}/cancel`, { method: "POST" });
    await refreshJobs();
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => setTab("sessions")} aria-label="F1TV Downloads home">
          <span className="brand__mark">F1</span><span>DOWNLOADS</span>
        </button>
        <div className="runtime-state"><span className={`state-dot ${online ? "state-dot--ok" : ""}`} />{online ? "Harlem ready" : "Server offline"}</div>
      </header>

      <div className="workspace">
        <aside className="sidebar">
          <div className="sidebar__caption">CONTROL</div>
          <nav aria-label="Main navigation">
            {navigation.map((item) => (
              <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}>
                <span>{item.marker}</span>{item.label}
                {item.id === "queue" && activeCount > 0 && <b>{activeCount}</b>}
              </button>
            ))}
          </nav>
          <div className="sidebar__foot">PORT {settings.port}<br />SINGLE WORKER</div>
        </aside>

        <main>
          <div className="page-intro">
            <p>F1TV / PRIVATE ARCHIVE</p>
            <h1>{tab === "sessions" ? "Pick the session.\nKeep the race." : navigation.find((item) => item.id === tab)?.label}</h1>
          </div>
          {tab === "sessions" && <SessionPanel configured={settings.credentialsConfigured} onQueued={(job) => { setJobs((current) => [job, ...current]); setTab("queue"); }} onOpenSettings={() => setTab("settings")} />}
          {tab === "queue" && <QueuePanel jobs={jobs} onCancel={cancel} />}
          {tab === "downloads" && <DownloadsPanel jobs={jobs} />}
          {tab === "settings" && <SettingsPanel settings={settings} onChanged={refreshSettings} />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}><span>{item.marker}</span>{item.label}</button>)}
      </nav>
    </div>
  );
}
