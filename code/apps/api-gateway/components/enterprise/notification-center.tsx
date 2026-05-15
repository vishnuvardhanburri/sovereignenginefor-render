'use client'

import { useEffect, useMemo, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Bell, CheckCheck, Clock3, RadioTower, ShieldCheck } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ScrollArea } from '@/components/ui/scroll-area'
import { StatusPulse } from '@/components/enterprise/motion-system'
import { severityRank, useEnterpriseAlerts, type EnterpriseAlertSeverity } from '@/lib/enterprise/alert-store'
import { cn } from '@/lib/utils'

type HealthStats = {
  ok: boolean
  infrastructure_latency?: {
    redis_set_ms?: number
    redis_get_ms?: number
    db_reputation_state_ms?: number
    worker_heartbeat_scan_ms?: number
  }
  bullmq?: { waiting?: number; active?: number; delayed?: number; failed?: number }
  workers?: { sender?: { active?: number; stale?: number; totalConcurrency?: number } }
}

type ReputationMonitor = {
  events?: Array<{
    id: number
    severity: 'info' | 'warning' | 'critical'
    message: string
    label?: string
    createdAt: string
  }>
}

async function fetchHealth(): Promise<HealthStats> {
  const response = await fetch('/api/health/stats?client_id=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('health unavailable')
  return response.json()
}

async function fetchReputation(): Promise<ReputationMonitor> {
  const response = await fetch('/api/reputation/monitor?client_id=1', { cache: 'no-store' })
  if (!response.ok) throw new Error('reputation unavailable')
  return response.json()
}

function alertTone(severity: EnterpriseAlertSeverity) {
  if (severity === 'critical') return 'border-rose-500/25 bg-rose-500/10 text-rose-200'
  if (severity === 'warning') return 'border-amber-500/25 bg-amber-500/10 text-amber-200'
  return 'border-sky-500/25 bg-sky-500/10 text-sky-200'
}

export function NotificationCenter() {
  const { alerts, upsertAlert, acknowledge, acknowledgeAll, resolve } = useEnterpriseAlerts()
  const notified = useRef(new Set<string>())
  const health = useQuery({ queryKey: ['enterprise-health-alerts'], queryFn: fetchHealth, refetchInterval: 4_000 })
  const reputation = useQuery({ queryKey: ['enterprise-reputation-alerts'], queryFn: fetchReputation, refetchInterval: 5_000 })

  useEffect(() => {
    const data = health.data
    if (!data) return
    const waiting = Number(data.bullmq?.waiting ?? 0)
    const failed = Number(data.bullmq?.failed ?? 0)
    const activeWorkers = Number(data.workers?.sender?.active ?? 0)
    const redisMs = Math.max(Number(data.infrastructure_latency?.redis_set_ms ?? 0), Number(data.infrastructure_latency?.redis_get_ms ?? 0))
    const dbMs = Number(data.infrastructure_latency?.db_reputation_state_ms ?? 0)

    if (activeWorkers === 0) {
      upsertAlert({
        id: 'workers-offline',
        severity: 'critical',
        source: 'worker',
        title: 'Sender workers offline',
        detail: 'No active sender-worker heartbeat is visible. Pause outbound operations until recovered.',
      })
    } else {
      resolve('workers-offline')
    }
    if (waiting > 1000) {
      upsertAlert({
        id: 'queue-pressure-high',
        severity: 'warning',
        source: 'queue',
        title: 'Queue pressure rising',
        detail: `${waiting.toLocaleString()} jobs waiting. Watch throughput and worker capacity.`,
      })
    } else {
      resolve('queue-pressure-high')
    }
    if (failed > 0) {
      upsertAlert({
        id: 'queue-failures',
        severity: 'warning',
        source: 'queue',
        title: 'Queue failures detected',
        detail: `${failed.toLocaleString()} failed jobs are visible in BullMQ.`,
      })
    } else {
      resolve('queue-failures')
    }
    if (redisMs > 120 || dbMs > 120) {
      upsertAlert({
        id: 'infra-latency-high',
        severity: redisMs > 250 || dbMs > 250 ? 'critical' : 'warning',
        source: 'health',
        title: 'Infrastructure latency elevated',
        detail: `Redis ${redisMs.toFixed(1)}ms · DB ${dbMs.toFixed(1)}ms.`,
      })
    } else {
      resolve('infra-latency-high')
    }
  }, [health.data, resolve, upsertAlert])

  useEffect(() => {
    for (const event of reputation.data?.events?.slice(0, 8) ?? []) {
      if (event.severity === 'info') continue
      upsertAlert({
        id: `reputation-${event.id}`,
        severity: event.severity,
        source: 'reputation',
        title: `${event.label ?? 'Provider'} reputation event`,
        detail: event.message,
        updatedAt: event.createdAt,
      })
    }
  }, [reputation.data?.events, upsertAlert])

  useEffect(() => {
    for (const alert of alerts) {
      if (alert.state !== 'open' || alert.severity === 'info' || notified.current.has(alert.id)) continue
      notified.current.add(alert.id)
      const message = `${alert.title}: ${alert.detail}`
      if (alert.severity === 'critical') toast.error(message)
      else toast.warning(message)
      if (typeof window !== 'undefined' && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(alert.title, { body: alert.detail })
      }
    }
  }, [alerts])

  const openAlerts = useMemo(
    () => alerts.filter((alert) => alert.state === 'open').sort((a, b) => severityRank(b.severity) - severityRank(a.severity)),
    [alerts]
  )
  const criticalCount = openAlerts.filter((alert) => alert.severity === 'critical').length

  async function enableDesktopNotifications() {
    if (typeof window === 'undefined' || !('Notification' in window)) return
    const permission = await Notification.requestPermission()
    if (permission === 'granted') toast.success('Desktop operational notifications enabled')
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="relative gap-2 border-white/10 bg-background/60">
          <Bell className="h-4 w-4" />
          Alerts
          {openAlerts.length ? (
            <Badge className={cn('ml-1 h-5 px-1.5 text-[10px]', criticalCount ? 'bg-rose-500 text-white' : 'bg-amber-500 text-black')}>
              {openAlerts.length}
            </Badge>
          ) : (
            <StatusPulse tone="emerald" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[420px] border-white/10 bg-background/95 p-0 backdrop-blur-xl">
        <div className="flex items-center justify-between gap-3 p-4">
          <div>
            <DropdownMenuLabel className="p-0 text-sm">Operational Notification Center</DropdownMenuLabel>
            <p className="mt-1 text-xs text-muted-foreground">Persistent alerts, acknowledgement, and realtime warnings.</p>
          </div>
          <Button size="sm" variant="ghost" className="gap-1" onClick={acknowledgeAll}>
            <CheckCheck className="h-3.5 w-3.5" />
            Ack all
          </Button>
        </div>
        <DropdownMenuSeparator />
        <ScrollArea className="h-[360px]">
          <div className="space-y-3 p-3">
            {openAlerts.length ? (
              openAlerts.map((alert) => (
                <div key={alert.id} className="rounded-2xl border border-white/10 bg-card/80 p-3">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <Badge variant="outline" className={alertTone(alert.severity)}>
                      {alert.severity === 'critical' ? <AlertTriangle className="mr-1 h-3 w-3" /> : <RadioTower className="mr-1 h-3 w-3" />}
                      {alert.severity}
                    </Badge>
                    <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                      <Clock3 className="h-3 w-3" />
                      {new Date(alert.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                  <h3 className="text-sm font-semibold">{alert.title}</h3>
                  <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{alert.detail}</p>
                  <Button size="sm" variant="secondary" className="mt-3 h-8" onClick={() => acknowledge(alert.id)}>
                    Acknowledge
                  </Button>
                </div>
              ))
            ) : (
              <div className="rounded-2xl border border-emerald-500/15 bg-emerald-500/10 p-5 text-center">
                <ShieldCheck className="mx-auto h-7 w-7 text-emerald-300" />
                <p className="mt-2 text-sm font-medium">No open operational alerts</p>
                <p className="mt-1 text-xs text-muted-foreground">Health, queue pressure, workers, and reputation signals are clean.</p>
              </div>
            )}
          </div>
        </ScrollArea>
        <DropdownMenuSeparator />
        <div className="flex items-center justify-between p-3 text-xs text-muted-foreground">
          <span>Realtime + polling fallback active</span>
          <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={enableDesktopNotifications}>
            Enable desktop alerts
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
