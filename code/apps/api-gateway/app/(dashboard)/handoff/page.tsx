import { CheckCircle2, Database, Download, KeyRound, PackageCheck, Server, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const operatorNeeds = [
  'A VPS or container host with Docker enabled.',
  'A sending domain the operator controls for DNS records.',
  'SMTP or ESP credentials from a compliant provider.',
  'Built-in validation is included; external validation keys are not required.',
  'A first admin user and production secrets generated during setup.',
]

const readyInsideSystem = [
  'Dashboard command center, health oracle, audit chain, and RaaS API.',
  'Postgres schema, Redis/BullMQ queueing, sender-worker and reputation-worker wiring.',
  'Demo mode, stress proof scripts, and safe sample import flow.',
  'Production docker-compose, setup.sh, and environment validation commands.',
  'SOC2-style tamper-evident logs and secret-vault support.',
]

const commands = [
  'cp .env.example .env',
  'bash setup.sh',
  'docker compose -f docker-compose.prod.yml up -d --build',
  'pnpm db:init',
  'pnpm public-api-key:create -- --name operator-demo --tier pro',
  'STRESS_COUNT=10000 pnpm stress:test',
]

export default function HandoffPage() {
  return (
    <div className="space-y-6">
      <div className="rounded-3xl border bg-[radial-gradient(circle_at_top_right,_rgba(20,184,166,0.18),_transparent_34%),linear-gradient(135deg,_hsl(var(--card)),_hsl(var(--background)))] p-6">
        <Badge variant="outline" className="mb-3 border-teal-500/20 bg-teal-500/10 text-teal-600">
          <PackageCheck className="mr-1 h-3 w-3" />
          Deployment handoff
        </Badge>
        <h1 className="text-3xl font-semibold tracking-tight">Production Handoff Center</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          The system is packaged so an operator can connect infrastructure and credentials quickly. Real sending stays locked behind domain ownership, SMTP credentials, and compliance checks.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button asChild>
            <a href="/api/handoff/data-room?domain=sovereign-demo.example" target="_blank" rel="noreferrer">
              <Download className="mr-2 h-4 w-4" />
              Download Data Room ZIP
            </a>
          </Button>
          <Button variant="outline" asChild>
            <a href="/api/due-diligence/report?domain=sovereign-demo.example" target="_blank" rel="noreferrer">
              <PackageCheck className="mr-2 h-4 w-4" />
              Download PDF Packet
            </a>
          </Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <CheckCircle2 className="h-5 w-5 text-emerald-500" />
              Already Built Into Sovereign Engine
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {readyInsideSystem.map((item) => (
              <div key={item} className="flex gap-3 rounded-2xl border p-3 text-sm">
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-500" />
              Operator Provides
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {operatorNeeds.map((item) => (
              <div key={item} className="flex gap-3 rounded-2xl border p-3 text-sm">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_0.9fr]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Server className="h-5 w-5 text-blue-500" />
              Five-Minute Deployment Command Path
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded-2xl bg-slate-950 p-4 text-sm text-slate-100">
              <code>{commands.join('\n')}</code>
            </pre>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Database className="h-5 w-5 text-violet-500" />
              Handoff Rule
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm text-muted-foreground">
            <p>
              Sovereign Engine should run with demo mode on, seeded proof data available, and production sending disabled until verified domains and provider credentials are connected.
            </p>
            <p>
              That keeps the product credible during technical review while preventing accidental traffic, credential exposure, or non-compliant sending.
            </p>
            <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 text-emerald-700">
              Recommended posture: evaluation mode is ready today; real sending unlocks after verified DNS, SMTP secrets, and compliance inputs are connected.
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
