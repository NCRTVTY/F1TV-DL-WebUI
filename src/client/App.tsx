import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
} from "react";
import {
  Compass,
  ListOrdered,
  Download,
  Settings as SettingsIcon,
  Search,
  RefreshCw,
  Play,
  Trash2,
  ArrowUp,
  ArrowRight,
  Inbox,
  WifiOff,
  CalendarDays,
} from "lucide-react";
import { api } from "./api";
import type {
  Screen,
  Season,
  Event,
  Session,
  Catalog,
  Job,
  Settings,
} from "./types";
import racePhoto from "./assets/race.jpg";

const navItems = [
  { id: "browse", label: "Browse", Icon: Compass },
  { id: "queue", label: "Queue", Icon: ListOrdered },
  { id: "downloads", label: "Downloads", Icon: Download },
  { id: "settings", label: "Settings", Icon: SettingsIcon },
] as const;
function screenFromUrl(): Screen {
  const v = new URLSearchParams(location.search).get("view");
  return [
    "browse",
    "weekend",
    "queue",
    "downloads",
    "watch",
    "settings",
  ].includes(v ?? "")
    ? (v as Screen)
    : "browse";
}
export function fileSize(bytes: number | null | undefined): string {
  return bytes == null
    ? "Size unavailable"
    : bytes >= 1e12
      ? (bytes / 1e12).toFixed(1) + " TB"
      : bytes >= 1e9
        ? (bytes / 1e9).toFixed(2) + " GB"
        : (bytes / 1e6).toFixed(0) + " MB";
}
function duration(seconds: number | null | undefined): string {
  if (!seconds) return "";
  const h = Math.floor(seconds / 3600),
    m = Math.round((seconds % 3600) / 60);
  return (h ? h + "h " : "") + m + "m";
}
function name(event: Event): string {
  const t = event.title.toLowerCase();
  for (const [pattern, label] of [
    [/las vegas/, "Las Vegas"],
    [/miami/, "Miami"],
    [/united states|austin/, "Austin"],
    [/são paulo|brazil|brasil/, "São Paulo"],
    [/mexic/, "Mexico City"],
    [/singapore/, "Singapore"],
    [/madrid/, "Madrid"],
    [/barcelona/, "Barcelona"],
  ] as const)
    if (pattern.test(t)) return label;
  return (event.country || event.title)
    .toLowerCase()
    .replace(/\b\p{L}/gu, (c) => c.toUpperCase());
}
function dateRange(event: Event): string {
  if (!event.startDate) return "Date unavailable";
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(new Date(event.startDate));
}
function Picture({
  src,
  className = "",
  alt = "",
}: {
  src?: string | null;
  className?: string;
  alt?: string;
}) {
  return (
    <img
      className={"fd-photo " + className}
      src={src || racePhoto}
      alt={alt}
      loading="lazy"
      onError={(e) => {
        e.currentTarget.onerror = null;
        e.currentTarget.src = racePhoto;
      }}
    />
  );
}
function Button({
  children,
  onClick,
  disabled = false,
  primary = false,
  label,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
  label?: string;
}) {
  return (
    <button
      type="button"
      className={"fd-button " + (primary ? "fd-button-primary" : "")}
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
    >
      {children}
    </button>
  );
}
function Empty({
  title,
  children,
  onBrowse,
  label = "Browse replays",
  icon = <Inbox />,
}: {
  title: string;
  children: ReactNode;
  onBrowse: () => void;
  label?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="fd-empty">
      {icon}
      <h2>{title}</h2>
      <p>{children}</p>
      <Button onClick={onBrowse} primary>
        {label}
      </Button>
    </div>
  );
}
function Heading({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: ReactNode;
}) {
  return (
    <div className="fd-page-title">
      <div>
        <h1>{title}</h1>
        {subtitle && (
          <p className="fd-muted fd-small" style={{ marginTop: 6 }}>
            {subtitle}
          </p>
        )}
      </div>
      {children}
    </div>
  );
}
function Modal({
  title,
  children,
  busy,
  onClose,
  onConfirm,
  label,
  error,
}: {
  title: string;
  children: ReactNode;
  busy: boolean;
  onClose: () => void;
  onConfirm: () => void;
  label: string;
  error: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="fd-dialog"
      aria-labelledby="dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
    >
      <h2 id="dialog-title">{title}</h2>
      {children}
      {error && <p role="alert">{error}</p>}
      <div className="fd-dialog-actions">
        <Button disabled={busy} onClick={onClose}>
          Keep it
        </Button>
        <Button disabled={busy} onClick={onConfirm} primary>
          {busy ? "Working…" : label}
        </Button>
      </div>
    </dialog>
  );
}
const initialSettings: Settings = {
  credentialsConfigured: false,
  encryptionReady: false,
  paused: false,
  storage: {
    ready: false,
    writable: false,
    freeBytes: 0,
    totalBytes: 0,
    enoughSpace: false,
    message: "Checking media storage",
    location: "Synology / Homelab-workspace / f1tv-dl",
  },
};
export function App() {
  const initial = new URLSearchParams(location.search);
  const [screen, setScreen] = useState<Screen>(screenFromUrl);
  const [seasonId, setSeasonId] = useState(initial.get("season") ?? "");
  const [eventId, setEventId] = useState(initial.get("event") ?? "");
  const [watchId, setWatchId] = useState(initial.get("job") ?? "");
  const [seasons, setSeasons] = useState<Season[]>([]),
    [events, setEvents] = useState<Event[]>([]),
    [sessions, setSessions] = useState<Session[]>([]);
  const [jobs, setJobs] = useState<Job[]>([]),
    [settings, setSettings] = useState<Settings>(initialSettings);
  const [online, setOnline] = useState(true),
    [loading, setLoading] = useState(true),
    [sessionLoading, setSessionLoading] = useState(false);
  const [catalogError, setCatalogError] = useState(""),
    [sessionError, setSessionError] = useState(""),
    [warning, setWarning] = useState(""),
    [error, setError] = useState(""),
    [toast, setToast] = useState("");
  const [search, setSearch] = useState(""),
    [availability, setAvailability] = useState("all"),
    [sessionType, setSessionType] = useState("All"),
    [librarySearch, setLibrarySearch] = useState("");
  const [refresh, setRefresh] = useState(0),
    [busy, setBusy] = useState<string | null>(null);
  const [dialog, setDialog] = useState<{
      kind: "cancel" | "remove" | "account";
      job?: Job;
    } | null>(null),
    [dialogError, setDialogError] = useState("");
  const [editing, setEditing] = useState(false),
    [username, setUsername] = useState(""),
    [password, setPassword] = useState("");
  const versions = useRef(new Map<string, number>());
  const settingsLoaded = useRef(false);
  const syncSettings = useCallback(async () => {
    const v = await api<Settings>("/api/settings");
    setSettings(v);
    settingsLoaded.current = true;
  }, []);
  const syncJobs = useCallback(async () => {
    const v = await api<{ jobs: Job[] }>("/api/jobs");
    setJobs(v.jobs);
  }, []);
  const sync = useCallback(() => {
    void Promise.all([syncSettings(), syncJobs()])
      .then(() => setOnline(true))
      .catch(() => setOnline(false));
  }, [syncSettings, syncJobs]);
  useEffect(() => {
    sync();
    const stream = new EventSource("/api/jobs/events");
    stream.onopen = () => {
      setOnline(true);
      sync();
    };
    stream.onerror = () => setOnline(false);
    stream.addEventListener("job-update", (event) => {
      let id: string;
      try {
        id = JSON.parse((event as MessageEvent).data).jobId;
        if (typeof id !== "string") return;
      } catch {
        return;
      }
      const v = (versions.current.get(id) ?? 0) + 1;
      versions.current.set(id, v);
      void api<{ job: Job }>("/api/jobs/" + encodeURIComponent(id))
        .then(({ job }) => {
          if (versions.current.get(id) === v)
            setJobs((current) =>
              [job, ...current.filter((j) => j.id !== id)].sort((a, b) =>
                b.createdAt.localeCompare(a.createdAt),
              ),
            );
        })
        .catch(() => {});
    });
    stream.addEventListener("job-removed", (event) => {
      try {
        const id = JSON.parse((event as MessageEvent).data).jobId;
        versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
        setJobs((current) => current.filter((j) => j.id !== id));
      } catch {}
    });
    const timer = setInterval(sync, 15000);
    const visible = () => {
      if (document.visibilityState === "visible") sync();
    };
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", sync);
    return () => {
      stream.close();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", sync);
    };
  }, [sync]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 5000);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setCatalogError("");
    const request = refresh
      ? api<Catalog<Season[]>>("/api/catalog/refresh", {
          method: "POST",
          body: JSON.stringify({ scope: "seasons" }),
          signal: controller.signal,
        })
      : api<Catalog<Season[]>>("/api/catalog/seasons", {
          signal: controller.signal,
        });
    void request
      .then((r) => {
        setSeasons(r.data);
        setWarning(r.warning ?? "");
        setSeasonId((current) =>
          r.data.some((s) => s.id === current)
            ? current
            : (r.data.find((s) => s.current)?.id ?? r.data[0]?.id ?? ""),
        );
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCatalogError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    if (!seasonId) return;
    const controller = new AbortController();
    setLoading(true);
    setCatalogError("");
    setEvents([]);
    const request = refresh
      ? api<Catalog<Event[]>>("/api/catalog/refresh", {
          method: "POST",
          body: JSON.stringify({ scope: "events", id: seasonId }),
          signal: controller.signal,
        })
      : api<Catalog<Event[]>>("/api/catalog/seasons/" + seasonId + "/events", {
          signal: controller.signal,
        });
    void request
      .then((r) => {
        setEvents(r.data);
        setWarning(r.warning ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setCatalogError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [seasonId, refresh]);
  const selected = events.find((e) => e.id === eventId);
  const latest =
    events
      .filter((e) => e.replayAvailable && e.status === "completed")
      .at(-1) ?? events.find((e) => e.replayAvailable);
  useEffect(() => {
    setSessions([]);
    setSessionError("");
    if (
      screen !== "weekend" ||
      !selected?.replayAvailable ||
      selected.status === "future" ||
      !/^p\d+$|^s\d+-m\d+$/.test(selected.id)
    )
      return;
    const controller = new AbortController();
    setSessionLoading(true);
    const request = refresh
      ? api<Catalog<Session[]>>("/api/catalog/refresh", {
          method: "POST",
          body: JSON.stringify({ scope: "sessions", id: selected.id }),
          signal: controller.signal,
        })
      : api<Catalog<Session[]>>(
          "/api/catalog/events/" + selected.id + "/sessions",
          { signal: controller.signal },
        );
    void request
      .then((r) => {
        setSessions(r.data);
        setWarning(r.warning ?? "");
      })
      .catch((e) => {
        if (!controller.signal.aborted) setSessionError(e.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionLoading(false);
      });
    return () => {
      controller.abort();
      setSessionLoading(false);
    };
  }, [
    selected?.id,
    selected?.replayAvailable,
    selected?.status,
    screen,
    refresh,
  ]);
  useEffect(() => {
    const onPop = () => {
      const p = new URLSearchParams(location.search);
      setScreen(screenFromUrl());
      if (p.get("season")) setSeasonId(p.get("season")!);
      setEventId(p.get("event") ?? "");
      setWatchId(p.get("job") ?? "");
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  function navigate(
    view: Screen,
    opts: {
      event?: Event;
      job?: Job;
      eventId?: string;
      seasonId?: string;
    } = {},
  ) {
    const p = new URLSearchParams();
    p.set("view", view);
    const targetSeason = opts.seasonId ?? seasonId;
    if (targetSeason) p.set("season", targetSeason);
    if (opts.seasonId) setSeasonId(opts.seasonId);
    if (opts.event) {
      setEventId(opts.event.id);
      p.set("event", opts.event.id);
      setSessionType("All");
    } else if (opts.eventId) {
      setEventId(opts.eventId);
      p.set("event", opts.eventId);
    } else if (eventId) p.set("event", eventId);
    if (opts.job) {
      setWatchId(opts.job.id);
      p.set("job", opts.job.id);
    }
    setScreen(view);
    setError("");
    setToast("");
    history.pushState(null, "", "?" + p.toString());
    window.scrollTo({ top: 0, behavior: "instant" });
  }
  async function action(id: string, fn: () => Promise<void>) {
    setBusy(id);
    setError("");
    try {
      await fn();
      await Promise.all([syncJobs(), syncSettings()]);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "The action could not complete",
      );
    } finally {
      setBusy(null);
    }
  }
  async function queue(session: Session) {
    await action(session.id, async () => {
      await api("/api/catalog/sessions/" + session.id + "/download", {
        method: "POST",
        body: JSON.stringify({ eventId: session.eventId }),
      });
      setToast(session.title + " added to the queue.");
    });
  }
  const completed = jobs.filter((j) => j.status === "completed");
  const active = jobs.filter(
    (j) => j.status === "queued" || j.status === "running",
  );
  const running = active.find((j) => j.status === "running");
  const queued = active
    .filter((j) => j.status === "queued")
    .sort(
      (a, b) =>
        a.position - b.position || a.createdAt.localeCompare(b.createdAt),
    );
  const failed = jobs.filter((j) => j.status === "failed");
  const watched = completed.find((j) => j.id === watchId) ?? completed[0];
  const storageReady = settings.storage.ready;
  const refreshButton = (
    <Button
      disabled={loading || sessionLoading}
      onClick={() => setRefresh((x) => x + 1)}
    >
      <RefreshCw size={16} />
      Refresh
    </Button>
  );
  function navigation(mobile = false) {
    return navItems.map((item) => {
      const current =
        screen === item.id ||
        (item.id === "browse" && screen === "weekend") ||
        (item.id === "downloads" && screen === "watch");
      return (
        <button
          key={item.id}
          type="button"
          aria-current={current ? "page" : undefined}
          onClick={() => navigate(item.id)}
        >
          {mobile && <item.Icon size={18} />}
          <span>
            {item.label}
            {item.id === "queue" && active.length > 0 && (
              <b className="fd-nav-count">{active.length}</b>
            )}
          </span>
        </button>
      );
    });
  }
  function hero(event: Event, link = false) {
    return (
      <div className="fd-hero">
        <Picture src={event.thumbnailUrl} />
        <div className="fd-hero-copy">
          <span className="fd-eyebrow">
            {link
              ? "Latest available replay"
              : "Round " + (event.round ?? "—") + " · " + event.season}
          </span>
          {link ? (
            <h2>{name(event)} Grand Prix</h2>
          ) : (
            <h1>{name(event)} Grand Prix</h1>
          )}
          <div className="fd-hero-meta">{event.title}</div>
          {link ? (
            <Button primary onClick={() => navigate("weekend", { event })}>
              Browse weekend
              <ArrowRight size={16} />
            </Button>
          ) : (
            <div className="fd-policy" style={{ color: "#fff" }}>
              720p · English · F1 LIVE
            </div>
          )}
        </div>
      </div>
    );
  }
  function loadingView() {
    return (
      <>
        <div
          className="fd-loading"
          aria-busy="true"
          aria-label="Loading catalog"
        >
          {[0, 1, 2].map((i) => (
            <div className="fd-skeleton" key={i} />
          ))}
        </div>
        <p className="fd-loading-copy">Loading replays…</p>
      </>
    );
  }
  function browseView() {
    const visible = events
      .filter(
        (e) =>
          (availability === "all" ||
            (availability === "ready" &&
              e.status === "completed" &&
              e.replayAvailable) ||
            (availability === "upcoming" && e.status !== "completed")) &&
          (e.title + " " + e.country + " " + name(e))
            .toLowerCase()
            .includes(search.toLowerCase()),
      )
      .slice()
      .sort((a, b) => {
        if (a.status === "completed" && b.status === "completed")
          return (b.round ?? 0) - (a.round ?? 0);
        if (a.status === "completed") return -1;
        if (b.status === "completed") return 1;
        return (a.round ?? 0) - (b.round ?? 0);
      });
    return (
      <>
        <Heading
          title="Browse replays"
          subtitle="Formula 1 race weekends, season by season."
        >
          {refreshButton}
        </Heading>
        {catalogError ? (
          <Empty
            title="The replay catalog could not load"
            icon={<WifiOff />}
            onBrowse={() => setRefresh((x) => x + 1)}
            label="Try again"
          >
            {catalogError}
          </Empty>
        ) : loading ? (
          loadingView()
        ) : (
          <>
            {latest && hero(latest, true)}
            <div className="fd-toolbar">
              <select
                className="fd-select"
                style={{ width: 130 }}
                aria-label="Season"
                value={seasonId}
                onChange={(e) => {
                  setSeasonId(e.target.value);
                  setEventId("");
                  const p = new URLSearchParams(location.search);
                  p.set("season", e.target.value);
                  p.delete("event");
                  history.replaceState(null, "", "?" + p.toString());
                }}
              >
                {seasons.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.year}
                  </option>
                ))}
              </select>
              <select
                className="fd-select"
                style={{ width: 175 }}
                aria-label="Replay availability"
                value={availability}
                onChange={(e) => setAvailability(e.target.value)}
              >
                <option value="all">All weekends</option>
                <option value="ready">Replays available</option>
                <option value="upcoming">Upcoming</option>
              </select>
              <label className="fd-search">
                <Search />
                <input
                  className="fd-input"
                  type="search"
                  value={search}
                  placeholder="Search city or circuit"
                  aria-label="Search city or circuit"
                  onChange={(e) => setSearch(e.target.value)}
                />
              </label>
            </div>
            <div className="fd-section-head">
              <h2>{seasons.find((s) => s.id === seasonId)?.year} season</h2>
              <span className="fd-muted fd-small">
                {visible.length} weekends
              </span>
            </div>
            <div className="fd-weekends">
              {visible.map((e) => (
                <button
                  className="fd-event"
                  key={e.id}
                  type="button"
                  onClick={() => navigate("weekend", { event: e })}
                  aria-label={"View " + name(e) + " race weekend"}
                >
                  <div className="fd-event-image">
                    <Picture src={e.thumbnailUrl} />
                    <span className="fd-round">ROUND {e.round ?? "—"}</span>
                  </div>
                  <div className="fd-event-info">
                    <h3>{name(e)}</h3>
                    <p className="fd-small fd-muted">{e.title}</p>
                    <div className="fd-event-bottom">
                      <span
                        className={
                          "fd-badge " +
                          (e.status === "completed" && e.replayAvailable
                            ? "fd-good"
                            : "")
                        }
                      >
                        {e.status === "completed" && e.replayAvailable
                          ? "Replays available"
                          : e.status === "current"
                            ? "This weekend"
                            : "Upcoming"}
                      </span>
                      <span>{dateRange(e)}</span>
                    </div>
                  </div>
                </button>
              ))}
            </div>
            {!visible.length && (
              <Empty
                title="No matching weekends"
                onBrowse={() => {
                  setSearch("");
                  setAvailability("all");
                }}
                label="Clear filters"
              >
                Try another city, circuit or availability filter.
              </Empty>
            )}
          </>
        )}
      </>
    );
  }
  function weekendView() {
    if (loading) return loadingView();
    if (!selected)
      return (
        <Empty
          title="Choose a race weekend"
          onBrowse={() => navigate("browse")}
        >
          Select a weekend to see its available sessions.
        </Empty>
      );
    const pending = selected.status === "future" || !selected.replayAvailable;
    const visible = sessions.filter(
      (s) =>
        sessionType === "All" ||
        s.type === sessionType ||
        (sessionType === "Sprint" && s.type.startsWith("Sprint")),
    );
    return (
      <>
        <div className="fd-breadcrumb">
          <button onClick={() => navigate("browse")}>Browse</button>
          <span>
            / {selected.season} / {name(selected)}
          </span>
        </div>
        {hero(selected)}
        <div className="fd-section-head">
          <h2>Weekend sessions</h2>
          {refreshButton}
        </div>
        {pending ? (
          <Empty
            title="Replays are not available yet"
            icon={<CalendarDays />}
            onBrowse={() => navigate("browse")}
          >
            Return after the sessions finish to see available replays.
          </Empty>
        ) : (
          <>
            <div className="fd-chips" style={{ marginBottom: 16 }}>
              {["All", "Race", "Qualifying", "Practice", "Sprint"].map((t) => (
                <button
                  type="button"
                  className="fd-chip"
                  key={t}
                  aria-pressed={t === sessionType}
                  onClick={() => setSessionType(t)}
                >
                  {t}
                </button>
              ))}
            </div>
            {sessionLoading ? (
              loadingView()
            ) : sessionError ? (
              <Empty
                title="Replays are not available yet"
                onBrowse={() => setRefresh((x) => x + 1)}
                label="Check again"
              >
                {sessionError}
              </Empty>
            ) : (
              <>
                <div className="fd-session-grid">
                  {visible.map((s) => {
                    const existing = jobs.find(
                      (j) =>
                        j.contentId === s.id &&
                        ["running", "queued", "completed"].includes(j.status),
                    );
                    const downloaded = existing?.status === "completed";
                    return (
                      <article className="fd-session" key={s.id}>
                        <div className="fd-thumb">
                          <Picture src={s.thumbnailUrl} />
                          <span className="fd-thumb-label">
                            {s.durationLabel || duration(s.durationSeconds)}
                          </span>
                        </div>
                        <div className="fd-card-body">
                          <span className="fd-eyebrow fd-muted">{s.type}</span>
                          <h3>{s.title}</h3>
                          <p className="fd-small fd-muted">
                            {s.startDate
                              ? new Date(s.startDate).toLocaleString(
                                  undefined,
                                  {
                                    day: "numeric",
                                    month: "short",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  },
                                )
                              : "Replay"}
                          </p>
                          <div className="fd-card-footer">
                            <span
                              className={
                                "fd-small " +
                                (downloaded ? "fd-good" : "fd-muted")
                              }
                            >
                              {downloaded ? "Downloaded" : "720p · English"}
                            </span>
                            <Button
                              primary
                              disabled={
                                busy === s.id ||
                                !s.available ||
                                (!!existing && !downloaded) ||
                                (downloaded &&
                                  (!storageReady || !existing?.file?.available))
                              }
                              onClick={() => {
                                if (downloaded)
                                  navigate("watch", { job: existing! });
                                else if (!settings.credentialsConfigured)
                                  navigate("settings");
                                else void queue(s);
                              }}
                            >
                              {downloaded
                                ? "Watch"
                                : existing
                                  ? existing.status
                                  : busy === s.id
                                    ? "Adding…"
                                    : !s.available
                                      ? "Not available"
                                      : !settings.credentialsConfigured
                                        ? "Connect account"
                                        : "Add to queue"}
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
                {!visible.length && (
                  <Empty
                    title={
                      sessions.length
                        ? "No sessions match this filter"
                        : "Replays are not available yet"
                    }
                    onBrowse={() =>
                      sessions.length
                        ? setSessionType("All")
                        : setRefresh((x) => x + 1)
                    }
                    label={
                      sessions.length ? "Show all sessions" : "Check again"
                    }
                  >
                    Only F1 LIVE replays with English audio can be downloaded.
                  </Empty>
                )}
              </>
            )}
          </>
        )}
      </>
    );
  }
  function queueView() {
    if (!active.length && !failed.length)
      return (
        <>
          <Heading title="Queue" subtitle="Downloads run one at a time." />
          <Empty
            title="Your queue is clear"
            onBrowse={() => navigate("browse")}
            icon={<ListOrdered />}
          >
            Choose a replay and it will appear here.
          </Empty>
        </>
      );
    return (
      <>
        <Heading
          title="Queue"
          subtitle={
            active.length +
            " active or waiting · " +
            failed.length +
            " needs attention"
          }
        >
          <Button
            disabled={!online || !!busy}
            onClick={() =>
              void action("pause", async () => {
                await api("/api/queue", {
                  method: "POST",
                  body: JSON.stringify({ paused: !settings.paused }),
                });
              })
            }
          >
            {settings.paused ? "Resume queue" : "Pause queue"}
          </Button>
        </Heading>
        {running && (
          <article className="fd-active-job">
            <div className="fd-job-head">
              <Picture src={running.thumbnailUrl} className="fd-job-photo" />
              <div className="fd-job-copy">
                <span
                  className={
                    "fd-eyebrow " + (storageReady ? "fd-good" : "fd-warn")
                  }
                >
                  {!online
                    ? "Reconnecting"
                    : !storageReady
                      ? "Waiting for storage"
                      : "Downloading"}
                </span>
                <h3>{running.title}</h3>
                <p className="fd-small fd-muted">720p · English · F1 LIVE</p>
              </div>
            </div>
            <div
              className="fd-progress"
              role="progressbar"
              aria-label="Download progress"
              aria-valuenow={running.progress}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <span style={{ width: String(running.progress) + "%" }} />
            </div>
            <div className="fd-job-foot">
              <span>{running.message}</span>
              <Button
                disabled={!online || !!busy}
                onClick={() => {
                  setDialog({ kind: "cancel", job: running });
                  setDialogError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </article>
        )}
        <div className="fd-section-head">
          <h2>Up next</h2>
          <span className="fd-small fd-muted">
            {settings.paused
              ? "Queue paused"
              : !storageReady
                ? "Waiting for storage"
                : !settings.storage.enoughSpace
                  ? "Waiting for free space"
                  : "In download order"}
          </span>
        </div>
        {queued.map((j, i) => (
          <div className="fd-list-row" key={j.id}>
            <span className="fd-list-number">{i + 1}</span>
            <div className="fd-list-copy">
              <h3>{j.title}</h3>
              <p className="fd-small fd-muted">Queued · 720p · English</p>
            </div>
            <div className="fd-row-actions">
              <Button
                label={"Move " + j.title + " up"}
                disabled={i === 0 || !!busy || !online}
                onClick={() =>
                  void action(j.id, async () => {
                    await api("/api/jobs/" + j.id + "/move-up", {
                      method: "POST",
                    });
                  })
                }
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                disabled={!!busy || !online}
                onClick={() => {
                  setDialog({ kind: "cancel", job: j });
                  setDialogError("");
                }}
              >
                Remove
              </Button>
            </div>
          </div>
        ))}
        {!queued.length && (
          <p className="fd-small fd-muted">No other sessions queued.</p>
        )}
        {failed.length > 0 && (
          <>
            <div className="fd-section-head">
              <h2>Needs attention</h2>
            </div>
            {failed.map((j) => (
              <div className="fd-list-row" key={j.id}>
                <div className="fd-list-copy">
                  <h3>{j.title}</h3>
                  <p className="fd-small fd-warn">{j.message}</p>
                </div>
                <div className="fd-row-actions">
                  <Button
                    primary
                    disabled={!!busy || !online}
                    onClick={() =>
                      void action(j.id, async () => {
                        await api("/api/jobs/" + j.id + "/retry", {
                          method: "POST",
                        });
                      })
                    }
                  >
                    Retry
                  </Button>
                  <Button
                    disabled={!!busy || !online}
                    onClick={() => {
                      setDialog({ kind: "remove", job: j });
                      setDialogError("");
                    }}
                  >
                    Remove
                  </Button>
                </div>
              </div>
            ))}
          </>
        )}
      </>
    );
  }
  function downloadsView() {
    const visible = completed.filter((j) =>
      (j.title ?? "").toLowerCase().includes(librarySearch.toLowerCase()),
    );
    return (
      <>
        <Heading
          title="Downloads"
          subtitle="One 720p MP4 per replay. Ready to watch or save."
        >
          <Button onClick={() => navigate("browse")}>Browse replays</Button>
        </Heading>
        {!completed.length ? (
          <Empty
            title="Your library starts here"
            onBrowse={() => navigate("browse")}
            icon={<Download />}
          >
            Downloaded replays will appear here, ready for your tablet.
          </Empty>
        ) : (
          <>
            <div className="fd-toolbar">
              <label className="fd-search">
                <Search />
                <input
                  className="fd-input"
                  type="search"
                  aria-label="Search downloads"
                  placeholder="Search your downloads"
                  value={librarySearch}
                  onChange={(e) => setLibrarySearch(e.target.value)}
                />
              </label>
              <span className="fd-muted fd-small">
                {visible.length} downloads
              </span>
            </div>
            <div className="fd-library">
              {visible.map((j) => (
                <article className="fd-session" key={j.id}>
                  <div className="fd-thumb">
                    <Picture src={j.thumbnailUrl} />
                    <span className="fd-thumb-label">
                      {duration(j.durationSeconds)}
                    </span>
                  </div>
                  <div className="fd-card-body">
                    <span className="fd-eyebrow fd-muted">
                      {j.season ?? "Formula 1"} · Replay
                    </span>
                    <h3>{j.title}</h3>
                    <p className="fd-small fd-muted">
                      720p · English · {fileSize(j.file?.size)}
                    </p>
                    {!j.file?.available && (
                      <p className="fd-small fd-warn">
                        {storageReady
                          ? "File is missing"
                          : "Storage is unavailable"}
                      </p>
                    )}
                    <div className="fd-card-footer">
                      <Button
                        primary
                        disabled={!j.file?.available || !storageReady}
                        onClick={() => navigate("watch", { job: j })}
                      >
                        <Play size={16} />
                        Watch
                      </Button>
                      {j.file?.available && storageReady ? (
                        <a
                          className="fd-button"
                          href={j.file.url + "?download=1"}
                        >
                          <Download size={16} />
                          Save MP4
                        </a>
                      ) : (
                        <Button disabled onClick={() => {}}>
                          Save MP4
                        </Button>
                      )}
                      <Button
                        label={"Remove " + j.title}
                        disabled={!storageReady || !!busy}
                        onClick={() => {
                          setDialog({ kind: "remove", job: j });
                          setDialogError("");
                        }}
                      >
                        <Trash2 size={16} />
                      </Button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
            {!visible.length && (
              <Empty
                title="No matching downloads"
                onBrowse={() => setLibrarySearch("")}
                label="Clear search"
              >
                Try another replay name.
              </Empty>
            )}
          </>
        )}
      </>
    );
  }
  function watchView() {
    if (!watched)
      return (
        <>
          <Heading title="Watch" />
          <Empty
            title="Nothing to play yet"
            onBrowse={() => navigate("browse")}
            icon={<Play />}
          >
            Your downloaded replays will be available here.
          </Empty>
        </>
      );
    return (
      <>
        <div className="fd-breadcrumb">
          <button onClick={() => navigate("downloads")}>Downloads</button>
          <span>/ {watched.title}</span>
        </div>
        <div className="fd-player-layout">
          <section>
            {storageReady && watched.file?.available ? (
              <video
                className="fd-player"
                key={watched.id}
                src={watched.file.url}
                controls
                playsInline
                preload="metadata"
                poster={watched.thumbnailUrl || racePhoto}
              />
            ) : (
              <Empty
                title="Replay is unavailable"
                onBrowse={() => navigate("downloads")}
                label="Back to downloads"
              >
                {storageReady
                  ? "The downloaded file is missing."
                  : "Waiting for Synology media storage."}
              </Empty>
            )}
            <div className="fd-watch-info">
              <div>
                <h1>{watched.title}</h1>
                <p className="fd-small fd-muted" style={{ marginTop: 7 }}>
                  {watched.season} · F1 LIVE · English ·{" "}
                  {fileSize(watched.file?.size)}
                </p>
              </div>
              {storageReady && watched.file?.available && (
                <a
                  className="fd-button fd-button-primary"
                  href={watched.file.url + "?download=1"}
                >
                  <Download size={16} />
                  Save MP4
                </a>
              )}
            </div>
            <p className="fd-small fd-muted" style={{ marginTop: 16 }}>
              Save the MP4 to watch offline in your device’s video player.
            </p>
          </section>
          <aside>
            <h2>More from this weekend</h2>
            {watched.eventId && (
              <button
                className="fd-next"
                onClick={() => {
                  const matching = events.find((e) => e.id === watched.eventId);
                  if (matching) navigate("weekend", { event: matching });
                  else {
                    const season = seasons.find(
                      (s) => s.year === watched.season,
                    );
                    navigate("weekend", {
                      eventId: watched.eventId!,
                      seasonId: season?.id,
                    });
                  }
                }}
              >
                <Picture src={watched.thumbnailUrl} />
                <span>
                  View weekend sessions
                  <ArrowRight size={14} />
                </span>
              </button>
            )}
          </aside>
        </div>
      </>
    );
  }
  async function saveAccount(e: FormEvent) {
    e.preventDefault();
    await action("account", async () => {
      await api("/api/settings/credentials", {
        method: "PUT",
        body: JSON.stringify({ username, password }),
      });
      setUsername("");
      setPassword("");
      setEditing(false);
      setToast("Credentials saved securely.");
    });
  }
  function settingsView() {
    return (
      <>
        <Heading
          title="Settings"
          subtitle="Your F1TV account and media storage."
        />
        <div className="fd-settings">
          <section className="fd-setting-panel">
            <h2>F1TV account</h2>
            <div className="fd-account-state">
              <span className="fd-dot" />
              <strong>
                {settings.credentialsConfigured
                  ? "Credentials saved"
                  : settingsLoaded.current
                    ? "Account not connected"
                    : "Checking account"}
              </strong>
            </div>
            <p className="fd-small fd-muted">
              Your saved login is kept securely. Account details are never
              displayed.
            </p>
            {editing || !settings.credentialsConfigured ? (
              <form onSubmit={(e) => void saveAccount(e)}>
                <div className="fd-account-fields">
                  <label className="fd-field">
                    F1TV email
                    <input
                      className="fd-input"
                      autoComplete="username"
                      type="email"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      required
                    />
                  </label>
                  <label className="fd-field">
                    Password
                    <input
                      className="fd-input"
                      autoComplete="current-password"
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </label>
                </div>
                <div className="fd-row-actions">
                  <button
                    className="fd-button fd-button-primary"
                    disabled={!!busy || !settings.encryptionReady || !online}
                  >
                    Save credentials
                  </button>
                  {settings.credentialsConfigured && (
                    <Button
                      disabled={!!busy}
                      onClick={() => {
                        setEditing(false);
                        setPassword("");
                        setUsername("");
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
            ) : (
              <div className="fd-row-actions">
                <Button onClick={() => setEditing(true)}>
                  Replace credentials
                </Button>
                <Button
                  onClick={() => {
                    setDialog({ kind: "account" });
                    setDialogError("");
                  }}
                >
                  Remove
                </Button>
              </div>
            )}
            <div className="fd-section-head">
              <h2>Download format</h2>
            </div>
            {[
              ["Resolution", "720p"],
              ["Feed", "F1 LIVE"],
              ["Audio", "English only"],
              ["File", "MP4"],
            ].map(([k, v]) => (
              <div className="fd-setting-line" key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </section>
          <section className="fd-setting-panel">
            <h2>Media storage</h2>
            <div className="fd-account-state">
              <span
                className="fd-dot"
                style={
                  !storageReady ? { background: "var(--fd-amber)" } : undefined
                }
              />
              <strong>
                {storageReady ? "Synology connected" : "Waiting for Synology"}
              </strong>
            </div>
            <p className="fd-storage-name">Homelab-workspace / f1tv-dl</p>
            {storageReady ? (
              <>
                <div className="fd-setting-line">
                  <span>Available space</span>
                  <strong>{fileSize(settings.storage.freeBytes)}</strong>
                </div>
                <div className="fd-setting-line">
                  <span>Downloads</span>
                  <strong>{completed.length} files</strong>
                </div>
              </>
            ) : (
              <div className="fd-notice">{settings.storage.message}</div>
            )}
            <p className="fd-small fd-muted" style={{ marginTop: 16 }}>
              Media is saved to Synology. Your account and queue stay on the
              server.
            </p>
            <Button
              disabled={!!busy || !online}
              onClick={() =>
                void action("storage", async () => {
                  await syncSettings();
                  setToast("Storage status updated.");
                })
              }
            >
              Check connection
            </Button>
          </section>
        </div>
      </>
    );
  }
  async function confirmDialog() {
    if (!dialog) return;
    setBusy("dialog");
    setDialogError("");
    try {
      if (dialog.kind === "account")
        await api("/api/settings/credentials", { method: "DELETE" });
      else if (dialog.kind === "cancel")
        await api("/api/jobs/" + dialog.job!.id + "/cancel", {
          method: "POST",
        });
      else {
        const id = dialog.job!.id;
        await api("/api/jobs/" + id, { method: "DELETE" });
        versions.current.set(id, (versions.current.get(id) ?? 0) + 1);
        setJobs((current) => current.filter((j) => j.id !== id));
      }
      await Promise.all([syncJobs(), syncSettings()]);
      setDialog(null);
    } catch (e) {
      setDialogError(
        e instanceof Error ? e.message : "The action could not complete",
      );
    } finally {
      setBusy(null);
    }
  }
  return (
    <div id="f1-app" data-appearance="Dark" data-photo="Natural">
      <div className="fd-stage">
        <div className="fd-window">
          <header className="fd-app-header">
            <button
              className="fd-brand"
              onClick={() => navigate("browse")}
              aria-label="F1TV Downloads home"
            >
              <span className="fd-brand-mark">F1</span>
              <span>TV DOWNLOADS</span>
            </button>
            <nav className="fd-top-nav" aria-label="App navigation">
              {navigation()}
            </nav>
            <span className="fd-online">
              <span
                className="fd-dot"
                style={
                  !online || !storageReady
                    ? { background: "var(--fd-amber)" }
                    : undefined
                }
              />
              {!online
                ? "Reconnecting"
                : !storageReady
                  ? "Storage offline"
                  : "Connected"}
            </span>
          </header>
          {!online ? (
            <div className="fd-notice fd-app-notice" role="status">
              Connection lost. Reconnecting… Your queue is saved.
            </div>
          ) : !storageReady ? (
            <div className="fd-notice fd-app-notice" role="status">
              <span>Media storage is unavailable. Downloads are waiting.</span>
              <Button onClick={() => navigate("settings")}>View storage</Button>
            </div>
          ) : !settings.storage.enoughSpace ? (
            <div className="fd-notice fd-app-notice">
              Media storage is low on free space. New downloads are waiting.
            </div>
          ) : null}
          {!settings.credentialsConfigured &&
            settingsLoaded.current &&
            screen !== "settings" && (
              <div className="fd-notice fd-app-notice">
                <span>Connect your F1TV account to download replays.</span>
                <Button onClick={() => navigate("settings")}>
                  Connect account
                </Button>
              </div>
            )}
          <main className="fd-main">
            {error && (
              <div className="fd-notice fd-error" role="alert">
                {error}
              </div>
            )}
            {warning && ["browse", "weekend"].includes(screen) && (
              <div className="fd-notice" role="status">
                Showing cached catalog data. {warning}
              </div>
            )}
            {screen === "browse"
              ? browseView()
              : screen === "weekend"
                ? weekendView()
                : screen === "queue"
                  ? queueView()
                  : screen === "downloads"
                    ? downloadsView()
                    : screen === "watch"
                      ? watchView()
                      : settingsView()}
          </main>
          {toast && (
            <div className="fd-toast" role="status">
              {toast}
            </div>
          )}
          <footer className="fd-app-footer">
            <span>720p · English · F1 LIVE</span>
            <span>
              {storageReady ? "Saved to Synology" : "Waiting for media storage"}
            </span>
          </footer>
          <nav className="fd-mobile-nav" aria-label="Mobile app navigation">
            {navigation(true)}
          </nav>
        </div>
      </div>
      {dialog && (
        <Modal
          title={
            dialog.kind === "account"
              ? "Remove saved credentials?"
              : dialog.kind === "remove"
                ? "Remove this replay?"
                : dialog.job?.status === "running"
                  ? "Cancel this download?"
                  : "Remove this job?"
          }
          label={
            dialog.kind === "account"
              ? "Remove credentials"
              : dialog.kind === "remove"
                ? "Remove replay"
                : "Cancel download"
          }
          busy={busy === "dialog"}
          error={dialogError}
          onClose={() => {
            setDialog(null);
            setDialogError("");
          }}
          onConfirm={() => void confirmDialog()}
        >
          {dialog.job && <p>{dialog.job.title}</p>}
          <p>
            {dialog.kind === "account"
              ? "You can continue browsing. New downloads will need your F1TV account again."
              : dialog.kind === "remove"
                ? "The MP4 will be deleted from Synology and removed from Downloads."
                : "The download will stop and its unfinished file will be removed."}
          </p>
        </Modal>
      )}
    </div>
  );
}
