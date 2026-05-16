'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Sheet, ShieldCheck } from 'lucide-react'

type SheetImportResult = {
  ok: boolean
  dryRun: boolean
  imported: number
  prepared: number
  summary: {
    rows: number
    valid: number
    rejected: number
    evidenceBacked: number
  }
  rejected: Array<{ row: number; email: string; reason: string }>
  error?: string
  detail?: string
}

async function runSheetImport(input: {
  sheetUrl: string
  dryRun: boolean
  dedupeByDomain: boolean
  limit: number
}): Promise<SheetImportResult> {
  const endpoint = '/api/contacts/import/google-sheet'
  if (input.dryRun) {
    const params = new URLSearchParams({
      sheetUrl: input.sheetUrl,
      limit: String(input.limit),
      dedupeByDomain: String(input.dedupeByDomain),
    })
    const response = await fetch(`${endpoint}?${params.toString()}`)
    const json = await response.json()
    if (!response.ok || !json?.ok) throw new Error(json?.detail || json?.error || 'Sheet preview failed')
    return json
  }

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sheetUrl: input.sheetUrl,
      limit: input.limit,
      dedupeByDomain: input.dedupeByDomain,
    }),
  })
  const json = await response.json()
  if (!response.ok || !json?.ok) throw new Error(json?.detail || json?.error || 'Sheet import failed')
  return json
}

export function GoogleSheetImportCard() {
  const queryClient = useQueryClient()
  const [sheetUrl, setSheetUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [dedupeByDomain, setDedupeByDomain] = useState(true)
  const [result, setResult] = useState<SheetImportResult | null>(null)

  const submit = async (dryRun: boolean) => {
    if (!sheetUrl.trim()) {
      toast.error('Paste your Google Sheet link first')
      return
    }

    setLoading(true)
    try {
      const next = await runSheetImport({
        sheetUrl,
        dryRun,
        dedupeByDomain,
        limit: 100,
      })
      setResult(next)
      if (dryRun) {
        toast.success(`Preview ready: ${next.summary.valid} usable, ${next.summary.rejected} rejected`)
      } else {
        await queryClient.invalidateQueries({ queryKey: ['contacts'] })
        toast.success(`Imported ${next.imported} sheet leads for review`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Google Sheet import failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-emerald-500/20 bg-emerald-500/5">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sheet className="h-5 w-5 text-emerald-400" />
              Google Sheet Lead Intake
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Paste your own Google Sheet link. Sovereign filters risky inboxes, removes duplicates,
              and imports only review-ready leads. Nothing is sent until you approve.
            </p>
          </div>
          <Badge className="w-fit bg-emerald-500/10 text-emerald-300">
            <ShieldCheck className="mr-1 h-3 w-3" />
            Review before sending
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-col gap-3 lg:flex-row">
          <Input
            value={sheetUrl}
            onChange={(event) => setSheetUrl(event.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/.../edit?usp=sharing"
            disabled={loading}
            className="min-w-0 flex-1"
          />
          <Button type="button" variant="outline" disabled={loading} onClick={() => setDedupeByDomain((value) => !value)}>
            {dedupeByDomain ? '1/domain: on' : '1/domain: off'}
          </Button>
          <Button type="button" variant="outline" disabled={loading} onClick={() => submit(true)}>
            Preview
          </Button>
          <Button type="button" disabled={loading} onClick={() => submit(false)}>
            Import Sheet
          </Button>
        </div>

        {result ? (
          <div className="rounded-lg border bg-background/70 p-3 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="secondary">{result.summary.rows} rows</Badge>
              <Badge className="bg-emerald-500/10 text-emerald-400">{result.summary.valid} usable</Badge>
              <Badge className="bg-cyan-500/10 text-cyan-300">{result.summary.evidenceBacked} evidence-backed</Badge>
              <Badge className="bg-amber-500/10 text-amber-300">{result.summary.rejected} filtered</Badge>
              {!result.dryRun ? <Badge variant="secondary">{result.imported} imported</Badge> : null}
            </div>
            {result.rejected.length > 0 ? (
              <p className="mt-2 text-xs text-muted-foreground">
                Top filtered rows: {result.rejected.slice(0, 5).map((item) => `row ${item.row} ${item.reason}`).join(', ')}
              </p>
            ) : null}
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
