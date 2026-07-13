import type { ExportData, Link } from '../shared/schemas/link.ts'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { normalizeVibemuseLink, toEditableLinkPayload } from '../shared/utils/vibemuse-utm.ts'

interface MigrationChange {
  slug: string
  previousUrl: string
  nextUrl: string
  previousComment?: string
  nextComment: string
}

interface MigrationPlan {
  scanned: number
  candidates: number
  changed: MigrationChange[]
  unchanged: string[]
  skipped: Array<{ slug: string, reason: string }>
}

interface ScriptOptions {
  apply: boolean
  baseUrl: string
  siteToken: string
}

const backupDirUrl = new URL('../backups/', import.meta.url)
const backupDirPath = fileURLToPath(backupDirUrl)

export function buildBackupFilePath(now: Date): string {
  const timestamp = now.toISOString().replace(/:/g, '-')
  return fileURLToPath(new URL(`sink-export-before-vibemuse-utm-normalize-${timestamp}.json`, backupDirUrl))
}

export function buildMigrationPlan(links: Link[]): MigrationPlan {
  const plan: MigrationPlan = {
    scanned: links.length,
    candidates: 0,
    changed: [],
    unchanged: [],
    skipped: [],
  }

  for (const link of links) {
    const result = normalizeVibemuseLink(link)
    if ('reason' in result) {
      plan.skipped.push({ slug: link.slug, reason: result.reason })
      continue
    }

    plan.candidates++

    const hasUrlChange = result.normalizedUrl !== link.url
    const hasCommentChange = result.normalizedComment !== (link.comment ?? '')

    if (!hasUrlChange && !hasCommentChange) {
      plan.unchanged.push(link.slug)
      continue
    }

    plan.changed.push({
      slug: link.slug,
      previousUrl: link.url,
      nextUrl: result.normalizedUrl,
      previousComment: link.comment,
      nextComment: result.normalizedComment,
    })
  }

  return plan
}

export async function applyMigrationPlan(
  links: Link[],
  changes: MigrationChange[],
  backupPath: string,
  updateLink: (payload: Omit<Link, 'password'>) => Promise<void>,
): Promise<void> {
  if (!existsSync(backupPath)) {
    throw new Error(`Backup file not found: ${backupPath}`)
  }

  const linkMap = new Map(links.map(link => [link.slug, link]))
  for (const change of changes) {
    const existingLink = linkMap.get(change.slug)
    if (!existingLink)
      throw new Error(`Missing source link for slug: ${change.slug}`)

    await updateLink(toEditableLinkPayload(existingLink, {
      url: change.nextUrl,
      comment: change.nextComment,
    }))
  }
}

async function main() {
  const options = parseOptions(process.argv.slice(2))
  const exported = await exportAllLinks(options)
  const backupPath = persistBackup(exported)
  const plan = buildMigrationPlan(exported.links)

  printPlanSummary(plan, backupPath, options.apply)

  if (!options.apply)
    return

  await applyMigrationPlan(exported.links, plan.changed, backupPath, async (payload) => {
    await apiFetch(options, '/api/link/edit', {
      method: 'PUT',
      body: JSON.stringify(payload),
      headers: {
        'Content-Type': 'application/json',
      },
    })
  })

  console.info(`Applied ${plan.changed.length} Vibemuse UTM updates`)
}

function parseOptions(argv: string[]): ScriptOptions {
  const apply = argv.includes('--apply')
  const baseUrl = process.env.SINK_BASE_URL?.trim()
  const siteToken = process.env.NUXT_SITE_TOKEN?.trim()

  if (!baseUrl)
    throw new Error('SINK_BASE_URL is required')

  if (!siteToken)
    throw new Error('NUXT_SITE_TOKEN is required')

  return {
    apply,
    baseUrl: baseUrl.replace(/\/+$/, ''),
    siteToken,
  }
}

async function exportAllLinks(options: ScriptOptions): Promise<ExportData> {
  const links: Link[] = []
  let cursor: string | undefined

  do {
    const search = cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''
    const page = await apiFetch<ExportData>(options, `/api/link/export${search}`)
    links.push(...page.links)
    cursor = page.list_complete ? undefined : page.cursor
  } while (cursor)

  return {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    count: links.length,
    links,
    list_complete: true,
  }
}

function persistBackup(data: ExportData): string {
  mkdirSync(backupDirPath, { recursive: true })
  const backupPath = buildBackupFilePath(new Date())
  writeFileSync(backupPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8')
  return backupPath
}

function printPlanSummary(plan: MigrationPlan, backupPath: string, apply: boolean) {
  console.info(`Backup saved to ${backupPath}`)
  console.info(`Scanned ${plan.scanned} links`)
  console.info(`Matched ${plan.candidates} Vibemuse website social links`)
  console.info(`Will update ${plan.changed.length} links`)
  console.info(`Already normalized ${plan.unchanged.length} links`)
  console.info(`Skipped ${plan.skipped.length} links`)

  for (const change of plan.changed) {
    console.info(`- ${change.slug}`)
    console.info(`  url: ${change.previousUrl}`)
    console.info(`  ->  ${change.nextUrl}`)
    console.info(`  comment: ${change.previousComment ?? ''}`)
    console.info(`  ->  ${change.nextComment}`)
  }

  if (!apply)
    console.info('Dry run only. Re-run with --apply to perform updates.')
}

async function apiFetch<T = unknown>(options: ScriptOptions, path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${options.baseUrl}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${options.siteToken}`,
      ...init?.headers,
    },
  })

  if (!response.ok) {
    const body = await response.text()
    throw new Error(`${init?.method ?? 'GET'} ${path} failed with ${response.status}: ${body}`)
  }

  return await response.json() as T
}

if (isExecutedAsScript()) {
  await main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error))
    process.exitCode = 1
  })
}

function isExecutedAsScript(): boolean {
  return process.argv[1] === fileURLToPath(import.meta.url)
}
