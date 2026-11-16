import { Download, ExternalLink, FileText, RefreshCw, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { AteraCustomer } from '../types';
import {
  exportPostureCsv,
  formatRelativeTime,
  getScoreLabel,
  getSeverityStyle,
  type UnifiedCustomerRow,
} from '../utils/posture';
import type { NavTab } from './Sidebar';

interface CustomersViewProps {
  rows: UnifiedCustomerRow[];
  ateraCustomers: AteraCustomer[];
  inspectedCustomerKey: string | null;
  onInspectCustomer: (key: string | null) => void;
  onSyncTenant: (tenantId: string) => Promise<void>;
  onMapTenant: (tenantId: string, ateraCustomerId: number | null) => Promise<void>;
  onNavigate: (tab: NavTab) => void;
  onGenerateReport: (key: string) => void;
}

type LinkFilter = 'all' | 'linked' | 'm365_only' | 'atera_only';

export function CustomersView({
  rows,
  ateraCustomers,
  inspectedCustomerKey,
  onInspectCustomer,
  onSyncTenant,
  onMapTenant,
  onNavigate,
  onGenerateReport,
}: CustomersViewProps) {
  const [search, setSearch] = useState('');
  const [linkFilter, setLinkFilter] = useState<LinkFilter>('all');
  const [syncingTenantId, setSyncingTenantId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (linkFilter === 'linked' && !(r.ateraCustomer && r.tenant)) return false;
      if (linkFilter === 'm365_only' && !(r.tenant && !r.ateraCustomer)) return false;
      if (linkFilter === 'atera_only' && !(r.ateraCustomer && !r.tenant)) return false;
      if (search.trim()) {
        const q = search.toLowerCase();
        const nameMatch = r.displayName.toLowerCase().includes(q);
        const domMatch = (r.domain || '').toLowerCase().includes(q);
        if (!nameMatch && !domMatch) return false;
      }
      return true;
    });
  }, [rows, linkFilter, search]);

  const inspectedRow = useMemo(
    () => rows.find((r) => r.key === inspectedCustomerKey) ?? null,
    [rows, inspectedCustomerKey]
  );

  const sortedAteraCustomers = useMemo(
    () =>
      [...ateraCustomers].sort((a, b) =>
        a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' })
      ),
    [ateraCustomers]
  );

  const handleSyncOne = async (tenantId: string) => {
    setSyncingTenantId(tenantId);
    try {
      await onSyncTenant(tenantId);
    } finally {
      setSyncingTenantId(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Filter customer or domain..."
              aria-label="Filter customer or domain"
              className="h-9 pl-8 pr-3 w-64 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
            {(
              [
                ['all', 'All'],
                ['linked', 'Linked'],
                ['m365_only', 'M365 Only'],
                ['atera_only', 'Atera Only'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setLinkFilter(id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  linkFilter === id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          onClick={() => exportPostureCsv(filtered)}
          disabled={filtered.length === 0}
          className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Main Matrix Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
              No matching customers or tenants found
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Adjust your filters or connect Atera RMM and Microsoft 365 tenants in Integrations & Setup.
            </p>
            <button
              type="button"
              onClick={() => onNavigate('integrations')}
              className="mt-2 inline-flex px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
            >
              Configure Connections
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/50">
                  <th className="py-2.5 px-5">Customer / Organization</th>
                  <th className="py-2.5 px-4">Integration State</th>
                  <th className="py-2.5 px-4 text-right">Secure Score</th>
                  <th className="py-2.5 px-4 text-right">RMM Agents</th>
                  <th className="py-2.5 px-4 text-right">Alerts (M365 / RMM)</th>
                  <th className="py-2.5 px-4 text-right">Open Tickets</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.map((row) => {
                  const score = row.tenant?.secureScore;
                  const scoreMeta = score ? getScoreLabel(score.percentage) : null;
                  const linkState =
                    row.ateraCustomer && row.tenant
                      ? 'Atera + M365'
                      : row.tenant
                        ? 'M365 Only'
                        : 'Atera Only';

                  return (
                    <tr
                      key={row.key}
                      onClick={() => onInspectCustomer(row.key)}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                    >
                      <td className="py-2.5 px-5">
                        <div className="font-medium text-slate-900 dark:text-slate-100">
                          {row.displayName}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 font-mono">
                          {row.domain || (row.tenant ? row.tenant.tenantId.slice(0, 18) : `ID ${row.ateraCustomer?.customerId}`)}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                        {linkState}
                        {row.tenant?.lastSyncStatus === 'error' && (
                          <span className="text-red-600 dark:text-red-400"> · Sync error</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right whitespace-nowrap">
                        {score ? (
                          <div className="inline-flex flex-col items-end">
                            <span className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                              {score.percentage}%
                            </span>
                            <span className={`text-[11px] font-mono tabular-nums ${scoreMeta?.textClass}`}>
                              {score.currentScore}/{score.maxScore} · {scoreMeta?.label}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-slate-400">—</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.ateraCustomer ? `${row.onlineAgents}/${row.agents.length} online` : '—'}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums whitespace-nowrap">
                        <span
                          className={
                            row.highSeverityAlertsCount > 0
                              ? 'text-red-700 dark:text-red-400 font-semibold'
                              : 'text-slate-700 dark:text-slate-300'
                          }
                        >
                          {row.defenderAlertsCount}
                        </span>
                        <span className="text-slate-400"> / </span>
                        <span className="text-slate-700 dark:text-slate-300">
                          {row.rmmAlerts.length}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {row.ateraCustomer ? row.openTickets.length : '—'}
                      </td>
                      <td
                        className="py-2.5 px-5 text-right whitespace-nowrap"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex items-center gap-2">
                          {row.tenant && (
                            <button
                              type="button"
                              onClick={() => handleSyncOne(row.tenant!.id)}
                              disabled={syncingTenantId === row.tenant.id}
                              aria-label={`Sync ${row.displayName}`}
                              className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                            >
                              <RefreshCw
                                className={`w-3.5 h-3.5 ${
                                  syncingTenantId === row.tenant.id ? 'animate-spin' : ''
                                }`}
                              />
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => onInspectCustomer(row.key)}
                            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                          >
                            Inspect
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Customer Detail Drawer */}
      {inspectedRow && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => onInspectCustomer(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-2xl h-full bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 overflow-y-auto flex flex-col">
            <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 sticky top-0 bg-white dark:bg-slate-950 z-10">
              <div className="min-w-0">
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {inspectedRow.displayName}
                </h2>
                <div className="text-xs text-slate-500 dark:text-slate-400 font-mono truncate">
                  {inspectedRow.domain || 'No verified domain'} ·{' '}
                  {inspectedRow.tenant
                    ? `M365 Synced ${formatRelativeTime(inspectedRow.tenant.lastSyncAt)}`
                    : 'No M365 Tenant Linked'}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => onGenerateReport(inspectedRow.key)}
                  className="h-8 px-3 inline-flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors whitespace-nowrap"
                >
                  <FileText className="w-3.5 h-3.5" />
                  <span>Monthly Report</span>
                </button>
                <button
                  type="button"
                  onClick={() => onInspectCustomer(null)}
                  aria-label="Close customer details"
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>
            </div>

            <div className="p-6 space-y-6">
              {/* Mapping selector if tenant is present and Atera customers exist */}
              {inspectedRow.tenant && ateraCustomers.length > 0 && (
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-5 border-b border-slate-200 dark:border-slate-800">
                  <div>
                    <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Atera RMM Customer Association
                    </div>
                    <div className="text-xs text-slate-500 dark:text-slate-400">
                      Link this Microsoft 365 tenant to an Atera customer record
                    </div>
                  </div>
                  <select
                    aria-label="Select linked Atera customer"
                    value={inspectedRow.tenant.ateraCustomerId ?? ''}
                    onChange={(e) => {
                      const val = e.target.value ? Number(e.target.value) : null;
                      onMapTenant(inspectedRow.tenant!.id, val);
                    }}
                    className="h-9 px-3 text-xs bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                  >
                    <option value="">Unmapped</option>
                    {sortedAteraCustomers.map((c) => (
                      <option key={c.customerId} value={c.customerId}>
                        {c.customerName}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {/* Tenant Sync Diagnostics if error/partial */}
              {inspectedRow.tenant?.lastSyncError && (
                <div className="p-3.5 rounded-lg border border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300">
                  <span className="font-semibold">Sync Error: </span>
                  {inspectedRow.tenant.lastSyncError}
                </div>
              )}
              {inspectedRow.tenant && inspectedRow.tenant.permissionsNotes.length > 0 && (
                <div className="p-3.5 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/70 dark:bg-amber-950/30 text-xs text-amber-800 dark:text-amber-300 space-y-1">
                  <div className="font-semibold">Graph Permission Notes</div>
                  {inspectedRow.tenant.permissionsNotes.map((note, idx) => (
                    <div key={idx}>{note}</div>
                  ))}
                </div>
              )}

              {/* Microsoft Secure Score Breakdown */}
              {inspectedRow.tenant?.secureScore ? (
                <div className="space-y-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                      Microsoft Secure Score
                    </h3>
                    <div className="font-mono text-sm tabular-nums text-slate-900 dark:text-slate-100">
                      {inspectedRow.tenant.secureScore.currentScore} /{' '}
                      {inspectedRow.tenant.secureScore.maxScore} pts (
                      {inspectedRow.tenant.secureScore.percentage}%)
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                    <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <div className="text-slate-500 dark:text-slate-400">All Tenants Avg</div>
                      <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                        {inspectedRow.tenant.secureScore.allTenantsAverage != null
                          ? `${Math.round(inspectedRow.tenant.secureScore.allTenantsAverage * 10) / 10} pts`
                          : '—'}
                      </div>
                    </div>
                    <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <div className="text-slate-500 dark:text-slate-400">Similar Size Avg</div>
                      <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                        {inspectedRow.tenant.secureScore.similarSizeAverage != null
                          ? `${Math.round(inspectedRow.tenant.secureScore.similarSizeAverage * 10) / 10} pts`
                          : '—'}
                      </div>
                    </div>
                    <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <div className="text-slate-500 dark:text-slate-400">Licensed Users</div>
                      <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                        {inspectedRow.tenant.secureScore.licensedUserCount ?? '—'}
                      </div>
                    </div>
                    <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                      <div className="text-slate-500 dark:text-slate-400">Intune Devices</div>
                      <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                        {inspectedRow.tenant.managedDevices
                          ? `${inspectedRow.tenant.managedDevices.compliant}/${inspectedRow.tenant.managedDevices.total} compliant`
                          : '—'}
                      </div>
                    </div>
                  </div>

                  {inspectedRow.tenant.categoryBreakdown.length > 0 && (
                    <div className="space-y-2.5 pt-2">
                      {inspectedRow.tenant.categoryBreakdown.map((cat) => (
                        <div key={cat.category} className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-slate-700 dark:text-slate-300">
                              {cat.category}
                            </span>
                            <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                              {cat.currentScore} / {cat.maxScore} ({cat.percentage}%)
                            </span>
                          </div>
                          <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${getScoreLabel(cat.percentage).barClass}`}
                              style={{ width: `${Math.min(100, cat.percentage)}%` }}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="p-4 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg text-xs text-slate-500 dark:text-slate-400">
                  No Microsoft 365 Secure Score data available for this customer. Connect or map a tenant in Integrations & Setup.
                </div>
              )}

              {/* Top Improvement Controls for this customer */}
              {inspectedRow.tenant && inspectedRow.tenant.controls.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Top Improvement Actions
                  </h3>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inspectedRow.tenant.controls
                      .filter((c) => c.scoreGap > 0)
                      .slice(0, 6)
                      .map((ctrl) => (
                        <div key={ctrl.controlName} className="py-2.5 flex items-start justify-between gap-4">
                          <div className="min-w-0">
                            <div className="text-xs font-medium text-slate-900 dark:text-slate-100">
                              {ctrl.title}
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {ctrl.category} · Impact: {ctrl.userImpact} · Cost: {ctrl.implementationCost}
                            </div>
                          </div>
                          <div className="flex items-center gap-2 shrink-0">
                            <span className="font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">
                              +{ctrl.scoreGap}
                            </span>
                            {ctrl.actionUrl && (
                              <a
                                href={ctrl.actionUrl}
                                target="_blank"
                                rel="noreferrer"
                                aria-label={`Open ${ctrl.title} in Defender`}
                                className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400"
                              >
                                <ExternalLink className="w-3.5 h-3.5" />
                              </a>
                            )}
                          </div>
                        </div>
                      ))}
                  </div>
                </div>
              )}

              {/* Active Defender Alerts */}
              {inspectedRow.tenant && inspectedRow.tenant.defenderAlerts.length > 0 && (
                <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Microsoft Defender Alerts ({inspectedRow.tenant.defenderAlerts.length})
                  </h3>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inspectedRow.tenant.defenderAlerts.slice(0, 6).map((al) => {
                      const sev = getSeverityStyle(al.severity);
                      return (
                        <div key={al.id} className="py-2 flex items-center justify-between gap-3 text-xs">
                          <div className="min-w-0">
                            <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                              {al.title}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400">
                              {al.serviceSource} · {formatRelativeTime(al.createdDateTime)}
                            </div>
                          </div>
                          <span className={`shrink-0 ${sev.textClass}`}>{sev.label}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Atera RMM Agents */}
              {inspectedRow.ateraCustomer && (
                <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
                  <h3 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
                    Atera RMM Agents ({inspectedRow.onlineAgents}/{inspectedRow.agents.length} online)
                  </h3>
                  {inspectedRow.agents.length === 0 ? (
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      No RMM agents assigned to this customer in Atera.
                    </p>
                  ) : (
                    <div className="divide-y divide-slate-100 dark:divide-slate-800">
                      {inspectedRow.agents.slice(0, 10).map((agent) => (
                        <div
                          key={agent.agentId}
                          className="py-2 flex items-center justify-between gap-3 text-xs"
                        >
                          <div className="min-w-0">
                            <div className="font-mono font-medium text-slate-900 dark:text-slate-100 truncate">
                              {agent.machineName}
                            </div>
                            <div className="text-slate-500 dark:text-slate-400 truncate">
                              {agent.os} {agent.reportedIp ? `· ${agent.reportedIp}` : ''}
                            </div>
                          </div>
                          <span
                            className={`shrink-0 font-medium ${
                              agent.online
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-slate-500 dark:text-slate-400'
                            }`}
                          >
                            {agent.online ? 'Online' : 'Offline'}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
