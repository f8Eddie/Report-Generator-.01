export interface AteraTokenMetadata {
  source: 'override' | 'env' | 'none';
  isJwt: boolean;
  expiresAt: string | null;
  isExpired: boolean;
  accountId: string | null;
  region: string | null;
  environment: string | null;
  updatedAt: string | null;
}

export interface IntegrationStatus {
  ateraConfigured: boolean;
  ateraTokenInfo: AteraTokenMetadata;
  microsoftConfigured: boolean;
  redirectUri: string;
  lastAteraSync: string | null;
  lastAteraError: string | null;
  connectedTenantsCount: number;
  ateraCustomersCount: number;
}

export interface AteraCustomer {
  customerId: number;
  customerName: string;
  domain: string | null;
  city: string | null;
  country: string | null;
  phone: string | null;
  businessNumber: string | null;
  lastModified: string | null;
}

export interface AteraAgentAvailablePatchSummary {
  checkedAt: string;
  criticalCount: number;
  securityCount: number;
  otherCount: number;
  totalCount: number;
  pendingTitles: string[];
}

export interface AteraAgent {
  agentId: number;
  deviceGuid?: string | null;
  machineName: string;
  customerId: number;
  customerName: string;
  online: boolean;
  os: string;
  osType: string;
  lastSeen: string | null;
  reportedIp: string | null;
  currentLoggedUsers: string | null;
  pendingReboot: boolean;
  lastPatchDate?: string | null;
  windowsUpdateStatus?: string | null;
  osVersion?: string | null;
  osBuild?: string | null;
  lastRebootTime?: string | null;
  availablePatchSummary?: AteraAgentAvailablePatchSummary | null;
}

export interface AteraAlert {
  alertId: number;
  title: string;
  severity: 'Information' | 'Warning' | 'Critical' | string;
  category: string;
  customerId: number;
  customerName: string;
  machineName: string | null;
  created: string;
  archived: boolean;
}

export interface AteraTicket {
  ticketId: number;
  title: string;
  status: string;
  priority: string;
  customerId: number;
  customerName: string;
  createdDate: string;
  ticketType?: string | null;
  category?: string | null;
  resolvedDate?: string | null;
  onSla?: boolean | null;
  technicianName?: string | null;
  endUserName?: string | null;
}

export interface SecureScoreHistoryPoint {
  date: string;
  currentScore: number;
  maxScore: number;
  percentage: number;
}

export interface CategoryScoreBreakdown {
  category: string;
  currentScore: number;
  maxScore: number;
  percentage: number;
  controlCount: number;
}

export interface SecureScoreControlItem {
  controlName: string;
  title: string;
  category: string;
  currentScore: number;
  maxScore: number;
  scoreGap: number;
  scoreInPercentage: number;
  implementationStatus: string;
  userImpact: string;
  implementationCost: string;
  tier: string;
  threats: string[];
  remediation: string;
  actionUrl: string | null;
  rank: number;
}

export interface DefenderAlert {
  id: string;
  title: string;
  severity: 'informational' | 'low' | 'medium' | 'high' | 'unknown' | string;
  status: string;
  category: string;
  serviceSource: string;
  createdDateTime: string;
  assignedTo: string | null;
  classification: string | null;
  incidentWebUrl: string | null;
}

export interface ManagedDeviceItem {
  id: string;
  deviceName: string;
  operatingSystem: string;
  osVersion: string | null;
  complianceState: string;
  lastSyncDateTime: string | null;
  userPrincipalName: string | null;
}

export interface ManagedDeviceSummary {
  total: number;
  compliant: number;
  nonCompliant: number;
  nonCompliantDevices?: ManagedDeviceItem[];
  staleDevices?: ManagedDeviceItem[];
}

export interface GlobalAdminMember {
  id: string;
  roleDisplayName: string;
  userPrincipalName: string;
  displayName: string;
  accountEnabled?: boolean;
}

export interface RiskyUserSummary {
  id: string;
  userDisplayName: string;
  userPrincipalName: string;
  riskLevel: string;
  riskState: string;
  riskLastUpdatedDateTime: string | null;
}

export interface TenantConnectionSummary {
  id: string;
  tenantId: string;
  displayName: string;
  primaryDomain: string | null;
  authMode: 'delegated' | 'app_only';
  ateraCustomerId: number | null;
  connectedAt: string;
  lastSyncAt: string | null;
  lastSyncStatus: 'ok' | 'partial' | 'error' | 'pending';
  lastSyncError: string | null;
  permissionsNotes: string[];
  secureScore: {
    currentScore: number;
    maxScore: number;
    percentage: number;
    createdDateTime: string | null;
    activeUserCount: number | null;
    licensedUserCount: number | null;
    allTenantsAverage: number | null;
    similarSizeAverage: number | null;
  } | null;
  scoreHistory: SecureScoreHistoryPoint[];
  categoryBreakdown: CategoryScoreBreakdown[];
  controls: SecureScoreControlItem[];
  defenderAlerts: DefenderAlert[];
  managedDevices: ManagedDeviceSummary | null;
  globalAdmins?: GlobalAdminMember[];
  riskyUsers?: RiskyUserSummary[];
}

export interface DashboardPayload {
  status: IntegrationStatus;
  atera: {
    customers: AteraCustomer[];
    agents: AteraAgent[];
    alerts: AteraAlert[];
    tickets: AteraTicket[];
  };
  tenants: TenantConnectionSummary[];
}
