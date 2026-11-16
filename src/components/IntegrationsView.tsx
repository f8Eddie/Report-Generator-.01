import { Check, Copy, ExternalLink, Eye, EyeOff, KeyRound, RefreshCw, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { DashboardPayload } from '../types';
import { formatRelativeTime } from '../utils/posture';

interface IntegrationsViewProps {
  data: DashboardPayload;
  onSyncAtera: () => Promise<void>;
  onSaveAteraToken: (token: string) => Promise<void>;
  onClearAteraToken: () => Promise<void>;
  onConnectMicrosoftOAuth: (flow: 'oauth' | 'adminconsent', tenantId?: string, ateraCustomerId?: number | null) => Promise<void>;
  onLinkMicrosoftAppOnly: (tenantId: string, ateraCustomerId: number | null) => Promise<void>;
  onSyncTenant: (tenantId: string) => Promise<void>;
  onMapTenant: (tenantId: string, ateraCustomerId: number | null) => Promise<void>;
  onDisconnectTenant: (tenantId: string) => Promise<void>;
}

export function IntegrationsView({
  data,
  onSyncAtera,
  onSaveAteraToken,
  onClearAteraToken,
  onConnectMicrosoftOAuth,
  onLinkMicrosoftAppOnly,
  onSyncTenant,
  onMapTenant,
  onDisconnectTenant,
}: IntegrationsViewProps) {
  const [ateraSyncing, setAteraSyncing] = useState(false);
  const [ateraMsg, setAteraMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [ateraTokenInput, setAteraTokenInput] = useState('');
  const [showTokenInput, setShowTokenInput] = useState(false);
  const [savingToken, setSavingToken] = useState(false);

  const [gdapTenantId, setGdapTenantId] = useState('');
  const [gdapCustomerId, setGdapCustomerId] = useState<string>('');
  const [linkingGdap, setLinkingGdap] = useState(false);
  const [msMsg, setMsMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  const [oauthCustomerId, setOauthCustomerId] = useState<string>('');
  const [copiedUri, setCopiedUri] = useState(false);
  const [busyTenantId, setBusyTenantId] = useState<string | null>(null);

  const sortedAteraCustomers = useMemo(
    () =>
      [...data.atera.customers].sort((a, b) =>
        a.customerName.localeCompare(b.customerName, undefined, { sensitivity: 'base' })
      ),
    [data.atera.customers]
  );

  const handleCopyUri = async () => {
    try {
      await navigator.clipboard.writeText(data.status.redirectUri);
      setCopiedUri(true);
      setTimeout(() => setCopiedUri(false), 2000);
    } catch {
      // Clipboard fallback not needed; URI is selectable text
    }
  };

  const handleAteraSyncClick = async () => {
    setAteraSyncing(true);
    setAteraMsg(null);
    try {
      await onSyncAtera();
      setAteraMsg({
        type: 'ok',
        text: 'Atera RMM customers, agents, alerts, and tickets synced.',
      });
    } catch (err) {
      setAteraMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to sync Atera RMM.',
      });
    } finally {
      setAteraSyncing(false);
    }
  };

  const handleSaveTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!ateraTokenInput.trim()) return;
    setSavingToken(true);
    setAteraMsg(null);
    try {
      await onSaveAteraToken(ateraTokenInput.trim());
      setAteraTokenInput('');
      setShowTokenInput(false);
      setAteraMsg({
        type: 'ok',
        text: 'Atera token updated on server and initial sync completed.',
      });
    } catch (err) {
      setAteraMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to validate Atera token.',
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleClearTokenOverride = async () => {
    setSavingToken(true);
    setAteraMsg(null);
    try {
      await onClearAteraToken();
      setAteraMsg({
        type: 'ok',
        text: 'Cleared manual token override; reverted to server environment secret.',
      });
    } catch (err) {
      setAteraMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to clear override.',
      });
    } finally {
      setSavingToken(false);
    }
  };

  const handleGdapSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!gdapTenantId.trim()) return;
    setLinkingGdap(true);
    setMsMsg(null);
    try {
      const custId = gdapCustomerId ? Number(gdapCustomerId) : null;
      await onLinkMicrosoftAppOnly(gdapTenantId.trim(), custId);
      setGdapTenantId('');
      setGdapCustomerId('');
      setMsMsg({
        type: 'ok',
        text: 'Verified tenant credentials and synced initial Defender Secure Score.',
      });
    } catch (err) {
      setMsMsg({
        type: 'err',
        text: err instanceof Error ? err.message : 'Failed to link tenant.',
      });
    } finally {
      setLinkingGdap(false);
    }
  };

  const handleSyncOne = async (id: string) => {
    setBusyTenantId(id);
    try {
      await onSyncTenant(id);
    } finally {
      setBusyTenantId(null);
    }
  };

  const handleDisconnect = async (id: string) => {
    setBusyTenantId(id);
    try {
      await onDisconnectTenant(id);
    } finally {
      setBusyTenantId(null);
    }
  };

  const tokenInfo = data.status.ateraTokenInfo;
  const formattedExp = tokenInfo?.expiresAt
    ? new Date(tokenInfo.expiresAt).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : null;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Atera RMM Connection */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Atera RMM API v3
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Server-side proxy to <span className="font-mono">app.atera.com/api/v3</span> (supports JWT Bearer &amp; X-API-KEY)
              </p>
            </div>
            <span
              className={`text-xs font-medium whitespace-nowrap ${
                tokenInfo?.isExpired
                  ? 'text-red-700 dark:text-red-400'
                  : data.status.ateraConfigured
                    ? 'text-emerald-700 dark:text-emerald-400'
                    : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {tokenInfo?.isExpired
                ? 'Token Expired'
                : data.status.ateraConfigured
                  ? 'Configured'
                  : 'Token Missing'}
            </span>
          </div>

          {/* Token Metadata Summary */}
          {data.status.ateraConfigured && (
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-1.5 text-xs">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-slate-700 dark:text-slate-300">
                  Active Token Source
                </span>
                <span className="font-mono text-slate-600 dark:text-slate-400">
                  {tokenInfo.source === 'override'
                    ? `Manual Override · updated ${formatRelativeTime(tokenInfo.updatedAt)}`
                    : 'Env Secret (ATERA_API_KEY)'}
                </span>
              </div>
              {tokenInfo.isJwt && (
                <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400 font-mono">
                  <span>
                    {[tokenInfo.accountId && `Account ${tokenInfo.accountId}`, tokenInfo.region, tokenInfo.environment]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                  {formattedExp && (
                    <span
                      className={
                        tokenInfo.isExpired
                          ? 'text-red-600 dark:text-red-400 font-semibold'
                          : 'text-slate-600 dark:text-slate-300'
                      }
                    >
                      {tokenInfo.isExpired ? `Expired ${formattedExp}` : `Expires ${formattedExp}`}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Manual Rotating Token Form */}
          <form onSubmit={handleSaveTokenSubmit} className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <label
                htmlFor="atera-token-input"
                className="text-xs font-medium text-slate-700 dark:text-slate-300 inline-flex items-center gap-1.5"
              >
                <KeyRound className="w-3.5 h-3.5 text-slate-400" />
                <span>Update Atera API / JWT Token</span>
              </label>
              {tokenInfo?.source === 'override' && (
                <button
                  type="button"
                  onClick={handleClearTokenOverride}
                  disabled={savingToken}
                  className="text-[11px] font-medium text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 underline"
                >
                  Revert to Env Secret
                </button>
              )}
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <input
                  id="atera-token-input"
                  type={showTokenInput ? 'text' : 'password'}
                  value={ateraTokenInput}
                  onChange={(e) => setAteraTokenInput(e.target.value)}
                  placeholder="Paste Atera JWT token (eyJ...) or API key"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-9 w-full pl-3 pr-9 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                />
                <button
                  type="button"
                  onClick={() => setShowTokenInput((v) => !v)}
                  aria-label={showTokenInput ? 'Hide token' : 'Show token'}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
                >
                  {showTokenInput ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                </button>
              </div>
              <button
                type="submit"
                disabled={!ateraTokenInput.trim() || savingToken}
                className="h-9 px-4 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {savingToken ? 'Validating...' : 'Save & Sync Token'}
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Stored strictly server-side for <span className="font-mono">/api/atera/*</span> proxy requests and never sent back to the browser.
            </p>
          </form>

          {data.status.ateraConfigured && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">Customers</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {data.atera.customers.length}
                </div>
              </div>
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">Agents</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {data.atera.agents.length}
                </div>
              </div>
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">RMM Alerts</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {data.atera.alerts.filter((a) => !a.archived).length}
                </div>
              </div>
              <div className="p-3 border border-slate-200 dark:border-slate-800 rounded-lg">
                <div className="text-slate-500 dark:text-slate-400">Tickets</div>
                <div className="font-mono text-base font-semibold tabular-nums text-slate-900 dark:text-slate-100 mt-1">
                  {data.atera.tickets.length}
                </div>
              </div>
            </div>
          )}

          {(ateraMsg || data.status.lastAteraError) && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                ateraMsg?.type === 'err' || (!ateraMsg && data.status.lastAteraError)
                  ? 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {ateraMsg?.text || data.status.lastAteraError}
            </div>
          )}

          <div className="flex items-center justify-between gap-4 pt-1">
            <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-slate-400">
              Last sync: {formatRelativeTime(data.status.lastAteraSync)}
            </span>
            <button
              type="button"
              onClick={handleAteraSyncClick}
              disabled={!data.status.ateraConfigured || ateraSyncing}
              className="h-9 px-4 inline-flex items-center gap-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${ateraSyncing ? 'animate-spin' : ''}`} />
              <span>{ateraSyncing ? 'Syncing Atera...' : 'Sync Atera RMM'}</span>
            </button>
          </div>
        </div>

        {/* Microsoft 365 Defender Multi-Tenant Setup */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Microsoft 365 Defender Multi-Tenant
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Connect customer Entra ID tenants via OAuth 2.0 or GDAP App-Only credentials
              </p>
            </div>
            <span
              className={`text-xs font-medium whitespace-nowrap ${
                data.status.microsoftConfigured
                  ? 'text-emerald-700 dark:text-emerald-400'
                  : 'text-amber-700 dark:text-amber-400'
              }`}
            >
              {data.status.microsoftConfigured ? 'App Configured' : 'Env Creds Missing'}
            </span>
          </div>

          <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60 space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium text-slate-700 dark:text-slate-300">
                Azure App Registration Callback URL
              </span>
              <button
                type="button"
                onClick={handleCopyUri}
                className="inline-flex items-center gap-1 text-blue-600 dark:text-blue-400 hover:underline font-medium"
              >
                {copiedUri ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                <span>{copiedUri ? 'Copied' : 'Copy URI'}</span>
              </button>
            </div>
            <div className="font-mono text-[11px] text-slate-600 dark:text-slate-400 break-all select-all">
              {data.status.redirectUri}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 pt-1">
              Required Graph permissions: <span className="font-mono">SecurityEvents.Read.All</span>,{' '}
              <span className="font-mono">Organization.Read.All</span>,{' '}
              <span className="font-mono">RoleManagement.Read.Directory</span> +{' '}
              <span className="font-mono">User.Read.All</span> (or{' '}
              <span className="font-mono">Directory.Read.All</span>), and{' '}
              <span className="font-mono">DeviceManagementManagedDevices.Read.All</span>. Set{' '}
              <span className="font-mono">MS_GRAPH_CLIENT_ID</span> and{' '}
              <span className="font-mono">MS_GRAPH_CLIENT_SECRET</span> in Secrets.
            </div>
          </div>

          {/* Interactive OAuth / Admin Consent */}
          <div className="space-y-3 pt-1">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Option 1: Connect Customer Tenant via Microsoft Sign-In / Admin Consent
            </div>
            <div className="flex flex-wrap items-center gap-2.5">
              {data.atera.customers.length > 0 && (
                <select
                  aria-label="Associate connected tenant with Atera customer"
                  value={oauthCustomerId}
                  onChange={(e) => setOauthCustomerId(e.target.value)}
                  className="h-9 px-3 text-xs bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="">Auto-match Atera customer</option>
                  {sortedAteraCustomers.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customerName}
                    </option>
                  ))}
                </select>
              )}

              <button
                type="button"
                disabled={!data.status.microsoftConfigured}
                onClick={() =>
                  onConnectMicrosoftOAuth(
                    'oauth',
                    'organizations',
                    oauthCustomerId ? Number(oauthCustomerId) : null
                  )
                }
                className="h-9 px-4 inline-flex items-center gap-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>Connect M365 Tenant (OAuth)</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </button>

              <button
                type="button"
                disabled={!data.status.microsoftConfigured}
                onClick={() =>
                  onConnectMicrosoftOAuth(
                    'adminconsent',
                    'organizations',
                    oauthCustomerId ? Number(oauthCustomerId) : null
                  )
                }
                className="h-9 px-3.5 inline-flex items-center gap-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <span>Admin Consent</span>
              </button>
            </div>
          </div>

          {/* App-Only / GDAP Tenant ID Link */}
          <form onSubmit={handleGdapSubmit} className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
            <div className="text-xs font-medium text-slate-700 dark:text-slate-300">
              Option 2: Link Pre-Consented Customer Tenant (GDAP / App-Only)
            </div>
            <div className="flex flex-col sm:flex-row gap-2.5">
              <input
                type="text"
                value={gdapTenantId}
                onChange={(e) => setGdapTenantId(e.target.value)}
                placeholder="Tenant ID (GUID) or contoso.onmicrosoft.com"
                aria-label="Microsoft 365 Tenant ID or domain"
                className="h-9 flex-1 px-3 text-xs font-mono bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              />
              {data.atera.customers.length > 0 && (
                <select
                  aria-label="Map to Atera customer"
                  value={gdapCustomerId}
                  onChange={(e) => setGdapCustomerId(e.target.value)}
                  className="h-9 px-3 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-900 dark:text-slate-100"
                >
                  <option value="">Map Atera Customer...</option>
                  {sortedAteraCustomers.map((c) => (
                    <option key={c.customerId} value={c.customerId}>
                      {c.customerName}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="submit"
                disabled={!data.status.microsoftConfigured || !gdapTenantId.trim() || linkingGdap}
                className="h-9 px-4 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {linkingGdap ? 'Verifying...' : 'Link Tenant'}
              </button>
            </div>
          </form>

          {msMsg && (
            <div
              className={`p-3 rounded-lg border text-xs ${
                msMsg.type === 'err'
                  ? 'border-red-200 dark:border-red-900/60 bg-red-50/70 dark:bg-red-950/30 text-red-700 dark:text-red-300'
                  : 'border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/70 dark:bg-emerald-950/30 text-emerald-700 dark:text-emerald-300'
              }`}
            >
              {msMsg.text}
            </div>
          )}
        </div>
      </div>

      {/* Connected Tenants & Customer Mapping Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Connected Microsoft 365 Tenants ({data.tenants.length})
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Bind each Entra ID tenant to its corresponding Atera RMM customer record
            </p>
          </div>
        </div>

        {data.tenants.length === 0 ? (
          <div className="p-10 text-center text-xs text-slate-500 dark:text-slate-400">
            No Microsoft 365 tenants connected yet. Use OAuth Sign-In or Link Tenant above once credentials are configured.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/50">
                  <th className="py-2.5 px-5">Organization / Domain</th>
                  <th className="py-2.5 px-4">Tenant ID</th>
                  <th className="py-2.5 px-4">Auth Mode</th>
                  <th className="py-2.5 px-4">Atera Customer Mapping</th>
                  <th className="py-2.5 px-4">Sync Status</th>
                  <th className="py-2.5 px-5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {data.tenants.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                    <td className="py-2.5 px-5">
                      <div className="font-medium text-slate-900 dark:text-slate-100">
                        {t.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400">
                        {t.primaryDomain || 'No default domain'}
                      </div>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-xs text-slate-600 dark:text-slate-400">
                      {t.tenantId}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-300 whitespace-nowrap">
                      {t.authMode === 'delegated' ? 'Delegated OAuth' : 'App-Only / GDAP'}
                    </td>
                    <td className="py-2.5 px-4">
                      <select
                        aria-label={`Map ${t.displayName} to Atera customer`}
                        value={t.ateraCustomerId ?? ''}
                        onChange={(e) =>
                          onMapTenant(t.id, e.target.value ? Number(e.target.value) : null)
                        }
                        className="h-8 px-2.5 text-xs bg-white dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-md text-slate-900 dark:text-slate-100"
                      >
                        <option value="">Unmapped</option>
                        {sortedAteraCustomers.map((c) => (
                          <option key={c.customerId} value={c.customerId}>
                            {c.customerName}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2.5 px-4 text-xs whitespace-nowrap">
                      <span
                        className={
                          t.lastSyncStatus === 'ok'
                            ? 'text-emerald-700 dark:text-emerald-400 font-medium'
                            : t.lastSyncStatus === 'partial'
                              ? 'text-amber-700 dark:text-amber-400 font-medium'
                              : t.lastSyncStatus === 'error'
                                ? 'text-red-700 dark:text-red-400 font-medium'
                                : 'text-slate-500'
                        }
                      >
                        {t.lastSyncStatus === 'ok'
                          ? 'Healthy'
                          : t.lastSyncStatus === 'partial'
                            ? 'Partial'
                            : t.lastSyncStatus === 'error'
                              ? 'Error'
                              : 'Pending'}
                      </span>
                      <span className="text-slate-400 font-mono">
                        {' '}
                        · {formatRelativeTime(t.lastSyncAt)}
                      </span>
                    </td>
                    <td className="py-2.5 px-5 text-right whitespace-nowrap">
                      <div className="inline-flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleSyncOne(t.id)}
                          disabled={busyTenantId === t.id}
                          aria-label={`Sync ${t.displayName}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-800 disabled:opacity-50"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${busyTenantId === t.id ? 'animate-spin' : ''}`}
                          />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleDisconnect(t.id)}
                          disabled={busyTenantId === t.id}
                          aria-label={`Disconnect ${t.displayName}`}
                          className="p-1.5 rounded-md text-slate-500 hover:text-red-600 hover:bg-red-50 dark:text-slate-400 dark:hover:text-red-400 dark:hover:bg-red-950/40 disabled:opacity-50"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
