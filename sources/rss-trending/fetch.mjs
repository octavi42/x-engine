import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  cdataPropName: '__cdata',
  trimValues: true,
});

export async function fetch(source) {
  const {
    sinceHours = 48,
    maxPerFeed = 25,
    feeds = [],
  } = source.params ?? {};

  const cutoff = Date.now() - sinceHours * 3600 * 1000;
  const errors = [];

  const perFeed = await Promise.all(feeds.map(async (feed) => {
    try {
      const xml = await fetchText(feed.url);
      const articles = parseFeed(xml).slice(0, maxPerFeed);
      const items = articles
        .map((a) => toItem(feed, a))
        .filter((i) => !i.date || Date.parse(i.date) >= cutoff);
      return items;
    } catch (err) {
      errors.push(`${feed.name}: ${err.message}`);
      return [];
    }
  }));

  const items = perFeed.flat();
  items.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? ''));

  const meta = {
    since_hours: sinceHours,
    feeds_scanned: feeds.length,
    feeds_with_items: perFeed.filter((items) => items.length).length,
  };
  if (errors.length) meta.errors = errors.join(' | ');
  return { items, meta };
}

async function fetchText(url) {
  const res = await globalThis.fetch(url, {
    headers: { 'user-agent': 'x-engine/sync (rss-trending)' },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.text();
}

function parseFeed(xml) {
  const tree = parser.parse(xml);
  if (tree.rss?.channel) {
    const items = arr(tree.rss.channel.item);
    return items.map((it) => ({
      title: text(it.title),
      link: text(it.link),
      summary: text(it.description) ?? text(it['content:encoded']),
      date: it.pubDate ? new Date(it.pubDate).toISOString() : null,
    }));
  }
  if (tree.feed) {
    const entries = arr(tree.feed.entry);
    return entries.map((e) => ({
      title: text(e.title),
      link: e.link?.['@_href'] ?? (Array.isArray(e.link) ? e.link[0]?.['@_href'] : null),
      summary: text(e.summary) ?? text(e.content),
      date: e.published ?? e.updated ? new Date(e.published ?? e.updated).toISOString() : null,
    }));
  }
  throw new Error('not a recognizable RSS or Atom feed');
}

function toItem(feed, article) {
  const summary = stripHtml(article.summary ?? '').trim();
  const lines = [`**${feed.name}** · ${article.date ?? 'undated'}`];
  if (summary) lines.push('', summary);
  return {
    title: article.title ?? '(untitled)',
    body: lines.join('\n'),
    url: article.link,
    tags: [feed.name].filter(Boolean),
    date: article.date,
  };
}

function arr(v) {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function text(node) {
  if (node == null) return null;
  if (typeof node === 'string') return node;
  if (node.__cdata) return node.__cdata;
  if (node['#text']) return node['#text'];
  return null;
}

function stripHtml(html) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
