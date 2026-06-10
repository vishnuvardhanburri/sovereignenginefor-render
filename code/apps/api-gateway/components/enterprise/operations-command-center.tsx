'use client'

import { useMemo } from 'react'
import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Database, GitBranch, RadioTower, ShieldCheck, TrendingUp, Wifi, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { MotionPanel, QueueFlow, StatusPulse, enterpriseEase } from '@/components/enterprise/motion-system'
import { cn } from '@/lib/utils'

type HealthStats = {
  ok: boolean
  generatedAt: string
  infrastructure_latency?: {
    redis_set_ms?: number
    redis_get_ms?: number
    db_reputation_state_ms?: number
    worker_heartbeat_scan_ms?: number
  }
  bullmq?: { waiting?: number; active?: number; delayed?: number; failed?: number }
  db_queue?: { waiting?: number; active?: number; retry?: number; failed?: number }
  workers?: {
    sender?: {
      active?: number
      stale?: number
      totalConcurrency?: number
      totalProcessedSends?: number
      nodes?: Array<{
        workerId: string
        region?: string
        desiredState?: string
        processedSends?: number
        resources?: { rssMb?: number; cpuPercent?: number; heapUsedMb?: number }
        lastSeenAt?: string
      }>
    }
  }
  resource_usage?: { avg_cpu_percent?: number; total_rss_mb?: number; memory_mb_per_10k_sends?: number }
}

type ReputationMonitor = {
  generatedAt: string
  providers?: Array<{
    provider: string
    label: string
    status: 'HEALTHY' | 'THROTTLED' | 'PAUSED'
    maxPerHour: number
    deferralRate1h: number
    blockRate1h: number
    seedPlacementInboxRate: number
  }>
  events?: Array<{ id: number; createdAt: string; severity: 'info' | 'warning' | 'critical'; label: string; message: string }>
  investor?: {
    estimatedInboxedToday: number
    netProfitUsd: number
    activeCapacityPerHour: number
    avgInboxPlacementRate: number
  }
}

type DeliveryProof = {
  summary?: {
    sentToday?: number
    sent24h?: number
    failed24h?: number
    bounced24h?: number
    replies24h?: number
    replyRate24h?: number
    estimatedPipelineValueUsd?: number
  }
}

async function fetchHealth(): Promise<HealthStats> {
  const response = await fetch('/api/health/stats?client_id=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('health unavailable')
  return response.json()
}

async function fetchReputation(): Promise<ReputationMonitor> {
  const response = await fetch('/api/reputation/monitor?client_id=1&investor=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('reputation unavailable')
  return response.json()
}

async function fetchDeliveryProof(): Promise<DeliveryProof> {
  const response = await fetch('/api/dashboard/sent?client_id=1&summaryOnly=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('delivery proof unavailable')
  return response.json()
}

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value ?? 0))
}

function moneyFmt(value: number | undefined) {
  return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP', maximumFractionDigits: 0 }).format(Number(value ?? 0))
}

function pct(value: number | undefined) {
  return `${(Number(value ?? 0) * 100).toFixed(1)}%`
}

function laneTone(status: string) {
  if (status === 'PAUSED') return 'border-rose-500/25 bg-rose-500/10 text-rose-200'
  if (status === 'THROTTLED') return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-200'
}

export function OperationsCommandCenter({ mode = 'executive' }: { mode?: 'executive' | 'reputation' }) {
  const health = useQuery({
    queryKey: ['enterprise-ops-health'],
    queryFn: fetchHealth,
    refetchInterval: 20_000,
    staleTime: 10_000,
  })
  const reputation = useQuery({
    queryKey: ['enterprise-ops-reputation'],
    queryFn: fetchReputation,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })
  const deliveryProof = useQuery({
    queryKey: ['enterprise-delivery-proof-summary'],
    queryFn: fetchDeliveryProof,
    refetchInterval: 30_000,
    staleTime: 15_000,
  })

  const waiting = Number(health.data?.bullmq?.waiting ?? 0) + Number(health.data?.db_queue?.waiting ?? 0)
  const active = Number(health.data?.bullmq?.active ?? 0) + Number(health.data?.db_queue?.active ?? 0)
  const failed = Number(health.data?.bullmq?.failed ?? 0) + Number(health.data?.db_queue?.failed ?? 0)
  const workerCount = Number(health.data?.workers?.sender?.active ?? 0)
  const concurrency = Number(health.data?.workers?.sender?.totalConcurrency ?? 0)
  const sentToday = Number(deliveryProof.data?.summary?.sentToday ?? 0)
  const sent24h = Number(deliveryProof.data?.summary?.sent24h ?? sentToday)
  const replies24h = Number(deliveryProof.data?.summary?.replies24h ?? 0)
  const replyRate24h = Number(deliveryProof.data?.summary?.replyRate24h ?? 0)
  const failed24h = Number(deliveryProof.data?.summary?.failed24h ?? 0)
  const bounced24h = Number(deliveryProof.data?.summary?.bounced24h ?? 0)
  const proofPipeline = Number(deliveryProof.data?.summary?.estimatedPipelineValueUsd ?? 0)
  const redisLatency = Math.max(
    Number(health.data?.infrastructure_latency?.redis_set_ms ?? 0),
    Number(health.data?.infrastructure_latency?.redis_get_ms ?? 0)
  )
  const dbLatency = Number(health.data?.infrastructure_latency?.db_reputation_state_ms ?? 0)
  const queuePressure = Math.min(100, Math.round(((waiting + active) / Math.max(concurrency * 40, 1)) * 100))

  const risk = useMemo(() => {
    if (failed > 0 || failed24h + bounced24h > 0 || workerCount === 0) return { label: 'Intervention', tone: 'rose' as const }
    if (queuePressure > 70 || redisLatency > 120 || dbLatency > 120) return { label: 'Watch', tone: 'amber' as const }
    return { label: 'Nominal', tone: 'emerald' as const }
  }, [bounced24h, dbLatency, failed, failed24h, queuePressure, redisLatency, workerCount])

  const nodes = health.data?.workers?.sender?.nodes ?? []
  const lanes = reputation.data?.providers ?? []
  const events = reputation.data?.events?.slice(0, 5) ?? []

  return (
    <MotionPanel className="relative overflow-hidden bg-[radial-gradient(circle_at_8%_12%,rgba(14,165,233,0.18),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-5 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px] opacity-35" />
      <div className="relative z-10 grid gap-5 2xl:grid-cols-[0.95fr_1.05fr]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.22em] text-sky-200/80">
                <StatusPulse tone={risk.tone} />
                Live operations
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl lg:text-4xl">
                {mode === 'reputation' ? 'Reputation control room' : 'Outbound infrastructure cockpit'}
              </h2>
              <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">
                Track sender capacity, queue pressure, worker health, and delivery risk before it becomes a sending problem.
              </p>
            </div>
            <Badge variant="outline" className={cn('rounded-full px-3 py-1', risk.label === 'Nominal' ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200' : risk.label === 'Watch' ? 'border-amber-500/30 bg-amber-500/15 text-amber-200' : 'border-rose-500/30 bg-rose-500/15 text-rose-200')}>
              {risk.label}
            </Badge>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <MetricTile
              icon={RadioTower}
              label="Sent today"
              value={numberFmt(sentToday)}
              sub={`${sent24h.toLocaleString()} in last 24h · ${replies24h.toLocaleString()} replies · ${(replyRate24h * 100).toFixed(1)}% response`}
            />
            <MetricTile icon={Zap} label="Sender capacity" value={numberFmt(concurrency)} sub="Total worker concurrency online" />
            <MetricTile icon={Database} label="Infrastructure latency" value={`${Math.max(dbLatency, redisLatency).toFixed(0)}ms`} sub={`DB ${dbLatency.toFixed(1)}ms · Redis ${redisLatency.toFixed(1)}ms`} />
            <MetricTile
              icon={TrendingUp}
              label="Pipeline signal"
              value={moneyFmt(proofPipeline || reputation.data?.investor?.netProfitUsd)}
              sub={`${workerCount} active workers · ${pct(reputation.data?.investor?.avgInboxPlacementRate)} modeled inbox placement`}
            />
          </div>

          <div className="mt-5 rounded-2xl border border-white/10 bg-black/20 p-4">
            <div className="mb-3 flex items-center justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-200">
                <Activity className="h-4 w-4 text-cyan-300" />
                Queue pressure
              </span>
              <span className="text-slate-400">{waiting.toLocaleString()} waiting · {active.toLocaleString()} active</span>
            </div>
            <QueueFlow pressure={queuePressure} />
            <div className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(220px,1fr))] gap-3">
              {lanes.map((lane) => (
                <div key={lane.provider} className="min-w-0 rounded-xl border border-white/10 bg-white/[0.035] p-3">
                  <div className="grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
                    <span className="min-w-0 max-w-full truncate text-sm font-medium">{lane.label}</span>
                    <Badge
                      variant="outline"
                      className={cn('shrink-0 whitespace-nowrap px-2 py-0.5 text-[10px] leading-4', laneTone(lane.status))}
                    >
                      {lane.status}
                    </Badge>
                  </div>
                  <div className="mt-3 text-xl font-semibold">{numberFmt(lane.maxPerHour)}/hr</div>
                  <div className="mt-1 text-xs text-slate-400">Def {pct(lane.deferralRate1h)} · Block {pct(lane.blockRate1h)}</div>
                </div>
              ))}
              {!lanes.length && (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm text-slate-400">
                  Provider lanes will appear after the next reputation sample.
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4 text-cyan-300" />
                Sender workers
              </h3>
              <span className="text-xs text-slate-400">{nodes.length} nodes</span>
            </div>
            <div className="space-y-3">
              {nodes.slice(0, 4).map((node, index) => (
                <motion.div
                  key={node.workerId}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: 0.35, delay: index * 0.04, ease: enterpriseEase }}
                  className="rounded-xl border border-white/10 bg-white/[0.035] p-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-2 text-sm">
                      <StatusPulse tone="emerald" />
                      <span className="truncate" title={node.workerId}>{node.workerId}</span>
                    </span>
                    <Badge variant="outline" className="border-white/10 bg-white/5 text-slate-200">{node.region ?? 'prod'}</Badge>
                  </div>
                  <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-slate-400">
                    <span>CPU {Number(node.resources?.cpuPercent ?? 0).toFixed(1)}%</span>
                    <span>RSS {Number(node.resources?.rssMb ?? 0).toFixed(0)}MB</span>
                    <span>{Number(node.processedSends ?? 0).toLocaleString()} sends</span>
                  </div>
                </motion.div>
              ))}
              {!nodes.length && (
                <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm text-slate-400">
                  No live sender workers reported yet.
                </div>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <ShieldCheck className="h-4 w-4 text-emerald-300" />
                Audit activity
              </h3>
              <Wifi className="h-4 w-4 text-slate-400" />
            </div>
            <AnimatePresence initial={false}>
              <div className="space-y-3">
                {events.map((event) => (
                  <motion.div
                    layout
                    key={event.id}
                    initial={{ opacity: 0, y: -8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    className="rounded-xl border border-white/10 bg-white/[0.035] p-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <Badge variant="outline" className={laneTone(event.severity === 'critical' ? 'PAUSED' : event.severity === 'warning' ? 'THROTTLED' : 'HEALTHY')}>
                        {event.severity}
                      </Badge>
                      <span className="text-[11px] text-slate-500">{new Date(event.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-300">{event.message}</p>
                  </motion.div>
                ))}
                {!events.length && (
                  <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.025] p-4 text-sm text-slate-400">
                    No audit events in the current window.
                  </div>
                )}
              </div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </MotionPanel>
  )
}

function MetricTile({ icon: Icon, label, value, sub }: { icon: ComponentType<{ className?: string }>; label: string; value: string; sub: string }) {
  return (
    <div className="min-h-[136px] rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-[0.12em] text-slate-400">{label}</span>
        <Icon className="h-4 w-4 text-sky-300" />
      </div>
      <motion.div layout className="break-words text-2xl font-semibold tracking-tight md:text-3xl">
        {value}
      </motion.div>
      <div className="mt-2 text-xs leading-5 text-slate-500">{sub}</div>
    </div>
  )
}
