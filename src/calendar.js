// What the visitor's own clock and calendar say about the store: the time of day (the
// sky outside the window) and the season (the decorations). The store is open 24 hours,
// so nothing closes; it just looks different. Pure, for the tests; `?time=` and
// `?season=` override both in dev builds.

/** 'dawn' (5–7), 'day' (7–17), 'dusk' (17–20) or 'night', by the local hour. */
export function phaseFor(date = new Date()) {
  const h = date.getHours() + date.getMinutes() / 60;
  if (h >= 5 && h < 7) return 'dawn';
  if (h >= 7 && h < 17) return 'day';
  if (h >= 17 && h < 20) return 'dusk';
  return 'night';
}

export const PHASES = ['dawn', 'day', 'dusk', 'night'];

// [from month, day] to [to month, day], inclusive; a range may run over New Year.
const SEASONS = [
  { id: 'halloween', from: [10, 1], to: [10, 31] },
  { id: 'winter', from: [12, 1], to: [1, 6] },
  { id: 'valentine', from: [2, 1], to: [2, 14] },
];
export const SEASON_IDS = SEASONS.map((s) => s.id);

/** The season's decorations up on `date` ('halloween', 'winter', 'valentine'), or null. */
export function seasonFor(date = new Date()) {
  const md = (date.getMonth() + 1) * 100 + date.getDate();
  for (const s of SEASONS) {
    const a = s.from[0] * 100 + s.from[1];
    const b = s.to[0] * 100 + s.to[1];
    if (a <= b ? md >= a && md <= b : md >= a || md <= b) return s.id;
  }
  return null;
}
