// Self-hosted retro fonts. Canvas text only renders a webfont once it has loaded,
// so loadFonts() must resolve before any cover / sign textures are drawn.
import '@fontsource/bebas-neue/400.css';
import '@fontsource/anton/400.css';
import '@fontsource/bungee/400.css';
import '@fontsource/righteous/400.css';
import '@fontsource/monoton/400.css';
import '@fontsource/permanent-marker/400.css';
import '@fontsource/vt323/400.css';
import '@fontsource/press-start-2p/400.css';
import '@fontsource/archivo-narrow/400.css';
import '@fontsource/archivo-narrow/700.css';

export const FONT = {
  bebas: '"Bebas Neue", Impact, sans-serif',
  anton: 'Anton, Impact, sans-serif',
  bungee: 'Bungee, Impact, sans-serif',
  righteous: 'Righteous, sans-serif',
  monoton: 'Monoton, sans-serif',
  marker: '"Permanent Marker", cursive',
  vt: 'VT323, monospace',
  pixel: '"Press Start 2P", monospace',
  narrow: '"Archivo Narrow", "Arial Narrow", sans-serif',
};

export async function loadFonts() {
  const specs = [
    `48px ${FONT.bebas}`,
    `48px ${FONT.anton}`,
    `48px ${FONT.bungee}`,
    `48px ${FONT.righteous}`,
    `48px ${FONT.monoton}`,
    `48px ${FONT.marker}`,
    `48px ${FONT.vt}`,
    `48px ${FONT.pixel}`,
    `48px ${FONT.narrow}`,
    `700 48px ${FONT.narrow}`,
  ];
  await Promise.all(specs.map((s) => document.fonts.load(s, 'AZaz09').catch(() => null)));
}
