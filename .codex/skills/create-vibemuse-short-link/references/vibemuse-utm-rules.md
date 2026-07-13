# Vibemuse UTM Rules

## Required shape

- Base host: `https://vibemuse.app/`
- `utm_source`: `instagram` | `threads` | `tiktok`
- `utm_medium`: `social`
- `utm_campaign`: `launch_202606` | `ai_playground_20260701`
- `utm_term`: `account` | `content`
- `utm_content`: `source_identifier_slug`

## Identifier rules

- `account` links:
  Use the account handle or account code.
  Examples:
  - `vibemuseapp2026`
  - `art_visit_guide`
  - `haitianbeijing`

- `content` links:
  Use the content identifier.
  Prefer `content_id` when the source metadata provides it.
  Examples:
  - `botticelli_annunciation_exhibit_22`
  - `death_of_socrates_suspense_reversal_exhibit_05`

## Examples

### Account-level launch link

Inputs:
- source: `instagram`
- campaign: `launch_202606`
- term: `account`
- identifier: `art_visit_guide`
- slug: `sprr9t`

Final URL:

```text
https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_content=instagram_art_visit_guide_sprr9t&utm_term=account
```

Suggested comment:

```text
Instagram | art_visit_guide | 官网 | utm_term=account | utm_content=instagram_art_visit_guide_sprr9t
```

### Content-level AI Playground link

Inputs:
- source: `instagram`
- campaign: `ai_playground_20260701`
- term: `content`
- identifier: `botticelli_annunciation_exhibit_22`
- slug: `4cu6gb`

Final URL:

```text
https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=ai_playground_20260701&utm_content=instagram_botticelli_annunciation_exhibit_22_4cu6gb&utm_term=content
```

Suggested comment when structured metadata exists:

```text
{"content_id":"botticelli-annunciation-exhibit-22","campaign":"ai_playground_20260701"} | utm_term=content | utm_content=instagram_botticelli_annunciation_exhibit_22_4cu6gb
```

## API workflow

1. Load `.env` from the repo root.
2. Default `SINK_BASE_URL` to `https://dots2.click`.
3. Verify auth:

```bash
curl -sS -H "Authorization: Bearer $NUXT_SITE_TOKEN" "$SINK_BASE_URL/api/verify"
```

4. Create the short link:

```bash
curl -sS \
  -H "Authorization: Bearer $NUXT_SITE_TOKEN" \
  -H "Content-Type: application/json" \
  -X POST \
  "$SINK_BASE_URL/api/link/create" \
  -d '{
    "slug": "sprr9t",
    "url": "https://vibemuse.app/?utm_source=instagram&utm_medium=social&utm_campaign=launch_202606&utm_content=instagram_art_visit_guide_sprr9t&utm_term=account",
    "comment": "Instagram | art_visit_guide | 官网 | utm_term=account | utm_content=instagram_art_visit_guide_sprr9t"
  }'
```

5. Verify the stored result:

```bash
curl -sS -H "Authorization: Bearer $NUXT_SITE_TOKEN" "$SINK_BASE_URL/api/link/query?slug=sprr9t"
```

## Avoid

- Do not omit the slug and then try to derive `utm_content` afterward.
- Do not include `rowXX` in `utm_content`.
- Do not use `account` for content-driven AI Playground links unless the user explicitly wants account-level attribution.
- Do not update an existing slug in place unless the user asked to edit an existing link.
