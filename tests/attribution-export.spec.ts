import { describe, expect, it, vi } from 'vitest'
import {
  buildAttributionBrowserSql,
  buildAttributionLinkSql,
  createAttributionClickPage,
  decodeAttributionCursor,
  normalizeAnalyticsEngineError,
} from '../server/utils/attribution-export'
import {
  ATTRIBUTION_BROWSER_ROW_LIMIT,
  ATTRIBUTION_LINK_ROW_LIMIT,
  ATTRIBUTION_SCHEMA_VERSION,
  AttributionClicksQuerySchema,
  AttributionClicksResponseSchema,
} from '../shared/schemas/attribution'

const startAt = 1_700_000_000
const endAt = startAt + 172_800

function parsedQuery(input: Record<string, unknown>) {
  return AttributionClicksQuerySchema.parse(input)
}

describe('sink attribution export', () => {
  it('builds sampled half-open Analytics Engine queries without selecting raw IP', () => {
    const linkSql = buildAttributionLinkSql('sink', startAt, endAt)
    const browserSql = buildAttributionBrowserSql('sink', startAt, endAt)

    expect(linkSql).toContain('SUM(_sample_interval) AS rawClicks')
    expect(linkSql).toContain(`timestamp >= toDateTime(${startAt})`)
    expect(linkSql).toContain(`timestamp < toDateTime(${endAt})`)
    expect(linkSql).toContain(`LIMIT ${ATTRIBUTION_LINK_ROW_LIMIT + 1}`)
    expect(linkSql).not.toMatch(/blob4\s+AS/i)
    expect(browserSql).toContain('blob13 AS browserType')
    expect(browserSql).toContain(`LIMIT ${ATTRIBUTION_BROWSER_ROW_LIMIT + 1}`)
  })

  it('rejects unsafe dataset names', () => {
    expect(() => buildAttributionLinkSql('sink; DROP TABLE sink', startAt, endAt))
      .toThrow('Invalid Analytics Engine dataset configuration')
  })

  it('uses a cursor to advance non-overlapping time slices', async () => {
    const queryAnalytics = vi.fn()
      .mockResolvedValueOnce({
        data: [{
          linkId: 'link-1',
          slug: 'same-slug',
          targetUrl: 'https://example.com/old?utm_content=cnt_old',
          rawClicks: 7,
          sampledRows: 7,
          viewerEstimate: 5,
          refererCount: 2,
        }],
      })
      .mockResolvedValueOnce({
        data: [
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/old?utm_content=cnt_old',
            browserType: '',
            clicks: 5,
            sampledRows: 5,
          },
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/old?utm_content=cnt_old',
            browserType: 'crawler',
            clicks: 2,
            sampledRows: 2,
          },
        ],
      })

    const first = await createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt, sliceSeconds: 86_400 }),
      queryAnalytics,
    })

    expect(first.pageWindow).toEqual({
      startAt,
      endAt: startAt + 86_400,
      endExclusive: true,
    })
    expect(first.data[0]).toMatchObject({
      rawClicks: 7,
      browserTypeClicks: 7,
      classificationComplete: true,
    })
    expect(first.page.listComplete).toBe(false)
    expect(first.page.nextCursor).toBeTypeOf('string')

    const cursor = decodeAttributionCursor(first.page.nextCursor!)
    expect(cursor.nextStartAt).toBe(first.pageWindow.endAt)

    const secondQueryAnalytics = vi.fn()
      .mockResolvedValueOnce({ data: [] })
      .mockResolvedValueOnce({ data: [] })
    const second = await createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ cursor: first.page.nextCursor }),
      queryAnalytics: secondQueryAnalytics,
    })

    expect(second.pageWindow).toEqual({
      startAt: first.pageWindow.endAt,
      endAt,
      endExclusive: true,
    })
    expect(secondQueryAnalytics.mock.calls[0]?.[0]).toContain(
      `timestamp >= toDateTime(${first.pageWindow.endAt})`,
    )
    expect(second.page.listComplete).toBe(true)
  })

  it('rejects structurally invalid cursor payloads', () => {
    const invalidCursor = btoa(JSON.stringify({
      version: ATTRIBUTION_SCHEMA_VERSION,
      requestedStartAt: startAt,
      requestedEndAt: endAt,
      sliceSeconds: 86_400,
      nextStartAt: endAt,
    }))

    expect(() => decodeAttributionCursor(invalidCursor)).toThrow('Invalid attribution cursor')
  })

  it('rejects pagination parameters that attempt to override an existing cursor', () => {
    expect(() => parsedQuery({
      cursor: 'opaque',
      sliceSeconds: 300,
    })).toThrow('startAt, endAt, and sliceSeconds must be omitted')
  })

  it('keeps historical rows separate when one slug points to different URLs', async () => {
    const queryAnalytics = vi.fn()
      .mockResolvedValueOnce({
        data: [
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/old?utm_content=cnt_old',
            rawClicks: 3,
            sampledRows: 3,
            viewerEstimate: 2,
            refererCount: 1,
          },
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/new?utm_content=cnt_new',
            rawClicks: 4,
            sampledRows: 4,
            viewerEstimate: 3,
            refererCount: 1,
          },
        ],
      })
      .mockResolvedValueOnce({
        data: [
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/old?utm_content=cnt_old',
            browserType: '',
            clicks: 3,
            sampledRows: 3,
          },
          {
            linkId: 'link-1',
            slug: 'same-slug',
            targetUrl: 'https://example.com/new?utm_content=cnt_new',
            browserType: '',
            clicks: 4,
            sampledRows: 4,
          },
        ],
      })

    const page = await createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt: startAt + 300 }),
      queryAnalytics,
    })

    expect(page.data).toHaveLength(2)
    expect(page.data.map(row => row.targetUrl)).toEqual([
      'https://example.com/old?utm_content=cnt_old',
      'https://example.com/new?utm_content=cnt_new',
    ])
  })

  it('returns an explicit warning when browser classifications do not reconcile', async () => {
    const page = await createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt: startAt + 300 }),
      queryAnalytics: vi.fn()
        .mockResolvedValueOnce({
          data: [{
            linkId: 'link-1',
            slug: 'slug',
            targetUrl: 'https://example.com',
            rawClicks: 10,
            sampledRows: 5,
            viewerEstimate: 4,
            refererCount: 1,
          }],
        })
        .mockResolvedValueOnce({
          data: [{
            linkId: 'link-1',
            slug: 'slug',
            targetUrl: 'https://example.com',
            browserType: 'fetcher',
            clicks: 2,
            sampledRows: 1,
          }],
        }),
    })

    expect(page.data[0]).toMatchObject({
      rawClicks: 10,
      browserTypeClicks: 2,
      classificationComplete: false,
    })
    expect(page.warnings).toEqual([
      'Browser classification did not reconcile for link link-1',
    ])
  })

  it('fails closed when either grouped result exceeds its safety limit', async () => {
    await expect(createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt: startAt + 300 }),
      queryAnalytics: vi.fn().mockResolvedValueOnce({
        data: Array.from({ length: ATTRIBUTION_LINK_ROW_LIMIT + 1 }, (_, index) => ({
          linkId: `link-${index}`,
        })),
      }),
    })).rejects.toMatchObject({
      statusCode: 422,
      code: 'ATTRIBUTION_LINK_WINDOW_TOO_DENSE',
      retryable: false,
    })

    await expect(createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt: startAt + 300 }),
      queryAnalytics: vi.fn()
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({
          data: Array.from({ length: ATTRIBUTION_BROWSER_ROW_LIMIT + 1 }, (_, index) => ({
            linkId: `link-${index}`,
          })),
        }),
    })).rejects.toMatchObject({
      statusCode: 422,
      code: 'ATTRIBUTION_BROWSER_WINDOW_TOO_DENSE',
      retryable: false,
    })
  })

  it('treats an empty complete time slice as a successful response', async () => {
    const page = await createAttributionClickPage({
      dataset: 'sink',
      query: parsedQuery({ startAt, endAt: startAt + 300 }),
      queryAnalytics: vi.fn()
        .mockResolvedValueOnce({ data: [] })
        .mockResolvedValueOnce({ data: [] }),
    })

    expect(page.page).toEqual({
      rows: 0,
      nextCursor: undefined,
      listComplete: true,
    })
    expect(page.data).toEqual([])
    expect(AttributionClicksResponseSchema.parse(page)).toEqual(page)
  })

  it.each([
    [401, 502, 'ANALYTICS_ENGINE_AUTHENTICATION_FAILED', false],
    [403, 502, 'ANALYTICS_ENGINE_AUTHORIZATION_FAILED', false],
    [429, 429, 'ANALYTICS_ENGINE_RATE_LIMITED', true],
    [503, 503, 'ANALYTICS_ENGINE_UNAVAILABLE', true],
  ])(
    'normalizes Analytics Engine HTTP %i without leaking upstream details',
    (upstreamStatus, statusCode, code, retryable) => {
      const error = normalizeAnalyticsEngineError({
        response: {
          status: upstreamStatus,
          data: {
            token: 'must-not-leak',
          },
        },
      })

      expect(error).toMatchObject({ statusCode, code, retryable })
      expect(error.message).not.toContain('must-not-leak')
    },
  )

  it('classifies malformed Analytics Engine rows as a non-retryable contract error', () => {
    const error = normalizeAnalyticsEngineError(
      AttributionClicksResponseSchema.safeParse({}).error,
    )

    expect(error).toMatchObject({
      statusCode: 502,
      code: 'ANALYTICS_ENGINE_RESPONSE_INVALID',
      retryable: false,
    })
  })
})
