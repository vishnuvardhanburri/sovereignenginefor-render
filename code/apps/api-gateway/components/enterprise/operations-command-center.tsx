'use client'

import { useMemo } from 'react'
import type { ComponentType } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AnimatePresence, motion } from 'framer-motion'
import { Activity, Database, GitBranch, RadioTower, ShieldCheck, TrendingUp, Wifi, Zap } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
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

function numberFmt(value: number | undefined) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 }).format(Number(value ?? 0))
}

function moneyFmt(value: number | undefined) {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(Number(value ?? 0))
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
  const health = useQuery({ queryKey: ['enterprise-ops-health'], queryFn: fetchHealth, refetchInterval: 3_000 })
  const reputation = useQuery({ queryKey: ['enterprise-ops-reputation'], queryFn: fetchReputation, refetchInterval: 4_000 })

  const waiting = Number(health.data?.bullmq?.waiting ?? 0) + Number(health.data?.db_queue?.waiting ?? 0)
  const active = Number(health.data?.bullmq?.active ?? 0) + Number(health.data?.db_queue?.active ?? 0)
  const failed = Number(health.data?.bullmq?.failed ?? 0) + Number(health.data?.db_queue?.failed ?? 0)
  const workerCount = Number(health.data?.workers?.sender?.active ?? 0)
  const concurrency = Number(health.data?.workers?.sender?.totalConcurrency ?? 0)
  const processed = Number(health.data?.workers?.sender?.totalProcessedSends ?? 0)
  const redisLatency = Math.max(
    Number(health.data?.infrastructure_latency?.redis_set_ms ?? 0),
    Number(health.data?.infrastructure_latency?.redis_get_ms ?? 0)
  )
  const dbLatency = Number(health.data?.infrastructure_latency?.db_reputation_state_ms ?? 0)
  const queuePressure = Math.min(100, Math.round(((waiting + active) / Math.max(concurrency * 40, 1)) * 100))

  const risk = useMemo(() => {
    if (failed > 0 || workerCount === 0) return { label: 'Intervention', tone: 'rose' as const }
    if (queuePressure > 70 || redisLatency > 120 || dbLatency > 120) return { label: 'Watch', tone: 'amber' as const }
    return { label: 'Nominal', tone: 'emerald' as const }
  }, [dbLatency, failed, queuePressure, redisLatency, workerCount])

  const nodes = health.data?.workers?.sender?.nodes ?? []
  const lanes = reputation.data?.providers ?? []
  const events = reputation.data?.events?.slice(0, 5) ?? []

  return (
    <MotionPanel className="relative overflow-hidden bg-[radial-gradient(circle_at_8%_12%,rgba(14,165,233,0.18),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0.96),rgba(2,6,23,0.98))] p-5 text-slate-100">
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.035)_1px,transparent_1px)] bg-[size:44px_44px] opacity-35" />
      <div className="relative z-10 grid gap-5 xl:grid-cols-[1.2fr_0.8fr]">
        <div>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.28em] text-sky-200/80">
                <StatusPulse tone={risk.tone} />
                Enterprise operations layer
              </div>
              <h2 className="mt-3 text-2xl font-semibold tracking-tight md:text-3xl">
                {mode === 'reputation' ? 'Realtime reputation operating picture' : 'Executive infrastructure command center'}
              </h2>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-slate-300">
                Live worker heartbeats, queue pressure, lane health, audit activity, and infrastructure recovery cues in one restrained cockpit.
              </p>
            </div>
            <Badge variant="outline" className={cn('rounded-full px-3 py-1', risk.label === 'Nominal' ? 'border-emerald-500/30 bg-emerald-500/15 text-emerald-200' : risk.label === 'Watch' ? 'border-amber-500/30 bg-amber-500/15 text-amber-200' : 'border-rose-500/30 bg-rose-500/15 text-rose-200')}>
              {risk.label}
            </Badge>
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricTile icon={RadioTower} label="Processed proof events" value={numberFmt(processed)} sub={`${workerCount} live workers`} />
            <MetricTile icon={Zap} label="Total concurrency" value={numberFmt(concurrency)} sub="Sender capacity online" />
            <MetricTile icon={Database} label="DB / Redis latency" value={`${dbLatency.toFixed(1)} / ${redisLatency.toFixed(1)}ms`} sub="Current health oracle sample" />
            <MetricTile icon={TrendingUp} label="Value signal" value={moneyFmt(reputation.data?.investor?.netProfitUsd)} sub={`${pct(reputation.data?.investor?.avgInboxPlacementRate)} inbox model`} />
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
              {!lanes.length && <Skeleton className="h-24" />}
            </div>
          </div>
        </div>

        <div className="grid gap-4">
          <div className="rounded-2xl border border-white/10 bg-black/25 p-4">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="flex items-center gap-2 text-sm font-semibold">
                <GitBranch className="h-4 w-4 text-cyan-300" />
                Worker topology
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
                      <span className="truncate">{node.workerId}</span>
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
              {!nodes.length && <Skeleton className="h-28" />}
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
                {!events.length && <Skeleton className="h-28" />}
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
    <div className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs text-slate-400">{label}</span>
        <Icon className="h-4 w-4 text-sky-300" />
      </div>
      <motion.div layout className="text-2xl font-semibold tracking-tight">
        {value}
      </motion.div>
      <div className="mt-1 text-xs text-slate-500">{sub}</div>
    </div>
  )
}
