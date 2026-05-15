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
import { Search, Send } from 'lucide-react'

type SentItem = {
  id: number
  type: 'sent' | 'failed' | 'bounce'
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
}

function statusBadge(type: SentItem['type']) {
  if (type === 'sent') return <Badge className="bg-green-500/10 text-green-500">Sent</Badge>
  if (type === 'bounce') return <Badge className="bg-red-500/10 text-red-500">Bounced</Badge>
  return <Badge className="bg-amber-500/10 text-amber-500">Failed</Badge>
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
      return (await res.json()) as { ok: boolean; items: SentItem[] }
    },
    refetchInterval: 10_000,
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
        (x.campaignName ?? '').toLowerCase().includes(needle)
      )
    })
  }, [data, q])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Sent Mail</h1>
        <p className="text-muted-foreground">Proof of what was actually sent (or blocked)</p>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="flex gap-4 flex-wrap items-center">
            <div className="flex-1 min-w-72">
              <div className="relative">
                <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by to/from/subject/campaign..."
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
                  <TableHead>Body</TableHead>
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
                        {Array(7)
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
                    const hasBody = Boolean((x.bodyText || '').trim() || (x.bodyHtml || '').trim())
                    return (
                      <TableRow key={x.id} className="align-middle">
                        <TableCell className="whitespace-nowrap">{statusBadge(x.type)}</TableCell>
                        <TableCell className="font-medium whitespace-nowrap">{x.toEmail || '-'}</TableCell>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">{x.fromEmail || '-'}</TableCell>
                        <TableCell className="max-w-[420px] truncate">{x.subject || '-'}</TableCell>
                        <TableCell className="whitespace-nowrap">
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={!hasBody}
                            onClick={() => {
                              setSelected(x)
                              setBodyOpen(true)
                            }}
                          >
                            View
                          </Button>
                        </TableCell>
                        <TableCell className="max-w-[220px] truncate text-sm text-muted-foreground">
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
                    <TableCell colSpan={7} className="text-center py-10 text-muted-foreground">
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
            <DialogTitle>Email body</DialogTitle>
          </DialogHeader>
          {selected ? (
            <div className="space-y-3">
              <div className="text-sm">
                <div><span className="text-muted-foreground">To:</span> {selected.toEmail || '-'}</div>
                <div><span className="text-muted-foreground">From:</span> {selected.fromEmail || '-'}</div>
                <div className="truncate"><span className="text-muted-foreground">Subject:</span> {selected.subject || '-'}</div>
                {selected.error ? (
                  <div className="text-amber-600 break-words"><span className="text-muted-foreground">Error:</span> {selected.error}</div>
                ) : null}
              </div>
              <pre className="whitespace-pre-wrap text-sm bg-muted/40 border rounded-md p-3">
                {selected.bodyText?.trim()
                  ? selected.bodyText
                  : selected.bodyHtml?.trim()
                    ? selected.bodyHtml
                    : 'No body captured for this event.'}
              </pre>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  )
}
