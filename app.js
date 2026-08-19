(() => {
  "use strict";

  const STORAGE_KEY = "attention-trainer-v1";
  const SCHEDULE = [20, 20, 20, 20, 20, 20, 20, 20, 20, 20, 25, 25, 25, 25, 25, 25, 25, 25, 25, 25, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30];
  const CHECKPOINTS = [
    { name: "Baseline", due: 0 },
    { name: "Week 2", due: 10 },
    { name: "Week 4", due: 20 },
    { name: "Week 6", due: 30 }
  ];
  const DEFAULT_STATE = { version: 1, sessions: [], readingTests: [], pending: [], lastSyncAt: null };
  let state = loadState();
  let supabase = null;
  let currentUser = null;
  let training = null;
  let timerId = null;
  let toneContext = null;

  const $ = (selector) => document.querySelector(selector);
  const $$ = (selector) => [...document.querySelectorAll(selector)];
  const clone = (value) => JSON.parse(JSON.stringify(value));
  const nowIso = () => new Date().toISOString();
  const uid = () => crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const configured = () => {
    const c = window.ATTENTION_TRAINER_CONFIG || {};
    return /^https:\/\/.+\.supabase\.co$/.test(c.supabaseUrl || "") && c.supabaseAnonKey && !c.supabaseAnonKey.startsWith("YOUR_");
  };

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || parsed.version !== 1) return clone(DEFAULT_STATE);
      return { ...clone(DEFAULT_STATE), ...parsed, sessions: parsed.sessions || [], readingTests: parsed.readingTests || [], pending: parsed.pending || [] };
    } catch { return clone(DEFAULT_STATE); }
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    renderAll();
  }

  function median(numbers) {
    if (!numbers.length) return 0;
    const sorted = [...numbers].sort((a, b) => a - b);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function average(numbers) { return numbers.length ? numbers.reduce((a, b) => a + b, 0) / numbers.length : 0; }
  function formatInterval(value) { return value ? `${Math.round(value)}s` : "—"; }
  function formatDate(value) { return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(new Date(value)); }
  function escapeHtml(value) { const div = document.createElement("div"); div.textContent = String(value ?? ""); return div.innerHTML; }

  function plannedSessionNumber() { return Math.min(state.sessions.length + 1, 30); }
  function startingInterval() {
    const latest = [...state.sessions].sort((a, b) => a.session_number - b.session_number).at(-1);
    return latest ? latest.ending_interval : 20;
  }
  function dueCheckpoint() {
    const done = new Set(state.readingTests.map((x) => x.checkpoint));
    return CHECKPOINTS.find((x) => !done.has(x.name) && state.sessions.length >= x.due) || null;
  }

  function queue(kind, id) {
    if (!state.pending.some((x) => x.kind === kind && x.id === id)) state.pending.push({ kind, id });
  }

  function renderAll() {
    const count = state.sessions.length;
    const next = Math.min(count, 29);
    $("#hero-session-count").textContent = count;
    $("#next-session-title").textContent = count >= 30 ? "Program complete" : `Session ${count + 1} · ${SCHEDULE[next]} minutes`;
    $("#next-session-week").textContent = count >= 30 ? "Complete" : `Week ${Math.floor(count / 5) + 1}`;
    $("#next-interval").textContent = formatInterval(startingInterval());
    $("#start-session").disabled = count >= 30;
    $("#start-session").textContent = count >= 30 ? "All sessions complete" : "Start training";
    renderReadingCard(); renderProgramMap(); renderStats(); renderCharts(); renderHistory(); renderAccount();
  }

  function renderReadingCard() {
    const cp = dueCheckpoint();
    const next = CHECKPOINTS.find((x) => !state.readingTests.some((r) => r.checkpoint === x.name));
    if (cp) {
      $("#reading-title").textContent = `${cp.name} test`;
      $("#reading-status").textContent = "Due now";
      $("#reading-copy").textContent = cp.name === "Baseline" ? "Complete a reading check before your first training session." : `Record your ${cp.name} reading check to compare transfer.`;
      $("#open-reading").disabled = false;
    } else if (next) {
      $("#reading-title").textContent = `${next.name} test`;
      $("#reading-status").textContent = `After session ${next.due}`;
      $("#reading-copy").textContent = "This checkpoint will unlock as you progress through the program.";
      $("#open-reading").disabled = true;
    } else {
      $("#reading-title").textContent = "All tests complete";
      $("#reading-status").textContent = "Complete";
      $("#reading-copy").textContent = "You recorded all four transfer checkpoints.";
      $("#open-reading").disabled = true;
    }
  }

  function renderProgramMap() {
    $("#program-map").innerHTML = Array.from({ length: 6 }, (_, week) => {
      const dots = Array.from({ length: 5 }, (_, day) => {
        const n = week * 5 + day + 1;
        const status = n <= state.sessions.length ? "done" : n === state.sessions.length + 1 ? "next" : "";
        return `<div class="session-dot ${status}" title="Session ${n}"></div>`;
      }).join("");
      return `<div class="week-column"><h3>Week ${week + 1}</h3>${dots}<small>${SCHEDULE[week * 5]} min each</small></div>`;
    }).join("");
  }

  function renderStats() {
    const trials = state.sessions.flatMap((x) => x.trials || []);
    $("#stat-sessions").textContent = `${state.sessions.length}/30`;
    $("#stat-interval").textContent = state.sessions.length ? formatInterval(median(state.sessions.map((x) => x.median_interval))) : "—";
    $("#stat-success").textContent = trials.length ? `${Math.round(average(trials.map((x) => x.success ? 1 : 0)) * 100)}%` : "—";
    $("#stat-minutes").textContent = Math.round(state.sessions.reduce((sum, x) => sum + x.actual_seconds, 0) / 60);
  }

  function lineChart(container, series, options = {}) {
    if (!series.length) { container.innerHTML = `<div class="chart-empty">Complete a record to see the chart.</div>`; return; }
    const width = 900, height = 220, left = 45, right = 20, top = 15, bottom = 30;
    const all = series.flatMap((s) => s.values.map((p) => p.y));
    const minY = options.min ?? Math.min(...all, 0), maxY = options.max ?? Math.max(...all, 1);
    const allX = series.flatMap((s) => s.values.map((p) => p.x));
    const minX = Math.min(...allX), maxX = Math.max(...allX, minX + 1);
    const x = (v) => left + ((v - minX) / (maxX - minX)) * (width - left - right);
    const y = (v) => top + (1 - (v - minY) / (maxY - minY || 1)) * (height - top - bottom);
    const grid = [0, .25, .5, .75, 1].map((t) => { const yy = top + t * (height - top - bottom); const val = Math.round(maxY - t * (maxY - minY)); return `<line class="grid-line" x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}"/><text class="axis-label" x="4" y="${yy+4}">${val}${options.suffix || ""}</text>`; }).join("");
    const colors = ["#2e6850", "#d69a45"];
    const lines = series.map((s, i) => { const points = s.values.map((p) => `${x(p.x)},${y(p.y)}`).join(" "); const dots = s.values.map((p) => `<circle class="chart-dot" style="stroke:${colors[i]}" cx="${x(p.x)}" cy="${y(p.y)}" r="4"><title>${escapeHtml(p.label || `${s.name}: ${p.y}`)}</title></circle>`).join(""); return `<polyline class="chart-line" style="stroke:${colors[i]}" points="${points}"/>${dots}`; }).join("");
    const legend = series.length > 1 ? series.map((s, i) => `<span style="color:${colors[i]}">● ${escapeHtml(s.name)}</span>`).join(" &nbsp; ") : "";
    container.innerHTML = `<div style="text-align:right;font-size:12px">${legend}</div><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(options.label || "Progress chart")}">${grid}${lines}</svg>`;
  }

  function renderCharts() {
    const ordered = [...state.sessions].sort((a, b) => a.session_number - b.session_number);
    lineChart($("#interval-chart"), ordered.length ? [{ name: "Median interval", values: ordered.map((s) => ({ x: s.session_number, y: s.median_interval, label: `Session ${s.session_number}: ${Math.round(s.median_interval)} seconds` })) }] : [], { suffix: "s", label: "Median attention interval by session" });
    const tests = [...state.readingTests].sort((a, b) => CHECKPOINTS.findIndex((c) => c.name === a.checkpoint) - CHECKPOINTS.findIndex((c) => c.name === b.checkpoint));
    lineChart($("#reading-chart"), tests.length ? [
      { name: "Comprehension %", values: tests.map((r, i) => ({ x: i, y: r.comprehension, label: `${r.checkpoint} comprehension: ${r.comprehension}%` })) },
      { name: "Mind-wandering / hour", values: tests.map((r, i) => ({ x: i, y: Math.round(r.mind_wanders / r.duration_minutes * 60), label: `${r.checkpoint}: ${r.mind_wanders} episodes in ${r.duration_minutes} minutes` })) }
    ] : [], { min: 0, max: 100, label: "Reading transfer measures by checkpoint" });
  }

  function renderHistory() {
    const sessions = [...state.sessions].sort((a, b) => b.session_number - a.session_number);
    $("#history-list").classList.toggle("empty", !sessions.length);
    $("#history-list").innerHTML = sessions.length ? sessions.map((s) => `<div class="history-row"><div><strong>Session ${s.session_number}</strong><br><span>${formatDate(s.completed_at)}</span></div><div><span>Median</span><br><strong>${formatInterval(s.median_interval)}</strong></div><div><span>Success</span><br><strong>${Math.round(s.success_rate*100)}%</strong></div><div><span>Duration</span><br><strong>${Math.round(s.actual_seconds/60)} min</strong></div></div>`).join("") : "No sessions yet.";
  }

  function renderAccount() {
    const isConfigured = configured();
    $("#account-button").textContent = currentUser ? (state.pending.length ? `${state.pending.length} pending` : "Synced") : "Local mode";
    $("#sync-summary").textContent = currentUser ? (state.pending.length ? `${state.pending.length} change(s) waiting to sync` : `Synced${state.lastSyncAt ? ` ${formatDate(state.lastSyncAt)}` : ""}`) : "Saved on this device";
    $("#config-warning").classList.toggle("hidden", isConfigured);
    $("#signed-out-panel").classList.toggle("hidden", !!currentUser || !isConfigured);
    $("#signed-in-panel").classList.toggle("hidden", !currentUser);
    $("#account-email").textContent = currentUser?.email || "";
    $("#cloud-description").textContent = currentUser ? `Signed in as ${currentUser.email}. Local changes sync automatically.` : isConfigured ? "Sign in with an email magic link to sync privately across devices." : "Add your Supabase project details to enable private cross-device sync. Local mode is fully functional.";
    $("#sync-now").disabled = !currentUser;
  }

  function switchView(name) {
    $$(".view").forEach((x) => x.classList.toggle("active", x.id === `${name}-view`));
    $$(".nav-link").forEach((x) => x.classList.toggle("active", x.dataset.view === name));
    history.replaceState(null, "", `#${name}`);
  }

  function toast(message) {
    const el = $("#toast"); el.textContent = message; el.classList.add("show");
    setTimeout(() => el.classList.remove("show"), 3200);
  }

  function playTone() {
    try {
      toneContext ||= new (window.AudioContext || window.webkitAudioContext)();
      const oscillator = toneContext.createOscillator(); const gain = toneContext.createGain();
      oscillator.frequency.value = 660; gain.gain.setValueAtTime(.12, toneContext.currentTime); gain.gain.exponentialRampToValueAtTime(.001, toneContext.currentTime + .45);
      oscillator.connect(gain).connect(toneContext.destination); oscillator.start(); oscillator.stop(toneContext.currentTime + .45);
    } catch { /* visual prompt remains available */ }
  }

  function openTraining() {
    const n = plannedSessionNumber();
    $("#training-session-number").textContent = n; $("#training-duration").textContent = `${SCHEDULE[n - 1]} minutes`;
    $("#training-setup").classList.remove("hidden"); $("#training-active").classList.add("hidden"); $("#training-complete").classList.add("hidden");
    $("#training-dialog").showModal();
  }

  function beginTraining() {
    const n = plannedSessionNumber();
    training = { id: uid(), session_number: n, planned_minutes: SCHEDULE[n - 1], started_at: nowIso(), startMs: Date.now(), durationMs: SCHEDULE[n - 1] * 60000, interval: startingInterval(), starting_interval: startingInterval(), trials: [], awaiting: false, nextPromptAt: Date.now() + startingInterval() * 1000 };
    $("#training-setup").classList.add("hidden"); $("#training-active").classList.remove("hidden");
    timerId = setInterval(tickTraining, 250); tickTraining();
  }

  function tickTraining() {
    if (!training) return;
    const elapsed = Date.now() - training.startMs, remaining = Math.max(0, training.durationMs - elapsed);
    const mins = Math.floor(remaining / 60000), secs = Math.floor((remaining % 60000) / 1000);
    $("#training-time").textContent = `${mins}:${String(secs).padStart(2, "0")}`;
    $("#training-trial-count").textContent = `Trial ${training.trials.length + 1}`;
    if (remaining <= 0) return finishTraining();
    if (!training.awaiting && Date.now() >= training.nextPromptAt) {
      training.awaiting = true; playTone(); $("#trial-response").classList.remove("hidden"); $("#training-instruction").classList.add("hidden");
    }
  }

  function recordTrial(success) {
    if (!training?.awaiting) return;
    training.trials.push({ at: nowIso(), interval_seconds: Number(training.interval.toFixed(2)), success });
    training.interval = Math.max(5, Math.min(300, training.interval * (success ? 1.1 : .8)));
    training.awaiting = false; training.nextPromptAt = Date.now() + training.interval * 1000;
    $("#trial-response").classList.add("hidden"); $("#training-instruction").classList.remove("hidden");
  }

  function finishTraining() {
    if (!training) return;
    clearInterval(timerId); timerId = null;
    const completed = nowIso(), actual = Math.max(1, Math.round((Date.now() - training.startMs) / 1000));
    const intervals = training.trials.map((x) => x.interval_seconds);
    const successes = training.trials.filter((x) => x.success).length;
    const row = { id: training.id, session_number: training.session_number, started_at: training.started_at, completed_at: completed, planned_minutes: training.planned_minutes, actual_seconds: actual, starting_interval: training.starting_interval, ending_interval: Number(training.interval.toFixed(2)), median_interval: Number((median(intervals) || training.starting_interval).toFixed(2)), success_rate: training.trials.length ? Number((successes / training.trials.length).toFixed(4)) : 0, trials: training.trials, client_updated_at: completed };
    state.sessions = state.sessions.filter((x) => x.session_number !== row.session_number); state.sessions.push(row); queue("session", row.id); saveState();
    $("#training-active").classList.add("hidden"); $("#training-complete").classList.remove("hidden");
    $("#session-results").innerHTML = `<div><strong>${row.trials.length}</strong><span>checks</span></div><div><strong>${formatInterval(row.median_interval)}</strong><span>median interval</span></div><div><strong>${Math.round(row.success_rate*100)}%</strong><span>success rate</span></div>`;
    training = null; syncAll();
  }

  function openReading() {
    const cp = dueCheckpoint(); if (!cp) return;
    $("#reading-form").dataset.checkpoint = cp.name; $("#reading-form-title").textContent = `${cp.name} test`; $("#reading-dialog").showModal();
  }

  function saveReading(event) {
    event.preventDefault(); const form = new FormData(event.currentTarget); const checkpoint = event.currentTarget.dataset.checkpoint; const stamp = nowIso();
    const row = { id: uid(), checkpoint, tested_at: stamp, duration_minutes: Number(form.get("durationMinutes")), mind_wanders: Number(form.get("mindWanders")), comprehension: Number(form.get("comprehension")), difficulty: form.get("difficulty"), material: String(form.get("material") || ""), client_updated_at: stamp };
    state.readingTests = state.readingTests.filter((x) => x.checkpoint !== checkpoint); state.readingTests.push(row); queue("reading", row.id); saveState();
    event.currentTarget.reset(); $("#reading-dialog").close(); toast("Reading test saved"); syncAll();
  }

  function download(filename, text, type) {
    const blob = new Blob([text], { type }); const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportJson() { download(`attention-trainer-${new Date().toISOString().slice(0,10)}.json`, JSON.stringify({ exportedAt: nowIso(), app: "Attention Trainer", ...state }, null, 2), "application/json"); }
  function csvCell(value) { const text = String(value ?? ""); return /[",\n]/.test(text) ? `"${text.replaceAll('"','""')}"` : text; }
  function exportCsv() {
    const rows = [["record_type","checkpoint_or_session","date","planned_minutes","actual_minutes","median_interval_seconds","success_rate_percent","mind_wanders","comprehension_percent","difficulty","material"]];
    state.sessions.forEach((s) => rows.push(["training",s.session_number,s.completed_at,s.planned_minutes,(s.actual_seconds/60).toFixed(1),s.median_interval,(s.success_rate*100).toFixed(1),"","","",""]));
    state.readingTests.forEach((r) => rows.push(["reading",r.checkpoint,r.tested_at,"",r.duration_minutes,"","",r.mind_wanders,r.comprehension,r.difficulty,r.material]));
    download(`attention-trainer-${new Date().toISOString().slice(0,10)}.csv`, rows.map((r) => r.map(csvCell).join(",")).join("\n"), "text/csv");
  }

  async function importJson(event) {
    const file = event.target.files[0]; if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (!Array.isArray(data.sessions) || !Array.isArray(data.readingTests)) throw new Error("This is not an Attention Trainer backup.");
      const byNewest = (local, incoming, unique) => { const map = new Map(local.map((x) => [x[unique], x])); incoming.forEach((x) => { const old = map.get(x[unique]); if (!old || new Date(x.client_updated_at || 0) > new Date(old.client_updated_at || 0)) map.set(x[unique], x); }); return [...map.values()]; };
      state.sessions = byNewest(state.sessions, data.sessions, "session_number"); state.readingTests = byNewest(state.readingTests, data.readingTests, "checkpoint");
      state.sessions.forEach((x) => queue("session", x.id)); state.readingTests.forEach((x) => queue("reading", x.id)); saveState(); toast("Backup imported and merged"); syncAll();
    } catch (error) { toast(error.message || "Could not import that file"); }
    event.target.value = "";
  }

  async function initSupabase() {
    if (!configured() || !window.supabase?.createClient) { renderAccount(); return; }
    const c = window.ATTENTION_TRAINER_CONFIG;
    supabase = window.supabase.createClient(c.supabaseUrl, c.supabaseAnonKey, { auth: { persistSession: true, detectSessionInUrl: true, flowType: "pkce" } });
    const { data } = await supabase.auth.getSession(); currentUser = data.session?.user || null; renderAccount();
    supabase.auth.onAuthStateChange((_event, session) => { currentUser = session?.user || null; renderAccount(); if (currentUser) setTimeout(syncAll, 0); });
    if (currentUser) syncAll();
  }

  async function login(event) {
    event.preventDefault(); if (!supabase) return;
    const email = new FormData(event.currentTarget).get("email"); $("#account-message").textContent = "Sending…";
    const redirectTo = `${location.origin}${location.pathname}`;
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: redirectTo } });
    $("#account-message").textContent = error ? error.message : "Check your email for the secure sign-in link.";
  }

  function localToCloud(row, kind) {
    if (kind === "session") return { ...row, user_id: currentUser.id };
    return { ...row, user_id: currentUser.id };
  }
  function cloudToLocal(row) { const { user_id, created_at, ...local } = row; return local; }

  async function syncAll() {
    if (!supabase || !currentUser || !navigator.onLine) { renderAccount(); return; }
    try {
      const [sessionResult, readingResult] = await Promise.all([
        supabase.from("training_sessions").select("*"),
        supabase.from("reading_tests").select("*")
      ]);
      if (sessionResult.error) throw sessionResult.error; if (readingResult.error) throw readingResult.error;
      mergeCloud(sessionResult.data.map(cloudToLocal), "sessions", "session_number");
      mergeCloud(readingResult.data.map(cloudToLocal), "readingTests", "checkpoint");
      const sessionRows = state.sessions.map((x) => localToCloud(x, "session"));
      const readingRows = state.readingTests.map((x) => localToCloud(x, "reading"));
      if (sessionRows.length) { const { error } = await supabase.from("training_sessions").upsert(sessionRows, { onConflict: "user_id,session_number" }); if (error) throw error; }
      if (readingRows.length) { const { error } = await supabase.from("reading_tests").upsert(readingRows, { onConflict: "user_id,checkpoint" }); if (error) throw error; }
      state.pending = []; state.lastSyncAt = nowIso(); saveState();
    } catch (error) { console.error("Sync failed", error); renderAccount(); toast(`Sync paused: ${error.message || "try again later"}`); }
  }

  function mergeCloud(cloud, key, unique) {
    const map = new Map(state[key].map((x) => [x[unique], x]));
    cloud.forEach((incoming) => { const existing = map.get(incoming[unique]); if (!existing || new Date(incoming.client_updated_at) > new Date(existing.client_updated_at)) map.set(incoming[unique], incoming); });
    state[key] = [...map.values()];
  }

  function bindEvents() {
    $$(".nav-link").forEach((x) => x.addEventListener("click", () => switchView(x.dataset.view)));
    $$("[data-close]").forEach((x) => x.addEventListener("click", () => { const dialog = document.getElementById(x.dataset.close); if (dialog.id === "training-dialog" && training && !confirm("End this session without saving?")) return; if (training) { clearInterval(timerId); training = null; } dialog.close(); }));
    $("#start-session").addEventListener("click", openTraining); $("#begin-training").addEventListener("click", beginTraining); $("#finish-early").addEventListener("click", finishTraining);
    $$("[data-success]").forEach((x) => x.addEventListener("click", () => recordTrial(x.dataset.success === "true")));
    $("#open-reading").addEventListener("click", openReading); $("#reading-form").addEventListener("submit", saveReading);
    [$("#account-button"), $("#data-account-button")].forEach((x) => x.addEventListener("click", () => $("#account-dialog").showModal()));
    $("#login-form").addEventListener("submit", login); $("#sign-out").addEventListener("click", async () => { await supabase?.auth.signOut(); currentUser = null; renderAccount(); });
    [$("#sync-now"), $("#account-sync")].forEach((x) => x.addEventListener("click", syncAll));
    $("#export-json").addEventListener("click", exportJson); $("#export-csv").addEventListener("click", exportCsv); $("#import-json").addEventListener("change", importJson);
    $("#clear-local").addEventListener("click", () => { if (!confirm("Erase all Attention Trainer data stored in this browser? Cloud records will remain.")) return; localStorage.removeItem(STORAGE_KEY); state = clone(DEFAULT_STATE); renderAll(); toast("Local data erased"); });
    window.addEventListener("online", syncAll);
  }

  bindEvents(); switchView(["today","progress","data"].includes(location.hash.slice(1)) ? location.hash.slice(1) : "today"); renderAll(); initSupabase();
})();
