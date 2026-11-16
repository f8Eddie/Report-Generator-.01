import { Menu, Moon, RefreshCw, Sun } from 'lucide-react';
import type { NavTab } from './Sidebar';

interface TopBarProps {
  activeTab: NavTab;
  selectedCustomerKey: string;
  onSelectCustomerKey: (key: string) => void;
  customerOptions: Array<{ key: string; label: string }>;
  onSyncAll: () => void;
  syncing: boolean;
  darkMode: boolean;
  onToggleDarkMode: () => void;
  onOpenMobileNav: () => void;
}

const TAB_TITLES: Record<NavTab, string> = {
  overview: 'Overview',
  customers: 'Customers & Tenants',
  reports: 'Monthly Reports',
  controls: 'Secure Score Controls',
  alerts: 'Defender & RMM Alerts',
  integrations: 'Integrations & Setup',
};

export function TopBar({
  activeTab,
  selectedCustomerKey,
  onSelectCustomerKey,
  customerOptions,
  onSyncAll,
  syncing,
  darkMode,
  onToggleDarkMode,
  onOpenMobileNav,
}: TopBarProps) {
  return (
    <header className="print:hidden h-16 px-4 sm:px-6 bg-white dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4 sm:gap-8 shrink-0">
      <div className="flex items-center gap-3 min-w-0">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="lg:hidden p-2 -ml-2 rounded-lg text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900"
        >
          <Menu className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-sm min-w-0">
          <span className="text-slate-500 dark:text-slate-400 hidden sm:inline whitespace-nowrap">
            Workspace
          </span>
          <span className="text-slate-300 dark:text-slate-700 hidden sm:inline" aria-hidden="true">
            /
          </span>
          <h1 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
            {TAB_TITLES[activeTab]}
          </h1>
        </div>
      </div>

      <div className="flex items-center gap-3 min-w-0">
        {activeTab !== 'integrations' && activeTab !== 'reports' && (
          <select
            aria-label="Filter by customer"
            value={selectedCustomerKey}
            onChange={(e) => onSelectCustomerKey(e.target.value)}
            className="h-9 max-w-[220px] px-3 text-xs font-medium bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg text-slate-700 dark:text-slate-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <option value="all">All Customers ({customerOptions.length})</option>
            {customerOptions.map((opt) => (
              <option key={opt.key} value={opt.key}>
                {opt.label}
              </option>
            ))}
          </select>
        )}

        <button
          type="button"
          onClick={onToggleDarkMode}
          aria-label={darkMode ? 'Switch to light theme' : 'Switch to dark theme'}
          className="h-9 w-9 flex items-center justify-center rounded-lg border border-slate-200 dark:border-slate-800 text-slate-600 hover:text-slate-900 hover:bg-slate-50 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900 transition-colors shrink-0"
        >
          {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
        </button>

        <button
          type="button"
          onClick={onSyncAll}
          disabled={syncing}
          className="h-9 px-4 inline-flex items-center gap-2 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-950"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} />
          <span>{syncing ? 'Syncing...' : 'Sync All'}</span>
        </button>
      </div>
    </header>
  );
}
