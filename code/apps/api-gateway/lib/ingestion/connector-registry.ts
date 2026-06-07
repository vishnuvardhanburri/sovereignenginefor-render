export type IngestionSourceType =
  | 'apollo'
  | 'hubspot'
  | 'salesforce'
  | 'smartlead'
  | 'instantly'
  | 'linkedin_enrichment'
  | 'website_research'
  | 'webhook'
  | 'rest'
  | 'csv'

export interface ConnectorDefinition {
  sourceType: IngestionSourceType
  displayName: string
  authModes: Array<'none' | 'api_key' | 'oauth' | 'basic' | 'webhook_secret'>
  defaultRateLimitPerMinute: number
  idFields: string[]
  trustScore: number
  supportsCursor: boolean
}

export const CONNECTOR_REGISTRY: Record<IngestionSourceType, ConnectorDefinition> = {
  apollo: {
    sourceType: 'apollo',
    displayName: 'Apollo',
    authModes: ['api_key'],
    defaultRateLimitPerMinute: 40,
    idFields: ['id', 'email', 'linkedin_url'],
    trustScore: 0.82,
    supportsCursor: true,
  },
  hubspot: {
    sourceType: 'hubspot',
    displayName: 'HubSpot',
    authModes: ['oauth', 'api_key'],
    defaultRateLimitPerMinute: 80,
    idFields: ['vid', 'id', 'email'],
    trustScore: 0.9,
    supportsCursor: true,
  },
  salesforce: {
    sourceType: 'salesforce',
    displayName: 'Salesforce',
    authModes: ['oauth'],
    defaultRateLimitPerMinute: 60,
    idFields: ['Id', 'id', 'Email'],
    trustScore: 0.92,
    supportsCursor: true,
  },
  smartlead: {
    sourceType: 'smartlead',
    displayName: 'Smartlead',
    authModes: ['api_key'],
    defaultRateLimitPerMinute: 60,
    idFields: ['lead_id', 'id', 'email'],
    trustScore: 0.78,
    supportsCursor: true,
  },
  instantly: {
    sourceType: 'instantly',
    displayName: 'Instantly',
    authModes: ['api_key'],
    defaultRateLimitPerMinute: 60,
    idFields: ['id', 'email'],
    trustScore: 0.78,
    supportsCursor: true,
  },
  linkedin_enrichment: {
    sourceType: 'linkedin_enrichment',
    displayName: 'LinkedIn Enrichment',
    authModes: ['none', 'api_key'],
    defaultRateLimitPerMinute: 20,
    idFields: ['linkedin_url', 'profile_url', 'email'],
    trustScore: 0.7,
    supportsCursor: false,
  },
  website_research: {
    sourceType: 'website_research',
    displayName: 'Website Research',
    authModes: ['none'],
    defaultRateLimitPerMinute: 12,
    idFields: ['domain', 'website', 'email'],
    trustScore: 0.68,
    supportsCursor: false,
  },
  webhook: {
    sourceType: 'webhook',
    displayName: 'Webhook',
    authModes: ['webhook_secret'],
    defaultRateLimitPerMinute: 120,
    idFields: ['id', 'email', 'event_id'],
    trustScore: 0.75,
    supportsCursor: false,
  },
  rest: {
    sourceType: 'rest',
    displayName: 'REST API',
    authModes: ['api_key', 'none'],
    defaultRateLimitPerMinute: 120,
    idFields: ['id', 'email'],
    trustScore: 0.72,
    supportsCursor: false,
  },
  csv: {
    sourceType: 'csv',
    displayName: 'CSV Fallback',
    authModes: ['none'],
    defaultRateLimitPerMinute: 1000,
    idFields: ['email'],
    trustScore: 0.55,
    supportsCursor: false,
  },
}

export function isIngestionSourceType(value: string): boolean {
  return Object.prototype.hasOwnProperty.call(CONNECTOR_REGISTRY, value)
}

export function getConnectorDefinition(sourceType: string): ConnectorDefinition {
  if (!isIngestionSourceType(sourceType)) {
    throw new Error(`unsupported_ingestion_source:${sourceType}`)
  }
  return CONNECTOR_REGISTRY[sourceType as IngestionSourceType]
}
