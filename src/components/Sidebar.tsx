import {
  Activity,
  AlertTriangle,
  Building2,
  FileText,
  Link2,
  ShieldCheck,
  SlidersHorizontal,
  X,
} from 'lucide-react';

export type NavTab = 'overview' | 'customers' | 'reports' | 'controls' | 'alerts' | 'integrations';

interface SidebarProps {
  activeTab: NavTab;
  onSelectTab: (tab: NavTab) => void;
  mobileOpen: boolean;
  onCloseMobile: () => void;
  ateraConfigured: boolean;
  microsoftConfigured: boolean;
  tenantsCount: number;
  ateraCustomersCount: number;
}

const NAV_ITEMS: Array<{ id: NavTab; label: string; icon: typeof Activity }> = [
  { id: 'overview', label: 'Overview', icon: Activity },
  { id: 'customers', label: 'Customers & Tenants', icon: Building2 },
  { id: 'reports', label: 'Monthly Reports', icon: FileText },
  { id: 'controls', label: 'Secure Score Controls', icon: SlidersHorizontal },
  { id: 'alerts', label: 'Defender & RMM Alerts', icon: AlertTriangle },
  { id: 'integrations', label: 'Integrations & Setup', icon: Link2 },
];

export function Sidebar({
  activeTab,
  onSelectTab,
  mobileOpen,
  onCloseMobile,
  ateraConfigured,
  microsoftConfigured,
  tenantsCount,
  ateraCustomersCount,
}: SidebarProps) {
  const navContent = (
    <div className="flex h-full flex-col justify-between bg-white dark:bg-slate-950 border-r border-slate-200 dark:border-slate-800 w-64">
      <div>
        <div className="flex items-center justify-between px-5 h-16 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => {
              onSelectTab('overview');
              onCloseMobile();
            }}
            className="flex items-center gap-2.5 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
          >
            <ShieldCheck className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0" />
            <span className="font-display text-base font-bold tracking-tight text-slate-900 dark:text-slate-100">
              AegisMSP
            </span>
          </button>
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="lg:hidden p-1.5 rounded-md text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <nav className="p-3 space-y-1" aria-label="Primary">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  onSelectTab(item.id);
                  onCloseMobile();
                }}
                className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-100 dark:hover:bg-slate-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </div>

      <div className="p-4 border-t border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
          <span>Atera RMM</span>
          <span
            className={`font-mono tabular-nums ${
              ateraConfigured
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {ateraConfigured ? `${ateraCustomersCount} customers` : 'Key missing'}
          </span>
        </div>
        <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
          <span>M365 Defender</span>
          <span
            className={`font-mono tabular-nums ${
              microsoftConfigured
                ? 'text-emerald-700 dark:text-emerald-400'
                : 'text-amber-700 dark:text-amber-400'
            }`}
          >
            {microsoftConfigured ? `${tenantsCount} tenants` : 'App missing'}
          </span>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden lg:block shrink-0 print:hidden">{navContent}</aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex print:hidden">
          <div
            className="fixed inset-0 bg-slate-950/50"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <div className="relative z-10 h-full">{navContent}</div>
        </div>
      )}
    </>
  );
}
