/* ============================================================================
 * FlowStream — a productivity-only, distraction-free video learning platform.
 * Vanilla JS, zero build step. Runs from any static server (incl. GitHub Pages).
 *
 * Data contracts (written by a sibling agent; we fetch defensively):
 *   data/curriculum.json -> { curriculum: { id, title, tagline, sampleNotice,
 *     focusWindowMinutes, lessons: [...], skillTree: { nodes: [...] } } }
 *   data/glossary.json    -> { profiles: [...],
 *     terms: [{ term, definition, analogies: { general, culinary, ... } }] }
 *
 * All persistent state lives in localStorage under keys prefixed "flowstream.".
 * No telemetry, no login, no external API keys (BYOK is user-supplied & optional).
 * ========================================================================== */
'use strict';

/* ============================== 1. Utilities ============================ */

/** Query helpers. */
const $  = (sel, el) => (el || document).querySelector(sel);
const $$ = (sel, el) => Array.from((el || document).querySelectorAll(sel));

/** Escape a string for safe insertion into HTML. */
function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Escape a string for use inside a RegExp. */
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Seconds -> "m:ss" or "h:mm:ss". */
function fmtTime(sec) {
  sec = Math.max(0, Math.floor(sec || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, '0') : String(m);
  return (h > 0 ? h + ':' : '') + mm + ':' + String(s).padStart(2, '0');
}

/** "mm:ss" timestamp anchor used by the notes panel. */
function fmtAnchor(sec) {
  return '[' + fmtTime(sec) + ']';
}

/** Trigger a browser download of a text file. */
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 400);
}

/** Copy text to the clipboard, with a legacy fallback. Returns a Promise<boolean>. */
function copyText(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    return navigator.clipboard.writeText(text).then(() => true).catch(() => legacyCopy(text));
  }
  return Promise.resolve(legacyCopy(text));
}
function legacyCopy(text) {
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch (e) { return false; }
}

/** Toast notification. kind: '' | 'accent' | 'warn'. */
let toastTimer = null;
function toast(msg, kind) {
  const box = $('#toasts');
  const el = document.createElement('div');
  el.className = 'toast' + (kind ? ' ' + kind : '');
  el.textContent = msg;
  box.appendChild(el);
  // Keep the stack small — no infinite toasts.
  while (box.children.length > 3) box.firstChild.remove();
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    $$('.toast', box).forEach(t => t.remove());
  }, 4200);
}

/** Simple debounce. */
function debounce(fn, ms) {
  let t = null;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

/* ====================== 2. Persistent store (localStorage) =============== */
/* Every key is namespaced "flowstream.*". Wipe only touches our own keys.   */

const Store = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      return JSON.parse(raw);
    } catch (e) { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); }
    catch (e) { /* storage full / private mode — app still works in-memory */ }
  },
  del(key) {
    try { localStorage.removeItem(key); } catch (e) {}
  },
  /** Remove every flowstream.* key (used by "Erase all local data"). */
  wipe() {
    try {
      const doomed = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf('flowstream.') === 0) doomed.push(k);
      }
      doomed.forEach(k => localStorage.removeItem(k));
    } catch (e) {}
  }
};

const K = {
  profile:  'flowstream.profile',      // 'general' | 'culinary' | 'music' | 'sports' | 'finance'
  progress: 'flowstream.progress',     // { lessonId: {quizPassed, quizBest, quizAttempts, deliverableDone, watchedSec, recallAnswered} }
  efficacy: 'flowstream.efficacy',     // { lessonId: {attempts, passes} } — local quiz outcomes
  notes:    'flowstream.notes',        // { lessonId: markdown string }
  cards:    'flowstream.flashcards',   // { lessonId: [{front, back, custom}] } — user-created cards
  credits:  'flowstream.credits',      // { balance: number }
  ledger:   'flowstream.ledger',       // { stakes: [{amount, deadlineISO, status}], charityPool: number }
  byok:     'flowstream.byok',         // { baseUrl, model, key }
  fluff:    'flowstream.fluffBypass',  // boolean
  pacing:   'flowstream.pacing',       // 0..3 slider value
  session:  'flowstream.session'       // active focus session or null
};

/** Per-lesson progress record, created on demand. */
function progressFor(lessonId) {
  const all = Store.get(K.progress, {});
  if (!all[lessonId]) {
    all[lessonId] = {
      quizPassed: false, quizBest: 0, quizAttempts: 0,
      deliverableDone: false, watchedSec: 0, recallAnswered: 0
    };
    Store.set(K.progress, all);
  }
  return all[lessonId];
}
function saveProgress(lessonId, patch) {
  const all = Store.get(K.progress, {});
  all[lessonId] = Object.assign(progressFor(lessonId), patch);
  Store.set(K.progress, all);
}

/* ============================== 3. Data loading ========================== */

let CUR = null;        // curriculum object
let GLOSS = null;      // glossary object
let DATA_ERROR = '';   // human-readable load error, if any

async function loadData() {
  let curErr = '', glossErr = '';
  try {
    const res = await fetch('data/curriculum.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    CUR = data && data.curriculum ? data.curriculum : null;
    if (!CUR) throw new Error('missing "curriculum" root key');
  } catch (e) {
    curErr = 'Could not load data/curriculum.json (' + (e && e.message ? e.message : e) + ').';
  }
  try {
    const res = await fetch('data/glossary.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    GLOSS = data || null;
    if (!GLOSS || !Array.isArray(GLOSS.terms)) throw new Error('missing "terms" array');
  } catch (e) {
    glossErr = 'Could not load data/glossary.json (' + (e && e.message ? e.message : e) + ').';
    GLOSS = { profiles: ['general', 'culinary', 'music', 'sports', 'finance'], terms: [] };
  }
  if (curErr) DATA_ERROR = curErr + (glossErr ? ' ' + glossErr : '');
  else if (glossErr) DATA_ERROR = glossErr; // glossary is non-fatal: jargon features degrade
}

function lessons() {
  if (!CUR || !Array.isArray(CUR.lessons)) return [];
  return CUR.lessons.slice().sort((a, b) => (a.order || 0) - (b.order || 0));
}
function lessonById(id) {
  return lessons().find(l => l.id === id) || null;
}
function treeNodes() {
  if (!CUR || !CUR.skillTree || !Array.isArray(CUR.skillTree.nodes)) return [];
  return CUR.skillTree.nodes;
}
function glossaryTerms() {
  if (!GLOSS || !Array.isArray(GLOSS.terms)) return [];
  return GLOSS.terms;
}
function glossaryProfiles() {
  if (GLOSS && Array.isArray(GLOSS.profiles) && GLOSS.profiles.length) return GLOSS.profiles;
  return ['general', 'culinary', 'music', 'sports', 'finance'];
}

/* Lesson order -> skill-tree node mapping (per product spec).
 * l1,l2 -> py-dicts · l3,l4 -> py-dict-methods · l5 -> py-pipelines.
 * Built dynamically so unknown orders / node ids degrade gracefully. */
const ORDER_TO_NODE = { 1: 'py-dicts', 2: 'py-dicts', 3: 'py-dict-methods', 4: 'py-dict-methods', 5: 'py-pipelines' };
function nodeIdForLesson(lesson) {
  const id = ORDER_TO_NODE[lesson.order];
  if (id && treeNodes().some(n => n.id === id)) return id;
  return null;
}
function lessonsForNode(nodeId) {
  return lessons().filter(l => nodeIdForLesson(l) === nodeId);
}

/* Blended efficacy: seed pass-rate blended with this device's quiz outcomes. */
function efficacy(lesson) {
  const seed = lesson.efficacySeed || {};
  const local = (Store.get(K.efficacy, {})[lesson.id]) || { attempts: 0, passes: 0 };
  const attempts = (seed.quizAttempts || 0) + (local.attempts || 0);
  const passes = (seed.quizPasses || 0) + (local.passes || 0);
  return { rate: attempts > 0 ? passes / attempts : 0, attempts, passes };
}
function recordQuizAttempt(lessonId, passed) {
  const all = Store.get(K.efficacy, {});
  const rec = all[lessonId] || { attempts: 0, passes: 0 };
  rec.attempts += 1;
  if (passed) rec.passes += 1;
  all[lessonId] = rec;
  Store.set(K.efficacy, all);
}

/* ============================== 4. Router ================================ */
/* Hash routes: '' or '#/' -> library · '#/lesson/<id>' -> player · '#/tree' -> skill tree */

const VIEWS = ['landing', 'lesson', 'tree'];

function showView(name) {
  VIEWS.forEach(v => $('#view-' + v).classList.toggle('active', v === name));
  $('#navLibrary').classList.toggle('active', name === 'landing');
  $('#navTree').classList.toggle('active', name === 'tree');
  window.scrollTo(0, 0);
}

function route() {
  const hash = window.location.hash || '#/';
  const m = hash.match(/^#\/lesson\/(.+)$/);
  if (m) {
    const lesson = lessonById(decodeURIComponent(m[1]));
    if (lesson) { renderLesson(lesson); return; }
    // Unknown lesson id -> fall back to library with a notice.
    window.location.hash = '#/';
    toast('Lesson not found.', 'warn');
    return;
  }
  if (hash === '#/tree') { renderTree(); return; }
  renderLanding();
}

/* ====================== 5. Header (global chrome) ======================== */

function profileLabel(p) {
  return p.charAt(0).toUpperCase() + p.slice(1);
}

function initHeader() {
  // Background-profile selector drives jargon analogies. Stored locally.
  const sel = $('#profileSelect');
  sel.innerHTML = '';
  glossaryProfiles().forEach(p => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = profileLabel(p);
    sel.appendChild(opt);
  });
  const saved = Store.get(K.profile, 'general');
  sel.value = glossaryProfiles().includes(saved) ? saved : 'general';
  sel.addEventListener('change', () => {
    Store.set(K.profile, sel.value);
    toast('Analogy background: ' + profileLabel(sel.value), 'accent');
    // Re-render transcript jargon tooltips context on the lesson view.
    if ($('#view-lesson').classList.contains('active')) route();
  });

  $('#creditsChip').addEventListener('click', openPactModal);
  $('#focusBtn').addEventListener('click', openFocusModal);
  $('#settingsBtn').addEventListener('click', openSettingsModal);
  updateCreditsChip();
}

function updateCreditsChip() {
  const bal = Store.get(K.credits, { balance: 100 }).balance;
  $('#creditsBalance').textContent = bal;
}

/** Sample-notice banner. Landing shows the curriculum notice; lessons get their own. */
function setSampleBanner(text) {
  const b = $('#sampleBanner');
  if (text) { b.hidden = false; b.textContent = text; }
  else { b.hidden = true; b.textContent = ''; }
}

/* ====================== 6. Landing: search + tracks ====================== */
/* No feed, ever. Just: big blank search bar, pacing slider, track cards.    */

const PACING_LABELS = ['Any depth', 'Quick Fix', 'Balanced', 'Deep Dive'];
const PACING_VALUES = ['any', 'quick', 'balanced', 'deep'];

function renderLanding() {
  if (!CUR) { renderDataError($('#view-landing')); showView('landing'); return; }
  setSampleBanner(CUR.sampleNotice || '');
  $('#curriculumTitle').textContent = CUR.title || 'FlowStream';
  $('#curriculumTagline').textContent = CUR.tagline || 'Distraction-free video learning.';

  // Restore pacing slider.
  const slider = $('#pacingSlider');
  slider.value = String(Store.get(K.pacing, 0));
  $('#pacingValue').textContent = PACING_LABELS[Number(slider.value)] || PACING_LABELS[0];

  renderTracks();
  renderSearchResults(); // reflects current query (empty -> hint)
  showView('landing');
}

function renderDataError(viewEl) {
  setSampleBanner('');
  viewEl.innerHTML =
    '<div class="error-state"><h2>Couldn’t load the curriculum</h2>' +
    '<p>' + esc(DATA_ERROR || 'Unknown error.') + '</p>' +
    '<p style="color:var(--text-dim);font-size:0.9rem">FlowStream needs ' +
    '<code>docs/data/curriculum.json</code> next to this page. ' +
    'Check that the file exists and is valid JSON, then reload.</p></div>';
  showView(viewEl.id.replace('view-', ''));
}

/** Learning Tracks: one card per skill-tree node + the curriculum card. */
function renderTracks() {
  const grid = $('#tracksGrid');
  grid.innerHTML = '';
  const nodes = treeNodes();

  nodes.forEach(node => {
    const status = nodeStatus(node.id);
    const mapped = lessonsForNode(node.id);
    const card = document.createElement('div');
    card.className = 'track-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML =
      '<h3>' + esc(node.title) + '</h3>' +
      '<p class="creator">Track · ' + esc(status.replace('-', ' ')) + '</p>' +
      '<p class="skill">' + mapped.length + ' lesson' + (mapped.length === 1 ? '' : 's') + '</p>';
    const go = () => trackCardGo(node, mapped);
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    grid.appendChild(card);
  });

  // The curriculum card.
  const all = lessons();
  const cur = document.createElement('div');
  cur.className = 'track-card';
  cur.setAttribute('role', 'button');
  cur.setAttribute('tabindex', '0');
  cur.innerHTML =
    '<h3>' + esc(CUR.title || 'Full curriculum') + '</h3>' +
    '<p class="creator">' + esc(CUR.tagline || '') + '</p>' +
    '<p class="skill">' + all.length + ' lessons · skill tree overview</p>';
  const goCur = () => { window.location.hash = '#/tree'; };
  cur.addEventListener('click', goCur);
  cur.addEventListener('keydown', e => { if (e.key === 'Enter') goCur(); });
  grid.appendChild(cur);
}

function trackCardGo(node, mapped) {
  const status = nodeStatus(node.id);
  if (status === 'locked') {
    window.location.hash = '#/tree';
    setTimeout(() => showLockedGuidance(node), 60);
    return;
  }
  // Jump to the first incomplete lesson in this track, else the first lesson.
  const next = mapped.find(l => !progressFor(l.id).quizPassed) || mapped[0] || lessons()[0];
  if (next) window.location.hash = '#/lesson/' + encodeURIComponent(next.id);
}

/* ---------- Intent search ----------
 * Ranking = text match (title x3, skill x2, transcript x1) × pacing filter
 *           × blended efficacy × normalized action density.                    */

function rankLessons(query) {
  const tokens = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  const pacingFilter = PACING_VALUES[Number(Store.get(K.pacing, 0))] || 'any';
  const all = lessons();
  const maxDensity = Math.max.apply(null, all.map(l => Number(l.actionDensity) || 0).concat([1]));

  return all
    .map(lesson => {
      const title = String(lesson.title || '').toLowerCase();
      const skill = String(lesson.skill || '').toLowerCase();
      const transcript = (lesson.transcript || []).map(t => t.text || '').join(' ').toLowerCase();
      let text = 0;
      tokens.forEach(tok => {
        if (title.indexOf(tok) !== -1) text += 3;
        else if (skill.indexOf(tok) !== -1) text += 2;
        else if (transcript.indexOf(tok) !== -1) text += 1;
      });
      return { lesson, text };
    })
    .filter(r => tokens.length === 0 || r.text > 0)
    .filter(r => pacingFilter === 'any' || r.lesson.pacing === pacingFilter)
    .map(r => {
      const e = efficacy(r.lesson);
      const density = (Number(r.lesson.actionDensity) || 0) / maxDensity;
      const score = (r.text || 1) * (0.5 + e.rate) * (0.5 + density);
      return { lesson: r.lesson, score, rate: e.rate };
    })
    .sort((a, b) => b.score - a.score);
}

function renderSearchResults() {
  const box = $('#searchResults');
  const q = $('#intentSearch').value;
  box.innerHTML = '';
  if (!q.trim()) {
    const hint = document.createElement('p');
    hint.className = 'results-heading';
    hint.textContent = 'Type an intent above — e.g. “python dictionaries” — to find the right lesson.';
    box.appendChild(hint);
    return;
  }
  const results = rankLessons(q);
  const heading = document.createElement('p');
  heading.className = 'results-heading';
  heading.textContent = results.length
    ? results.length + ' lesson' + (results.length === 1 ? '' : 's') + ' match your intent'
    : 'No lessons match. Try different words, or loosen the depth filter.';
  box.appendChild(heading);

  results.forEach(r => {
    const l = r.lesson;
    const p = progressFor(l.id);
    const card = document.createElement('div');
    card.className = 'lesson-card';
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    card.innerHTML =
      '<h3>' + esc(l.title) + '</h3>' +
      '<p class="creator">' + esc(l.creatorName || '') +
      (l.creatorCredentials ? ' · ' + esc(l.creatorCredentials) : '') + '</p>' +
      '<p class="skill">skill: ' + esc(l.skill || '') + '</p>' +
      '<div class="meta">' +
        '<span class="badge ' + esc(l.pacing || '') + '">' + esc(l.pacing || 'n/a') + '</span>' +
        '<span class="badge">' + fmtTime(l.durationSec) + '</span>' +
        '<span class="badge pass">⌀ ' + Math.round(r.rate * 100) + '% pass</span>' +
        (p.quizPassed ? '<span class="badge done">✓ passed</span>' : '') +
      '</div>';
    const go = () => { window.location.hash = '#/lesson/' + encodeURIComponent(l.id); };
    card.addEventListener('click', go);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
    box.appendChild(card);
  });
}

function initLandingEvents() {
  const input = $('#intentSearch');
  input.addEventListener('input', debounce(renderSearchResults, 160));
  const slider = $('#pacingSlider');
  slider.addEventListener('input', () => {
    Store.set(K.pacing, Number(slider.value));
    $('#pacingValue').textContent = PACING_LABELS[Number(slider.value)] || PACING_LABELS[0];
    renderSearchResults();
  });
}

/* ============ 7. Lesson player view: video, chapters, syllabus ============ */
/* Per-view ephemeral state (never persisted directly). */
let LV = null; // { lesson, video, firedTriggers:Set, skipToastAt, lastT, sandboxEditor, saveWatched }

function renderLesson(lesson) {
  LV = {
    lesson,
    video: null,
    firedTriggers: new Set(),
    skipToastAt: 0,
    lastT: 0,
    sandboxEditor: null,
    saveWatched: null
  };

  // Honest labeling: every lesson carries the sample banner.
  const license = lesson.videoLicense ? ' · ' + lesson.videoLicense : '';
  setSampleBanner('Sample lesson — CC0 placeholder video' + license + '. Content is illustrative, not production footage.');

  const view = $('#view-lesson');
  const prog = progressFor(lesson.id);
  const eff = efficacy(lesson);
  const chapters = lesson.chapters || [];
  const syllabus = lessons();

  view.innerHTML =
    '<a class="back-link" id="lessonBack">← Library</a>' +
    '<div class="lesson-head">' +
      '<h1>' + esc(lesson.title) + '</h1>' +
      '<p class="creator-line">' + esc(lesson.creatorName || '') +
        (lesson.creatorCredentials ? ' · ' + esc(lesson.creatorCredentials) : '') +
        ' &nbsp;·&nbsp; skill: <span style="font-family:var(--mono);color:var(--accent)">' + esc(lesson.skill || '') + '</span></p>' +
      '<div class="meta" style="display:flex;gap:0.6rem;flex-wrap:wrap;margin-bottom:1rem">' +
        '<span class="badge ' + esc(lesson.pacing || '') + '">' + esc(lesson.pacing || 'n/a') + '</span>' +
        '<span class="badge">' + fmtTime(lesson.durationSec) + '</span>' +
        '<span class="badge pass">⌀ ' + Math.round(eff.rate * 100) + '% pass rate</span>' +
        (prog.quizPassed ? '<span class="badge done">✓ quiz passed</span>' : '') +
      '</div>' +
    '</div>' +
    '<div class="lesson-layout">' +
      '<div class="main-col">' +
        '<div class="player-sandbox-row">' +
          '<div class="player-col">' +
            '<div class="player" id="playerBox">' +
              '<video id="lessonVideo" preload="metadata" playsinline ' +
                (lesson.videoUrl ? '' : 'hidden') + '></video>' +
              '<div id="videoFallback" class="card" hidden style="border:none;border-radius:0">' +
                '<p style="margin:0">No playable video URL for this lesson.</p></div>' +
              '<div class="controls" id="playerControls">' +
                '<button class="ctrl-btn" id="ctrlPlay" title="Play/Pause (Space)">▶</button>' +
                '<span class="time-label" id="ctrlTime">0:00 / ' + fmtTime(lesson.durationSec) + '</span>' +
                '<input type="range" class="seek" id="ctrlSeek" min="0" max="' + (lesson.durationSec || 0) + '" step="0.5" value="0" aria-label="Seek">' +
                '<select class="speed-select" id="ctrlSpeed" aria-label="Playback speed">' +
                  '<option value="0.75">0.75×</option><option value="1" selected>1×</option>' +
                  '<option value="1.25">1.25×</option><option value="1.5">1.5×</option><option value="2">2×</option>' +
                '</select>' +
                '<button class="ctrl-btn" id="ctrlFluff" title="Fluff-bypass: auto-skip intro/sponsor chapters">⏩ fluff</button>' +
                '<button class="ctrl-btn" id="ctrlSandbox" title="Toggle code sandbox">&lt;/&gt;</button>' +
                '<button class="ctrl-btn" id="ctrlFull" title="Fullscreen">⛶</button>' +
              '</div>' +
            '</div>' +
            '<div class="chapters" id="chapterBox">' +
              '<h3>Chapters</h3>' +
              '<div id="chapterList">' + chapters.map((c, i) =>
                '<div class="chapter-row" data-i="' + i + '" tabindex="0" role="button">' +
                  '<span class="chapter-time">' + fmtTime(c.start) + '–' + fmtTime(c.end) + '</span>' +
                  '<span>' + esc(c.title) + '</span>' +
                  (c.fluff
                    ? '<span class="fluff-badge">fluff</span>'
                    : '<span class="core-badge">' + esc(c.kind || 'core') + '</span>') +
                '</div>').join('') +
              '</div>' +
            '</div>' +
          '</div>' +
          '<div class="sandbox-dock" id="sandboxDock">' +
            '<div class="sandbox-panel">' +
              '<h3>Sandbox</h3>' +
              '<span class="demo-label">Editor is Python-flavored. The runner below executes ' +
              '<strong>JavaScript as a demo only</strong> — it is not a Python runtime.</span>' +
              '<textarea class="code-fallback" id="sandboxCode" spellcheck="false">// JS demo runner — try me:\nconst word = { python: \"dict\", js: \"object\" };\nconsole.log(\"keys:\", Object.keys(word).join(\", \"));\nObject.keys(word).length;</textarea>' +
              '<div><button class="btn small" id="sandboxRun">Run (JavaScript demo)</button></div>' +
              '<div class="sandbox-console" id="sandboxConsole">// output appears here</div>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<div class="lesson-sections">' +
          '<div class="card" id="quizCard"><h2>Quiz <span class="sub">≥70% to pass</span></h2><div id="quizBody"></div></div>' +
          '<div class="card" id="notesCard"><h2>Notes <span class="sub">timestamps + markdown</span></h2>' +
            '<div class="notes-split">' +
              '<div><h3 style="font-size:0.9rem;color:var(--text-dim)">Transcript</h3>' +
              '<div class="transcript-box" id="transcriptBox"></div>' +
              '<button class="btn secondary small" id="flashFromSel" style="margin-top:0.6rem">Generate flashcard from transcript selection</button></div>' +
              '<div class="notes-col"><h3 style="font-size:0.9rem;color:var(--text-dim)">Your notes</h3>' +
              '<textarea id="notesArea" placeholder="Write in Markdown…"></textarea>' +
              '<div class="notes-actions">' +
                '<button class="btn secondary small" id="notesAnchor">Anchor @ current time</button>' +
                '<button class="btn secondary small" id="notesExport">Download .md</button>' +
                '<button class="btn secondary small" id="notesCopy">Copy for Notion/Obsidian</button>' +
              '</div></div>' +
            '</div></div>' +
          '<div class="card" id="flashCard"><h2>Flashcards <span class="sub">click a card to flip</span></h2>' +
            '<div><button class="btn secondary small" id="flashExport">Export Anki TSV</button></div>' +
            '<div class="flash-list" id="flashList"></div></div>' +
          '<div class="card" id="deliverableCard"><h2>Deliverable</h2><div id="deliverableBody"></div></div>' +
        '</div>' +
      '</div>' +
      '<aside class="syllabus" aria-label="Curriculum syllabus">' +
        '<h3>Syllabus</h3>' +
        syllabus.map(l => {
          const lp = progressFor(l.id);
          const cur = l.id === lesson.id ? ' current' : '';
          return '<a class="syllabus-item' + cur + '" href="#/lesson/' + encodeURIComponent(l.id) + '">' +
            '<span class="t">' + (lp.quizPassed ? '<span class="check">✓</span> ' : '') + esc(l.title) + '</span><br>' +
            '<span class="s">' + esc(l.skill || '') + '</span> · ' +
            '<span class="d">' + fmtTime(l.durationSec) + '</span></a>';
        }).join('') +
      '</aside>' +
    '</div>';

  showView('lesson');
  $('#lessonBack').addEventListener('click', () => { window.location.hash = '#/'; });

  initPlayer(lesson);
  renderTranscript(lesson);
  renderQuiz(lesson);
  renderNotes(lesson);
  renderFlashcards(lesson);
  renderDeliverable(lesson);
  initSandboxRunner(); // wire the demo runner (button exists even while dock is closed)
}

/* ---------------- Custom video player ---------------- */

function initPlayer(lesson) {
  const video = $('#lessonVideo');
  const fallback = $('#videoFallback');
  LV.video = video;

  if (lesson.videoUrl) {
    video.src = lesson.videoUrl;
    video.addEventListener('error', () => {
      video.hidden = true;
      fallback.hidden = false;
      fallback.innerHTML = '<p style="margin:0">The sample video failed to load. ' +
        'Everything else on this page still works.</p>';
    }, true);
  } else {
    video.hidden = true;
    fallback.hidden = false;
  }

  const playBtn = $('#ctrlPlay');
  const seek = $('#ctrlSeek');
  const timeLabel = $('#ctrlTime');
  const total = fmtTime(lesson.durationSec);

  function setPlayIcon() { playBtn.textContent = video.paused ? '▶' : '⏸'; }
  function togglePlay() {
    if (video.paused) { safePlay(video); }
    else video.pause();
  }
  playBtn.addEventListener('click', togglePlay);
  video.addEventListener('play', () => { setPlayIcon(); logSession('play', lesson.id); });
  video.addEventListener('pause', setPlayIcon);

  seek.addEventListener('input', () => { video.currentTime = Number(seek.value); });
  $('#ctrlSpeed').addEventListener('change', e => { video.playbackRate = Number(e.target.value); });
  $('#ctrlFull').addEventListener('click', () => {
    const box = $('#playerBox');
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    else if (box.requestFullscreen) box.requestFullscreen().catch(() => {});
  });

  // Fluff-bypass toggle (persisted).
  const fluffBtn = $('#ctrlFluff');
  function paintFluff() { fluffBtn.classList.toggle('toggled', !!Store.get(K.fluff, false)); }
  paintFluff();
  fluffBtn.addEventListener('click', () => {
    const on = !Store.get(K.fluff, false);
    Store.set(K.fluff, on);
    paintFluff();
    toast(on ? 'Fluff-bypass ON — intro/sponsor chapters will auto-skip.' : 'Fluff-bypass OFF.', on ? 'accent' : '');
  });

  // Sandbox dock toggle.
  $('#ctrlSandbox').addEventListener('click', () => {
    const dock = $('#sandboxDock');
    const open = !dock.classList.contains('open');
    dock.classList.toggle('open', open);
    $('#ctrlSandbox').classList.toggle('toggled', open);
    if (open) initSandboxEditor();
  });

  // Chapter list clicks.
  $$('#chapterList .chapter-row').forEach(row => {
    const go = () => {
      const c = (lesson.chapters || [])[Number(row.dataset.i)];
      if (c) video.currentTime = c.start + 0.05;
    };
    row.addEventListener('click', go);
    row.addEventListener('keydown', e => { if (e.key === 'Enter') go(); });
  });

  // Space is handled by the video: toggle play/pause, don't scroll the page.
  // (Buttons keep their native Space behavior.)
  $('#playerBox').addEventListener('keydown', e => {
    if (e.code !== 'Space') return;
    if (e.target.closest('button, input, select, textarea')) return;
    e.preventDefault();
    togglePlay();
  });
  video.setAttribute('tabindex', '0');

  // Watched-seconds accounting (throttled persistence).
  LV.lastT = 0;
  LV.saveWatched = debounce(() => {
    saveProgress(lesson.id, { watchedSec: Math.floor(LV.watchedAcc || 0) });
  }, 5000);
  LV.watchedAcc = progressFor(lesson.id).watchedSec || 0;

  video.addEventListener('timeupdate', () => onVideoTime(lesson, video, seek, timeLabel, total));
  video.addEventListener('loadedmetadata', () => {
    if (video.duration && isFinite(video.duration)) {
      seek.max = Math.floor(video.duration);
      timeLabel.textContent = '0:00 / ' + fmtTime(video.duration);
    }
  });
}

/** Single timeupdate handler: seek UI, chapters, transcript, fluff-skip, recall. */
function onVideoTime(lesson, video, seek, timeLabel, totalFallback) {
  const t = video.currentTime || 0;

  // Watched time (only while actually playing forward).
  if (!video.paused && t > LV.lastT && t - LV.lastT < 5) {
    LV.watchedAcc = (LV.watchedAcc || 0) + (t - LV.lastT);
    LV.saveWatched();
  }
  LV.lastT = t;

  if (document.activeElement !== seek) seek.value = Math.floor(t);
  const dur = (video.duration && isFinite(video.duration)) ? video.duration : (lesson.durationSec || 0);
  timeLabel.textContent = fmtTime(t) + ' / ' + fmtTime(dur);

  // Chapter highlight.
  const chapters = lesson.chapters || [];
  chapters.forEach((c, i) => {
    const row = $('#chapterList .chapter-row[data-i="' + i + '"]');
    if (row) row.classList.toggle('current', t >= c.start && t < c.end);
  });

  // Transcript highlight.
  $$('#transcriptBox .transcript-line').forEach(line => {
    const s = Number(line.dataset.start), e = Number(line.dataset.end);
    line.classList.toggle('active', t >= s && t < e);
  });

  // Fluff-bypass: auto-skip chapters flagged fluff:true.
  if (Store.get(K.fluff, false)) {
    const fluff = chapters.find(c => c.fluff && t >= c.start && t < c.end);
    if (fluff) {
      // Silently retire any devil's-advocate triggers inside the skipped span.
      (lesson.recallTriggers || []).forEach(tr => {
        if (tr.at > t && tr.at < fluff.end) LV.firedTriggers.add(triggerKey(tr));
      });
      video.currentTime = fluff.end + 0.05;
      const now = Date.now();
      if (now - LV.skipToastAt > 4000) {
        LV.skipToastAt = now;
        toast('⏩ Skipped ' + (fluff.kind || 'fluff') + ' segment: “' + fluff.title + '”', 'warn');
      }
      return; // re-enter on next timeupdate at the new position
    }
  }

  // Devil's advocate recall triggers.
  (lesson.recallTriggers || []).forEach(tr => {
    const key = triggerKey(tr);
    if (!LV.firedTriggers.has(key) && t >= tr.at) {
      LV.firedTriggers.add(key);
      video.pause();
      openRecallModal(tr, lesson.id);
    }
  });
}

function triggerKey(tr) {
  return 'at:' + tr.at + '|q:' + String(tr.prompt).slice(0, 24);
}

/** Play a video without throwing when play() returns no promise (old engines, test DOMs). */
function safePlay(video) {
  try {
    const r = video.play();
    if (r && typeof r.catch === 'function') r.catch(() => {});
  } catch (e) { /* playback unavailable — the UI still works */ }
}

/* ---------------- Transcript + jargon linking ---------------- */

function renderTranscript(lesson) {
  const box = $('#transcriptBox');
  box.innerHTML = '';
  (lesson.transcript || []).forEach(line => {
    const div = document.createElement('div');
    div.className = 'transcript-line';
    div.dataset.start = line.start;
    div.dataset.end = line.end;
    div.innerHTML =
      '<span class="ts" title="Jump to ' + fmtTime(line.start) + '">' + fmtTime(line.start) + '</span>' +
      '<span class="tx">' + linkifyJargon(line.text || '') + '</span>';
    $('.ts', div).addEventListener('click', ev => {
      ev.stopPropagation();
      if (LV && LV.video) LV.video.currentTime = Number(line.start) + 0.05;
    });
    box.appendChild(div);
  });

  // Jargon clicks -> tooltip. Unknown-word clicks -> BYOK definition (if configured).
  box.addEventListener('click', e => {
    const j = e.target.closest('.jargon');
    if (j) { showJargonTip(j, j.dataset.term, e.clientX, e.clientY); return; }
    if (e.target.closest('.ts')) return;
    // If the user is selecting text (e.g. for flashcard generation), don't fire a lookup.
    const selText = window.getSelection ? window.getSelection().toString().trim() : '';
    if (selText) return;
    if (byokConfigured()) defineWordAtPoint(e.clientX, e.clientY);
  });
  document.addEventListener('scroll', hideJargonTip, true);
}

/** Wrap glossary terms in dotted-underline spans (longest match wins). */
function linkifyJargon(text) {
  const terms = glossaryTerms()
    .filter(t => t && t.term)
    .sort((a, b) => b.term.length - a.term.length);
  if (!terms.length) return esc(text);
  const pattern = terms.map(t => escapeRegExp(t.term)).join('|');
  let re;
  try {
    re = new RegExp('(?<!\\w)(' + pattern + ')(?!\\w)', 'gi');
  } catch (e) {
    re = new RegExp('(' + pattern + ')', 'gi'); // older engines without lookbehind
  }
  const out = [];
  let last = 0, m;
  re.lastIndex = 0;
  while ((m = re.exec(text)) !== null) {
    out.push(esc(text.slice(last, m.index)));
    const hit = terms.find(t => t.term.toLowerCase() === m[1].toLowerCase());
    out.push('<span class="jargon" data-term="' + esc(hit ? hit.term : m[1]) + '">' + esc(m[1]) + '</span>');
    last = m.index + m[1].length;
    if (m[1].length === 0) re.lastIndex++; // avoid infinite loop on empty match
  }
  out.push(esc(text.slice(last)));
  return out.join('');
}

/* ---------------- Devil's advocate ---------------- */

function openRecallModal(trigger, lessonId) {
  $('#recallPrompt').textContent = trigger.prompt || '';
  $('#recallReveal').textContent = '';
  $('#recallRevealBox').classList.remove('show');
  $('#recallCount').textContent = String(progressFor(lessonId).recallAnswered || 0);
  openModal('#modalRecall');

  $('#recallRevealBtn').onclick = () => {
    $('#recallReveal').textContent = trigger.reveal || '(no answer provided)';
    $('#recallRevealBox').classList.add('show');
    const p = progressFor(lessonId);
    saveProgress(lessonId, { recallAnswered: (p.recallAnswered || 0) + 1 });
    $('#recallCount').textContent = String(p.recallAnswered + 1);
  };
  const resume = () => {
    closeModal('#modalRecall');
    if (LV && LV.video) safePlay(LV.video);
  };
  $('#recallResumeBtn').onclick = resume;
  // Never trap the learner: backdrop click / Escape resumes playback.
  $('#modalRecall').onclick = e => { if (e.target.id === 'modalRecall') resume(); };
}

/* ==================== 8. Quizzes + deliverables =========================== */

function renderQuiz(lesson) {
  const body = $('#quizBody');
  body.innerHTML = '';
  const quiz = lesson.quiz || [];
  const prog = progressFor(lesson.id);

  if (!quiz.length) {
    body.innerHTML = '<p style="color:var(--text-dim)">No quiz for this lesson yet.</p>';
    return;
  }

  quiz.forEach((q, qi) => {
    const qDiv = document.createElement('div');
    qDiv.className = 'quiz-q';
    qDiv.dataset.qi = qi;
    qDiv.innerHTML = '<p>' + (qi + 1) + '. ' + esc(q.question) + '</p>';
    (q.options || []).forEach((opt, oi) => {
      const label = document.createElement('label');
      label.className = 'quiz-opt';
      label.innerHTML = '<input type="radio" name="q' + qi + '" value="' + oi + '"> ' + esc(opt);
      qDiv.appendChild(label);
    });
    const expl = document.createElement('p');
    expl.className = 'quiz-expl';
    expl.hidden = true;
    qDiv.appendChild(expl);
    body.appendChild(qDiv);
  });

  const actions = document.createElement('div');
  actions.style.marginTop = '0.8rem';
  actions.innerHTML =
    '<button class="btn" id="quizCheck">Check answers</button> ' +
    '<span id="quizMsg" style="margin-left:0.7rem;color:var(--text-dim)"></span>';
  body.appendChild(actions);
  const result = document.createElement('div');
  result.className = 'quiz-result';
  result.hidden = true;
  body.appendChild(result);

  if (prog.quizPassed) {
    result.hidden = false;
    result.innerHTML = '✓ <strong>Passed</strong> — best score ' + Math.round((prog.quizBest || 0) * 100) +
      '%. This lesson counts toward your skill tree.';
    $('#quizCheck', body).disabled = true;
    $('#quizMsg', body).textContent = 'Already passed. Re-take is disabled to keep results honest.';
    // Still allow reviewing explanations.
    $$('.quiz-q', body).forEach((qDiv, qi) => {
      const expl = $('.quiz-expl', qDiv);
      expl.hidden = false;
      expl.textContent = quiz[qi].explanation || '';
    });
    return;
  }

  $('#quizCheck', body).addEventListener('click', () => {
    let correct = 0;
    let answered = 0;
    $$('.quiz-q', body).forEach((qDiv, qi) => {
      const q = quiz[qi];
      const checked = $('input[type="radio"]:checked', qDiv);
      $$('.quiz-opt', qDiv).forEach(o => o.classList.remove('correct', 'wrong'));
      const expl = $('.quiz-expl', qDiv);
      expl.hidden = false;
      expl.textContent = q.explanation || '';
      if (checked) {
        answered++;
        const chosen = Number(checked.value);
        const labels = $$('.quiz-opt', qDiv);
        if (labels[q.answer]) labels[q.answer].classList.add('correct');
        if (chosen === q.answer) { correct++; }
        else if (labels[chosen]) labels[chosen].classList.add('wrong');
      } else {
        const labels = $$('.quiz-opt', qDiv);
        if (labels[q.answer]) labels[q.answer].classList.add('correct');
      }
    });
    if (answered < quiz.length) {
      $('#quizMsg', body).textContent = 'Answer all ' + quiz.length + ' questions first.';
      return;
    }
    const score = correct / quiz.length;
    const passed = score >= 0.7;
    recordQuizAttempt(lesson.id, passed);
    const p = progressFor(lesson.id);
    saveProgress(lesson.id, {
      quizAttempts: (p.quizAttempts || 0) + 1,
      quizBest: Math.max(p.quizBest || 0, score),
      quizPassed: p.quizPassed || passed
    });
    result.hidden = false;
    if (passed) {
      result.innerHTML = '✓ <strong>Passed</strong> — ' + correct + '/' + quiz.length +
        ' (' + Math.round(score * 100) + '%). Lesson complete; skill tree updated.';
      $('#quizCheck', body).disabled = true;
      toast('Quiz passed — lesson complete ✓', 'accent');
      logSession('quiz-pass', lesson.id);
      // Refresh badges / syllabus checkmarks without a full reload.
      setTimeout(() => renderLesson(lesson), 600);
    } else {
      result.innerHTML = '✗ <strong>Not yet</strong> — ' + correct + '/' + quiz.length +
        ' (' + Math.round(score * 100) + '%). Review the explanations and try again.';
      toast('Quiz: ' + Math.round(score * 100) + '% — need 70% to pass.', 'warn');
    }
  });
}

function renderDeliverable(lesson) {
  const body = $('#deliverableBody');
  const prog = progressFor(lesson.id);
  body.innerHTML = '';
  if (!lesson.deliverable) {
    body.innerHTML = '<p style="color:var(--text-dim)">No deliverable for this lesson.</p>';
    return;
  }
  const row = document.createElement('label');
  row.className = 'deliverable-row';
  row.innerHTML =
    '<input type="checkbox" id="delivCheck" ' + (prog.deliverableDone ? 'checked' : '') + '> ' +
    '<span><strong>Build this:</strong> ' + esc(lesson.deliverable) +
    '<br><span style="color:var(--text-faint);font-size:0.85rem">Tick the box when you have actually built it — honor system.</span></span>';
  body.appendChild(row);
  $('#delivCheck').addEventListener('change', e => {
    saveProgress(lesson.id, { deliverableDone: e.target.checked });
    toast(e.target.checked ? 'Deliverable marked done. Nice work.' : 'Deliverable unchecked.', e.target.checked ? 'accent' : '');
  });
}

/* ==================== 9. Timestamped notes panel ======================== */

function renderNotes(lesson) {
  const area = $('#notesArea');
  const all = Store.get(K.notes, {});
  area.value = all[lesson.id] || '';

  const save = debounce(() => {
    const notes = Store.get(K.notes, {});
    notes[lesson.id] = area.value;
    Store.set(K.notes, notes);
    logSessionThrottled('note', lesson.id);
  }, 800);
  area.addEventListener('input', save);

  $('#notesAnchor').addEventListener('click', () => {
    const t = LV && LV.video ? LV.video.currentTime : 0;
    const anchor = fmtAnchor(t) + ' ';
    const start = area.selectionStart == null ? area.value.length : area.selectionStart;
    area.value = area.value.slice(0, start) + anchor + area.value.slice(area.selectionEnd == null ? start : area.selectionEnd);
    area.focus();
    save();
    toast('Anchored at ' + fmtAnchor(t), 'accent');
  });

  const mdDoc = () =>
    '# Notes — ' + lesson.title + '\n\n' +
    '_Lesson: ' + lesson.title + ' · skill: ' + (lesson.skill || '') + ' · ' +
    (lesson.creatorName || '') + '_\n\n' + area.value + '\n';

  $('#notesExport').addEventListener('click', () => {
    downloadFile('flowstream-notes-' + lesson.id + '.md', mdDoc(), 'text/markdown;charset=utf-8');
    toast('Notes downloaded as Markdown.', 'accent');
  });
  $('#notesCopy').addEventListener('click', () => {
    copyText(mdDoc()).then(ok =>
      toast(ok ? 'Copied — paste straight into Notion or Obsidian.' : 'Copy failed in this browser.', ok ? 'accent' : 'warn'));
  });
}

/* ==================== 10. Flashcards ==================================== */

function userCards(lessonId) {
  return Store.get(K.cards, {})[lessonId] || [];
}
function saveUserCards(lessonId, cards) {
  const all = Store.get(K.cards, {});
  all[lessonId] = cards;
  Store.set(K.cards, all);
}

function renderFlashcards(lesson) {
  const list = $('#flashList');
  const seed = (lesson.flashcards || []).map(c => ({ front: c.front, back: c.back, custom: false }));
  const custom = userCards(lesson.id);
  const all = seed.concat(custom);
  list.innerHTML = '';

  if (!all.length) {
    list.innerHTML = '<p style="color:var(--text-dim)">No flashcards yet — select transcript text and generate one.</p>';
  }

  all.forEach((card, i) => {
    const el = document.createElement('div');
    el.className = 'flash-card';
    el.setAttribute('tabindex', '0');
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', 'Flashcard: click to flip');
    const backHtml = card.custom
      ? '<textarea data-back rows="2" style="width:100%;margin-top:0.4rem" placeholder="Type the answer…">' +
        esc(card.back || '') + '</textarea>'
      : '<div>' + esc(card.back || '') + '</div>';
    el.innerHTML =
      '<div class="front"><strong>Q:</strong> ' + esc(card.front || '') + '</div>' +
      '<div class="back"><strong>A:</strong> ' + backHtml +
      (card.custom ? '<div style="margin-top:0.4rem"><button class="btn secondary small" data-del>Delete</button></div>' : '') +
      '</div>';
    const flip = e => {
      if (e.target.closest('textarea, button')) return;
      el.classList.toggle('flipped');
    };
    el.addEventListener('click', flip);
    el.addEventListener('keydown', e => { if (e.key === 'Enter' && e.target === el) el.classList.toggle('flipped'); });

    if (card.custom) {
      const ta = $('textarea[data-back]', el);
      ta.addEventListener('input', debounce(() => {
        const cards = userCards(lesson.id);
        const idx = i - seed.length;
        if (cards[idx]) { cards[idx].back = ta.value; saveUserCards(lesson.id, cards); }
      }, 600));
      $('[data-del]', el).addEventListener('click', () => {
        const cards = userCards(lesson.id);
        cards.splice(i - seed.length, 1);
        saveUserCards(lesson.id, cards);
        renderFlashcards(lesson);
        toast('Flashcard deleted.');
      });
    }
    list.appendChild(el);
  });

  $('#flashFromSel').onclick = () => {
    const sel = window.getSelection ? window.getSelection().toString().trim() : '';
    const box = $('#transcriptBox');
    const selNode = window.getSelection && window.getSelection().anchorNode;
    const inTranscript = selNode && box.contains(selNode.nodeType === 1 ? selNode : selNode.parentNode);
    if (!sel || !inTranscript) {
      toast('Select some text in the transcript first, then click again.', 'warn');
      return;
    }
    const front = sel.length > 220 ? sel.slice(0, 220) + '…' : sel;
    const cards = userCards(lesson.id);
    cards.push({ front, back: '', custom: true });
    saveUserCards(lesson.id, cards);
    renderFlashcards(lesson);
    toast('Flashcard created — flip it and type the answer.', 'accent');
  };

  $('#flashExport').onclick = () => {
    const lines = all.map(c =>
      String(c.front || '').replace(/[\t\n\r]+/g, ' ') + '\t' +
      String(c.back || '').replace(/[\t\n\r]+/g, ' '));
    downloadFile('flowstream-flashcards-' + lesson.id + '.tsv', lines.join('\n') + '\n', 'text/tab-separated-values;charset=utf-8');
    toast('Exported ' + lines.length + ' cards as Anki TSV.', 'accent');
  };
}

/* ==================== 11. Split-screen sandbox ========================== */
/* CodeMirror 5 (python mode) from cdnjs; plain textarea fallback if the CDN
 * fails. The runner executes JavaScript only, and says so loudly. */

function initSandboxEditor() {
  if (LV.sandboxEditor) { try { LV.sandboxEditor.refresh(); } catch (e) {} return; }
  const ta = $('#sandboxCode');
  if (!ta) return;
  if (window.CodeMirror) {
    try {
      LV.sandboxEditor = window.CodeMirror.fromTextArea(ta, {
        mode: 'python',
        theme: 'material-darker',
        lineNumbers: true,
        indentUnit: 4
      });
      return;
    } catch (e) { /* fall through to textarea */ }
  }
  toast('CodeMirror CDN unreachable — using a plain textarea instead.', 'warn');
}

function sandboxCode() {
  if (LV.sandboxEditor) { try { return LV.sandboxEditor.getValue(); } catch (e) {} }
  const ta = $('#sandboxCode');
  return ta ? ta.value : '';
}

function initSandboxRunner() {
  const btn = $('#sandboxRun');
  if (!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.addEventListener('click', () => {
    const code = sandboxCode();
    const con = $('#sandboxConsole');
    const out = [];
    const fakeConsole = {
      log: (...a) => out.push(a.map(stringify).join(' ')),
      info: (...a) => out.push(a.map(stringify).join(' ')),
      warn: (...a) => out.push('⚠ ' + a.map(stringify).join(' ')),
      error: (...a) => out.push('✗ ' + a.map(stringify).join(' '))
    };
    try {
      // Intentionally scoped: no access to window/document/localStorage.
      const fn = new Function('console', '"use strict";\n' + code);
      const ret = fn(fakeConsole);
      if (ret !== undefined) out.push('→ ' + stringify(ret));
      if (!out.length) out.push('(no output)');
    } catch (err) {
      out.push('✗ Error: ' + (err && err.message ? err.message : err));
    }
    con.textContent = out.join('\n');
    con.scrollTop = con.scrollHeight;
  });
}
function stringify(v) {
  try {
    if (typeof v === 'string') return v;
    return JSON.stringify(v);
  } catch (e) { return String(v); }
}

/* ================= 12. Jargon translator tooltip + BYOK =================== */

function showJargonTip(anchorEl, term, x, y) {
  const tip = $('#jargonTip');
  const hit = glossaryTerms().find(t => t.term.toLowerCase() === String(term).toLowerCase());
  const profile = Store.get(K.profile, 'general');
  if (hit) {
    const analogy = hit.analogies && hit.analogies[profile]
      ? hit.analogies[profile]
      : (hit.analogies && hit.analogies.general ? hit.analogies.general : '');
    tip.innerHTML =
      '<h4>' + esc(hit.term) + '</h4>' +
      '<div>' + esc(hit.definition) + '</div>' +
      (analogy ? '<div class="ana">“' + esc(analogy) + '” <span style="font-style:normal">— ' +
        esc(profileLabel(profile)) + ' analogy</span></div>' : '');
  } else {
    tip.innerHTML = '<h4>' + esc(term) + '</h4><div>Looking up with your key…</div>';
    byokDefineInto(term, tip);
  }
  tip.hidden = false;
  // Position near the click, clamped to the viewport.
  const pad = 12;
  const r = tip.getBoundingClientRect();
  let left = Math.min(x + 14, window.innerWidth - r.width - pad);
  let top = y + 16;
  if (top + r.height > window.innerHeight - pad) top = y - r.height - 12;
  tip.style.left = Math.max(pad, left) + 'px';
  tip.style.top = Math.max(pad, top) + 'px';
}

function hideJargonTip() { $('#jargonTip').hidden = true; }

document.addEventListener('click', e => {
  const tip = $('#jargonTip');
  if (!tip.hidden && !tip.contains(e.target) && !e.target.closest('.jargon')) hideJargonTip();
});
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    // The recall modal resumes playback instead of just closing (never trap the learner).
    if ($('#modalRecall').classList.contains('open')) { $('#recallResumeBtn').click(); return; }
    hideJargonTip();
    ['#modalFocus', '#modalPact', '#modalSettings', '#modalSummary'].forEach(closeModal);
  }
});

/* ---------- BYOK: OpenAI-compatible definitions for unknown words ---------
 * The key lives ONLY in localStorage ("flowstream.byok") and is sent ONLY
 * to the user-configured base URL. The UI says this explicitly.            */

function byokConfigured() {
  const c = Store.get(K.byok, {});
  return !!(c.baseUrl && c.key);
}

function defineWordAtPoint(x, y) {
  let word = '';
  const sel = window.getSelection ? window.getSelection().toString().trim() : '';
  if (sel && sel.split(/\s+/).length <= 4 && sel.length <= 60) {
    word = sel;
  } else if (document.caretRangeFromPoint) {
    try {
      const range = document.caretRangeFromPoint(x, y);
      if (range && range.startContainer && range.startContainer.nodeType === 3) {
        const text = range.startContainer.textContent;
        let s = range.startOffset, e = range.startOffset;
        while (s > 0 && /[\w'-]/.test(text[s - 1])) s--;
        while (e < text.length && /[\w'-]/.test(text[e])) e++;
        word = text.slice(s, e).trim();
      }
    } catch (err) { /* ignore */ }
  }
  if (!word) return;
  // Don't re-ask for words we already know.
  if (glossaryTerms().some(t => t.term.toLowerCase() === word.toLowerCase())) return;
  showJargonTip(null, word, x, y);
}

async function byokDefineInto(word, tipEl) {
  const cfg = Store.get(K.byok, {});
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '');
  try {
    const res = await fetch(base + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + cfg.key
      },
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        max_tokens: 160,
        messages: [
          { role: 'system', content: 'You are a concise programming tutor. Define the term in 1-2 short sentences for a beginner learning Python. No preamble.' },
          { role: 'user', content: 'Define: ' + word }
        ]
      })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const text = data && data.choices && data.choices[0] && data.choices[0].message
      ? data.choices[0].message.content : '';
    tipEl.innerHTML =
      '<h4>' + esc(word) + '</h4>' +
      '<div>' + esc((text || '').trim() || '(empty response)') + '</div>' +
      '<div class="byok-note">AI-generated via <strong>your</strong> key, sent only to<br>' +
      '<span style="font-family:var(--mono)">' + esc(base) + '</span></div>';
  } catch (err) {
    tipEl.innerHTML =
      '<h4>' + esc(word) + '</h4>' +
      '<div>Definition lookup failed: ' + esc(err && err.message ? err.message : err) + '</div>' +
      '<div class="byok-note">Check the base URL / key in Settings. Your key never left this device except to that endpoint.</div>';
  }
}

/* ==================== 13. Focus sessions ================================= */
/* Modal: minutes + intent -> greedy-by-order queue that fits the window.
 * Countdown chip; at 0 the video pauses and a summary appears.              */

let focusTicker = null;

function getSession() { return Store.get(K.session, null); }

function openFocusModal() {
  if (!CUR) { toast('Curriculum not loaded yet.', 'warn'); return; }
  const mins = $('#focusMinutes');
  mins.value = CUR.focusWindowMinutes || 25;
  const updatePreview = () => {
    const q = buildFocusQueue(Number(mins.value) || 0, $('#focusIntent').value);
    $('#focusQueuePreview').textContent = q.length
      ? 'Queue (' + q.length + '): ' + q.map(l => l.title).join(' → ') +
        ' — ' + fmtTime(q.reduce((a, l) => a + (l.durationSec || 0), 0)) + ' total'
      : 'No lessons fit that window. Try more minutes.';
  };
  mins.oninput = updatePreview;
  $('#focusIntent').oninput = debounce(updatePreview, 200);
  updatePreview();
  openModal('#modalFocus');
  $('#focusStartBtn').onclick = () => {
    const minutes = Math.max(1, Math.min(240, Number(mins.value) || 25));
    const intent = $('#focusIntent').value.trim();
    const queue = buildFocusQueue(minutes, intent);
    if (!queue.length) { toast('Nothing fits — increase the minutes.', 'warn'); return; }
    const now = Date.now();
    Store.set(K.session, {
      active: true,
      startedAt: new Date(now).toISOString(),
      endsAt: new Date(now + minutes * 60000).toISOString(),
      minutes,
      intent,
      queue: queue.map(l => l.id),
      log: []
    });
    closeModal('#modalFocus');
    startFocusTicker();
    toast('Focus session started: ' + minutes + ' min, ' + queue.length + ' lessons queued.', 'accent');
    // Jump to the first queued lesson if we're not already watching one.
    const first = queue[0];
    if (!window.location.hash.startsWith('#/lesson/')) {
      window.location.hash = '#/lesson/' + encodeURIComponent(first.id);
    }
  };
}

/** Greedy by order: walk lessons in order, keep each one that fits the
 *  remaining window. An intent string, when given, restricts the pool to
 *  lessons that match it (falling back to all lessons if none match). */
function buildFocusQueue(minutes, intent) {
  const budget = minutes * 60;
  let pool = lessons();
  const tokens = String(intent || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length) {
    const matched = pool.filter(l => {
      const hay = (l.title + ' ' + l.skill + ' ' +
        (l.transcript || []).map(t => t.text).join(' ')).toLowerCase();
      return tokens.some(tok => hay.indexOf(tok) !== -1);
    });
    if (matched.length) pool = matched;
  }
  const queue = [];
  let remaining = budget;
  pool.forEach(l => {
    if ((l.durationSec || 0) <= remaining) {
      queue.push(l);
      remaining -= (l.durationSec || 0);
    }
  });
  return queue;
}

function startFocusTicker() {
  stopFocusTicker();
  paintFocusChip();
  focusTicker = setInterval(() => {
    const s = getSession();
    if (!s || !s.active) { stopFocusTicker(); return; }
    const left = new Date(s.endsAt).getTime() - Date.now();
    if (left <= 0) { endFocusSession(false); return; }
    paintFocusChip();
  }, 1000);
}

function stopFocusTicker() {
  if (focusTicker) { clearInterval(focusTicker); focusTicker = null; }
  $('#focusChip').classList.remove('show');
}

function paintFocusChip() {
  const s = getSession();
  const chip = $('#focusChip');
  if (!s || !s.active) { chip.classList.remove('show'); return; }
  const left = Math.max(0, new Date(s.endsAt).getTime() - Date.now());
  $('#focusTime').textContent = fmtTime(Math.ceil(left / 1000));
  chip.classList.add('show');
}

function initFocusChip() {
  $('#focusChip').addEventListener('click', () => endFocusSession(true));
  const s = getSession();
  if (s && s.active) {
    if (new Date(s.endsAt).getTime() <= Date.now()) endFocusSession(false);
    else startFocusTicker();
  }
}

/** Append to the active session's activity log (for the end-of-session summary). */
function logSession(type, lessonId) {
  const s = getSession();
  if (!s || !s.active) return;
  s.log.push({ t: new Date().toISOString(), type, lessonId });
  Store.set(K.session, s);
}
const logSessionThrottled = (() => {
  let last = 0;
  return (type, lessonId) => {
    const now = Date.now();
    if (now - last < 30000) return;
    last = now;
    logSession(type, lessonId);
  };
})();

function endFocusSession(early) {
  const s = getSession();
  stopFocusTicker();
  if (LV && LV.video && !LV.video.paused) LV.video.pause();
  if (!s || !s.active) return;
  s.active = false;
  Store.set(K.session, s);

  const log = s.log || [];
  const watched = [...new Set(log.filter(e => e.type === 'play').map(e => e.lessonId))];
  const quizzes = [...new Set(log.filter(e => e.type === 'quiz-pass').map(e => e.lessonId))];
  const notes = log.filter(e => e.type === 'note').length;
  const name = id => { const l = lessonById(id); return l ? l.title : id; };

  $('#summaryBody').innerHTML =
    (early ? '<p style="color:var(--text-dim)">Ended early — no judgment. Here’s what happened:</p>' : '') +
    '<table class="ledger" style="width:100%;border-collapse:collapse;font-size:0.95rem">' +
    '<tr><td>⏱ Planned</td><td><strong>' + s.minutes + ' min</strong></td></tr>' +
    '<tr><td>▶ Lessons watched</td><td><strong>' + watched.length + '</strong>' +
      (watched.length ? ' <span style="color:var(--text-dim)">(' + watched.map(name).map(esc).join('; ') + ')</span>' : '') + '</td></tr>' +
    '<tr><td>✓ Quizzes passed</td><td><strong>' + quizzes.length + '</strong></td></tr>' +
    '<tr><td>✎ Note saves</td><td><strong>' + notes + '</strong></td></tr>' +
    '</table>';
  openModal('#modalSummary');
}

/* ==================== 14. Ulysses pacts ================================== */
/* Stake Focus Credits on finishing the curriculum (all quizzes passed) by a
 * deadline. Ledger: { stakes: [{amount, deadlineISO, status}], charityPool }.
 * The crypto/fiat wallet section is a DISABLED, clearly-labeled roadmap
 * extension point — never faked.                                            */

function getCredits() { return Store.get(K.credits, { balance: 100 }); }
function setCredits(c) { Store.set(K.credits, c); updateCreditsChip(); }
function getLedger() { return Store.get(K.ledger, { stakes: [], charityPool: 0 }); }
function setLedger(l) { Store.set(K.ledger, l); }

function curriculumComplete() {
  const all = lessons();
  return all.length > 0 && all.every(l => progressFor(l.id).quizPassed);
}

function openPactModal() {
  if (!CUR) { toast('Curriculum not loaded yet.', 'warn'); return; }
  $('#pactBalance').textContent = String(getCredits().balance);
  // Sensible default deadline: 7 days out.
  const d = new Date(Date.now() + 7 * 86400000);
  $('#pactDeadline').value = d.toISOString().slice(0, 10);
  renderLedger();
  openModal('#modalPact');

  $('#pactStakeBtn').onclick = () => {
    const amount = Math.floor(Number($('#pactAmount').value) || 0);
    const credits = getCredits();
    if (amount < 1) { toast('Stake at least 1 credit.', 'warn'); return; }
    if (amount > credits.balance) { toast('Not enough credits (balance: ' + credits.balance + ').', 'warn'); return; }
    const day = $('#pactDeadline').value;
    if (!day) { toast('Pick a deadline date.', 'warn'); return; }
    const deadline = new Date(day + 'T23:59:59');
    if (isNaN(deadline.getTime()) || deadline.getTime() <= Date.now()) {
      toast('Deadline must be in the future.', 'warn'); return;
    }
    credits.balance -= amount;
    setCredits(credits);
    const ledger = getLedger();
    ledger.stakes.push({ amount, deadlineISO: deadline.toISOString(), status: 'active' });
    setLedger(ledger);
    $('#pactBalance').textContent = String(credits.balance);
    renderLedger();
    toast('Staked ' + amount + ' credits. Finish all quizzes by ' + day + ' to win them back.', 'accent');
  };

  $('#pactCheckBtn').onclick = () => {
    const settled = checkDeadlines();
    renderLedger();
    if (!settled) toast('No active stakes are past their deadline.');
  };
}

/** Settle active stakes whose deadline has passed. Returns count settled. */
function checkDeadlines() {
  const ledger = getLedger();
  const credits = getCredits();
  let settled = 0;
  const now = new Date().toISOString();
  ledger.stakes.forEach(s => {
    if (s.status !== 'active' || s.deadlineISO > now) return;
    if (curriculumComplete()) {
      s.status = 'won';
      credits.balance += s.amount;
      toast('🏅 Pact honored! ' + s.amount + ' credits returned. Curriculum complete.', 'accent');
    } else {
      s.status = 'forfeited';
      ledger.charityPool += s.amount;
      toast('Pact forfeited: ' + s.amount + ' credits moved to the educational-charity pool.', 'warn');
    }
    settled++;
  });
  if (settled) { setLedger(ledger); setCredits(credits); }
  return settled;
}

function renderLedger() {
  const box = $('#pactLedger');
  const ledger = getLedger();
  let html = '<h3 style="font-size:1rem;margin:0 0 0.5rem">Ledger</h3>';
  if (!ledger.stakes.length) {
    html += '<p class="hint">No stakes yet. Your credits are safe… for now.</p>';
  } else {
    html += '<table><tr><th>Amount</th><th>Deadline</th><th>Status</th></tr>' +
      ledger.stakes.map(s =>
        '<tr><td>' + s.amount + ' cr</td>' +
        '<td>' + esc(String(s.deadlineISO).slice(0, 10)) + '</td>' +
        '<td class="stake-status ' + esc(s.status) + '">' + esc(s.status) + '</td></tr>'
      ).join('') + '</table>';
  }
  html += '<p style="margin-top:0.7rem">🎗 <strong>Educational-charity pool:</strong> ' +
    ledger.charityPool + ' credits earmarked for donation.</p>';
  box.innerHTML = html;
}

/* ==================== 15. Skill tree ===================================== */

const nodeStatusMemo = {};
function nodeStatus(nodeId) {
  if (nodeStatusMemo[nodeId]) return nodeStatusMemo[nodeId];
  const node = treeNodes().find(n => n.id === nodeId);
  let status = 'locked';
  if (node) {
    const mapped = lessonsForNode(nodeId);
    const allPassed = mapped.length > 0 && mapped.every(l => progressFor(l.id).quizPassed);
    if (allPassed || node.seedStatus === 'completed') {
      status = 'completed';
    } else {
      const prereqs = node.prerequisites || [];
      const prereqDone = prereqs.every(pid => nodeStatus(pid) === 'completed');
      if (!prereqDone) {
        status = 'locked';
      } else {
        const started = mapped.some(l => {
          const p = progressFor(l.id);
          return (p.watchedSec || 0) > 30 || (p.quizAttempts || 0) > 0;
        });
        status = (started || node.seedStatus === 'in-progress') ? 'in-progress' : 'in-progress';
      }
    }
  }
  nodeStatusMemo[nodeId] = status;
  return status;
}
function resetNodeMemo() {
  Object.keys(nodeStatusMemo).forEach(k => delete nodeStatusMemo[k]);
}

function renderTree() {
  if (!CUR) { renderDataError($('#view-tree')); return; }
  setSampleBanner(CUR.sampleNotice || '');
  resetNodeMemo();
  const host = $('#skillTree');
  host.innerHTML = '<div id="treeMsg"></div>';
  const nodes = treeNodes();
  const byId = {};
  nodes.forEach(n => { byId[n.id] = n; });
  const childrenOf = {};
  nodes.forEach(n => (n.prerequisites || []).forEach(p => {
    (childrenOf[p] = childrenOf[p] || []).push(n.id);
  }));
  const roots = nodes.filter(n => !(n.prerequisites || []).length);

  const msgBox = $('#treeMsg', host);

  function renderNode(nodeId, isRoot) {
    const node = byId[nodeId];
    const status = nodeStatus(nodeId);
    const div = document.createElement('div');
    div.className = 'tree-node' + (isRoot ? ' root' : '');
    const card = document.createElement('div');
    card.className = 'tree-card' + (status === 'locked' ? ' locked' : '');
    card.setAttribute('role', 'button');
    card.setAttribute('tabindex', '0');
    const mapped = lessonsForNode(nodeId);
    const passed = mapped.filter(l => progressFor(l.id).quizPassed).length;
    card.innerHTML =
      '<span class="status-dot ' + status + '"></span>' +
      '<span class="node-title">' + esc(node.title) + '</span>' +
      '<span class="node-sub">' + status.replace('-', ' ') +
      (mapped.length ? ' · ' + passed + '/' + mapped.length + ' quizzes' : '') + '</span>';
    const activate = () => {
      if (status === 'locked') { showLockedGuidance(node); return; }
      const next = mapped.find(l => !progressFor(l.id).quizPassed) || mapped[0];
      if (next) window.location.hash = '#/lesson/' + encodeURIComponent(next.id);
      else toast('No lessons mapped to this track yet.');
    };
    card.addEventListener('click', activate);
    card.addEventListener('keydown', e => { if (e.key === 'Enter') activate(); });
    div.appendChild(card);
    (childrenOf[nodeId] || []).forEach(cid => div.appendChild(renderNode(cid, false)));
    return div;
  }

  roots.forEach(r => host.appendChild(renderNode(r.id, true)));
  if (!roots.length) {
    host.innerHTML += '<p style="color:var(--text-dim)">The skill tree has no nodes.</p>';
  }
  showView('tree');

  // Expose the guidance box for locked-node clicks from the landing page.
  host._msgBox = msgBox;
}

/** Locked node: explain + offer a jump to the recommended foundational track. */
function showLockedGuidance(node) {
  const host = $('#skillTree');
  let msgBox = $('#treeMsg');
  if (!msgBox) { // called from landing: go to tree first, then show guidance
    if (!window.location.hash.startsWith('#/tree')) window.location.hash = '#/tree';
    setTimeout(() => showLockedGuidance(node), 120);
    return;
  }
  const prereqs = node.prerequisites || [];
  const missing = prereqs.filter(pid => nodeStatus(pid) !== 'completed');
  const targetId = missing[0] || prereqs[0];
  const target = treeNodes().find(n => n.id === targetId);
  const targetLessons = target ? lessonsForNode(target.id) : [];
  const rec = targetLessons.find(l => !progressFor(l.id).quizPassed) || targetLessons[0] || lessons()[0];

  msgBox.innerHTML =
    '<div class="card" style="border-color:var(--warn);margin-bottom:1rem">' +
    '<strong>🔒 Complete prerequisites first.</strong><br>' +
    '<span style="color:var(--text-dim)">“' + esc(node.title) + '” needs: ' +
    (missing.length ? missing.map(pid => {
      const n = treeNodes().find(x => x.id === pid);
      return esc(n ? n.title : pid);
    }).join(', ') : 'its prerequisites') + '.</span>' +
    (rec ? '<div style="margin-top:0.7rem"><button class="btn small" id="treeRecBtn">Go to recommended track: ' +
      esc(rec.title) + '</button></div>' : '') +
    '</div>';
  const btn = $('#treeRecBtn');
  if (btn && rec) btn.addEventListener('click', () => {
    window.location.hash = '#/lesson/' + encodeURIComponent(rec.id);
  });
  if (typeof msgBox.scrollIntoView === 'function') {
    msgBox.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

/* ==================== 16. Settings ======================================= */

function openSettingsModal() {
  const cfg = Store.get(K.byok, {});
  $('#byokBase').value = cfg.baseUrl || '';
  $('#byokModel').value = cfg.model || '';
  $('#byokKey').value = cfg.key || '';
  openModal('#modalSettings');

  $('#settingsSaveBtn').onclick = () => {
    Store.set(K.byok, {
      baseUrl: $('#byokBase').value.trim(),
      model: $('#byokModel').value.trim(),
      key: $('#byokKey').value // stored ONLY in localStorage, per the UI copy above
    });
    closeModal('#modalSettings');
    toast(byokConfigured() ? 'BYOK saved — unknown words will use your endpoint.' : 'BYOK cleared.', 'accent');
  };
  $('#wipeDataBtn').onclick = () => {
    if (confirm('Erase ALL FlowStream data on this device (progress, notes, credits, keys)?')) {
      Store.wipe();
      location.reload();
    }
  };
}

/* ==================== 17. Modal helpers ================================== */

function openModal(sel) { $(sel).classList.add('open'); }
function closeModal(sel) { $(sel).classList.remove('open'); }

function initModals() {
  $$('[data-close]').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.modal-backdrop').classList.remove('open'));
  });
  $$('.modal-backdrop').forEach(bd => {
    // Backdrop click closes — except the recall modal, which resumes instead.
    if (bd.id === 'modalRecall') return;
    bd.addEventListener('click', e => { if (e.target === bd) bd.classList.remove('open'); });
  });
}

/* ==================== 18. Boot =========================================== */

async function boot() {
  await loadData();
  initHeader();
  initLandingEvents();
  initModals();
  initFocusChip();
  if (DATA_ERROR && !CUR) {
    // Curriculum missing entirely: show the error on first paint.
    renderDataError($('#view-landing'));
  }
  // Settle any pacts whose deadline passed while away.
  if (CUR && checkDeadlines() > 0 && window.location.hash === '#/tree') renderTree();
  updateCreditsChip();
  window.addEventListener('hashchange', () => { resetNodeMemo(); route(); });
  route();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
