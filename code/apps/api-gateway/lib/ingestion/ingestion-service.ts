import crypto from 'node:crypto'
import { query, queryOne, transaction, type QueryExecutor } from '@/lib/db'
import {
  getConnectorDefinition,
  isIngestionSourceType,
  type IngestionSourceType,
} from '@/lib/ingestion/connector-registry'
import { normalizeSourceRecord, type NormalizedLeadRecord } from '@/lib/ingestion/normalize-record'
import { scoreLeadIntelligence } from '@/lib/intelligence/lead-scoring'
import { appendOperationalEvent } from '@/lib/operational-events'
import { enforceFeature, recordUsage } from '@/lib/licensing/enforcement'

export interface IngestionBatchInput {
  clientId: number
  sourceType: string
  records: Array<Record<string, unknown>>
  idempotencyKey?: string
  sourceConnectionId?: string
  requestedBy?: string
  metadata?: Record<string, unknown>
}

export interface IngestionBatchResult {
  jobId: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled' | 'partial'
  totalRecords: number
  acceptedRecords: number
  rejectedRecords: number
  enrichedRecords: number
  failures: Array<{ externalId?: string; error: string }>
  alreadyProcessed: boolean
}

interface JobRow {
  id: string
  status: IngestionBatchResult['status']
  total_records: number
  accepted_records: number
  rejected_records: number
  enriched_records: number
}

interface ContactRow {
  id: string
}

function hashPayload(value: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

function buildJobKey(input: IngestionBatchInput): string {
  return (
    input.idempotencyKey ||
    hashPayload({
      sourceType: input.sourceType,
      records: input.records.map((record) => hashPayload(record)).sort(),
      metadata: input.metadata ?? {},
    })
  )
}

async function findJob(clientId: number, idempotencyKey: string): Promise<JobRow | null> {
  return queryOne<JobRow>(
    `SELECT id::text, status, total_records, accepted_records, rejected_records, enriched_records
     FROM ingestion_jobs
     WHERE client_id = $1 AND idempotency_key = $2
     LIMIT 1`,
    [clientId, idempotencyKey]
  )
}

async function createOrLoadJob(
  input: IngestionBatchInput,
  sourceType: IngestionSourceType,
  idempotencyKey: string
): Promise<JobRow> {
  const inserted = await queryOne<JobRow>(
    `INSERT INTO ingestion_jobs (
       client_id,
       source_connection_id,
       source_type,
       status,
       idempotency_key,
       requested_by,
       total_records,
       metadata,
       started_at
     )
     VALUES ($1,$2,$3,'running',$4,$5,$6,$7::jsonb,now())
     ON CONFLICT DO NOTHING
     RETURNING id::text, status, total_records, accepted_records, rejected_records, enriched_records`,
    [
      input.clientId,
      input.sourceConnectionId ?? null,
      sourceType,
      idempotencyKey,
      input.requestedBy ?? 'system',
      input.records.length,
      JSON.stringify(input.metadata ?? {}),
    ]
  )

  return inserted ?? (await findJob(input.clientId, idempotencyKey))!
}

async function upsertContact(
  exec: QueryExecutor,
  clientId: number,
  normalized: NormalizedLeadRecord
): Promise<ContactRow> {
  const result = await exec<ContactRow>(
    `INSERT INTO contacts (
       client_id,
       email,
       email_domain,
       name,
       company,
       company_domain,
       title,
       source,
       custom_fields,
       verification_status
     )
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,'unknown')
     ON CONFLICT (client_id, email) DO UPDATE
     SET email_domain = EXCLUDED.email_domain,
         name = COALESCE(EXCLUDED.name, contacts.name),
         company = COALESCE(EXCLUDED.company, contacts.company),
         company_domain = COALESCE(EXCLUDED.company_domain, contacts.company_domain),
         title = COALESCE(EXCLUDED.title, contacts.title),
         source = EXCLUDED.source,
         custom_fields = contacts.custom_fields || EXCLUDED.custom_fields,
         updated_at = CURRENT_TIMESTAMP
     RETURNING id::text`,
    [
      clientId,
      normalized.email,
      normalized.emailDomain,
      normalized.name ?? null,
      normalized.company ?? null,
      normalized.companyDomain ?? null,
      normalized.title ?? null,
      normalized.source,
      JSON.stringify(normalized.customFields),
    ]
  )
  const row = result.rows[0]
  if (!row) throw new Error('contact_upsert_failed')
  return row
}

export async function createIngestionBatch(input: IngestionBatchInput): Promise<IngestionBatchResult> {
  await enforceFeature(input.clientId, 'autonomous_ingestion')

  if (!isIngestionSourceType(input.sourceType)) {
    throw new Error(`unsupported_ingestion_source:${input.sourceType}`)
  }

  const sourceType = input.sourceType as IngestionSourceType
  const connector = getConnectorDefinition(sourceType)
  const idempotencyKey = buildJobKey(input)
  const existing = await findJob(input.clientId, idempotencyKey)
  if (existing?.status === 'completed' || existing?.status === 'partial') {
    return {
      jobId: existing.id,
      status: existing.status,
      totalRecords: Number(existing.total_records),
      acceptedRecords: Number(existing.accepted_records),
      rejectedRecords: Number(existing.rejected_records),
      enrichedRecords: Number(existing.enriched_records),
      failures: [],
      alreadyProcessed: true,
    }
  }

  const job = await createOrLoadJob(input, sourceType, idempotencyKey)
  let acceptedRecords = 0
  let rejectedRecords = 0
  let enrichedRecords = 0
  const failures: Array<{ externalId?: string; error: string }> = []

  for (const raw of input.records) {
    try {
      const normalized = normalizeSourceRecord(sourceType, raw)
      const score = scoreLeadIntelligence(normalized)
      const rawRecordId = await transaction(async (exec) => {
        const rawInserted = await exec<{ id: string }>(
          `INSERT INTO raw_source_records (
             client_id,
             ingestion_job_id,
             source_type,
             external_id,
             payload_hash,
             raw_payload,
             normalized_payload,
             processing_status
           )
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,'normalized')
           ON CONFLICT DO NOTHING
           RETURNING id::text`,
          [
            input.clientId,
            job.id,
            sourceType,
            normalized.externalId,
            normalized.payloadHash,
            JSON.stringify(raw),
            JSON.stringify(normalized),
          ]
        )

        const rawId =
          rawInserted.rows[0]?.id ??
          (
            await exec<{ id: string }>(
              `SELECT id::text
               FROM raw_source_records
               WHERE client_id = $1
                 AND source_type = $2
                 AND external_id = $3
                 AND payload_hash = $4
               LIMIT 1`,
              [input.clientId, sourceType, normalized.externalId, normalized.payloadHash]
            )
          ).rows[0]?.id

        if (!rawId) throw new Error('raw_record_insert_failed')

        const contact = await upsertContact(exec, input.clientId, normalized)
        await exec(
          `INSERT INTO organization_intelligence (
             client_id,
             company_domain,
             company_name,
             industry,
             employee_count,
             outbound_maturity_score,
             infrastructure_score,
             ai_governance_score,
             licensing_probability_score,
             evidence,
             last_enriched_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,now())
           ON CONFLICT (client_id, company_domain) DO UPDATE
           SET company_name = COALESCE(EXCLUDED.company_name, organization_intelligence.company_name),
               industry = COALESCE(EXCLUDED.industry, organization_intelligence.industry),
               employee_count = COALESCE(EXCLUDED.employee_count, organization_intelligence.employee_count),
               outbound_maturity_score = GREATEST(organization_intelligence.outbound_maturity_score, EXCLUDED.outbound_maturity_score),
               infrastructure_score = GREATEST(organization_intelligence.infrastructure_score, EXCLUDED.infrastructure_score),
               ai_governance_score = GREATEST(organization_intelligence.ai_governance_score, EXCLUDED.ai_governance_score),
               licensing_probability_score = GREATEST(organization_intelligence.licensing_probability_score, EXCLUDED.licensing_probability_score),
               evidence = organization_intelligence.evidence || EXCLUDED.evidence,
               last_enriched_at = now(),
               updated_at = now()`,
          [
            input.clientId,
            normalized.companyDomain || normalized.emailDomain,
            normalized.company ?? null,
            normalized.industry ?? null,
            normalized.employeeCount ?? null,
            score.outboundMaturityScore,
            score.infrastructureScore,
            score.aiGovernanceScore,
            score.licensingProbabilityScore,
            JSON.stringify({ sourceType, trustScore: connector.trustScore }),
          ]
        )
        await exec(
          `INSERT INTO contact_intelligence (
             client_id,
             contact_id,
             role_score,
             deliverability_risk_score,
             agency_fit_score,
             enterprise_value_score,
             priority_score,
             priority_lane,
             reasons,
             last_scored_at
           )
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,now())
           ON CONFLICT (client_id, contact_id) DO UPDATE
           SET role_score = EXCLUDED.role_score,
               deliverability_risk_score = EXCLUDED.deliverability_risk_score,
               agency_fit_score = EXCLUDED.agency_fit_score,
               enterprise_value_score = EXCLUDED.enterprise_value_score,
               priority_score = EXCLUDED.priority_score,
               priority_lane = EXCLUDED.priority_lane,
               reasons = EXCLUDED.reasons,
               last_scored_at = now(),
               updated_at = now()`,
          [
            input.clientId,
            contact.id,
            score.roleScore,
            score.deliverabilityRiskScore,
            score.agencyFitScore,
            score.enterpriseValueScore,
            score.priorityScore,
            score.priorityLane,
            JSON.stringify(score.reasons),
          ]
        )
        await exec(
          `INSERT INTO ingestion_events (client_id, ingestion_job_id, raw_record_id, event_type, payload)
           VALUES ($1,$2,$3,'record.normalized',$4::jsonb)`,
          [input.clientId, job.id, rawId, JSON.stringify({ email: normalized.email, score })]
        )

        return rawId
      })

      void rawRecordId
      acceptedRecords += 1
      enrichedRecords += 1
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      rejectedRecords += 1
      failures.push({ externalId: String(raw.id ?? raw.email ?? ''), error: msg })
      await query(
        `INSERT INTO ingestion_failures (
           client_id,
           ingestion_job_id,
           stage,
           error_code,
           error_message,
           payload
         )
         VALUES ($1,$2,'normalize','record_rejected',$3,$4::jsonb)`,
        [input.clientId, job.id, msg, JSON.stringify(raw)]
      )
    }
  }

  const status: IngestionBatchResult['status'] =
    rejectedRecords === input.records.length ? 'failed' : rejectedRecords > 0 ? 'partial' : 'completed'

  await query(
    `UPDATE ingestion_jobs
     SET status = $2,
         accepted_records = $3,
         rejected_records = $4,
         enriched_records = $5,
         failure_count = $6,
         completed_at = now(),
         updated_at = now()
     WHERE client_id = $1 AND id = $7`,
    [input.clientId, status, acceptedRecords, rejectedRecords, enrichedRecords, failures.length, job.id]
  )

  await recordUsage({
    clientId: input.clientId,
    meterType: 'ingestion_record',
    quantity: acceptedRecords,
    source: sourceType,
    idempotencyKey: `ingestion:${job.id}`,
  })
  await appendOperationalEvent({
    clientId: input.clientId,
    eventType: 'ingestion.job_completed',
    aggregateType: 'ingestion_job',
    aggregateId: job.id,
    actorType: 'worker',
    payload: { sourceType, total: input.records.length, acceptedRecords, rejectedRecords, enrichedRecords },
  })

  return {
    jobId: job.id,
    status,
    totalRecords: input.records.length,
    acceptedRecords,
    rejectedRecords,
    enrichedRecords,
    failures,
    alreadyProcessed: false,
  }
}
