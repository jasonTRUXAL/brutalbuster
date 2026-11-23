// The membership card: tokens for coming back each day (with a streak bonus that tops
// out), for watching tapes in the lounge, and the card's rental history. Kept in this
// browser for now (localStorage, through the `storage` you hand it), as one small JSON
// record, so it could later be synced to a server for sign-in accounts. Every token that
// changes hands goes through earn(), which also keeps a short log.
// Pure apart from the storage and clock you pass in: the unit tests drive it directly.

export const REWARDS = {
  WELCOME: 25, // the first visit ever
  VISIT: 10, // the first visit each day (the visitor's own midnight)
  STREAK_STEP: 5, // + this for each day in a row after the first…
  STREAK_CAP: 25, // …up to this much (day 6 onwards: 10 + 25 = 35 a day)
  // one-off bonuses on reaching a streak
  MILESTONES: { 7: 50, 30: 200, 100: 500, 365: 1500 },
  WATCH_MINUTES: 5, // a token for every 5 minutes a tape plays in the lounge…
  WATCH_DAILY_CAP: 12, // …up to an hour's worth a day
  FINISH: 5, // watching a tape to the end
  FINISH_DAILY_CAP: 3,
  RETURN: 1, // returning a tape through the drop box
  RETURN_DAILY_CAP: 5,
};

const KEY = 'bb.member';
const HISTORY = 40;
const LOG = 30;
const STAMPS = 28;

/** The visitor's local calendar day, as 'YYYY-MM-DD'. */
export function dayKey(now) {
  const d = new Date(now);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Whole days from one day key to another. */
export function daysBetween(a, b) {
  const n = (k) => {
    const [y, m, d] = k.split('-').map(Number);
    return Date.UTC(y, m - 1, d) / 86400000;
  };
  return Math.round(n(b) - n(a));
}

/** What a day's visit adds for the streak (on top of REWARDS.VISIT). */
export const streakBonus = (streak) => Math.min(REWARDS.STREAK_CAP, Math.max(0, streak - 1) * REWARDS.STREAK_STEP);

function fresh(now, random) {
  return {
    v: 1,
    memberNo: String(Math.floor(random() * 9e7) + 1e7),
    since: new Date(now).toISOString(),
    tokens: 0,
    earned: 0,
    visits: 0,
    streak: 0,
    best: 0,
    lastDay: null,
    stamps: [], // the days you came in (the latest STAMPS)
    today: null, // { day, watchSec, watchTokens, finishes, returns }
    watchSec: 0, // all time
    finished: 0,
    history: [], // { id, title, area, at, watchSec, finished } newest first
    log: [], // { at, kind, amount, note } newest first
  };
}

export class Membership {
  /**
   * `storage` is localStorage or anything like it (getItem / setItem). It may throw (a
   * private window): then the card still works for this visit, it just isn't kept.
   */
  constructor({ storage = null, random = Math.random } = {}) {
    this.storage = storage;
    this.random = random;
    this.state = null;
    this.onEarn = null; // (event) — for the toast
    this.onChange = null;
  }

  load(now = Date.now()) {
    let s = null;
    try {
      s = JSON.parse(this.storage?.getItem(KEY) || 'null');
    } catch {
      s = null;
    }
    this.state = s?.v === 1 ? { ...fresh(now, this.random), ...s } : fresh(now, this.random);
    return this;
  }

  save() {
    try {
      this.storage?.setItem(KEY, JSON.stringify(this.state));
    } catch {
      // private browsing / storage full: keep going without it
    }
    this.onChange?.(this.state);
  }

  _today(now) {
    const day = dayKey(now);
    if (this.state.today?.day !== day) this.state.today = { day, watchSec: 0, watchTokens: 0, finishes: 0, returns: 0 };
    return this.state.today;
  }

  /** Add (or, with a negative amount, spend) tokens, and say so. */
  earn(amount, kind, note, now) {
    const s = this.state;
    s.tokens = Math.max(0, s.tokens + amount);
    if (amount > 0) s.earned += amount;
    s.log.unshift({ at: new Date(now).toISOString(), kind, amount, note });
    s.log.length = Math.min(s.log.length, LOG);
    const event = { kind, amount, note, tokens: s.tokens };
    this.onEarn?.(event);
    return event;
  }

  /**
   * Walking in. The first time each day it pays out the visit, the streak bonus and any
   * streak milestone; later the same day it does nothing. Returns what was earned.
   */
  visit(now = Date.now()) {
    const s = this.state;
    const day = dayKey(now);
    if (s.lastDay === day) return [];
    const events = [];
    if (s.visits === 0) events.push(this.earn(REWARDS.WELCOME, 'welcome', 'Welcome to the club', now));
    const gap = s.lastDay ? daysBetween(s.lastDay, day) : null;
    s.streak = gap === 1 ? s.streak + 1 : 1;
    s.best = Math.max(s.best, s.streak);
    s.visits++;
    s.lastDay = day;
    s.stamps = [day, ...s.stamps.filter((d) => d !== day)].slice(0, STAMPS);
    const bonus = streakBonus(s.streak);
    events.push(this.earn(REWARDS.VISIT + bonus, 'visit', s.streak > 1 ? `Day ${s.streak} in a row` : 'Daily visit', now));
    const milestone = REWARDS.MILESTONES[s.streak];
    if (milestone) events.push(this.earn(milestone, 'milestone', `${s.streak}-day streak!`, now));
    this.save();
    return events;
  }

  /**
   * A tape went into the lounge's VCR: it goes on the card's rental history (the same
   * entry as its checkout, if you rented it at the counter first).
   */
  rent(video, now = Date.now()) {
    const s = this.state;
    const top = s.history[0];
    if (top?.id === video.id && top.checkedOut && !top.watched) {
      top.watched = true;
      this.save();
      return;
    }
    s.history.unshift({ id: video.id, title: video.title, area: video.area || null, at: new Date(now).toISOString(), watchSec: 0, finished: false, watched: true });
    s.history.length = Math.min(s.history.length, HISTORY);
    this.save();
  }

  /** Checked out at the counter: on the rental history, with a slip. */
  checkout(video, now = Date.now()) {
    const s = this.state;
    s.checkouts = (s.checkouts || 0) + 1;
    s.history.unshift({ id: video.id, title: video.title, area: video.area || null, at: new Date(now).toISOString(), watchSec: 0, finished: false, checkedOut: true, watched: false });
    s.history.length = Math.min(s.history.length, HISTORY);
    this.save();
  }

  /**
   * `seconds` of the tape in the VCR played (not paused). Every REWARDS.WATCH_MINUTES of
   * it, up to the day's cap, is a token. Saved now and then, not every frame.
   */
  watch(seconds, now = Date.now()) {
    const s = this.state;
    const t = this._today(now);
    t.watchSec += seconds;
    s.watchSec += seconds;
    if (s.history[0]) s.history[0].watchSec += seconds;
    const due = Math.min(REWARDS.WATCH_DAILY_CAP, Math.floor(t.watchSec / (REWARDS.WATCH_MINUTES * 60)));
    let event = null;
    if (due > t.watchTokens) {
      event = this.earn(due - t.watchTokens, 'watch', `${REWARDS.WATCH_MINUTES} minutes in the lounge`, now);
      t.watchTokens = due;
    }
    if (event || (this._unsaved = (this._unsaved || 0) + seconds) >= 15) {
      this._unsaved = 0;
      this.save();
    }
    return event;
  }

  /** The tape in the VCR played to the end. */
  finish(video, now = Date.now()) {
    const s = this.state;
    const t = this._today(now);
    const h = s.history.find((e) => e.id === video.id);
    if (h) h.finished = true;
    s.finished++;
    let event = null;
    if (t.finishes < REWARDS.FINISH_DAILY_CAP) {
      t.finishes++;
      event = this.earn(REWARDS.FINISH, 'finish', 'Watched to the end', now);
    }
    this.save();
    return event;
  }

  /** A tape went back through the drop box. */
  returned(video, now = Date.now()) {
    const t = this._today(now);
    let event = null;
    if (t.returns < REWARDS.RETURN_DAILY_CAP) {
      t.returns++;
      event = this.earn(REWARDS.RETURN, 'return', 'Be kind, rewind', now);
      this.save();
    }
    return event;
  }

  /** Spend tokens (the prize corner, later). False if there aren't enough. */
  spend(amount, note, now = Date.now()) {
    if (this.state.tokens < amount) return false;
    this.earn(-amount, 'spend', note, now);
    this.save();
    return true;
  }
}
