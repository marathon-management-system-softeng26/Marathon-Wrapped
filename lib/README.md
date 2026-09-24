# /lib — Wrapped logic

Owner: **Embun** (logic)

Pure TypeScript functions that turn a runner's data into Wrapped stats. No UI code here.

Planned:

- `stats.ts` — ranking / percentile, pace, split analysis (fastest km, negative vs. positive split)
- `insights.ts` — the stat lines shown on cards
- `merge.ts` — combine chip data + optional Strava + FotoYu photos into one runner payload
- `supabase.ts` — Supabase client

The runner payload shape comes from `docs/data-contract.md` — don't invent field names, follow the contract.
