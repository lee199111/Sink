import {
  ATTRIBUTION_BROWSER_ROW_LIMIT,
  ATTRIBUTION_DEFAULT_SLICE_SECONDS,
  ATTRIBUTION_LINK_ROW_LIMIT,
  ATTRIBUTION_MAX_SLICE_SECONDS,
  ATTRIBUTION_MIN_SLICE_SECONDS,
  ATTRIBUTION_SCHEMA_VERSION,
  AttributionCapabilitiesResponseSchema,
} from '#shared/schemas/attribution'

defineRouteMeta({
  openAPI: {
    description: 'Describe the versioned read-only Sink attribution export contract',
    security: [{ bearerAuth: [] }],
  },
})

export default eventHandler(() => {
  return AttributionCapabilitiesResponseSchema.parse({
    schemaVersion: ATTRIBUTION_SCHEMA_VERSION,
    source: 'sink',
    available: true,
    endpoint: '/api/v1/attribution/clicks',
    metrics: [
      'rawClicks',
      'viewerEstimate',
      'refererCount',
      'browserTypes',
    ],
    identity: ['linkId', 'slug', 'targetUrl'],
    pagination: 'time_slice_cursor',
    windowSemantics: '[startAt,endAt)',
    sampling: '_sample_interval',
    retention: {
      value: 3,
      unit: 'months',
    },
    limits: {
      defaultSliceSeconds: ATTRIBUTION_DEFAULT_SLICE_SECONDS,
      minSliceSeconds: ATTRIBUTION_MIN_SLICE_SECONDS,
      maxSliceSeconds: ATTRIBUTION_MAX_SLICE_SECONDS,
      linkRowsPerSlice: ATTRIBUTION_LINK_ROW_LIMIT,
      browserRowsPerSlice: ATTRIBUTION_BROWSER_ROW_LIMIT,
    },
    privacy: {
      rawIpExported: false,
    },
  })
})
