// Thin wrapper around twitterapi.io's REST API.
// Docs: https://docs.twitterapi.io/api-reference

const BASE = 'https://api.twitterapi.io';
// Aggressive per-call timeout — paginated calls multiply this. 8s is enough
// for healthy responses; anything slower is a problem worth surfacing.
const TIMEOUT_MS = 8_000;

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
    async userLastTweets({ userName, includeReplies = false, sinceDate, max = 20, maxPages = Infinity }) {
      const out = [];
      let cursor = '';
      let pages = 0;
      const cutoff = sinceDate ? new Date(sinceDate).getTime() : 0;

      while (out.length < max && pages < maxPages) {
        const res = await call('/twitter/user/last_tweets', {
          userName,
          cursor,
          includeReplies,
        });
        pages += 1;
        // twitterapi.io's /user/last_tweets nests tweets under `data.tweets`
        // and pagination flags at the top level — different shape from
        // /tweet/advanced_search and /tweets, which keep `tweets` at the
        // top level. Read both to be tolerant of either layout.
        const tweetsRaw = res.data?.tweets ?? res.tweets ?? [];
        const tweets = tweetsRaw.map(normalizeTweet);
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

    async searchTweets({ query, queryType = 'Top', max = 20 }) {
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

    // Lookup tweets by ID. Used by the engagement feedback loop to refresh
    // metrics for posts we shipped in the last week.
    //
    // The endpoint takes a comma-separated `tweet_ids` query param. It is
    // rate-limited per request so we batch in chunks of 100. Tweets that
    // have been deleted are silently dropped from the response.
    async tweetsByIds({ ids, batchSize = 100 }) {
      const out = [];
      const unique = [...new Set(ids.filter(Boolean).map(String))];
      for (let i = 0; i < unique.length; i += batchSize) {
        const chunk = unique.slice(i, i + batchSize);
        const res = await call('/twitter/tweets', { tweet_ids: chunk.join(',') });
        for (const t of res.tweets ?? []) out.push(normalizeTweet(t));
      }
      return out;
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
