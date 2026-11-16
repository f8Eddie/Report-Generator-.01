import { ExternalLink, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import {
  formatRelativeTime,
  getSeverityStyle,
  type UnifiedCustomerRow,
} from '../utils/posture';

interface AlertsViewProps {
  rows: UnifiedCustomerRow[];
}

type SourceFilter = 'all' | 'defender' | 'atera_alert' | 'atera_ticket';
type SeverityFilter = 'all' | 'high' | 'medium' | 'low';

interface UnifiedEvent {
  id: string;
  source: 'Microsoft Defender' | 'Atera RMM' | 'Atera Ticket';
  sourceType: 'defender' | 'atera_alert' | 'atera_ticket';
  customerName: string;
  title: string;
  subtitle: string;
  severity: string;
  status: string;
  timestamp: string;
  externalUrl: string | null;
}

export function AlertsView({ rows }: AlertsViewProps) {
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');
  const [search, setSearch] = useState('');

  const events = useMemo<UnifiedEvent[]>(() => {
    const list: UnifiedEvent[] = [];

    for (const row of rows) {
      for (const d of row.tenant?.defenderAlerts ?? []) {
        list.push({
          id: `def-${row.key}-${d.id}`,
          source: 'Microsoft Defender',
          sourceType: 'defender',
          customerName: row.displayName,
          title: d.title,
          subtitle: `${d.serviceSource} · ${d.category}`,
          severity: d.severity,
          status: d.status,
          timestamp: d.createdDateTime,
          externalUrl: d.incidentWebUrl,
        });
      }

      for (const al of row.rmmAlerts) {
        list.push({
          id: `rmm-${al.alertId}`,
          source: 'Atera RMM',
          sourceType: 'atera_alert',
          customerName: row.displayName,
          title: al.title,
          subtitle: al.machineName ? `${al.machineName} · ${al.category}` : al.category,
          severity: al.severity,
          status: al.archived ? 'Archived' : 'Active',
          timestamp: al.created,
          externalUrl: null,
        });
      }

      for (const tk of row.openTickets) {
        list.push({
          id: `tkt-${tk.ticketId}`,
          source: 'Atera Ticket',
          sourceType: 'atera_ticket',
          customerName: row.displayName,
          title: tk.title,
          subtitle: `Ticket #${tk.ticketId}`,
          severity: tk.priority,
          status: tk.status,
          timestamp: tk.createdDate,
          externalUrl: null,
        });
      }
    }

    return list.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  }, [rows]);

  const filtered = useMemo(() => {
    return events.filter((ev) => {
      if (sourceFilter !== 'all' && ev.sourceType !== sourceFilter) return false;
      const sev = ev.severity.toLowerCase();
      if (severityFilter === 'high' && !['high', 'critical', 'urgent'].includes(sev)) {
        return false;
      }
      if (severityFilter === 'medium' && !['medium', 'warning', 'normal'].includes(sev)) {
        return false;
      }
      if (severityFilter === 'low' && !['low', 'informational', 'information', 'unknown'].includes(sev)) {
        return false;
      }
      if (search.trim()) {
        const q = search.toLowerCase();
        if (
          !ev.title.toLowerCase().includes(q) &&
          !ev.customerName.toLowerCase().includes(q) &&
          !ev.subtitle.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [events, sourceFilter, severityFilter, search]);

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
              placeholder="Search alerts, hosts, customers..."
              aria-label="Search alerts, hosts, or customers"
              className="h-9 pl-8 pr-3 w-64 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            />
          </div>

          <div className="flex items-center gap-1 p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg">
            {(
              [
                ['all', 'All Sources'],
                ['defender', 'Defender'],
                ['atera_alert', 'Atera Alerts'],
                ['atera_ticket', 'RMM Tickets'],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setSourceFilter(id)}
                className={`px-3 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  sourceFilter === id
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <select
            aria-label="Filter by severity"
            value={severityFilter}
            onChange={(e) => setSeverityFilter(e.target.value as SeverityFilter)}
            className="h-9 px-3 text-xs bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200"
          >
            <option value="all">All Severities</option>
            <option value="high">High / Critical</option>
            <option value="medium">Medium / Warning</option>
            <option value="low">Low / Info</option>
          </select>
        </div>

        <div className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
          {filtered.length} events
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-12 text-center text-xs text-slate-500 dark:text-slate-400">
            No active Defender alerts, Atera RMM alerts, or open tickets match the current filter.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/50">
                  <th className="py-2.5 px-5">Event / Alert</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Source</th>
                  <th className="py-2.5 px-4">Severity</th>
                  <th className="py-2.5 px-4">Status</th>
                  <th className="py-2.5 px-5 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {filtered.map((ev) => {
                  const sev = getSeverityStyle(ev.severity);
                  return (
                    <tr
                      key={ev.id}
                      className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
                    >
                      <td className="py-2.5 px-5 max-w-md">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900 dark:text-slate-100 truncate">
                            {ev.title}
                          </span>
                          {ev.externalUrl && (
                            <a
                              href={ev.externalUrl}
                              target="_blank"
                              rel="noreferrer"
                              aria-label="Open incident in Defender"
                              className="text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 shrink-0"
                            >
                              <ExternalLink className="w-3.5 h-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400 truncate">
                          {ev.subtitle}
                        </div>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-700 dark:text-slate-300 whitespace-nowrap">
                        {ev.customerName}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                        {ev.source}
                      </td>
                      <td className={`py-2.5 px-4 text-xs whitespace-nowrap ${sev.textClass}`}>
                        {sev.label}
                      </td>
                      <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap capitalize">
                        {ev.status}
                      </td>
                      <td className="py-2.5 px-5 text-right font-mono text-xs tabular-nums text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {formatRelativeTime(ev.timestamp)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
