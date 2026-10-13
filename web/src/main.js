
import "./styles.css";
import { api } from "./api.js";

// Filled from the server once someone signs in.
let PROGRAM = null, LIB = {}, WEEKS = [], DAYS = [], INFO = {}, PHOTOS = {}, ME = null;
let BLOCK = null, BLOCKS = [], PREVIOUS = null;
const ytLink = n => "https://www.youtube.com/results?search_query=" + encodeURIComponent(n.replace(/\(.*\)/, "") + " exercise form");
function hrRange(pct) {
  const max = ME?.age ? 220 - ME.age : null;
  return max ? `${Math.round(max * pct[0] / 100)}–${Math.round(max * pct[1] / 100)} bpm` : "Talk test";
}
// Program JSON -> the shapes the session code works with.
function applyProgram(program, exercises) {
  PROGRAM = program; LIB = exercises; INFO = {}; PHOTOS = {};
  for (const [name, x] of Object.entries(LIB)) {
    INFO[name] = [x.photo || name, x.what, x.steps];
    PHOTOS[x.photo || name] = { img: Array.from({ length: x.images || 0 }, (_, n) => `exercises/${x.photo}-${n}.jpg`), muscles: x.muscles || [], secondary: x.secondary || [] };
  }
  WEEKS = program.weeks;
  DAYS = program.days.map(d => d.rest ? d : {
    ...d,
    // A lift's own caution (e.g. "right shoulder") overrides the library's general one.
    lifts: d.lifts.map(l => [l.name, l.sets, l.reps, l.rest, l.cue, !!l.main, l.pair, l.caution || LIB[l.name]?.caution || ""]),
    cardio: { ...d.cardio, hr: hrRange(d.cardio.pct) },
  });
}

let state = { week: 0, day: 0 };
let log = {};
let loaded = false, synced = {}, syncTimer = null, syncing = false;
const viewKey = () => "ie-view-" + (ME?.id || "") + "-" + (BLOCK?.id || "");

function save() {
  try { localStorage.setItem(viewKey(), JSON.stringify(state)); } catch (e) {}
  if (!loaded) return;
  clearTimeout(syncTimer); setStatus("saving"); syncTimer = setTimeout(flush, 600);
}
// Must match slug() in server/src/plan.ts.
function slug(name) {
  return name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "x";
}
// Log keys: "<week>-<day>-<exercise slug>", "-cardio" or "-end". i is the
// exercise's position in the day (or lifts.length for cardio, or "end").
function key(w, d, i) {
  if (i === "end") return w + "-" + d + "-end";
  const lifts = DAYS[d]?.lifts || [];
  return w + "-" + d + "-" + (+i === lifts.length ? "cardio" : slug(lifts[+i][0]));
}
function esc(s) { return String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

function setsFor(lift, wk) {
  const base = lift[1] + (lift[5] ? wk.extraSets : 0);
  return Math.max(1, Math.round(base * wk.setScale));
}
function cardioFor(day, wk) {
  if (wk.cardio === "deload") { const m = PROGRAM.deloadCardio?.minutes || 15; return { kind: "Easy " + day.cardio.kind.replace(/ intervals?/i, "").toLowerCase(), zone: "Zone 2", pct: [60, 70], hr: hrRange([60, 70]), steps: [m + " min steady, easy pace", "Recovery week: no intervals"], phases: [["Steady Zone 2", m * 60, "steady"]] }; }
  return day.cardio;
}
function engineMin(day, wk) { return wk.cardio === "deload" ? (PROGRAM.deloadCardio?.minutes || 15) : day.engine; }
function ironMin(day, wk) { return wk.setScale < 1 ? 30 : day.iron + (wk.extraSets ? 6 : 0); }
function progress(w, di) {
  const day = DAYS[di]; if (day.rest) return null;
  const total = day.lifts.length + 1;
  let n = 0;
  for (let i = 0; i < total; i++) if (log[key(w, di, i)]?.done) n++;
  return [n, total];
}

function renderWeeks() {
  const el = document.getElementById("weekTabs");
  el.innerHTML = WEEKS.map((w, i) => `<button class="tab" role="tab" type="button" id="wk-${i}" aria-selected="${i === state.week}" data-w="${i}">${w.name}<small>${w.tag} · RIR ${w.rir}</small></button>`).join("");
}
function renderGrid() {
  const wk = WEEKS[state.week];
  document.getElementById("weekGrid").innerHTML = DAYS.map((d, i) => {
    let bar = "", prog = "";
    if (!d.rest) {
      const wm = d.warm, im = ironMin(d, wk), em = engineMin(d, wk), t = wm + im + em;
      bar = `<div class="mini" aria-hidden="true"><span style="width:${wm / t * 100}%;background:var(--warm)"></span><span style="width:${im / t * 100}%;background:var(--iron)"></span><span style="width:${em / t * 100}%;background:var(--engine)"></span></div>`;
      const p = progress(state.week, i);
      prog = p[0] ? (p[0] === p[1] ? "✓ done" : p[0] + "/" + p[1]) : "";
      if (log[key(state.week, i, "end")]) prog = (p[0] ? p[0] + "/" + p[1] + " · " : "") + "ended early";
    } else {
      bar = `<div class="mini" aria-hidden="true"></div>`;
    }
    return `<button class="dayc" role="tab" type="button" id="day-${i}" aria-selected="${i === state.day}" data-d="${i}"><span class="d">${d.d}</span><span class="t">${d.title}</span>${bar}<span class="prog">${prog}</span></button>`;
  }).join("");
}
function renderSession() {
  const wk = WEEKS[state.week], day = DAYS[state.day], el = document.getElementById("session");
  if (day.rest) {
    el.innerHTML = `<div class="rest"><span class="label">${day.d} · ${wk.name}</span><h2>${day.title}</h2><p class="week-note">${day.focus}</p><ul>${day.items.map(x => `<li>${esc(x)}</li>`).join("")}</ul></div>`;
    return;
  }
  const im = ironMin(day, wk), em = engineMin(day, wk), t = day.warm + im + em;
  const c = cardioFor(day, wk);
  const rows = day.lifts.map((l, i) => {
    const k = key(state.week, state.day, i), entry = log[k] || {};
    const doneSets = (entry.sets || []).filter(s => s.done);
    const logged = doneSets.length ? `<b>${doneSets.length}/${setsFor(l, wk)} sets</b><br>${esc(fmtSets(doneSets))}` : (entry.kg ? esc(entry.kg) + " kg" : "–");
    return `<tr class="${entry.done ? "is-done" : ""}">
      <td><input type="checkbox" id="chk-${k}" data-i="${i}" ${entry.done ? "checked" : ""} aria-label="Mark ${esc(l[0])} done"></td>
      <td class="ex"><button type="button" class="ex-open" data-open="${i}">${l[6] ? `<span class="pair">${l[6]}</span>` : ""}<b>${esc(l[0])}</b>${l[7] ? ' <span class="caution" title="Physio OK first">⚠</span>' : ""}<small>${esc(l[4])}</small><span class="ex-cta">${doneSets.length ? "Open log" : "Open & log"} →</span></button></td>
      <td class="num">${setsFor(l, wk)} × ${l[2]}</td>
      <td class="num">${l[3]}</td>
      <td class="num">${wk.rir}</td>
      <td class="logged">${logged}</td>
    </tr>`;
  }).join("");
  const ci = day.lifts.length, ck = key(state.week, state.day, ci), cDone = log[ck]?.done;
  el.innerHTML = `
    <div class="s-head">
      <div class="s-title">
        <div style="display:grid;gap:4px"><span class="label">${day.d} · ${wk.name} · ${wk.tag}</span><h2>${day.title}: ${day.focus}</h2></div>
        <span class="num" style="color:var(--muted)">${t} min total</span>
      </div>
      <div class="timeline" role="img" aria-label="Warm-up ${day.warm} minutes, weights ${im} minutes, cardio ${em} minutes">
        <span class="seg-warm" style="flex:${day.warm}">${day.warm}′</span>
        <span class="seg-iron" style="flex:${im}">Weights · ${im}′</span>
        <span class="seg-engine" style="flex:${em}">Cardio · ${em}′</span>
      </div>
      <p class="week-note">${wk.note}</p>
      ${endBanner()}
      <p class="week-note">Tap an exercise to see how it's done and log the kg and reps for each set. Unsure of a word? See <a href="#glossary" style="color:var(--iron)">gym words</a> below.</p>
    </div>
    <div class="block">
      <div class="block-h"><h3>1 · Warm-up</h3><span class="chip warm">${day.warm} min</span></div>
      <p class="week-note">5 min easy bike or row, then 2–3 light ramp-up sets of the first lift (empty bar, ~50%, ~75% of work weight).</p>
    </div>
    <div class="block">
      <div class="block-h"><h3>2 · Weights</h3><span class="chip iron">${im} min</span></div>
      <div class="ex-table"><table>
        <thead><tr><th></th><th>Exercise</th><th>Sets × reps</th><th>Rest</th><th>RIR</th><th>Logged</th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
    </div>
    <div class="block" id="cardioBlock">
      <div class="block-h"><h3>3 · Cardio</h3><span class="chip engine">${em} min · ${c.zone}</span></div>
      <div class="cardio">
        <div style="display:grid;gap:8px;min-width:0">
          <label style="display:flex;gap:10px;align-items:center;font-weight:600"><input type="checkbox" id="chk-${ck}" data-i="${ci}" ${cDone ? "checked" : ""}> ${esc(c.kind)}</label>
          <ol>${c.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
          ${cardioSummary(log[ck]) ? `<p class="logged-c">${esc(cardioSummary(log[ck]))}</p>` : ""}
          <button type="button" class="c-open" data-open="${ci}">${cDone ? "Open cardio log" : run && run.id === runId() && !run.done && (run.running || run.active) ? "Resume timer" : "Start timer & log"} →</button>
        </div>
        <div class="hr"><span class="label">Target heart rate</span><b>${c.hr}</b><span style="font-size:.8rem;color:var(--muted)">${c.pct[0]}–${c.pct[1]}% of max${c.zone !== "Zone 2" ? ", hard parts only" : ""}${ME?.age ? "" : ". Add your age in settings to see bpm."}</span></div>
      </div>
    </div>`;
}
function render() { renderWeeks(); renderGrid(); renderSession(); save(); }

document.getElementById("weekTabs").addEventListener("click", e => {
  const b = e.target.closest("[data-w]"); if (!b) return; state.week = +b.dataset.w; render();
});
document.getElementById("weekGrid").addEventListener("click", e => {
  const b = e.target.closest("[data-d]"); if (!b) return; state.day = +b.dataset.d; render();
});
document.getElementById("session").addEventListener("click", e => {
  const b = e.target.closest("[data-open]"); if (b) return openSheet(+b.dataset.open);
  if (e.target.closest("[data-endopen]")) { endReturn = null; endDraft = { reason: "", note: "" }; return openSheet("end"); }
  if (e.target.closest("[data-unend]")) { delete log[endKey()]; save(); render(); }
});

/* ---------- exercise logger sheet ---------- */
const sheet = document.getElementById("sheet");
let sheetI = null, howOpen = false, restEnd = 0, restTotal = 0, restTimer = null;

function fmtSets(sets) {
  const kgs = new Set(sets.map(s => s.kg));
  const r = s => (s.reps || "?") + (s.fail ? "F" : "");
  if (kgs.size === 1) return (sets[0].kg ? sets[0].kg + " kg × " : "× ") + sets.map(r).join(", ");
  return sets.map(s => (s.kg || "?") + "×" + r(s)).join(" · ");
}
function restSecs(txt) { const n = parseFloat(txt); return /min/.test(txt) ? n * 60 : n; }
function entryFor(i) {
  const k = key(state.week, state.day, i), l = DAYS[state.day].lifts[i];
  const e = log[k] = log[k] || {};
  e.sets = e.sets || [];
  while (e.sets.length < setsFor(l, WEEKS[state.week])) e.sets.push({ kg: "", reps: "", done: false });
  return e;
}
function lastTime(i) {
  for (let w = state.week - 1; w >= 0; w--) {
    const s = (log[key(w, state.day, i)]?.sets || []).filter(x => x.done);
    if (s.length) return { week: WEEKS[w].name, sets: s };
  }
  // Nothing yet this block: use the last non-recovery week of the previous block.
  if (PREVIOUS) {
    const want = slug(DAYS[state.day].lifts[i][0]);
    let best = null;
    for (const [k, e] of Object.entries(PREVIOUS.entries)) {
      const m = k.match(/^(\d+)-(\d+)-(.+)$/);
      if (!m || m[3] !== want || PREVIOUS.weeks[+m[1]]?.cardio === "deload") continue;
      const s = (e.sets || []).filter(x => x.done);
      if (s.length && (!best || +m[1] > best.w)) best = { w: +m[1], sets: s };
    }
    if (best) return { week: "Last block, " + (PREVIOUS.weeks[best.w]?.name || "Week " + (best.w + 1)), sets: best.sets };
  }
  return null;
}
function openSheet(i) {
  sheetI = i; renderSheet(); sheet.hidden = false; document.body.style.overflow = "hidden";
  sheet.querySelector(".sheet-panel").focus();
}
function closeSheet(toCardio) {
  const i = sheetI; sheetI = null; sheet.hidden = true; document.body.style.overflow = "";
  renderGrid(); renderSession();
  if (toCardio) document.getElementById("cardioBlock")?.scrollIntoView({ block: "start" });
  else document.querySelector(`[data-open="${i}"]`)?.focus();
}
// what the kg box means for each kind of equipment
function weightHint(name) {
  switch (LIB[name]?.load) {
    case "barbell": return ["Total kg", "Enter the total on the bar: 20 kg bar plus all plates. Example: a 10 kg plate each side = 40 kg."];
    case "ezbar": return ["Total kg", "Enter the total: EZ-bar (usually 7–10 kg, check the bar) plus plates."];
    case "dumbbell": return ["kg each", "Enter the weight of one dumbbell."];
    case "single": return ["kg", "Enter the weight you hold, or leave it empty for bodyweight."];
    case "added": return ["Added kg", "Extra weight only. Enter 0 for bodyweight."];
    case "bodyweight": return ["kg", "Bodyweight: leave kg empty and log your reps."];
    case "time": return ["kg", "Log the seconds you held in the reps box. Leave kg empty."];
    case "band": return ["Band", "Note the band colour, e.g. green. Log reps as normal."];
    default: return ["kg", ""];
  }
}
function renderSheet() {
  // Settings can open on a rest day, which has no lifts.
  if (sheetI === "settings") return renderSettings();
  const day = DAYS[state.day], wk = WEEKS[state.week], n = day.lifts.length;
  if (sheetI === "end") return renderEndSheet();
  if (sheetI === n) return renderCardioSheet();
  const l = day.lifts[sheetI], e = entryFor(sheetI), info = INFO[l[0]];
  const p = (info && PHOTOS[info[0]]) || { img: [], muscles: [], secondary: [] };
  const last = lastTime(sheetI), repTarget = parseInt(l[2]);
  const target = setsFor(l, wk), wh = weightHint(l[0]);
  const rows = e.sets.map((s, j) => {
    const prevKg = e.sets.slice(0, j).reverse().find(x => x.kg)?.kg;
    const phKg = prevKg ||(last?.sets[j] || last?.sets[0])?.kg || "kg";
    const phReps = (last?.sets[j]?.reps) || repTarget;
    return `<div class="set ${s.done ? "is-done" : ""}">
      <span class="set-n" aria-hidden="true">${j + 1}</span>
      <input class="sin" id="s-kg-${j}" data-set="${j}" data-f="kg" inputmode="${LIB[l[0]]?.load === "band" ? "text" : "decimal"}" placeholder="${esc(phKg)}" value="${esc(s.kg)}" aria-label="Set ${j + 1} weight, ${wh[0]}">
      <input class="sin" id="s-reps-${j}" data-set="${j}" data-f="reps" inputmode="numeric" placeholder="${esc(phReps)}" value="${esc(s.reps)}" aria-label="Set ${j + 1} reps">
      <button type="button" class="fail" data-fail="${j}" aria-pressed="${!!s.fail}" aria-label="Set ${j + 1} went to failure">Fail</button>
      <button type="button" class="tick" data-tick="${j}" aria-pressed="${!!s.done}" aria-label="Set ${j + 1} done">✓</button>
    </div>`;
  }).join("");
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sh-title" tabindex="-1">
    <div class="sh-head">
      <div class="sh-top">
        <div style="display:grid;gap:4px;min-width:0"><span class="label">Exercise ${sheetI + 1} of ${n} · ${day.d} ${day.title} · ${wk.name}</span><h2 id="sh-title">${esc(l[0])}</h2></div>
        <button type="button" class="x" data-close aria-label="Close">✕</button>
      </div>
      <div class="target"><span class="chip iron">${target} × ${l[2]}</span><span class="chip warm">Rest ${l[3]}</span><span class="chip engine">RIR ${wk.rir}</span>${l[6] ? `<span class="chip iron">Superset ${l[6]}</span>` : ""}</div>
    </div>
    <div class="sh-body">
      ${p.img.length ? `<div class="shots">${p.img.map((src, k) => `<figure><img src="${src}" alt="${esc(l[0])}, ${k ? "finish" : "start"} position"><figcaption>${k ? "2 · Finish" : "1 · Start"}</figcaption></figure>`).join("")}</div>` : ""}
      ${info ? `<details class="howto" id="howto" ${howOpen ? "open" : ""}><summary>How to do it</summary><div class="how-text">
        <p>${esc(info[1])}</p>
        <ol>${info[2].map(s => `<li>${esc(s)}</li>`).join("")}</ol>
        <p style="color:var(--muted)">Cue: ${esc(l[4])}</p>
        <div class="muscles">${p.muscles.map(m => `<span>${esc(m)}</span>`).join("")}${p.secondary.slice(0, 3).map(m => `<span class="sec">${esc(m)}</span>`).join("")}</div>
        <a href="${ytLink(l[0])}" target="_blank" rel="noopener">Watch video demos ↗</a>
      </div></details>` : ""}
      <p class="last">${last ? `${last.week}: <b>${esc(fmtSets(last.sets))}</b>. Try to beat it by a rep or a little weight.` : `First time logging this. Pick a weight you could lift about ${wk.rir} more reps with.`}</p>
      ${l[7] ? `<p class="warn-note" style="border-color:var(--warm);background:var(--warm-soft)">⚠ ${esc(l[7])}</p>` : ""}
      ${wh[1] ? `<p class="wt-hint">${wh[1]}</p>` : ""}
      <div class="sets"><div class="set-head" aria-hidden="true"><span>Set</span><span>${wh[0]}</span><span>Reps</span><span>Fail</span><span>Done</span></div>${rows}</div>
      ${e.sets.some(x => x.fail) && wk.rir >= 2 ? `<p class="warn-note">${wk.name} aims to stop about ${wk.rir} reps short of failure. Going to failure this early tires you out fast, so try a little lighter on the next set.</p>` : ""}
      <button type="button" class="addset" data-add>+ Add set</button>
      ${endEntry() ? "" : `<button type="button" class="end-link" data-endopen>End session early</button>`}
    </div>
    <div class="sh-foot">
      <div id="restSlot"></div>
      <button type="button" data-nav="-1" ${sheetI === 0 ? "disabled" : ""}>← Prev</button>
      <button type="button" data-close>Close</button>
      <button type="button" class="primary" data-nav="1">${sheetI === n - 1 ? "Next → Cardio" : "Next →"}</button>
    </div>
  </div>`;
  drawRest();
}
function drawRest() {
  const slot = document.getElementById("restSlot"); if (!slot) return;
  if (!restEnd) { slot.innerHTML = ""; return; }
  const left = Math.max(0, Math.ceil((restEnd - Date.now()) / 1000));
  if (left === 0) {
    slot.innerHTML = `<div class="rest-bar go" role="status"><span>Rest done. Next set!</span><button type="button" data-skip>OK</button></div>`;
    clearInterval(restTimer); restTimer = null;
    return;
  }
  slot.innerHTML = `<div class="rest-bar" role="timer"><span>Rest</span><b>${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}</b><span style="display:flex;gap:6px"><button type="button" data-plus>+30 s</button><button type="button" data-skip>Skip</button></span></div>`;
}
function startRest(secs) {
  restTotal = secs; restEnd = Date.now() + secs * 1000;
  clearInterval(restTimer); restTimer = setInterval(drawRest, 500); drawRest();
}
function stopRest() { restEnd = 0; clearInterval(restTimer); restTimer = null; drawRest(); }
function syncDone() {
  const l = DAYS[state.day].lifts[sheetI], e = entryFor(sheetI);
  e.done = e.sets.filter(s => s.done).length >= setsFor(l, WEEKS[state.week]);
}

sheet.addEventListener("click", e => {
  if (e.target === sheet) return closeSheet();
  const t = e.target.closest("button"); if (!t) return;
  if (t.hasAttribute("data-close")) return closeSheet();
  if (sheetI === "settings") { settingsClick(t); return; }
  if (endClick(t)) return;
  if (cardioClick(t)) return;
  if (typeof sheetI !== "number" || sheetI >= DAYS[state.day].lifts.length) return;
  const ent = entryFor(sheetI);
  if (t.dataset.nav) {
    const n = DAYS[state.day].lifts.length, to = sheetI + +t.dataset.nav;
    if (to > n || to < 0) return;
    if (to === n) stopRest();
    sheetI = to; renderSheet(); sheet.querySelector(".sheet-panel").scrollTop = 0; sheet.querySelector(".sheet-panel").focus(); return;
  }
  if (t.dataset.tick !== undefined || t.dataset.fail !== undefined) {
    const isFail = t.dataset.fail !== undefined, j = +(isFail ? t.dataset.fail : t.dataset.tick), s = ent.sets[j];
    if (isFail) s.fail = !s.fail;
    if (!s.done && (!isFail || s.fail)) {
      for (const f of ["kg", "reps"]) {
        const inp = document.getElementById(`s-${f}-${j}`);
        if (!s[f] && inp && /^\d+(\.\d+)?$/.test(inp.placeholder)) s[f] = inp.placeholder;
      }
      s.done = true;
      const more = ent.sets.some(x => !x.done);
      if (more) startRest(restSecs(DAYS[state.day].lifts[sheetI][3])); else stopRest();
    } else if (!isFail) { s.done = false; s.fail = false; }
    syncDone(); save(); renderSheet();
    document.querySelector(isFail ? `[data-fail="${j}"]` : `[data-tick="${j}"]`)?.focus();
    return;
  }
  if (t.hasAttribute("data-add")) { ent.sets.push({ kg: "", reps: "", done: false }); save(); renderSheet(); return; }
  if (t.hasAttribute("data-skip")) return stopRest();
  if (t.hasAttribute("data-plus")) { restEnd += 30000; drawRest(); return; }
});
sheet.addEventListener("input", e => {
  if (e.target.dataset.cf) return cardioInput(e.target);
  const j = e.target.dataset.set; if (j === undefined) return;
  entryFor(sheetI).sets[+j][e.target.dataset.f] = e.target.value.trim(); save();
});
sheet.addEventListener("change", e => { if (e.target.dataset.cf) cardioInput(e.target); });
sheet.addEventListener("toggle", e => { if (e.target.id === "howto") howOpen = e.target.open; }, true);

/* ---------- cardio timer + log ---------- */
let run = null, cardioInt = null, actx = null, muted = false, wake = null;
const runId = () => state.week + "-" + state.day;
const fmt = ms => { const t = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); };
function cardioKey() { return key(state.week, state.day, DAYS[state.day].lifts.length); }
function cardioEntry() { const k = cardioKey(); return log[k] = log[k] || {}; }
function cardioSummary(e) {
  if (!e) return "";
  const bits = [];
  if (e.min) bits.push(e.min + " min");
  if (e.km) bits.push(e.km + " km");
  if (e.hr) bits.push("avg " + e.hr + " bpm");
  if (e.rpe) bits.push("effort " + e.rpe + "/10");
  return bits.join(" · ");
}
function runFor() {
  if (!run || run.id !== runId()) {
    const ph = cardioFor(DAYS[state.day], WEEKS[state.week]).phases;
    run = { id: runId(), phases: ph, idx: 0, left: ph[0][1] * 1000, end: 0, last: 0, running: false, done: false, active: 0, pip: null };
  }
  return run;
}
function remaining() { return run.running ? run.end - Date.now() : run.left; }
function beep(freq, dur) {
  if (muted || !actx) return;
  try {
    const o = actx.createOscillator(), g = actx.createGain(), t = actx.currentTime;
    o.frequency.value = freq; o.connect(g); g.connect(actx.destination);
    g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + dur);
    o.start(t); o.stop(t + dur);
  } catch (e) {}
  try { navigator.vibrate && navigator.vibrate(Math.round(dur * 1000)); } catch (e) {}
}
async function grabWake() { try { wake = await navigator.wakeLock?.request("screen"); } catch (e) { wake = null; } }
function dropWake() { try { wake?.release(); } catch (e) {} wake = null; }
function advance() {
  run.idx++; run.pip = null;
  if (run.idx >= run.phases.length) {
    run.running = false; run.done = true; run.left = 0;
    clearInterval(cardioInt); cardioInt = null; dropWake();
    beep(880, .6);
    const e = cardioEntry();
    if (!e.min) e.min = String(Math.max(1, Math.round(run.active / 60000)));
    save();
    if (sheetI === DAYS[state.day].lifts.length) renderCardioSheet();
    return;
  }
  const ph = run.phases[run.idx];
  if (run.running) run.end = Date.now() + ph[1] * 1000; else run.left = ph[1] * 1000;
  beep(ph[2] === "hard" ? 990 : 520, .35);
}
function tick() {
  if (!run || !run.running) return;
  const now = Date.now(); run.active += now - run.last; run.last = now;
  const rem = run.end - now;
  if (rem <= 0) advance();
  else { const sec = Math.ceil(rem / 1000); if (sec <= 3 && sec !== run.pip) { run.pip = sec; beep(660, .1); } }
  drawTimer();
}
function startPause() {
  runFor();
  if (run.done) return;
  if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
  try { actx?.resume(); } catch (e) {}
  if (run.running) {
    tick(); run.left = run.end - Date.now(); run.running = false;
    clearInterval(cardioInt); cardioInt = null; dropWake();
  } else {
    run.running = true; run.last = Date.now(); run.end = Date.now() + run.left;
    if (run.idx === 0 && run.active === 0) beep(run.phases[0][2] === "hard" ? 990 : 520, .35);
    clearInterval(cardioInt); cardioInt = setInterval(tick, 200); grabWake();
  }
  drawTimer();
}
function drawTimer() {
  const box = document.getElementById("ct"); if (!box || !run) return;
  const ph = run.phases[Math.min(run.idx, run.phases.length - 1)];
  const next = run.phases[run.idx + 1];
  const rounds = run.phases.filter(p => p[2] === "hard").length;
  const roundNow = run.phases.slice(0, run.idx + 1).filter(p => p[2] === "hard").length;
  const total = run.phases.reduce((a, p) => a + p[1], 0) * 1000;
  box.dataset.kind = run.done ? "steady" : ph[2];
  document.getElementById("ct-phase").textContent = run.done ? "Finished" : ph[0];
  document.getElementById("ct-time").textContent = run.done ? fmt(run.active) : fmt(remaining());
  document.getElementById("ct-meta").innerHTML = run.done
    ? `<span>Total time <b>${fmt(run.active)}</b></span><span>Fill in your numbers below</span>`
    : [rounds && (ph[2] === "hard" || ph[2] === "easy") ? `<span>Round <b>${roundNow} of ${rounds}</b></span>` : "",
       `<span>Elapsed <b>${fmt(run.active)}</b> of ${fmt(total)}</span>`,
       next ? `<span>Next: <b>${esc(next[0])} ${fmt(next[1] * 1000)}</b></span>` : `<span>Last part</span>`].join("");
  document.querySelectorAll("#ct-bar span").forEach((el, i) => {
    el.className = "k-" + run.phases[i][2] + (run.done || i < run.idx ? " past" : i === run.idx ? " now" : "");
  });
  const go = document.getElementById("ct-go");
  go.textContent = run.done ? "Done" : run.running ? "Pause" : run.active ? "Resume" : "Start";
  go.disabled = run.done;
  document.getElementById("ct-sound").textContent = muted ? "Sound off" : "Sound on";
}
function zoneNote(c, hr) {
  const m = c.hr.match(/(\d+)–(\d+)/); const v = parseInt(hr);
  if (!m || !v || c.zone !== "Zone 2") return "";
  if (v > +m[2]) return "Above Zone 2. Slow down a little next time.";
  if (v < +m[1]) return "Below Zone 2. You can push slightly harder.";
  return "Right in Zone 2.";
}
function lastCardio() {
  for (let w = state.week - 1; w >= 0; w--) {
    const e = log[key(w, state.day, DAYS[state.day].lifts.length)];
    if (cardioSummary(e)) return WEEKS[w].name + ": " + cardioSummary(e);
  }
  return "";
}
function renderCardioSheet() {
  const day = DAYS[state.day], wk = WEEKS[state.week], c = cardioFor(day, wk), e = cardioEntry();
  runFor();
  const prev = lastCardio();
  const rpe = ["", "1 · Very easy", "2", "3 · Easy", "4", "5 · Moderate", "6", "7 · Hard", "8", "9 · Very hard", "10 · All out"];
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sh-title" tabindex="-1">
    <div class="sh-head">
      <div class="sh-top">
        <div style="display:grid;gap:4px;min-width:0"><span class="label">Cardio · ${day.d} ${day.title} · ${wk.name}</span><h2 id="sh-title">${esc(c.kind)}</h2></div>
        <button type="button" class="x" data-close aria-label="Close">✕</button>
      </div>
      <div class="target"><span class="chip engine">${c.zone}</span><span class="chip engine">${c.hr}</span><span class="chip warm">${Math.round(c.phases.reduce((a, p) => a + p[1], 0) / 60)} min</span></div>
    </div>
    <div class="sh-body">
      <div class="ct" id="ct">
        <div class="ct-phase" id="ct-phase"></div>
        <div class="ct-time" id="ct-time" role="timer" aria-live="off"></div>
        <div class="ct-meta" id="ct-meta"></div>
        <div class="ct-bar" id="ct-bar" aria-hidden="true">${c.phases.map(p => `<span style="flex:${p[1]}"></span>`).join("")}</div>
        <div class="ct-ctrl">
          <button type="button" class="go" id="ct-go" data-ct="go"></button>
          <button type="button" data-ct="skip">Skip part</button>
          <button type="button" data-ct="reset">Reset</button>
          <button type="button" id="ct-sound" data-ct="sound"></button>
        </div>
      </div>
      <ol style="margin:0;padding-left:1.2em;color:var(--muted);font-size:.92rem">${c.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol>
      ${prev ? `<p class="last">${esc(prev)}</p>` : ""}
      <div class="cform">
        <label>Minutes<input class="sin" id="c-min" data-cf="min" inputmode="numeric" placeholder="${Math.round(c.phases.reduce((a, p) => a + p[1], 0) / 60)}" value="${esc(e.min || "")}"></label>
        <label>Distance (km)<input class="sin" id="c-km" data-cf="km" inputmode="decimal" placeholder="optional" value="${esc(e.km || "")}"></label>
        <label>Avg heart rate<input class="sin" id="c-hr" data-cf="hr" inputmode="numeric" placeholder="bpm" value="${esc(e.hr || "")}"><span class="hr-note" id="c-hrnote">${zoneNote(c, e.hr)}</span></label>
        <label>Effort<select id="c-rpe" data-cf="rpe">${rpe.map((t, i) => `<option value="${i || ""}" ${String(e.rpe || "") === String(i || "") ? "selected" : ""}>${i ? t : "Pick 1–10"}</option>`).join("")}</select></label>
        <label class="full">Notes<textarea id="c-notes" data-cf="notes" placeholder="Machine level, incline, how it felt">${esc(e.notes || "")}</textarea></label>
      </div>
      ${endEntry() ? "" : `<button type="button" class="end-link" data-endopen>End session early</button>`}
    </div>
    <div class="sh-foot">
      <button type="button" data-nav="-1">← Last lift</button>
      <button type="button" data-close>Close</button>
      <button type="button" class="primary" data-ct="save">Save & finish</button>
    </div>
  </div>`;
  drawTimer();
}
function cardioInput(el) {
  const e = cardioEntry(); e[el.dataset.cf] = el.value.trim(); save();
  if (el.dataset.cf === "hr") document.getElementById("c-hrnote").textContent = zoneNote(cardioFor(DAYS[state.day], WEEKS[state.week]), el.value);
}
function cardioClick(t) {
  const a = t.dataset.ct; if (!a) return false;
  if (a === "go") startPause();
  else if (a === "skip") { runFor(); if (!run.done) { if (run.running) tick(); advance(); drawTimer(); } }
  else if (a === "reset") { clearInterval(cardioInt); cardioInt = null; dropWake(); run = null; runFor(); drawTimer(); }
  else if (a === "sound") { muted = !muted; drawTimer(); }
  else if (a === "save") { if (run?.running) { tick(); run.left = run.end - Date.now(); run.running = false; clearInterval(cardioInt); cardioInt = null; dropWake(); } cardioEntry().done = true; save(); closeSheet(true); }
  return true;
}
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && run?.running) grabWake(); });

/* ---------- end session early ---------- */
const REASONS = ["Muscles too tired", "Out of time", "Pain or injury", "Felt unwell", "Equipment busy", "Other"];
let endReturn = null, endDraft = { reason: "", note: "" };
const endKey = () => key(state.week, state.day, "end");
const endEntry = () => log[endKey()];
function endBanner() {
  const e = endEntry();
  if (!e) return `<button type="button" class="end-btn" data-endopen>End session early</button>`;
  const when = e.at ? new Date(e.at).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" }) : "";
  return `<div class="ended"><span><b>Ended early</b> · ${esc(e.reason || "No reason given")}${when ? " · " + esc(when) : ""}${e.note ? `<br>“${esc(e.note)}”` : ""}</span><button type="button" data-unend>Undo</button></div>`;
}
function sessionTally() {
  const day = DAYS[state.day]; let ex = 0, sets = 0;
  day.lifts.forEach((l, i) => { const s = (log[key(state.week, state.day, i)]?.sets || []).filter(x => x.done).length; sets += s; if (s || log[key(state.week, state.day, i)]?.done) ex++; });
  return { ex, sets, total: day.lifts.length, cardio: !!log[key(state.week, state.day, day.lifts.length)]?.done };
}
function renderEndSheet() {
  const day = DAYS[state.day], wk = WEEKS[state.week], t = sessionTally();
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sh-title" tabindex="-1">
    <div class="sh-head">
      <div class="sh-top">
        <div style="display:grid;gap:4px;min-width:0"><span class="label">${day.d} ${day.title} · ${wk.name}</span><h2 id="sh-title">End session early</h2></div>
        <button type="button" class="x" data-close aria-label="Close">✕</button>
      </div>
    </div>
    <div class="sh-body">
      <p>So far: <b>${t.ex} of ${t.total}</b> exercises, <b>${t.sets}</b> sets${t.cardio ? ", cardio done" : ", no cardio yet"}. Everything you logged stays saved.</p>
      <div style="display:grid;gap:8px"><span class="label">Why are you stopping?</span>
        <div class="reasons">${REASONS.map(r => `<button type="button" data-reason="${esc(r)}" aria-pressed="${endDraft.reason === r}">${esc(r)}</button>`).join("")}</div>
      </div>
      ${endDraft.reason === "Pain or injury" ? `<p class="warn-note">Don't train through sharp or joint pain. If it hasn't eased in a few days, see a physio or doctor.</p>` : ""}
      ${endDraft.reason === "Muscles too tired" ? `<p class="last">Normal early in a block. Next time drop the weight about 10% and stop ${wk.rir} reps short of failure.</p>` : ""}
      <div class="cform"><label class="full">Note<textarea id="end-note" data-endnote placeholder="e.g. arms gave out on the curls">${esc(endDraft.note)}</textarea></label></div>
    </div>
    <div class="sh-foot" style="grid-template-columns:1fr 1.6fr">
      <button type="button" data-endback>${endReturn === null ? "Cancel" : "← Back"}</button>
      <button type="button" class="primary" data-endsave>Save & end session</button>
    </div>
  </div>`;
}
function endClick(t) {
  if (t.hasAttribute("data-endopen")) { endReturn = sheetI; endDraft = { reason: "", note: "" }; sheetI = "end"; renderSheet(); return true; }
  if (sheetI !== "end") return false;
  if (t.dataset.reason) { endDraft.reason = endDraft.reason === t.dataset.reason ? "" : t.dataset.reason; renderEndSheet(); document.querySelector(`[data-reason="${CSS.escape(t.dataset.reason)}"]`)?.focus(); return true; }
  if (t.hasAttribute("data-endback")) { if (endReturn === null) closeSheet(); else { sheetI = endReturn; renderSheet(); } return true; }
  if (t.hasAttribute("data-endsave")) {
    const tl = sessionTally();
    log[endKey()] = { endedEarly: true, reason: endDraft.reason, note: endDraft.note.trim(), at: new Date().toISOString(), exercisesDone: tl.ex + "/" + tl.total, setsDone: tl.sets, cardioDone: tl.cardio };
    stopRest();
    if (run?.running) { tick(); run.left = run.end - Date.now(); run.running = false; clearInterval(cardioInt); cardioInt = null; dropWake(); }
    save(); sheetI = null; sheet.hidden = true; document.body.style.overflow = ""; render();
    return true;
  }
  return false;
}
sheet.addEventListener("input", e => { if (e.target.hasAttribute("data-endnote")) endDraft.note = e.target.value; });

/* ---------- saved log (server) ---------- */
function canon(v) {
  if (Array.isArray(v)) return "[" + v.map(canon).join(",") + "]";
  if (v && typeof v === "object") return "{" + Object.keys(v).sort().filter(k => v[k] !== undefined).map(k => JSON.stringify(k) + ":" + canon(v[k])).join(",") + "}";
  return JSON.stringify(v);
}
function addMeta(k, e) {
  const m = k.match(/^(\d+)-(\d+)-(.+)$/); if (!m) return;
  const [, w, d, item] = m, day = DAYS[+d], wk = WEEKS[+w];
  if (!day || !wk || day.rest) return;
  if (!e.week) e.week = wk.name;
  if (!e.day) e.day = day.d + " " + day.title;
  if (!e.item) e.item = item === "end" ? "Ended session early" : item === "cardio" ? "Cardio: " + cardioFor(day, wk).kind : day.lifts.find(l => slug(l[0]) === item)?.[0] || item;
  if (!e.date) e.date = new Date().toISOString().slice(0, 10);
}
function setStatus(s, msg) {
  const el = document.getElementById("syncStatus"); if (!el) return;
  el.dataset.s = s;
  el.textContent = msg || { saved: "Saved to your log", saving: "Saving…", wait: "Loading your log…" }[s] || "";
}
async function flush() {
  if (!loaded) return;
  if (syncing) { clearTimeout(syncTimer); syncTimer = setTimeout(flush, 400); return; }
  syncing = true;
  try {
    for (const k of Object.keys(log)) {
      if (!log[k] || typeof log[k] !== "object") continue;
      addMeta(k, log[k]);
      const c = canon(log[k]);
      if (c === synced[k]) continue;
      await api.putEntry(k, log[k]);
      synced[k] = c;
    }
    for (const k of Object.keys(synced)) {
      if (log[k]) continue;
      await api.deleteEntry(k);
      delete synced[k];
    }
    setStatus("saved");
  } catch (e) {
    if (e.status === 401) { syncing = false; return showAuth(); }
    setStatus("error", "Not saved yet: can't reach the server. Retrying shortly.");
    clearTimeout(syncTimer); syncTimer = setTimeout(flush, 15000);
  } finally { syncing = false; }
}
async function loadLog() {
  const entries = await api.getLog();
  log = entries; synced = {};
  for (const [k, v] of Object.entries(entries)) synced[k] = canon(v);
  loaded = true; setStatus("saved");
}
// Pick up changes made on another device when the app comes back to the front.
document.addEventListener("visibilitychange", async () => {
  if (document.visibilityState !== "visible" || !loaded || syncing) return;
  if (Object.keys(log).some(k => canon(log[k]) !== synced[k])) return;
  try { await loadLog(); renderGrid(); if (sheetI === null) renderSession(); } catch (e) { if (e.status === 401) showAuth(); }
});
document.addEventListener("keydown", e => { if (e.key === "Escape" && sheetI !== null) closeSheet(); });
document.getElementById("session").addEventListener("change", e => {
  const i = e.target.dataset.i; if (i === undefined) return;
  const k = key(state.week, state.day, i); log[k] = log[k] || {};
  if (e.target.type === "checkbox") { log[k].done = e.target.checked; save(); renderGrid(); renderSession(); }
  else { log[k].kg = e.target.value.trim(); save(); }
});
const resetBtn = document.getElementById("resetBtn");
let armed = false;
resetBtn.addEventListener("click", () => {
  if (!armed) { armed = true; resetBtn.textContent = "Tap again to clear"; resetBtn.classList.add("confirm"); setTimeout(() => { armed = false; resetBtn.textContent = "Clear my log"; resetBtn.classList.remove("confirm"); }, 4000); return; }
  armed = false; log = {}; save(); resetBtn.textContent = "Log cleared"; resetBtn.classList.remove("confirm"); render();
  setTimeout(() => { resetBtn.textContent = "Clear my log"; }, 2000);
});

/* ---------- header ---------- */
function renderHeader() {
  const p = PROGRAM;
  document.title = p.name;
  document.getElementById("subtitle").textContent = p.subtitle || "";
  document.getElementById("progName").innerHTML = esc(p.name).replace(" + ", ' <span class="amp">+</span> ');
  document.getElementById("lede").textContent = p.lede || "";
  const notice = document.getElementById("notice");
  notice.hidden = !p.notice; notice.textContent = p.notice || "";
  const since = BLOCK ? new Date(BLOCK.startedAt).toLocaleDateString([], { day: "numeric", month: "short" }) : "";
  const chips = [["Training", ME.name + (ME.age ? ", " + ME.age : "")], ["Block", BLOCK ? BLOCK.number + " · since " + since : ""], ["Goal", p.goal], ["Days / week", p.daysPerWeek], ["Session", p.sessionLength]];
  if (ME.age) chips.push(["Est. max HR", (220 - ME.age) + " bpm"]);
  document.getElementById("profileChips").innerHTML = chips.filter(c => c[1]).map(([k, v]) => `<div><span class="label">${esc(k)}</span><b>${esc(v)}</b></div>`).join("");
  document.getElementById("rules").innerHTML = (p.rules || []).map(([label, big, text]) => `<div class="rule"><span class="label">${esc(label)}</span><span class="big">${esc(big)}</span><p>${esc(text)}</p></div>`).join("");
  document.getElementById("meBtn").textContent = ME.name + " ▾";
}
document.getElementById("meBtn").addEventListener("click", () => openSettings());

/* ---------- sign in ---------- */
const authView = document.getElementById("authView");
let authPeople = [], authPrograms = [], authSel = null;

async function showAuth() {
  ME = null; loaded = false; clearTimeout(syncTimer); stopRest();
  document.getElementById("appView").hidden = true;
  sheet.hidden = true; sheetI = null; document.body.style.overflow = "";
  authView.hidden = false;
  authView.innerHTML = `<p class="label">Loading…</p>`;
  try { [authPeople, authPrograms] = await Promise.all([api.profiles(), api.programs()]); }
  catch (e) {
    authView.innerHTML = `<h1>Iron <span class="amp">+</span> Engine</h1><p class="err">Can't reach the server: ${esc(e.message)}</p><button type="button" class="primary-btn" data-retry>Try again</button>`;
    return;
  }
  if (!authPeople.length) return renderSetup();
  authSel = null;
  authView.innerHTML = `<div style="display:grid;gap:6px"><span class="label">Who's training?</span><h1>Iron <span class="amp">+</span> Engine</h1></div>
    <div class="people">${authPeople.map(p => `<button type="button" class="person" data-person="${esc(p.id)}">${esc(p.name)}<small>${p.hasPin ? "PIN" : "Tap to start"}</small></button>`).join("")}</div>
    <form class="form" id="pinForm" hidden><label>PIN for <span id="pinName"></span><input class="sin" id="pinInput" inputmode="numeric" autocomplete="current-password" type="password"></label><button class="primary-btn" type="submit">Sign in</button></form>
    <p class="err" id="authErr" role="alert"></p>`;
}
function programOptions(selected) {
  return authPrograms.map(p => `<option value="${esc(p.id)}" ${p.id === selected ? "selected" : ""}>${esc(p.name)}${p.subtitle ? " · " + esc(p.subtitle) : ""}</option>`).join("");
}
function personFields(prefix) {
  return `<label>Name<input class="sin" id="${prefix}-name" autocomplete="off" maxlength="40"></label>
    <label>Age (for heart-rate zones, optional)<input class="sin" id="${prefix}-age" inputmode="numeric"></label>
    <label>Program<select id="${prefix}-prog">${programOptions(authPrograms[0]?.id)}</select></label>
    <label>PIN (4–8 digits, optional)<input class="sin" id="${prefix}-pin" inputmode="numeric" type="password" autocomplete="new-password"></label>`;
}
function readPerson(prefix) {
  const v = id => document.getElementById(`${prefix}-${id}`).value.trim();
  return { name: v("name"), age: v("age") || undefined, programId: v("prog"), pin: v("pin") || undefined };
}
function renderSetup() {
  authView.innerHTML = `<div style="display:grid;gap:6px"><span class="label">First-time setup</span><h1>Iron <span class="amp">+</span> Engine</h1></div>
    <p>Add the first person. You can add others later from settings.</p>
    <form class="form" id="setupForm">${personFields("new")}<button class="primary-btn" type="submit">Start training</button></form>
    <p class="err" id="authErr" role="alert"></p>`;
}
async function signedIn(profile) { ME = profile; authView.hidden = true; await startApp(); }

authView.addEventListener("click", async e => {
  if (e.target.closest("[data-retry]")) return showAuth();
  const b = e.target.closest("[data-person]"); if (!b) return;
  const p = authPeople.find(x => x.id === b.dataset.person); authSel = p;
  document.getElementById("authErr").textContent = "";
  if (p.hasPin) {
    document.getElementById("pinForm").hidden = false;
    document.getElementById("pinName").textContent = p.name;
    const inp = document.getElementById("pinInput"); inp.value = ""; inp.focus();
    return;
  }
  try { await signedIn(await api.login(p.id)); } catch (err) { document.getElementById("authErr").textContent = err.message; }
});
authView.addEventListener("submit", async e => {
  e.preventDefault();
  const errEl = document.getElementById("authErr");
  try {
    if (e.target.id === "pinForm") await signedIn(await api.login(authSel.id, document.getElementById("pinInput").value));
    if (e.target.id === "setupForm") { await api.createProfile(readPerson("new")); await signedIn(await api.me()); }
  } catch (err) { errEl.textContent = err.message; }
});

/* ---------- settings ---------- */
let settingsMsg = {}, newBlockArmed = false, connArmed = false, connectorUrl = "", watchKey = "", watchArmed = false;
async function openSettings() {
  try { authPrograms = await api.programs(); } catch (e) {}
  settingsMsg = {}; newBlockArmed = false; connArmed = false; connectorUrl = ""; watchKey = ""; watchArmed = false; openSheet("settings");
}
function renderSettings() {
  const m = k => settingsMsg[k] ? `<p class="${settingsMsg[k].ok ? "ok" : "err"}" role="status">${esc(settingsMsg[k].text)}</p>` : "";
  sheet.innerHTML = `<div class="sheet-panel" role="dialog" aria-modal="true" aria-labelledby="sh-title" tabindex="-1">
    <div class="sh-head"><div class="sh-top"><div style="display:grid;gap:4px"><span class="label">Signed in</span><h2 id="sh-title">${esc(ME.name)}</h2></div><button type="button" class="x" data-close aria-label="Close">✕</button></div></div>
    <div class="sh-body">
      <div class="settings-sec form"><span class="label">Your details</span>
        <label>Age (for heart-rate zones)<input class="sin" id="set-age" inputmode="numeric" value="${esc(ME.age ?? "")}"></label>
        <label>New PIN (4–8 digits)<input class="sin" id="set-pin" inputmode="numeric" type="password" autocomplete="new-password" placeholder="${ME.hasPin ? "Leave empty to keep your PIN" : "No PIN set"}"></label>
        ${ME.hasPin ? `<button type="button" class="btn" data-pin-remove style="justify-self:start">Remove PIN</button>` : ""}
        <label>Notes for your coach (injuries, goals, how training feels)<textarea id="set-notes" style="font-family:var(--f-body);font-size:.95rem">${esc(ME.notes || "")}</textarea></label>
        <button type="button" class="primary-btn" data-set-save>Save changes</button>${m("me")}
      </div>
      <div class="settings-sec form"><span class="label">Training blocks</span>
        <p class="wt-hint">A block is one run through your plan. Starting a new one keeps all earlier blocks and their logs, and your first weeks show last block's numbers to beat.</p>
        <ol style="margin:0;padding-left:1.2em;display:grid;gap:4px">${BLOCKS.map(b => `<li>Block ${b.number}: ${esc(b.name)}, ${new Date(b.startedAt).toLocaleDateString()}${b.endedAt ? " to " + new Date(b.endedAt).toLocaleDateString() : " (current)"}</li>`).join("")}</ol>
        <label>Program for the new block<select id="set-prog">${programOptions(BLOCK?.programId || ME.programId)}</select></label>
        <button type="button" class="btn" data-new-block style="justify-self:start">${newBlockArmed ? "Tap again to start Block " + ((BLOCK?.number || 0) + 1) : "Start a new block"}</button>${m("block")}
      </div>
      <div class="settings-sec form"><span class="label">Add a person</span>${personFields("add")}<button type="button" class="btn" data-add-person style="justify-self:start">Add person</button>${m("add")}</div>
      <div class="settings-sec form"><span class="label">Your log</span>
        <button type="button" class="btn" data-copy-log style="justify-self:start">Copy my log</button>
        <label>Import a log (JSON)<textarea id="imp-json" placeholder='{"0-0-0": {"sets": [...]}}'></textarea></label>
        <button type="button" class="btn" data-import-log style="justify-self:start">Import</button>${m("log")}
      </div>
      <div class="settings-sec form"><span class="label">Garmin watch</span>
        <p class="wt-hint">In the Garmin Connect app, open the Iron + Engine watch app's settings and enter your server address (for example https://your-domain/iron) and this watch key. The key only gives access to your own training.</p>
        ${watchKey ? `<input class="sin" id="watch-key" readonly value="${esc(watchKey)}">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-watch-copy>Copy key</button><button type="button" class="btn" data-watch-new>${watchArmed ? "Tap again: the watch must be updated" : "Make a new key"}</button></div>` : `<button type="button" class="btn" data-watch-show style="justify-self:start">Show watch key</button>`}${m("watch")}
      </div>
      <div class="settings-sec form"><span class="label">Claude connector</span>
        <p class="wt-hint">Lets Claude read your logs and change training plans. In Claude, go to Settings → Connectors → Add custom connector and paste this link. Anyone with the link can read and change everyone's training, so keep it private.</p>
        ${connectorUrl ? `<input class="sin" id="conn-url" readonly value="${esc(connectorUrl)}" style="font-size:.8rem">
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button type="button" class="btn" data-conn-copy>Copy link</button><button type="button" class="btn" data-conn-new>${connArmed ? "Tap again: old link stops working" : "Make a new link"}</button></div>` : `<button type="button" class="btn" data-conn-show style="justify-self:start">Show connector link</button>`}${m("conn")}
      </div>
      <div class="settings-sec"><button type="button" class="btn" data-logout style="justify-self:start">Switch person / sign out</button></div>
    </div>
  </div>`;
}
async function settingsClick(t) {
  if (sheetI !== "settings") return false;
  const say = (k, text, ok) => { settingsMsg[k] = { text, ok }; renderSettings(); };
  try {
    if (t.hasAttribute("data-set-save")) {
      const pin = document.getElementById("set-pin").value.trim();
      const changes = { age: document.getElementById("set-age").value.trim(), notes: document.getElementById("set-notes").value };
      if (pin) changes.pin = pin;
      ME = await api.updateMe(changes);
      const { program, exercises } = await api.program(); applyProgram(program, exercises);
      renderHeader(); renderSession(); say("me", "Saved.", true);
    } else if (t.hasAttribute("data-new-block")) {
      if (!newBlockArmed) { newBlockArmed = true; renderSettings(); setTimeout(() => { if (newBlockArmed && sheetI === "settings") { newBlockArmed = false; renderSettings(); } }, 5000); return true; }
      newBlockArmed = false;
      await flush();
      await api.startBlock(document.getElementById("set-prog").value);
      closeSheet(); await startApp();
    } else if (t.hasAttribute("data-watch-show")) {
      watchKey = (await api.watchKey()).key; renderSettings();
    } else if (t.hasAttribute("data-watch-new")) {
      if (!watchArmed) { watchArmed = true; renderSettings(); return true; }
      watchArmed = false; watchKey = (await api.regenerateWatchKey()).key; say("watch", "New key made. Enter it in the watch app's settings.", true);
    } else if (t.hasAttribute("data-watch-copy")) {
      try { await navigator.clipboard.writeText(watchKey); say("watch", "Key copied.", true); }
      catch (e) { document.getElementById("watch-key").select(); say("watch", "Copy the selected key.", true); }
    } else if (t.hasAttribute("data-conn-show")) {
      connectorUrl = (await api.connector()).url; renderSettings();
    } else if (t.hasAttribute("data-conn-new")) {
      if (!connArmed) { connArmed = true; renderSettings(); return true; }
      connArmed = false; connectorUrl = (await api.regenerateConnector()).url; say("conn", "New link made. Update it in Claude.", true);
    } else if (t.hasAttribute("data-conn-copy")) {
      try { await navigator.clipboard.writeText(connectorUrl); say("conn", "Link copied.", true); }
      catch (e) { document.getElementById("conn-url").select(); say("conn", "Copy the selected link.", true); }
    } else if (t.hasAttribute("data-pin-remove")) {
      ME = await api.updateMe({ pin: "" }); say("me", "PIN removed.", true);
    } else if (t.hasAttribute("data-add-person")) {
      const p = await api.createProfile(readPerson("add")); say("add", `Added ${p.name}. They can sign in with "Switch person".`, true);
    } else if (t.hasAttribute("data-copy-log")) {
      const text = JSON.stringify(log, null, 1);
      try { await navigator.clipboard.writeText(text); say("log", "Log copied to the clipboard.", true); }
      catch (e) { document.getElementById("imp-json").value = text; document.getElementById("imp-json").select(); say("log", "Copy the selected text below.", true); document.getElementById("imp-json").value = text; }
    } else if (t.hasAttribute("data-import-log")) {
      let entries;
      try { entries = JSON.parse(document.getElementById("imp-json").value); } catch (e) { return say("log", "That isn't valid JSON. Paste the whole log, including the outer { }.", false), true; }
      const r = await api.importLog(entries);
      await loadLog(); renderGrid(); say("log", `Imported ${r.imported} item${r.imported === 1 ? "" : "s"}.`, true);
    } else if (t.hasAttribute("data-logout")) {
      await flush(); await api.logout(); showAuth();
    } else return false;
  } catch (e) {
    if (e.status === 401) { showAuth(); return true; }
    const k = t.hasAttribute("data-add-person") ? "add" : t.hasAttribute("data-import-log") || t.hasAttribute("data-copy-log") ? "log" : t.hasAttribute("data-new-block") ? "block" : /data-conn/.test(t.outerHTML) ? "conn" : /data-watch/.test(t.outerHTML) ? "watch" : "me";
    say(k, e.message, false);
  }
  return true;
}

/* ---------- start-up ---------- */
async function startApp() {
  authView.hidden = true;
  let data;
  try { data = await api.program(); }
  catch (e) { if (e.status === 401) return showAuth(); authView.hidden = false; authView.innerHTML = `<p class="err">${esc(e.message)}</p><button type="button" class="primary-btn" data-retry>Try again</button>`; return; }
  applyProgram(data.program, data.exercises);
  BLOCK = data.block; BLOCKS = data.blocks || []; PREVIOUS = data.previous;
  const today = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date().getDay()];
  state = { week: 0, day: Math.max(0, DAYS.findIndex(d => d.d === today)) };
  try { const v = JSON.parse(localStorage.getItem(viewKey()) || "null"); if (v && WEEKS[v.week] && DAYS[v.day]) state = v; } catch (e) {}
  if (run?.running) clearInterval(cardioInt);
  run = null; loaded = false; log = {}; synced = {}; setStatus("wait");
  renderHeader();
  document.getElementById("appView").hidden = false;
  render();
  try { await loadLog(); render(); }
  catch (e) { if (e.status === 401) return showAuth(); setStatus("error", "Can't reach the server. Close and reopen the app to try again."); }
}
async function boot() {
  try { ME = await api.me(); }
  catch (e) { return showAuth(); }
  await startApp();
}

boot();
if ("serviceWorker" in navigator) navigator.serviceWorker.register("./sw.js").catch(() => {});
