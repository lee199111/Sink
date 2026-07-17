import type { WaeResult } from '#server/utils/attribution-export'
import {
  AttributionExportError,
  normalizeAnalyticsEngineError,
} from '#server/utils/attribution-export'
import { AttributionClicksQuerySchema } from '#shared/schemas/attribution'

defineRouteMeta({
  openAPI: {
    description: 'Export sampled and grouped Sink clicks using bounded UTC time-slice pagination',
    security: [{ bearerAuth: [] }],
    parameters: [
      {
        name: 'startAt',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Inclusive Unix timestamp for the first request',
      },
      {
        name: 'endAt',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Exclusive Unix timestamp for the first request',
      },
      {
        name: 'sliceSeconds',
        in: 'query',
        required: false,
        schema: { type: 'integer' },
        description: 'Bounded page duration for the first request',
      },
      {
        name: 'cursor',
        in: 'query',
        required: false,
        schema: { type: 'string' },
        description: 'Opaque cursor returned by the previous response',
      },
    ],
  },
})

export default eventHandler(async (event) => {
  const query = await getValidatedQuery(event, AttributionClicksQuerySchema.parse)
  const { dataset } = useRuntimeConfig(event)
  let response
  try {
    response = await createAttributionClickPage({
      dataset,
      query,
      queryAnalytics: sql => useWAE(event, sql) as Promise<WaeResult>,
    })
  }
  catch (error) {
    const normalized = error instanceof AttributionExportError
      ? error
      : normalizeAnalyticsEngineError(error)
    throw createError({
      status: normalized.statusCode,
      statusText: normalized.message,
      data: {
        code: normalized.code,
        retryable: normalized.retryable,
        action: normalized.action,
      },
    })
  }

  setResponseHeader(event, 'Cache-Control', 'no-store')
  return response
})
