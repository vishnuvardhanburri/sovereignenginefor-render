'use client'

import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useQueryClient } from '@tanstack/react-query'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Search, Send, TrendingUp, AlertTriangle, Mail, Reply } from 'lucide-react'

type SentItem = {
  id: number
  type: 'sent' | 'failed' | 'bounce' | 'reply'
  createdAt: string
  campaignId: number | null
  campaignName: string | null
  queueJobId: number | null
  providerMessageId: string | null
  toEmail: string
  fromEmail: string
  subject: string
  error: string | null
  bodyText: string
  bodyHtml: string
  provider: string | null
  offerType: string | null
}

type SentSummary = {
  sentToday: number
  sent24h: number
  failed24h: number
  bounced24h: number
  replies24h: number
  replyRate24h: number
  replyTargetPct: number
  clientConversationTargetMin: number
  clientConversationTargetMax: number
  operatingSendFloor: number
  operatingSendCeiling: number
  clientGenerationStatus: 'on_track' | 'tighten_targeting' | 'building_inventory'
  deliveryConfidence24h: number
  sent7d: number
  replies7d: number
  replyRate7d: number
  agencySent24h: number
  directSent24h: number
  topFailureReason: string | null
  topProvider: string | null
}

type ApiResponse = {
  ok: boolean
  summary?: SentSummary
  items: SentItem[]
}

type CopyPreviewItem = {
  label: string
  offerType: 'direct' | 'agency'
  dealValueUsd: number
  dealValueGbp?: number
  dealValueLabel?: string
  company: string
  subject: string
  text: string
  html: string
  source: 'template' | 'xavira_ai'
  error: string | null
}

type CopyPreviewResponse = {
  ok: boolean
  generatedAt: string
  aiPreview: boolean
  aiPersonalizationConfigured: boolean
  retentionPolicy: string
  previews: CopyPreviewItem[]
}

function statusBadge(type: SentItem['type']) {
  if (type === 'sent') return <Badge className="bg-green-500/10 text-green-500">Sent</Badge>
  if (type === 'reply') return <Badge className="bg-blue-500/10 text-blue-500">Reply</Badge>
  if (type === 'bounce') return <Badge className="bg-red-500/10 text-red-500">Bounced</Badge>
  return <Badge className="bg-amber-500/10 text-amber-500">Failed</Badge>
}

function offerBadge(offerType: string | null) {
  if (!offerType) return null
  if (offerType === 'agency')
    return <Badge className="bg-purple-500/10 text-purple-400 text-xs">£160,000 White-label</Badge>
  return <Badge className="bg-blue-500/10 text-blue-400 text-xs">£40,000 Internal</Badge>
}

function StatCard({
  icon,
  label,
  value,
  sub,
  accent,
}: {
  icon: React.ReactNode
  label: string
  value: string | number
  sub?: string
  accent?: 'green' | 'red' | 'amber' | 'purple' | 'blue'
}) {
  const accentClass = {
    green: 'text-green-400',
    red: 'text-red-400',
    amber: 'text-amber-400',
    purple: 'text-purple-400',
    blue: 'text-blue-400',
  }[accent ?? 'blue']

  return (
    <Card>
      <CardContent className="pt-5 pb-4">
        <div className="flex min-w-0 items-start gap-3">
          <div className={`mt-0.5 ${accentClass}`}>{icon}</div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`break-words text-2xl font-bold ${accentClass}`}>{value}</p>
            {sub && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{sub}</p>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function SentMailPage() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [selected, setSelected] = useState<SentItem | null>(null)
  const [bodyOpen, setBodyOpen] = useState(false)
  const [clearing, setClearing] = useState<'failed' | 'test' | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard', 'sent', 200],
    queryFn: async () => {
      const res = await fetch('/api/dashboard/sent?limit=200')
      if (!res.ok) throw new Error('failed')
      return (await res.json()) as ApiResponse
    },
    refetchInterval: 10_000,
  })

  const { data: copyPreview, isLoading: copyPreviewLoading } = useQuery({
    queryKey: ['outbound', 'copy-preview', 'template'],
    queryFn: async () => {
      const res = await fetch('/api/outbound/copy-preview')
      if (!res.ok) throw new Error('failed')
      return (await res.json()) as CopyPreviewResponse
    },
    staleTime: 60_000,
  })

  async function clear(kind: 'failed' | 'test') {
    setClearing(kind)
    try {
      const res = await fetch(`/api/dashboard/sent?kind=${kind}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('failed')
      if (kind === 'failed') {
        const queueRes = await fetch('/api/queue?status=failed&limit=1000', { method: 'DELETE' })
        if (!queueRes.ok) throw new Error('queue_clear_failed')
      }
      await queryClient.invalidateQueries({ queryKey: ['dashboard', 'sent', 200] })
      await queryClient.invalidateQueries({ queryKey: ['enterprise-health-alerts'] })
    } finally {
      setClearing(null)
    }
  }

  const items = useMemo(() => {
    const raw = data?.items ?? []
    const needle = q.trim().toLowerCase()
    if (!needle) return raw
    return raw.filter((x) => {
      return (
        x.toEmail.toLowerCase().includes(needle) ||
        x.fromEmail.toLowerCase().includes(needle) ||
        x.subject.toLowerCase().includes(needle) ||
        (x.campaignName ?? '').toLowerCase().includes(needle) ||
        (x.provider ?? '').toLowerCase().includes(needle) ||
        (x.error ?? '').toLowerCase().includes(needle) ||
        x.type.toLowerCase().includes(needle) ||
        (x.bodyText ?? '').toLowerCase().includes(needle)
      )
    })
  }, [data, q])

  const s = data?.summary

  return (
    <div className="min-w-0 space-y-6">
      <div className="min-w-0">
        <h1 className="text-3xl font-bold">Sent Mail</h1>
        <p className="max-w-3xl text-muted-foreground">
          Client-generation proof — qualified conversations, 50/50 offer mix, and delivery health
        </p>
      </div>

      {/* BI Summary Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array(8).fill(0).map((_, i) => (
            <Card key={i}><CardContent className="pt-5"><Skeleton className="h-10 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : s ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
          <StatCard
            icon={<Send className="w-4 h-4" />}
            label="Sent today"
            value={s.sentToday}
            sub={`${s.sent24h} in last 24h · operating range ${s.operatingSendFloor}-${s.operatingSendCeiling}`}
            accent="green"
          />
          <StatCard
            icon={<Reply className="w-4 h-4" />}
            label="Qualified conversations (24h)"
            value={`${s.replyRate24h.toFixed(1)}%`}
            sub={`${s.replies24h} replies / ${s.sent24h} sent`}
            accent="blue"
          />
          <StatCard
            icon={<TrendingUp className="w-4 h-4" />}
            label="Client conversation target"
            value={`${s.clientConversationTargetMin}-${s.clientConversationTargetMax}/day`}
            sub={
              s.clientGenerationStatus === 'on_track'
                ? 'On track: real client conversations'
                : s.clientGenerationStatus === 'tighten_targeting'
                  ? 'Volume hit; tighten buyer fit and copy'
                  : 'Build buyer-fit inventory before scaling'
            }
            accent="purple"
          />
          <StatCard
            icon={<AlertTriangle className="w-4 h-4" />}
            label="Delivery confidence"
            value={`${s.deliveryConfidence24h.toFixed(1)}%`}
            sub={`${s.failed24h} failed · ${s.bounced24h} bounced`}
            accent={s.deliveryConfidence24h >= 95 ? 'green' : s.deliveryConfidence24h >= 80 ? 'amber' : 'red'}
          />
          <StatCard
            icon={<Mail className="w-4 h-4" />}
            label="Agency £160,000 (24h)"
            value={s.agencySent24h}
            sub="White-label Commercial License · 50% target"
            accent="purple"
          />
          <StatCard
            icon={<Mail className="w-4 h-4" />}
            label="Direct £40,000 (24h)"
            value={s.directSent24h}
            sub="Xavira Control Stack · 50% target"
            accent="blue"
          />
          <StatCard
            icon={<Send className="w-4 h-4" />}
            label="Top provider"
            value={s.topProvider ?? '—'}
            accent="green"
          />
            <StatCard
              icon={<AlertTriangle className="w-4 h-4" />}
              label="Top failure reason"
              value={s.topFailureReason ? s.topFailureReason.slice(0, 28) : '—'}
              sub={s.topFailureReason && s.topFailureReason.length > 28 ? s.topFailureReason : undefined}
              accent="amber"
            />
        </div>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Mail className="w-5 h-5" />
            How the system is mailing now
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Operator preview of the current client-generation copy. Recent sent bodies are visible
            for proof, then redacted by retention after the review window.
          </p>
        </CardHeader>
        <CardContent>
          {copyPreviewLoading ? (
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              <Skeleton className="h-72 w-full" />
              <Skeleton className="h-72 w-full" />
            </div>
          ) : copyPreview?.previews?.length ? (
            <div className="grid min-w-0 gap-3 xl:grid-cols-2">
              {copyPreview.previews.map((preview) => (
                <div key={preview.offerType} className="min-w-0 space-y-3 rounded-lg border bg-muted/20 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        {offerBadge(preview.offerType)}
                        <Badge variant="outline" className="text-xs">
                          {preview.source === 'template'
                            ? 'Base template'
                            : 'AI generated'}
                        </Badge>
                      </div>
                      <p className="mt-2 text-sm font-medium">{preview.label}</p>
                      <p className="text-xs text-muted-foreground">
                        Sample company: {preview.company}
                      </p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold">
                      {preview.dealValueLabel ?? `£${(preview.dealValueGbp ?? preview.dealValueUsd).toLocaleString()}`}
                    </p>
                  </div>
                  <div className="rounded-md border bg-background/60 p-3">
                    <p className="text-xs text-muted-foreground">Subject</p>
                    <p className="text-sm font-medium">{preview.subject}</p>
                  </div>
                  <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md border bg-background/60 p-3 text-xs leading-relaxed">
                    {preview.text}
                  </pre>
                  {preview.html ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        HTML email preview with booking button
                      </p>
                      <iframe
                        title={`${preview.offerType} email preview`}
                        sandbox=""
                        srcDoc={preview.html}
                        className="h-72 w-full rounded-md border bg-white"
                      />
                    </div>
                  ) : null}
                  {preview.error ? (
                    <p className="text-xs text-amber-500">
                      AI preview fallback: {preview.error}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Copy preview is unavailable right now. Sending can still continue from queued jobs.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-center gap-4">
            <div className="min-w-0 flex-1 basis-72">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by to/from/subject/campaign/provider/error..."
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-8"
                />
              </div>
            </div>
            <div className="flex gap-2 items-center">
              <Button
                variant="secondary"
                disabled={clearing !== null}
                onClick={() => clear('failed')}
              >
                {clearing === 'failed' ? 'Clearing…' : 'Clear failed'}
              </Button>
              <Button
                variant="secondary"
                disabled={clearing !== null}
                onClick={() => clear('test')}
              >
                {clearing === 'test' ? 'Clearing…' : 'Clear tests'}
              </Button>
            </div>
            <div className="text-xs text-muted-foreground">
              Auto-refresh every 10s
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Send className="w-5 h-5" />
            Events ({items.length})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>To</TableHead>
                  <TableHead>From</TableHead>
                  <TableHead>Subject</TableHead>
                  <TableHead>Offer</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Proof</TableHead>
                  <TableHead>Campaign</TableHead>
                  <TableHead className="text-right">Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array(8)
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
                ) : items.length ? (
                  items.map((x) => {
                    const dt = new Date(x.createdAt)
                    return (
                      <TableRow key={x.id} className="align-middle">
                        <TableCell className="whitespace-nowrap">
                          {statusBadge(x.type)}
                          {x.error && x.type !== 'sent' ? (
                            <p className="text-xs text-muted-foreground mt-0.5 max-w-[160px] truncate" title={x.error}>{x.error}</p>
                          ) : null}
                        </TableCell>
                        <TableCell className="font-medium whitespace-nowrap">{x.toEmail || '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{x.fromEmail || '-'}</TableCell>
                        <TableCell className="max-w-[320px] truncate">{x.subject || '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">{offerBadge(x.offerType)}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{x.provider || '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setSelected(x)
                              setBodyOpen(true)
                            }}
                          >
                            Proof
                          </Button>
                        </TableCell>
                        <TableCell className="max-w-[180px] truncate text-sm text-muted-foreground">
                          {x.campaignName ?? (x.campaignId ? `Campaign #${x.campaignId}` : '-')}
                        </TableCell>
                        <TableCell className="text-right whitespace-nowrap text-sm">
                          {Number.isFinite(dt.getTime()) ? dt.toLocaleString() : x.createdAt}
                        </TableCell>
                      </TableRow>
                    )
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      No sent events yet. Run `pnpm send:test` or activate a campaign.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      <Dialog open={bodyOpen} onOpenChange={setBodyOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Delivery proof</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">To:</span> {selected.toEmail || '-'}</div>
                <div><span className="text-muted-foreground">From:</span> {selected.fromEmail || '-'}</div>
                <div className="truncate"><span className="text-muted-foreground">Subject:</span> {selected.subject || '-'}</div>
                <div><span className="text-muted-foreground">Status:</span> {selected.type}</div>
                <div><span className="text-muted-foreground">Time:</span> {new Date(selected.createdAt).toLocaleString()}</div>
                {selected.provider ? (
                  <div><span className="text-muted-foreground">Provider:</span> {selected.provider}</div>
                ) : null}
                {selected.offerType ? (
                  <div><span className="text-muted-foreground">Offer:</span> {selected.offerType === 'agency' ? '£160,000 White-Label Commercial License' : '£40,000 Internal Enterprise License'}</div>
                ) : null}
                {selected.error ? (
                  <div className="text-amber-600 break-words"><span className="text-muted-foreground">Error:</span> {selected.error}</div>
                ) : null}
              </div>
              {selected.bodyText?.trim() || selected.bodyHtml?.trim() ? (
                <div className="space-y-3">
                  {selected.bodyHtml?.trim() ? (
                    <div className="space-y-2">
                      <p className="text-xs font-medium text-muted-foreground">
                        Rendered email structure
                      </p>
                      <iframe
                        title="Rendered sent email"
                        sandbox=""
                        srcDoc={selected.bodyHtml}
                        className="h-96 w-full rounded-md border bg-white"
                      />
                    </div>
                  ) : null}
                  <div className="space-y-2">
                    <p className="text-xs font-medium text-muted-foreground">
                      Plain-text fallback
                    </p>
                    <pre className="whitespace-pre-wrap text-sm bg-muted/40 border rounded-md p-3">
                      {selected.bodyText?.trim() ? selected.bodyText : selected.bodyHtml}
                    </pre>
                  </div>
                </div>
              ) : (
                <div className="text-sm bg-muted/40 border rounded-md p-3 space-y-2">
                  <p className="font-medium">
                    {selected.type === 'reply' ? 'Reply body unavailable' : 'Message body no longer retained'}
                  </p>
                  <p className="text-muted-foreground">
                    This older event keeps delivery proof only. Full email bodies are redacted after
                    the operational review window so storage stays clean.
                  </p>
                </div>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
