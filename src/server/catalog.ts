import type { AppDatabase } from "./database";

const BASE_URL = "https://f1tv.formula1.com";
const CALENDAR_BASE_URL = "https://www.formula1.com";
const MENU_PATH = "/2.0/A/ENG/WEB_DASH/ALL/MENU/ANONYMOUS/2";
const CACHE_TTL_MS = 15 * 60 * 1000;

type JsonObject = Record<string, unknown>;

export interface CatalogSeason {
  id: string;
  year: number;
  title: string;
  current: boolean;
}

export interface CatalogEvent {
  id: string;
  seasonId: string;
  season: number;
  round: number | null;
  title: string;
  country: string | null;
  startDate: string | null;
  endDate: string | null;
  complete: boolean;
  status: CatalogEventStatus;
  replayAvailable: boolean;
  thumbnailUrl: string | null;
}

export type CatalogEventStatus = "completed" | "current" | "future";

export interface CalendarEvent {
  round: number;
  season: number;
  title: string;
  country: string;
  startDate: string;
  endDate: string;
}

export type CatalogSessionType = "Practice" | "Qualifying" | "Sprint Qualifying" | "Sprint" | "Race";

export interface CatalogSession {
  id: string;
  eventId: string;
  title: string;
  type: CatalogSessionType;
  startDate: string | null;
  endDate: string | null;
  durationSeconds: number | null;
  durationLabel: string | null;
  thumbnailUrl: string | null;
  available: boolean;
  url: string;
}

export interface CatalogResult<T> {
  data: T;
  refreshedAt: string;
  stale: boolean;
  warning?: string;
}

export type CatalogFetch = (path: string) => Promise<unknown>;
export type CalendarFetch = (year: number) => Promise<string>;

interface CacheEnvelope<T> {
  fetchedAt: string;
  data: T;
}

function object(value: unknown): JsonObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : null;
}

function text(value: unknown, max = 240): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function number(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
}

function walk(value: unknown, output: JsonObject[] = []): JsonObject[] {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, output);
    return output;
  }
  const candidate = object(value);
  if (!candidate) return output;
  output.push(candidate);
  for (const child of Object.values(candidate)) walk(child, output);
  return output;
}

function actionFor(candidate: JsonObject): JsonObject | null {
  const actions = Array.isArray(candidate.actions) ? candidate.actions : [];
  return object(actions[0]);
}

function metadataFor(candidate: JsonObject): JsonObject {
  return object(candidate.metadata) ?? {};
}

function attributesFor(metadata: JsonObject): JsonObject {
  return object(metadata.emfAttributes) ?? {};
}

function pageIdFromAction(action: JsonObject | null): string | null {
  const uri = text(action?.uri, 500);
  const match = uri.match(/\/PAGE\/(\d+)\//i);
  return match?.[1] ?? null;
}

function isoDate(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return new Date(value).toISOString();
  }
  const raw = text(value, 80);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function thumbnailUrl(value: unknown): string | null {
  const image = text(value, 500);
  if (!/^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+$/.test(image)) return null;
  return `${BASE_URL}/image-resizer/image/${image}?w=640&h=360&o=L`;
}

function canonicalDetailUrl(action: JsonObject | null, contentId: string): string | null {
  const href = text(action?.href, 1200);
  if (!href) return null;
  let url: URL;
  try {
    url = new URL(href, BASE_URL);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.hostname !== "f1tv.formula1.com") return null;
  if (!new RegExp(`^/detail/${contentId}/[a-z0-9][a-z0-9-]*$`, "i").test(url.pathname)) return null;
  url.search = "";
  url.hash = "";
  return url.toString();
}

function decodeHtml(value: string): string {
  const codePoint = (raw: string, radix: number): string => {
    const parsed = Number.parseInt(raw, radix);
    return parsed >= 0 && parsed <= 0x10ffff ? String.fromCodePoint(parsed) : "";
  };
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_match, code: string) => codePoint(code, 10))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => codePoint(code, 16));
}

function plainText(html: string): string {
  return decodeHtml(html.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();
}

function calendarDates(value: string, year: number): { startDate: string; endDate: string } | null {
  const months: Record<string, number> = {
    jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
    jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
  };
  const crossMonth = value.match(/\b(\d{1,2})\s+([A-Za-z]{3})\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\b/i);
  const sameMonth = value.match(/\b(\d{1,2})\s*-\s*(\d{1,2})\s+([A-Za-z]{3})\b/i);
  const startDay = Number(crossMonth?.[1] ?? sameMonth?.[1]);
  const endDay = Number(crossMonth?.[3] ?? sameMonth?.[2]);
  const startMonth = months[(crossMonth?.[2] ?? sameMonth?.[3] ?? "").toLowerCase()];
  const endMonth = months[(crossMonth?.[4] ?? sameMonth?.[3] ?? "").toLowerCase()];
  if (!startDay || !endDay || startMonth === undefined || endMonth === undefined) return null;
  const start = new Date(Date.UTC(year, startMonth, startDay));
  const end = new Date(Date.UTC(year, endMonth, endDay, 23, 59, 59, 999));
  if (start.getUTCDate() !== startDay || end.getUTCDate() !== endDay) return null;
  return { startDate: start.toISOString(), endDate: end.toISOString() };
}

function eventStatus(startDate: string | null, endDate: string | null, now: Date, fallbackComplete = false): CatalogEventStatus {
  const start = startDate ? new Date(startDate).getTime() : Number.NaN;
  const end = endDate ? new Date(endDate).getTime() : Number.NaN;
  if (Number.isFinite(start) && now.getTime() < start) return "future";
  if (Number.isFinite(end) && now.getTime() <= end) return "current";
  return fallbackComplete || Number.isFinite(end) ? "completed" : "future";
}

export function parseCalendar(html: string, year: number): CalendarEvent[] {
  if (!Number.isInteger(year) || year < 1950 || year > 2100 || html.length > 5_000_000) return [];
  const events = new Map<number, CalendarEvent>();
  const anchorPattern = /<a\b(?=[^>]*\bhref="\/en\/racing\/(\d{4})\/([^"]+)")(?=[^>]*\bdata-f1rd-a7s-context="([^"]+)")[^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(anchorPattern)) {
    if (Number(match[1]) !== year || /pre-season-testing/i.test(match[2] ?? "")) continue;
    const body = plainText(match[4] ?? "");
    const round = Number(body.match(/\bROUND\s+(\d{1,2})\b/i)?.[1]);
    const dates = calendarDates(body, year);
    if (!Number.isInteger(round) || round < 1 || round > 30 || !dates) continue;
    try {
      const context = JSON.parse(Buffer.from(match[3] ?? "", "base64").toString("utf8")) as JsonObject;
      const title = text(context.raceName);
      const country = text(context.trackCountry, 120);
      if (!/FORMULA 1/i.test(title) || !/GRAND PRIX|GRAN PREMIO|GRANDE PRÊMIO/i.test(title) || !country) continue;
      events.set(round, { round, season: year, title, country, ...dates });
    } catch {
      continue;
    }
  }
  return [...events.values()].sort((left, right) => left.round - right.round);
}

export function mergeCalendarEvents(
  season: CatalogSeason,
  providerEvents: CatalogEvent[],
  calendarEvents: CalendarEvent[],
  now = new Date()
): CatalogEvent[] {
  const providerByRound = new Map(providerEvents.filter((event) => event.round !== null).map((event) => [event.round as number, event]));
  const merged: CatalogEvent[] = calendarEvents.map((scheduled) => {
    const provider = providerByRound.get(scheduled.round);
    const status = eventStatus(scheduled.startDate, scheduled.endDate, now);
    return {
      id: provider?.id ?? `c${season.year}-r${scheduled.round}`,
      seasonId: season.id,
      season: season.year,
      round: scheduled.round,
      title: provider?.title || scheduled.title,
      country: provider?.country || scheduled.country,
      startDate: scheduled.startDate,
      endDate: scheduled.endDate,
      complete: status === "completed",
      status,
      replayAvailable: Boolean(provider),
      thumbnailUrl: provider?.thumbnailUrl ?? null
    } satisfies CatalogEvent;
  });
  const knownIds = new Set(merged.filter((event) => event.replayAvailable).map((event) => event.id));
  for (const provider of providerEvents) {
    if (!knownIds.has(provider.id) && !merged.some((event) => event.round !== null && event.round === provider.round)) merged.push(provider);
  }
  return merged.sort((left, right) => (left.round ?? 999) - (right.round ?? 999) || left.title.localeCompare(right.title));
}

function classifySession(metadata: JsonObject): CatalogSessionType | null {
  const genres = Array.isArray(metadata.genres) ? metadata.genres.map((item) => text(item, 80)).join(" ") : "";
  const title = `${text(metadata.title)} ${text(metadata.titleBrief)} ${genres}`.toLowerCase();
  if (/kids|highlight|show|warm-up|conference|analysis|documentary/.test(title)) return null;
  if (/sprint qualifying|sprint shootout/.test(title)) return "Sprint Qualifying";
  if (/qualifying/.test(title)) return "Qualifying";
  if (/sprint/.test(title)) return "Sprint";
  if (/practice/.test(title)) return "Practice";
  if (/race|grand prix/.test(title)) return "Race";
  return null;
}

export function parseSeasons(menu: unknown, archive: unknown): CatalogSeason[] {
  const found = new Map<number, CatalogSeason>();
  const scan = (input: unknown, current: boolean): void => {
    for (const candidate of walk(input)) {
      const metadata = metadataFor(candidate);
      const attributes = attributesFor(metadata);
      const pageId = pageIdFromAction(actionFor(candidate));
      const year = number(metadata.season)
        ?? number(object((Array.isArray(candidate.properties) ? candidate.properties[0] : null))?.season)
        ?? Number((text(metadata.title) || text(metadata.label) || text(attributes.Global_Meeting_Name)).match(/\b(19|20)\d{2}\b/)?.[0]);
      if (!pageId || !Number.isInteger(year) || year < 1950 || year > 2100) continue;
      const label = `${text(metadata.title)} ${text(metadata.label)} ${text(attributes.Global_Meeting_Name)}`;
      if (!/season/i.test(label) && metadata.contentSubtype !== "MEETING") continue;
      const existing = found.get(year);
      if (!existing || current) found.set(year, { id: pageId, year, title: `${year} Season`, current });
    }
  };
  scan(menu, true);
  scan(archive, false);
  const seasons = [...found.values()].sort((left, right) => right.year - left.year);
  if (!seasons.some((season) => season.current) && seasons.length) seasons[0].current = true;
  return seasons;
}

function parseProviderSession(candidate: JsonObject, eventId: string, now: Date, meetingKey?: string, expectedSeason?: number): CatalogSession | null {
  const metadata = metadataFor(candidate);
  const attributes = attributesFor(metadata);
  if (text(attributes.Series).toUpperCase() !== "FORMULA 1") return null;
  if (text(metadata.contentSubtype).toUpperCase() !== "REPLAY") return null;
  if (meetingKey && text(attributes.MeetingKey) !== meetingKey) return null;
  const season = number(metadata.season) ?? number(metadata.year);
  if (expectedSeason && season !== expectedSeason) return null;
  const type = classifySession(metadata);
  if (!type) return null;
  const id = String(number(metadata.contentId) ?? number(candidate.id) ?? "");
  if (!/^\d+$/.test(id)) return null;
  const url = canonicalDetailUrl(actionFor(candidate), id);
  if (!url) return null;
  const endDate = isoDate(attributes.sessionEndTime) ?? isoDate(attributes.sessionEndDate);
  const available = endDate ? new Date(endDate).getTime() <= now.getTime() : Boolean(season && season < now.getUTCFullYear());
  const duration = number(metadata.duration);
  return {
    id,
    eventId,
    title: text(metadata.title) || text(metadata.titleBrief) || `F1 session ${id}`,
    type,
    startDate: isoDate(attributes.sessionStartTime) ?? isoDate(attributes.sessionStartDate),
    endDate,
    durationSeconds: duration && duration > 0 ? duration : null,
    durationLabel: text(metadata.uiDuration, 40) || null,
    thumbnailUrl: thumbnailUrl(metadata.pictureUrl),
    available,
    url
  };
}

export function parseSessions(input: unknown, eventId: string, now = new Date(), meetingKey?: string, expectedSeason?: number): CatalogSession[] {
  const sessions = new Map<string, CatalogSession>();
  for (const candidate of walk(input)) {
    const session = parseProviderSession(candidate, eventId, now, meetingKey, expectedSeason);
    if (session) sessions.set(session.id, session);
  }
  return [...sessions.values()].sort((left, right) => {
    const leftTime = left.startDate ? new Date(left.startDate).getTime() : 0;
    const rightTime = right.startDate ? new Date(right.startDate).getTime() : 0;
    return rightTime - leftTime || right.id.localeCompare(left.id);
  });
}

export function parseEvents(input: unknown, season: CatalogSeason, now = new Date()): CatalogEvent[] {
  const events = new Map<string, CatalogEvent>();
  for (const candidate of walk(input)) {
    const metadata = metadataFor(candidate);
    const attributes = attributesFor(metadata);
    const pageId = pageIdFromAction(actionFor(candidate));
    const isMeeting = text(metadata.contentSubtype).toUpperCase() === "MEETING" || text(attributes.VideoType).toLowerCase() === "meetings";
    const isTest = text(attributes.IsTestEvent).toLowerCase() === "true" || /test/i.test(text(attributes.Meeting_Name));
    const title = text(attributes.Meeting_Official_Name) || text(attributes.Global_Title) || text(metadata.title);
    if (pageId && isMeeting && !isTest && /grand prix|gran premio|grande prêmio/i.test(title)) {
      const startDate = isoDate(attributes.Meeting_Start_Date);
      const endDate = isoDate(attributes.Meeting_End_Date);
      const status = eventStatus(startDate, endDate, now);
      const id = `p${pageId}`;
      events.set(id, {
        id,
        seasonId: season.id,
        season: season.year,
        round: number(attributes.Meeting_Number),
        title,
        country: text(attributes.Meeting_Country_Name) || null,
        startDate,
        endDate,
        complete: status === "completed",
        status,
        replayAvailable: true,
        thumbnailUrl: thumbnailUrl(metadata.pictureUrl)
      });
    }
  }

  if (events.size === 0) {
    for (const candidate of walk(input)) {
      const metadata = metadataFor(candidate);
      const attributes = attributesFor(metadata);
      const meetingKey = text(attributes.MeetingKey, 40);
      const session = parseProviderSession(candidate, "temporary", now);
      if (!session || !/^\d+$/.test(meetingKey)) continue;
      const id = `s${season.id}-m${meetingKey}`;
      if (!events.has(id)) {
        events.set(id, {
          id,
          seasonId: season.id,
          season: season.year,
          round: number(attributes.Meeting_Number),
          title: text(attributes.Global_Meeting_Name) || text(attributes.Meeting_Name) || session.title,
          country: text(attributes.Meeting_Country_Name) || null,
          startDate: session.startDate,
          endDate: session.endDate,
          complete: true,
          status: "completed",
          replayAvailable: true,
          thumbnailUrl: session.thumbnailUrl
        });
      }
    }
  }

  return [...events.values()].sort((left, right) => (left.round ?? 999) - (right.round ?? 999) || left.title.localeCompare(right.title));
}

export function createCatalogFetch(): CatalogFetch {
  return async (path: string): Promise<unknown> => {
    if (!/^\/(?:1|2|3|4)\.0\//.test(path)) throw new Error("F1TV returned an unsupported catalog path");
    const url = new URL(path, BASE_URL);
    if (url.hostname !== "f1tv.formula1.com" || url.protocol !== "https:") throw new Error("F1TV returned an unsupported catalog host");
    const response = await fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "F1TV-DL-WebUI/0.1" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`F1TV catalog request failed (${response.status})`);
    return response.json();
  };
}

export function createCalendarFetch(): CalendarFetch {
  return async (year: number): Promise<string> => {
    if (!Number.isInteger(year) || year < 1950 || year > 2100) throw new Error("Invalid Formula 1 calendar year");
    const url = new URL(`/en/racing/${year}`, CALENDAR_BASE_URL);
    if (url.hostname !== "www.formula1.com" || url.protocol !== "https:") throw new Error("Formula 1 returned an unsupported calendar host");
    const response = await fetch(url, {
      headers: { Accept: "text/html", "User-Agent": "F1TV-DL-WebUI/0.1" },
      signal: AbortSignal.timeout(20_000)
    });
    if (!response.ok) throw new Error(`Formula 1 calendar request failed (${response.status})`);
    return response.text();
  };
}

export class CatalogService {
  constructor(
    private readonly db: AppDatabase,
    private readonly fetchJson: CatalogFetch = createCatalogFetch(),
    private readonly now: () => Date = () => new Date(),
    private readonly fetchCalendar: CalendarFetch = createCalendarFetch()
  ) {}

  private readCache<T>(key: string): CacheEnvelope<T> | null {
    const raw = this.db.getSetting(`catalog:${key}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as CacheEnvelope<T>;
      if (!parsed.fetchedAt || parsed.data === undefined) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private writeCache<T>(key: string, data: T): CacheEnvelope<T> {
    const envelope = { fetchedAt: this.now().toISOString(), data };
    this.db.setSetting(`catalog:${key}`, JSON.stringify(envelope));
    return envelope;
  }

  private async cached<T>(key: string, refresh: boolean, loader: () => Promise<T>): Promise<CatalogResult<T>> {
    const cached = this.readCache<T>(key);
    const age = cached ? this.now().getTime() - new Date(cached.fetchedAt).getTime() : Number.POSITIVE_INFINITY;
    if (!refresh && cached && age < CACHE_TTL_MS) return { data: cached.data, refreshedAt: cached.fetchedAt, stale: false };
    try {
      const fresh = this.writeCache(key, await loader());
      return { data: fresh.data, refreshedAt: fresh.fetchedAt, stale: false };
    } catch (error) {
      if (cached) {
        return {
          data: cached.data,
          refreshedAt: cached.fetchedAt,
          stale: true,
          warning: error instanceof Error ? error.message : "F1TV catalog refresh failed"
        };
      }
      throw error;
    }
  }

  async seasons(refresh = false): Promise<CatalogResult<CatalogSeason[]>> {
    return this.cached("seasons", refresh, async () => {
      const menu = await this.fetchJson(MENU_PATH);
      const archiveItem = walk(menu).find((candidate) => /archive/i.test(text(metadataFor(candidate).label)) && pageIdFromAction(actionFor(candidate)));
      const archiveId = pageIdFromAction(actionFor(archiveItem ?? {}));
      if (!archiveId) throw new Error("F1TV archive page was not present in the catalog menu");
      const archive = await this.fetchJson(this.pagePath(archiveId));
      const seasons = parseSeasons(menu, archive);
      if (!seasons.length || !seasons.some((season) => season.current)) throw new Error("F1TV current season could not be discovered");
      return seasons;
    });
  }

  async events(seasonId: string, refresh = false): Promise<CatalogResult<CatalogEvent[]>> {
    if (!/^\d+$/.test(seasonId)) throw new Error("Invalid season identifier");
    const seasons = await this.seasons(false);
    const season = seasons.data.find((candidate) => candidate.id === seasonId);
    if (!season) throw new Error("Season is not available in the F1TV catalog");
    let calendarWarning: string | undefined;
    const result = await this.cached(`events:v2:${seasonId}`, refresh, async () => {
      const providerEvents = parseEvents(await this.fetchJson(this.pagePath(seasonId)), season, this.now());
      if (!providerEvents.length) throw new Error("F1TV returned no Formula 1 events for this season");
      if (!season.current) return providerEvents;
      try {
        const calendar = await this.calendar(season.year, refresh);
        calendarWarning = calendar.warning;
        return mergeCalendarEvents(season, providerEvents, calendar.data, this.now());
      } catch (error) {
        calendarWarning = error instanceof Error ? error.message : "Formula 1 calendar refresh failed";
        return providerEvents;
      }
    });
    for (const event of result.data) this.db.setSetting(`catalog:event:${event.id}`, JSON.stringify(event));
    return calendarWarning ? { ...result, stale: true, warning: calendarWarning } : result;
  }

  async sessions(eventId: string, refresh = false): Promise<CatalogResult<CatalogSession[]>> {
    if (!/^(?:p\d+|s\d+-m\d+)$/.test(eventId)) throw new Error("Invalid event identifier");
    const eventReference = this.db.getSetting(`catalog:event:${eventId}`);
    if (!eventReference) throw new Error("Event is not present in the discovered F1TV catalog");
    const event = JSON.parse(eventReference) as CatalogEvent;
    return this.cached(`sessions:${eventId}`, refresh, async () => {
      const pageMatch = eventId.match(/^p(\d+)$/);
      const archiveMatch = eventId.match(/^s(\d+)-m(\d+)$/);
      const pageId = pageMatch?.[1] ?? archiveMatch?.[1];
      if (!pageId) throw new Error("Invalid event identifier");
      const sessions = parseSessions(await this.fetchJson(this.pagePath(pageId)), eventId, this.now(), archiveMatch?.[2], event.season);
      if (!sessions.length) throw new Error("F1TV returned no supported Formula 1 sessions for this event");
      return sessions;
    });
  }

  private pagePath(pageId: string): string {
    return `/2.0/A/ENG/WEB_DASH/ALL/PAGE/${pageId}/ANONYMOUS/2`;
  }

  private async calendar(year: number, refresh: boolean): Promise<CatalogResult<CalendarEvent[]>> {
    return this.cached(`calendar:v1:${year}`, refresh, async () => {
      const events = parseCalendar(await this.fetchCalendar(year), year);
      if (!events.length) throw new Error("Formula 1 returned no scheduled races for this season");
      return events;
    });
  }
}
