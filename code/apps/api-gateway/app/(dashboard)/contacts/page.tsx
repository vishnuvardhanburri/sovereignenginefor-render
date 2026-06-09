'use client'

import { useState } from 'react'
import { useApproveContacts, useContacts, useDeleteContact, useResearchApproveContacts } from '@/lib/hooks'
import { Contact } from '@/lib/api'
import { UploadContactsModal } from '@/components/upload-contacts-modal'
import { AddContactModal } from '@/components/add-contact-modal'
import { LeadScoutCard } from '@/components/lead-scout-card'
import { GoogleSheetImportCard } from '@/components/google-sheet-import-card'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Gauge,
  Search,
  ShieldAlert,
  ShieldCheck,
  Target,
  Trash2,
  XCircle,
} from 'lucide-react'

export default function ContactsPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const { data: contacts, isLoading } = useContacts()
  const { mutate: deleteContact } = useDeleteContact()
  const { mutate: approveContacts, isPending: approving } = useApproveContacts()
  const { mutate: researchApproveContacts, isPending: researching } = useResearchApproveContacts()

  const filteredContacts = contacts
    ?.filter((contact: Contact) => {
      const matchesSearch = 
        contact.email.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        contact.company.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === 'all' || contact.status === statusFilter
      return matchesSearch && matchesStatus
    })

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/10 text-green-500'
      case 'replied':
        return 'bg-blue-500/10 text-blue-500'
      case 'bounced':
        return 'bg-red-500/10 text-red-500'
      default:
        return 'bg-gray-500/10 text-gray-500'
    }
  }

  const isApproved = (contact: Contact) => contact.customFields?.send_status === 'approved'
  const customString = (contact: Contact, key: string, fallback = '') => {
    const value = contact.customFields?.[key]
    return typeof value === 'string' && value.trim() ? value.trim() : fallback
  }
  const hunterVerdict = (contact: Contact) => customString(contact, 'hunter_verdict')
  const hunterConfidence = (contact: Contact) => Number(contact.customFields?.hunter_confidence ?? contact.customFields?.research_score ?? 0)
  const hunterBounceRisk = (contact: Contact) => customString(contact, 'hunter_bounce_risk', 'unknown')
  const hunterBuyerFit = (contact: Contact) => customString(contact, 'hunter_buyer_fit', 'unknown')
  const hunterRecommendation = (contact: Contact) => customString(contact, 'hunter_recommendation', isApproved(contact) ? 'approve' : 'review')
  const hunterVerificationLabel = (contact: Contact) => customString(contact, 'hunter_verification_label', hunterVerdict(contact) === 'approved' ? 'verified' : 'unchecked')
  const sourceProofLabel = (contact: Contact) =>
    customString(contact, 'hunter_source_proof_label', customString(contact, 'email_evidence', customString(contact, 'source', contact.source || 'source')))
  const sourceProofUrl = (contact: Contact) =>
    customString(contact, 'hunter_source_proof_url', customString(contact, 'research_evidence_url', customString(contact, 'public_evidence_url')))
  const hunterMailboxQuality = (contact: Contact) => customString(contact, 'hunter_mailbox_quality', 'unknown')
  const hunterSourceStrength = (contact: Contact) => customString(contact, 'hunter_source_strength', 'unknown')
  const hunterDecisionSummary = (contact: Contact) => customString(contact, 'hunter_decision_summary')
  const hunterBlockers = (contact: Contact) => {
    const blockers = contact.customFields?.hunter_blockers
    return Array.isArray(blockers) ? blockers.map(String).filter(Boolean) : []
  }
  const canApprove = (contact: Contact) => {
    const mailboxQuality = hunterMailboxQuality(contact)
    const sourceStrength = hunterSourceStrength(contact)

    return (
      contact.status === 'active' &&
      hunterRecommendation(contact) !== 'hold' &&
      hunterBounceRisk(contact) !== 'high' &&
      mailboxQuality !== 'risky' &&
      sourceStrength !== 'weak'
    )
  }
  const getHunterBadge = (contact: Contact) => {
    const verdict = hunterVerdict(contact)
    if (isApproved(contact) || verdict === 'approved') {
      return <Badge className="bg-emerald-500/10 text-emerald-500">verified {hunterConfidence(contact) || ''}</Badge>
    }
    if (verdict === 'blocked' || contact.customFields?.send_status === 'blocked') {
      return <Badge className="bg-red-500/10 text-red-500">blocked {hunterConfidence(contact) || ''}</Badge>
    }
    if (verdict === 'review') {
      return <Badge className="bg-amber-500/10 text-amber-500">review {hunterConfidence(contact) || ''}</Badge>
    }
    return <Badge className="bg-slate-500/10 text-slate-400">unchecked</Badge>
  }
  const getRiskBadge = (risk: string) => {
    if (risk === 'low') return <Badge className="bg-emerald-500/10 text-emerald-500">low bounce risk</Badge>
    if (risk === 'medium') return <Badge className="bg-amber-500/10 text-amber-500">medium risk</Badge>
    if (risk === 'high') return <Badge className="bg-red-500/10 text-red-500">high risk</Badge>
    return <Badge className="bg-slate-500/10 text-slate-400">risk unknown</Badge>
  }
  const getMailboxBadge = (quality: string) => {
    if (quality === 'direct') return <Badge className="bg-sky-500/10 text-sky-400">direct inbox</Badge>
    if (quality === 'commercial') return <Badge className="bg-emerald-500/10 text-emerald-500">commercial inbox</Badge>
    if (quality === 'generic') return <Badge className="bg-amber-500/10 text-amber-500">generic inbox</Badge>
    if (quality === 'risky') return <Badge className="bg-red-500/10 text-red-500">risky inbox</Badge>
    return <Badge className="bg-slate-500/10 text-slate-400">mailbox unknown</Badge>
  }
  const getSourceStrengthBadge = (strength: string) => {
    if (strength === 'exact_public') return <Badge className="bg-emerald-500/10 text-emerald-500">exact public proof</Badge>
    if (strength === 'provider_validated') return <Badge className="bg-blue-500/10 text-blue-400">provider checked</Badge>
    if (strength === 'domain_matched') return <Badge className="bg-cyan-500/10 text-cyan-400">domain proof</Badge>
    if (strength === 'pattern_only') return <Badge className="bg-amber-500/10 text-amber-500">pattern only</Badge>
    if (strength === 'weak') return <Badge className="bg-red-500/10 text-red-500">weak proof</Badge>
    return <Badge className="bg-slate-500/10 text-slate-400">proof unknown</Badge>
  }
  const getRecommendationBadge = (recommendation: string) => {
    if (recommendation === 'approve') return <Badge className="bg-emerald-500/10 text-emerald-500">sendable</Badge>
    if (recommendation === 'review') return <Badge className="bg-amber-500/10 text-amber-500">review</Badge>
    if (recommendation === 'hold') return <Badge className="bg-red-500/10 text-red-500">hold</Badge>
    return <Badge className="bg-slate-500/10 text-slate-400">unchecked</Badge>
  }

  const hunterStats = (contacts ?? []).reduce(
    (acc, contact) => {
      const sourceStrength = hunterSourceStrength(contact)
      if (isApproved(contact)) acc.sendable += 1
      if (hunterRecommendation(contact) === 'review') acc.review += 1
      if (hunterRecommendation(contact) === 'hold' || hunterBounceRisk(contact) === 'high') acc.held += 1
      if (hunterConfidence(contact) >= 80 && (isApproved(contact) || hunterRecommendation(contact) === 'approve')) acc.highConfidence += 1
      if (sourceProofUrl(contact) || ['exact_public', 'provider_validated', 'domain_matched'].includes(sourceStrength)) acc.withProof += 1
      return acc
    },
    { sendable: 0, review: 0, held: 0, withProof: 0, highConfidence: 0 }
  )

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-3xl font-bold">Prospects</h1>
          <p className="text-muted-foreground">Xavira-owned approval cockpit: confidence, proof, mailbox quality, and buyer fit before sending.</p>
        </div>
        <div className="flex gap-2">
          <Button
            variant="secondary"
            onClick={() => researchApproveContacts({})}
            disabled={researching}
          >
            <ShieldCheck className="mr-2 h-4 w-4" />
            {researching ? 'Researching...' : 'Research & Approve Best'}
          </Button>
          <AddContactModal />
          <UploadContactsModal />
        </div>
      </div>

      <LeadScoutCard />

      <GoogleSheetImportCard />

      <div className="grid gap-4 md:grid-cols-4">
        <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Sendable inventory</p>
              <p className="text-2xl font-bold text-emerald-400">{hunterStats.sendable}</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-emerald-400" />
          </CardContent>
        </Card>
        <Card className="border-amber-500/20 bg-amber-500/[0.03]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Review queue</p>
              <p className="text-2xl font-bold text-amber-400">{hunterStats.review}</p>
            </div>
            <Gauge className="h-5 w-5 text-amber-400" />
          </CardContent>
        </Card>
        <Card className="border-red-500/20 bg-red-500/[0.03]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Held / high risk</p>
              <p className="text-2xl font-bold text-red-400">{hunterStats.held}</p>
            </div>
            <ShieldAlert className="h-5 w-5 text-red-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">High-confidence proof</p>
              <p className="text-2xl font-bold">{hunterStats.highConfidence}</p>
              <p className="text-xs text-muted-foreground">{hunterStats.withProof} with source proof</p>
            </div>
            <Target className="h-5 w-5 text-blue-400" />
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap">
            <div className="flex-1 min-w-64">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by email or name..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="replied">Replied</SelectItem>
                <SelectItem value="bounced">Bounced</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {/* Table */}
      <Card>
        <CardHeader>
          <CardTitle>All Prospects ({filteredContacts?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Company</TableHead>
                  <TableHead>Verification</TableHead>
                  <TableHead>Risk / Fit</TableHead>
                  <TableHead>Source Proof</TableHead>
                  <TableHead>Recommendation</TableHead>
                  <TableHead>Outreach</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(5)
                    .fill(0)
                    .map((_, i) => (
                      <TableRow key={i}>
                        {Array(9)
                          .fill(0)
                          .map((_, j) => (
                            <TableCell key={j}>
                              <Skeleton className="h-4 w-full" />
                            </TableCell>
                          ))}
                      </TableRow>
                    ))
                ) : filteredContacts && filteredContacts.length > 0 ? (
                  filteredContacts.map((contact: Contact) => (
                    <TableRow key={contact.id}>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="font-medium">{contact.email}</div>
                          <div className="text-xs text-muted-foreground">
                            {contact.name || 'No name'} · {contact.addedAt.toLocaleDateString()}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div>{contact.company || 'Unknown company'}</div>
                          <div className="text-xs text-muted-foreground">{contact.title || contact.source}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {getHunterBadge(contact)}
                            {getSourceStrengthBadge(hunterSourceStrength(contact))}
                          </div>
                          <div className="text-xs text-muted-foreground">{hunterVerificationLabel(contact)}</div>
                          {hunterBlockers(contact).length > 0 ? (
                            <div className="flex max-w-[260px] items-start gap-1 text-xs text-muted-foreground">
                              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-500" />
                              <span className="truncate" title={hunterBlockers(contact).join(', ')}>
                                {hunterBlockers(contact).slice(0, 2).join(', ')}
                              </span>
                            </div>
                          ) : null}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="space-y-1">
                          <div className="flex flex-wrap gap-1">
                            {getRiskBadge(hunterBounceRisk(contact))}
                            {getMailboxBadge(hunterMailboxQuality(contact))}
                          </div>
                          <div className="text-xs text-muted-foreground">fit: {hunterBuyerFit(contact)}</div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {sourceProofUrl(contact) ? (
                          <a
                            href={sourceProofUrl(contact)}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex max-w-[220px] items-center gap-1 text-sm text-blue-400 hover:underline"
                            title={sourceProofUrl(contact)}
                          >
                            <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">{sourceProofLabel(contact)}</span>
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">No proof yet</span>
                        )}
                      </TableCell>
                      <TableCell>
                        <div className="max-w-[280px] space-y-1">
                          {getRecommendationBadge(hunterRecommendation(contact))}
                          <div className="text-xs text-muted-foreground">
                            {hunterDecisionSummary(contact) || 'Run the research gate to generate the send/hold reason.'}
                          </div>
                        </div>
                      </TableCell>
                      <TableCell>
                        {isApproved(contact) ? (
                          <Badge className="bg-emerald-500/10 text-emerald-500">
                            approved
                          </Badge>
                        ) : !canApprove(contact) ? (
                          <Badge className="bg-red-500/10 text-red-500">
                            <XCircle className="mr-1 h-3 w-3" />
                            held
                          </Badge>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => approveContacts({ ids: [contact.id] })}
                            disabled={approving}
                          >
                            <CheckCircle2 className="mr-2 h-3.5 w-3.5" />
                            Approve
                          </Button>
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge className={getStatusColor(contact.status)}>
                          {contact.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => deleteContact(contact.id)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-8 text-muted-foreground">
                      No contacts found
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
