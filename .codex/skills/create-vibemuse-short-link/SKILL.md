---
name: create-vibemuse-short-link
description: Create Vibemuse short links in this Sink project with the correct UTM structure and API workflow. Use when the user wants to create a new Vibemuse website short link, account-level short link, content-level short link, or a Sink link that must follow the current Vibemuse UTM rules in this repository.
---

# Create Vibemuse Short Link

Create new Vibemuse website short links in this repo's Sink instance with the current UTM rules already used by the project. Use the project API instead of editing KV directly.

## Quick Workflow

1. Confirm the link is a Vibemuse website link.
   Non-Vibemuse links or advanced Sink operations should use the repo skill at `/Users/lizhe/Documents/Sink短链/skills/sink/SKILL.md`.

2. Determine these inputs before calling the API.
   - `slug`: required for this workflow because `utm_content` must end in the slug
   - `utm_source`: `instagram`, `threads`, or `tiktok`
   - `utm_campaign`: `launch_202606` or `ai_playground_20260701`
   - `utm_term`: `account` or `content`
   - `identifier`:
     - `account`: account handle or account code such as `art_visit_guide`
     - `content`: content identifier, usually `content_id`

3. Build the final target URL and comment.
   Read `references/vibemuse-utm-rules.md` for the exact format and examples.

4. Load credentials from the project environment.
   - Read `/Users/lizhe/Documents/Sink短链/.env`
   - Default `SINK_BASE_URL` to `https://dots2.click` if the user does not specify another Sink instance
   - Use `NUXT_SITE_TOKEN` as the bearer token

5. Verify the target Sink instance before creation.
   Call `GET /api/verify` with the bearer token.

6. Create the link with `POST /api/link/create`.
   Include at least:
   - `url`
   - `slug`
   - `comment`
   Include optional Sink fields only when the user asked for them.

7. Verify the stored result with `GET /api/link/query?slug=...`.
   Return the short link, final target URL, and stored comment.

## Rules

- Always set `utm_medium=social`.
- Always use `utm_content=source_identifier_slug`.
- Never include `row` in `utm_content`.
- Prefer an explicit slug up front instead of relying on auto-generated slugs.
- For `ai_playground_20260701` content links, prefer `utm_term=content` and use the content identifier as `identifier`.
- For `launch_202606` account links, prefer `utm_term=account` and use the account handle or account code as `identifier`.

## Creation Notes

- If the user gives an existing long Vibemuse URL with old UTM fields, normalize it to the current shape before creating the short link.
- If `POST /api/link/create` returns `409`, query the existing slug and report it instead of silently changing the slug.
- Do not mutate existing short links unless the user explicitly asked to edit or normalize them.

## References

- Read `references/vibemuse-utm-rules.md` for exact UTM patterns and creation examples.
