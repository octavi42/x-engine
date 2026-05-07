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
