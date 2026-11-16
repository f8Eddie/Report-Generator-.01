import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { AteraAgent, AteraTicket, ManagedDeviceItem } from '../types';
import { formatShortDate, type UnifiedCustomerRow } from './posture';

export interface PdfReportInput {
  customer: UnifiedCustomerRow;
  monthLabel: string;
  mspName: string;
  overviewNote: string;
  mdrNote: string;
  nonCompliantNote: string;
  includeFullTicketTable: boolean;
  ticketStats: {
    total: number;
    closedWithinSla: number;
    closedOutsideSla: number;
    openCount: number;
    noSlaCount: number;
    topTags: Array<{ rank: number; tag: string; count: number }>;
  };
  allCustomerTicketsCount: number;
  activeTicketSet: AteraTicket[];
  patchingStats: {
    total: number;
    retiredCount: number;
    retiredDays: number;
    upToDate: number;
    pct: number | null;
    hasLivePatchApi: boolean;
    hasManualOverride: boolean;
    buckets: Array<{ key: string; label: string; total: number; healthy: number }>;
    attentionDevices: Array<{ agent: AteraAgent; reason: string }>;
  };
  staleOrNonCompliant: ManagedDeviceItem[];
  malwareAlertsCount: number;
  activeRiskyUsersCount: number;
  backup: {
    enabled: boolean;
    execSummaryNote: string;
    sectionNote: string;
    imageDataUrl: string | null;
  };
}

const BRAND_BLUE: [number, number, number] = [3, 87, 163]; // #0357A3
const SLATE_900: [number, number, number] = [15, 23, 42];
const SLATE_700: [number, number, number] = [51, 65, 85];
const SLATE_500: [number, number, number] = [100, 116, 139];
const SLATE_200: [number, number, number] = [226, 232, 240];
const EMERALD_600: [number, number, number] = [5, 150, 105];

function renderDonutCanvasDataUrl(segments: Array<{ count: number; color: string }>, total: number): string {
  const size = 360;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = size / 2;
  const cy = size / 2;
  const radius = 128;
  const lineWidth = 46;

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = '#E2E8F0';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (total > 0) {
    let startAngle = -Math.PI / 2;
    for (const seg of segments) {
      if (seg.count <= 0) continue;
      const sweep = (seg.count / total) * Math.PI * 2;
      ctx.strokeStyle = seg.color;
      ctx.beginPath();
      ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
      ctx.stroke();
      startAngle += sweep;
    }
  }

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 42px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(total), cx, cy - 10);

  ctx.fillStyle = '#64748B';
  ctx.font = 'bold 18px Helvetica, Arial, sans-serif';
  ctx.fillText('TICKETS', cx, cy + 24);

  return canvas.toDataURL('image/png');
}

function renderOsRingCanvasDataUrl(percentage: number | null): string {
  const size = 180;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return '';

  const cx = size / 2;
  const cy = size / 2;
  const radius = 66;
  const lineWidth = 18;
  const pct = percentage ?? 0;

  ctx.lineWidth = lineWidth;
  ctx.strokeStyle = percentage != null && pct < 100 ? '#F59E0B' : '#E2E8F0';
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.stroke();

  if (percentage != null && pct > 0) {
    const startAngle = -Math.PI / 2;
    const sweep = (Math.min(100, pct) / 100) * Math.PI * 2;
    ctx.strokeStyle = pct >= 70 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, startAngle + sweep);
    ctx.stroke();
  }

  ctx.fillStyle = '#0F172A';
  ctx.font = 'bold 28px Helvetica, Arial, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(percentage != null ? `${pct}%` : '—', cx, cy);

  return canvas.toDataURL('image/png');
}

function prepareImageForPdf(
  dataUrl: string
): Promise<{ dataUrl: string; width: number; height: number; format: 'PNG' | 'JPEG' }> {
  return new Promise((resolve) => {
    const isJpeg = dataUrl.startsWith('data:image/jpeg') || dataUrl.startsWith('data:image/jpg');
    const isPng = dataUrl.startsWith('data:image/png');
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth || 1200;
      const h = img.naturalHeight || 600;
      if (isJpeg) {
        resolve({ dataUrl, width: w, height: h, format: 'JPEG' });
        return;
      }
      if (isPng) {
        resolve({ dataUrl, width: w, height: h, format: 'PNG' });
        return;
      }
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        resolve({ dataUrl: canvas.toDataURL('image/png'), width: w, height: h, format: 'PNG' });
        return;
      }
      resolve({ dataUrl, width: w, height: h, format: 'PNG' });
    };
    img.onerror = () => resolve({ dataUrl, width: 1200, height: 600, format: 'PNG' });
    img.src = dataUrl;
  });
}

export async function generateCustomerReportPdf(input: PdfReportInput): Promise<void> {
  const doc = new jsPDF({
    orientation: 'portrait',
    unit: 'mm',
    format: 'a4',
  });

  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const margin = 15;
  const contentWidth = pageWidth - margin * 2;
  const bottomLimit = pageHeight - 16;

  let y = 18;

  const ensureSpace = (neededMm: number) => {
    if (y + neededMm > bottomLimit) {
      doc.addPage();
      y = 18;
    }
  };

  const drawSectionHeading = (title: string) => {
    ensureSpace(16);
    doc.setDrawColor(...SLATE_200);
    doc.setLineWidth(0.3);
    doc.line(margin, y, pageWidth - margin, y);
    y += 7;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(13);
    doc.setTextColor(...SLATE_900);
    doc.text(title, margin, y);
    y += 6;
  };

  const drawLabeledParagraph = (label: string, body: string) => {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    const lines = doc.splitTextToSize(body, contentWidth) as string[];
    ensureSpace(7 + lines.length * 4.4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_900);
    doc.text(label, margin, y);
    y += 4.5;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE_700);
    doc.text(lines, margin, y);
    y += lines.length * 4.3 + 2.5;
  };

  const getLastY = () =>
    (doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? y;

  // ---------------------------------------------------------------------------
  // Document Header
  // ---------------------------------------------------------------------------
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9);
  doc.setTextColor(...SLATE_500);
  doc.text(input.mspName, pageWidth / 2, y, { align: 'center' });
  y += 7;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.setTextColor(...SLATE_900);
  doc.text(input.customer.displayName, pageWidth / 2, y, { align: 'center' });
  y += 6.5;

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.setTextColor(...SLATE_700);
  doc.text(`${input.monthLabel} Monthly Report`, pageWidth / 2, y, { align: 'center' });
  y += 5;

  const generatedStr = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.5);
  doc.setTextColor(...SLATE_500);
  doc.text(
    `${input.customer.domain || 'No verified domain'} · Generated ${generatedStr}`,
    pageWidth / 2,
    y,
    { align: 'center' }
  );
  y += 5;

  doc.setDrawColor(...SLATE_200);
  doc.setLineWidth(0.4);
  doc.line(margin, y, pageWidth - margin, y);
  y += 8;

  // ---------------------------------------------------------------------------
  // Section 1: Executive Summary
  // ---------------------------------------------------------------------------
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(13);
  doc.setTextColor(...SLATE_900);
  doc.text('Executive Summary', margin, y);
  y += 6;

  if (input.overviewNote.trim()) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_700);
    const lines = doc.splitTextToSize(input.overviewNote.trim(), contentWidth) as string[];
    doc.text(lines, margin, y);
    y += lines.length * 4.3 + 3;
  }

  let ticketsSummaryText = 'Not linked to an Atera RMM customer.';
  if (input.customer.ateraCustomer) {
    if (input.activeTicketSet.length > 0) {
      const parts = [
        `${input.ticketStats.closedWithinSla} closed within SLA`,
        ...(input.ticketStats.closedOutsideSla > 0
          ? [`${input.ticketStats.closedOutsideSla} closed outside SLA`]
          : []),
        ...(input.ticketStats.noSlaCount > 0
          ? [`${input.ticketStats.noSlaCount} without SLA applied`]
          : []),
        `${input.ticketStats.openCount} open`,
      ];
      ticketsSummaryText = `A total of ${input.ticketStats.total} tickets were logged in ${input.monthLabel}: ${parts.join(', ')}.`;
    } else {
      ticketsSummaryText = `No tickets recorded in ${input.monthLabel} (total historical tickets loaded: ${input.allCustomerTicketsCount}).`;
    }
  }
  drawLabeledParagraph('Tickets', ticketsSummaryText);

  const patchingSummaryText =
    input.patchingStats.total > 0
      ? `${input.patchingStats.pct}% of active devices (${input.patchingStats.upToDate} out of ${input.patchingStats.total}) are up to date${
          input.patchingStats.retiredCount > 0
            ? ` (${input.patchingStats.retiredCount} retired devices offline > ${input.patchingStats.retiredDays} days excluded)`
            : ''
        }.${
          input.patchingStats.attentionDevices.length > 0
            ? ' Devices needing OS updates or check-in attention are listed in the Patching section below.'
            : ''
        }`
      : 'No active RMM agents found for this customer.';
  drawLabeledParagraph('Patching', patchingSummaryText);

  const tenant = input.customer.tenant;
  const mdrSummaryText = `${input.mdrNote}${
    tenant
      ? ` Currently ${tenant.defenderAlerts.length} Microsoft Defender security alerts are logged in the active feed.`
      : ''
  }`;
  drawLabeledParagraph('Managed Detection and Response (MDR)', mdrSummaryText);

  if (input.backup.enabled) {
    drawLabeledParagraph('Microsoft 365 Backup', input.backup.execSummaryNote);
  }

  const secureScore = tenant?.secureScore ?? null;
  const secureScoreSummary = secureScore
    ? `Microsoft Secure Score stands at ${secureScore.percentage}% (${secureScore.currentScore} / ${secureScore.maxScore} points)${
        secureScore.similarSizeAverage != null
          ? `, compared to ${Math.round(secureScore.similarSizeAverage * 10) / 10} points for organizations of a similar size.`
          : '.'
      }`
    : 'Microsoft 365 tenant not yet connected for Secure Score telemetry.';
  drawLabeledParagraph('Secure Score', secureScoreSummary);

  const hardeningSummary = tenant
    ? `${
        input.malwareAlertsCount === 0
          ? 'No high-severity malware detections'
          : `${input.malwareAlertsCount} high-severity/malware Defender alert(s) detected`
      } · ${
        input.activeRiskyUsersCount === 0
          ? 'No risky user sign-ins flagged.'
          : `${input.activeRiskyUsersCount} risky user account(s) flagged.`
      }`
    : 'Connect M365 tenant to inspect Defender malware and risky user posture.';
  drawLabeledParagraph('Security Hardening & Identity', hardeningSummary);

  const complianceSummary = tenant?.managedDevices
    ? `${tenant.managedDevices.nonCompliant} non-compliant device(s) out of ${tenant.managedDevices.total} Intune-managed devices. ${input.nonCompliantNote}`
    : input.nonCompliantNote;
  drawLabeledParagraph('Non-Compliant & Inactive Devices', complianceSummary);

  y += 2;

  // ---------------------------------------------------------------------------
  // Section 2: Tickets
  // ---------------------------------------------------------------------------
  drawSectionHeading(`Tickets (${input.monthLabel})`);

  if (input.activeTicketSet.length > 0) {
    ensureSpace(52);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_700);
    doc.text('Top 5 tickets by tag', margin, y);
    y += 3;

    const tableWidthLeft = contentWidth * 0.54;
    const tableStartY = y;

    autoTable(doc, {
      startY: tableStartY,
      margin: { left: margin, right: pageWidth - margin - tableWidthLeft },
      tableWidth: tableWidthLeft,
      head: [['#', 'Tag / Category', 'Tickets']],
      body: input.ticketStats.topTags.map((t) => [String(t.rank), t.tag, String(t.count)]),
      theme: 'grid',
      headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8.5, textColor: SLATE_900, cellPadding: 2.2 },
      columnStyles: {
        0: { cellWidth: 10 },
        2: { halign: 'right', cellWidth: 18 },
      },
    });
    const tableEndY = getLastY();

    // Render Ticket Donut beside table
    const donutDataUrl = renderDonutCanvasDataUrl(
      [
        { count: input.ticketStats.closedWithinSla, color: '#0357A3' },
        { count: input.ticketStats.closedOutsideSla, color: '#DC2626' },
        { count: input.ticketStats.noSlaCount, color: '#64748B' },
        { count: input.ticketStats.openCount, color: '#D97706' },
      ],
      input.ticketStats.total
    );

    const chartX = margin + tableWidthLeft + 6;
    if (donutDataUrl) {
      doc.addImage(donutDataUrl, 'PNG', chartX, tableStartY, 32, 32);
    }

    const legendX = chartX + 35;
    let ly = tableStartY + 6;
    const legendItems = [
      { label: 'Closed Within SLA', count: input.ticketStats.closedWithinSla, color: BRAND_BLUE },
      { label: 'Closed Outside SLA', count: input.ticketStats.closedOutsideSla, color: [220, 38, 38] as [number, number, number] },
      { label: 'No SLA Applied', count: input.ticketStats.noSlaCount, color: [100, 116, 139] as [number, number, number] },
      { label: 'Open', count: input.ticketStats.openCount, color: [217, 119, 6] as [number, number, number] },
    ];
    doc.setFontSize(8);
    for (const item of legendItems) {
      const pct = input.ticketStats.total > 0 ? Math.round((item.count / input.ticketStats.total) * 100) : 0;
      doc.setFillColor(...item.color);
      doc.circle(legendX, ly - 1, 1.3, 'F');
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(...SLATE_700);
      doc.text(`${item.label}: ${item.count} (${pct}%)`, legendX + 3, ly);
      ly += 5.5;
    }

    y = Math.max(tableEndY, tableStartY + 34) + 5;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_500);
    doc.text(`No tickets found for ${input.monthLabel}.`, margin, y);
    y += 7;
  }

  // ---------------------------------------------------------------------------
  // Section 3: Patching
  // ---------------------------------------------------------------------------
  drawSectionHeading('Patching');

  if (input.patchingStats.total > 0) {
    ensureSpace(50);
    const statusLabel = input.patchingStats.hasManualOverride
      ? 'OS patching status (Atera Critical & Security — manual override)'
      : input.patchingStats.hasLivePatchApi
        ? 'OS patching status (Atera Critical & Security updates)'
        : 'OS patching status (OS build & check-in currency)';

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_900);
    doc.text(statusLabel, margin, y);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(...SLATE_500);
    doc.text(
      `${input.patchingStats.upToDate} out of ${input.patchingStats.total} devices`,
      pageWidth - margin,
      y,
      { align: 'right' }
    );
    y += 4;

    // Progress bar
    const pctVal = input.patchingStats.pct ?? 0;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(...SLATE_900);
    doc.text(`${pctVal}%`, margin, y + 3);

    const barX = margin + 14;
    const barW = contentWidth - 14;
    doc.setFillColor(...SLATE_200);
    doc.roundedRect(barX, y, barW, 3.6, 1.5, 1.5, 'F');
    if (pctVal > 0) {
      doc.setFillColor(...EMERALD_600);
      doc.roundedRect(barX, y, (barW * Math.min(100, pctVal)) / 100, 3.6, 1.5, 1.5, 'F');
    }
    y += 10;

    // 4 OS rings
    const colW = contentWidth / 4;
    for (let i = 0; i < input.patchingStats.buckets.length; i++) {
      const b = input.patchingStats.buckets[i];
      const bpct = b.total > 0 ? Math.round((b.healthy / b.total) * 100) : null;
      const ringImg = renderOsRingCanvasDataUrl(bpct);
      const cx = margin + colW * i + colW / 2;
      if (ringImg) {
        doc.addImage(ringImg, 'PNG', cx - 10, y, 20, 20);
      }
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(8.5);
      doc.setTextColor(...SLATE_900);
      doc.text(b.label, cx, y + 24, { align: 'center' });
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      doc.setTextColor(...SLATE_500);
      doc.text(b.total > 0 ? `${b.healthy}/${b.total} up to date` : '0 devices', cx, y + 28, {
        align: 'center',
      });
    }
    y += 33;

    if (input.patchingStats.attentionDevices.length > 0) {
      autoTable(doc, {
        startY: y,
        margin: { left: margin, right: margin },
        head: [['Device Name', 'User', 'Device Type', 'Patch / Build Status']],
        body: input.patchingStats.attentionDevices.slice(0, 30).map(({ agent, reason }) => [
          agent.machineName,
          agent.currentLoggedUsers || '—',
          agent.osType || agent.os,
          reason,
        ]),
        theme: 'grid',
        headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
        bodyStyles: { fontSize: 8, textColor: SLATE_900, cellPadding: 2 },
        columnStyles: {
          0: { fontStyle: 'bold', cellWidth: 38 },
          3: { halign: 'right' },
        },
      });
      y = getLastY() + 6;
    }
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_500);
    doc.text('No active Atera RMM agents linked to this customer.', margin, y);
    y += 7;
  }

  // ---------------------------------------------------------------------------
  // Section 4: Microsoft 365 Security
  // ---------------------------------------------------------------------------
  drawSectionHeading('Microsoft 365 Security');

  if (tenant) {
    // Secure Score & Category Breakdown
    if (secureScore) {
      ensureSpace(44);
      doc.setFont('helvetica', 'bold');
      doc.setFontSize(10);
      doc.setTextColor(...SLATE_900);
      doc.text(
        `Secure Score: ${secureScore.percentage}% (${secureScore.currentScore} / ${secureScore.maxScore} pts)`,
        margin,
        y
      );
      if (secureScore.similarSizeAverage != null) {
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8.5);
        doc.setTextColor(...SLATE_500);
        doc.text(
          `Similar size avg: ${Math.round(secureScore.similarSizeAverage * 10) / 10} pts`,
          pageWidth - margin,
          y,
          { align: 'right' }
        );
      }
      y += 5;

      for (const cat of tenant.categoryBreakdown) {
        ensureSpace(7);
        doc.setFont('helvetica', 'normal');
        doc.setFontSize(8);
        doc.setTextColor(...SLATE_700);
        doc.text(cat.category, margin, y);
        doc.text(`${cat.percentage}%`, pageWidth - margin, y, { align: 'right' });
        y += 1.5;
        doc.setFillColor(...SLATE_200);
        doc.roundedRect(margin, y, contentWidth, 2, 0.8, 0.8, 'F');
        if (cat.percentage > 0) {
          doc.setFillColor(...BRAND_BLUE);
          doc.roundedRect(margin, y, (contentWidth * Math.min(100, cat.percentage)) / 100, 2, 0.8, 0.8, 'F');
        }
        y += 5;
      }
      y += 2;
    }

    // Non-compliant / stale Intune devices
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_700);
    doc.text('Devices non-compliant or inactive (> 21 days)', margin, y);
    y += 3;

    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Device Name', 'Last Sync / Update', 'OS Platform', 'Compliance / Version']],
      body:
        input.staleOrNonCompliant.length === 0
          ? [['No non-compliant or stale Intune devices reported.', '', '', '']]
          : input.staleOrNonCompliant.slice(0, 15).map((d) => [
              d.deviceName,
              formatShortDate(d.lastSyncDateTime),
              d.operatingSystem,
              `${d.complianceState}${d.osVersion ? ` (${d.osVersion})` : ''}`,
            ]),
      theme: 'grid',
      headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: SLATE_900, cellPadding: 2 },
    });
    y = getLastY() + 6;

    // Defender & Identity summary lines
    drawLabeledParagraph(
      'Defender Alerts & Malware Status',
      tenant.defenderAlerts.length === 0
        ? '0 active Microsoft Defender alerts. No action needed.'
        : `${tenant.defenderAlerts.length} active Defender alert(s) (${input.malwareAlertsCount} high/malware).`
    );
    drawLabeledParagraph(
      'Identity & Risky Sign-ins',
      input.activeRiskyUsersCount === 0
        ? 'No active risky users or sign-ins flagged.'
        : `${input.activeRiskyUsersCount} risky user account(s) require review.`
    );

    // Global Administrator roles
    ensureSpace(24);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_700);
    doc.text('Global Administrator roles in 365 Tenancy', margin, y);
    y += 3;

    const admins = tenant.globalAdmins ?? [];
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['Role Display Name', 'User Principal Name', 'Display Name']],
      body:
        admins.length === 0
          ? [['No Global Administrators returned (requires RoleManagement.Read.Directory + User.Read.All).', '', '']]
          : admins.map((adm) => [adm.roleDisplayName, adm.userPrincipalName, adm.displayName]),
      theme: 'grid',
      headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 8, textColor: SLATE_900, cellPadding: 2 },
    });
    y = getLastY() + 6;
  } else {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(...SLATE_500);
    doc.text('No Microsoft 365 Defender tenant linked to this customer yet.', margin, y);
    y += 7;
  }

  // ---------------------------------------------------------------------------
  // Optional Section 5: Backups
  // ---------------------------------------------------------------------------
  if (input.backup.enabled) {
    drawSectionHeading('Backups');
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9.5);
    doc.setTextColor(...SLATE_700);
    const capLines = doc.splitTextToSize(input.backup.sectionNote, contentWidth) as string[];
    doc.text(capLines, margin, y);
    y += capLines.length * 4.4 + 3;

    if (input.backup.imageDataUrl) {
      const dims = await prepareImageForPdf(input.backup.imageDataUrl);
      const maxImgH = 125;
      let drawW = contentWidth;
      let drawH = (dims.height / dims.width) * drawW;
      if (drawH > maxImgH) {
        drawH = maxImgH;
        drawW = (dims.width / dims.height) * drawH;
      }
      ensureSpace(drawH + 4);
      doc.addImage(dims.dataUrl, dims.format, margin, y, drawW, drawH);
      y += drawH + 6;
    }
  }

  // ---------------------------------------------------------------------------
  // Optional Appendix: Full Ticket Log
  // ---------------------------------------------------------------------------
  if (input.includeFullTicketTable && input.activeTicketSet.length > 0) {
    drawSectionHeading(`${input.monthLabel} Ticket Log (${input.activeTicketSet.length})`);
    autoTable(doc, {
      startY: y,
      margin: { left: margin, right: margin },
      head: [['ID', 'Title', 'Tag / Category', 'Status', 'Created']],
      body: input.activeTicketSet.map((tk) => [
        `#${tk.ticketId}`,
        tk.title,
        tk.category || tk.ticketType || tk.priority,
        tk.status,
        formatShortDate(tk.createdDate),
      ]),
      theme: 'grid',
      headStyles: { fillColor: BRAND_BLUE, textColor: 255, fontSize: 8.5, fontStyle: 'bold' },
      bodyStyles: { fontSize: 7.8, textColor: SLATE_900, cellPadding: 1.8 },
      columnStyles: {
        0: { cellWidth: 18 },
        4: { halign: 'right', cellWidth: 24 },
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Page Footer Numbers
  // ---------------------------------------------------------------------------
  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...SLATE_500);
    doc.text(
      `${input.customer.displayName} — ${input.monthLabel} Monthly Report`,
      margin,
      pageHeight - 8
    );
    doc.text(`Page ${p} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' });
  }

  const safeCustomer = input.customer.displayName.replace(/[^\w\s-]/g, '').trim() || 'Customer';
  const safeMonth = input.monthLabel.replace(/[^\w\s-]/g, '').trim() || 'Report';
  doc.save(`${safeCustomer} - ${safeMonth} Monthly Report.pdf`);
}
