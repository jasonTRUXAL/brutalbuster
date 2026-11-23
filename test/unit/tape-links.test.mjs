// The share pages the build writes for each tape (scripts/tape-pages.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tapePage } from '../../scripts/tape-pages.mjs';

test('a tape page previews the tape and forwards into the store', () => {
  const html = tapePage({ id: 'abc_DEF-123', youtubeId: 'abc_DEF-123', title: 'Chips <Vol. 4> & "more"', duration: '12:01' }, 'BRUTALBUSTER VIDEO');
  assert.match(html, /<meta property="og:title" content="Chips &lt;Vol\. 4&gt; &amp; &quot;more&quot;">/);
  assert.match(html, /og:image" content="https:\/\/i\.ytimg\.com\/vi\/abc_DEF-123\/hqdefault\.jpg"/);
  assert.match(html, /http-equiv="refresh" content="0; url=\.\.\/\.\.\/\?tape=abc_DEF-123"/);
  assert.match(html, /location\.replace\("\.\.\/\.\.\/\?tape=abc_DEF-123"/);
  assert.match(html, /12:01 · Pick it up/);
  assert.doesNotMatch(html, /<Vol/); // the title is escaped everywhere
});

test('a tape with no thumbnail still gets a plain card', () => {
  const html = tapePage({ id: 'sample-1', youtubeId: null, title: 'Display copy' });
  assert.doesNotMatch(html, /og:image/);
  assert.match(html, /twitter:card" content="summary"/);
});
