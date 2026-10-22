import {
  LABELS, LIMITS, PRESETS, buildTimeline, countdownCue, decode, encode, formatTime, normalize, positionAt,
  totalDuration, workDuration,
} from './timeline.js';

const $ = (id) => document.getElementById(id);
const STORE = 'intervalka';
const CIRC = 2 * Math.PI * 100;

const storage = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(`${STORE}:${key}`);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(`${STORE}:${key}`, JSON.stringify(value));
    } catch {
      // приватный режим: настройки живут до закрытия вкладки
    }
  },
};

// ---------- Настройки ----------

let cfg = decode(location.hash.slice(1)) ?? storage.get('last', null) ?? normalize(PRESETS.tabata);
cfg = normalize(cfg);

const STEP = { prepare: 5, work: 5, rest: 5, rounds: 1, sets: 1, setRest: 15, cooldown: 30 };

function show(key, value) {
  return document.querySelector(`.field[data-key="${key}"]`).dataset.unit === 'count' ? String(value) : formatTime(value);
}

function buildSteppers() {
  for (const field of document.querySelectorAll('.field')) {
    const key = field.dataset.key;
    const box = document.createElement('div');
    box.className = 'stepper';
    const minus = Object.assign(document.createElement('button'), { type: 'button', textContent: '−' });
    const plus = Object.assign(document.createElement('button'), { type: 'button', textContent: '+' });
    minus.setAttribute('aria-label', `Уменьшить: ${field.textContent.trim()}`);
    plus.setAttribute('aria-label', `Увеличить: ${field.textContent.trim()}`);
    const out = document.createElement('output');
    out.id = `out-${key}`;
    box.append(minus, out, plus);
    field.append(box);
    const change = (dir) => {
      const [min, max] = LIMITS[key];
      const step = key === 'work' && cfg.work >= 60 ? 15 : STEP[key];
      cfg = { ...cfg, [key]: Math.min(max, Math.max(min, cfg[key] + dir * step)) };
      onConfigChange();
    };
    holdRepeat(minus, () => change(-1));
    holdRepeat(plus, () => change(1));
  }
}

/** Кнопка повторяет действие, пока её держат: удобно листать минуты. */
function holdRepeat(button, action) {
  let timer = 0;
  const stop = () => clearTimeout(timer);
  button.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    action();
    let delay = 400;
    const loop = () => {
      action();
      delay = Math.max(60, delay * 0.8);
      timer = setTimeout(loop, delay);
    };
    timer = setTimeout(loop, delay);
  });
  for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) button.addEventListener(ev, stop);
  button.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      action();
    }
  });
}

function renderPresets() {
  const box = $('presets');
  box.replaceChildren(...Object.entries(PRESETS).map(([id, p]) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = p.name;
    b.dataset.id = id;
    b.addEventListener('click', () => {
      cfg = normalize(p);
      onConfigChange();
    });
    return b;
  }));
}

function renderConfig() {
  for (const key of Object.keys(LIMITS)) $(`out-${key}`).textContent = show(key, cfg[key]);
  const segs = buildTimeline(cfg);
  const total = totalDuration(segs);
  $('summary').innerHTML = `<span>Всего <b>${formatTime(total)}</b></span><span>Под нагрузкой <b>${formatTime(workDuration(segs))}</b></span>`;
  $('timelineBar').replaceChildren(...segs.map((s) => {
    const i = document.createElement('i');
    i.className = `t-${s.type}`;
    i.style.flexGrow = String(s.duration);
    return i;
  }));
  const code = encode(cfg);
  for (const b of $('presets').children) {
    b.setAttribute('aria-pressed', String(encode(PRESETS[b.dataset.id]) === code));
  }
}

function onConfigChange() {
  storage.set('last', cfg);
  history.replaceState(null, '', `#${encode(cfg)}`);
  renderConfig();
}

// ---------- Сохранённые тренировки ----------

function renderSaved() {
  const list = storage.get('saved', []);
  const ul = $('savedList');
  if (!list.length) {
    ul.innerHTML = '<li class="empty">Пока пусто. Настройте тренировку и нажмите «Сохранить текущую».</li>';
    return;
  }
  ul.replaceChildren(...list.map((item, i) => {
    const li = document.createElement('li');
    const load = document.createElement('button');
    load.className = 'load';
    load.type = 'button';
    load.textContent = item.name;
    const small = document.createElement('small');
    small.textContent = formatTime(totalDuration(buildTimeline(item.cfg)));
    load.append(small);
    load.addEventListener('click', () => {
      cfg = normalize(item.cfg);
      onConfigChange();
      toast(`Загружено: ${item.name}`);
    });
    const del = document.createElement('button');
    del.className = 'del';
    del.type = 'button';
    del.textContent = '✕';
    del.setAttribute('aria-label', `Удалить ${item.name}`);
    del.addEventListener('click', () => {
      const next = storage.get('saved', []);
      next.splice(i, 1);
      storage.set('saved', next);
      renderSaved();
    });
    li.append(load, del);
    return li;
  }));
}

$('saveBtn').addEventListener('click', () => {
  const name = prompt('Название тренировки', `Работа ${cfg.work} / отдых ${cfg.rest} × ${cfg.rounds}`);
  if (!name || !name.trim()) return;
  const list = storage.get('saved', []);
  list.unshift({ name: name.trim().slice(0, 60), cfg });
  storage.set('saved', list.slice(0, 20));
  renderSaved();
});

$('shareBtn').addEventListener('click', async () => {
  const url = `${location.origin}${location.pathname}#${encode(cfg)}`;
  try {
    if (navigator.share) await navigator.share({ title: 'Интервалка', url });
    else {
      await navigator.clipboard.writeText(url);
      toast('Ссылка скопирована');
    }
  } catch {
    // пользователь закрыл окно «Поделиться»
  }
});

let toastTimer = 0;
function toast(text) {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 1800);
}

// ---------- Звук, голос, вибрация ----------

const opts = storage.get('opts', { voice: true, beep: true, vibrate: true });
for (const [key, id] of [['voice', 'optVoice'], ['beep', 'optBeep'], ['vibrate', 'optVibrate']]) {
  $(id).checked = opts[key];
  $(id).addEventListener('change', (e) => {
    opts[key] = e.target.checked;
    storage.set('opts', opts);
  });
}
let muted = false;

let audio = null;
function beep(freq = 880, duration = 0.12) {
  if (!opts.beep || muted) return;
  audio ??= new (window.AudioContext || window.webkitAudioContext)();
  const osc = audio.createOscillator();
  const gain = audio.createGain();
  osc.frequency.value = freq;
  osc.type = 'sine';
  gain.gain.setValueAtTime(0.0001, audio.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.4, audio.currentTime + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, audio.currentTime + duration);
  osc.connect(gain).connect(audio.destination);
  osc.start();
  osc.stop(audio.currentTime + duration + 0.02);
}

const WORDS = { 1: 'один', 2: 'два', 3: 'три' };
function say(text) {
  if (!opts.voice || muted || !('speechSynthesis' in window)) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.lang = 'ru-RU';
  u.rate = 1.1;
  speechSynthesis.speak(u);
}

function vibrate(pattern) {
  if (opts.vibrate && navigator.vibrate) navigator.vibrate(pattern);
}

// Экран не гаснет, пока идёт тренировка.
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) {
      await wakeLock.release();
      wakeLock = null;
    }
  } catch {
    // нет разрешения или вкладка в фоне
  }
}

// ---------- Тренировка ----------

let segs = [];
let startAt = 0; // момент старта в performance.now(), сдвигается при паузе и перемотке
let pausedAt = 0;
let paused = false;
let lastIndex = -1;
let lastCue = null;
let loop = 0;

function elapsed() {
  return ((paused ? pausedAt : performance.now()) - startAt) / 1000;
}

function start() {
  segs = buildTimeline(cfg);
  startAt = performance.now();
  paused = false;
  lastIndex = -1;
  lastCue = null;
  $('setup').hidden = true;
  $('run').hidden = false;
  $('done').hidden = true;
  document.body.classList.remove('paused');
  $('runTotal').textContent = `Всего ${formatTime(totalDuration(segs))}`;
  keepAwake(true);
  beep(660, 0.05); // разблокирует звук на iOS: первый звук должен быть по нажатию
  clearInterval(loop);
  // Интервал, а не requestAnimationFrame: rAF в фоновой вкладке останавливается, и сигналы бы пропали.
  // Время всё равно считается от точки старта, поэтому частота тиков на точность не влияет.
  loop = setInterval(tick, 100);
  tick();
}

function stop() {
  clearInterval(loop);
  keepAwake(false);
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  document.body.dataset.phase = '';
  $('run').hidden = true;
  $('setup').hidden = false;
}

function setPaused(value) {
  if (value === paused) return;
  if (value) pausedAt = performance.now();
  else startAt += performance.now() - pausedAt;
  paused = value;
  document.body.classList.toggle('paused', paused);
  $('pauseBtn').textContent = paused ? '▶' : '❚❚';
  $('pauseBtn').setAttribute('aria-label', paused ? 'Продолжить' : 'Пауза');
  keepAwake(!paused);
}

/** Перемотка на начало отрезка: сдвигаем точку старта, а не таймер. */
function jumpTo(index) {
  const i = Math.max(0, Math.min(segs.length, index));
  const target = i < segs.length ? segs[i].start : totalDuration(segs);
  startAt = (paused ? pausedAt : performance.now()) - target * 1000;
  lastCue = null;
}

function describe(seg) {
  if (!seg) return '';
  const base = LABELS[seg.type];
  return seg.type === 'work' || seg.type === 'rest' ? `${base} · раунд ${seg.round}/${cfg.rounds}` : base;
}

function onSegmentStart(seg) {
  if (!seg) return;
  if (seg.type === 'work') {
    beep(1046, 0.35);
    vibrate([200]);
    say('Работа');
  } else if (seg.type === 'rest' || seg.type === 'setRest') {
    beep(523, 0.35);
    vibrate([100, 80, 100]);
    say(seg.type === 'setRest' ? 'Отдых между кругами' : 'Отдых');
  } else if (seg.type === 'cooldown') {
    beep(523, 0.35);
    say('Заминка');
  }
}

function finish() {
  clearInterval(loop);
  keepAwake(false);
  beep(784, 0.15);
  setTimeout(() => beep(1046, 0.4), 180);
  vibrate([300, 100, 300]);
  say('Тренировка окончена. Отлично!');
  const s = buildTimeline(cfg);
  $('doneText').textContent = `${formatTime(totalDuration(s))} тренировки, из них ${formatTime(workDuration(s))} под нагрузкой.`;
  $('done').hidden = false;
  document.body.dataset.phase = 'rest';
}

function tick() {
  const pos = positionAt(segs, elapsed());
  if (pos.done) {
    finish();
    return;
  }
  const seg = segs[pos.index];
  if (pos.index !== lastIndex) {
    if (lastIndex !== -1 || seg.type !== 'prepare') onSegmentStart(seg);
    else say('Приготовьтесь');
    lastIndex = pos.index;
    lastCue = null;
  }
  const cue = countdownCue(pos.remaining);
  if (cue && cue !== lastCue && !paused) {
    lastCue = cue;
    beep(880, 0.08);
    if (seg.duration >= 8) say(WORDS[cue]);
  }

  document.body.dataset.phase = seg.type;
  $('phase').textContent = LABELS[seg.type];
  $('clock').textContent = formatTime(pos.remaining);
  $('round').textContent = seg.round
    ? `Раунд ${seg.round} из ${cfg.rounds}${cfg.sets > 1 ? ` · круг ${seg.set} из ${cfg.sets}` : ''}`
    : '';
  $('arc').style.strokeDashoffset = String(CIRC * pos.progress);
  const nextSeg = segs[pos.index + 1];
  $('next').innerHTML = nextSeg ? `Дальше: <b>${describe(nextSeg)}</b>, ${formatTime(nextSeg.duration)}` : 'Последний отрезок';
  $('progress').style.width = `${(elapsed() / totalDuration(segs)) * 100}%`;
}

$('startBtn').addEventListener('click', start);
$('againBtn').addEventListener('click', start);
$('backBtn').addEventListener('click', stop);
$('exitBtn').addEventListener('click', () => {
  if (paused || confirm('Завершить тренировку?')) stop();
});
$('pauseBtn').addEventListener('click', () => setPaused(!paused));
$('skipBtn').addEventListener('click', () => jumpTo(positionAt(segs, elapsed()).index + 1));
$('prevBtn').addEventListener('click', () => {
  const pos = positionAt(segs, elapsed());
  // Как в плеерах: в первые 2 секунды отрезка — на предыдущий, иначе в начало текущего.
  const into = segs[pos.index] ? elapsed() - segs[pos.index].start : 0;
  jumpTo(into < 2 ? pos.index - 1 : pos.index);
});
$('soundBtn').addEventListener('click', () => {
  muted = !muted;
  $('soundBtn').textContent = muted ? '🔇' : '🔊';
  if (muted && 'speechSynthesis' in window) speechSynthesis.cancel();
});

document.addEventListener('keydown', (e) => {
  if ($('run').hidden) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPaused(!paused);
  } else if (e.code === 'ArrowRight') $('skipBtn').click();
  else if (e.code === 'ArrowLeft') $('prevBtn').click();
  else if (e.code === 'Escape') $('exitBtn').click();
});

// Wake Lock снимается, когда вкладка уходит в фон; возвращаем его при возврате.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !$('run').hidden && !paused) keepAwake(true);
});

window.addEventListener('hashchange', () => {
  const fromLink = decode(location.hash.slice(1));
  if (fromLink && encode(fromLink) !== encode(cfg)) {
    cfg = fromLink;
    onConfigChange();
  }
});

// ---------- PWA ----------

if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
window.addEventListener('beforeinstallprompt', () => { $('installHint').hidden = false; });

buildSteppers();
renderPresets();
renderSaved();
onConfigChange();
