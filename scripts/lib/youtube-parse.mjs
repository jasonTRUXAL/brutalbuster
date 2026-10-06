// Pure parsing helpers for YouTube data (no network) — unit tested in test/unit.

/** "PT1H2M3S" -> { text: "1:02:03", seconds: 3723 } */
export function isoDuration(iso) {
  const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(iso || '');
  if (!m || iso === 'PT') return { text: '', seconds: 0 };
  const [h, mi, s] = [m[1], m[2], m[3]].map((x) => Number(x || 0));
  const seconds = h * 3600 + mi * 60 + s;
  const pad = (n) => String(n).padStart(2, '0');
  return { text: h ? `${h}:${pad(mi)}:${pad(s)}` : `${mi}:${pad(s)}`, seconds };
}

/** First plausible production year (1920–2019) in any of the texts, else null. */
export function findYear(...texts) {
  for (const t of texts) {
    const m = /\b(19[2-9]\d|20[01]\d)\b/.exec(t || '');
    if (m) return Number(m[1]);
  }
  return null;
}

export function decodeXml(s) {
  return String(s ?? '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&amp;/g, '&');
}

/** Drop hashtag lines and bare links people paste at the bottom of descriptions; cap the length. */
export function trimDescription(d, max = 900) {
  const lines = String(d || '')
    .split(/\r?\n/)
    .filter((l) => !/^\s*(#\w+\s*)+$/.test(l) && !/^\s*https?:\/\/\S+\s*$/.test(l));
  const text = lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, '')}…` : text;
}

/**
 * Accepts "@Handle", "UC…" ids and the common channel URL shapes.
 * @returns {{id?: string, handle?: string, username?: string, url?: string} | null}
 */
export function parseChannel(input) {
  const s = String(input || '').trim();
  if (!s) return null;
  if (/^UC[\w-]{22}$/.test(s)) return { id: s };
  if (s.startsWith('@')) return { handle: s };
  try {
    const u = new URL(s.startsWith('http') ? s : `https://${s}`);
    const parts = u.pathname.split('/').filter(Boolean);
    if (parts[0]?.startsWith('@')) return { handle: decodeURIComponent(parts[0]) };
    if (parts[0] === 'channel' && parts[1]) return { id: parts[1] };
    if (parts[0] === 'user' && parts[1]) return { username: parts[1], url: u.href };
    if (parts[0] === 'c' && parts[1]) return { url: u.href };
  } catch {
    // not a URL — treat it as a bare handle below
  }
  return { handle: `@${s.replace(/^@/, '')}` };
}

/** Pull the UC… channel id out of a channel page's HTML. */
export function extractChannelId(html) {
  const m =
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/channel\/(UC[\w-]{22})"/.exec(html) ||
    /"externalId":"(UC[\w-]{22})"/.exec(html) ||
    /"channelId":"(UC[\w-]{22})"/.exec(html);
  return m ? m[1] : null;
}

/** Parse a channel's public Atom feed (youtube.com/feeds/videos.xml). */
export function parseRssFeed(xml) {
  const title = decodeXml(/<title>([\s\S]*?)<\/title>/.exec(xml)?.[1] || 'YouTube channel');
  const videos = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)]
    .map(([, e]) => ({
      youtubeId: /<yt:videoId>([\s\S]*?)<\/yt:videoId>/.exec(e)?.[1],
      title: decodeXml(/<title>([\s\S]*?)<\/title>/.exec(e)?.[1]),
      description: decodeXml(/<media:description>([\s\S]*?)<\/media:description>/.exec(e)?.[1]),
      tags: [],
      publishedAt: /<published>([\s\S]*?)<\/published>/.exec(e)?.[1] || '',
      duration: '',
      seconds: 0,
      shortsLink: /\/shorts\//.test(e),
      live: false,
    }))
    .filter((v) => v.youtubeId);
  return { title, videos };
}
