import { ArrowRight, Download } from 'lucide-react';
import type { DashboardPayload } from '../types';
import {
  exportPostureCsv,
  formatRelativeTime,
  getScoreLabel,
  type UnifiedCustomerRow,
} from '../utils/posture';
import type { NavTab } from './Sidebar';

interface OverviewViewProps {
  data: DashboardPayload;
  rows: UnifiedCustomerRow[];
  onNavigate: (tab: NavTab) => void;
  onInspectCustomer: (key: string) => void;
}

export function OverviewView({
  data,
  rows,
  onNavigate,
  onInspectCustomer,
}: OverviewViewProps) {
  const scoredTenants = rows.filter((r) => r.tenant?.secureScore != null);
  const avgSecureScore =
    scoredTenants.length > 0
      ? Math.round(
          (scoredTenants.reduce(
            (sum, r) => sum + (r.tenant?.secureScore?.percentage ?? 0),
            0
          ) /
            scoredTenants.length) *
            10
        ) / 10
      : null;

  const totalAgents = rows.reduce((sum, r) => sum + r.agents.length, 0);
  const onlineAgents = rows.reduce((sum, r) => sum + r.onlineAgents, 0);
  const totalDefenderAlerts = rows.reduce((sum, r) => sum + r.defenderAlertsCount, 0);
  const totalRmmAlerts = rows.reduce((sum, r) => sum + r.rmmAlerts.length, 0);
  const highAlerts = rows.reduce((sum, r) => sum + r.highSeverityAlertsCount, 0);

  // Top remediation opportunities across filtered rows
  const allControls = rows.flatMap((r) =>
    (r.tenant?.controls ?? [])
      .filter((c) => c.scoreGap > 0)
      .map((c) => ({
        ...c,
        tenantName: r.displayName,
        customerKey: r.key,
      }))
  );
  allControls.sort((a, b) => b.scoreGap - a.scoreGap || a.rank - b.rank);
  const topControls = allControls.slice(0, 6);
  const totalPotentialPoints =
    Math.round(allControls.reduce((sum, c) => sum + c.scoreGap, 0) * 10) / 10;

  // Build 30-day average Secure Score trend across scored tenants
  const dateMap = new Map<string, { sumPct: number; count: number }>();
  for (const row of scoredTenants) {
    for (const pt of row.tenant?.scoreHistory ?? []) {
      const existing = dateMap.get(pt.date) || { sumPct: 0, count: 0 };
      existing.sumPct += pt.percentage;
      existing.count += 1;
      dateMap.set(pt.date, existing);
    }
  }
  const trendPoints = Array.from(dateMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .slice(-30)
    .map(([date, val]) => ({
      date,
      avgPct: Math.round((val.sumPct / val.count) * 10) / 10,
    }));

  // Aggregate Category Breakdown across filtered tenants
  const categoryMap = new Map<string, { current: number; max: number }>();
  for (const row of scoredTenants) {
    for (const cat of row.tenant?.categoryBreakdown ?? []) {
      const acc = categoryMap.get(cat.category) || { current: 0, max: 0 };
      acc.current += cat.currentScore;
      acc.max += cat.maxScore;
      categoryMap.set(cat.category, acc);
    }
  }
  const categorySummary = Array.from(categoryMap.entries())
    .map(([category, vals]) => ({
      category,
      current: Math.round(vals.current * 10) / 10,
      max: Math.round(vals.max * 10) / 10,
      pct: vals.max > 0 ? Math.round((vals.current / vals.max) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.max - a.max);

  const needsSetup = !data.status.ateraConfigured || !data.status.microsoftConfigured;

  return (
    <div className="space-y-6">
      {needsSetup && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="space-y-1">
            <h2 className="font-display text-sm font-semibold text-slate-900 dark:text-slate-100">
              Complete platform integration setup
            </h2>
            <p className="text-xs text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
              {!data.status.ateraConfigured && !data.status.microsoftConfigured
                ? 'Configure ATERA_API_KEY and Microsoft Entra multi-tenant credentials (MS_GRAPH_CLIENT_ID, MS_GRAPH_CLIENT_SECRET) in server environment secrets to begin syncing live customer telemetry.'
                : !data.status.ateraConfigured
                  ? 'Set ATERA_API_KEY in server environment secrets to pull customers, RMM agents, alerts, and tickets.'
                  : 'Set MS_GRAPH_CLIENT_ID and MS_GRAPH_CLIENT_SECRET in server environment secrets to connect customer Microsoft 365 Defender tenants.'}
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('integrations')}
            className="inline-flex items-center gap-2 px-4 py-2 text-xs font-medium text-white bg-slate-900 hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-slate-200 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <span>Open Setup Guide</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* 4-Column KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Average Secure Score
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {avgSecureScore != null ? `${avgSecureScore}%` : '—'}
            </span>
            {avgSecureScore != null && (
              <span className={`text-xs font-medium ${getScoreLabel(avgSecureScore).textClass}`}>
                {getScoreLabel(avgSecureScore).label}
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {scoredTenants.length} of {rows.length} customers scored
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            RMM Managed Endpoints
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {totalAgents}
            </span>
            {totalAgents > 0 && (
              <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400 font-mono tabular-nums">
                {onlineAgents} online
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Atera sync · {formatRelativeTime(data.status.lastAteraSync)}
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Active Security & RMM Alerts
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {totalDefenderAlerts + totalRmmAlerts}
            </span>
            {highAlerts > 0 && (
              <span className="text-xs font-medium text-red-700 dark:text-red-400 font-mono tabular-nums">
                {highAlerts} critical/high
              </span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            {totalDefenderAlerts} Defender · {totalRmmAlerts} Atera RMM
          </div>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 space-y-2">
          <div className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Available Score Uplift
          </div>
          <div className="flex items-baseline gap-2.5">
            <span className="font-mono text-2xl font-semibold tabular-nums text-slate-900 dark:text-slate-100">
              {allControls.length > 0 ? `+${totalPotentialPoints}` : '—'}
            </span>
            {allControls.length > 0 && (
              <span className="text-xs text-slate-500 dark:text-slate-400">pts</span>
            )}
          </div>
          <div className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums">
            Across {allControls.length} open controls
          </div>
        </div>
      </div>

      {/* Main Analytics Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Columns: 30-Day Trend & Category Breakdown */}
        <div className="lg:col-span-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Microsoft Secure Score 30-Day Trend
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Daily fleet percentage aggregated from Microsoft Graph Security API
              </p>
            </div>
            {rows.length > 0 && (
              <button
                type="button"
                onClick={() => exportPostureCsv(rows)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Download className="w-3.5 h-3.5" />
                <span>Export CSV</span>
              </button>
            )}
          </div>

          {trendPoints.length >= 2 ? (
            <div className="w-full overflow-x-auto">
              <TrendSvgChart points={trendPoints} />
            </div>
          ) : (
            <div className="h-52 flex flex-col items-center justify-center text-center border border-dashed border-slate-200 dark:border-slate-800 rounded-lg px-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No Secure Score history synced yet
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 max-w-md">
                Connect one or more customer Microsoft 365 tenants in Integrations & Setup to populate 30-day Defender Secure Score trajectories.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('integrations')}
                className="mt-3 px-3.5 py-1.5 text-xs font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors"
              >
                Connect M365 Tenant
              </button>
            </div>
          )}

          {categorySummary.length > 0 && (
            <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
              <h3 className="text-xs font-semibold text-slate-700 dark:text-slate-300 mb-3">
                Score Distribution by Security Pillar
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {categorySummary.map((cat) => (
                  <div key={cat.category} className="space-y-1.5">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-medium text-slate-700 dark:text-slate-300">
                        {cat.category}
                      </span>
                      <span className="font-mono tabular-nums text-slate-600 dark:text-slate-400">
                        {cat.pct}%
                      </span>
                    </div>
                    <div className="h-1.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full ${getScoreLabel(cat.pct).barClass}`}
                        style={{ width: `${Math.min(100, cat.pct)}%` }}
                      />
                    </div>
                    <div className="text-[11px] font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {cat.current} / {cat.max} pts
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Right Column: Customer Score Ranking */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
                Customer Posture Ranking
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tenant scores vs Atera footprint
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('customers')}
              className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
            >
              View All
            </button>
          </div>

          {rows.length === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-10 border border-dashed border-slate-200 dark:border-slate-800 rounded-lg px-4">
              <p className="text-sm font-medium text-slate-700 dark:text-slate-300">
                No customers loaded
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Sync Atera RMM or connect a Microsoft 365 tenant to begin monitoring.
              </p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.slice(0, 7).map((row) => {
                const score = row.tenant?.secureScore;
                const scoreStyle = score ? getScoreLabel(score.percentage) : null;
                return (
                  <button
                    key={row.key}
                    type="button"
                    onClick={() => onInspectCustomer(row.key)}
                    className="w-full py-2.5 flex items-center justify-between gap-3 text-left hover:bg-slate-50 dark:hover:bg-slate-800/60 px-2 -mx-2 rounded-lg transition-colors"
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-slate-900 dark:text-slate-100 truncate">
                        {row.displayName}
                      </div>
                      <div className="text-xs text-slate-500 dark:text-slate-400 truncate font-mono tabular-nums">
                        {row.agents.length} agents · {row.defenderAlertsCount + row.rmmAlerts.length} alerts
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      {score ? (
                        <>
                          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                            {score.percentage}%
                          </div>
                          <div className={`text-[11px] ${scoreStyle?.textClass}`}>
                            {scoreStyle?.label}
                          </div>
                        </>
                      ) : (
                        <span className="text-xs text-slate-400 dark:text-slate-500">
                          Unlinked
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Highest-Impact Remediation Queue */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
        <div className="px-6 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-base font-semibold text-slate-900 dark:text-slate-100">
              Highest-Impact Secure Score Controls
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Unimplemented Microsoft Defender controls ordered by maximum score uplift
            </p>
          </div>
          <button
            type="button"
            onClick={() => onNavigate('controls')}
            className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap shrink-0"
          >
            All Controls
          </button>
        </div>

        {topControls.length === 0 ? (
          <div className="p-8 text-center text-xs text-slate-500 dark:text-slate-400">
            No pending Secure Score improvement controls available. Connect and sync an M365 tenant to inspect recommendations.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 text-xs font-medium text-slate-500 dark:text-slate-400 bg-slate-50/70 dark:bg-slate-950/50">
                  <th className="py-2.5 px-6">Control</th>
                  <th className="py-2.5 px-4">Customer</th>
                  <th className="py-2.5 px-4">Category</th>
                  <th className="py-2.5 px-4">User Impact</th>
                  <th className="py-2.5 px-6 text-right">Score Uplift</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-sm">
                {topControls.map((ctrl) => (
                  <tr
                    key={`${ctrl.customerKey}-${ctrl.controlName}`}
                    onClick={() => onInspectCustomer(ctrl.customerKey)}
                    className="hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer transition-colors"
                  >
                    <td className="py-2.5 px-6 font-medium text-slate-900 dark:text-slate-100 max-w-md truncate">
                      {ctrl.title}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {ctrl.tenantName}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {ctrl.category}
                    </td>
                    <td className="py-2.5 px-4 text-xs text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {ctrl.userImpact}
                    </td>
                    <td className="py-2.5 px-6 text-right font-mono text-xs font-semibold tabular-nums text-emerald-700 dark:text-emerald-400 whitespace-nowrap">
                      +{ctrl.scoreGap} pts
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

function TrendSvgChart({
  points,
}: {
  points: Array<{ date: string; avgPct: number }>;
}) {
  const width = 680;
  const height = 210;
  const padLeft = 40;
  const padRight = 16;
  const padTop = 16;
  const padBottom = 28;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const minY = Math.max(0, Math.floor(Math.min(...points.map((p) => p.avgPct)) / 10) * 10 - 10);
  const maxY = Math.min(100, Math.ceil(Math.max(...points.map((p) => p.avgPct)) / 10) * 10 + 10);
  const spanY = Math.max(10, maxY - minY);

  const coords = points.map((pt, idx) => {
    const x =
      points.length === 1
        ? padLeft + innerW / 2
        : padLeft + (idx / (points.length - 1)) * innerW;
    const y = padTop + innerH - ((pt.avgPct - minY) / spanY) * innerH;
    return { ...pt, x, y };
  });

  const linePath = coords
    .map((c, i) => `${i === 0 ? 'M' : 'L'} ${c.x.toFixed(1)} ${c.y.toFixed(1)}`)
    .join(' ');
  const areaPath = `${linePath} L ${coords[coords.length - 1].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} L ${coords[0].x.toFixed(1)} ${(padTop + innerH).toFixed(1)} Z`;

  const yTicks = [minY, Math.round((minY + maxY) / 2), maxY];
  const labelIndices = [0, Math.floor(coords.length / 2), coords.length - 1].filter(
    (v, i, arr) => arr.indexOf(v) === i
  );

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-52 select-none"
      role="img"
      aria-label="30-day Secure Score trend chart"
    >
      <defs>
        <linearGradient id="scoreAreaGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#2563EB" stopOpacity="0.18" />
          <stop offset="100%" stopColor="#2563EB" stopOpacity="0.0" />
        </linearGradient>
      </defs>

      {yTicks.map((tick) => {
        const y = padTop + innerH - ((tick - minY) / spanY) * innerH;
        return (
          <g key={tick}>
            <line
              x1={padLeft}
              y1={y}
              x2={width - padRight}
              y2={y}
              className="stroke-slate-200 dark:stroke-slate-800"
              strokeDasharray="3 3"
              strokeWidth="1"
            />
            <text
              x={padLeft - 8}
              y={y + 4}
              textAnchor="end"
              className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono"
            >
              {tick}%
            </text>
          </g>
        );
      })}

      <path d={areaPath} fill="url(#scoreAreaGrad)" />
      <path
        d={linePath}
        fill="none"
        stroke="#2563EB"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {coords.map((c, idx) => (
        <circle
          key={c.date}
          cx={c.x}
          cy={c.y}
          r={idx === coords.length - 1 ? 4 : 2.5}
          className="fill-blue-600 dark:fill-blue-400"
        >
          <title>{`${c.date}: ${c.avgPct}%`}</title>
        </circle>
      ))}

      {labelIndices.map((idx) => {
        const c = coords[idx];
        return (
          <text
            key={c.date}
            x={c.x}
            y={height - 6}
            textAnchor={idx === 0 ? 'start' : idx === coords.length - 1 ? 'end' : 'middle'}
            className="fill-slate-400 dark:fill-slate-500 text-[10px] font-mono"
          >
            {c.date.slice(5)}
          </text>
        );
      })}
    </svg>
  );
}
