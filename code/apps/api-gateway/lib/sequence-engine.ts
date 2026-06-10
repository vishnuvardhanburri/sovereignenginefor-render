// @ts-nocheck
/**
 * Full Sequence Engine
 * Multi-touch email sequence management with intelligent timing
 * Handles follow-ups, replies, bounces, and dynamic adjustments
 */

import { appEnv } from '@/lib/env'
import { query } from '@/lib/db'

export interface SequenceStep {
  id: string
  sequenceId: string
  stepNumber: number
  delayDays: number
  emailTemplate: EmailTemplate
  conditions?: SequenceCondition[]
  createdAt: Date
}

export interface EmailTemplate {
  id: string
  name: string
  subject: string
  body: string
  variables: Record<string, string>
  abTestVariants?: EmailTemplate[]
}

export interface SequenceCondition {
  type: 'reply_received' | 'opened' | 'clicked' | 'bounced' | 'unsubscribed' | 'time_elapsed'
  operator: 'equals' | 'not_equals' | 'greater_than' | 'less_than' | 'contains'
  value: any
  action: 'skip' | 'advance' | 'pause' | 'stop'
}

export interface SequenceExecution {
  id: string
  sequenceId: string
  contactEmail: string
  campaignId: string
  status: 'active' | 'paused' | 'completed' | 'stopped'
  currentStep: number
  startedAt: Date
  lastEmailSentAt?: Date
  nextEmailScheduledAt?: Date
  completedAt?: Date
  stoppedReason?: string
  metadata: Record<string, any>
}

export interface SequenceAnalytics {
  sequenceId: string
  totalContacts: number
  activeContacts: number
  completedContacts: number
  stoppedContacts: number
  averageCompletionTime: number
  replyRate: number
  openRate: number
  clickRate: number
  bounceRate: number
  unsubscribeRate: number
}

export interface SequenceTemplate {
  id: string
  name: string
  description: string
  category: string
  steps: Omit<SequenceStep, 'id' | 'sequenceId' | 'createdAt'>[]
  isActive: boolean
  createdAt: Date
}

// Default sequence templates
const DEFAULT_SEQUENCES: SequenceTemplate[] = [
  {
    id: 'agency-rescue-8-day',
    name: 'Agency Rescue (8 Days)',
    description: 'Agency-first diagnostic sequence with decision-frame follow-ups',
    category: 'cold-outreach',
    isActive: true,
    createdAt: new Date(),
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        emailTemplate: {
          id: 'initial-value-prop',
          name: 'Client Campaign Diagnosis',
          subject: 'campaign proof question',
          body: `Hi {{firstName}},

I noticed {{company}} works around client acquisition, outbound, or revenue operations, where client trust depends on explaining why a campaign is underperforming, not just showing activity.

When a client campaign underperforms, the hard part is usually proving whether the blocker is lead quality, spam folders, Promotions tabs, follow-up ownership, or reporting proof.

Xavira was built around that diagnosis layer.

When this happens at {{company}}, which blame shows up first?

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            company: '',
            industry: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 2,
        delayDays: 3,
        emailTemplate: {
          id: 'follow-up-value',
          name: 'Decision Clarity',
          subject: 're: campaign proof question',
          body: `Hi {{firstName}},

The reason I asked is simple: underperforming campaigns usually get misdiagnosed from surface metrics before anyone can prove the real blocker.

Worth diagnosing now, or not a priority for {{company}}?

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            company: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 3,
        delayDays: 2,
        emailTemplate: {
          id: 'final-value-breakthrough',
          name: 'Priority Check',
          subject: 'is this a priority?',
          body: `Hi {{firstName}},

Usually when campaign underperformance sits, the same leak keeps compounding.

It might be lead quality. It might be inbox placement. It might be follow-up ownership or reporting proof.

Is this a priority right now for {{company}}, or should I close this for now?

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            company: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 4,
        delayDays: 3,
        emailTemplate: {
          id: 'close-loop',
          name: 'Close Loop',
          subject: 'closing the loop',
          body: `Hi {{firstName}},

Seems like timing may not be right.

I will close this for now. If {{company}} needs to separate lead quality, deliverability, follow-up, and reporting problems later, we can revisit.

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            company: '',
            senderName: ''
          }
        }
      }
    ]
  },
  {
    id: 'nurture-30-day',
    name: 'Lead Nurture (30 Days)',
    description: 'Long-term nurture sequence with educational content',
    category: 'nurture',
    isActive: true,
    createdAt: new Date(),
    steps: [
      {
        stepNumber: 1,
        delayDays: 0,
        emailTemplate: {
          id: 'educational-content-1',
          name: 'Educational Content #1',
          subject: 'How to [topic] - A Complete Guide',
          body: `Hi {{firstName}},

[Educational content about topic]

[Call to action]

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 2,
        delayDays: 5,
        emailTemplate: {
          id: 'case-study-share',
          name: 'Case Study Share',
          subject: 'Case Study: How [Company] Achieved [Result]',
          body: `Hi {{firstName}},

Here's a case study that might interest you...

[Case study content]

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 3,
        delayDays: 7,
        emailTemplate: {
          id: 'questionnaire-followup',
          name: 'Questionnaire Follow-up',
          subject: 'Quick feedback on [topic]',
          body: `Hi {{firstName}},

Based on the content I've shared, I have a few questions...

[Questions]

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            senderName: ''
          }
        }
      },
      {
        stepNumber: 4,
        delayDays: 10,
        emailTemplate: {
          id: 'final-nurture-offer',
          name: 'Final Nurture Offer',
          subject: 'Last chance: [Special Offer]',
          body: `Hi {{firstName}},

This is my final email in this series.

[Special offer or final call to action]

Best,
{{senderName}}`,
          variables: {
            firstName: '',
            senderName: ''
          }
        }
      }
    ]
  }
]

class SequenceEngine {
  private readonly defaultTimezone: string = 'America/New_York'

  /**
   * Create a new sequence
   */
  async createSequence(templateId: string, campaignId: string, customSteps?: Partial<SequenceStep>[]): Promise<string> {
    const template = DEFAULT_SEQUENCES.find(t => t.id === templateId)
    if (!template) {
      throw new Error(`Sequence template ${templateId} not found`)
    }

    // Create sequence record
    const sequenceResult = await query(`
      INSERT INTO sequences (template_id, campaign_id, name, description, created_at)
      VALUES ($1, $2, $3, $4, NOW())
      RETURNING id
    `, [templateId, campaignId, template.name, template.description])

    const sequenceId = sequenceResult.rows[0].id

    // Create sequence steps
    const steps = customSteps || template.steps
    for (const step of steps) {
      await query(`
        INSERT INTO sequence_steps (
          sequence_id, step_number, delay_days, email_template, conditions, created_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
      `, [
        sequenceId,
        step.stepNumber,
        step.delayDays,
        JSON.stringify(step.emailTemplate),
        step.conditions ? JSON.stringify(step.conditions) : null
      ])
    }

    return sequenceId
  }

  /**
   * Start sequence for contact
   */
  async startSequenceForContact(
    sequenceId: string,
    contactEmail: string,
    campaignId: string,
    contactData: Record<string, any> = {}
  ): Promise<string> {
    // Check if contact is already in this sequence
    const existing = await query(`
      SELECT id FROM sequence_executions
      WHERE sequence_id = $1 AND contact_email = $2 AND campaign_id = $3
    `, [sequenceId, contactEmail, campaignId])

    if (existing.rows.length > 0) {
      throw new Error('Contact already in this sequence')
    }

    // Get first step
    const firstStep = await query(`
      SELECT * FROM sequence_steps
      WHERE sequence_id = $1 AND step_number = 1
    `, [sequenceId])

    if (firstStep.rows.length === 0) {
      throw new Error('No steps found in sequence')
    }

    // Calculate next email time (first step is immediate)
    const nextEmailTime = new Date()

    // Create execution record
    const executionResult = await query(`
      INSERT INTO sequence_executions (
        sequence_id, contact_email, campaign_id, status, current_step,
        started_at, next_email_scheduled_at, metadata
      ) VALUES ($1, $2, $3, 'active', 1, NOW(), $4, $5)
      RETURNING id
    `, [
      sequenceId,
      contactEmail,
      campaignId,
      nextEmailTime,
      JSON.stringify({ contactData, timezone: contactData.timezone || this.defaultTimezone })
    ])

    return executionResult.rows[0].id
  }

  /**
   * Process sequence executions (called by cron job)
   */
  async processSequenceExecutions(): Promise<{
    processed: number
    emailsSent: number
    sequencesCompleted: number
    errors: string[]
  }> {
    const processed = []
    const emailsSent = []
    const sequencesCompleted = []
    const errors = []

    try {
      // Get active executions ready for next email
      const executions = await query(`
        SELECT se.*, s.name as sequence_name
        FROM sequence_executions se
        JOIN sequences s ON se.sequence_id = s.id
        WHERE se.status = 'active'
        AND se.next_email_scheduled_at <= NOW()
        ORDER BY se.next_email_scheduled_at ASC
        LIMIT 100
      `)

      for (const execution of executions.rows) {
        try {
          const result = await this.processSingleExecution(execution)
          processed.push(execution.id)

          if (result.emailSent) {
            emailsSent.push(result.emailId)
          }

          if (result.sequenceCompleted) {
            sequencesCompleted.push(execution.id)
          }
        } catch (error) {
          console.error(`Error processing execution ${execution.id}:`, error)
          errors.push(`Execution ${execution.id}: ${error.message}`)
        }
      }
    } catch (error) {
      console.error('Error in processSequenceExecutions:', error)
      errors.push(`General error: ${error.message}`)
    }

    return {
      processed: processed.length,
      emailsSent: emailsSent.length,
      sequencesCompleted: sequencesCompleted.length,
      errors
    }
  }

  /**
   * Process single sequence execution
   */
  private async processSingleExecution(execution: any): Promise<{
    emailSent: boolean
    emailId?: string
    sequenceCompleted: boolean
  }> {
    // Global guard: stop sequence if contact has replied, bounced, or unsubscribed
    const email = execution.contact_email
    const campaignId = execution.campaign_id

    const { canSendToEmail } = await import('@/lib/unsubscribe-suppression')
    const isAllowed = await canSendToEmail(email)
    if (!isAllowed) {
      await this.completeSequence(execution.id, 'Unsubscribed or suppressed')
      return { emailSent: false, sequenceCompleted: true }
    }

    const bounced = await this.hasBounced(email, campaignId)
    if (bounced) {
      await this.completeSequence(execution.id, 'Bounced')
      return { emailSent: false, sequenceCompleted: true }
    }

    const replied = await this.hasReceivedReply(email, campaignId)
    if (replied) {
      await this.completeSequence(execution.id, 'Reply received')
      return { emailSent: false, sequenceCompleted: true }
    }

    // Get current step
    const stepResult = await query(`
      SELECT * FROM sequence_steps
      WHERE sequence_id = $1 AND step_number = $2
    `, [execution.sequence_id, execution.current_step])

    if (stepResult.rows.length === 0) {
      // No more steps - complete sequence
      await this.completeSequence(execution.id, 'All steps completed')
      return { emailSent: false, sequenceCompleted: true }
    }

    const step = stepResult.rows[0]

    // Check conditions
    const shouldSkip = await this.evaluateConditions(step, execution)
    if (shouldSkip) {
      // Move to next step
      await this.advanceToNextStep(execution.id, execution.current_step + 1)
      return { emailSent: false, sequenceCompleted: false }
    }

    // Send email
    const emailId = await this.sendSequenceEmail(step, execution)

    // Update execution
    const nextStep = execution.current_step + 1
    const nextStepData = await query(`
      SELECT delay_days FROM sequence_steps
      WHERE sequence_id = $1 AND step_number = $2
    `, [execution.sequence_id, nextStep])

    let nextEmailTime: Date | null = null
    if (nextStepData.rows.length > 0) {
      const delayDays = nextStepData.rows[0].delay_days
      nextEmailTime = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)
    }

    await query(`
      UPDATE sequence_executions
      SET current_step = $1,
          last_email_sent_at = NOW(),
          next_email_scheduled_at = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [nextStep, nextEmailTime, execution.id])

    return { emailSent: true, emailId, sequenceCompleted: !nextEmailTime }
  }

  /**
   * Evaluate step conditions
   */
  private async evaluateConditions(step: any, execution: any): Promise<boolean> {
    if (!step.conditions) return false

    const conditions = JSON.parse(step.conditions)

    for (const condition of conditions) {
      const shouldSkip = await this.evaluateCondition(condition, execution)
      if (shouldSkip) return true
    }

    return false
  }

  /**
   * Evaluate single condition
   */
  private async evaluateCondition(condition: SequenceCondition, execution: any): Promise<boolean> {
    let actualValue: any

    switch (condition.type) {
      case 'reply_received':
        actualValue = await this.hasReceivedReply(execution.contact_email, execution.campaign_id)
        break
      case 'opened':
        actualValue = await this.hasOpenedEmail(execution.contact_email, execution.campaign_id)
        break
      case 'clicked':
        actualValue = await this.hasClickedLink(execution.contact_email, execution.campaign_id)
        break
      case 'bounced':
        actualValue = await this.hasBounced(execution.contact_email, execution.campaign_id)
        break
      case 'unsubscribed':
        const { canSendToEmail } = await import('@/lib/unsubscribe-suppression')
        actualValue = !(await canSendToEmail(execution.contact_email))
        break
      case 'time_elapsed':
        actualValue = Date.now() - execution.started_at.getTime()
        break
      default:
        return false
    }

    return this.compareValues(actualValue, condition.operator, condition.value)
  }

  /**
   * Compare values based on operator
   */
  private compareValues(actual: any, operator: string, expected: any): boolean {
    switch (operator) {
      case 'equals':
        return actual === expected
      case 'not_equals':
        return actual !== expected
      case 'greater_than':
        return actual > expected
      case 'less_than':
        return actual < expected
      case 'contains':
        return String(actual).includes(String(expected))
      default:
        return false
    }
  }

  /**
   * Check if contact has received reply
   */
  private async hasReceivedReply(email: string, campaignId: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM events
      WHERE (event_type = 'reply' OR event_type = 'replied')
        AND (
          metadata->>'from_email' = $1
          OR metadata->>'contact_email' = $1
          OR contact_id IN (SELECT id FROM contacts WHERE email = $1)
        )
      UNION ALL
      SELECT 1 FROM reply_analysis
      WHERE contact_email = $1
      LIMIT 1
    `, [email])

    return result.rows.length > 0
  }

  /**
   * Check if contact has opened email
   */
  private async hasOpenedEmail(email: string, campaignId: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM email_events
      WHERE contact_email = $1 AND campaign_id = $2 AND event_type = 'open'
      LIMIT 1
    `, [email, campaignId])

    return result.rows.length > 0
  }

  /**
   * Check if contact has clicked link
   */
  private async hasClickedLink(email: string, campaignId: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM email_events
      WHERE contact_email = $1 AND campaign_id = $2 AND event_type = 'click'
      LIMIT 1
    `, [email, campaignId])

    return result.rows.length > 0
  }

  /**
   * Check if contact has bounced
   */
  private async hasBounced(email: string, campaignId: string): Promise<boolean> {
    const result = await query(`
      SELECT 1 FROM events
      WHERE (event_type = 'bounce' OR event_type = 'bounced')
        AND (
          metadata->>'contact_email' = $1
          OR metadata->>'to_email' = $1
          OR contact_id IN (SELECT id FROM contacts WHERE email = $1)
        )
      UNION ALL
      SELECT 1 FROM email_events
      WHERE contact_email = $1 AND event_type = 'bounce'
      LIMIT 1
    `, [email])

    return result.rows.length > 0
  }

  /**
   * Send sequence email
   */
  private async sendSequenceEmail(step: any, execution: any): Promise<string> {
    const template = JSON.parse(step.email_template)
    const metadata = JSON.parse(execution.metadata)

    // Personalize template
    const personalizedSubject = this.personalizeTemplate(template.subject, metadata.contactData)
    const personalizedBody = this.personalizeTemplate(template.body, metadata.contactData)

    // Generate unsubscribe link
    const { generateUnsubscribeLink } = await import('@/lib/unsubscribe-suppression')
    const { link, url } = generateUnsubscribeLink(execution.contact_email, execution.campaign_id)

    // Add unsubscribe link to body
    const bodyWithUnsubscribe = `${personalizedBody}\n\n---\nUnsubscribe: ${url}`

    // Queue email for sending
    const emailResult = await query(`
      INSERT INTO queued_emails (
        campaign_id, contact_email, subject, body, sequence_id, sequence_step,
        unsubscribe_token, priority, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'normal', NOW())
      RETURNING id
    `, [
      execution.campaign_id,
      execution.contact_email,
      personalizedSubject,
      bodyWithUnsubscribe,
      execution.sequence_id,
      execution.current_step,
      link.token
    ])

    return emailResult.rows[0].id
  }

  /**
   * Personalize template with contact data
   */
  private personalizeTemplate(template: string, contactData: Record<string, any>): string {
    let result = template

    // Replace variables
    for (const [key, value] of Object.entries(contactData)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value || '')
    }

    // Replace common fallbacks
    const fallbacks = {
      '{{firstName}}': contactData.firstName || contactData.name?.split(' ')[0] || 'there',
      '{{lastName}}': contactData.lastName || contactData.name?.split(' ').slice(1).join(' ') || '',
      '{{company}}': contactData.company || 'your company',
      '{{senderName}}': appEnv.smtpFromEmail?.split('@')[0] || 'Sender'
    }

    for (const [placeholder, value] of Object.entries(fallbacks)) {
      result = result.replace(new RegExp(placeholder, 'g'), value)
    }

    return result
  }

  /**
   * Advance to next step
   */
  private async advanceToNextStep(executionId: string, nextStep: number): Promise<void> {
    const nextStepData = await query(`
      SELECT delay_days FROM sequence_steps
      WHERE sequence_id = (
        SELECT sequence_id FROM sequence_executions WHERE id = $1
      ) AND step_number = $2
    `, [executionId, nextStep])

    let nextEmailTime: Date | null = null
    if (nextStepData.rows.length > 0) {
      const delayDays = nextStepData.rows[0].delay_days
      nextEmailTime = new Date(Date.now() + delayDays * 24 * 60 * 60 * 1000)
    }

    await query(`
      UPDATE sequence_executions
      SET current_step = $1,
          next_email_scheduled_at = $2,
          updated_at = NOW()
      WHERE id = $3
    `, [nextStep, nextEmailTime, executionId])
  }

  /**
   * Stop sequence for contact
   */
  async stopSequence(campaignId: string, contactEmail: string, reason: string): Promise<void> {
    await query(`
      UPDATE sequence_executions
      SET status = 'stopped',
          stopped_reason = $3,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE campaign_id = $1 AND contact_email = $2 AND status = 'active'
    `, [campaignId, contactEmail, reason])
  }

  /**
   * Complete sequence
   */
  private async completeSequence(executionId: string, reason: string): Promise<void> {
    await query(`
      UPDATE sequence_executions
      SET status = 'completed',
          stopped_reason = $2,
          completed_at = NOW(),
          updated_at = NOW()
      WHERE id = $1
    `, [executionId, reason])
  }

  /**
   * Pause sequence
   */
  async pauseSequence(campaignId: string, contactEmail: string, reason: string): Promise<void> {
    await query(`
      UPDATE sequence_executions
      SET status = 'paused',
          stopped_reason = $3,
          updated_at = NOW()
      WHERE campaign_id = $1 AND contact_email = $2 AND status = 'active'
    `, [campaignId, contactEmail, reason])
  }

  /**
   * Resume sequence
   */
  async resumeSequence(campaignId: string, contactEmail: string): Promise<void> {
    await query(`
      UPDATE sequence_executions
      SET status = 'active',
          stopped_reason = NULL,
          updated_at = NOW()
      WHERE campaign_id = $1 AND contact_email = $2 AND status = 'paused'
    `, [campaignId, contactEmail])
  }

  /**
   * Get sequence analytics
   */
  async getSequenceAnalytics(sequenceId: string, timeframe: 'day' | 'week' | 'month' = 'month'): Promise<SequenceAnalytics> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const results = await query(`
      SELECT
        COUNT(*) as total_contacts,
        COUNT(CASE WHEN status = 'active' THEN 1 END) as active_contacts,
        COUNT(CASE WHEN status = 'completed' THEN 1 END) as completed_contacts,
        COUNT(CASE WHEN status = 'stopped' THEN 1 END) as stopped_contacts,
        AVG(EXTRACT(EPOCH FROM (completed_at - started_at))/86400) as avg_completion_days,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM reply_analysis ra
          WHERE ra.contact_email = se.contact_email
          AND ra.campaign_id = se.campaign_id
        ) THEN 1 END)::float / COUNT(*) as reply_rate,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM email_events ee
          WHERE ee.contact_email = se.contact_email
          AND ee.campaign_id = se.campaign_id
          AND ee.event_type = 'open'
        ) THEN 1 END)::float / COUNT(*) as open_rate,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM email_events ee
          WHERE ee.contact_email = se.contact_email
          AND ee.campaign_id = se.campaign_id
          AND ee.event_type = 'click'
        ) THEN 1 END)::float / COUNT(*) as click_rate,
        COUNT(CASE WHEN EXISTS (
          SELECT 1 FROM email_events ee
          WHERE ee.contact_email = se.contact_email
          AND ee.campaign_id = se.campaign_id
          AND ee.event_type = 'bounce'
        ) THEN 1 END)::float / COUNT(*) as bounce_rate,
        COUNT(CASE WHEN NOT EXISTS (
          SELECT 1 FROM unsubscribes u
          WHERE u.email = se.contact_email
        ) THEN 1 END)::float / COUNT(*) as unsubscribe_rate
      FROM sequence_executions se
      WHERE se.sequence_id = $1
      AND se.started_at >= NOW() - INTERVAL '${interval}'
    `, [sequenceId])

    const stats = results.rows[0]
    return {
      sequenceId,
      totalContacts: parseInt(stats.total_contacts) || 0,
      activeContacts: parseInt(stats.active_contacts) || 0,
      completedContacts: parseInt(stats.completed_contacts) || 0,
      stoppedContacts: parseInt(stats.stopped_contacts) || 0,
      averageCompletionTime: parseFloat(stats.avg_completion_days) || 0,
      replyRate: parseFloat(stats.reply_rate) || 0,
      openRate: parseFloat(stats.open_rate) || 0,
      clickRate: parseFloat(stats.click_rate) || 0,
      bounceRate: parseFloat(stats.bounce_rate) || 0,
      unsubscribeRate: parseFloat(stats.unsubscribe_rate) || 0
    }
  }

  /**
   * Get available sequence templates
   */
  getSequenceTemplates(): SequenceTemplate[] {
    return DEFAULT_SEQUENCES.filter(template => template.isActive)
  }

  /**
   * Handle reply received (stop sequence if needed)
   */
  async handleReplyReceived(campaignId: string, contactEmail: string): Promise<void> {
    // Check sequence conditions - if reply_received should stop sequence
    const execution = await query(`
      SELECT se.*, ss.conditions
      FROM sequence_executions se
      JOIN sequence_steps ss ON se.sequence_id = ss.sequence_id AND se.current_step = ss.step_number
      WHERE se.campaign_id = $1 AND se.contact_email = $2 AND se.status = 'active'
    `, [campaignId, contactEmail])

    if (execution.rows.length > 0) {
      const row = execution.rows[0]
      const conditions = row.conditions ? JSON.parse(row.conditions) : []

      const replyCondition = conditions.find((c: SequenceCondition) =>
        c.type === 'reply_received' && c.action === 'stop'
      )

      if (replyCondition) {
        await this.stopSequence(campaignId, contactEmail, 'Reply received - stopping sequence per conditions')
      }
    }
  }
}

// Singleton instance
export const sequenceEngine = new SequenceEngine()

/**
 * Process all active sequences (called by cron job)
 */
export async function processAllSequences(): Promise<{
  processed: number
  emailsSent: number
  sequencesCompleted: number
  errors: string[]
}> {
  return await sequenceEngine.processSequenceExecutions()
}

/**
 * Start sequence for contact
 */
export async function startSequenceForContact(
  sequenceId: string,
  contactEmail: string,
  campaignId: string,
  contactData?: Record<string, any>
): Promise<string> {
  return await sequenceEngine.startSequenceForContact(sequenceId, contactEmail, campaignId, contactData)
}

/**
 * Stop sequence for contact (when reply received)
 */
export async function stopSequenceOnReply(campaignId: string, contactEmail: string): Promise<void> {
  await sequenceEngine.stopSequence(campaignId, contactEmail, 'Reply received')
  await sequenceEngine.handleReplyReceived(campaignId, contactEmail)
}
