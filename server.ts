import 'dotenv/config';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { Request, Response } from 'express';
import { createServer as createViteServer } from 'vite';
import type {
  AteraAgent,
  AteraAlert,
  AteraCustomer,
  AteraTicket,
  CategoryScoreBreakdown,
  DashboardPayload,
  DefenderAlert,
  GlobalAdminMember,
  ManagedDeviceItem,
  ManagedDeviceSummary,
  RiskyUserSummary,
  SecureScoreControlItem,
  SecureScoreHistoryPoint,
  TenantConnectionSummary,
} from './src/types.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const DATA_DIR = path.join(__dirname, 'data');
const STORE_PATH = path.join(DATA_DIR, 'msp-store.json');

interface StoredTenantRecord {
  id: string;
  tenantId: string;
  displayName: string;
  primaryDomain: string | null;
  authMode: 'delegated' | 'app_only';
  refreshToken: string | null;
  ateraCustomerId: number | null;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'partial' | 'error' | 'pending';
  lastSyncError: string | null;
  permissionsNotes: string[];
  secureScore: TenantConnectionSummary['secureScore'];
  scoreHistory: SecureScoreHistoryPoint[];
  categoryBreakdown: CategoryScoreBreakdown[];
  controls: SecureScoreControlItem[];
  defenderAlerts: DefenderAlert[];
  managedDevices: ManagedDeviceSummary | null;
  globalAdmins?: GlobalAdminMember[];
  riskyUsers?: RiskyUserSummary[];
}

interface MspStore {
  atera: {
    tokenOverride: string | null;
    tokenUpdatedAt: string | null;
    lastSync: string | null;
    lastError: string | null;
    customers: AteraCustomer[];
    agents: AteraAgent[];
    alerts: AteraAlert[];
    tickets: AteraTicket[];
  };
  tenants: StoredTenantRecord[];
}

interface OAuthStateEntry {
  createdAt: number;
  ateraCustomerId: number | null;
  flow: 'oauth' | 'adminconsent';
  requestedTenant: string;
}

const oauthStates = new Map<string, OAuthStateEntry>();

function cleanupExpiredStates() {
  const now = Date.now();
  for (const [key, entry] of oauthStates.entries()) {
    if (now - entry.createdAt > 15 * 60 * 1000) {
      oauthStates.delete(key);
    }
  }
}

function defaultStore(): MspStore {
  return {
    atera: {
      tokenOverride: null,
      tokenUpdatedAt: null,
      lastSync: null,
      lastError: null,
      customers: [],
      agents: [],
      alerts: [],
      tickets: [],
    },
    tenants: [],
  };
}

function loadStore(): MspStore {
  try {
    if (!fs.existsSync(STORE_PATH)) {
      return defaultStore();
    }
    const raw = fs.readFileSync(STORE_PATH, 'utf8');
    const parsed = JSON.parse(raw) as Partial<MspStore>;
    return {
      atera: {
        tokenOverride: typeof parsed.atera?.tokenOverride === 'string' ? parsed.atera.tokenOverride : null,
        tokenUpdatedAt: typeof parsed.atera?.tokenUpdatedAt === 'string' ? parsed.atera.tokenUpdatedAt : null,
        lastSync: parsed.atera?.lastSync ?? null,
        lastError: parsed.atera?.lastError ?? null,
        customers: Array.isArray(parsed.atera?.customers) ? parsed.atera!.customers : [],
        agents: Array.isArray(parsed.atera?.agents) ? parsed.atera!.agents : [],
        alerts: Array.isArray(parsed.atera?.alerts) ? parsed.atera!.alerts : [],
        tickets: Array.isArray(parsed.atera?.tickets) ? parsed.atera!.tickets : [],
      },
      tenants: Array.isArray(parsed.tenants) ? parsed.tenants : [],
    };
  } catch (err) {
    console.error('Failed to read store, initializing fresh store:', err);
    return defaultStore();
  }
}

function saveStore(store: MspStore) {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(store, null, 2), 'utf8');
  fs.renameSync(tmpPath, STORE_PATH);
}

function getAppBaseUrl(req?: Request): string {
  const envUrl = process.env.APP_URL?.trim();
  if (envUrl && envUrl !== 'MY_APP_URL') {
    return envUrl.replace(/\/+$/, '');
  }
  if (req) {
    const proto = (req.headers['x-forwarded-proto'] as string) || req.protocol || 'http';
    const host = (req.headers['x-forwarded-host'] as string) || req.get('host') || `localhost:${PORT}`;
    return `${proto}://${host}`.replace(/\/+$/, '');
  }
  return `http://localhost:${PORT}`;
}

function getMicrosoftRedirectUri(req?: Request): string {
  return `${getAppBaseUrl(req)}/auth/microsoft/callback`;
}

function cleanEnv(name: string): string {
  const raw = process.env[name]?.trim() || '';
  return raw.replace(/^["']|["']$/g, '').trim();
}

function getEffectiveAteraToken(store: MspStore): { token: string; source: 'override' | 'env' | 'none' } {
  const override = store.atera.tokenOverride?.trim().replace(/^["']|["']$/g, '').trim() || '';
  if (override) {
    return { token: override, source: 'override' };
  }
  const envVal = cleanEnv('ATERA_API_KEY');
  if (envVal) {
    return { token: envVal, source: 'env' };
  }
  return { token: '', source: 'none' };
}

function getAteraTokenMetadata(store: MspStore): DashboardPayload['status']['ateraTokenInfo'] {
  const { token, source } = getEffectiveAteraToken(store);
  const base = {
    source,
    isJwt: false,
    expiresAt: null as string | null,
    isExpired: false,
    accountId: null as string | null,
    region: null as string | null,
    environment: null as string | null,
    updatedAt: source === 'override' ? store.atera.tokenUpdatedAt : null,
  };

  if (!token) return base;

  const parts = token.split('.');
  if (parts.length !== 3) return base;

  try {
    const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as {
      exp?: number;
      accountId?: string;
      region?: string;
      env?: string;
    };
    const expMs = typeof claims.exp === 'number' ? claims.exp * 1000 : null;
    return {
      source,
      isJwt: true,
      expiresAt: expMs ? new Date(expMs).toISOString() : null,
      isExpired: expMs ? Date.now() >= expMs : false,
      accountId: typeof claims.accountId === 'string' ? claims.accountId : null,
      region: typeof claims.region === 'string' ? claims.region : null,
      environment: typeof claims.env === 'string' ? claims.env : null,
      updatedAt: source === 'override' ? store.atera.tokenUpdatedAt : null,
    };
  } catch {
    return base;
  }
}

function isAteraConfigured(store?: MspStore): boolean {
  if (store) return getEffectiveAteraToken(store).source !== 'none';
  return Boolean(cleanEnv('ATERA_API_KEY'));
}

function isMicrosoftConfigured(): boolean {
  return Boolean(cleanEnv('MS_GRAPH_CLIENT_ID') && cleanEnv('MS_GRAPH_CLIENT_SECRET'));
}

function toPublicTenant(record: StoredTenantRecord): TenantConnectionSummary {
  const { refreshToken: _omit, ...rest } = record;
  return rest;
}

function buildDashboardPayload(store: MspStore, req?: Request): DashboardPayload {
  return {
    status: {
      ateraConfigured: isAteraConfigured(store),
      ateraTokenInfo: getAteraTokenMetadata(store),
      microsoftConfigured: isMicrosoftConfigured(),
      microsoftClientId: cleanEnv('MS_GRAPH_CLIENT_ID') || null,
      redirectUri: getMicrosoftRedirectUri(req),
      lastAteraSync: store.atera.lastSync,
      lastAteraError: store.atera.lastError,
      connectedTenantsCount: store.tenants.length,
      ateraCustomersCount: store.atera.customers.length,
    },
    atera: {
      customers: store.atera.customers,
      agents: store.atera.agents,
      alerts: store.atera.alerts,
      tickets: store.atera.tickets,
    },
    tenants: store.tenants.map(toPublicTenant),
  };
}

// ---------------------------------------------------------------------------
// Atera RMM v3 API Integration
// ---------------------------------------------------------------------------

function normalizeTokenValue(raw: string): string {
  return raw.trim().replace(/^Bearer\s+/i, '').replace(/^["']|["']$/g, '').trim();
}

async function fetchAteraWithAuthFallback(url: string, rawToken: string): Promise<globalThis.Response> {
  const token = normalizeTokenValue(rawToken);
  const looksLikeJwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token);

  const primaryHeaders: Record<string, string> = looksLikeJwt
    ? { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'AegisMSP/1.0' }
    : { 'X-API-KEY': token, Accept: 'application/json', 'User-Agent': 'AegisMSP/1.0' };

  const primaryRes = await fetch(url, { headers: primaryHeaders });
  if (primaryRes.status !== 401) {
    return primaryRes;
  }

  // Fallback to alternate Atera header format if 401
  const fallbackHeaders: Record<string, string> = looksLikeJwt
    ? { 'X-API-KEY': token, Accept: 'application/json', 'User-Agent': 'AegisMSP/1.0' }
    : { Authorization: `Bearer ${token}`, Accept: 'application/json', 'User-Agent': 'AegisMSP/1.0' };

  return fetch(url, { headers: fallbackHeaders });
}

async function fetchAteraPaginated<T>(
  endpoint: string,
  apiKey: string,
  maxPages = 5,
  itemsInPage = 50,
  shouldStop?: (pageItems: T[]) => boolean
): Promise<T[]> {
  const items: T[] = [];
  const sep = endpoint.includes('?') ? '&' : '?';
  for (let page = 1; page <= maxPages; page++) {
    const url = `https://app.atera.com/api/v3/${endpoint}${sep}page=${page}&itemsInPage=${itemsInPage}`;
    const res = await fetchAteraWithAuthFallback(url, apiKey);
    const rawText = await res.text().catch(() => '');
    const looksLikeHtml = rawText.trimStart().startsWith('<');

    if (!res.ok) {
      if (res.status === 401) {
        throw new Error(
          `Atera API ${endpoint} HTTP 401 Unauthorized — update your Atera token in Integrations & Setup or verify ATERA_API_KEY.`
        );
      }
      const detail = looksLikeHtml ? `HTML error page (${res.statusText})` : rawText.slice(0, 200) || res.statusText;
      throw new Error(`Atera API ${endpoint} HTTP ${res.status}: ${detail}`);
    }

    if (looksLikeHtml) {
      throw new Error(
        `Atera API ${endpoint} returned an HTML page (HTTP ${res.status}) instead of JSON.`
      );
    }

    let data: { items?: T[]; nextLink?: string | null } | T[];
    try {
      data = rawText ? (JSON.parse(rawText) as { items?: T[]; nextLink?: string | null } | T[]) : {};
    } catch {
      throw new Error(
        `Atera API ${endpoint} returned invalid JSON (HTTP ${res.status}): ${rawText.slice(0, 120)}`
      );
    }

    const pageItems = Array.isArray(data)
      ? data
      : Array.isArray(data?.items)
        ? data.items
        : [];
    items.push(...pageItems);
    if (shouldStop && shouldStop(pageItems)) {
      break;
    }
    if (Array.isArray(data) || !data?.nextLink || pageItems.length < itemsInPage) {
      break;
    }
  }
  return items;
}

function mapRawAteraTicket(t: Record<string, unknown>): AteraTicket {
  const tagsRaw = Array.isArray(t.TicketTags)
    ? (t.TicketTags as unknown[]).filter((x): x is string => typeof x === 'string' && x.trim().length > 0)
    : [];
  const category =
    str(t.TicketCategory ?? t.TicketTag ?? t.category) ||
    (tagsRaw.length > 0 ? tagsRaw[0] : null);

  const status = str(t.TicketStatus ?? t.ticketStatus) || 'Open';
  const isClosed = ['closed', 'resolved', 'merged'].includes(status.toLowerCase());
  const resolvedDate = str(t.TicketResolvedDate ?? t.resolvedDate);
  const dueDate = str(t.ClosedTicketFinalDueDate ?? t.ClosedTicketDueDate ?? t.closedDueDate);

  let onSla: boolean | null = null;
  if (typeof t.OnSLA === 'boolean') {
    onSla = t.OnSLA;
  } else if (typeof t.onSla === 'boolean') {
    onSla = t.onSla;
  } else if (!dueDate) {
    // No SLA policy/due date applied to this ticket in Atera
    onSla = null;
  } else if (isClosed && resolvedDate) {
    const resolvedMs = Date.parse(resolvedDate);
    const dueMs = Date.parse(dueDate);
    if (Number.isFinite(resolvedMs) && Number.isFinite(dueMs)) {
      onSla = resolvedMs <= dueMs;
    }
  } else if (isClosed && typeof t.SlaPassed === 'boolean') {
    onSla = !t.SlaPassed;
  } else if (isClosed) {
    onSla = true;
  } else if (typeof t.SlaPassed === 'boolean') {
    onSla = !t.SlaPassed;
  }

  const endUserFull =
    str(t.EndUserFullName ?? t.endUserName) ||
    [str(t.EndUserFirstName), str(t.EndUserLastName)].filter(Boolean).join(' ') ||
    null;

  return {
    ticketId: num(t.TicketID ?? t.ticketId),
    title: str(t.TicketTitle ?? t.ticketTitle) || 'Service Ticket',
    status,
    priority: str(t.TicketPriority ?? t.ticketPriority) || 'Medium',
    customerId: num(t.CustomerID ?? t.customerId),
    customerName: str(t.CustomerName ?? t.customerName) || 'Unassigned',
    createdDate: str(t.TicketCreatedDate ?? t.createdDate) || new Date().toISOString(),
    ticketType: str(t.TicketType ?? t.ticketType),
    category,
    resolvedDate,
    onSla,
    technicianName: str(t.TechnicianFullName ?? t.technicianName),
    endUserName: endUserFull,
  };
}

function computeReportCutoffMs(reportMonth?: string | null): number {
  if (reportMonth && /^\d{4}-\d{2}$/.test(reportMonth)) {
    const [y, m] = reportMonth.split('-').map(Number);
    // Go back 1 day before the start of the requested month to cover timezone offsets
    return Date.UTC(y, m - 1, 1) - 24 * 60 * 60 * 1000;
  }
  // Default: go back 95 days (~3 months) so previous monthly reports work out of the box
  return Date.now() - 95 * 24 * 60 * 60 * 1000;
}

async function fetchRetroactiveTicketsForCustomer(
  token: string,
  ateraCustomerId: number,
  cutoffMs: number
): Promise<{ tickets: AteraTicket[]; reachedCutoff: boolean; serverFiltered: boolean }> {
  // Probe whether Atera honors customerId / CustomerId filter on /api/v3/tickets
  let filterEndpoint: string | null = null;
  for (const paramName of ['customerId', 'CustomerId']) {
    const probePage = await fetchAteraPaginated<Record<string, unknown>>(
      `tickets?${paramName}=${ateraCustomerId}`,
      token,
      1,
      50
    );
    if (
      probePage.length === 0 ||
      probePage.every((t) => num(t.CustomerID ?? t.customerId) === ateraCustomerId)
    ) {
      filterEndpoint = `tickets?${paramName}=${ateraCustomerId}`;
      break;
    }
  }

  let reachedCutoff = false;
  const checkStop = (pageItems: Record<string, unknown>[]) => {
    if (pageItems.length === 0) {
      reachedCutoff = true;
      return true;
    }
    const timestamps = pageItems
      .map((t) => Date.parse(String(t.TicketCreatedDate ?? t.createdDate ?? '')))
      .filter((ts) => Number.isFinite(ts));
    if (timestamps.length > 0 && Math.min(...timestamps) < cutoffMs) {
      reachedCutoff = true;
      return true;
    }
    return false;
  };

  if (filterEndpoint) {
    // Customer-filtered query: paginate up to 30 pages (1,500 tickets for this customer)
    const raw = await fetchAteraPaginated<Record<string, unknown>>(
      filterEndpoint,
      token,
      30,
      50,
      checkStop
    );
    if (raw.length < 30 * 50) reachedCutoff = true;
    return {
      tickets: raw.map(mapRawAteraTicket),
      reachedCutoff,
      serverFiltered: true,
    };
  }

  // Fallback if Atera returns global tickets ignoring CustomerId: paginate deeper until cutoff
  const rawGlobal = await fetchAteraPaginated<Record<string, unknown>>(
    'tickets',
    token,
    60,
    50,
    checkStop
  );
  if (rawGlobal.length < 60 * 50) reachedCutoff = true;
  return {
    tickets: rawGlobal.map(mapRawAteraTicket),
    reachedCutoff,
    serverFiltered: false,
  };
}

function str(val: unknown): string | null {
  return typeof val === 'string' && val.trim() ? val.trim() : null;
}

function num(val: unknown, fallback = 0): number {
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

async function syncAteraData(store: MspStore): Promise<void> {
  const { token: apiKey } = getEffectiveAteraToken(store);
  if (!apiKey) {
    throw new Error('No Atera API token configured. Paste a token in Integrations & Setup or set ATERA_API_KEY.');
  }

  try {
    const [custRes, agentRes, alertRes, ticketRes] = await Promise.allSettled([
      fetchAteraPaginated<Record<string, unknown>>('customers', apiKey, 5),
      fetchAteraPaginated<Record<string, unknown>>('agents', apiKey, 6),
      fetchAteraPaginated<Record<string, unknown>>('alerts', apiKey, 4),
      fetchAteraPaginated<Record<string, unknown>>('tickets', apiKey, 4),
    ]);

    const errors: string[] = [];
    if (custRes.status === 'rejected') errors.push(String(custRes.reason instanceof Error ? custRes.reason.message : custRes.reason));
    if (agentRes.status === 'rejected') errors.push(String(agentRes.reason instanceof Error ? agentRes.reason.message : agentRes.reason));
    if (alertRes.status === 'rejected') errors.push(String(alertRes.reason instanceof Error ? alertRes.reason.message : alertRes.reason));
    if (ticketRes.status === 'rejected') errors.push(String(ticketRes.reason instanceof Error ? ticketRes.reason.message : ticketRes.reason));

    if (errors.length === 4) {
      throw new Error(errors[0]);
    }

    const rawCustomers = custRes.status === 'fulfilled' ? custRes.value : store.atera.customers as unknown as Record<string, unknown>[];
    const rawAgents = agentRes.status === 'fulfilled' ? agentRes.value : store.atera.agents as unknown as Record<string, unknown>[];
    const rawAlerts = alertRes.status === 'fulfilled' ? alertRes.value : store.atera.alerts as unknown as Record<string, unknown>[];
    const rawTickets = ticketRes.status === 'fulfilled' ? ticketRes.value : store.atera.tickets as unknown as Record<string, unknown>[];

    const customers: AteraCustomer[] = rawCustomers.map((c) => ({
      customerId: num(c.CustomerID ?? c.customerId),
      customerName: str(c.CustomerName ?? c.customerName) || 'Unnamed Customer',
      domain: str(c.Domain ?? c.domain ?? c.Website ?? c.website),
      city: str(c.City ?? c.city),
      country: str(c.Country ?? c.country),
      phone: str(c.Phone ?? c.phone),
      businessNumber: str(c.BusinessNumber ?? c.businessNumber),
      lastModified: str(c.LastModified ?? c.lastModified),
    }));

    const mapAgent = (a: Record<string, unknown>): AteraAgent => ({
      agentId: num(a.AgentID ?? a.agentId),
      deviceGuid: str(a.DeviceGuid ?? a.deviceGuid),
      machineName: str(a.MachineName ?? a.machineName) || 'Unknown Host',
      customerId: num(a.CustomerID ?? a.customerId),
      customerName: str(a.CustomerName ?? a.customerName) || 'Unassigned',
      online: Boolean(a.Online ?? a.online),
      os: str(a.OS ?? a.os) || 'Unknown OS',
      osType: str(a.OSType ?? a.osType) || 'Unknown',
      lastSeen: str(a.LastSeen ?? a.lastSeen),
      reportedIp: str(a.ReportedFromIP ?? a.reportedFromIp),
      currentLoggedUsers: str(a.CurrentLoggedUsers ?? a.currentLoggedUsers),
      pendingReboot: Boolean(a.PendingReboot ?? a.pendingReboot),
      lastPatchDate: str(a.LastPatchManagementReceived ?? a.lastPatchDate),
      windowsUpdateStatus: str(a.WindowsUpdateStatus ?? a.windowsUpdateStatus),
      osVersion: str(a.OSVersion ?? a.osVersion),
      osBuild: str(a.OSBuild ?? a.osBuild),
      lastRebootTime: str(a.LastRebootTime ?? a.lastRebootTime),
    });

    const freshAgents: AteraAgent[] = rawAgents.map((a) =>
      typeof (a as { agentId?: unknown }).agentId === 'number'
        ? (a as unknown as AteraAgent)
        : mapAgent(a)
    );
    const agentMap = new Map<number, AteraAgent>();
    for (const existingAgent of store.atera.agents) agentMap.set(existingAgent.agentId, existingAgent);
    for (const fresh of freshAgents) {
      const prev = agentMap.get(fresh.agentId);
      agentMap.set(
        fresh.agentId,
        prev?.availablePatchSummary && !fresh.availablePatchSummary
          ? { ...fresh, availablePatchSummary: prev.availablePatchSummary }
          : fresh
      );
    }
    const agents = Array.from(agentMap.values());

    const alerts: AteraAlert[] = rawAlerts.map((al) => ({
      alertId: num(al.AlertID ?? al.alertId),
      title: str(al.Title ?? al.title) || 'RMM Alert',
      severity: str(al.Severity ?? al.severity) || 'Warning',
      category: str(al.AlertCategoryID ?? al.category) || 'General',
      customerId: num(al.CustomerID ?? al.customerId),
      customerName: str(al.CustomerName ?? al.customerName) || 'Unassigned',
      machineName: str(al.MachineName ?? al.machineName),
      created: str(al.Created ?? al.created) || new Date().toISOString(),
      archived: Boolean(al.Archived ?? al.archived),
    }));

    const freshTickets: AteraTicket[] = rawTickets.map((t) =>
      typeof (t as { ticketId?: unknown }).ticketId === 'number'
        ? (t as unknown as AteraTicket)
        : mapRawAteraTicket(t)
    );

    const ticketMap = new Map<number, AteraTicket>();
    for (const existingTicket of store.atera.tickets) {
      ticketMap.set(existingTicket.ticketId, existingTicket);
    }
    for (const fresh of freshTickets) {
      ticketMap.set(fresh.ticketId, fresh);
    }
    const tickets = Array.from(ticketMap.values()).sort(
      (a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate)
    );

    store.atera = {
      ...store.atera,
      lastSync: new Date().toISOString(),
      lastError: errors.length > 0 ? errors.join(' | ') : null,
      customers,
      agents,
      alerts,
      tickets,
    };

    // Auto-link unmapped M365 tenants by matching domain or organization name
    for (const tenant of store.tenants) {
      if (tenant.ateraCustomerId == null) {
        const match = customers.find((c) => {
          const dom = c.domain?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
          if (dom && tenant.primaryDomain && dom === tenant.primaryDomain.toLowerCase()) {
            return true;
          }
          return c.customerName.toLowerCase() === tenant.displayName.toLowerCase();
        });
        if (match) {
          tenant.ateraCustomerId = match.customerId;
        }
      }
    }

    saveStore(store);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    store.atera.lastError = message;
    saveStore(store);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Microsoft Graph & Defender Security API Integration
// ---------------------------------------------------------------------------

async function getTenantAccessToken(record: StoredTenantRecord): Promise<{ accessToken: string; newRefreshToken?: string }> {
  const clientId = cleanEnv('MS_GRAPH_CLIENT_ID');
  const clientSecret = cleanEnv('MS_GRAPH_CLIENT_SECRET');
  if (!clientId || !clientSecret) {
    throw new Error('MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET must be configured.');
  }

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(record.tenantId)}/oauth2/v2.0/token`;
  const params = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
  });

  if (record.authMode === 'delegated' && record.refreshToken) {
    params.set('grant_type', 'refresh_token');
    params.set('refresh_token', record.refreshToken);
    params.set(
      'scope',
      cleanEnv('MS_GRAPH_SCOPES') ||
        'offline_access openid profile User.Read Organization.Read.All SecurityEvents.Read.All'
    );
  } else {
    params.set('grant_type', 'client_credentials');
    params.set('scope', 'https://graph.microsoft.com/.default');
  }

  const res = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'AegisMSP/1.0' },
    body: params.toString(),
  });

  const rawText = await res.text().catch(() => '');
  let body: {
    access_token?: string;
    refresh_token?: string;
    error?: string;
    error_description?: string;
  } = {};
  try {
    body = rawText ? (JSON.parse(rawText) as typeof body) : {};
  } catch {
    throw new Error(`Microsoft Entra returned non-JSON token response (HTTP ${res.status}).`);
  }

  if (!res.ok || !body.access_token) {
    throw new Error(body.error_description || body.error || `Token request failed (HTTP ${res.status})`);
  }

  return {
    accessToken: body.access_token,
    newRefreshToken: body.refresh_token,
  };
}

async function fetchGraphJson<T>(url: string, accessToken: string): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'User-Agent': 'AegisMSP/1.0',
    },
  });
  const rawText = await res.text().catch(() => '');
  if (!res.ok) {
    let errMsg = `HTTP ${res.status} ${res.statusText}`;
    try {
      const errBody = rawText ? (JSON.parse(rawText) as { error?: { message?: string } }) : {};
      if (errBody?.error?.message) errMsg = errBody.error.message;
    } catch {
      // Keep HTTP status message
    }
    return { ok: false, status: res.status, error: errMsg };
  }
  try {
    const data = (rawText ? JSON.parse(rawText) : {}) as T;
    return { ok: true, data };
  } catch {
    return { ok: false, status: res.status, error: 'Microsoft Graph returned invalid JSON.' };
  }
}

function stripHtml(input: string | null | undefined): string {
  if (!input) return '';
  return input
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function syncMicrosoftTenant(record: StoredTenantRecord): Promise<StoredTenantRecord> {
  const notes: string[] = [];

  try {
    const { accessToken, newRefreshToken } = await getTenantAccessToken(record);
    if (newRefreshToken) {
      record.refreshToken = newRefreshToken;
    }

    // 1. Refresh org metadata
    const orgRes = await fetchGraphJson<{
      value?: Array<{
        id?: string;
        displayName?: string;
        verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>;
      }>;
    }>('https://graph.microsoft.com/v1.0/organization', accessToken);

    if (orgRes.ok && orgRes.data.value?.[0]) {
      const org = orgRes.data.value[0];
      if (org.displayName) record.displayName = org.displayName;
      const defaultDomain = org.verifiedDomains?.find((d) => d.isDefault)?.name || org.verifiedDomains?.[0]?.name;
      if (defaultDomain) record.primaryDomain = defaultDomain;
    }

    // 2. Secure Scores + Control Profiles + Defender Alerts + Managed Devices + Directory Roles + Risky Users
    const [scoresRes, profilesRes, alertsV2Res, devicesRes, dirRolesRes, riskyUsersRes] = await Promise.all([
      fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/security/secureScores?$top=30',
        accessToken
      ),
      fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/security/secureScoreControlProfiles?$top=150',
        accessToken
      ),
      fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/security/alerts_v2?$top=50',
        accessToken
      ),
      fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$top=200&$select=id,deviceName,operatingSystem,osVersion,complianceState,lastSyncDateTime,userPrincipalName',
        accessToken
      ),
      fetchGraphJson<{ value?: Array<{ id?: string; displayName?: string; roleTemplateId?: string }> }>(
        'https://graph.microsoft.com/v1.0/directoryRoles',
        accessToken
      ),
      fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/identityProtection/riskyUsers?$top=50',
        accessToken
      ),
    ]);

    // Fallback to legacy /v1.0/security/alerts if alerts_v2 is forbidden or unavailable
    let alertsList: Array<Record<string, unknown>> = [];
    if (alertsV2Res.ok) {
      alertsList = alertsV2Res.data.value || [];
    } else {
      const legacyAlertsRes = await fetchGraphJson<{ value?: Array<Record<string, unknown>> }>(
        'https://graph.microsoft.com/v1.0/security/alerts?$top=50',
        accessToken
      );
      if (legacyAlertsRes.ok) {
        alertsList = legacyAlertsRes.data.value || [];
      } else {
        notes.push(`Security Alerts unavailable (${alertsV2Res.status}: requires SecurityEvents.Read.All or SecurityAlert.Read.All)`);
      }
    }

    if (!scoresRes.ok) {
      notes.push(`Secure Score unavailable (${scoresRes.status}: requires SecurityEvents.Read.All)`);
    }
    if (!profilesRes.ok) {
      notes.push(`Control Profiles unavailable (${profilesRes.status})`);
    }
    if (!devicesRes.ok && devicesRes.status !== 404) {
      notes.push(`Intune Devices skipped (${devicesRes.status}: optional DeviceManagementManagedDevices.Read.All)`);
    }

    // Fetch Global Administrator role members if directoryRoles succeeded
    if (dirRolesRes.ok) {
      const globalAdminRole = (dirRolesRes.data.value || []).find(
        (r) =>
          r.roleTemplateId === '62e90394-69f5-4237-9190-012177145e10' ||
          r.displayName?.toLowerCase() === 'global administrator'
      );
      if (globalAdminRole?.id) {
        const membersRes = await fetchGraphJson<{
          value?: Array<{
            id?: string;
            '@odata.type'?: string;
            displayName?: string;
            userPrincipalName?: string;
            mail?: string;
            appId?: string;
            accountEnabled?: boolean;
          }>;
        }>(
          `https://graph.microsoft.com/v1.0/directoryRoles/${encodeURIComponent(globalAdminRole.id)}/members`,
          accessToken
        );
        if (membersRes.ok) {
          const rawMembers = membersRes.data.value || [];
          const resolvedMembers = await Promise.all(
            rawMembers.map(async (m) => {
              let displayName = m.displayName;
              let userPrincipalName = m.userPrincipalName || m.mail || m.appId;
              let accountEnabled = m.accountEnabled;

              // If RoleManagement.Read.Directory returned only an ID, try /users/{id} once if permitted (e.g. User.ReadBasic.All / User.Read.All)
              if (m.id && !displayName && !userPrincipalName) {
                const userRes = await fetchGraphJson<{
                  displayName?: string;
                  userPrincipalName?: string;
                  mail?: string;
                  accountEnabled?: boolean;
                }>(
                  `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(m.id)}?$select=id,displayName,userPrincipalName,mail,accountEnabled`,
                  accessToken
                );
                if (userRes.ok) {
                  displayName = userRes.data.displayName;
                  userPrincipalName = userRes.data.userPrincipalName || userRes.data.mail;
                  accountEnabled = userRes.data.accountEnabled;
                }
              }

              return {
                id: m.id || crypto.randomUUID(),
                roleDisplayName: 'Global Administrator',
                userPrincipalName: userPrincipalName || (m.id ? `Object ID: ${m.id}` : '—'),
                displayName: displayName || 'Name hidden (requires User.Read.All)',
                accountEnabled,
              };
            })
          );

          record.globalAdmins = resolvedMembers;
          if (
            resolvedMembers.length > 0 &&
            resolvedMembers.every((adm) => adm.displayName.startsWith('Name hidden'))
          ) {
            notes.push(
              `Global Admins (${resolvedMembers.length}) IDs retrieved, but names/UPNs hidden by Graph: grant User.Read.All or Directory.Read.All (with admin consent) alongside RoleManagement.Read.Directory.`
            );
          }
        }
      } else {
        record.globalAdmins = [];
      }
    } else if (dirRolesRes.status !== 404) {
      notes.push(`Global Admins list skipped (${dirRolesRes.status}: optional RoleManagement.Read.Directory + User.Read.All, or Directory.Read.All)`);
    }

    if (riskyUsersRes.ok) {
      record.riskyUsers = (riskyUsersRes.data.value || []).map((u) => ({
        id: str(u.id) || crypto.randomUUID(),
        userDisplayName: str(u.userDisplayName) || 'Unknown User',
        userPrincipalName: str(u.userPrincipalName) || '—',
        riskLevel: str(u.riskLevel) || 'none',
        riskState: str(u.riskState) || 'none',
        riskLastUpdatedDateTime: str(u.riskLastUpdatedDateTime),
      }));
    }

    // Parse Secure Score history & latest snapshot
    const rawScores = scoresRes.ok ? scoresRes.data.value || [] : [];
    const sortedScores = [...rawScores].sort((a, b) => {
      const da = Date.parse(String(a.createdDateTime || '')) || 0;
      const db = Date.parse(String(b.createdDateTime || '')) || 0;
      return db - da;
    });

    const latestScore = sortedScores[0];
    if (latestScore) {
      const currentScore = Number(latestScore.currentScore ?? 0);
      const maxScore = Number(latestScore.maxScore ?? 0);
      const pct = maxScore > 0 ? Math.round((currentScore / maxScore) * 1000) / 10 : 0;

      const avgList = Array.isArray(latestScore.averageComparativeScores)
        ? (latestScore.averageComparativeScores as Array<Record<string, unknown>>)
        : [];
      const allTenantsAvg = avgList.find((x) => x.basis === 'AllTenants');
      const seatAvg = avgList.find((x) => x.basis === 'TotalSeats');

      record.secureScore = {
        currentScore,
        maxScore,
        percentage: pct,
        createdDateTime: str(latestScore.createdDateTime),
        activeUserCount: typeof latestScore.activeUserCount === 'number' ? latestScore.activeUserCount : null,
        licensedUserCount: typeof latestScore.licensedUserCount === 'number' ? latestScore.licensedUserCount : null,
        allTenantsAverage: typeof allTenantsAvg?.averageScore === 'number' ? allTenantsAvg.averageScore : null,
        similarSizeAverage: typeof seatAvg?.averageScore === 'number' ? seatAvg.averageScore : null,
      };
    }

    record.scoreHistory = sortedScores
      .slice(0, 30)
      .reverse()
      .map((s) => {
        const curr = Number(s.currentScore ?? 0);
        const max = Number(s.maxScore ?? 0);
        return {
          date: String(s.createdDateTime || '').slice(0, 10),
          currentScore: curr,
          maxScore: max,
          percentage: max > 0 ? Math.round((curr / max) * 1000) / 10 : 0,
        };
      });

    // Map Control Profiles + Control Scores
    const profileMap = new Map<string, Record<string, unknown>>();
    if (profilesRes.ok) {
      for (const p of profilesRes.data.value || []) {
        const id = str(p.id);
        if (id) profileMap.set(id, p);
      }
    }

    const latestControlScores = Array.isArray(latestScore?.controlScores)
      ? (latestScore.controlScores as Array<Record<string, unknown>>)
      : [];

    const controls: SecureScoreControlItem[] = [];
    const categoryTotals = new Map<string, { current: number; max: number; count: number }>();

    for (const cs of latestControlScores) {
      const controlName = str(cs.controlName) || '';
      const profile = profileMap.get(controlName);
      const category = str(cs.controlCategory) || str(profile?.controlCategory) || 'General';
      const currentScore = Number(cs.score ?? 0);
      const maxScore = Number(profile?.maxScore ?? 0) || currentScore;
      const scoreGap = Math.max(0, Math.round((maxScore - currentScore) * 100) / 100);
      const pct = typeof cs.scoreInPercentage === 'number'
        ? cs.scoreInPercentage
        : maxScore > 0
          ? Math.round((currentScore / maxScore) * 100)
          : 0;

      const catAcc = categoryTotals.get(category) || { current: 0, max: 0, count: 0 };
      catAcc.current += currentScore;
      catAcc.max += maxScore;
      catAcc.count += 1;
      categoryTotals.set(category, catAcc);

      controls.push({
        controlName,
        title: str(profile?.title) || controlName || 'Security Control',
        category,
        currentScore,
        maxScore,
        scoreGap,
        scoreInPercentage: pct,
        implementationStatus: str(cs.implementationStatus) || str(cs.description) || 'Unknown',
        userImpact: str(profile?.userImpact) || 'Moderate',
        implementationCost: str(profile?.implementationCost) || 'Moderate',
        tier: str(profile?.tier) || 'Core',
        threats: Array.isArray(profile?.threats) ? (profile!.threats as string[]) : [],
        remediation: stripHtml(str(profile?.remediation)) || stripHtml(str(cs.description)) || 'Review control configuration in Microsoft Defender Portal.',
        actionUrl: str(profile?.actionUrl),
        rank: typeof profile?.rank === 'number' ? profile.rank : 999,
      });
    }

    // Add profiles not present in controlScores (if any)
    for (const [id, profile] of profileMap.entries()) {
      if (!controls.some((c) => c.controlName === id)) {
        const maxScore = Number(profile.maxScore ?? 0);
        const category = str(profile.controlCategory) || 'General';
        controls.push({
          controlName: id,
          title: str(profile.title) || id,
          category,
          currentScore: 0,
          maxScore,
          scoreGap: maxScore,
          scoreInPercentage: 0,
          implementationStatus: 'Not Scored',
          userImpact: str(profile.userImpact) || 'Moderate',
          implementationCost: str(profile.implementationCost) || 'Moderate',
          tier: str(profile.tier) || 'Core',
          threats: Array.isArray(profile.threats) ? (profile.threats as string[]) : [],
          remediation: stripHtml(str(profile.remediation)) || 'Review control configuration in Microsoft Defender Portal.',
          actionUrl: str(profile.actionUrl),
          rank: typeof profile.rank === 'number' ? profile.rank : 999,
        });
      }
    }

    controls.sort((a, b) => b.scoreGap - a.scoreGap || a.rank - b.rank);
    record.controls = controls;

    record.categoryBreakdown = Array.from(categoryTotals.entries()).map(([category, vals]) => ({
      category,
      currentScore: Math.round(vals.current * 10) / 10,
      maxScore: Math.round(vals.max * 10) / 10,
      percentage: vals.max > 0 ? Math.round((vals.current / vals.max) * 1000) / 10 : 0,
      controlCount: vals.count,
    }));

    record.defenderAlerts = alertsList.map((al) => ({
      id: str(al.id) || crypto.randomUUID(),
      title: str(al.title) || 'Defender Alert',
      severity: (str(al.severity) || 'unknown').toLowerCase(),
      status: str(al.status) || 'new',
      category: str(al.category) || 'General',
      serviceSource: str(al.serviceSource) || str((al.vendorInformation as Record<string, unknown> | undefined)?.provider) || 'Microsoft Defender',
      createdDateTime: str(al.createdDateTime) || new Date().toISOString(),
      assignedTo: str(al.assignedTo),
      classification: str(al.classification),
      incidentWebUrl: str(al.incidentWebUrl) || str(al.alertWebUrl),
    }));

    if (devicesRes.ok) {
      const devs = devicesRes.data.value || [];
      const compliant = devs.filter((d) => String(d.complianceState || '').toLowerCase() === 'compliant').length;
      const nonCompliantList = devs.filter((d) => String(d.complianceState || '').toLowerCase() === 'noncompliant');
      const threeWeeksAgoMs = Date.now() - 21 * 24 * 60 * 60 * 1000;

      const mapDevice = (d: Record<string, unknown>): ManagedDeviceItem => ({
        id: str(d.id) || crypto.randomUUID(),
        deviceName: str(d.deviceName) || 'Unnamed Device',
        operatingSystem: str(d.operatingSystem) || 'Unknown',
        osVersion: str(d.osVersion),
        complianceState: str(d.complianceState) || 'unknown',
        lastSyncDateTime: str(d.lastSyncDateTime),
        userPrincipalName: str(d.userPrincipalName),
      });

      const staleList = devs.filter((d) => {
        const ts = Date.parse(String(d.lastSyncDateTime || ''));
        return Number.isFinite(ts) && ts < threeWeeksAgoMs;
      });

      record.managedDevices = {
        total: devs.length,
        compliant,
        nonCompliant: nonCompliantList.length,
        nonCompliantDevices: nonCompliantList.slice(0, 50).map(mapDevice),
        staleDevices: staleList.slice(0, 50).map(mapDevice),
      };
    }

    record.lastSyncAt = new Date().toISOString();
    record.permissionsNotes = notes;

    if (!scoresRes.ok && alertsList.length === 0) {
      record.lastSyncStatus = 'error';
      record.lastSyncError = notes.join(' | ') || 'Insufficient Microsoft Graph permissions.';
    } else if (notes.length > 0) {
      record.lastSyncStatus = 'partial';
      record.lastSyncError = null;
    } else {
      record.lastSyncStatus = 'ok';
      record.lastSyncError = null;
    }

    return record;
  } catch (err) {
    record.lastSyncAt = new Date().toISOString();
    record.lastSyncStatus = 'error';
    record.lastSyncError = err instanceof Error ? err.message : String(err);
    record.permissionsNotes = notes;
    return record;
  }
}

// ---------------------------------------------------------------------------
// Express App & Routes
// ---------------------------------------------------------------------------

async function startServer() {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
  });

  app.get('/api/integrations/status', (req, res) => {
    const store = loadStore();
    res.json({
      ateraConfigured: isAteraConfigured(store),
      ateraTokenInfo: getAteraTokenMetadata(store),
      microsoftConfigured: isMicrosoftConfigured(),
      microsoftClientId: cleanEnv('MS_GRAPH_CLIENT_ID') || null,
      redirectUri: getMicrosoftRedirectUri(req),
      lastAteraSync: store.atera.lastSync,
      lastAteraError: store.atera.lastError,
      connectedTenantsCount: store.tenants.length,
      ateraCustomersCount: store.atera.customers.length,
    });
  });

  app.get('/api/dashboard', (req, res) => {
    const store = loadStore();
    res.json(buildDashboardPayload(store, req));
  });

  // Update Atera RMM token (supports rotating JWT tokens & API keys stored strictly server-side)
  app.post('/api/atera/token', async (req, res) => {
    const rawToken = typeof req.body?.token === 'string' ? normalizeTokenValue(req.body.token) : '';
    if (!rawToken) {
      res.status(400).json({ error: 'Please paste a valid Atera API token.' });
      return;
    }

    const store = loadStore();
    const prevOverride = store.atera.tokenOverride;
    const prevUpdatedAt = store.atera.tokenUpdatedAt;

    store.atera.tokenOverride = rawToken;
    store.atera.tokenUpdatedAt = new Date().toISOString();
    saveStore(store);

    try {
      await syncAteraData(store);
      res.json(buildDashboardPayload(store, req));
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to validate Atera token.';
      // Keep the newly saved token if only partial error, or revert if 401 unauthorized
      if (msg.includes('401')) {
        store.atera.tokenOverride = prevOverride;
        store.atera.tokenUpdatedAt = prevUpdatedAt;
        store.atera.lastError = msg;
        saveStore(store);
        res.status(401).json({ error: msg });
        return;
      }
      res.status(502).json({ error: msg });
    }
  });

  app.delete('/api/atera/token', (req, res) => {
    const store = loadStore();
    store.atera.tokenOverride = null;
    store.atera.tokenUpdatedAt = null;
    saveStore(store);
    res.json(buildDashboardPayload(store, req));
  });

  // Atera RMM sync
  app.post('/api/atera/sync', async (req, res) => {
    const store = loadStore();
    if (!isAteraConfigured(store)) {
      res.status(400).json({
        error: 'No Atera token configured. Paste your Atera token in Integrations & Setup or set ATERA_API_KEY.',
      });
      return;
    }
    try {
      await syncAteraData(store);
      res.json(buildDashboardPayload(store, req));
    } catch (err) {
      res.status(502).json({
        error: err instanceof Error ? err.message : 'Failed to sync Atera RMM data.',
      });
    }
  });

  // Microsoft Entra OAuth URL generator (supports standard OAuth & Admin Consent)
  app.get('/api/microsoft/auth-url', (req, res) => {
    const clientId = cleanEnv('MS_GRAPH_CLIENT_ID');
    if (!clientId || !cleanEnv('MS_GRAPH_CLIENT_SECRET')) {
      res.status(400).json({
        error: 'MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET are not configured on the server.',
      });
      return;
    }

    cleanupExpiredStates();
    const state = crypto.randomBytes(24).toString('hex');
    const flow = req.query.flow === 'adminconsent' ? 'adminconsent' : 'oauth';
    const requestedTenant =
      typeof req.query.tenantId === 'string' && req.query.tenantId.trim()
        ? req.query.tenantId.trim()
        : 'organizations';
    const rawCustomerId = req.query.ateraCustomerId ? Number(req.query.ateraCustomerId) : null;
    const ateraCustomerId = rawCustomerId && Number.isFinite(rawCustomerId) ? rawCustomerId : null;

    oauthStates.set(state, {
      createdAt: Date.now(),
      ateraCustomerId,
      flow,
      requestedTenant,
    });

    const redirectUri = getMicrosoftRedirectUri(req);

    if (flow === 'adminconsent') {
      const params = new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        state,
      });
      const url = `https://login.microsoftonline.com/${encodeURIComponent(requestedTenant)}/v2.0/adminconsent?${params.toString()}`;
      res.json({ url, redirectUri });
      return;
    }

    const scopes =
      process.env.MS_GRAPH_SCOPES?.trim() ||
      'offline_access openid profile User.Read Organization.Read.All SecurityEvents.Read.All';

    const params = new URLSearchParams({
      client_id: clientId,
      response_type: 'code',
      redirect_uri: redirectUri,
      response_mode: 'query',
      scope: scopes,
      state,
      prompt: 'select_account',
    });

    const url = `https://login.microsoftonline.com/${encodeURIComponent(requestedTenant)}/oauth2/v2.0/authorize?${params.toString()}`;
    res.json({ url, redirectUri });
  });

  // Microsoft OAuth & Admin Consent Callback
  const handleMicrosoftCallback = async (req: Request, res: Response) => {
    const renderPopupResult = (payload: Record<string, unknown>, title: string, subtitle?: string) => {
      const serialized = JSON.stringify(payload).replace(/</g, '\\u003c');
      res.send(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title}</title>
  </head>
  <body style="margin: 0; font-family: system-ui, -apple-system, sans-serif; min-height: 100vh; display: flex; align-items: center; justify-content: center; background: #f8fafc; color: #0f172a;">
    <div style="background: #ffffff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 28px 36px; text-align: center; max-width: 420px; box-shadow: 0 1px 3px rgba(15, 23, 42, 0.06);">
      <div style="font-size: 18px; font-weight: 600; color: #0357A3;">${title}</div>
      ${subtitle ? `<p style="margin: 8px 0 0; font-size: 13px; color: #475569;">${subtitle}</p>` : ''}
    </div>
    <script>
      if (window.opener) {
        window.opener.postMessage(${serialized}, '*');
        setTimeout(() => window.close(), 350);
      }
    </script>
  </body>
</html>`);
    };

    const error = typeof req.query.error === 'string' ? req.query.error : null;
    const errorDescription = typeof req.query.error_description === 'string' ? req.query.error_description : null;
    if (error) {
      renderPopupResult(
        { type: 'MS_OAUTH_ERROR', error: errorDescription || error },
        'Connection Failed',
        errorDescription || error
      );
      return;
    }

    const adminConsent = req.query.admin_consent === 'True' || req.query.admin_consent === 'true';
    const consentedTenant = typeof req.query.tenant === 'string' ? req.query.tenant : null;
    const code = typeof req.query.code === 'string' ? req.query.code : null;

    const stateKey = typeof req.query.state === 'string' ? req.query.state : '';
    const storedState = stateKey ? oauthStates.get(stateKey) : undefined;
    if (stateKey) oauthStates.delete(stateKey);

    // Support direct standalone Admin Consent links (generated without a popup state token)
    if (!storedState && !adminConsent && !code) {
      renderPopupResult(
        { type: 'MS_OAUTH_SUCCESS' },
        'Connected',
        'You may close this window.'
      );
      return;
    }

    if (!storedState && code) {
      renderPopupResult(
        { type: 'MS_OAUTH_ERROR', error: 'Invalid or expired OAuth state token.' },
        'Session Expired',
        'Invalid or expired OAuth state token. Please try connecting again.'
      );
      return;
    }

    const stateEntry: OAuthStateEntry = storedState ?? {
      createdAt: Date.now(),
      ateraCustomerId: null,
      flow: 'adminconsent',
      requestedTenant: consentedTenant || 'organizations',
    };

    const clientId = cleanEnv('MS_GRAPH_CLIENT_ID');
    const clientSecret = cleanEnv('MS_GRAPH_CLIENT_SECRET');
    if (!clientId || !clientSecret) {
      if (adminConsent) {
        renderPopupResult(
          { type: 'MS_OAUTH_SUCCESS', tenantId: consentedTenant },
          'Connected',
          'Permissions accepted. You may close this window.'
        );
        return;
      }
      renderPopupResult(
        { type: 'MS_OAUTH_ERROR', error: 'Server Microsoft credentials missing.' },
        'Configuration Missing',
        'Server Microsoft Graph credentials are not configured.'
      );
      return;
    }

    const redirectUri = getMicrosoftRedirectUri(req);

    try {
      let tenantId = consentedTenant || stateEntry.requestedTenant;
      let displayName = tenantId;
      let primaryDomain: string | null = null;
      let authMode: 'delegated' | 'app_only' = 'delegated';
      let refreshToken: string | null = null;
      let accessToken = '';

      if (adminConsent && consentedTenant) {
        authMode = 'app_only';
        const tokenParams = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: 'client_credentials',
          scope: 'https://graph.microsoft.com/.default',
        });
        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${encodeURIComponent(consentedTenant)}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString(),
          }
        );
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          error_description?: string;
          error?: string;
        };
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || tokenData.error || 'Failed to acquire app-only token after admin consent.');
        }
        accessToken = tokenData.access_token;
      } else if (code) {
        const scopes =
          process.env.MS_GRAPH_SCOPES?.trim() ||
          'offline_access openid profile User.Read Organization.Read.All SecurityEvents.Read.All';
        const tokenParams = new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
          scope: scopes,
        });
        const tokenRes = await fetch(
          `https://login.microsoftonline.com/${encodeURIComponent(stateEntry.requestedTenant)}/oauth2/v2.0/token`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: tokenParams.toString(),
          }
        );
        const tokenData = (await tokenRes.json()) as {
          access_token?: string;
          refresh_token?: string;
          id_token?: string;
          error_description?: string;
          error?: string;
        };
        if (!tokenRes.ok || !tokenData.access_token) {
          throw new Error(tokenData.error_description || tokenData.error || 'Authorization code exchange failed.');
        }
        accessToken = tokenData.access_token;
        refreshToken = tokenData.refresh_token || null;

        // Decode tenant ID (`tid`) from id_token claims if available
        if (tokenData.id_token) {
          const parts = tokenData.id_token.split('.');
          if (parts.length === 3) {
            const claims = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8')) as { tid?: string };
            if (claims.tid) tenantId = claims.tid;
          }
        }
      } else {
        throw new Error('Missing authorization code or admin consent response.');
      }

      // Resolve organization details
      const orgRes = await fetchGraphJson<{
        value?: Array<{
          id?: string;
          displayName?: string;
          verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>;
        }>;
      }>('https://graph.microsoft.com/v1.0/organization', accessToken);

      if (orgRes.ok && orgRes.data.value?.[0]) {
        const org = orgRes.data.value[0];
        if (org.id) tenantId = org.id;
        if (org.displayName) displayName = org.displayName;
        primaryDomain = org.verifiedDomains?.find((d) => d.isDefault)?.name || org.verifiedDomains?.[0]?.name || null;
      }

      const store = loadStore();
      let existing = store.tenants.find((t) => t.tenantId.toLowerCase() === tenantId.toLowerCase());
      if (!existing) {
        // Attempt automatic Atera customer match if none supplied
        let matchedCustomerId = stateEntry.ateraCustomerId;
        if (matchedCustomerId == null && primaryDomain) {
          const matched = store.atera.customers.find((c) => {
            const dom = c.domain?.toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '');
            return dom === primaryDomain?.toLowerCase() || c.customerName.toLowerCase() === displayName.toLowerCase();
          });
          if (matched) matchedCustomerId = matched.customerId;
        }

        existing = {
          id: crypto.randomUUID(),
          tenantId,
          displayName,
          primaryDomain,
          authMode,
          refreshToken,
          ateraCustomerId: matchedCustomerId,
          connectedAt: new Date().toISOString(),
          lastSyncAt: null,
          lastSyncStatus: 'pending',
          lastSyncError: null,
          permissionsNotes: [],
          secureScore: null,
          scoreHistory: [],
          categoryBreakdown: [],
          controls: [],
          defenderAlerts: [],
          managedDevices: null,
        };
        store.tenants.push(existing);
      } else {
        existing.authMode = authMode;
        if (refreshToken) existing.refreshToken = refreshToken;
        if (stateEntry.ateraCustomerId != null) existing.ateraCustomerId = stateEntry.ateraCustomerId;
        existing.displayName = displayName;
        if (primaryDomain) existing.primaryDomain = primaryDomain;
      }

      await syncMicrosoftTenant(existing);
      saveStore(store);

      renderPopupResult(
        { type: 'MS_OAUTH_SUCCESS', tenantId: existing.tenantId, displayName: existing.displayName },
        'Connected',
        `${existing.displayName} connected. You may close this window.`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Unexpected Microsoft OAuth error.';
      renderPopupResult(
        { type: 'MS_OAUTH_ERROR', error: msg },
        'Connection Failed',
        msg
      );
    }
  };

  app.get(['/auth/microsoft/callback', '/auth/microsoft/callback/'], handleMicrosoftCallback);

  // Link a customer tenant via GDAP / App-Only Client Credentials (using server MS_GRAPH_CLIENT_ID & SECRET)
  app.post('/api/microsoft/tenants/link-app-only', async (req, res) => {
    if (!isMicrosoftConfigured()) {
      res.status(400).json({
        error: 'MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET must be configured on the server.',
      });
      return;
    }

    const rawTenantId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : '';
    const rawCustomerId = req.body?.ateraCustomerId != null ? Number(req.body.ateraCustomerId) : null;
    const ateraCustomerId = rawCustomerId && Number.isFinite(rawCustomerId) ? rawCustomerId : null;

    if (!rawTenantId) {
      res.status(400).json({ error: 'Microsoft 365 Tenant ID or domain is required.' });
      return;
    }

    try {
      const store = loadStore();
      let record: StoredTenantRecord = {
        id: crypto.randomUUID(),
        tenantId: rawTenantId,
        displayName: rawTenantId,
        primaryDomain: rawTenantId.includes('.') ? rawTenantId : null,
        authMode: 'app_only',
        refreshToken: null,
        ateraCustomerId,
        connectedAt: new Date().toISOString(),
        lastSyncAt: null,
        lastSyncStatus: 'pending',
        lastSyncError: null,
        permissionsNotes: [],
        secureScore: null,
        scoreHistory: [],
        categoryBreakdown: [],
        controls: [],
        defenderAlerts: [],
        managedDevices: null,
      };

      // Validate token acquisition & fetch organization profile before saving
      const { accessToken } = await getTenantAccessToken(record);
      const orgRes = await fetchGraphJson<{
        value?: Array<{
          id?: string;
          displayName?: string;
          verifiedDomains?: Array<{ name?: string; isDefault?: boolean }>;
        }>;
      }>('https://graph.microsoft.com/v1.0/organization', accessToken);

      if (orgRes.ok && orgRes.data.value?.[0]) {
        const org = orgRes.data.value[0];
        if (org.id) record.tenantId = org.id;
        if (org.displayName) record.displayName = org.displayName;
        record.primaryDomain = org.verifiedDomains?.find((d) => d.isDefault)?.name || org.verifiedDomains?.[0]?.name || record.primaryDomain;
      }

      const existingIdx = store.tenants.findIndex((t) => t.tenantId.toLowerCase() === record.tenantId.toLowerCase());
      if (existingIdx >= 0) {
        record = {
          ...store.tenants[existingIdx],
          displayName: record.displayName,
          primaryDomain: record.primaryDomain,
          authMode: 'app_only',
          ateraCustomerId: ateraCustomerId ?? store.tenants[existingIdx].ateraCustomerId,
        };
        store.tenants[existingIdx] = record;
      } else {
        store.tenants.push(record);
      }

      await syncMicrosoftTenant(record);
      saveStore(store);
      res.json(buildDashboardPayload(store, req));
    } catch (err) {
      res.status(400).json({
        error: err instanceof Error ? err.message : 'Failed to verify tenant credentials with Microsoft Entra ID.',
      });
    }
  });

  // Sync single tenant
  app.post('/api/microsoft/tenants/:id/sync', async (req, res) => {
    const store = loadStore();
    const tenant = store.tenants.find((t) => t.id === req.params.id);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant connection not found.' });
      return;
    }
    await syncMicrosoftTenant(tenant);
    saveStore(store);
    res.json(buildDashboardPayload(store, req));
  });

  // Map tenant to Atera Customer
  app.patch('/api/tenants/:id/mapping', (req, res) => {
    const store = loadStore();
    const tenant = store.tenants.find((t) => t.id === req.params.id);
    if (!tenant) {
      res.status(404).json({ error: 'Tenant connection not found.' });
      return;
    }
    const rawCustomerId = req.body?.ateraCustomerId;
    tenant.ateraCustomerId = rawCustomerId === null || rawCustomerId === '' ? null : Number(rawCustomerId);
    saveStore(store);
    res.json(buildDashboardPayload(store, req));
  });

  // Disconnect tenant
  app.delete('/api/tenants/:id', (req, res) => {
    const store = loadStore();
    const prevLen = store.tenants.length;
    store.tenants = store.tenants.filter((t) => t.id !== req.params.id);
    if (store.tenants.length === prevLen) {
      res.status(404).json({ error: 'Tenant connection not found.' });
      return;
    }
    saveStore(store);
    res.json(buildDashboardPayload(store, req));
  });

  // Per-customer deep sync for Monthly Executive Report generation (agents, available patches & retroactive tickets)
  app.post('/api/reports/customer/fetch', async (req, res) => {
    const store = loadStore();
    const rawCustId = req.body?.ateraCustomerId != null ? Number(req.body.ateraCustomerId) : null;
    const ateraCustomerId = rawCustId && Number.isFinite(rawCustId) ? rawCustId : null;
    const tenantInternalId = typeof req.body?.tenantId === 'string' ? req.body.tenantId.trim() : null;
    const reportMonth = typeof req.body?.reportMonth === 'string' ? req.body.reportMonth.trim() : null;
    const retiredDays = Math.max(30, Math.min(365, Number(req.body?.retiredDays) || 120));
    const warnings: string[] = [];

    if (ateraCustomerId != null && isAteraConfigured(store)) {
      const { token } = getEffectiveAteraToken(store);
      const prevAgentById = new Map<number, AteraAgent>(
        store.atera.agents.filter((a) => a.customerId === ateraCustomerId).map((a) => [a.agentId, a])
      );

      const agentsAndPatchesPromise = (async () => {
        const custAgentsRaw = await fetchAteraPaginated<Record<string, unknown>>(
          `agents/customer/${ateraCustomerId}`,
          token,
          10
        );
        const mappedAgents: AteraAgent[] = custAgentsRaw.map((a) => {
          const agentId = num(a.AgentID ?? a.agentId);
          return {
            agentId,
            deviceGuid: str(a.DeviceGuid ?? a.deviceGuid),
            machineName: str(a.MachineName ?? a.machineName) || 'Unknown Host',
            customerId: num(a.CustomerID ?? a.customerId) || ateraCustomerId,
            customerName: str(a.CustomerName ?? a.customerName) || 'Customer',
            online: Boolean(a.Online ?? a.online),
            os: str(a.OS ?? a.os) || 'Unknown OS',
            osType: str(a.OSType ?? a.osType) || 'Unknown',
            lastSeen: str(a.LastSeen ?? a.lastSeen),
            reportedIp: str(a.ReportedFromIP ?? a.reportedFromIp),
            currentLoggedUsers: str(a.CurrentLoggedUsers ?? a.currentLoggedUsers),
            pendingReboot: Boolean(a.PendingReboot ?? a.pendingReboot),
            lastPatchDate: str(a.LastPatchManagementReceived ?? a.lastPatchDate),
            windowsUpdateStatus: str(a.WindowsUpdateStatus ?? a.windowsUpdateStatus),
            osVersion: str(a.OSVersion ?? a.osVersion),
            osBuild: str(a.OSBuild ?? a.osBuild),
            lastRebootTime: str(a.LastRebootTime ?? a.lastRebootTime),
            availablePatchSummary: prevAgentById.get(agentId)?.availablePatchSummary ?? null,
          };
        });

        // Query Atera /api/v3/agents/{deviceGuid}/available-patches for all non-retired devices
        const retiredCutoffMs = Date.now() - retiredDays * 24 * 60 * 60 * 1000;
        const activeToCheck = mappedAgents.filter((agent) => {
          if (!agent.deviceGuid) return false;
          if (agent.online) return true;
          if (!agent.lastSeen) return true;
          const seenMs = Date.parse(agent.lastSeen);
          return !Number.isFinite(seenMs) || seenMs >= retiredCutoffMs;
        });

        const BATCH_SIZE = 12;
        for (let i = 0; i < activeToCheck.length; i += BATCH_SIZE) {
          const chunk = activeToCheck.slice(i, i + BATCH_SIZE);
          await Promise.all(
            chunk.map(async (agent) => {
              if (!agent.deviceGuid) return;
              try {
                const patchRes = await fetchAteraWithAuthFallback(
                  `https://app.atera.com/api/v3/agents/${encodeURIComponent(agent.deviceGuid)}/available-patches`,
                  token
                );
                if (!patchRes.ok) return;
                const payload = (await patchRes.json()) as {
                  timestamp?: string;
                  availableUpdates?: Array<{
                    name?: string;
                    class?: string;
                    kbId?: string;
                    status?: string;
                  }>;
                };
                const updates = Array.isArray(payload?.availableUpdates)
                  ? payload.availableUpdates
                  : [];
                let criticalCount = 0;
                let securityCount = 0;
                let otherCount = 0;
                const pendingTitles: string[] = [];

                for (const u of updates) {
                  const status = String(u.status || '').toLowerCase();
                  if (status === 'installed' || status === 'hidden' || status === 'declined') {
                    continue;
                  }
                  const cls = String(u.class || '').toLowerCase();
                  if (cls.includes('critical')) {
                    criticalCount += 1;
                    if (u.name && pendingTitles.length < 5) pendingTitles.push(u.name);
                  } else if (cls.includes('security')) {
                    securityCount += 1;
                    if (u.name && pendingTitles.length < 5) pendingTitles.push(u.name);
                  } else {
                    otherCount += 1;
                  }
                }

                agent.availablePatchSummary = {
                  checkedAt: str(payload?.timestamp) || new Date().toISOString(),
                  criticalCount,
                  securityCount,
                  otherCount,
                  totalCount: criticalCount + securityCount + otherCount,
                  pendingTitles,
                };
              } catch {
                // Keep previous cached summary if a single agent request fails
              }
            })
          );
        }

        const otherAgents = store.atera.agents.filter((a) => a.customerId !== ateraCustomerId);
        store.atera.agents = [...otherAgents, ...mappedAgents];
      })();

      const ticketsPromise = (async () => {
        const cutoffMs = computeReportCutoffMs(reportMonth);
        const { tickets: fetchedTickets, reachedCutoff } = await fetchRetroactiveTicketsForCustomer(
          token,
          ateraCustomerId,
          cutoffMs
        );
        const byId = new Map<number, AteraTicket>();
        for (const t of store.atera.tickets) byId.set(t.ticketId, t);
        for (const t of fetchedTickets) byId.set(t.ticketId, t);
        store.atera.tickets = Array.from(byId.values()).sort(
          (a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate)
        );
        if (!reachedCutoff) {
          warnings.push(
            `Fetched ${fetchedTickets.length} tickets back to ${fetchedTickets[fetchedTickets.length - 1]?.createdDate.slice(0, 10) || 'latest'}; Atera pagination limit reached before ${new Date(cutoffMs).toISOString().slice(0, 10)}.`
          );
        }
      })();

      const [agentsResult, ticketsResult] = await Promise.allSettled([
        agentsAndPatchesPromise,
        ticketsPromise,
      ]);

      if (agentsResult.status === 'rejected') {
        warnings.push(
          `Atera agents & patches: ${
            agentsResult.reason instanceof Error
              ? agentsResult.reason.message
              : String(agentsResult.reason)
          }`
        );
      }
      if (ticketsResult.status === 'rejected') {
        warnings.push(
          `Atera tickets: ${
            ticketsResult.reason instanceof Error
              ? ticketsResult.reason.message
              : String(ticketsResult.reason)
          }`
        );
      }
    }

    if (tenantInternalId) {
      const tenant = store.tenants.find(
        (t) => t.id === tenantInternalId || t.tenantId.toLowerCase() === tenantInternalId.toLowerCase()
      );
      if (tenant) {
        await syncMicrosoftTenant(tenant);
      }
    }

    saveStore(store);
    res.json({
      dashboard: buildDashboardPayload(store, req),
      warnings,
    });
  });

  // Sync all configured sources (Atera + all M365 tenants)
  app.post('/api/sync-all', async (req, res) => {
    const store = loadStore();
    const errors: string[] = [];

    if (isAteraConfigured(store)) {
      try {
        await syncAteraData(store);
      } catch (err) {
        errors.push(`Atera: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    if (isMicrosoftConfigured() && store.tenants.length > 0) {
      await Promise.all(store.tenants.map((tenant) => syncMicrosoftTenant(tenant)));
      saveStore(store);
    }

    res.json({
      dashboard: buildDashboardPayload(store, req),
      errors,
    });
  });

  // Ensure unmatched /api/* routes always return JSON instead of SPA HTML
  app.all('/api/*', (_req, res) => {
    res.status(404).json({ error: 'API endpoint not found.' });
  });

  app.use((err: unknown, req: Request, res: Response, next: express.NextFunction) => {
    if (req.path.startsWith('/api/')) {
      res.status(500).json({
        error: err instanceof Error ? err.message : 'Internal server error.',
      });
      return;
    }
    next(err);
  });

  // Vite dev middleware or production static build
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.join(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`AegisMSP server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
