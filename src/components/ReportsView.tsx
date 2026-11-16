import { FileText, Printer, RefreshCw, SlidersHorizontal } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AteraAgent, AteraTicket } from '../types';
import { formatShortDate, getScoreLabel, type UnifiedCustomerRow } from '../utils/posture';

interface ReportNarrative {
  mspName: string;
  overviewNote: string;
  mdrNote: string;
  includeBackup: boolean;
  backupNote: string;
  nonCompliantNote: string;
  includeFullTicketTable: boolean;
}

interface CustomerPatchOverride {
  retiredDays: number;
  windowsPcPatched: string;
  windowsServerPatched: string;
  macPatched: string;
  linuxPatched: string;
}

const PATCH_OVERRIDE_STORAGE_KEY = 'aegismsp_patch_overrides_v1';

const DEFAULT_PATCH_OVERRIDE: CustomerPatchOverride = {
  retiredDays: 90,
  windowsPcPatched: '',
  windowsServerPatched: '',
  macPatched: '',
  linuxPatched: '',
};

function loadPatchOverrides(): Record<string, CustomerPatchOverride> {
  try {
    const raw = localStorage.getItem(PATCH_OVERRIDE_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Record<string, CustomerPatchOverride>) : {};
  } catch {
    return {};
  }
}

function defaultReportMonth(): string {
  const now = new Date();
  // Monthly MSP reports cover the previous completed month by default
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const y = prev.getFullYear();
  const m = String(prev.getMonth() + 1).padStart(2, '0');
  return `${y}-${m}`;
}

function formatMonthTitle(ym: string): string {
  const [y, m] = ym.split('-').map(Number);
  if (!y || !m) return ym;
  const d = new Date(y, m - 1, 1);
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function classifyOsBucket(agent: AteraAgent): 'windows_pc' | 'windows_server' | 'mac' | 'linux' {
  const os = `${agent.os} ${agent.osType}`.toLowerCase();
  if (os.includes('server')) return 'windows_server';
  if (os.includes('mac') || os.includes('darwin') || os.includes('osx')) return 'mac';
  if (os.includes('linux') || os.includes('ubuntu') || os.includes('centos') || os.includes('debian')) {
    return 'linux';
  }
  return 'windows_pc';
}

function isRetiredAgent(agent: AteraAgent, retiredDays: number): boolean {
  if (agent.online) return false;
  if (!agent.lastSeen) return false;
  const ts = Date.parse(agent.lastSeen);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts > retiredDays * 24 * 60 * 60 * 1000;
}

function parseWindowsBuild(build: string | null | undefined): { major: number; ubr: number } | null {
  if (!build) return null;
  const match = build.trim().match(/^(\d+)\.(\d+)/);
  if (!match) return null;
  return { major: Number(match[1]), ubr: Number(match[2]) };
}

export interface ReportsContainerProps {
  rows: UnifiedCustomerRow[];
  allTickets: AteraTicket[];
  initialCustomerKey?: string | null;
  onFetchCustomerData: (
    ateraCustomerId: number | null,
    tenantId: string | null,
    reportMonth?: string
  ) => Promise<string[]>;
}

export function CustomerReportsWorkspace({
  rows,
  allTickets,
  initialCustomerKey,
  onFetchCustomerData,
}: ReportsContainerProps) {
  const sortedRows = useMemo(
    () =>
      [...rows].sort((a, b) =>
        a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' })
      ),
    [rows]
  );

  const [selectedKey, setSelectedKey] = useState<string>(() => {
    if (initialCustomerKey && sortedRows.some((r) => r.key === initialCustomerKey)) {
      return initialCustomerKey;
    }
    return sortedRows[0]?.key ?? '';
  });

  useEffect(() => {
    if (initialCustomerKey && sortedRows.some((r) => r.key === initialCustomerKey)) {
      setSelectedKey(initialCustomerKey);
    } else if (!sortedRows.some((r) => r.key === selectedKey) && sortedRows[0]) {
      setSelectedKey(sortedRows[0].key);
    }
  }, [initialCustomerKey, sortedRows, selectedKey]);

  const [reportMonth, setReportMonth] = useState<string>(defaultReportMonth);
  const [fetching, setFetching] = useState(false);
  const [fetchWarnings, setFetchWarnings] = useState<string[]>([]);
  const [showEditor, setShowEditor] = useState(false);

  const selectedCustomer = useMemo(
    () => sortedRows.find((r) => r.key === selectedKey) ?? null,
    [sortedRows, selectedKey]
  );

  const [narrative, setNarrative] = useState<ReportNarrative>({
    mspName: 'Managed IT & Security Operations',
    overviewNote: '',
    mdrNote:
      'Managed Detection and Response monitoring operated smoothly throughout the reporting period, with Defender alerting active for high-priority threats.',
    includeBackup: false,
    backupNote: 'Microsoft 365 backups have been running efficiently with no reported issues.',
    nonCompliantNote:
      'Devices listed as non-compliant or inactive have not checked in for 3 or more weeks (e.g. retired, offline, or placed in storage).',
    includeFullTicketTable: true,
  });

  const customerTicketsForMonth = useMemo(() => {
    if (!selectedCustomer?.ateraCustomer) return [];
    const cid = selectedCustomer.ateraCustomer.customerId;
    return allTickets
      .filter((t) => t.customerId === cid && t.createdDate.startsWith(reportMonth))
      .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate));
  }, [selectedCustomer, allTickets, reportMonth]);

  // Fallback if no tickets in that exact month — let's also compute total customer tickets
  const allCustomerTickets = useMemo(() => {
    if (!selectedCustomer?.ateraCustomer) return [];
    const cid = selectedCustomer.ateraCustomer.customerId;
    return allTickets
      .filter((t) => t.customerId === cid)
      .sort((a, b) => Date.parse(b.createdDate) - Date.parse(a.createdDate));
  }, [selectedCustomer, allTickets]);

  const activeTicketSet = customerTicketsForMonth;

  const ticketStats = useMemo(() => {
    const total = activeTicketSet.length;
    let closedWithinSla = 0;
    let closedOutsideSla = 0;
    let openCount = 0;
    let noSlaCount = 0;

    const tagCounts = new Map<string, number>();

    for (const t of activeTicketSet) {
      const isClosed = ['closed', 'resolved', 'merged'].includes(t.status.toLowerCase());
      if (!isClosed) {
        openCount += 1;
      } else if (t.onSla === true) {
        closedWithinSla += 1;
      } else if (t.onSla === false) {
        closedOutsideSla += 1;
      } else {
        noSlaCount += 1;
      }

      const tag = t.category || t.ticketType || t.priority || 'General Support';
      tagCounts.set(tag, (tagCounts.get(tag) || 0) + 1);
    }

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([tag, count], idx) => ({ rank: idx + 1, tag, count }));

    return { total, closedWithinSla, closedOutsideSla, openCount, noSlaCount, topTags };
  }, [activeTicketSet]);

  const [patchOverridesMap, setPatchOverridesMap] = useState<Record<string, CustomerPatchOverride>>(
    loadPatchOverrides
  );

  const currentPatchOverride: CustomerPatchOverride = useMemo(
    () => (selectedKey ? patchOverridesMap[selectedKey] ?? DEFAULT_PATCH_OVERRIDE : DEFAULT_PATCH_OVERRIDE),
    [patchOverridesMap, selectedKey]
  );

  const updateCurrentPatchOverride = (patch: Partial<CustomerPatchOverride>) => {
    if (!selectedKey) return;
    setPatchOverridesMap((prev) => {
      const next = {
        ...prev,
        [selectedKey]: { ...(prev[selectedKey] ?? DEFAULT_PATCH_OVERRIDE), ...patch },
      };
      try {
        localStorage.setItem(PATCH_OVERRIDE_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  };

  const patchingStats = useMemo(() => {
    const allAgents = selectedCustomer?.agents ?? [];
    const retiredDays = Math.max(7, currentPatchOverride.retiredDays || 90);
    const activeAgents = allAgents.filter((a) => !isRetiredAgent(a, retiredDays));
    const retiredCount = allAgents.length - activeAgents.length;

    // Pick target Patch Tuesday UBR without letting a single preview/IoT outlier (e.g. .9974) invalidate the fleet
    const pickTargetUbr = (ubrs: number[]): number => {
      if (ubrs.length === 0) return 0;
      const counts = new Map<number, number>();
      for (const u of ubrs) counts.set(u, (counts.get(u) || 0) + 1);
      const uniqueDesc = Array.from(counts.keys()).sort((a, b) => b - a);
      const minCluster = ubrs.length >= 4 ? Math.max(2, Math.ceil(ubrs.length * 0.15)) : 1;
      for (const u of uniqueDesc) {
        if ((counts.get(u) || 0) >= minCluster) return u;
      }
      return uniqueDesc[0];
    };

    const winPcAgents = activeAgents.filter((a) => classifyOsBucket(a) === 'windows_pc');
    const winPcBuilds = winPcAgents
      .map((a) => ({ agent: a, parsed: parseWindowsBuild(a.osBuild) }))
      .filter((x): x is { agent: AteraAgent; parsed: { major: number; ubr: number } } => x.parsed !== null);

    const hasModernWin11 = winPcBuilds.some((x) => x.parsed.major >= 26100);
    const latestPcModernUbr = pickTargetUbr(
      winPcBuilds.filter((x) => x.parsed.major >= 26100).map((x) => x.parsed.ubr)
    );
    const latest23h2EnterpriseUbr = pickTargetUbr(
      winPcBuilds
        .filter((x) => x.parsed.major === 22631 && /enterprise|education|ltsc/i.test(x.agent.os))
        .map((x) => x.parsed.ubr)
    );
    const latestWin10Ubr = pickTargetUbr(
      winPcBuilds
        .filter((x) => x.parsed.major >= 19041 && x.parsed.major < 22000)
        .map((x) => x.parsed.ubr)
    );

    const winServerBuilds = activeAgents
      .filter((a) => classifyOsBucket(a) === 'windows_server')
      .map((a) => parseWindowsBuild(a.osBuild))
      .filter((b): b is { major: number; ubr: number } => b !== null);
    const latestServerUbrByMajor = new Map<number, number>();
    for (const major of new Set(winServerBuilds.map((b) => b.major))) {
      latestServerUbrByMajor.set(
        major,
        pickTargetUbr(winServerBuilds.filter((b) => b.major === major).map((b) => b.ubr))
      );
    }

    const hasLivePatchApi = activeAgents.some((a) => a.availablePatchSummary != null);

    const threeWeeksMs = 21 * 24 * 60 * 60 * 1000;
    const evaluateDevicePatchReason = (a: AteraAgent): string | null => {
      // Primary: real Atera /api/v3/agents/{deviceGuid}/available-patches (Critical + Security updates)
      if (a.availablePatchSummary != null) {
        const crit = a.availablePatchSummary.criticalCount;
        const sec = a.availablePatchSummary.securityCount;
        if (crit + sec > 0) {
          const parts: string[] = [];
          if (crit > 0) parts.push(`${crit} Critical`);
          if (sec > 0) parts.push(`${sec} Security`);
          const sample = a.availablePatchSummary.pendingTitles?.[0];
          return sample ? `${parts.join(', ')} — ${sample}` : `${parts.join(', ')} pending`;
        }
        return null;
      }

      // Fallback when available-patches telemetry hasn't been fetched yet for this device
      if (a.pendingReboot) return 'Pending Reboot';
      const bucket = classifyOsBucket(a);
      if (!a.online && a.lastSeen) {
        const lastSeenTs = Date.parse(a.lastSeen);
        if (Number.isFinite(lastSeenTs) && Date.now() - lastSeenTs > threeWeeksMs) {
          return `Offline (${formatShortDate(a.lastSeen)})`;
        }
      }
      const parsed = parseWindowsBuild(a.osBuild);
      if (bucket === 'windows_pc' && parsed) {
        if (parsed.major >= 26100) {
          if (latestPcModernUbr > 0 && parsed.ubr < latestPcModernUbr) {
            return `Pending OS Update (${a.osVersion || parsed.major} · ${a.osBuild})`;
          }
          return null;
        }
        if (parsed.major === 22631 && /enterprise|education|ltsc/i.test(a.os)) {
          if (latest23h2EnterpriseUbr > 0 && parsed.ubr < latest23h2EnterpriseUbr) {
            return `Pending OS Update (${a.osVersion || '23H2'} · ${a.osBuild})`;
          }
          return null;
        }
        if (parsed.major >= 19041 && parsed.major < 22000) {
          if (latestWin10Ubr > 0 && parsed.ubr < latestWin10Ubr) {
            return `Pending OS Update (${a.osVersion || parsed.major} · ${a.osBuild})`;
          }
          return null;
        }
        if (hasModernWin11 && parsed.major < 26100) {
          return `Outdated OS (${a.osVersion || parsed.major} · ${a.osBuild})`;
        }
      }
      if (bucket === 'windows_server' && parsed) {
        const target = latestServerUbrByMajor.get(parsed.major) ?? 0;
        if (target > 0 && parsed.ubr < target) {
          return `Pending OS Update (${a.osBuild})`;
        }
      }
      return null;
    };

    const buckets: Record<
      'windows_pc' | 'windows_server' | 'mac' | 'linux',
      { key: string; label: string; total: number; healthy: number }
    > = {
      windows_pc: { key: 'windows_pc', label: 'Windows PC', total: 0, healthy: 0 },
      windows_server: { key: 'windows_server', label: 'Windows Server', total: 0, healthy: 0 },
      mac: { key: 'mac', label: 'Mac', total: 0, healthy: 0 },
      linux: { key: 'linux', label: 'Linux', total: 0, healthy: 0 },
    };

    const attentionDevices: Array<{ agent: AteraAgent; reason: string }> = [];

    for (const a of activeAgents) {
      const b = classifyOsBucket(a);
      buckets[b].total += 1;
      const reason = evaluateDevicePatchReason(a);
      if (reason) {
        attentionDevices.push({ agent: a, reason });
      } else {
        buckets[b].healthy += 1;
      }
    }

    // Apply optional Atera Patch Management UI overrides if provided
    const applyOverride = (valStr: string, bucketTotal: number, autoHealthy: number) => {
      const trimmed = valStr.trim();
      if (trimmed === '') return autoHealthy;
      const num = Number(trimmed);
      if (!Number.isFinite(num)) return autoHealthy;
      return Math.max(0, Math.min(bucketTotal, Math.round(num)));
    };

    const hasManualOverride =
      currentPatchOverride.windowsPcPatched.trim() !== '' ||
      currentPatchOverride.windowsServerPatched.trim() !== '' ||
      currentPatchOverride.macPatched.trim() !== '' ||
      currentPatchOverride.linuxPatched.trim() !== '';

    buckets.windows_pc.healthy = applyOverride(
      currentPatchOverride.windowsPcPatched,
      buckets.windows_pc.total,
      buckets.windows_pc.healthy
    );
    buckets.windows_server.healthy = applyOverride(
      currentPatchOverride.windowsServerPatched,
      buckets.windows_server.total,
      buckets.windows_server.healthy
    );
    buckets.mac.healthy = applyOverride(
      currentPatchOverride.macPatched,
      buckets.mac.total,
      buckets.mac.healthy
    );
    buckets.linux.healthy = applyOverride(
      currentPatchOverride.linuxPatched,
      buckets.linux.total,
      buckets.linux.healthy
    );

    const bucketList = Object.values(buckets);
    const total = activeAgents.length;
    const upToDate = bucketList.reduce((acc, b) => acc + b.healthy, 0);
    const pct = total > 0 ? Math.round((upToDate / total) * 100) : null;

    return {
      total,
      retiredCount,
      retiredDays,
      upToDate,
      pct,
      hasLivePatchApi,
      hasManualOverride,
      buckets: bucketList,
      attentionDevices,
    };
  }, [selectedCustomer, currentPatchOverride]);

  const staleOrNonCompliant = useMemo(() => {
    const managed = selectedCustomer?.tenant?.managedDevices;
    const list = [
      ...(managed?.nonCompliantDevices ?? []),
      ...(managed?.staleDevices ?? []),
    ];
    const seen = new Set<string>();
    return list.filter((d) => {
      if (seen.has(d.id)) return false;
      seen.add(d.id);
      return true;
    });
  }, [selectedCustomer]);

  const monthLabel = formatMonthTitle(reportMonth);
  const tenant = selectedCustomer?.tenant ?? null;
  const secureScore = tenant?.secureScore ?? null;
  const globalAdmins = tenant?.globalAdmins ?? [];
  const riskyUsers = tenant?.riskyUsers ?? [];
  const activeRiskyUsers = riskyUsers.filter(
    (u) => !['none', 'dismissed', 'remediated'].includes(u.riskState.toLowerCase())
  );
  const malwareAlerts = (tenant?.defenderAlerts ?? []).filter(
    (a) =>
      a.category.toLowerCase().includes('malware') ||
      a.title.toLowerCase().includes('malware') ||
      a.severity.toLowerCase() === 'high'
  );

  const attemptedAutoFetchRef = useRef<Set<string>>(new Set());

  const runFetch = useCallback(
    async (customer: UnifiedCustomerRow, month: string) => {
      setFetching(true);
      setFetchWarnings([]);
      try {
        const warnings = await onFetchCustomerData(
          customer.ateraCustomer?.customerId ?? null,
          customer.tenant?.id ?? null,
          month
        );
        setFetchWarnings(warnings);
      } finally {
        setFetching(false);
      }
    },
    [onFetchCustomerData]
  );

  const handleFetchClick = async () => {
    if (!selectedCustomer) return;
    attemptedAutoFetchRef.current.add(`${selectedCustomer.key}:${reportMonth}`);
    await runFetch(selectedCustomer, reportMonth);
  };

  // Automatically fetch retroactive tickets & live available-patches when switching to a customer/month not cached yet
  useEffect(() => {
    if (!selectedCustomer?.ateraCustomer) return;
    const fetchKey = `${selectedCustomer.key}:${reportMonth}`;
    if (attemptedAutoFetchRef.current.has(fetchKey)) return;

    const monthStartMs = Date.parse(`${reportMonth}-01T00:00:00Z`);
    const customerTickets = allCustomerTickets;
    const oldestCachedMs =
      customerTickets.length > 0
        ? Math.min(...customerTickets.map((t) => Date.parse(t.createdDate) || Date.now()))
        : Date.now();

    const retiredDays = Math.max(7, currentPatchOverride.retiredDays || 90);
    const activeAgents = selectedCustomer.agents.filter((a) => !isRetiredAgent(a, retiredDays));
    const missingPatchTelemetry =
      activeAgents.length > 0 && !activeAgents.some((a) => a.availablePatchSummary != null);

    if (oldestCachedMs > monthStartMs || missingPatchTelemetry) {
      attemptedAutoFetchRef.current.add(fetchKey);
      void runFetch(selectedCustomer, reportMonth);
    }
  }, [selectedCustomer, reportMonth, allCustomerTickets, currentPatchOverride.retiredDays, runFetch]);

  if (rows.length === 0) {
    return (
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-12 text-center space-y-2">
        <FileText className="w-8 h-8 text-slate-400 mx-auto" />
        <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
          No customers available for reporting
        </h2>
        <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
          Sync Atera RMM or connect a Microsoft 365 tenant first to generate customer monthly executive PDF reports.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Report Control Bar (Hidden when printing) */}
      <div className="print:hidden bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-4 space-y-4">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <div>
              <label htmlFor="report-customer" className="sr-only">
                Customer
              </label>
              <select
                id="report-customer"
                value={selectedKey}
                onChange={(e) => setSelectedKey(e.target.value)}
                className="h-9 px-3 text-xs font-medium bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 max-w-[260px]"
              >
                {sortedRows.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.displayName} {r.tenant ? '(M365 + RMM)' : r.ateraCustomer ? '(RMM)' : '(M365)'}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="report-month" className="sr-only">
                Report Month
              </label>
              <input
                id="report-month"
                type="month"
                value={reportMonth}
                onChange={(e) => setReportMonth(e.target.value)}
                className="h-9 px-3 text-xs font-mono bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <button
              type="button"
              onClick={handleFetchClick}
              disabled={fetching || !selectedCustomer}
              className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${fetching ? 'animate-spin' : ''}`} />
              <span>{fetching ? 'Fetching Customer Data...' : 'Fetch Live Customer Data'}</span>
            </button>

            <button
              type="button"
              onClick={() => setShowEditor((v) => !v)}
              className={`h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                showEditor
                  ? 'bg-slate-900 text-white border-slate-900 dark:bg-slate-100 dark:text-slate-900 dark:border-slate-100'
                  : 'text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-950 border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              <span>Customize Narrative</span>
            </button>
          </div>

          <button
            type="button"
            onClick={() => window.print()}
            className="h-9 px-4 inline-flex items-center gap-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Printer className="w-3.5 h-3.5" />
            <span>Print / Save as PDF</span>
          </button>
        </div>

        {fetchWarnings.length > 0 && (
          <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300">
            {fetchWarnings.join(' | ')}
          </div>
        )}

        {showEditor && (
          <div className="pt-4 border-t border-slate-200 dark:border-slate-800 grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
            <div className="space-y-1.5">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                MSP / Prepared By Label
              </label>
              <input
                type="text"
                value={narrative.mspName}
                onChange={(e) => setNarrative({ ...narrative, mspName: e.target.value })}
                className="h-9 w-full px-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Executive Overview Highlight
              </label>
              <input
                type="text"
                value={narrative.overviewNote}
                onChange={(e) => setNarrative({ ...narrative, overviewNote: e.target.value })}
                placeholder={`e.g. Steady operations for ${selectedCustomer?.displayName} during ${monthLabel}.`}
                className="h-9 w-full px-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Managed Detection &amp; Response (MDR) Note
              </label>
              <textarea
                rows={2}
                value={narrative.mdrNote}
                onChange={(e) => setNarrative({ ...narrative, mdrNote: e.target.value })}
                className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-medium text-slate-700 dark:text-slate-300">
                Non-Compliant / Inactive Devices Note
              </label>
              <textarea
                rows={2}
                value={narrative.nonCompliantNote}
                onChange={(e) => setNarrative({ ...narrative, nonCompliantNote: e.target.value })}
                className="w-full p-2.5 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="md:col-span-2 flex flex-wrap items-center gap-6 pt-1">
              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={narrative.includeBackup}
                  onChange={(e) => setNarrative({ ...narrative, includeBackup: e.target.checked })}
                  className="rounded border-slate-300"
                />
                <span>Include Microsoft 365 Backup Summary</span>
              </label>

              <label className="inline-flex items-center gap-2 text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={narrative.includeFullTicketTable}
                  onChange={(e) =>
                    setNarrative({ ...narrative, includeFullTicketTable: e.target.checked })
                  }
                  className="rounded border-slate-300"
                />
                <span>Include Full Monthly Ticket Table at Bottom</span>
              </label>
            </div>

            {narrative.includeBackup && (
              <div className="md:col-span-2 space-y-1.5">
                <label className="font-medium text-slate-700 dark:text-slate-300">
                  Microsoft 365 Backup Status Note
                </label>
                <input
                  type="text"
                  value={narrative.backupNote}
                  onChange={(e) => setNarrative({ ...narrative, backupNote: e.target.value })}
                  className="h-9 w-full px-3 bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                />
              </div>
            )}

            {/* Patch Management Controls (Retired Filter & Optional Atera Patch Overview Override) */}
            <div className="md:col-span-2 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="font-medium text-slate-800 dark:text-slate-200">
                    Patch Management Settings ({selectedCustomer?.displayName})
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Excludes offline devices unseen beyond the retired threshold. Auto-calculates from Atera&apos;s live Critical &amp; Security available-patches endpoint; optionally override bucket counts below.
                  </p>
                </div>
                {patchingStats.hasManualOverride && (
                  <button
                    type="button"
                    onClick={() =>
                      updateCurrentPatchOverride({
                        windowsPcPatched: '',
                        windowsServerPatched: '',
                        macPatched: '',
                        linuxPatched: '',
                      })
                    }
                    className="text-[11px] font-medium text-blue-600 dark:text-blue-400 underline"
                  >
                    Reset to Auto
                  </button>
                )}
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] text-slate-600 dark:text-slate-400">
                    Retired after (days)
                  </label>
                  <input
                    type="number"
                    min={7}
                    max={365}
                    value={currentPatchOverride.retiredDays}
                    onChange={(e) =>
                      updateCurrentPatchOverride({ retiredDays: Number(e.target.value) || 90 })
                    }
                    className="h-8 w-full px-2.5 font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                  />
                </div>
                {patchingStats.buckets.map((b) => {
                  const fieldKey =
                    b.key === 'windows_pc'
                      ? 'windowsPcPatched'
                      : b.key === 'windows_server'
                        ? 'windowsServerPatched'
                        : b.key === 'mac'
                          ? 'macPatched'
                          : 'linuxPatched';
                  return (
                    <div key={b.key} className="space-y-1">
                      <label className="text-[11px] text-slate-600 dark:text-slate-400">
                        {b.label} patched (of {b.total})
                      </label>
                      <input
                        type="number"
                        min={0}
                        max={b.total}
                        placeholder={String(b.healthy)}
                        value={currentPatchOverride[fieldKey]}
                        onChange={(e) => updateCurrentPatchOverride({ [fieldKey]: e.target.value })}
                        className="h-8 w-full px-2.5 font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Printable Executive PDF Document */}
      {selectedCustomer && (
        <article className="bg-white text-slate-900 border border-slate-200 print:border-0 rounded-xl print:rounded-none p-8 sm:p-12 max-w-[960px] mx-auto space-y-10 shadow-xs print:shadow-none">
          {/* Document Header */}
          <header className="text-center pb-8 border-b border-slate-200 space-y-2">
            <div className="text-xs font-medium text-slate-500 tracking-wide">
              {narrative.mspName}
            </div>
            <h1 className="font-display text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">
              {selectedCustomer.displayName}
            </h1>
            <div className="text-base font-medium text-slate-700">
              {monthLabel} Monthly Report
            </div>
            <div className="text-xs text-slate-500 font-mono pt-1">
              {selectedCustomer.domain || 'No verified domain'} · Generated{' '}
              {new Date().toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
              })}
            </div>
          </header>

          {/* Section 1: Executive Summary */}
          <section className="space-y-4">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Executive Summary
            </h2>

            {narrative.overviewNote && (
              <p className="text-sm text-slate-700 leading-relaxed">{narrative.overviewNote}</p>
            )}

            <div className="space-y-3 text-sm text-slate-700 leading-relaxed">
              <div>
                <div className="font-semibold text-slate-900">Tickets</div>
                <p>
                  {selectedCustomer.ateraCustomer ? (
                    activeTicketSet.length > 0 ? (
                      <>
                        A total of <span className="font-mono font-semibold">{ticketStats.total}</span>{' '}
                        tickets were logged in {monthLabel}:{' '}
                        <span className="font-mono font-semibold">{ticketStats.closedWithinSla}</span>{' '}
                        closed within SLA
                        {ticketStats.closedOutsideSla > 0 && (
                          <>
                            , <span className="font-mono font-semibold">{ticketStats.closedOutsideSla}</span>{' '}
                            closed outside SLA
                          </>
                        )}
                        {ticketStats.noSlaCount > 0 && (
                          <>
                            , <span className="font-mono font-semibold">{ticketStats.noSlaCount}</span>{' '}
                            without SLA applied
                          </>
                        )}
                        , and <span className="font-mono font-semibold">{ticketStats.openCount}</span>{' '}
                        open.
                      </>
                    ) : (
                      <>
                        No tickets recorded in {monthLabel} (total historical tickets loaded:{' '}
                        <span className="font-mono">{allCustomerTickets.length}</span>). Click{' '}
                        <em>Fetch Live Customer Data</em> to refresh ticket history.
                      </>
                    )
                  ) : (
                    'Not linked to an Atera RMM customer.'
                  )}
                </p>
              </div>

              <div>
                <div className="font-semibold text-slate-900">Patching</div>
                <p>
                  {patchingStats.total > 0 ? (
                    <>
                      <span className="font-mono font-semibold">{patchingStats.pct}%</span> of active devices (
                      <span className="font-mono">
                        {patchingStats.upToDate} out of {patchingStats.total}
                      </span>
                      ) are up to date
                      {patchingStats.retiredCount > 0
                        ? ` (${patchingStats.retiredCount} retired devices offline > ${patchingStats.retiredDays} days excluded)`
                        : ''}
                      .
                      {patchingStats.attentionDevices.length > 0
                        ? ' Devices needing OS updates or check-in attention are listed in the Patching section below.'
                        : ''}
                    </>
                  ) : (
                    'No active RMM agents found for this customer.'
                  )}
                </p>
              </div>

              <div>
                <div className="font-semibold text-slate-900">
                  Managed Detection and Response (MDR)
                </div>
                <p>
                  {narrative.mdrNote}{' '}
                  {tenant && (
                    <>
                      Currently{' '}
                      <span className="font-mono font-semibold">
                        {tenant.defenderAlerts.length}
                      </span>{' '}
                      Microsoft Defender security alerts are logged in the active feed.
                    </>
                  )}
                </p>
              </div>

              {narrative.includeBackup && (
                <div>
                  <div className="font-semibold text-slate-900">Microsoft 365 Backup</div>
                  <p>{narrative.backupNote}</p>
                </div>
              )}

              <div>
                <div className="font-semibold text-slate-900">Secure Score</div>
                <p>
                  {secureScore ? (
                    <>
                      Microsoft Secure Score stands at{' '}
                      <span className="font-mono font-semibold">{secureScore.percentage}%</span> (
                      <span className="font-mono">
                        {secureScore.currentScore} / {secureScore.maxScore}
                      </span>{' '}
                      points)
                      {secureScore.similarSizeAverage != null
                        ? `, compared to ${Math.round(secureScore.similarSizeAverage * 10) / 10} points for organizations of a similar size.`
                        : '.'}
                    </>
                  ) : (
                    'Microsoft 365 tenant not yet connected for Secure Score telemetry.'
                  )}
                </p>
              </div>

              <div>
                <div className="font-semibold text-slate-900">Security Hardening &amp; Identity</div>
                <p>
                  {tenant ? (
                    <>
                      {malwareAlerts.length === 0
                        ? 'No high-severity malware detections'
                        : `${malwareAlerts.length} high-severity/malware Defender alert(s) detected`}
                      {' · '}
                      {activeRiskyUsers.length === 0
                        ? 'No risky user sign-ins flagged.'
                        : `${activeRiskyUsers.length} risky user account(s) flagged.`}
                    </>
                  ) : (
                    'Connect M365 tenant to inspect Defender malware and risky user posture.'
                  )}
                </p>
              </div>

              <div>
                <div className="font-semibold text-slate-900">
                  Non-Compliant &amp; Inactive Devices
                </div>
                <p>
                  {tenant?.managedDevices ? (
                    <>
                      <span className="font-mono font-semibold">
                        {tenant.managedDevices.nonCompliant}
                      </span>{' '}
                      non-compliant device(s) out of{' '}
                      <span className="font-mono">{tenant.managedDevices.total}</span> Intune-managed
                      devices. {narrative.nonCompliantNote}
                    </>
                  ) : (
                    narrative.nonCompliantNote
                  )}
                </p>
              </div>
            </div>
          </section>

          {/* Section 2: Tickets */}
          <section className="space-y-5 pt-6 border-t border-slate-200 break-inside-avoid">
            <div>
              <h2 className="font-display text-lg font-semibold text-slate-900">Tickets</h2>
              <p className="text-xs text-slate-500 mt-0.5">
                Top 5 tickets by tag / category for {monthLabel}
              </p>
            </div>

            {ticketStats.topTags.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                <table className="w-full text-left border-collapse border border-slate-200 text-xs">
                  <thead>
                    <tr className="bg-blue-700 text-white font-semibold">
                      <th className="py-2 px-3 w-10">#</th>
                      <th className="py-2 px-3">Tag / Category</th>
                      <th className="py-2 px-3 text-right">Tickets</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {ticketStats.topTags.map((row) => (
                      <tr key={row.tag}>
                        <td className="py-2 px-3 font-mono tabular-nums text-slate-500">
                          {row.rank}
                        </td>
                        <td className="py-2 px-3 font-medium text-slate-900">{row.tag}</td>
                        <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900">
                          {row.count}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>

                <TicketDonutSvg
                  total={ticketStats.total}
                  closedWithin={ticketStats.closedWithinSla}
                  closedOutside={ticketStats.closedOutsideSla}
                  noSla={ticketStats.noSlaCount}
                  open={ticketStats.openCount}
                />
              </div>
            ) : (
              <div className="p-4 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500">
                No tickets found for {monthLabel}. Select another month or click{' '}
                <strong>Fetch Live Customer Data</strong>.
              </div>
            )}
          </section>

          {/* Section 3: Patching */}
          <section className="space-y-5 pt-6 border-t border-slate-200 break-inside-avoid">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="font-display text-lg font-semibold text-slate-900">Patching</h2>
              {patchingStats.retiredCount > 0 && (
                <span className="text-[11px] text-slate-500">
                  Online &amp; offline active devices ({patchingStats.retiredCount} retired excluded)
                </span>
              )}
            </div>

            {patchingStats.total > 0 ? (
              <div className="space-y-5">
                <div className="p-5 border border-slate-200 rounded-lg space-y-5">
                  <div className="space-y-2">
                    <div className="flex items-baseline justify-between text-xs">
                      <span className="font-semibold text-slate-800">
                        {patchingStats.hasManualOverride
                          ? 'OS patching status (Atera Critical & Security — manual override)'
                          : patchingStats.hasLivePatchApi
                            ? 'OS patching status (Atera Critical & Security updates)'
                            : 'OS patching status (OS build & check-in currency)'}
                      </span>
                      <span className="font-mono tabular-nums text-slate-600">
                        {patchingStats.upToDate} out of {patchingStats.total} devices
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 w-10">
                        {patchingStats.pct}%
                      </span>
                      <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-emerald-600 rounded-full"
                          style={{ width: `${patchingStats.pct ?? 0}%` }}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2">
                    {patchingStats.buckets.map((b) => {
                      const bpct = b.total > 0 ? Math.round((b.healthy / b.total) * 100) : null;
                      return (
                        <div key={b.label} className="flex flex-col items-center text-center gap-2">
                          <OsRingSvg percentage={bpct} />
                          <div>
                            <div className="text-xs font-medium text-slate-800">{b.label}</div>
                            <div className="text-[11px] font-mono tabular-nums text-slate-500">
                              {b.total > 0 ? `${b.healthy}/${b.total} up to date` : '0 devices'}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {patchingStats.attentionDevices.length > 0 && (
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse border border-slate-200 text-xs">
                      <thead>
                        <tr className="bg-blue-700 text-white font-semibold">
                          <th className="py-2 px-3">Device Name</th>
                          <th className="py-2 px-3">User</th>
                          <th className="py-2 px-3">Device Type</th>
                          <th className="py-2 px-3 text-right">Patch / Build Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-200">
                        {patchingStats.attentionDevices.slice(0, 25).map(({ agent: dev, reason }) => (
                          <tr key={dev.agentId}>
                            <td className="py-2 px-3 font-mono font-medium text-slate-900">
                              {dev.machineName}
                            </td>
                            <td className="py-2 px-3 text-slate-700">
                              {dev.currentLoggedUsers || '—'}
                            </td>
                            <td className="py-2 px-3 text-slate-700">{dev.osType || dev.os}</td>
                            <td className="py-2 px-3 text-right font-mono text-slate-700">
                              {reason}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">
                No active Atera RMM agents linked to this customer.
              </p>
            )}
          </section>

          {/* Section 4: Microsoft 365 Security */}
          <section className="space-y-6 pt-6 border-t border-slate-200">
            <h2 className="font-display text-lg font-semibold text-slate-900">
              Microsoft 365 Security
            </h2>

            {tenant && secureScore ? (
              <div className="space-y-6">
                {/* Secure Score Summary & Top Recommended Actions */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-6 p-5 border border-slate-200 rounded-lg break-inside-avoid">
                  <div className="space-y-4">
                    <div>
                      <div className="text-xs text-slate-500">Microsoft Secure Score</div>
                      <div className="flex items-baseline gap-2 mt-1">
                        <span className="font-mono text-2xl font-bold tabular-nums text-slate-900">
                          {secureScore.percentage}%
                        </span>
                        <span className={`text-xs font-medium ${getScoreLabel(secureScore.percentage).textClass}`}>
                          {secureScore.currentScore} / {secureScore.maxScore} pts
                        </span>
                      </div>
                    </div>

                    {tenant.scoreHistory.length >= 2 && (
                      <MiniScoreTrend points={tenant.scoreHistory} />
                    )}

                    <div className="space-y-2 pt-2 border-t border-slate-100">
                      <div className="text-[11px] font-semibold text-slate-600">
                        Category Breakdown
                      </div>
                      {tenant.categoryBreakdown.map((c) => (
                        <div key={c.category} className="space-y-1">
                          <div className="flex justify-between text-[11px]">
                            <span className="text-slate-700">{c.category}</span>
                            <span className="font-mono tabular-nums text-slate-600">
                              {c.percentage}%
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div
                              className="h-full bg-blue-600 rounded-full"
                              style={{ width: `${Math.min(100, c.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>

                    {secureScore.similarSizeAverage != null && (
                      <div className="space-y-1.5 pt-2 border-t border-slate-100 text-[11px]">
                        <div className="font-semibold text-slate-600">Comparison</div>
                        <div className="flex justify-between">
                          <span>Your score</span>
                          <span className="font-mono font-semibold">{secureScore.currentScore} pts</span>
                        </div>
                        <div className="flex justify-between text-slate-500">
                          <span>Similar size orgs</span>
                          <span className="font-mono">
                            {Math.round(secureScore.similarSizeAverage * 10) / 10} pts
                          </span>
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="md:col-span-2 space-y-2">
                    <div className="text-xs font-semibold text-slate-800">
                      Top Recommended Actions
                    </div>
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-200 text-slate-500">
                          <th className="py-1.5 pr-3">Recommended action</th>
                          <th className="py-1.5 px-2 text-right">Impact</th>
                          <th className="py-1.5 px-2">Status</th>
                          <th className="py-1.5 pl-2">Category</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {tenant.controls
                          .filter((c) => c.scoreGap > 0)
                          .slice(0, 8)
                          .map((c) => (
                            <tr key={c.controlName}>
                              <td className="py-1.5 pr-3 font-medium text-slate-900">
                                {c.title}
                              </td>
                              <td className="py-1.5 px-2 text-right font-mono tabular-nums text-emerald-700 whitespace-nowrap">
                                +{c.scoreGap} pts
                              </td>
                              <td className="py-1.5 px-2 text-slate-600 whitespace-nowrap">
                                {c.implementationStatus}
                              </td>
                              <td className="py-1.5 pl-2 text-slate-600 whitespace-nowrap">
                                {c.category}
                              </td>
                            </tr>
                          ))}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* Devices Not Reporting / Non-Compliant */}
                <div className="space-y-2 break-inside-avoid">
                  <div className="text-xs font-semibold text-slate-800">
                    Devices non-compliant or inactive (&gt; 21 days)
                  </div>
                  <table className="w-full text-left border-collapse border border-slate-200 text-xs">
                    <thead>
                      <tr className="bg-blue-700 text-white font-semibold">
                        <th className="py-2 px-3">Device Name</th>
                        <th className="py-2 px-3">Last Sync / Update</th>
                        <th className="py-2 px-3">OS Platform</th>
                        <th className="py-2 px-3">Compliance / Version</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {staleOrNonCompliant.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="py-2.5 px-3 text-slate-500">
                            No non-compliant or stale Intune devices reported.
                          </td>
                        </tr>
                      ) : (
                        staleOrNonCompliant.slice(0, 15).map((d) => (
                          <tr key={d.id}>
                            <td className="py-2 px-3 font-mono font-medium text-slate-900">
                              {d.deviceName}
                            </td>
                            <td className="py-2 px-3 font-mono text-slate-600">
                              {formatShortDate(d.lastSyncDateTime)}
                            </td>
                            <td className="py-2 px-3 text-slate-700">{d.operatingSystem}</td>
                            <td className="py-2 px-3 text-slate-700 capitalize">
                              {d.complianceState} {d.osVersion ? `(${d.osVersion})` : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>

                {/* Defender Alerts & Identity */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs break-inside-avoid">
                  <div className="p-4 border border-slate-200 rounded-lg space-y-1">
                    <div className="font-semibold text-slate-900">
                      Defender Alerts &amp; Malware Status
                    </div>
                    <p className="text-slate-600">
                      {tenant.defenderAlerts.length === 0
                        ? '0 active Microsoft Defender alerts. No action needed.'
                        : `${tenant.defenderAlerts.length} active Defender alert(s) (${malwareAlerts.length} high/malware).`}
                    </p>
                  </div>

                  <div className="p-4 border border-slate-200 rounded-lg space-y-1">
                    <div className="font-semibold text-slate-900">Identity &amp; Risky Sign-ins</div>
                    <p className="text-slate-600">
                      {activeRiskyUsers.length === 0
                        ? 'No active risky users or sign-ins flagged.'
                        : `${activeRiskyUsers.length} risky user account(s) require review.`}
                    </p>
                  </div>
                </div>

                {/* Global Administrator Roles */}
                <div className="space-y-2 break-inside-avoid">
                  <div className="text-xs font-semibold text-slate-800">
                    Global Administrator roles in 365 Tenancy
                  </div>
                  {globalAdmins.length > 0 &&
                    globalAdmins.every(
                      (adm) =>
                        adm.displayName === 'Unnamed Admin' ||
                        adm.displayName.startsWith('Name hidden')
                    ) && (
                      <div className="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-[11px] text-amber-900">
                        Graph returned {globalAdmins.length} Global Administrator assignment(s), but
                        user names and UPNs are withheld when{' '}
                        <span className="font-mono">RoleManagement.Read.Directory</span> is granted
                        without <span className="font-mono">User.Read.All</span> (or{' '}
                        <span className="font-mono">Directory.Read.All</span>). Add{' '}
                        <span className="font-mono">User.Read.All</span> + admin consent in Entra,
                        then re-sync the tenant.
                      </div>
                    )}
                  <table className="w-full text-left border-collapse border border-slate-200 text-xs">
                    <thead>
                      <tr className="bg-blue-700 text-white font-semibold">
                        <th className="py-2 px-3">Role Display Name</th>
                        <th className="py-2 px-3">User Principal Name</th>
                        <th className="py-2 px-3">Display Name</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {globalAdmins.length === 0 ? (
                        <tr>
                          <td colSpan={3} className="py-2.5 px-3 text-slate-500">
                            No Global Administrators returned (requires{' '}
                            <span className="font-mono">RoleManagement.Read.Directory</span> +{' '}
                            <span className="font-mono">User.Read.All</span>, or{' '}
                            <span className="font-mono">Directory.Read.All</span>).
                          </td>
                        </tr>
                      ) : (
                        globalAdmins.map((adm) => (
                          <tr key={adm.id}>
                            <td className="py-2 px-3 text-slate-800">{adm.roleDisplayName}</td>
                            <td className="py-2 px-3 font-mono text-slate-700">
                              {adm.userPrincipalName}
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900">
                              {adm.displayName}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="p-4 border border-dashed border-slate-200 rounded-lg text-xs text-slate-500">
                No Microsoft 365 Defender tenant linked to this customer yet. Link a tenant in{' '}
                <strong>Integrations &amp; Setup</strong> to include Secure Score, Defender alerts, and Global Administrator roles.
              </div>
            )}
          </section>

          {/* Optional Appendix: Full Ticket Table */}
          {narrative.includeFullTicketTable && activeTicketSet.length > 0 && (
            <section className="space-y-3 pt-6 border-t border-slate-200">
              <h2 className="font-display text-lg font-semibold text-slate-900">
                {monthLabel} Ticket Log ({activeTicketSet.length})
              </h2>
              <table className="w-full text-left border-collapse border border-slate-200 text-xs">
                <thead>
                  <tr className="bg-blue-700 text-white font-semibold">
                    <th className="py-2 px-3">ID</th>
                    <th className="py-2 px-3">Title</th>
                    <th className="py-2 px-3">Tag / Category</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Created</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {activeTicketSet.map((tk) => (
                    <tr key={tk.ticketId}>
                      <td className="py-1.5 px-3 font-mono tabular-nums text-slate-600">
                        #{tk.ticketId}
                      </td>
                      <td className="py-1.5 px-3 font-medium text-slate-900">{tk.title}</td>
                      <td className="py-1.5 px-3 text-slate-700">
                        {tk.category || tk.ticketType || tk.priority}
                      </td>
                      <td className="py-1.5 px-3 text-slate-700">{tk.status}</td>
                      <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600">
                        {formatShortDate(tk.createdDate)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </article>
      )}
    </div>
  );
}

function TicketDonutSvg({
  total,
  closedWithin,
  closedOutside,
  noSla,
  open,
}: {
  total: number;
  closedWithin: number;
  closedOutside: number;
  noSla: number;
  open: number;
}) {
  const segments = [
    { label: 'Closed Within SLA', count: closedWithin, color: '#2563EB' },
    { label: 'Closed Outside SLA', count: closedOutside, color: '#DC2626' },
    { label: 'No SLA Applied', count: noSla, color: '#64748B' },
    { label: 'Open', count: open, color: '#D97706' },
  ].filter((s) => s.count > 0);

  const radius = 58;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="flex items-center justify-center gap-6">
      <svg width="150" height="150" viewBox="0 0 150 150" aria-label="Ticket SLA distribution chart">
        <circle cx="75" cy="75" r={radius} fill="none" stroke="#E2E8F0" strokeWidth="22" />
        {total > 0 &&
          segments.map((seg) => {
            const len = (seg.count / total) * circumference;
            const dash = `${len} ${circumference - len}`;
            const currentOffset = offset;
            offset += len;
            return (
              <circle
                key={seg.label}
                cx="75"
                cy="75"
                r={radius}
                fill="none"
                stroke={seg.color}
                strokeWidth="22"
                strokeDasharray={dash}
                strokeDashoffset={-currentOffset}
                transform="rotate(-90 75 75)"
              />
            );
          })}
        <text
          x="75"
          y="72"
          textAnchor="middle"
          className="fill-slate-900 font-mono text-lg font-bold"
        >
          {total}
        </text>
        <text x="75" y="88" textAnchor="middle" className="fill-slate-500 text-[10px]">
          tickets
        </text>
      </svg>

      <div className="space-y-1.5 text-xs">
        {segments.map((seg) => {
          const pct = total > 0 ? Math.round((seg.count / total) * 1000) / 10 : 0;
          return (
            <div key={seg.label} className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: seg.color }}
              />
              <span className="text-slate-700">{seg.label}</span>
              <span className="font-mono tabular-nums text-slate-900 font-medium">
                {pct}% ({seg.count})
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OsRingSvg({ percentage }: { percentage: number | null }) {
  const r = 24;
  const circ = 2 * Math.PI * r;
  const pct = percentage ?? 0;
  const fill = (pct / 100) * circ;

  return (
    <svg width="64" height="64" viewBox="0 0 64 64" aria-hidden="true">
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke={percentage != null && pct < 100 ? '#F59E0B' : '#E2E8F0'}
        strokeWidth="6"
      />
      {percentage != null && (
        <circle
          cx="32"
          cy="32"
          r={r}
          fill="none"
          stroke={pct >= 70 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626'}
          strokeWidth="6"
          strokeDasharray={`${fill} ${circ - fill}`}
          strokeLinecap="butt"
          transform="rotate(-90 32 32)"
        />
      )}
      <text
        x="32"
        y="36"
        textAnchor="middle"
        className="fill-slate-800 font-mono text-[11px] font-semibold"
      >
        {percentage != null ? `${percentage}%` : '—'}
      </text>
    </svg>
  );
}

function MiniScoreTrend({
  points,
}: {
  points: Array<{ date: string; percentage: number }>;
}) {
  const width = 220;
  const height = 56;
  const vals = points.map((p) => p.percentage);
  const min = Math.max(0, Math.min(...vals) - 5);
  const max = Math.min(100, Math.max(...vals) + 5);
  const span = Math.max(5, max - min);

  const path = points
    .map((p, idx) => {
      const x = points.length === 1 ? width / 2 : (idx / (points.length - 1)) * width;
      const y = height - 6 - ((p.percentage - min) / span) * (height - 12);
      return `${idx === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-14" aria-hidden="true">
      <path d={path} fill="none" stroke="#2563EB" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
