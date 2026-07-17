import type {
  AttributionClicksQuery,
  AttributionClicksResponse,
  AttributionCursor,
} from '../../shared/schemas/attribution'
import { z } from 'zod'
import {
  ATTRIBUTION_BROWSER_ROW_LIMIT,
  ATTRIBUTION_LINK_ROW_LIMIT,
  ATTRIBUTION_SCHEMA_VERSION,
  AttributionClicksResponseSchema,
  AttributionCursorSchema,
} from '../../shared/schemas/attribution'

export interface WaeResult {
  data?: unknown[]
  rows?: number
}

type QueryAnalytics = (sql: string) => Promise<WaeResult>

export class AttributionExportError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
    public readonly action?: string,
  ) {
    super(message)
    this.name = 'AttributionExportError'
  }
}

function readHttpStatus(error: unknown): number | undefined {
  if (!error || typeof error !== 'object')
    return undefined
  const candidate = error as {
    status?: unknown
    statusCode?: unknown
    response?: { status?: unknown }
  }
  for (const value of [
    candidate.response?.status,
    candidate.statusCode,
    candidate.status,
  ]) {
    if (typeof value === 'number')
      return value
  }
  return undefined
}

export function normalizeAnalyticsEngineError(error: unknown): AttributionExportError {
  if (error instanceof z.ZodError) {
    return new AttributionExportError(
      502,
      'ANALYTICS_ENGINE_RESPONSE_INVALID',
      'Analytics Engine returned an invalid response',
      false,
    )
  }

  const status = readHttpStatus(error)
  if (status === 401) {
    return new AttributionExportError(
      502,
      'ANALYTICS_ENGINE_AUTHENTICATION_FAILED',
      'Analytics Engine authentication failed',
      false,
    )
  }
  if (status === 403) {
    return new AttributionExportError(
      502,
      'ANALYTICS_ENGINE_AUTHORIZATION_FAILED',
      'Analytics Engine authorization failed',
      false,
    )
  }
  if (status === 429) {
    return new AttributionExportError(
      429,
      'ANALYTICS_ENGINE_RATE_LIMITED',
      'Analytics Engine rate limit exceeded',
      true,
    )
  }
  if (status !== undefined && status >= 500) {
    return new AttributionExportError(
      503,
      'ANALYTICS_ENGINE_UNAVAILABLE',
      'Analytics Engine is temporarily unavailable',
      true,
    )
  }
  return new AttributionExportError(
    502,
    'ANALYTICS_ENGINE_QUERY_FAILED',
    'Analytics Engine query failed',
    false,
  )
}

const WaeLinkRowSchema = z.object({
  linkId: z.coerce.string(),
  slug: z.coerce.string(),
  targetUrl: z.coerce.string(),
  rawClicks: z.coerce.number().int().nonnegative(),
  sampledRows: z.coerce.number().int().nonnegative(),
  viewerEstimate: z.coerce.number().int().nonnegative(),
  refererCount: z.coerce.number().int().nonnegative(),
})

const WaeBrowserRowSchema = z.object({
  linkId: z.coerce.string(),
  slug: z.coerce.string(),
  targetUrl: z.coerce.string(),
  browserType: z.coerce.string(),
  clicks: z.coerce.number().int().nonnegative(),
  sampledRows: z.coerce.number().int().nonnegative(),
})

function encodeBase64Url(value: string): string {
  return btoa(value)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decodeBase64Url(value: string): string {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padding = '='.repeat((4 - normalized.length % 4) % 4)
  return atob(`${normalized}${padding}`)
}

export function encodeAttributionCursor(cursor: AttributionCursor): string {
  return encodeBase64Url(JSON.stringify(AttributionCursorSchema.parse(cursor)))
}

export function decodeAttributionCursor(cursor: string): AttributionCursor {
  try {
    return AttributionCursorSchema.parse(JSON.parse(decodeBase64Url(cursor)))
  }
  catch {
    throw new AttributionExportError(
      400,
      'INVALID_ATTRIBUTION_CURSOR',
      'Invalid attribution cursor',
      false,
    )
  }
}

export function resolveAttributionPageWindow(query: AttributionClicksQuery) {
  const cursor = query.cursor ? decodeAttributionCursor(query.cursor) : undefined
  const requestedStartAt = cursor?.requestedStartAt ?? query.startAt!
  const requestedEndAt = cursor?.requestedEndAt ?? query.endAt!
  const sliceSeconds = cursor?.sliceSeconds ?? query.sliceSeconds
  const pageStartAt = cursor?.nextStartAt ?? requestedStartAt
  const pageEndAt = Math.min(pageStartAt + sliceSeconds, requestedEndAt)

  return {
    requestedStartAt,
    requestedEndAt,
    sliceSeconds,
    pageStartAt,
    pageEndAt,
  }
}

function safeDatasetName(dataset: string): string {
  if (!/^[a-z_]\w*$/i.test(dataset)) {
    throw new AttributionExportError(
      500,
      'INVALID_ANALYTICS_DATASET',
      'Invalid Analytics Engine dataset configuration',
      false,
    )
  }
  return dataset
}

export function buildAttributionLinkSql(
  dataset: string,
  startAt: number,
  endAt: number,
): string {
  return `
SELECT
  index1 AS linkId,
  blob1 AS slug,
  blob2 AS targetUrl,
  SUM(_sample_interval) AS rawClicks,
  COUNT() AS sampledRows,
  ROUND(COUNT(DISTINCT blob4) * SUM(_sample_interval) / COUNT()) AS viewerEstimate,
  ROUND((COUNT(DISTINCT blob5) - MAX(if(blob5 = '', 1, 0))) * SUM(_sample_interval) / COUNT()) AS refererCount
FROM ${safeDatasetName(dataset)}
WHERE timestamp >= toDateTime(${startAt})
  AND timestamp < toDateTime(${endAt})
GROUP BY linkId, slug, targetUrl
ORDER BY linkId, slug, targetUrl
LIMIT ${ATTRIBUTION_LINK_ROW_LIMIT + 1}
`.trim()
}

export function buildAttributionBrowserSql(
  dataset: string,
  startAt: number,
  endAt: number,
): string {
  return `
SELECT
  index1 AS linkId,
  blob1 AS slug,
  blob2 AS targetUrl,
  blob13 AS browserType,
  SUM(_sample_interval) AS clicks,
  COUNT() AS sampledRows
FROM ${safeDatasetName(dataset)}
WHERE timestamp >= toDateTime(${startAt})
  AND timestamp < toDateTime(${endAt})
GROUP BY linkId, slug, targetUrl, browserType
ORDER BY linkId, slug, targetUrl, browserType
LIMIT ${ATTRIBUTION_BROWSER_ROW_LIMIT + 1}
`.trim()
}

function rowKey(row: { linkId: string, slug: string, targetUrl: string }) {
  return JSON.stringify([row.linkId, row.slug, row.targetUrl])
}

function assertBoundedRows(rows: unknown[], limit: number, code: string) {
  if (rows.length <= limit)
    return
  throw new AttributionExportError(
    422,
    code,
    'Attribution time slice is too dense',
    false,
    'Retry with a smaller sliceSeconds value',
  )
}

export async function createAttributionClickPage(input: {
  dataset: string
  query: AttributionClicksQuery
  queryAnalytics: QueryAnalytics
}): Promise<AttributionClicksResponse> {
  const window = resolveAttributionPageWindow(input.query)
  const linkResult = await input.queryAnalytics(buildAttributionLinkSql(
    input.dataset,
    window.pageStartAt,
    window.pageEndAt,
  ))
  const linkRows = linkResult.data ?? []
  assertBoundedRows(linkRows, ATTRIBUTION_LINK_ROW_LIMIT, 'ATTRIBUTION_LINK_WINDOW_TOO_DENSE')

  const browserResult = await input.queryAnalytics(buildAttributionBrowserSql(
    input.dataset,
    window.pageStartAt,
    window.pageEndAt,
  ))
  const browserRows = browserResult.data ?? []
  assertBoundedRows(
    browserRows,
    ATTRIBUTION_BROWSER_ROW_LIMIT,
    'ATTRIBUTION_BROWSER_WINDOW_TOO_DENSE',
  )

  const links = linkRows.map(row => WaeLinkRowSchema.parse(row))
  const linksByKey = new Map(links.map(row => [rowKey(row), {
    ...row,
    browserTypes: [] as Array<{
      name: string
      clicks: number
      sampledRows: number
    }>,
  }]))

  for (const value of browserRows) {
    const browser = WaeBrowserRowSchema.parse(value)
    const link = linksByKey.get(rowKey(browser))
    if (!link) {
      throw new AttributionExportError(
        502,
        'ATTRIBUTION_GROUP_MISMATCH',
        'Analytics Engine aggregation mismatch',
        true,
      )
    }
    link.browserTypes.push({
      name: browser.browserType,
      clicks: browser.clicks,
      sampledRows: browser.sampledRows,
    })
  }

  const warnings: string[] = []
  const data = [...linksByKey.values()].map((row) => {
    const browserTypeClicks = row.browserTypes.reduce((sum, item) => sum + item.clicks, 0)
    const classificationComplete = browserTypeClicks === row.rawClicks
    if (!classificationComplete) {
      warnings.push(`Browser classification did not reconcile for link ${row.linkId}`)
    }
    return {
      ...row,
      browserTypeClicks,
      classificationComplete,
    }
  })

  const listComplete = window.pageEndAt >= window.requestedEndAt
  const nextCursor = listComplete
    ? undefined
    : encodeAttributionCursor({
        version: ATTRIBUTION_SCHEMA_VERSION,
        requestedStartAt: window.requestedStartAt,
        requestedEndAt: window.requestedEndAt,
        sliceSeconds: window.sliceSeconds,
        nextStartAt: window.pageEndAt,
      })

  return AttributionClicksResponseSchema.parse({
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    source: 'sink',
    requestedWindow: {
      startAt: window.requestedStartAt,
      endAt: window.requestedEndAt,
    },
    pageWindow: {
      startAt: window.pageStartAt,
      endAt: window.pageEndAt,
      endExclusive: true,
    },
    sampling: {
      weightedBy: '_sample_interval',
    },
    page: {
      rows: data.length,
      nextCursor,
      listComplete,
    },
    warnings,
    data,
  })
}
