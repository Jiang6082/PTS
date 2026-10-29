# Custom-ATS watch

Some employers post roles on systems the Node scanner can't enumerate: custom single-page
portals (Google, Meta, Apple, Goldman Sachs), Avature (Two Sigma, Bloomberg L.P.), Radancy
front-ends (Citi), or plain lists on their own website. They are listed in `watchlist.json`
so the reports show them as **could not fully verify** instead of "no roles".

## Snapshot format

A browser agent (when one is available) opens each `url`, reads role links via `selector`,
and writes `snapshots/<key>.json`:

```json
{ "key": "google", "firm": "Google", "capturedAt": "2026-10-29",
  "roles": [ { "title": "Student Researcher, 2027", "location": "Remote, US", "url": "https://...",
               "department": "", "content": "optional description text with hours" } ] }
```

The next `npm run scan:all` folds snapshot roles through the same PTS filter. Include
`content` when you can: without description text most roles can't show a part-time signal.

If a site is unreachable, leave its snapshot untouched rather than blanking it. Employers
that turn out to be scriptable should move into `inputs/ats_seeds.json`.
