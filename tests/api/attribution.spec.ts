import { describe, expect, it } from 'vitest'
import { fetch, fetchWithAuth } from '../utils'

describe('/api/v1/attribution', () => {
  it('returns the versioned capability contract with valid auth', async () => {
    const response = await fetchWithAuth('/api/v1/attribution/capabilities')

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      schemaVersion: '1.0',
      source: 'sink',
      available: true,
      pagination: 'time_slice_cursor',
      windowSemantics: '[startAt,endAt)',
      retention: {
        value: 3,
        unit: 'months',
      },
      privacy: {
        rawIpExported: false,
      },
    })
  })

  it('protects the capability contract with bearer auth', async () => {
    const response = await fetch('/api/v1/attribution/capabilities')

    expect(response.status).toBe(401)
  })

  it('rejects an invalid attribution time range before querying Analytics Engine', async () => {
    const response = await fetchWithAuth(
      '/api/v1/attribution/clicks?startAt=1700000000&endAt=1699999999',
    )

    expect(response.status).toBe(400)
  })

  it('rejects malformed attribution cursors', async () => {
    const response = await fetchWithAuth('/api/v1/attribution/clicks?cursor=not-a-cursor')

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({
      data: {
        code: 'INVALID_ATTRIBUTION_CURSOR',
        retryable: false,
      },
    })
  })

  it('rejects attempts to override time slicing after a cursor is issued', async () => {
    const response = await fetchWithAuth(
      '/api/v1/attribution/clicks?cursor=opaque&sliceSeconds=300',
    )

    expect(response.status).toBe(400)
  })

  it('returns a complete empty future slice through the real Analytics Engine query path', async () => {
    const startAt = 4_102_444_800
    const response = await fetchWithAuth(
      `/api/v1/attribution/clicks?startAt=${startAt}&endAt=${startAt + 300}&sliceSeconds=300`,
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({
      schemaVersion: '1.0',
      source: 'sink',
      pageWindow: {
        startAt,
        endAt: startAt + 300,
        endExclusive: true,
      },
      page: {
        rows: 0,
        listComplete: true,
      },
      data: [],
    })
  }, 15_000)
})
