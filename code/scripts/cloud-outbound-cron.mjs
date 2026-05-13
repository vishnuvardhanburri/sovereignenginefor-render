#!/usr/bin/env node
import { spawn } from 'node:child_process'
import fs from 'node:fs/promises'
import path from 'node:path'

const codeRoot = path.resolve(import.meta.dirname, '..')

function isEnabled(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase())
}

function clampNumber(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value || ''), 10)
  if (!Number.isFinite(parsed)) return fallback
  return Math.max(min, Math.min(max, parsed))
}

async function countCsvRows(filePath) {
  try {
    const raw = await fs.readFile(filePath, 'utf8')
    return Math.max(0, raw.split(/\r?\n/).filter((line) => line.trim()).length - 1)
  } catch {
    return 0
  }
}

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: codeRoot,
      env: { ...process.env, ...options.env },
      stdio: 'inherit',
    })
    child.on('error', reject)
    child.on('exit', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`))
    })
  })
}

async function main() {
  if (!isEnabled(process.env.OUTBOUND_CRON_ENABLED)) {
    console.log('[cloud-outbound-cron] disabled. Set OUTBOUND_CRON_ENABLED=true after DNS, SMTP, and lead review are ready.')
    return
  }

  const sourcePath = path.resolve(codeRoot, process.env.OUTBOUND_LEADS_SOURCE || 'docs/acquisition/LEADS_TEMPLATE.csv')
  const preparedPath = path.resolve(codeRoot, process.env.OUTBOUND_PREPARED_CSV || 'docs/acquisition/CLIENTS_TODAY.csv')
  const maxLimit = clampNumber(process.env.OUTBOUND_CRON_MAX_LIMIT, 25, 1, 100)
  const limit = clampNumber(process.env.OUTBOUND_CRON_LIMIT, 5, 1, maxLimit)

  console.log('[cloud-outbound-cron] preparing approved leads', { sourcePath, preparedPath, limit })
  await run('node', ['scripts/prepare-outbound-leads.mjs', sourcePath, preparedPath])

  const preparedRows = await countCsvRows(preparedPath)
  if (preparedRows === 0) {
    console.log('[cloud-outbound-cron] no approved leads found. Exiting without sending.')
    return
  }

  const cappedLimit = Math.min(limit, preparedRows)
  console.log('[cloud-outbound-cron] enqueueing outbound batch', { preparedRows, cappedLimit })
  await run(
    'pnpm',
    ['--dir', 'apps/api-gateway', 'exec', 'tsx', 'scripts/outbound-send.ts', '--', '--csv', preparedPath, '--limit', String(cappedLimit)],
    { env: { REAL_SEND_ACK: 'consented-low-volume' } },
  )
}

main().catch((error) => {
  console.error('[cloud-outbound-cron] failed', error)
  process.exit(1)
})
