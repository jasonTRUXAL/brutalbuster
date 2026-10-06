import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isoDuration, findYear, decodeXml, trimDescription, parseChannel, extractChannelId, parseRssFeed } from '../../scripts/lib/youtube-parse.mjs';
import { buildCatalog } from '../../scripts/lib/build-catalog.mjs';
import { validateCatalog } from '../../src/catalog-schema.js';

test('isoDuration', () => {
  assert.deepEqual(isoDuration('PT1H2M3S'), { text: '1:02:03', seconds: 3723 });
  assert.deepEqual(isoDuration('PT28M14S'), { text: '28:14', seconds: 1694 });
  assert.deepEqual(isoDuration('PT45S'), { text: '0:45', seconds: 45 });
  assert.deepEqual(isoDuration('P0D'), { text: '', seconds: 0 });
  assert.deepEqual(isoDuration(undefined), { text: '', seconds: 0 });
});

test('findYear prefers the first text and ignores modern upload years', () => {
  assert.equal(findYear('Aerobics Tape (1987)', 'uploaded 2024'), 1987);
  assert.equal(findYear('No year here', 'Recorded off TV in 1993'), 1993);
  assert.equal(findYear('Uploaded 2026'), null);
  assert.equal(findYear('Model 1200 VCR'), null);
});

test('decodeXml', () => {
  assert.equal(decodeXml('Tom &amp; Jerry&#39;s &quot;Big&quot; &lt;Day&gt;'), 'Tom & Jerry\'s "Big" <Day>');
});

test('trimDescription drops hashtag lines and bare links', () => {
  const d = 'A great tape.\n\nhttps://example.com\n#vhs #retro\nMore text.';
  assert.equal(trimDescription(d), 'A great tape.\n\nMore text.');
  assert.ok(trimDescription('word '.repeat(400)).endsWith('…'));
});

test('parseChannel accepts handles, ids and URLs', () => {
  assert.deepEqual(parseChannel('@VHSVault'), { handle: '@VHSVault' });
  assert.deepEqual(parseChannel('VHSVault'), { handle: '@VHSVault' });
  assert.deepEqual(parseChannel('https://www.youtube.com/@VHSVault/videos'), { handle: '@VHSVault' });
  assert.deepEqual(parseChannel('UCLA_DiR1FfKNvjuUpBHmylQ'), { id: 'UCLA_DiR1FfKNvjuUpBHmylQ' });
  assert.deepEqual(parseChannel('youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ'), { id: 'UCLA_DiR1FfKNvjuUpBHmylQ' });
  assert.equal(parseChannel('https://www.youtube.com/user/oldname').username, 'oldname');
  // legacy custom URLs (no @) are resolved from the channel page
  assert.deepEqual(parseChannel('https://www.youtube.com/brutalmoose'), { url: 'https://www.youtube.com/brutalmoose' });
  assert.deepEqual(parseChannel('youtube.com/brutalmoose/videos'), { url: 'https://youtube.com/brutalmoose' });
  assert.equal(parseChannel('https://www.youtube.com/watch?v=dQw4w9WgXcQ'), null);
  assert.equal(parseChannel('  '), null);
});

test('extractChannelId reads the canonical link', () => {
  const html = '<link rel="canonical" href="https://www.youtube.com/channel/UCLA_DiR1FfKNvjuUpBHmylQ">';
  assert.equal(extractChannelId(html), 'UCLA_DiR1FfKNvjuUpBHmylQ');
  assert.equal(extractChannelId('<html></html>'), null);
});

test('parseRssFeed', () => {
  const xml = `<feed><title>Tape Vault</title>
    <entry><yt:videoId>abcdefghijk</yt:videoId><title>Workout &amp; Fun (1989)</title>
      <published>2026-01-02T00:00:00+00:00</published><media:description>Leg warmers.</media:description></entry>
    <entry><yt:videoId>shortsshort</yt:videoId><title>Clip</title><link href="https://www.youtube.com/shorts/shortsshort"/></entry>
  </feed>`;
  const { title, videos } = parseRssFeed(xml);
  assert.equal(title, 'Tape Vault');
  assert.equal(videos.length, 2);
  assert.equal(videos[0].title, 'Workout & Fun (1989)');
  assert.equal(videos[1].shortsLink, true);
});

// ---------------------------------------------------------------- shelving rules

const config = {
  store: { name: 'TEST VIDEO' },
  youtube: { defaultAisle: 'Rare Finds', titleCleanup: ['\\s*[\\[(]vhs[\\])]'] },
  aisles: [
    { name: 'Horror', color: '#b388ff', match: ['horror', 'monster'] },
    { name: 'Fitness & Workout', color: '#ff4fa3', match: ['workout', 'aerobic'] },
  ],
};
const v = (youtubeId, title, extra = {}) => ({ youtubeId, title, description: '', tags: [], publishedAt: '2026-01-01T00:00:00Z', duration: '30:00', seconds: 1800, ...extra });
const channel = { title: 'Tape Vault', url: 'https://www.youtube.com/@tapevault' };

test('buildCatalog: override > playlist > keyword > default', () => {
  const videos = [
    v('aaaaaaaaaaa', 'Monster Mash Workout'), // keyword: Horror is listed first
    v('bbbbbbbbbbb', 'Some Tape (VHS)'), // nothing matches -> default; title cleaned
    v('ccccccccccc', 'Something'), // in a playlist named like an aisle
    v('ddddddddddd', 'Other thing'), // in a playlist with its own name
    v('eeeeeeeeeee', 'Horror Night'), // override wins over keyword
  ];
  const memberships = new Map([
    ['ccccccccccc', [{ title: 'Aerobic Tapes', size: 4 }]],
    ['ddddddddddd', [{ title: 'Grandpa’s Basement', size: 9 }]],
  ]);
  const overrides = { eeeeeeeeeee: { aisle: 'Holiday', year: 1979 } };
  const { catalog } = buildCatalog({ config, overrides, channel, videos, memberships, now: '2026-01-01T00:00:00.000Z' });
  const aisleOf = Object.fromEntries(catalog.videos.map((x) => [x.youtubeId, x.aisle]));
  assert.equal(aisleOf.aaaaaaaaaaa, 'horror');
  assert.equal(aisleOf.bbbbbbbbbbb, 'rare-finds');
  assert.equal(aisleOf.ccccccccccc, 'fitness-and-workout');
  assert.equal(aisleOf.ddddddddddd, 'grandpa-s-basement');
  assert.equal(aisleOf.eeeeeeeeeee, 'holiday');
  assert.equal(catalog.videos.find((x) => x.youtubeId === 'bbbbbbbbbbb').title, 'Some Tape');
  assert.equal(catalog.videos.find((x) => x.youtubeId === 'eeeeeeeeeee').year, 1979);
  assert.equal(catalog.store.channelName, 'Tape Vault');
  assert.deepEqual(validateCatalog(catalog).errors, []);
});

test('buildCatalog skips Shorts, live streams and hidden videos', () => {
  const videos = [
    v('aaaaaaaaaaa', 'Keep me'),
    v('bbbbbbbbbbb', 'Quick clip', { seconds: 40 }),
    v('ccccccccccc', 'Clip #shorts'),
    v('ddddddddddd', 'Live now', { live: true }),
    v('eeeeeeeeeee', 'Secret'),
  ];
  const { catalog, skipped } = buildCatalog({ config, overrides: { eeeeeeeeeee: { hidden: true } }, channel, videos });
  assert.deepEqual(catalog.videos.map((x) => x.youtubeId), ['aaaaaaaaaaa']);
  assert.equal(skipped, 4);
});

test('buildCatalog drops a series suffix that just repeats the aisle name', () => {
  const cfg = { ...config, aisles: [{ name: 'Mystery Tapes', match: ['mystery tapes'] }] };
  const { catalog } = buildCatalog({ config: cfg, channel, videos: [v('aaaaaaaaaaa', "What's on the Dead Grandma Tapes? | Mystery Tapes"), v('bbbbbbbbbbb', 'Mystery Tapes')] });
  assert.deepEqual(catalog.videos.map((x) => x.title), ["What's on the Dead Grandma Tapes?", 'Mystery Tapes']);
});

test('buildCatalog ignores catch-all playlists and strips the channel name', () => {
  const ch = { title: 'brutalmoose', url: 'https://www.youtube.com/brutalmoose' };
  const memberships = new Map([
    ['aaaaaaaaaaa', [{ title: 'The Latest', size: 10 }, { title: 'Game Reviews | brutalmoose', size: 40 }]],
    ['bbbbbbbbbbb', [{ title: 'The Latest', size: 10 }]],
  ]);
  const { catalog } = buildCatalog({
    config,
    channel: ch,
    videos: [v('aaaaaaaaaaa', 'Sonic Shuffle - brutalmoose'), v('bbbbbbbbbbb', 'Fresh upload')],
    memberships,
  });
  const a = catalog.videos.find((x) => x.youtubeId === 'aaaaaaaaaaa');
  assert.equal(a.title, 'Sonic Shuffle');
  assert.equal(catalog.aisles.find((x) => x.id === a.aisle).name, 'Game Reviews');
  assert.equal(catalog.videos.find((x) => x.youtubeId === 'bbbbbbbbbbb').aisle, 'rare-finds');
});

test('store.config.json sorts brutalmoose playlists into the intended aisles', () => {
  const real = JSON.parse(readFileSync(new URL('../../store.config.json', import.meta.url), 'utf8'));
  const ch = { title: 'brutalmoose', url: 'https://www.youtube.com/brutalmoose' };
  const cases = {
    'Mystery Tapes': 'Mystery Tapes',
    'VHS, Film, and TV Reviews | brutalmoose': 'VHS, Film, and TV Reviews',
    'a very brutalmoose christmas': 'Holiday',
    'Televoid! | brutalmoose': 'Televoid!',
    'PC Game Reviews | brutalmoose': 'PC Game Reviews',
    brutalfoods: 'brutalfoods',
  };
  const ids = 'abcdefghijklmnopqrstuvwxyz';
  const videos = Object.keys(cases).map((_, i) => v(ids[i].repeat(11), `Tape ${i}`));
  const memberships = new Map(Object.keys(cases).map((pl, i) => [ids[i].repeat(11), [{ title: pl, size: 5 }]]));
  const { catalog } = buildCatalog({ config: real, channel: ch, videos, memberships });
  const nameOf = (id) => catalog.aisles.find((a) => a.id === id).name;
  Object.values(cases).forEach((want, i) => assert.equal(nameOf(catalog.videos[i].aisle), want, `playlist "${Object.keys(cases)[i]}"`));
});

test('buildCatalog only lists aisles that have tapes', () => {
  const { catalog } = buildCatalog({ config, channel, videos: [v('aaaaaaaaaaa', 'Aerobic Blast')] });
  assert.deepEqual(catalog.aisles.map((a) => a.id), ['fitness-and-workout']);
});
