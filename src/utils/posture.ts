import type {
  AteraAgent,
  AteraAlert,
  AteraCustomer,
  AteraTicket,
  DashboardPayload,
  TenantConnectionSummary,
} from '../types';

export interface UnifiedCustomerRow {
  key: string;
  displayName: string;
  domain: string | null;
  ateraCustomer: AteraCustomer | null;
  tenant: TenantConnectionSummary | null;
  agents: AteraAgent[];
  onlineAgents: number;
  rmmAlerts: AteraAlert[];
  openTickets: AteraTicket[];
  defenderAlertsCount: number;
  highSeverityAlertsCount: number;
}

export function buildUnifiedCustomers(data: DashboardPayload): UnifiedCustomerRow[] {
  const rows: UnifiedCustomerRow[] = [];
  const usedTenantIds = new Set<string>();

  for (const customer of data.atera.customers) {
    const linkedTenant =
      data.tenants.find((t) => t.ateraCustomerId === customer.customerId) ?? null;
    if (linkedTenant) {
      usedTenantIds.add(linkedTenant.id);
    }

    const agents = data.atera.agents.filter((a) => a.customerId === customer.customerId);
    const rmmAlerts = data.atera.alerts.filter(
      (al) => al.customerId === customer.customerId && !al.archived
    );
    const openTickets = data.atera.tickets.filter(
      (t) =>
        t.customerId === customer.customerId &&
        !['closed', 'resolved'].includes(t.status.toLowerCase())
    );
    const defenderAlerts = linkedTenant?.defenderAlerts ?? [];
    const highDefender = defenderAlerts.filter((a) =>
      ['high', 'critical'].includes(a.severity.toLowerCase())
    ).length;
    const highRmm = rmmAlerts.filter((a) =>
      ['critical'].includes(a.severity.toLowerCase())
    ).length;

    rows.push({
      key: `atera-${customer.customerId}`,
      displayName: customer.customerName,
      domain: linkedTenant?.primaryDomain || customer.domain || null,
      ateraCustomer: customer,
      tenant: linkedTenant,
      agents,
      onlineAgents: agents.filter((a) => a.online).length,
      rmmAlerts,
      openTickets,
      defenderAlertsCount: defenderAlerts.length,
      highSeverityAlertsCount: highDefender + highRmm,
    });
  }

  for (const tenant of data.tenants) {
    if (usedTenantIds.has(tenant.id)) continue;
    const highDefender = tenant.defenderAlerts.filter((a) =>
      ['high', 'critical'].includes(a.severity.toLowerCase())
    ).length;

    rows.push({
      key: `tenant-${tenant.id}`,
      displayName: tenant.displayName,
      domain: tenant.primaryDomain,
      ateraCustomer: null,
      tenant,
      agents: [],
      onlineAgents: 0,
      rmmAlerts: [],
      openTickets: [],
      defenderAlertsCount: tenant.defenderAlerts.length,
      highSeverityAlertsCount: highDefender,
    });
  }

  return rows.sort((a, b) => {
    const scoreA = a.tenant?.secureScore?.percentage ?? -1;
    const scoreB = b.tenant?.secureScore?.percentage ?? -1;
    if (scoreA !== scoreB) return scoreB - scoreA;
    return a.displayName.localeCompare(b.displayName);
  });
}

export function formatRelativeTime(iso: string | null | undefined): string {
  if (!iso) return 'Never';
  const ts = Date.parse(iso);
  if (Number.isNaN(ts)) return iso;
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  return `${Math.floor(diffSec / 86400)}d ago`;
}

export function formatShortDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function getScoreLabel(pct: number): {
  label: string;
  textClass: string;
  barClass: string;
} {
  if (pct >= 70) {
    return {
      label: 'Strong',
      textClass: 'text-emerald-700 dark:text-emerald-400',
      barClass: 'bg-emerald-600 dark:bg-emerald-500',
    };
  }
  if (pct >= 45) {
    return {
      label: 'Moderate',
      textClass: 'text-amber-700 dark:text-amber-400',
      barClass: 'bg-amber-600 dark:bg-amber-500',
    };
  }
  return {
    label: 'At Risk',
    textClass: 'text-red-700 dark:text-red-400',
    barClass: 'bg-red-600 dark:bg-red-500',
  };
}

export function getSeverityStyle(severity: string): {
  label: string;
  textClass: string;
} {
  const s = severity.toLowerCase();
  if (s === 'high' || s === 'critical') {
    return {
      label: s === 'critical' ? 'Critical' : 'High',
      textClass: 'text-red-700 dark:text-red-400 font-medium',
    };
  }
  if (s === 'medium' || s === 'warning') {
    return {
      label: s === 'warning' ? 'Warning' : 'Medium',
      textClass: 'text-amber-700 dark:text-amber-400 font-medium',
    };
  }
  return {
    label: s === 'low' ? 'Low' : 'Info',
    textClass: 'text-slate-600 dark:text-slate-400',
  };
}

export function exportPostureCsv(rows: UnifiedCustomerRow[]) {
  const headers = [
    'Customer Name',
    'Primary Domain',
    'Atera Customer ID',
    'M365 Tenant ID',
    'Secure Score (%)',
    'Current Score',
    'Max Score',
    'RMM Agents Online',
    'RMM Agents Total',
    'Defender Alerts',
    'RMM Alerts',
    'Open Tickets',
    'Last M365 Sync',
  ];

  const escapeCsv = (val: string | number | null | undefined) => {
    const str = val == null ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.displayName,
        r.domain ?? '',
        r.ateraCustomer?.customerId ?? '',
        r.tenant?.tenantId ?? '',
        r.tenant?.secureScore?.percentage ?? '',
        r.tenant?.secureScore?.currentScore ?? '',
        r.tenant?.secureScore?.maxScore ?? '',
        r.onlineAgents,
        r.agents.length,
        r.defenderAlertsCount,
        r.rmmAlerts.length,
        r.openTickets.length,
        r.tenant?.lastSyncAt ?? '',
      ]
        .map(escapeCsv)
        .join(',')
    ),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `aegismsp-posture-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
