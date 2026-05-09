# Posted Archive

Move posts here after publishing. Track what worked.

Format:
```
## YYYY-MM-DD
> post text here

Likes: X | Reposts: X | Replies: X | Notes: ...
```

## 2026-05-03
> every page refresh on my ai game was regenerating images server-side. cause: base64 dataUrls in sessionStorage, partialize stripped the field on persist. ~$0.30 and ~30s wasted per reload. fix: upload each image to vercel blob, store the short url.

URL: https://x.com/i/web/status/2050969731155349933
Project: Road to SF
Likes: 2 | Reposts: 0 | Replies: 0 | Notes:
Bookmarks: 0
Views: 58
Fetched: 2026-05-04T14:38:10.333Z

## 2026-05-03
> prod fresh tabs froze on dialogue. cause: browser blocked audio.play() with no user gesture. fix: on rejection, attach one-shot pointerdown/keydown listeners and retry on first input. 6s safety timer falls back to fixed cadence so the typewriter still reveals.

URL: https://x.com/i/web/status/2051036972710261187
Project: Road to SF
Likes: 1 | Reposts: 0 | Replies: 0 | Notes:
Bookmarks: 0
Views: 32
Fetched: 2026-05-04T14:38:10.333Z

## 2026-05-07
> added 6 free credits for first-time visitors on roadtosf.com.
> 
> mechanic: check if user_balance row exists for the anon cookie. if not, grant 6.
> 
> skips logged-in users (balance on email row) and repeat anons.
> 
> users can play end-to-end before the paywall.

URL: https://x.com/i/web/status/2052430616340152818
Project: 6 free credits for first-time anon users
Variant: original
Likes: 5 | Reposts: 1 | Replies: 0 | Notes:
Bookmarks: 0
Views: 71
Fetched: 2026-05-08T15:03:22.380Z

## 2026-05-09
> player picks a choice, network dies mid-stream
> 
> sessionStorage rehydrates with choiceMade=true but the beat slot is empty. ChoicePanel stays disabled forever
> 
> fix: on mount, detect that state and re-fire fireBeat for the pending beat index

URL: https://x.com/i/web/status/2053095437498814874
Project: offline beat recovery
Variant: original
Likes: — | Reposts: — | Replies: — | Notes:

## 2026-05-09
> roadtosf grounds stories in real SF tech news
> 
> Haiku 4.5 scrapes siliconmania.tv/weekly → structured JSON. Jaccard(player tags ∩ item tags) ranks. top 4 go into the prompt as name-verbatim constraints
> 
> names are real. lines are model-written

URL: https://x.com/i/web/status/2053153003985834414
Project: Silicon Mania real-news grounding
Variant: original
Likes: — | Reposts: — | Replies: — | Notes:
