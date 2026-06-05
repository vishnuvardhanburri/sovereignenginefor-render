'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Copy,
  ExternalLink,
  Linkedin,
  Mail,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Target,
} from 'lucide-react'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'

type OfferType = 'agency' | 'direct'
type OfferFilter = 'all' | OfferType
type OfferMode = 'auto' | OfferType

type LinkedInDeskAccount = {
  id: number
  email: string
  name: string
  firstName: string
  company: string
  title: string
  source: string
  status: string
  offerType: OfferType
  offerLabel: string
  dealValueGbp: number
  closeScore: number
  linkedinUrl: string
  websiteUrl: string
  evidenceUrl: string
  dmStatus: string
  lastDmDate: string
  dmText: string
  followUpText: string
  emailSubject: string
  emailText: string
  reason: string
}

type LinkedInDeskSummary = {
  dailyTarget: number
  minimumDailyTarget: number
  queueCount: number
  shortfall: number
  agencyCount: number
  directCount: number
  availableCount: number
  topMotion: 'white_label_first' | 'internal_first' | 'balanced'
  topMotionLabel: string
}

type LinkedInDeskResponse = {
  queue: LinkedInDeskAccount[]
  summary: LinkedInDeskSummary
}

type ScrapeResult = {
  email: string
  domain: string
  company: string
  sourceUrl: string
  linkedinUrl: string
  offerType: OfferType
  confidence: 'high' | 'medium' | 'low'
  contactRole: string
  evidenceSummary: string
  publicSignals: string[]
  phoneNumbers: string[]
  discoveredPages: number
}

type ScrapeResponse = {
  targets: Array<{ raw: string; websiteUrl: string; linkedinUrl: string; company: string; domain: string }>
  found: ScrapeResult[]
  rejected: Array<{ raw: string; reason: string }>
  imported: number
  importFound: boolean
}

const EMPTY_QUEUE: LinkedInDeskAccount[] = []

async function fetchLinkedInDesk(): Promise<LinkedInDeskResponse> {
  const response = await fetch('/api/linkedin-desk', { cache: 'no-store' })
  if (!response.ok) throw new Error('Failed to load LinkedIn DM desk')
  return response.json()
}

function offerBadgeClass(offerType: OfferType): string {
  return offerType === 'agency'
    ? 'bg-purple-500/10 text-purple-400 border-purple-500/20'
    : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
}

function money(value: number): string {
  return new Intl.NumberFormat('en-GB', {
    style: 'currency',
    currency: 'GBP',
    maximumFractionDigits: 0,
  }).format(value)
}

function shortUrl(value: string): string {
  if (!value) return ''
  try {
    const url = new URL(value)
    return url.hostname.replace(/^www\./, '')
  } catch {
    return value
  }
}

export default function LinkedInDeskPage() {
  const [searchTerm, setSearchTerm] = useState('')
  const [offerFilter, setOfferFilter] = useState<OfferFilter>('all')
  const [selectedId, setSelectedId] = useState<number | null>(null)
  const [targets, setTargets] = useState('')
  const [offerMode, setOfferMode] = useState<OfferMode>('auto')
  const [importFound, setImportFound] = useState(true)
  const [isScraping, setIsScraping] = useState(false)
  const [scrapeResult, setScrapeResult] = useState<ScrapeResponse | null>(null)
  const [isMarking, setIsMarking] = useState(false)

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['linkedin-desk'],
    queryFn: fetchLinkedInDesk,
  })

  const queue = data?.queue ?? EMPTY_QUEUE
  const summary = data?.summary

  const filteredQueue = useMemo(() => {
    const term = searchTerm.trim().toLowerCase()
    return queue.filter((lead) => {
      const matchesOffer = offerFilter === 'all' || lead.offerType === offerFilter
      if (!matchesOffer) return false
      if (!term) return true
      return [lead.company, lead.name, lead.email, lead.title, lead.reason]
        .join(' ')
        .toLowerCase()
        .includes(term)
    })
  }, [queue, searchTerm, offerFilter])

  const selectedLead =
    filteredQueue.find((lead) => lead.id === selectedId) ??
    filteredQueue[0] ??
    queue[0] ??
    null

  const completion = summary ? Math.min(100, Math.round((summary.queueCount / summary.dailyTarget) * 100)) : 0

  const copyText = async (label: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success(`${label} copied`)
    } catch {
      toast.error(`Failed to copy ${label.toLowerCase()}`)
    }
  }

  const markAction = async (action: 'dm_sent' | 'interested' | 'skipped' | 'blocked') => {
    if (!selectedLead) return
    setIsMarking(true)
    try {
      const response = await fetch('/api/linkedin-desk', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ contactId: selectedLead.id, action }),
      })
      if (!response.ok) throw new Error('Action failed')
      toast.success(action === 'dm_sent' ? 'DM marked sent' : 'Client account updated')
      await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to update client account')
    } finally {
      setIsMarking(false)
    }
  }

  const scrapeEmails = async () => {
    if (!targets.trim()) {
      toast.error('Paste company websites first')
      return
    }
    setIsScraping(true)
    try {
      const response = await fetch('/api/linkedin-desk/scrape-emails', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ targets, offerMode, importFound }),
      })
      if (!response.ok) throw new Error('Public email scrape failed')
      const next: ScrapeResponse = await response.json()
      setScrapeResult(next)
      toast.success(`Found ${next.found.length} emails${next.imported ? `, imported ${next.imported}` : ''}`)
      if (next.imported) await refetch()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to scrape public emails')
    } finally {
      setIsScraping(false)
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold">LinkedIn DM Desk</h1>
          <p className="text-muted-foreground">
            Daily 34-client Tier-1 100-score account queue for Xavira Control Stack: one-hour personalization, exact LinkedIn account DM, email fallback, and public email discovery.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            <RefreshCw className={isFetching ? 'animate-spin' : ''} />
            Refresh
          </Button>
          <Button asChild>
            <a href="https://sovereignenginefor-render-d80m.onrender.com/book" target="_blank" rel="noreferrer">
              <Target />
              Booking Page
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Card className="border-emerald-500/20 bg-emerald-500/[0.03]">
          <CardContent className="p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm text-muted-foreground">Today 100-score clients</p>
                <p className="text-2xl font-bold text-emerald-400">
                  {summary?.queueCount ?? 0}/{summary?.dailyTarget ?? 34}
                </p>
              </div>
              <Send className="h-5 w-5 text-emerald-400" />
            </div>
            <Progress className="mt-4" value={completion} />
          </CardContent>
        </Card>
        <Card className="border-purple-500/20 bg-purple-500/[0.03]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">White-label clients</p>
              <p className="text-2xl font-bold text-purple-400">{summary?.agencyCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">£160,000 license motion</p>
            </div>
            <Sparkles className="h-5 w-5 text-purple-400" />
          </CardContent>
        </Card>
        <Card className="border-blue-500/20 bg-blue-500/[0.03]">
          <CardContent className="flex items-center justify-between p-5">
            <div>
              <p className="text-sm text-muted-foreground">Internal clients</p>
              <p className="text-2xl font-bold text-blue-400">{summary?.directCount ?? 0}</p>
              <p className="text-xs text-muted-foreground">£40,000 license motion</p>
            </div>
            <ShieldCheck className="h-5 w-5 text-blue-400" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-muted-foreground">Close priority</p>
            <p className="mt-2 text-lg font-semibold leading-tight">{summary?.topMotionLabel ?? 'Loading close motion'}</p>
              <p className="mt-1 text-xs text-muted-foreground">
              1 hour/client research mode - {summary?.availableCount ?? 0} exact LinkedIn accounts before today exclusions
            </p>
          </CardContent>
        </Card>
      </div>

      {summary && summary.shortfall > 0 ? (
        <Alert className="border-amber-500/30 bg-amber-500/[0.04]">
          <Target className="h-4 w-4 text-amber-400" />
          <AlertTitle>Queue shortfall: {summary.shortfall} more exact LinkedIn client accounts needed</AlertTitle>
          <AlertDescription>
            Add Tier-1 client accounts with exact LinkedIn URLs until the daily research queue reaches {summary.minimumDailyTarget} high-score accounts.
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-col gap-4 lg:flex-row">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search client account, person, email, title..."
                value={searchTerm}
                onChange={(event) => setSearchTerm(event.target.value)}
              />
            </div>
            <Select value={offerFilter} onValueChange={(value) => setOfferFilter(value as OfferFilter)}>
              <SelectTrigger className="w-full lg:w-56">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All client motions</SelectItem>
                <SelectItem value="agency">£160k white-label</SelectItem>
                <SelectItem value="direct">£40k internal</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-6 xl:grid-cols-[minmax(360px,0.9fr)_minmax(0,1.1fr)]">
        <Card>
          <CardHeader>
            <CardTitle>Ranked 100-score client queue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {isLoading ? (
              Array.from({ length: 6 }).map((_, index) => <Skeleton key={index} className="h-20 w-full rounded-md" />)
            ) : filteredQueue.length > 0 ? (
              filteredQueue.map((lead, index) => (
                <button
                  key={lead.id}
                  type="button"
                  onClick={() => setSelectedId(lead.id)}
                  className={`w-full rounded-md border p-4 text-left transition-colors hover:bg-accent ${
                    selectedLead?.id === lead.id ? 'border-primary bg-primary/5' : 'border-border bg-background'
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm text-muted-foreground">#{index + 1}</span>
                        <p className="truncate font-semibold">{lead.company || lead.email}</p>
                      </div>
                      <p className="mt-1 truncate text-sm text-muted-foreground">
                        {lead.name || 'Unknown person'} {lead.title ? `- ${lead.title}` : ''}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold">{lead.closeScore}</p>
                      <p className="text-xs text-muted-foreground">/100</p>
                    </div>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2">
                    <Badge className={offerBadgeClass(lead.offerType)}>{lead.offerLabel}</Badge>
                    <Badge variant="outline">{money(lead.dealValueGbp)}</Badge>
                    <Badge variant="outline">exact LinkedIn</Badge>
                    {lead.websiteUrl ? <Badge variant="outline">{shortUrl(lead.websiteUrl)}</Badge> : null}
                  </div>
                </button>
              ))
            ) : (
              <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                No exact LinkedIn client accounts match this filter.
              </div>
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Selected close action</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {selectedLead ? (
                <>
                  <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-2xl font-semibold">{selectedLead.company || selectedLead.email}</h2>
                        <Badge className={offerBadgeClass(selectedLead.offerType)}>{selectedLead.offerLabel}</Badge>
                      </div>
                      <p className="mt-1 text-sm text-muted-foreground">
                        {selectedLead.name || 'Unknown person'} {selectedLead.title ? `- ${selectedLead.title}` : ''} - {selectedLead.email}
                      </p>
                    </div>
                    <div className="rounded-md border px-4 py-3 text-center">
                      <p className="text-2xl font-bold">{selectedLead.closeScore}</p>
                      <p className="text-xs text-muted-foreground">client score /100</p>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <Button asChild variant="outline">
                      <a
                        href={selectedLead.linkedinUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Linkedin />
                        Open Exact LinkedIn
                        <ExternalLink />
                      </a>
                    </Button>
                    <Button variant="outline" onClick={() => copyText('LinkedIn DM', selectedLead.dmText)}>
                      <Copy />
                      Copy DM
                    </Button>
                    <Button variant="outline" onClick={() => copyText('Follow-up', selectedLead.followUpText)}>
                      <Copy />
                      Copy Follow-up
                    </Button>
                    <Button
                      variant="outline"
                      onClick={() =>
                        copyText('Email', `Subject: ${selectedLead.emailSubject}\n\n${selectedLead.emailText}`)
                      }
                    >
                      <Mail />
                      Copy Email
                    </Button>
                  </div>

                  <div className="grid gap-3 md:grid-cols-4">
                    <Button onClick={() => markAction('dm_sent')} disabled={isMarking}>
                      <CheckCircle2 />
                      Mark Sent
                    </Button>
                    <Button variant="secondary" onClick={() => markAction('interested')} disabled={isMarking}>
                      Interested
                    </Button>
                    <Button variant="outline" onClick={() => markAction('skipped')} disabled={isMarking}>
                      Skip
                    </Button>
                    <Button variant="outline" onClick={() => markAction('blocked')} disabled={isMarking}>
                      Block
                    </Button>
                  </div>

                  <div className="grid gap-4 lg:grid-cols-2">
                    <div className="space-y-2">
                      <Label>LinkedIn DM text</Label>
                      <Textarea className="min-h-48 font-mono text-sm" readOnly value={selectedLead.dmText} />
                    </div>
                    <div className="space-y-2">
                      <Label>Email fallback</Label>
                      <Textarea
                        className="min-h-48 font-mono text-sm"
                        readOnly
                        value={`Subject: ${selectedLead.emailSubject}\n\n${selectedLead.emailText}`}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 text-sm md:grid-cols-2">
                    <div className="rounded-md border p-4">
                      <p className="font-medium">Why this client account</p>
                      <p className="mt-2 text-muted-foreground">{selectedLead.reason}</p>
                    </div>
                    <div className="rounded-md border p-4">
                      <p className="font-medium">Evidence</p>
                      <div className="mt-2 space-y-1 text-muted-foreground">
                        <p>Status: {selectedLead.dmStatus}</p>
                        <p>Website: {selectedLead.websiteUrl ? shortUrl(selectedLead.websiteUrl) : 'Not attached'}</p>
                        <p>Source: {selectedLead.evidenceUrl ? shortUrl(selectedLead.evidenceUrl) : selectedLead.source || 'Contact record'}</p>
                      </div>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-md border border-dashed p-8 text-center text-sm text-muted-foreground">
                  Add Tier-1 client accounts with exact LinkedIn URLs to create today&apos;s manual close queue.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Public email scraper</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Textarea
                className="min-h-32 font-mono text-sm"
                placeholder="Paste one Tier-1 client account per line: exact LinkedIn /in or /company URL plus public company website. The scraper checks public contact/about/team/sales/sitemap pages only."
                value={targets}
                onChange={(event) => setTargets(event.target.value)}
              />
              <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-end">
                <div className="grid gap-2">
                  <Label>Offer tagging</Label>
                  <Select value={offerMode} onValueChange={(value) => setOfferMode(value as OfferMode)}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">Auto score each company</SelectItem>
                      <SelectItem value="agency">Force £160k white-label</SelectItem>
                      <SelectItem value="direct">Force £40k internal</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-center gap-3 rounded-md border px-4 py-2.5">
                  <Switch checked={importFound} onCheckedChange={setImportFound} />
                  <Label className="text-sm">Import found emails</Label>
                </div>
              </div>
              <Button onClick={scrapeEmails} disabled={isScraping} className="w-full md:w-auto">
                <Search className={isScraping ? 'animate-spin' : ''} />
                {isScraping ? 'Scraping public sites...' : 'Scrape public emails'}
              </Button>

              {scrapeResult ? (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-2">
                    <Badge variant="outline">{scrapeResult.targets.length} client accounts scanned</Badge>
                    <Badge variant="outline">{scrapeResult.found.length} emails found</Badge>
                    <Badge variant="outline">{scrapeResult.imported} imported</Badge>
                    {scrapeResult.rejected.length ? <Badge variant="outline">{scrapeResult.rejected.length} rejected</Badge> : null}
                  </div>
                  <div className="max-h-72 overflow-y-auto rounded-md border">
                    {scrapeResult.found.length > 0 ? (
                      scrapeResult.found.map((result) => (
                        <div key={`${result.email}-${result.sourceUrl}`} className="flex flex-col gap-2 border-b p-3 last:border-b-0 md:flex-row md:items-start md:justify-between">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{result.email}</p>
                            <p className="truncate text-xs text-muted-foreground">
                              {result.company} - {result.contactRole} - {shortUrl(result.sourceUrl)}
                            </p>
                            <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{result.evidenceSummary}</p>
                          </div>
                          <div className="flex flex-wrap gap-2 md:justify-end">
                            <Badge className={offerBadgeClass(result.offerType)}>
                              {result.offerType === 'agency' ? '£160k white-label' : '£40k internal'}
                            </Badge>
                            <Badge variant="outline">{result.confidence}</Badge>
                            <Badge variant="outline">{result.discoveredPages} pages</Badge>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="p-6 text-center text-sm text-muted-foreground">No public emails found in this scrape.</div>
                    )}
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  )
}
