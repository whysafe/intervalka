// Тренировка как последовательность отрезков. Чистые функции без DOM: строятся, считаются и тестируются в Node.

export const PRESETS = {
  tabata: { name: 'Табата', prepare: 10, work: 20, rest: 10, rounds: 8, sets: 1, setRest: 0, cooldown: 0 },
  hiit: { name: 'HIIT 40/20', prepare: 10, work: 40, rest: 20, rounds: 10, sets: 1, setRest: 0, cooldown: 60 },
  emom: { name: 'EMOM 12 минут', prepare: 10, work: 60, rest: 0, rounds: 12, sets: 1, setRest: 0, cooldown: 0 },
  boxing: { name: 'Бокс: 6 раундов', prepare: 15, work: 180, rest: 60, rounds: 6, sets: 1, setRest: 0, cooldown: 0 },
  circuit: { name: 'Круговая: 3 круга', prepare: 10, work: 45, rest: 15, rounds: 5, sets: 3, setRest: 90, cooldown: 120 },
};

export const LIMITS = {
  prepare: [0, 120],
  work: [5, 3600],
  rest: [0, 600],
  rounds: [1, 50],
  sets: [1, 20],
  setRest: [0, 900],
  cooldown: [0, 1800],
};

/** Приводит настройки к допустимым целым значениям; неизвестные поля отбрасываются. */
export function normalize(cfg) {
  const out = {};
  for (const [key, [min, max]] of Object.entries(LIMITS)) {
    const n = Math.round(Number(cfg?.[key]));
    out[key] = Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
  }
  return out;
}

/**
 * Отрезки тренировки. Отдых после последнего раунда подхода не ставится: вместо него
 * отдых между подходами, а после последнего подхода сразу заминка.
 */
export function buildTimeline(cfg) {
  const c = normalize(cfg);
  const segs = [];
  const push = (type, duration, extra = {}) => {
    if (duration > 0) segs.push({ type, duration, ...extra });
  };
  push('prepare', c.prepare);
  for (let set = 1; set <= c.sets; set++) {
    for (let round = 1; round <= c.rounds; round++) {
      push('work', c.work, { round, set });
      if (round < c.rounds) push('rest', c.rest, { round, set });
    }
    if (set < c.sets) push('setRest', c.setRest, { set });
  }
  push('cooldown', c.cooldown);
  let start = 0;
  for (const s of segs) {
    s.start = start;
    start += s.duration;
  }
  return segs;
}

export function totalDuration(segs) {
  return segs.reduce((sum, s) => sum + s.duration, 0);
}

export function workDuration(segs) {
  return segs.filter((s) => s.type === 'work').reduce((sum, s) => sum + s.duration, 0);
}

/**
 * Где мы через elapsed секунд от старта: индекс отрезка, остаток и доля пройденного.
 * Считается от времени, а не тиками, поэтому таймер не уплывает и переживает спящую вкладку.
 */
export function positionAt(segs, elapsed) {
  const total = totalDuration(segs);
  if (elapsed >= total) return { index: segs.length, remaining: 0, progress: 1, done: true };
  const t = Math.max(0, elapsed);
  let lo = 0;
  let hi = segs.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segs[mid].start <= t) lo = mid;
    else hi = mid - 1;
  }
  const seg = segs[lo];
  const into = t - seg.start;
  return { index: lo, remaining: seg.duration - into, progress: into / seg.duration, done: false };
}

/** Секунды для объявления голосом и писка: 3-2-1 перед сменой отрезка. */
export function countdownCue(remaining) {
  const whole = Math.ceil(remaining - 1e-9);
  return whole >= 1 && whole <= 3 ? whole : null;
}

export function formatTime(seconds) {
  const s = Math.max(0, Math.ceil(seconds - 1e-9));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

export const LABELS = {
  prepare: 'Приготовьтесь',
  work: 'Работа',
  rest: 'Отдых',
  setRest: 'Отдых между кругами',
  cooldown: 'Заминка',
};

/** Компактная строка для ссылки: 10-20-10-8-1-0-0. Порядок полей совпадает с LIMITS. */
export function encode(cfg) {
  const c = normalize(cfg);
  return Object.keys(LIMITS).map((k) => c[k]).join('-');
}

export function decode(text) {
  const parts = String(text ?? '').split('-');
  const keys = Object.keys(LIMITS);
  if (parts.length !== keys.length || parts.some((p) => !/^\d+$/.test(p))) return null;
  return normalize(Object.fromEntries(keys.map((k, i) => [k, Number(parts[i])])));
}
