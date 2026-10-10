import { FormEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { api } from "./api";

type Tab = "sessions" | "queue" | "downloads" | "settings";
type JobStatus = "queued" | "running" | "completed" | "failed" | "cancelled";
type DownloadFeed = "F1 LIVE" | "INTERNATIONAL";

interface Job {
  id: string;
  url: string;
  quality: string;
  audio: string;
  channel: string | null;
  contentId: string | null;
  title: string | null;
  status: JobStatus;
  progress: number;
  message: string | null;
  outputFile: string | null;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  files?: {
    hq: { available: boolean; size: number | null; url: string };
    lq: {
      status: "queued" | "running" | "completed" | "failed";
      progress: number;
      message: string | null;
      available: boolean;
      size: number | null;
      sourceReused: boolean;
      url: string | null;
    };
  };
}

interface CatalogSeason { id: string; year: number; title: string; current: boolean }
interface CatalogEvent {
  id: string; seasonId: string; season: number; round: number | null; title: string; country: string | null;
  startDate: string | null; endDate: string | null; complete: boolean; status: "completed" | "current" | "future";
  replayAvailable: boolean; thumbnailUrl: string | null;
}
interface CatalogSession {
  id: string; eventId: string; title: string; type: string; startDate: string | null; endDate: string | null;
  durationSeconds: number | null; durationLabel: string | null; thumbnailUrl: string | null; available: boolean;
}
interface CatalogResult<T> { data: T; refreshedAt: string; stale: boolean; warning?: string }

interface Settings {
  credentialsConfigured: boolean;
  encryptionReady: boolean;
  port: number;
  defaultFeed: DownloadFeed;
}

const navigation: Array<{ id: Tab; label: string; marker: string }> = [
  { id: "sessions", label: "Sessions", marker: "01" },
  { id: "queue", label: "Queue", marker: "02" },
  { id: "downloads", label: "Downloads", marker: "03" },
  { id: "settings", label: "Settings", marker: "04" }
];

function sessionName(url: string): string {
  try {
    const slug = new URL(url).pathname.split("/").filter(Boolean).at(-1) || "F1 TV session";
    return slug.replace(/[-_]+/g, " ").replace(/\b\w/g, (character) => character.toUpperCase());
  } catch {
    return "F1 TV session";
  }
}

function jobName(job: Job): string {
  return job.title || sessionName(job.url);
}

function mergeJob(jobs: Job[], job: Job): Job[] {
  const index = jobs.findIndex((candidate) => candidate.id === job.id);
  if (index === -1) return [job, ...jobs];
  if (jobs[index] === job) return jobs;
  const next = [...jobs];
  next[index] = job;
  return next;
}

function displayDate(value: string | null): string {
  if (!value) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function eventDate(event: CatalogEvent): string {
  if (!event.startDate) return "Date unavailable";
  const start = new Date(event.startDate);
  const end = event.endDate ? new Date(event.endDate) : start;
  const formatMonth = (date: Date) => new Intl.DateTimeFormat(undefined, { month: "short" }).format(date);
  if (start.getMonth() === end.getMonth()) return `${start.getDate()}–${end.getDate()} ${formatMonth(end)}`;
  return `${start.getDate()} ${formatMonth(start)}–${end.getDate()} ${formatMonth(end)}`;
}

function relativeTime(value: string): string {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 60) return "just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(new Date(value));
}

function fileSize(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "size unavailable";
  if (value >= 1_000_000_000) return `${(value / 1_000_000_000).toFixed(1)} GB`;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(0)} MB`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(0)} KB`;
  return `${value} B`;
}

function Notice({ tone = "neutral", children }: { tone?: "neutral" | "error" | "success"; children: React.ReactNode }) {
  return <div className={`notice notice--${tone}`} role={tone === "error" ? "alert" : "status"}>{children}</div>;
}

function SessionPanel({ configured, defaultFeed, jobs, onQueued, onOpenSettings }: {
  configured: boolean;
  defaultFeed: DownloadFeed;
  jobs: Job[];
  onQueued: (job: Job) => void;
  onOpenSettings: () => void;
}) {
  const [seasons, setSeasons] = useState<CatalogSeason[]>([]);
  const [events, setEvents] = useState<CatalogEvent[]>([]);
  const [sessions, setSessions] = useState<CatalogSession[]>([]);
  const [seasonId, setSeasonId] = useState("");
  const [eventId, setEventId] = useState("");
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [queueing, setQueueing] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [warning, setWarning] = useState("");
  const [refreshedAt, setRefreshedAt] = useState<string | null>(null);

  const loadSeasons = useCallback(async () => {
    const result = await api<CatalogResult<CatalogSeason[]>>("/api/catalog/seasons");
    setSeasons(result.data);
    setWarning(result.warning || "");
    setRefreshedAt(result.refreshedAt);
    setSeasonId((current) => current || result.data.find((season) => season.current)?.id || result.data[0]?.id || "");
  }, []);

  const loadEvents = useCallback(async (nextSeasonId: string) => {
    const result = await api<CatalogResult<CatalogEvent[]>>(`/api/catalog/seasons/${nextSeasonId}/events`);
    setEvents(result.data);
    setWarning(result.warning || "");
    setRefreshedAt(result.refreshedAt);
    setEventId((current) => {
      if (result.data.some((event) => event.id === current && event.replayAvailable && event.status !== "future")) return current;
      const ongoing = result.data.find((event) => event.status === "current" && event.replayAvailable);
      const completed = result.data.filter((event) => event.status === "completed" && event.replayAvailable);
      return ongoing?.id || completed.at(-1)?.id || "";
    });
  }, []);

  const loadSessions = useCallback(async (nextEventId: string) => {
    const result = await api<CatalogResult<CatalogSession[]>>(`/api/catalog/events/${nextEventId}/sessions`);
    setSessions(result.data);
    setWarning(result.warning || "");
    setRefreshedAt(result.refreshedAt);
  }, []);

  useEffect(() => {
    setLoading(true);
    void loadSeasons().catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load F1TV seasons")).finally(() => setLoading(false));
  }, [loadSeasons]);

  useEffect(() => {
    if (!seasonId) return;
    setLoading(true); setError(""); setEventId(""); setSessions([]);
    void loadEvents(seasonId).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load F1 events")).finally(() => setLoading(false));
  }, [loadEvents, seasonId]);

  useEffect(() => {
    if (!eventId) return;
    setLoading(true); setError(""); setSessions([]);
    void loadSessions(eventId).catch((caught) => setError(caught instanceof Error ? caught.message : "Could not load F1 sessions")).finally(() => setLoading(false));
  }, [eventId, loadSessions]);

  async function refresh() {
    setRefreshing(true); setError("");
    try {
      const seasonResult = await api<CatalogResult<CatalogSeason[]>>("/api/catalog/refresh", { method: "POST", body: JSON.stringify({ scope: "seasons" }) });
      setSeasons(seasonResult.data);
      if (seasonId) {
        const eventResult = await api<CatalogResult<CatalogEvent[]>>("/api/catalog/refresh", { method: "POST", body: JSON.stringify({ scope: "events", id: seasonId }) });
        setEvents(eventResult.data);
      }
      if (eventId) {
        const sessionResult = await api<CatalogResult<CatalogSession[]>>("/api/catalog/refresh", { method: "POST", body: JSON.stringify({ scope: "sessions", id: eventId }) });
        setSessions(sessionResult.data);
        setWarning(sessionResult.warning || "");
        setRefreshedAt(sessionResult.refreshedAt);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not refresh the F1TV catalog");
    } finally {
      setRefreshing(false);
    }
  }

  async function queue(session: CatalogSession) {
    setQueueing(session.id); setError("");
    try {
      const { job } = await api<{ job: Job }>(`/api/catalog/sessions/${session.id}/download`, {
        method: "POST",
        body: JSON.stringify({ eventId: session.eventId })
      });
      onQueued(job);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not queue the session");
    } finally {
      setQueueing(null);
    }
  }

  return (
    <section className="panel session-panel">
      <div className="catalog-toolbar">
        <div><div className="eyebrow">F1TV catalog</div><h2>Choose a race weekend.</h2></div>
        <button className="quiet-button" disabled={refreshing} onClick={() => void refresh()}>{refreshing ? "Refreshing…" : "Refresh"}</button>
      </div>
      <p className="lede">Browse official Formula 1 replays and create an MP4 with one click. Downloads use best quality, English audio, and the {defaultFeed} feed.</p>

      {!configured && (
        <Notice tone="neutral">
          <span>F1 TV credentials are not configured yet.</span>
          <button className="link-button" onClick={onOpenSettings}>Open settings</button>
        </Notice>
      )}
      {error && <Notice tone="error">{error}</Notice>}
      {warning && <Notice tone="neutral">Showing cached catalog data · {warning}</Notice>}

      <div className="catalog-controls">
        <label className="field"><span>Season</span><select value={seasonId} onChange={(event) => setSeasonId(event.target.value)}>{seasons.map((season) => <option key={season.id} value={season.id}>{season.title}{season.current ? " · Current" : ""}</option>)}</select></label>
        <span className="cache-time">{refreshedAt ? `Updated ${relativeTime(refreshedAt)}` : "Loading catalog"}</span>
      </div>

      {loading && events.length === 0 ? <div className="empty-state"><span>F1</span><p>Loading the F1TV catalog…</p></div> : (
        <>
          <div className="event-strip" aria-label="Grand Prix events">
            {events.map((event) => {
              const disabled = event.status === "future" || !event.replayAvailable;
              const label = event.status === "current"
                ? "This weekend"
                : event.status === "future"
                  ? `Future · ${eventDate(event)}`
                  : event.replayAvailable ? "Replay available" : "Replay unavailable";
              return <button key={event.id} disabled={disabled} aria-current={event.status === "current" ? "date" : undefined} className={`${event.id === eventId ? "active " : ""}event-card--${event.status}`} onClick={() => setEventId(event.id)}><small>{event.round ? `Round ${event.round}` : event.season}</small><strong>{event.country || event.title.replace(/Formula 1|Grand Prix/gi, "").replace(/\b(?:19|20)\d{2}\b/g, "").trim()}</strong><span>{label}</span></button>;
            })}
          </div>

          <div className="section-heading catalog-session-heading"><div><div className="eyebrow">Available sessions</div><h3>{events.find((event) => event.id === eventId)?.title || "Select an event"}</h3></div><span className="count-chip">{sessions.length} sessions</span></div>
          {sessions.length === 0 ? <div className="empty-state"><span>00</span><p>{loading ? "Loading sessions…" : "No supported Formula 1 sessions found."}</p></div> : (
            <div className="session-grid">
              {sessions.map((session) => {
                const existing = jobs.find((job) => job.contentId === session.id && ["queued", "running", "completed"].includes(job.status));
                return <article className="session-card" key={session.id}>
                  {session.thumbnailUrl ? <img src={session.thumbnailUrl} alt="" loading="lazy" /> : <div className="session-card__placeholder">F1</div>}
                  <div className="session-card__body"><span className="status">{session.type}</span><h3>{session.title}</h3><p>{displayDate(session.startDate)}{session.durationLabel ? ` · ${session.durationLabel}` : ""}</p><div className="session-card__footer"><small>BEST · ENG · {defaultFeed}</small><button className="primary-button primary-button--small" disabled={!configured || !session.available || Boolean(existing) || queueing === session.id} onClick={() => void queue(session)}>{existing ? existing.status : queueing === session.id ? "Adding…" : session.available ? "Download MP4" : "Not available"}</button></div></div>
                </article>;
              })}
            </div>
          )}
        </>
      )}
    </section>
  );
}

const QueueJobCard = memo(function QueueJobCard({ job, onCancel }: { job: Job; onCancel: (job: Job) => void }) {
  return (
    <article className="job-card">
      <div className="job-card__top">
        <div>
          <span className={`status status--${job.status}`}>{job.status}</span>
          <h3>{jobName(job)}</h3>
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
          <button className="quiet-button" onClick={() => onCancel(job)}>Cancel</button>
        )}
      </div>
    </article>
  );
});

function CancelDialog({ job, busy, error, onClose, onConfirm }: {
  job: Job;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const dismissButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    dismissButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [busy, onClose]);

  return (
    <div className="dialog-backdrop" role="presentation">
      <div className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title" aria-describedby="cancel-dialog-description">
        <div className="eyebrow">Cancel download</div>
        <h2 id="cancel-dialog-title">Stop {jobName(job)}?</h2>
        <p id="cancel-dialog-description">The download will stop and any partially downloaded file will be removed. You can download this session again later.</p>
        {error && <Notice tone="error">{error}</Notice>}
        <div className="confirm-dialog__actions">
          <button ref={dismissButton} className="quiet-button" disabled={busy} onClick={onClose}>Keep downloading</button>
          <button className="primary-button primary-button--danger" disabled={busy} onClick={onConfirm}>{busy ? "Cancelling…" : "Cancel download"}</button>
        </div>
      </div>
    </div>
  );
}

function QueuePanel({ jobs, onCancel }: { jobs: Job[]; onCancel: (id: string) => Promise<void> }) {
  const [selectedJob, setSelectedJob] = useState<Job | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [cancelError, setCancelError] = useState("");
  const activeJobs = jobs.filter((job) => job.status !== "completed" && job.status !== "cancelled");

  const closeDialog = useCallback(() => {
    if (cancelling) return;
    setSelectedJob(null);
    setCancelError("");
  }, [cancelling]);

  async function confirmCancellation() {
    if (!selectedJob) return;
    setCancelling(true);
    setCancelError("");
    try {
      await onCancel(selectedJob.id);
      setSelectedJob(null);
    } catch (caught) {
      setCancelError(caught instanceof Error ? caught.message : "Could not cancel the download");
    } finally {
      setCancelling(false);
    }
  }

  function openDialog(job: Job) {
    setCancelError("");
    setSelectedJob(job);
  }

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
            <QueueJobCard job={job} key={job.id} onCancel={openDialog} />
          ))}
        </div>
      )}
      {selectedJob && <CancelDialog job={selectedJob} busy={cancelling} error={cancelError} onClose={closeDialog} onConfirm={() => void confirmCancellation()} />}
    </section>
  );
}

function DownloadsPanel({ jobs, onRetry }: { jobs: Job[]; onRetry: (id: string) => Promise<void> }) {
  const [retrying, setRetrying] = useState<string | null>(null);
  const [error, setError] = useState("");
  const downloads = jobs.filter((job) => job.status === "completed" && job.outputFile);

  async function retry(jobId: string) {
    setRetrying(jobId);
    setError("");
    try {
      await onRetry(jobId);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not retry mobile conversion");
    } finally {
      setRetrying(null);
    }
  }

  return (
    <section className="panel">
      <div className="section-heading">
        <div><div className="eyebrow">MP4 library</div><h2>Ready to watch.</h2></div>
        <span className="count-chip">{downloads.length} files</span>
      </div>
      {error && <Notice tone="error">{error}</Notice>}
      {downloads.length === 0 ? (
        <div className="empty-state"><span>MP4</span><p>Completed sessions will appear here.</p></div>
      ) : (
        <div className="download-grid">
          {downloads.map((job) => (
            <article className="download-card" key={job.id}>
              <div className="download-card__flag" aria-hidden="true" />
              <div className="status status--completed">ready</div>
              <h3>{jobName(job)}</h3>
              <p>{job.quality === "best" ? "Best available quality" : job.quality} · {job.audio.toUpperCase()}</p>
              {job.files?.lq.status === "running" && (
                <div className="conversion-progress" aria-label={`Mobile conversion ${job.files.lq.progress}%`}>
                  <div style={{ width: `${job.files.lq.progress}%` }} />
                </div>
              )}
              {job.files?.lq.status !== "completed" && <p className="conversion-state">{job.files?.lq.message || "Preparing mobile MP4"}</p>}
              <div className="download-actions">
                <a className="quiet-button" href={`/api/downloads/${job.id}/file?variant=hq&download=1`}>
                  Download HQ · {fileSize(job.files?.hq.size)}
                </a>
                {job.files?.lq.available ? (
                  <a className="primary-button primary-button--small" href={`/api/downloads/${job.id}/file?variant=lq&download=1`}>
                    Download LQ · {fileSize(job.files.lq.size)}
                  </a>
                ) : job.files?.lq.status === "failed" ? (
                  <button className="primary-button primary-button--small" disabled={retrying === job.id} onClick={() => void retry(job.id)}>
                    {retrying === job.id ? "Retrying…" : "Retry LQ conversion"}
                  </button>
                ) : (
                  <button className="primary-button primary-button--small" disabled>
                    {job.files?.lq.status === "running" ? `Creating LQ · ${job.files.lq.progress}%` : "LQ queued"}
                  </button>
                )}
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
  const [feedBusy, setFeedBusy] = useState(false);

  async function changeDefaultFeed(defaultFeed: DownloadFeed) {
    setFeedBusy(true); setError(""); setMessage("");
    try {
      const result = await api<{ defaultFeed: DownloadFeed; updatedJobs: number }>("/api/settings/default-feed", {
        method: "PUT",
        body: JSON.stringify({ defaultFeed })
      });
      const queued = result.updatedJobs === 1 ? "1 queued job" : `${result.updatedJobs} queued jobs`;
      setMessage(`Default feed changed to ${result.defaultFeed}. Updated ${queued}.`);
      await onChanged();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not change the default feed");
    } finally { setFeedBusy(false); }
  }

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
      <div className="default-feed-setting">
        <label className="field field--wide">
          <span>Default download feed</span>
          <select disabled={feedBusy} value={settings.defaultFeed} onChange={(event) => void changeDefaultFeed(event.target.value as DownloadFeed)}>
            <option value="F1 LIVE">F1 LIVE</option>
            <option value="INTERNATIONAL">INTERNATIONAL</option>
          </select>
          <small>Changing this also updates every download that is still queued.</small>
        </label>
      </div>
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
  const [settings, setSettings] = useState<Settings>({ credentialsConfigured: false, encryptionReady: false, port: 43729, defaultFeed: "F1 LIVE" });
  const [online, setOnline] = useState(true);
  const jobRequestVersions = useRef(new Map<string, number>());

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

    const events = new EventSource("/api/jobs/events");
    events.onopen = () => setOnline(true);
    events.onerror = () => setOnline(false);
    events.addEventListener("job-update", (event) => {
      let jobId: string;
      try {
        const payload = JSON.parse((event as MessageEvent<string>).data) as { jobId?: unknown };
        if (typeof payload.jobId !== "string" || !payload.jobId) return;
        jobId = payload.jobId;
      } catch {
        return;
      }

      const version = (jobRequestVersions.current.get(jobId) ?? 0) + 1;
      jobRequestVersions.current.set(jobId, version);
      void api<{ job: Job }>(`/api/jobs/${encodeURIComponent(jobId)}`)
        .then(({ job }) => {
          if (jobRequestVersions.current.get(jobId) !== version) return;
          setJobs((current) => mergeJob(current, job));
          setOnline(true);
        })
        .catch(() => setOnline(false));
    });

    return () => events.close();
  }, [refreshJobs, refreshSettings]);

  const activeCount = useMemo(() => jobs.filter((job) => job.status === "queued" || job.status === "running").length, [jobs]);

  const cancel = useCallback(async (id: string) => {
    await api<{ job: Job }>(`/api/jobs/${id}/cancel`, { method: "POST" });
    setJobs((current) => current.filter((job) => job.id !== id));
  }, []);

  const retryConversion = useCallback(async (id: string) => {
    const response = await api<{ job: Job }>(`/api/downloads/${encodeURIComponent(id)}/lq/retry`, { method: "POST" });
    setJobs((current) => mergeJob(current, response.job));
  }, []);

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
          <div className="sidebar__foot">PORT {settings.port}<br />DUAL WORKERS</div>
        </aside>

        <main>
          <div className="page-intro">
            <p>F1TV / PRIVATE ARCHIVE</p>
            <h1>{tab === "sessions" ? "Pick the session.\nKeep the race." : navigation.find((item) => item.id === tab)?.label}</h1>
          </div>
          {tab === "sessions" && <SessionPanel configured={settings.credentialsConfigured} defaultFeed={settings.defaultFeed} jobs={jobs} onQueued={(job) => setJobs((current) => [job, ...current])} onOpenSettings={() => setTab("settings")} />}
          {tab === "queue" && <QueuePanel jobs={jobs} onCancel={cancel} />}
          {tab === "downloads" && <DownloadsPanel jobs={jobs} onRetry={retryConversion} />}
          {tab === "settings" && <SettingsPanel settings={settings} onChanged={async () => { await Promise.all([refreshSettings(), refreshJobs()]); }} />}
        </main>
      </div>

      <nav className="mobile-nav" aria-label="Mobile navigation">
        {navigation.map((item) => <button className={tab === item.id ? "active" : ""} key={item.id} onClick={() => setTab(item.id)}><span>{item.marker}</span>{item.label}</button>)}
      </nav>
    </div>
  );
}
