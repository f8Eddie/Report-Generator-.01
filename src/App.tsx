import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertsView } from './components/AlertsView';
import { ControlsView } from './components/ControlsView';
import { CustomersView } from './components/CustomersView';
import { IntegrationsView } from './components/IntegrationsView';
import { OverviewView } from './components/OverviewView';
import { CustomerReportsWorkspace } from './components/ReportsView';
import { Sidebar, type NavTab } from './components/Sidebar';
import { TopBar } from './components/TopBar';
import type { DashboardPayload } from './types';
import { buildUnifiedCustomers } from './utils/posture';

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const rawText = await res.text();
  const trimmed = rawText.trimStart();

  if (trimmed.startsWith('<')) {
    throw new Error(
      `Server returned an HTML page (HTTP ${res.status}) instead of JSON for ${url}. Refresh the page if the server just restarted.`
    );
  }

  let parsed: Record<string, unknown> | null = null;
  try {
    parsed = rawText ? (JSON.parse(rawText) as Record<string, unknown>) : null;
  } catch {
    throw new Error(`Invalid JSON response (HTTP ${res.status}): ${rawText.slice(0, 120)}`);
  }

  if (!res.ok) {
    const msg = typeof parsed?.error === 'string' ? parsed.error : `Request failed (HTTP ${res.status})`;
    throw new Error(msg);
  }

  return parsed as T;
}

export default function App() {
  const [dashboard, setDashboard] = useState<DashboardPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<NavTab>('overview');
  const [selectedCustomerKey, setSelectedCustomerKey] = useState<string>('all');
  const [inspectedCustomerKey, setInspectedCustomerKey] = useState<string | null>(null);
  const [reportCustomerKey, setReportCustomerKey] = useState<string | null>(null);
  const [syncingAll, setSyncingAll] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [darkMode, setDarkMode] = useState<boolean>(() => {
    if (typeof window !== 'undefined') {
      return localStorage.getItem('aegismsp_theme') === 'dark';
    }
    return false;
  });

  useEffect(() => {
    const root = document.documentElement;
    if (darkMode) {
      root.classList.add('dark');
      localStorage.setItem('aegismsp_theme', 'dark');
    } else {
      root.classList.remove('dark');
      localStorage.setItem('aegismsp_theme', 'light');
    }
  }, [darkMode]);

  const fetchDashboard = useCallback(async () => {
    try {
      const payload = await fetchJson<DashboardPayload>('/api/dashboard');
      setDashboard(payload);
      setErrorBanner(null);
    } catch (err) {
      setErrorBanner(
        err instanceof Error ? err.message : 'Failed to load workspace dashboard.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchDashboard();
  }, [fetchDashboard]);

  // Listen for Microsoft OAuth / Admin Consent popup postMessage
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const origin = event.origin;
      if (
        !origin.endsWith('.run.app') &&
        !origin.includes('localhost') &&
        origin !== window.location.origin
      ) {
        return;
      }
      if (event.data?.type === 'MS_OAUTH_SUCCESS') {
        setErrorBanner(null);
        fetchDashboard();
      } else if (event.data?.type === 'MS_OAUTH_ERROR') {
        setErrorBanner(event.data.error || 'Microsoft 365 authentication failed.');
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [fetchDashboard]);

  const unifiedRows = useMemo(
    () => (dashboard ? buildUnifiedCustomers(dashboard) : []),
    [dashboard]
  );

  const scopedRows = useMemo(() => {
    if (selectedCustomerKey === 'all') return unifiedRows;
    return unifiedRows.filter((r) => r.key === selectedCustomerKey);
  }, [unifiedRows, selectedCustomerKey]);

  const handleSyncAll = async () => {
    setSyncingAll(true);
    setErrorBanner(null);
    try {
      const data = await fetchJson<{ dashboard?: DashboardPayload; errors?: string[] }>('/api/sync-all', {
        method: 'POST',
      });
      if (data.dashboard) setDashboard(data.dashboard);
      if (data.errors && data.errors.length > 0) {
        setErrorBanner(data.errors.join(' | '));
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Sync failed.');
    } finally {
      setSyncingAll(false);
    }
  };

  const handleSyncAtera = async () => {
    const data = await fetchJson<DashboardPayload>('/api/atera/sync', { method: 'POST' });
    setDashboard(data);
  };

  const handleSaveAteraToken = async (token: string) => {
    const data = await fetchJson<DashboardPayload>('/api/atera/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    setDashboard(data);
  };

  const handleClearAteraToken = async () => {
    const data = await fetchJson<DashboardPayload>('/api/atera/token', {
      method: 'DELETE',
    });
    setDashboard(data);
  };

  const handleConnectMicrosoftOAuth = async (
    flow: 'oauth' | 'adminconsent',
    tenantId = 'organizations',
    ateraCustomerId: number | null = null
  ) => {
    const params = new URLSearchParams({ flow, tenantId });
    if (ateraCustomerId != null) params.set('ateraCustomerId', String(ateraCustomerId));

    try {
      const data = await fetchJson<{ url?: string }>(`/api/microsoft/auth-url?${params.toString()}`);
      if (!data.url) {
        setErrorBanner('Failed to initiate Microsoft OAuth flow.');
        return;
      }

      const popup = window.open(data.url, 'ms_oauth_popup', 'width=620,height=720');
      if (!popup) {
        setErrorBanner('Popup blocked by browser. Please allow popups for this site to connect Microsoft 365.');
      }
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to initiate Microsoft OAuth flow.');
    }
  };

  const handleLinkMicrosoftAppOnly = async (
    tenantId: string,
    ateraCustomerId: number | null
  ) => {
    const data = await fetchJson<DashboardPayload>('/api/microsoft/tenants/link-app-only', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, ateraCustomerId }),
    });
    setDashboard(data);
  };

  const handleSyncTenant = async (id: string) => {
    try {
      const data = await fetchJson<DashboardPayload>(`/api/microsoft/tenants/${encodeURIComponent(id)}/sync`, {
        method: 'POST',
      });
      setDashboard(data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to sync tenant.');
    }
  };

  const handleMapTenant = async (id: string, ateraCustomerId: number | null) => {
    try {
      const data = await fetchJson<DashboardPayload>(`/api/tenants/${encodeURIComponent(id)}/mapping`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ateraCustomerId }),
      });
      setDashboard(data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to update customer mapping.');
    }
  };

  const handleDisconnectTenant = async (id: string) => {
    try {
      const data = await fetchJson<DashboardPayload>(`/api/tenants/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setDashboard(data);
    } catch (err) {
      setErrorBanner(err instanceof Error ? err.message : 'Failed to disconnect tenant.');
    }
  };

  const handleInspectCustomerFromOverview = (key: string) => {
    setInspectedCustomerKey(key);
    setActiveTab('customers');
  };

  const handleOpenCustomerReport = (key: string) => {
    setReportCustomerKey(key);
    setInspectedCustomerKey(null);
    setActiveTab('reports');
  };

  const handleFetchCustomerData = async (
    ateraCustomerId: number | null,
    tenantId: string | null,
    reportMonth?: string
  ): Promise<string[]> => {
    try {
      const res = await fetchJson<{ dashboard: DashboardPayload; warnings?: string[] }>(
        '/api/reports/customer/fetch',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ateraCustomerId, tenantId, reportMonth }),
        }
      );
      if (res.dashboard) setDashboard(res.dashboard);
      return res.warnings ?? [];
    } catch (err) {
      return [err instanceof Error ? err.message : 'Failed to fetch live customer data.'];
    }
  };

  return (
    <div className="min-h-screen flex bg-slate-50 dark:bg-slate-950 print:bg-white text-slate-900 dark:text-slate-100 print:text-slate-900">
      <Sidebar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        mobileOpen={mobileNavOpen}
        onCloseMobile={() => setMobileNavOpen(false)}
        ateraConfigured={dashboard?.status.ateraConfigured ?? false}
        microsoftConfigured={dashboard?.status.microsoftConfigured ?? false}
        tenantsCount={dashboard?.tenants.length ?? 0}
        ateraCustomersCount={dashboard?.atera.customers.length ?? 0}
      />

      <div className="flex-1 flex flex-col min-w-0">
        <TopBar
          activeTab={activeTab}
          selectedCustomerKey={selectedCustomerKey}
          onSelectCustomerKey={setSelectedCustomerKey}
          customerOptions={[...unifiedRows]
            .sort((a, b) => a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base' }))
            .map((r) => ({ key: r.key, label: r.displayName }))}
          onSyncAll={handleSyncAll}
          syncing={syncingAll}
          darkMode={darkMode}
          onToggleDarkMode={() => setDarkMode((d) => !d)}
          onOpenMobileNav={() => setMobileNavOpen(true)}
        />

        <main className="flex-1 p-4 sm:p-6 print:p-0 max-w-[1440px] w-full mx-auto space-y-5">
          {errorBanner && (
            <div className="print:hidden p-3.5 rounded-xl border border-red-200 dark:border-red-900/60 bg-red-50 dark:bg-red-950/30 text-xs text-red-700 dark:text-red-300 flex items-center justify-between gap-4">
              <span>{errorBanner}</span>
              <button
                type="button"
                onClick={() => setErrorBanner(null)}
                className="font-medium underline shrink-0"
              >
                Dismiss
              </button>
            </div>
          )}

          {loading || !dashboard ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
              {[0, 1, 2, 3].map((i) => (
                <div
                  key={i}
                  className="h-28 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl animate-pulse"
                />
              ))}
            </div>
          ) : (
            <>
              {activeTab === 'overview' && (
                <OverviewView
                  data={dashboard}
                  rows={scopedRows}
                  onNavigate={setActiveTab}
                  onInspectCustomer={handleInspectCustomerFromOverview}
                />
              )}

              {activeTab === 'customers' && (
                <CustomersView
                  rows={scopedRows}
                  ateraCustomers={dashboard.atera.customers}
                  inspectedCustomerKey={inspectedCustomerKey}
                  onInspectCustomer={setInspectedCustomerKey}
                  onSyncTenant={handleSyncTenant}
                  onMapTenant={handleMapTenant}
                  onNavigate={setActiveTab}
                  onGenerateReport={handleOpenCustomerReport}
                />
              )}

              {activeTab === 'reports' && (
                <CustomerReportsWorkspace
                  rows={unifiedRows}
                  allTickets={dashboard.atera.tickets}
                  initialCustomerKey={reportCustomerKey}
                  onFetchCustomerData={handleFetchCustomerData}
                />
              )}

              {activeTab === 'controls' && <ControlsView rows={scopedRows} />}

              {activeTab === 'alerts' && <AlertsView rows={scopedRows} />}

              {activeTab === 'integrations' && (
                <IntegrationsView
                  data={dashboard}
                  onSyncAtera={handleSyncAtera}
                  onSaveAteraToken={handleSaveAteraToken}
                  onClearAteraToken={handleClearAteraToken}
                  onConnectMicrosoftOAuth={handleConnectMicrosoftOAuth}
                  onLinkMicrosoftAppOnly={handleLinkMicrosoftAppOnly}
                  onSyncTenant={handleSyncTenant}
                  onMapTenant={handleMapTenant}
                  onDisconnectTenant={handleDisconnectTenant}
                />
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
