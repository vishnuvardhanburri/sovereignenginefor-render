/**
 * Reply Intelligence System
 * AI-powered reply classification and automated sequence management
 * Classifies replies and triggers appropriate actions
 */

import { query } from '@/lib/db'
import { sovereignBookingUrl } from '@/lib/outbound-copy'

export interface ReplyAnalysis {
  replyId: string
  emailId: string
  contactEmail: string
  campaignId: string
  classification: ReplyClassification
  confidence: number
  sentiment: 'positive' | 'neutral' | 'negative'
  urgency: 'low' | 'medium' | 'high'
  intent: ReplyIntent
  keyPhrases: string[]
  suggestedAction: SuggestedAction
  analyzedAt: Date
  aiAnalysis?: AIAnalysis
}

export interface ReplyClassification {
  type: 'interested' | 'not_interested' | 'out_of_office' | 'question' | 'complaint' | 'unsubscribe' | 'bounce' | 'auto_reply' | 'unknown'
  subtype?: string
  reason: string
}

export interface ReplyIntent {
  primary: 'engage' | 'disengage' | 'clarify' | 'complain' | 'unsubscribe' | 'automated'
  secondary?: string[]
  urgency: 'low' | 'medium' | 'high'
}

export interface SuggestedAction {
  type: 'stop_sequence' | 'continue_sequence' | 'send_reply' | 'notify_human' | 'escalate' | 'ignore'
  priority: 'low' | 'medium' | 'high'
  reason: string
  suggestedReply?: string
  notifyUsers?: string[]
}

export interface AIAnalysis {
  provider: string
  model: string
  classification: ReplyClassification
  sentiment: string
  intent: ReplyIntent
  confidence: number
  reasoning: string
  processedAt: Date
}

export interface ReplyProcessingResult {
  analysis: ReplyAnalysis
  actionsTaken: string[]
  sequenceStopped: boolean
  notificationsSent: string[]
}

class ReplyIntelligenceEngine {
  private readonly cache: Map<string, ReplyAnalysis> = new Map()

  constructor() {
    // deterministic rules only
  }

  /**
   * Analyze incoming reply
   */
  async analyzeReply(
    replyId: string,
    emailId: string,
    contactEmail: string,
    campaignId: string,
    replySubject: string,
    replyBody: string,
    originalEmail?: { subject: string; body: string }
  ): Promise<ReplyAnalysis> {
    // Check cache first
    const cacheKey = `${replyId}-${replySubject}-${replyBody}`.slice(0, 100)
    const cached = this.cache.get(cacheKey)
    if (cached && Date.now() - cached.analyzedAt.getTime() < 3600000) { // 1 hour cache
      return cached
    }

    const aiAnalysis: AIAnalysis | undefined = undefined
    const classification = this.classifyWithRules(replySubject, replyBody)
    const sentiment = this.analyzeSentiment(replyBody)
    const intent = this.analyzeIntent(replySubject, replyBody, classification)
    const keyPhrases = this.extractKeyPhrases(replyBody)
    const suggestedAction = this.determineSuggestedAction(classification, intent, sentiment)

    const analysis: ReplyAnalysis = {
      replyId,
      emailId,
      contactEmail,
      campaignId,
      classification,
      confidence: this.calculateRuleConfidence(classification, replyBody),
      sentiment,
      urgency: intent.urgency,
      intent,
      keyPhrases,
      suggestedAction,
      analyzedAt: new Date(),
      aiAnalysis
    }

    // Cache result
    this.cache.set(cacheKey, analysis)

    // Store in database
    await this.storeAnalysis(analysis)

    return analysis
  }

  /**
   * Rule-based reply classification
   */
  private classifyWithRules(subject: string, body: string): ReplyClassification {
    const subjectLower = subject.toLowerCase()
    const bodyLower = body.toLowerCase()

    // Out of office / auto replies
    if (this.isOutOfOfficeReply(subjectLower, bodyLower)) {
      return {
        type: 'out_of_office',
        subtype: 'vacation',
        reason: 'Detected out of office indicators'
      }
    }

    // Auto replies
    if (this.isAutoReply(subjectLower, bodyLower)) {
      return {
        type: 'auto_reply',
        subtype: 'system_generated',
        reason: 'Detected automated response patterns'
      }
    }

    // Unsubscribe requests
    if (this.isUnsubscribeRequest(bodyLower)) {
      return {
        type: 'unsubscribe',
        reason: 'Detected unsubscribe intent'
      }
    }

    // Complaints
    if (this.isComplaint(bodyLower)) {
      return {
        type: 'complaint',
        reason: 'Detected complaint language'
      }
    }

    // Questions
    if (this.isQuestion(bodyLower)) {
      return {
        type: 'question',
        reason: 'Detected question patterns'
      }
    }

    // Interest indicators
    if (this.isInterested(bodyLower)) {
      return {
        type: 'interested',
        reason: 'Detected interest indicators'
      }
    }

    // Not interested
    if (this.isNotInterested(bodyLower)) {
      return {
        type: 'not_interested',
        reason: 'Detected disinterest indicators'
      }
    }

    return {
      type: 'unknown',
      reason: 'No clear classification patterns detected'
    }
  }

  /**
   * Check for out of office replies
   */
  private isOutOfOfficeReply(subject: string, body: string): boolean {
    const oooIndicators = [
      'out of office', 'out of the office', 'vacation', 'holiday', 'away',
      'autoreply', 'automatic reply', 'auto reply', 'i am out', 'i will be back'
    ]

    return oooIndicators.some(indicator =>
      subject.includes(indicator) || body.includes(indicator)
    )
  }

  /**
   * Check for auto replies
   */
  private isAutoReply(subject: string, body: string): boolean {
    const autoIndicators = [
      'autoreply', 'automatic reply', 'auto reply', 'system message',
      'do not reply', 'no reply necessary', 'this is an automated',
      'generated by', 'mail delivery', 'message undeliverable'
    ]

    return autoIndicators.some(indicator =>
      subject.includes(indicator) || body.includes(indicator)
    )
  }

  /**
   * Check for unsubscribe requests
   */
  private isUnsubscribeRequest(body: string): boolean {
    const unsubscribeIndicators = [
      'unsubscribe', 'stop', 'remove me', 'opt out', 'no more emails',
      'take me off', 'cancel subscription', 'stop sending', 'please remove'
    ]

    return unsubscribeIndicators.some(indicator => body.includes(indicator))
  }

  /**
   * Check for complaints
   */
  private isComplaint(body: string): boolean {
    const complaintIndicators = [
      'spam', 'unwanted', 'annoying', 'stop this', 'never contact',
      'remove from list', 'unsubscribe me', 'this is harassment'
    ]

    return complaintIndicators.some(indicator => body.includes(indicator))
  }

  /**
   * Check for questions
   */
  private isQuestion(body: string): boolean {
    const questionIndicators = [
      'what', 'how', 'when', 'where', 'why', 'who', 'can you', 'could you',
      'tell me', 'explain', 'help', '?'
    ]

    // Count question words and question marks
    const questionWords = questionIndicators.filter(word => body.includes(word)).length
    const questionMarks = (body.match(/\?/g) || []).length

    return questionWords >= 2 || questionMarks >= 1
  }

  /**
   * Check for interest indicators
   */
  private isInterested(body: string): boolean {
    const interestIndicators = [
      'interested', 'tell me more', 'let\'s talk', 'sounds good', 'yes',
      'great', 'excellent', 'perfect', 'exactly', 'that works', 'i\'m in',
      'count me in', 'sign me up', 'i want to', 'i\'m looking for'
    ]

    return interestIndicators.some(indicator => body.includes(indicator))
  }

  /**
   * Check for disinterest indicators
   */
  private isNotInterested(body: string): boolean {
    const disinterestIndicators = [
      'not interested', 'no thanks', 'not right now', 'not for me',
      'pass', 'not interested', 'no interest', 'not looking', 'thanks but'
    ]

    return disinterestIndicators.some(indicator => body.includes(indicator))
  }

  /**
   * Analyze sentiment
   */
  private analyzeSentiment(body: string): 'positive' | 'neutral' | 'negative' {
    const positiveWords = ['great', 'good', 'excellent', 'amazing', 'perfect', 'love', 'awesome', 'fantastic']
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'worst', 'disappointed', 'annoying']

    const positiveCount = positiveWords.filter(word => body.toLowerCase().includes(word)).length
    const negativeCount = negativeWords.filter(word => body.toLowerCase().includes(word)).length

    if (positiveCount > negativeCount) return 'positive'
    if (negativeCount > positiveCount) return 'negative'
    return 'neutral'
  }

  /**
   * Analyze intent
   */
  private analyzeIntent(subject: string, body: string, classification: ReplyClassification): ReplyIntent {
    const urgencyIndicators = ['urgent', 'asap', 'immediately', 'right away', 'emergency']
    const urgency = urgencyIndicators.some(word =>
      subject.includes(word) || body.includes(word)
    ) ? 'high' : 'low'

    let primary: ReplyIntent['primary'] = 'engage'
    const secondary: string[] = []

    switch (classification.type) {
      case 'interested':
        primary = 'engage'
        break
      case 'not_interested':
      case 'unsubscribe':
        primary = 'disengage'
        break
      case 'question':
        primary = 'clarify'
        secondary.push('engage')
        break
      case 'complaint':
        primary = 'complain'
        secondary.push('disengage')
        break
      case 'out_of_office':
      case 'auto_reply':
        primary = 'automated'
        break
      default:
        primary = 'engage'
    }

    return { primary, secondary, urgency: urgency as any }
  }

  /**
   * Extract key phrases
   */
  private extractKeyPhrases(body: string): string[] {
    // Simple extraction - could be enhanced with NLP
    const sentences = body.split(/[.!?]+/).filter(s => s.trim().length > 10)
    return sentences.slice(0, 3).map(s => s.trim())
  }

  /**
   * Determine suggested action
   */
  private determineSuggestedAction(
    classification: ReplyClassification,
    intent: ReplyIntent,
    sentiment: string
  ): SuggestedAction {
    switch (classification.type) {
      case 'interested':
        return {
          type: 'send_reply',
          priority: 'high',
          reason: 'Contact showed interest - collect campaign rescue details',
          suggestedReply: `Thanks for the interest. The practical next step is to share one live campaign for a rescue review: ${sovereignBookingUrl()}

Before I review it, please send:
- campaign goal and target market
- current tools, domains, mailboxes, provider, CRM, and follow-up process
- what usually gets blamed when replies are low: lead quality, deliverability, message fit, follow-ups, or reporting`
        }

      case 'not_interested':
        return {
          type: 'stop_sequence',
          priority: 'medium',
          reason: 'Contact indicated disinterest - stop sending'
        }

      case 'unsubscribe':
        return {
          type: 'stop_sequence',
          priority: 'high',
          reason: 'Contact requested unsubscribe - stop all communication'
        }

      case 'complaint':
        return {
          type: 'notify_human',
          priority: 'high',
          reason: 'Contact filed complaint - requires human attention',
          notifyUsers: ['admin', 'support']
        }

      case 'question':
        return {
          type: 'send_reply',
          priority: 'high',
          reason: 'Contact asked question - answer and collect campaign context',
          suggestedReply: `Happy to cover that. The fastest path is to look at one real campaign and separate the likely blockers: ${sovereignBookingUrl()}

Before I review it, please send:
- campaign goal and target market
- current tools, domains, mailboxes, provider, CRM, and follow-up process
- what usually gets blamed when replies are low: lead quality, deliverability, message fit, follow-ups, or reporting`
        }

      case 'out_of_office':
        return {
          type: 'continue_sequence',
          priority: 'low',
          reason: 'Out of office - continue sequence with adjusted timing'
        }

      case 'auto_reply':
        return {
          type: 'ignore',
          priority: 'low',
          reason: 'Automated response - no action needed'
        }

      default:
        return {
          type: 'notify_human',
          priority: 'medium',
          reason: 'Unclear reply type - requires human review'
        }
    }
  }

  /**
   * Calculate confidence for rule-based classification
   */
  private calculateRuleConfidence(classification: ReplyClassification, body: string): number {
    // Simple confidence based on body length and classification strength
    const baseConfidence = classification.type === 'unknown' ? 0.3 : 0.7
    const lengthBonus = Math.min(body.length / 1000, 0.2) // Up to 20% bonus for longer replies

    return Math.min(baseConfidence + lengthBonus, 0.95)
  }

  /**
   * Process reply and take actions
   */
  async processReply(
    replyId: string,
    emailId: string,
    contactEmail: string,
    campaignId: string,
    replySubject: string,
    replyBody: string,
    originalEmail?: { subject: string; body: string }
  ): Promise<ReplyProcessingResult> {
    const analysis = await this.analyzeReply(
      replyId, emailId, contactEmail, campaignId,
      replySubject, replyBody, originalEmail
    )

    const actionsTaken: string[] = []
    const notificationsSent: string[] = []
    let sequenceStopped = false

    // Execute suggested action
    switch (analysis.suggestedAction.type) {
      case 'stop_sequence':
        await this.stopSequence(campaignId, contactEmail, analysis.suggestedAction.reason)
        actionsTaken.push('sequence_stopped')
        sequenceStopped = true
        break

      case 'send_reply':
        if (analysis.suggestedAction.suggestedReply) {
          await this.queueSuggestedReply(
            campaignId, contactEmail, analysis.suggestedAction.suggestedReply
          )
          actionsTaken.push('reply_queued')
        }
        break

      case 'notify_human':
        if (analysis.suggestedAction.notifyUsers) {
          await this.sendNotifications(
            analysis.suggestedAction.notifyUsers,
            analysis,
            replySubject,
            replyBody
          )
          notificationsSent.push(...analysis.suggestedAction.notifyUsers)
          actionsTaken.push('notifications_sent')
        }
        break
    }

    // Handle unsubscribe requests
    if (analysis.classification.type === 'unsubscribe') {
      const { processUnsubscribeFromReply } = await import('@/lib/unsubscribe-suppression')
      await processUnsubscribeFromReply(contactEmail, replyBody, campaignId)
      actionsTaken.push('unsubscribed_user')
    }

    return {
      analysis,
      actionsTaken,
      sequenceStopped,
      notificationsSent
    }
  }

  /**
   * Stop sequence for contact
   */
  private async stopSequence(campaignId: string, contactEmail: string, reason: string): Promise<void> {
    await query(`
      UPDATE campaign_contacts
      SET sequence_status = 'stopped',
          stopped_reason = $3,
          stopped_at = NOW(),
          updated_at = NOW()
      WHERE campaign_id = $1 AND contact_email = $2
    `, [campaignId, contactEmail, reason])
  }

  /**
   * Queue suggested reply
   */
  private async queueSuggestedReply(campaignId: string, contactEmail: string, replyContent: string): Promise<void> {
    // This would integrate with the reply queuing system
    await query(`
      INSERT INTO queued_replies (
        campaign_id, contact_email, reply_content, priority, created_at
      ) VALUES ($1, $2, $3, 'high', NOW())
    `, [campaignId, contactEmail, replyContent])
  }

  /**
   * Send notifications to users
   */
  private async sendNotifications(
    users: string[],
    analysis: ReplyAnalysis,
    subject: string,
    body: string
  ): Promise<void> {
    // This would integrate with notification system (Slack, email, etc.)
    const notification = {
      type: 'reply_analysis',
      priority: analysis.suggestedAction.priority,
      analysis,
      originalSubject: subject,
      originalBody: body,
      notifiedUsers: users,
      createdAt: new Date()
    }

    await query(`
      INSERT INTO notifications (
        type, priority, data, created_at
      ) VALUES ($1, $2, $3, NOW())
    `, ['reply_analysis', analysis.suggestedAction.priority, JSON.stringify(notification)])
  }

  /**
   * Store analysis in database
   */
  private async storeAnalysis(analysis: ReplyAnalysis): Promise<void> {
    await query(`
      INSERT INTO reply_analysis (
        reply_id, email_id, contact_email, campaign_id,
        classification, confidence, sentiment, urgency, intent,
        key_phrases, suggested_action, analyzed_at, ai_analysis
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
    `, [
      analysis.replyId,
      analysis.emailId,
      analysis.contactEmail,
      analysis.campaignId,
      JSON.stringify(analysis.classification),
      analysis.confidence,
      analysis.sentiment,
      analysis.urgency,
      JSON.stringify(analysis.intent),
      JSON.stringify(analysis.keyPhrases),
      JSON.stringify(analysis.suggestedAction),
      analysis.analyzedAt,
      analysis.aiAnalysis ? JSON.stringify(analysis.aiAnalysis) : null
    ])
  }

  /**
   * Get reply analysis statistics
   */
  async getReplyStats(timeframe: 'day' | 'week' | 'month' = 'week'): Promise<{
    totalReplies: number
    byClassification: Record<string, number>
    bySentiment: Record<string, number>
    sequencesStopped: number
    autoRepliesSent: number
  }> {
    const interval = timeframe === 'day' ? '1 day' :
                    timeframe === 'week' ? '7 days' : '30 days'

    const results = await query(`
      SELECT
        COUNT(*) as total,
        classification->>'type' as classification_type,
        sentiment,
        COUNT(CASE WHEN suggested_action->>'type' = 'stop_sequence' THEN 1 END) as stopped_sequences,
        COUNT(CASE WHEN suggested_action->>'type' = 'send_reply' THEN 1 END) as auto_replies
      FROM reply_analysis
      WHERE analyzed_at >= NOW() - INTERVAL '${interval}'
      GROUP BY classification->>'type', sentiment
    `)

    const byClassification: Record<string, number> = {}
    const bySentiment: Record<string, number> = {}
    let sequencesStopped = 0
    let autoRepliesSent = 0

    for (const row of results.rows) {
      const r = row as any // Type assertion for database result
      byClassification[r.classification_type] = (byClassification[r.classification_type] || 0) + parseInt(r.total)
      bySentiment[r.sentiment] = (bySentiment[r.sentiment] || 0) + parseInt(r.total)
      sequencesStopped += parseInt(r.stopped_sequences)
      autoRepliesSent += parseInt(r.auto_replies)
    }

    return {
      totalReplies: results.rows.reduce((sum: number, row: any) => sum + parseInt(row.total), 0),
      byClassification,
      bySentiment,
      sequencesStopped,
      autoRepliesSent
    }
  }
}

// Singleton instance
export const replyIntelligence = new ReplyIntelligenceEngine()

/**
 * Process incoming reply (used by reply webhook/API)
 */
export async function processIncomingReply(
  replyId: string,
  emailId: string,
  contactEmail: string,
  campaignId: string,
  replySubject: string,
  replyBody: string,
  originalEmail?: { subject: string; body: string }
): Promise<ReplyProcessingResult> {
  return await replyIntelligence.processReply(
    replyId, emailId, contactEmail, campaignId,
    replySubject, replyBody, originalEmail
  )
}

/**
 * Analyze reply without taking actions (for testing/analysis)
 */
export async function analyzeReplyOnly(
  replyId: string,
  emailId: string,
  contactEmail: string,
  campaignId: string,
  replySubject: string,
  replyBody: string,
  originalEmail?: { subject: string; body: string }
): Promise<ReplyAnalysis> {
  return await replyIntelligence.analyzeReply(
    replyId, emailId, contactEmail, campaignId,
    replySubject, replyBody, originalEmail
  )
}
