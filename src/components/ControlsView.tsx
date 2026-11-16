import { ExternalLink, Search, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { SecureScoreControlItem } from '../types';
import type { UnifiedCustomerRow } from '../utils/posture';

interface ControlsViewProps {
  rows: UnifiedCustomerRow[];
}

interface TenantControlEntry extends SecureScoreControlItem {
  tenantName: string;
  tenantId: string;
}

export function ControlsView({ rows }: ControlsViewProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('All');
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | 'completed'>('open');
  const [selectedControl, setSelectedControl] = useState<TenantControlEntry | null>(null);

  const allEntries = useMemo<TenantControlEntry[]>(() => {
    return rows.flatMap((r) =>
      (r.tenant?.controls ?? []).map((c) => ({
        ...c,
        tenantName: r.displayName,
        tenantId: r.tenant!.tenantId,
      }))
    );
  }, [rows]);

  const categories = useMemo(() => {
    const set = new Set<string>(['All']);
    for (const item of allEntries) {
      if (item.category) set.add(item.category);
    }
    return Array.from(set);
  }, [allEntries]);

  const filtered = useMemo(() => {
    return allEntries
      .filter((item) => {
        if (statusFilter === 'open' && item.scoreGap <= 0) return false;
        if (statusFilter === 'completed' && item.scoreGap > 0) return false;
        if (categoryFilter !== 'All' && item.category !== categoryFilter) return false;
        if (search.trim()) {
          const q = search.toLowerCase();
          if (
            !item.title.toLowerCase().includes(q) &&
            !item.tenantName.toLowerCase().includes(q) &&
            !item.controlName.toLowerCase().includes(q)
          ) {
            return false;
          }
        }
        return true;
      })
      .sort((a, b) => b.scoreGap - a.scoreGap || a.rank - b.rank);
  }, [allEntries, statusFilter, categoryFilter, search]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search controls or customers..."
              aria-label="Search controls or customers"
              className="h-9 pl-8 pr-3 w-64 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
            {(
              [
                ['open', 'Open Gaps'],
                ['completed', 'Implemented'],
                ['all', 'All Controls'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setStatusFilter(id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  statusFilter === id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by security category"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="h-9 px-3 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
          >
            {categories.map((cat) => (
              <option key={cat} value={cat}>
                {cat === 'All' ? 'All Categories' : cat}
              </option>
            ))}
          </select>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
          Showing {filtered.length} controls
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
            No Secure Score controls match the current filter. Connect and sync a Microsoft 365 tenant to inspect control profiles.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/50">
                  <th className="py-2.5 px-5">Control Title</th>
                  <th className="py-2.5 px-4">Customer Tenant</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">Cost / Impact</th>
                  <th className="py-2.5 px-4 text-right">Score</th>
                  <th className="py-2.5 px-5 text-right">Potential Gain</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.map((item) => (
                  <tr
                    key={`${item.tenantId}-${item.controlName}`}
                    onClick={() => setSelectedControl(item)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-5 max-w-md">
                      <div className="font-medium text-slate-900 dark:text-slate-100 truncate">
                        {item.title}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                        {item.implementationStatus}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {item.tenantName}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {item.category}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {item.implementationCost} · {item.userImpact}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono text-xs tabular-nums text-slate-700 dark:text-slate-300 whitespace-nowrap">
                      {item.currentScore} / {item.maxScore}
                    </td>
                    <td className="py-2.5 px-5 text-right font-mono text-xs font-semibold tabular-nums whitespace-nowrap">
                      {item.scoreGap > 0 ? (
                        <span className="text-emerald-700 dark:text-emerald-400">
                          +{item.scoreGap} pts
                        </span>
                      ) : (
                        <span className="text-slate-400">Complete</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {selectedControl && (
        <div className="fixed inset-0 z-50 flex justify-end">
          <div
            className="fixed inset-0 bg-slate-950/40"
            onClick={() => setSelectedControl(null)}
            aria-hidden="true"
          />
          <div className="relative z-10 w-full max-w-lg h-full bg-white dark:bg-slate-950 border-l border-slate-200 dark:border-slate-800 overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedControl.tenantName} · {selectedControl.category}
                </div>
                <h2 className="font-display text-lg font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {selectedControl.title}
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setSelectedControl(null)}
                aria-label="Close control details"
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="grid grid-cols-3 gap-3 text-xs">
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">Score</div>
                <div className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {selectedControl.currentScore} / {selectedControl.maxScore}
                </div>
              </div>
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">User Impact</div>
                <div className="font-medium text-slate-900 dark:text-slate-100 mt-1">
                  {selectedControl.userImpact}
                </div>
              </div>
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">Impl. Cost</div>
                <div className="font-medium text-slate-900 dark:text-slate-100 mt-1">
                  {selectedControl.implementationCost}
                </div>
              </div>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Implementation Status
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {selectedControl.implementationStatus}
              </p>
            </div>

            <div className="space-y-1.5">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Remediation Guidance
              </h3>
              <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
                {selectedControl.remediation}
              </p>
            </div>

            {selectedControl.threats.length > 0 && (
              <div className="space-y-1.5">
                <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Mitigated Threats
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-400">
                  {selectedControl.threats.join(' · ')}
                </p>
              </div>
            )}

            {selectedControl.actionUrl && (
              <a
                href={selectedControl.actionUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                <span>Open in Microsoft Defender Portal</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
