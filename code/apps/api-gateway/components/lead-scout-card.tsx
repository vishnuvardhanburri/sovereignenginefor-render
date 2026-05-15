'use client'

import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Search, ShieldCheck, Sparkles } from 'lucide-react'

interface ScoutLead {
  email: string
  company: string
  companyDomain: string
  fitScore: number
  reason: string
  confidence: 'high' | 'medium' | 'low'
}

interface ScoutResponse {
  ok: boolean
  industry: string
  persona: string
  region: string
  imported: number
  leads: ScoutLead[]
  guardrails: string[]
  error?: string
}

async function runScout(input: {
  industry: string
  persona: string
  region: string
  limit: number
  importContacts: boolean
}): Promise<ScoutResponse> {
  const response = await fetch('/api/leads/scout', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const json = await response.json()
  if (!response.ok || !json?.ok) {
    throw new Error(json?.error || `Lead scout failed (${response.status})`)
  }
  return json
}

export function LeadScoutCard() {
  const queryClient = useQueryClient()
  const [industry, setIndustry] = useState('saas')
  const [persona, setPersona] = useState('founder')
  const [region, setRegion] = useState('global')
  const [limit, setLimit] = useState(25)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<ScoutResponse | null>(null)

  const scout = async (importContacts: boolean) => {
    setLoading(true)
    try {
      const next = await runScout({ industry, persona, region, limit, importContacts })
      setResult(next)
      if (importContacts) {
        await queryClient.invalidateQueries({ queryKey: ['contacts'] })
        toast.success(`Imported ${next.imported} approved-review prospects`)
      } else {
        toast.success(`Found ${next.leads.length} open-graph prospects`)
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Lead scout failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Card className="border-cyan-500/20 bg-cyan-500/5">
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-cyan-400" />
              Open Lead Scout
            </CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              Owned lead source: no Apollo, Hunter, Serper, or Tavily. The system now searches
              for public email evidence before a scouted prospect can be auto-approved.
            </p>
          </div>
          <Badge className="w-fit bg-amber-500/10 text-amber-300">
            <ShieldCheck className="mr-1 h-3 w-3" />
            Evidence required
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <Select value={industry} onValueChange={setIndustry}>
            <SelectTrigger>
              <SelectValue placeholder="Industry" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="saas">SaaS</SelectItem>
              <SelectItem value="agency">Agencies</SelectItem>
              <SelectItem value="cybersecurity">Cybersecurity</SelectItem>
              <SelectItem value="ai">AI Infrastructure</SelectItem>
              <SelectItem value="devtools">DevTools</SelectItem>
              <SelectItem value="ecommerce">Ecommerce</SelectItem>
              <SelectItem value="fintech">Fintech</SelectItem>
            </SelectContent>
          </Select>
          <Select value={persona} onValueChange={setPersona}>
            <SelectTrigger>
              <SelectValue placeholder="Persona" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="founder">Founder</SelectItem>
              <SelectItem value="growth">Growth</SelectItem>
              <SelectItem value="partnerships">Partnerships</SelectItem>
              <SelectItem value="sales">Sales</SelectItem>
              <SelectItem value="operations">Operations</SelectItem>
            </SelectContent>
          </Select>
          <Select value={region} onValueChange={setRegion}>
            <SelectTrigger>
              <SelectValue placeholder="Region" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="us">US</SelectItem>
              <SelectItem value="eu">EU</SelectItem>
              <SelectItem value="india">India</SelectItem>
            </SelectContent>
          </Select>
          <Input
            min={1}
            max={100}
            type="number"
            value={limit}
            onChange={(event) => setLimit(Number(event.target.value || 25))}
          />
          <div className="flex gap-2">
            <Button disabled={loading} variant="outline" onClick={() => scout(false)}>
              <Search className="mr-2 h-4 w-4" />
              Preview
            </Button>
            <Button disabled={loading} onClick={() => scout(true)}>
              Import
            </Button>
          </div>
        </div>

        {result ? (
          <div className="rounded-lg border bg-background/70 p-3">
            <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
              <Badge variant="secondary">{result.leads.length} found</Badge>
              <Badge variant="secondary">{result.imported} imported</Badge>
              <span className="text-muted-foreground">
                Inferred role inboxes stay blocked until public evidence or operator verification exists.
              </span>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              {result.leads.slice(0, 6).map((lead) => (
                <div key={lead.email} className="rounded-md border p-3 text-sm">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium">{lead.company}</div>
                      <div className="text-muted-foreground">{lead.email}</div>
                    </div>
                    <Badge variant="outline">{lead.fitScore}</Badge>
                  </div>
                  <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">{lead.reason}</p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
