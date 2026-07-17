import { z } from 'zod'

export const ATTRIBUTION_SCHEMA_VERSION = '1.0'
export const ATTRIBUTION_DEFAULT_SLICE_SECONDS = 86_400
export const ATTRIBUTION_MIN_SLICE_SECONDS = 300
export const ATTRIBUTION_MAX_SLICE_SECONDS = 86_400
export const ATTRIBUTION_LINK_ROW_LIMIT = 500
export const ATTRIBUTION_BROWSER_ROW_LIMIT = 5_000

export const AttributionClicksQuerySchema = z.object({
  startAt: z.coerce.number().int().safe().nonnegative().optional(),
  endAt: z.coerce.number().int().safe().positive().optional(),
  sliceSeconds: z.coerce.number().int().min(ATTRIBUTION_MIN_SLICE_SECONDS).max(ATTRIBUTION_MAX_SLICE_SECONDS).optional(),
  cursor: z.string().trim().min(1).max(2048).optional(),
}).superRefine((query, ctx) => {
  if (query.cursor) {
    if (
      query.startAt !== undefined
      || query.endAt !== undefined
      || query.sliceSeconds !== undefined
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'startAt, endAt, and sliceSeconds must be omitted when cursor is provided',
        path: ['cursor'],
      })
    }
    return
  }

  if (query.startAt === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startAt is required when cursor is not provided',
      path: ['startAt'],
    })
  }
  if (query.endAt === undefined) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'endAt is required when cursor is not provided',
      path: ['endAt'],
    })
  }
  if (
    query.startAt !== undefined
    && query.endAt !== undefined
    && query.startAt >= query.endAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'startAt must be less than endAt',
      path: ['startAt'],
    })
  }
}).transform(query => ({
  ...query,
  sliceSeconds: query.sliceSeconds ?? ATTRIBUTION_DEFAULT_SLICE_SECONDS,
}))

export const AttributionCursorSchema = z.object({
  version: z.literal(ATTRIBUTION_SCHEMA_VERSION),
  requestedStartAt: z.number().int().safe().nonnegative(),
  requestedEndAt: z.number().int().safe().positive(),
  sliceSeconds: z.number().int().min(ATTRIBUTION_MIN_SLICE_SECONDS).max(ATTRIBUTION_MAX_SLICE_SECONDS),
  nextStartAt: z.number().int().safe().nonnegative(),
}).superRefine((cursor, ctx) => {
  if (cursor.requestedStartAt >= cursor.requestedEndAt) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cursor requested window is invalid',
      path: ['requestedStartAt'],
    })
  }
  if (
    cursor.nextStartAt <= cursor.requestedStartAt
    || cursor.nextStartAt >= cursor.requestedEndAt
  ) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'cursor nextStartAt is outside the requested window',
      path: ['nextStartAt'],
    })
  }
})

export const AttributionBrowserTypeSchema = z.object({
  name: z.string(),
  clicks: z.number().int().nonnegative(),
  sampledRows: z.number().int().nonnegative(),
})

export const AttributionClickRowSchema = z.object({
  linkId: z.string(),
  slug: z.string(),
  targetUrl: z.string(),
  rawClicks: z.number().int().nonnegative(),
  sampledRows: z.number().int().nonnegative(),
  viewerEstimate: z.number().int().nonnegative(),
  refererCount: z.number().int().nonnegative(),
  browserTypes: z.array(AttributionBrowserTypeSchema),
  browserTypeClicks: z.number().int().nonnegative(),
  classificationComplete: z.boolean(),
})

export const AttributionCapabilitiesResponseSchema = z.object({
  schemaVersion: z.literal(ATTRIBUTION_SCHEMA_VERSION),
  source: z.literal('sink'),
  available: z.literal(true),
  endpoint: z.literal('/api/v1/attribution/clicks'),
  metrics: z.array(z.enum([
    'rawClicks',
    'viewerEstimate',
    'refererCount',
    'browserTypes',
  ])),
  identity: z.array(z.enum(['linkId', 'slug', 'targetUrl'])),
  pagination: z.literal('time_slice_cursor'),
  windowSemantics: z.literal('[startAt,endAt)'),
  sampling: z.literal('_sample_interval'),
  retention: z.object({
    value: z.literal(3),
    unit: z.literal('months'),
  }),
  limits: z.object({
    defaultSliceSeconds: z.number().int().positive(),
    minSliceSeconds: z.number().int().positive(),
    maxSliceSeconds: z.number().int().positive(),
    linkRowsPerSlice: z.number().int().positive(),
    browserRowsPerSlice: z.number().int().positive(),
  }),
  privacy: z.object({
    rawIpExported: z.literal(false),
  }),
})

export const AttributionClicksResponseSchema = z.object({
  schemaVersion: z.literal(ATTRIBUTION_SCHEMA_VERSION),
  source: z.literal('sink'),
  requestedWindow: z.object({
    startAt: z.number().int().nonnegative(),
    endAt: z.number().int().positive(),
  }),
  pageWindow: z.object({
    startAt: z.number().int().nonnegative(),
    endAt: z.number().int().positive(),
    endExclusive: z.literal(true),
  }),
  sampling: z.object({
    weightedBy: z.literal('_sample_interval'),
  }),
  page: z.object({
    rows: z.number().int().nonnegative(),
    nextCursor: z.string().optional(),
    listComplete: z.boolean(),
  }),
  warnings: z.array(z.string()),
  data: z.array(AttributionClickRowSchema),
})

export type AttributionClicksQuery = z.infer<typeof AttributionClicksQuerySchema>
export type AttributionCursor = z.infer<typeof AttributionCursorSchema>
export type AttributionCapabilitiesResponse = z.infer<typeof AttributionCapabilitiesResponseSchema>
export type AttributionClicksResponse = z.infer<typeof AttributionClicksResponseSchema>
