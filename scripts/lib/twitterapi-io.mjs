// Thin wrapper around twitterapi.io's REST API.
// Docs: https://docs.twitterapi.io/api-reference

const BASE = 'https://api.twitterapi.io';
const TIMEOUT_MS = 15_000;

function client(apiKey) {
  if (!apiKey) throw new Error('TWITTERAPI_IO_KEY not set');
  return async function call(path, params = {}) {
    const url = new URL(BASE + path);
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null) continue;
      url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      headers: { 'x-api-key': apiKey },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`twitterapi.io ${res.status}: ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    if (json.status === 'error') throw new Error(json.message || 'twitterapi.io error');
    return json;
  };
}

function normalizeTweet(t) {
  return {
    // Coerce to string — twitterapi.io can return numeric IDs, but tool
    // schemas hand them back as strings; mismatched types break Map lookups.
    id: t.id != null ? String(t.id) : null,
    url: t.url,
    text: t.text ?? '',
    handle: t.author?.userName ?? null,
    author_followers: t.author?.followers ?? null,
    created_at: t.createdAt ?? null,
    likes: t.likeCount ?? 0,
    replies: t.replyCount ?? 0,
    retweets: t.retweetCount ?? 0,
    quotes: t.quoteCount ?? 0,
    bookmarks: t.bookmarkCount ?? 0,
    views: t.viewCount ?? 0,
    is_reply: Boolean(t.inReplyToId),
  };
}

export function makeTwitterApi(apiKey) {
  const call = client(apiKey);

  return {
    async userLastTweets({ userName, includeReplies = false, sinceDate, max = 40 }) {
      const out = [];
      let cursor = '';
      const cutoff = sinceDate ? new Date(sinceDate).getTime() : 0;

      while (out.length < max) {
        const res = await call('/twitter/user/last_tweets', {
          userName,
          cursor,
          includeReplies,
        });
        const tweets = (res.tweets ?? []).map(normalizeTweet);
        for (const t of tweets) {
          if (t.created_at && cutoff && new Date(t.created_at).getTime() < cutoff) {
            return out;
          }
          out.push(t);
          if (out.length >= max) break;
        }
        if (!res.has_next_page || !res.next_cursor) break;
        cursor = res.next_cursor;
      }
      return out;
    },

    async searchTweets({ query, queryType = 'Top', max = 30 }) {
      const out = [];
      let cursor = '';
      while (out.length < max) {
        const res = await call('/twitter/tweet/advanced_search', {
          query,
          queryType,
          cursor,
        });
        const tweets = (res.tweets ?? []).map(normalizeTweet);
        out.push(...tweets);
        if (!res.has_next_page || !res.next_cursor) break;
        cursor = res.next_cursor;
      }
      return out.slice(0, max);
    },
  };
}

// Engagement-rate scoring. Bookmarks weighted highest — best signal of "saved
// for later" which correlates with the algorithm's amplification logic.
//
// Denominator uses views (impressions) when known; falls back to followers
// only as a coarse reach proxy when views are missing. Using max(views,
// followers) inverts the signal for viral tweets — a viral post with more
// views than followers ends up ranked below a less-viral one.
export function engagementScore(tweet) {
  const interactions =
    tweet.likes + 2 * tweet.replies + 3 * tweet.bookmarks + 1.5 * tweet.retweets;
  const denom = tweet.views > 0
    ? tweet.views
    : Math.max(tweet.author_followers ?? 1, 1);
  return interactions / denom;
}
