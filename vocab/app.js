const WORDS = window.VOCAB_WORDS;
    const SUPABASE_URL = "https://linyduptrvxxuempzhlz.supabase.co";
    const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxpbnlkdXB0cnZ4eHVlbXB6aGx6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODE3MDk1MTQsImV4cCI6MjA5NzI4NTUxNH0.ehzrZAy7I0nkbyzb9jDC9ZJoZFFC9Y8w7TEzc3Ca6QU";
    const PROGRESS_KEY = "navigationEnglishVocabProgressV1";
    const SYNC_KEY = "navigationEnglishVocabSyncV1";
    const SYNC_SALT = "navigation-english-vocab-sync:";

    const state = {
      mode: "review",
      filter: "all",
      unit: "all",
      random: false,
      index: 0,
      flipped: false,
      reviewDirection: "en2cn",
      practice: {
        cn2en: { index: 0, answer: "", checked: null },
        en2cn: { index: 0, answer: "", revealed: false }
      },
      exam: null,
      progress: loadProgress(),
      sync: loadSync()
    };

    const els = {
      content: document.getElementById("content"),
      modeTitle: document.getElementById("modeTitle"),
      modeDesc: document.getElementById("modeDesc"),
      modeActions: document.getElementById("modeActions"),
      totalStat: document.getElementById("totalStat"),
      masteredStat: document.getElementById("masteredStat"),
      wrongStat: document.getElementById("wrongStat"),
      favoriteStat: document.getElementById("favoriteStat"),
      subtitle: document.getElementById("subtitle"),
      scopeNote: document.getElementById("scopeNote"),
      unitSelect: document.getElementById("unitSelect"),
      shuffleBtn: document.getElementById("shuffleBtn"),
      syncTopBtn: document.getElementById("syncTopBtn"),
      resetBtn: document.getElementById("resetBtn"),
      syncPanel: document.getElementById("syncPanel"),
      syncStatus: document.getElementById("syncStatus"),
      syncCodeInput: document.getElementById("syncCodeInput"),
      generateSyncBtn: document.getElementById("generateSyncBtn"),
      connectSyncBtn: document.getElementById("connectSyncBtn"),
      syncNowBtn: document.getElementById("syncNowBtn"),
      copySyncBtn: document.getElementById("copySyncBtn"),
      disconnectSyncBtn: document.getElementById("disconnectSyncBtn"),
      toast: document.getElementById("toast")
    };

    let toastTimer = 0;
    let syncTimer = 0;
    let syncBackend = "vocab";

    function nowIso() { return new Date().toISOString(); }
    function timeValue(value) { const n = Date.parse(value || ""); return Number.isFinite(n) ? n : 0; }
    function latest(a, b) { return timeValue(a) >= timeValue(b) ? (a || b || "") : (b || a || ""); }
    function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }

    function defaultProgress() { return { version: 1, words: {}, lastExam: null, updatedAt: "" }; }
    function normalizeProgress(input) {
      const source = isObject(input) ? input : {};
      const progress = defaultProgress();
      Object.entries(source.words || {}).forEach(([id, item]) => {
        if (!wordById(id) || !isObject(item)) return;
        progress.words[id] = {
          masteredAt: typeof item.masteredAt === "string" ? item.masteredAt : "",
          wrongAt: typeof item.wrongAt === "string" ? item.wrongAt : "",
          favoriteAt: typeof item.favoriteAt === "string" ? item.favoriteAt : "",
          favoriteRemovedAt: typeof item.favoriteRemovedAt === "string" ? item.favoriteRemovedAt : ""
        };
      });
      progress.lastExam = isObject(source.lastExam) ? source.lastExam : null;
      progress.updatedAt = typeof source.updatedAt === "string" ? source.updatedAt : "";
      return progress;
    }
    function loadProgress() {
      try { return normalizeProgress(JSON.parse(localStorage.getItem(PROGRESS_KEY))); }
      catch { return defaultProgress(); }
    }
    function saveProgress(markDirty = false) {
      state.progress.updatedAt = nowIso();
      localStorage.setItem(PROGRESS_KEY, JSON.stringify(state.progress));
      updateStats();
      if (markDirty) scheduleSync();
    }
    function loadSync() {
      try {
        const saved = JSON.parse(localStorage.getItem(SYNC_KEY));
        return isObject(saved) && saved.version === 1 ? saved : { version: 1 };
      } catch { return { version: 1 }; }
    }
    function saveSync() { localStorage.setItem(SYNC_KEY, JSON.stringify(state.sync)); updateSyncUI(); }

    function units() { return ["all", ...Array.from(new Set(WORDS.map((word) => word.unit)))]; }
    function wordById(id) { return WORDS.find((word) => word.id === id); }
    function wordState(id) { return state.progress.words[id] || {}; }
    function isMastered(id) { const item = wordState(id); return Boolean(item.masteredAt && timeValue(item.masteredAt) >= timeValue(item.wrongAt)); }
    function isWrong(id) { const item = wordState(id); return Boolean(item.wrongAt && timeValue(item.wrongAt) > timeValue(item.masteredAt)); }
    function isFavorite(id) { const item = wordState(id); return Boolean(item.favoriteAt && timeValue(item.favoriteAt) > timeValue(item.favoriteRemovedAt)); }
    function setWordState(id, patch) {
      state.progress.words[id] = { ...wordState(id), ...patch };
      saveProgress(true);
    }
    function activeWords() {
      return WORDS.filter((word) => {
        if (state.unit !== "all" && word.unit !== state.unit) return false;
        if (state.filter === "wrong") return isWrong(word.id);
        if (state.filter === "favorite") return isFavorite(word.id);
        return true;
      });
    }
    function wrapIndex(index, length) { return ((index % length) + length) % length; }
    function currentWord(words = activeWords(), index = state.index) { return words.length ? words[wrapIndex(index, words.length)] : null; }

    function escapeHtml(value) {
      return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
    function normalizeEnglish(value) {
      return String(value || "").toLowerCase().replace(/[’‘]/g, "'").replace(/\([^)]*\)/g, " ").replace(/&/g, " and ").replace(/[^a-z0-9\s'-]/g, " ").replace(/\s+/g, " ").trim();
    }
    function englishAnswers(word) { return [word.en, ...(word.aliases || [])].map(normalizeEnglish).filter(Boolean); }
    function isEnglishCorrect(word, answer) { const value = normalizeEnglish(answer); return Boolean(value && englishAnswers(word).includes(value)); }
    function renderAliases(word) { return word.aliases.length ? `<br><span>可接受：${escapeHtml(word.aliases.join(" / "))}</span>` : ""; }
    function showToast(message) {
      clearTimeout(toastTimer);
      els.toast.textContent = message;
      els.toast.classList.add("show");
      toastTimer = setTimeout(() => els.toast.classList.remove("show"), 2200);
    }

    function initUnits() {
      els.unitSelect.innerHTML = units().map((unit) => `<option value="${escapeHtml(unit)}">${unit === "all" ? "全部单元" : escapeHtml(unit)}</option>`).join("");
      els.unitSelect.value = state.unit;
    }
    function setMode(mode) {
      state.mode = mode;
      state.flipped = false;
      document.querySelectorAll(".tab").forEach((tab) => tab.setAttribute("aria-selected", String(tab.dataset.mode === mode)));
      render();
    }
    function setFilter(filter) {
      state.filter = filter;
      state.index = 0;
      state.practice.cn2en.index = 0;
      state.practice.en2cn.index = 0;
      document.querySelectorAll(".chip").forEach((chip) => chip.classList.toggle("active", chip.dataset.filter === filter));
      render();
    }
    function advance(delta = 1) {
      const words = activeWords();
      if (!words.length) return;
      state.index = state.random ? Math.floor(Math.random() * words.length) : wrapIndex(state.index + delta, words.length);
      state.flipped = false;
      render();
    }
    function advancePractice(kind, delta = 1) {
      const words = activeWords();
      if (!words.length) return;
      state.practice[kind].index = state.random ? Math.floor(Math.random() * words.length) : wrapIndex(state.practice[kind].index + delta, words.length);
      state.practice[kind].answer = "";
      state.practice[kind].checked = null;
      state.practice[kind].revealed = false;
      render();
    }

    function updateStats() {
      const mastered = WORDS.filter((word) => isMastered(word.id)).length;
      const wrong = WORDS.filter((word) => isWrong(word.id)).length;
      const favorite = WORDS.filter((word) => isFavorite(word.id)).length;
      els.totalStat.textContent = WORDS.length;
      els.masteredStat.textContent = mastered;
      els.wrongStat.textContent = wrong;
      els.favoriteStat.textContent = favorite;
      els.subtitle.textContent = `${WORDS.length}个词条，掌握${mastered}个，错题${wrong}个`;
    }
    function render() {
      updateStats();
      updateSyncUI();
      const words = activeWords();
      const unitText = state.unit === "all" ? "全部单元" : state.unit;
      const filterText = state.filter === "all" ? "全部" : state.filter === "wrong" ? "错题" : "收藏";
      els.scopeNote.textContent = `当前范围：${unitText} / ${filterText}，共 ${words.length} 个词条。`;
      if (!words.length) return renderEmpty("暂无匹配词条", "换一个单元或筛选条件，就能继续练习。");
      if (state.mode === "review") renderReview(words);
      if (state.mode === "cn2en") renderCn2En(words);
      if (state.mode === "en2cn") renderEn2Cn(words);
      if (state.mode === "exam") renderExam(words);
      if (state.mode === "book") renderBook();
    }
    function renderEmpty(title, text) {
      els.modeTitle.textContent = title;
      els.modeDesc.textContent = text;
      els.modeActions.innerHTML = "";
      els.content.innerHTML = `<div class="empty"><h2>${escapeHtml(title)}</h2><p>${escapeHtml(text)}</p><button class="button primary" data-action="filter-all" type="button">查看全部</button></div>`;
    }
    function renderReview(words) {
      const word = currentWord(words);
      const current = wrapIndex(state.index, words.length) + 1;
      const front = state.reviewDirection === "en2cn" ? word.en : word.zh;
      const back = state.reviewDirection === "en2cn" ? word.zh : word.en;
      els.modeTitle.textContent = "背诵模式";
      els.modeDesc.textContent = "点击卡片翻面，熟悉后标记掌握或错题。";
      els.modeActions.innerHTML = `<button class="button" data-action="toggle-direction" type="button">${state.reviewDirection === "en2cn" ? "英→汉" : "汉→英"}</button><button class="button ${isFavorite(word.id) ? "warning" : ""}" data-action="favorite" type="button">${isFavorite(word.id) ? "★ 已收藏" : "☆ 收藏"}</button>`;
      els.content.innerHTML = `<div class="card-stage"><div class="review-card" data-action="flip" role="button" tabindex="0"><div class="question-meta">${escapeHtml(word.unit)} · ${word.number} · ${current} / ${words.length}</div><div class="front">${escapeHtml(front)}</div><p class="back">${state.flipped ? escapeHtml(back) : "点击查看答案"}</p></div><div class="button-row wide-row"><button class="button" data-action="prev" type="button">← 上一个</button><div class="button-row"><button class="button ${isMastered(word.id) ? "primary" : ""}" data-action="known" type="button">${isMastered(word.id) ? "已掌握" : "掌握"}</button><button class="button ${isWrong(word.id) ? "danger" : ""}" data-action="wrong" type="button">${isWrong(word.id) ? "已入错题" : "记错题"}</button></div><button class="button primary" data-action="next" type="button">下一个 →</button></div></div>`;
    }
    function renderCn2En(words) {
      const data = state.practice.cn2en;
      const word = currentWord(words, data.index);
      const current = wrapIndex(data.index, words.length) + 1;
      els.modeTitle.textContent = "汉译英练习";
      els.modeDesc.textContent = "输入英文答案，大小写和常见标点不会影响判定。";
      els.modeActions.innerHTML = `<button class="button" data-action="practice-prev" data-kind="cn2en" type="button">← 上一题</button><button class="button primary" data-action="practice-next" data-kind="cn2en" type="button">下一题 →</button>`;
      const result = data.checked ? (data.checked.revealed ? `<div class="result warn"><strong>参考答案：</strong>${escapeHtml(word.en)}${renderAliases(word)}</div>` : data.checked.correct ? `<div class="result good"><strong>正确。</strong> ${escapeHtml(word.en)}${renderAliases(word)}</div>` : `<div class="result bad"><strong>再记一下。</strong> 参考答案：${escapeHtml(word.en)}${renderAliases(word)}</div>`) : "";
      els.content.innerHTML = `<div class="practice-stage"><div class="prompt-box"><div class="question-meta">${escapeHtml(word.unit)} · ${word.number} · 第 ${current} / ${words.length} 题</div><strong>${escapeHtml(word.zh)}</strong></div><input class="answer" id="cn2enInput" autocomplete="off" placeholder="输入英文"><div class="button-row"><button class="button primary" data-action="check-cn2en" type="button">检查答案</button><button class="button" data-action="reveal-cn2en" type="button">看答案</button></div>${result}</div>`;
      const input = document.getElementById("cn2enInput");
      input.value = data.answer;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    function renderEn2Cn(words) {
      const data = state.practice.en2cn;
      const word = currentWord(words, data.index);
      const current = wrapIndex(data.index, words.length) + 1;
      els.modeTitle.textContent = "英译汉练习";
      els.modeDesc.textContent = "中文可有同义表达，看参考答案后自己判定。";
      els.modeActions.innerHTML = `<button class="button" data-action="practice-prev" data-kind="en2cn" type="button">← 上一题</button><button class="button primary" data-action="practice-next" data-kind="en2cn" type="button">下一题 →</button>`;
      els.content.innerHTML = `<div class="practice-stage"><div class="prompt-box"><div class="question-meta">${escapeHtml(word.unit)} · ${word.number} · 第 ${current} / ${words.length} 题</div><strong>${escapeHtml(word.en)}</strong></div><textarea id="en2cnInput" placeholder="写下中文释义"></textarea><div class="button-row"><button class="button primary" data-action="reveal-en2cn" type="button">看参考答案</button><button class="button" data-action="self-good" type="button">答对了</button><button class="button danger" data-action="self-bad" type="button">答错了</button></div>${data.revealed ? `<div class="result warn"><strong>参考答案：</strong>${escapeHtml(word.zh)}</div>` : ""}</div>`;
      const input = document.getElementById("en2cnInput");
      input.value = data.answer;
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
    function pickMany(words, count) {
      const copy = [...words];
      for (let i = copy.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); [copy[i], copy[j]] = [copy[j], copy[i]]; }
      return copy.slice(0, count);
    }
    function startExam(words = activeWords()) {
      const cn2en = pickMany(words, 15).map((word, i) => ({ id: `c-${Date.now()}-${i}`, type: "cn2en", wordId: word.id, prompt: word.zh, user: "", result: null }));
      const en2cn = pickMany(words, 15).map((word, i) => ({ id: `e-${Date.now()}-${i}`, type: "en2cn", wordId: word.id, prompt: word.en, user: "", self: null }));
      state.exam = { createdAt: nowIso(), submitted: false, questions: pickMany([...cn2en, ...en2cn], 30) };
    }
    function renderExam(words) {
      els.modeTitle.textContent = "模拟考试";
      els.modeDesc.textContent = "固定15题汉译英、15题英译汉，提交后复盘错题。";
      els.modeActions.innerHTML = `<button class="button primary" data-action="new-exam" type="button">新试卷</button><button class="button" data-action="submit-exam" type="button">交卷</button>`;
      if (words.length < 15) return renderEmpty("词条不足15个", "当前范围不足15个词，模拟考试请切回全部或选择更大的单元范围。");
      if (!state.exam) startExam(words);
      const score = examScore();
      const gradedCn = state.exam.questions.filter((q) => q.type === "cn2en" && q.result).length;
      const gradedEn = state.exam.questions.filter((q) => q.type === "en2cn" && q.self).length;
      els.content.innerHTML = `<div class="exam-stage"><div class="result ${state.exam.submitted ? "warn" : ""}"><span class="pill">汉译英 ${gradedCn}/15</span> <span class="pill">英译汉 ${gradedEn}/15</span> <span class="pill ${state.exam.submitted ? "warn" : ""}">${state.exam.submitted ? `当前得分 ${score}/30` : "未交卷"}</span>${state.progress.lastExam ? ` <span class="pill">上次 ${state.progress.lastExam.score}/30</span>` : ""}</div>${state.exam.questions.map(renderExamQuestion).join("")}<div class="button-row"><button class="button primary" data-action="submit-exam" type="button">交卷</button><button class="button" data-action="new-exam" type="button">重抽一套</button></div></div>`;
    }
    function renderExamQuestion(question, index) {
      const word = wordById(question.wordId);
      const typeLabel = question.type === "cn2en" ? "汉译英" : "英译汉";
      const control = question.type === "cn2en" ? `<input class="answer" data-exam-answer="${question.id}" value="${escapeHtml(question.user)}" placeholder="输入英文">` : `<textarea data-exam-answer="${question.id}" placeholder="写中文释义">${escapeHtml(question.user)}</textarea>`;
      const badge = !state.exam.submitted ? "" : question.type === "cn2en" ? (question.result === "good" ? `<span class="pill good">正确</span>` : `<span class="pill bad">错误</span>`) : (question.self === "good" ? `<span class="pill good">自评正确</span>` : question.self === "bad" ? `<span class="pill bad">自评错误</span>` : `<span class="pill warn">待自评</span>`);
      const reference = state.exam.submitted ? `<div class="result ${question.result === "good" || question.self === "good" ? "good" : question.result === "bad" || question.self === "bad" ? "bad" : "warn"}"><strong>参考答案：</strong>${question.type === "cn2en" ? escapeHtml(word.en) + renderAliases(word) : escapeHtml(word.zh)}</div>` : "";
      const self = question.type === "en2cn" && state.exam.submitted ? `<div class="button-row"><button class="button ${question.self === "good" ? "primary" : ""}" data-action="exam-self-good" data-id="${question.id}" type="button">我答对了</button><button class="button ${question.self === "bad" ? "danger" : ""}" data-action="exam-self-bad" data-id="${question.id}" type="button">我答错了</button></div>` : "";
      return `<article class="exam-row"><div class="exam-head"><div><span class="pill">${index + 1}. ${typeLabel}</span> ${badge}</div></div><div class="prompt">${escapeHtml(question.prompt)}</div>${control}${reference}${self}</article>`;
    }
    function examScore() {
      if (!state.exam) return 0;
      return state.exam.questions.reduce((score, q) => score + ((q.type === "cn2en" && q.result === "good") || (q.type === "en2cn" && q.self === "good") ? 1 : 0), 0);
    }
    function submitExam() {
      if (!state.exam) return;
      state.exam.questions.forEach((q) => {
        const word = wordById(q.wordId);
        if (q.type === "cn2en") {
          q.result = isEnglishCorrect(word, q.user) ? "good" : "bad";
          if (q.result === "good") setWordState(word.id, { masteredAt: nowIso() });
          else setWordState(word.id, { wrongAt: nowIso() });
        }
      });
      state.exam.submitted = true;
      state.progress.lastExam = { date: nowIso(), score: examScore() };
      saveProgress(true);
      render();
      showToast("已交卷，英译汉请按参考答案自评");
    }
    function renderBook() {
      const words = WORDS.filter((word) => (state.unit === "all" || word.unit === state.unit) && (isWrong(word.id) || isFavorite(word.id)));
      els.modeTitle.textContent = "错题收藏";
      els.modeDesc.textContent = "把容易混淆的词集中复盘。";
      els.modeActions.innerHTML = `<button class="button" data-action="filter-wrong" type="button">只看错题</button><button class="button" data-action="filter-fav" type="button">只看收藏</button>`;
      if (!words.length) return renderEmpty("还没有错题或收藏", "练习时标记错题或收藏，这里就会自动出现。");
      els.content.innerHTML = `<div class="word-list">${words.map((word) => `<article class="word-row"><div class="word-head"><div><div class="word-title">${escapeHtml(word.en)}</div><div class="word-zh">${escapeHtml(word.zh)}</div><div class="question-meta">${escapeHtml(word.unit)} · ${word.number}</div></div><div class="button-row"><button class="button ${isFavorite(word.id) ? "warning" : ""}" data-action="row-fav" data-id="${word.id}" type="button">${isFavorite(word.id) ? "★" : "☆"}</button><button class="button ${isWrong(word.id) ? "danger" : ""}" data-action="row-wrong" data-id="${word.id}" type="button">错</button></div></div></article>`).join("")}</div>`;
    }

    function mergeProgress(localData, remoteData) {
      const local = normalizeProgress(localData);
      const remote = normalizeProgress(remoteData);
      const merged = defaultProgress();
      new Set([...Object.keys(local.words), ...Object.keys(remote.words)]).forEach((id) => {
        const a = local.words[id] || {};
        const b = remote.words[id] || {};
        merged.words[id] = {
          masteredAt: latest(a.masteredAt, b.masteredAt),
          wrongAt: latest(a.wrongAt, b.wrongAt),
          favoriteAt: latest(a.favoriteAt, b.favoriteAt),
          favoriteRemovedAt: latest(a.favoriteRemovedAt, b.favoriteRemovedAt)
        };
      });
      merged.lastExam = timeValue(local.lastExam && local.lastExam.date) >= timeValue(remote.lastExam && remote.lastExam.date) ? local.lastExam : remote.lastExam;
      merged.updatedAt = latest(local.updatedAt, remote.updatedAt) || nowIso();
      return merged;
    }
    function normalizeSyncCode(code) { return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, ""); }
    function formatSyncCode(code) { return normalizeSyncCode(code).replace(/(.{4})/g, "$1-").replace(/-$/, ""); }
    function bytesToHex(buffer) { return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join(""); }
    async function hashSyncCode(code) {
      const normalized = normalizeSyncCode(code);
      if (normalized.length < 16) throw new Error("同步码太短，请输入完整同步码。");
      if (!crypto.subtle) throw new Error("当前浏览器不支持安全哈希，请用 HTTPS 页面访问。");
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(SYNC_SALT + normalized));
      return bytesToHex(digest);
    }
    function generateSyncCode() {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      const bytes = new Uint8Array(20);
      crypto.getRandomValues(bytes);
      return formatSyncCode(Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""));
    }
    async function rpc(name, body) {
      const response = await fetch(`${SUPABASE_URL.replace(/\/$/, "")}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const error = new Error((data && data.message) || `同步请求失败：${response.status}`);
        error.status = response.status;
        error.code = data && data.code;
        throw error;
      }
      return Array.isArray(data) ? data[0] || null : data;
    }
    function missingRpc(error) { return error && (error.status === 404 || error.code === "PGRST202" || /function/i.test(error.message || "")); }
    async function loadRemote(hash) {
      if (syncBackend === "vocab") {
        try {
          const result = await rpc("vocab_load_progress", { p_code_hash: hash });
          return { data: result && result.payload, revision: null };
        } catch (error) {
          if (!missingRpc(error)) throw error;
          syncBackend = "generic";
        }
      }
      const result = await rpc("pull_progress", { p_sync_id: hash });
      return { data: result && result.data, revision: result && result.revision };
    }
    async function saveRemote(hash, payload, baseRevision) {
      if (syncBackend === "vocab") {
        try {
          const result = await rpc("vocab_save_progress", { p_code_hash: hash, p_payload: payload });
          return { data: result && result.payload, revision: null };
        } catch (error) {
          if (!missingRpc(error)) throw error;
          syncBackend = "generic";
        }
      }
      let result = await rpc("push_progress", { p_sync_id: hash, p_data: payload, p_base_revision: baseRevision || null });
      if (result && result.status === "conflict") {
        const merged = mergeProgress(payload, result.data);
        state.progress = merged;
        saveProgress(false);
        result = await rpc("push_progress", { p_sync_id: hash, p_data: merged, p_base_revision: result.revision });
      }
      return { data: payload, revision: result && result.revision };
    }
    function setSyncStatus(kind, message) {
      els.syncStatus.textContent = message;
      els.syncStatus.className = `pill ${kind || ""}`.trim();
    }
    function updateSyncUI() {
      els.syncCodeInput.value = state.sync.syncCode || els.syncCodeInput.value || "";
      if (!state.sync.hash) return setSyncStatus("", "未连接");
      if (state.sync.pending) return setSyncStatus("warn", "待同步");
      setSyncStatus("good", "已连接");
    }
    function scheduleSync() {
      if (!state.sync.hash) return;
      state.sync.pending = true;
      saveSync();
      clearTimeout(syncTimer);
      syncTimer = setTimeout(() => syncNow(), 1200);
    }
    async function connectSync(code) {
      const formatted = formatSyncCode(code);
      const hash = await hashSyncCode(formatted);
      state.sync = { version: 1, syncCode: formatted, hash, remoteRevision: null, pending: true, connectedAt: nowIso() };
      saveSync();
      await syncNow();
    }
    async function syncNow() {
      if (!state.sync.hash) return false;
      clearTimeout(syncTimer);
      setSyncStatus("warn", "同步中");
      try {
        const remote = await loadRemote(state.sync.hash);
        const merged = mergeProgress(state.progress, remote.data);
        state.progress = merged;
        saveProgress(false);
        const saved = await saveRemote(state.sync.hash, state.progress, remote.revision || state.sync.remoteRevision || null);
        state.sync.remoteRevision = saved.revision || null;
        state.sync.pending = false;
        state.sync.lastSyncedAt = nowIso();
        state.sync.backend = syncBackend;
        saveSync();
        render();
        showToast("云同步完成");
        return true;
      } catch (error) {
        state.sync.pending = true;
        saveSync();
        setSyncStatus("bad", "同步失败");
        showToast(error.message || "同步失败");
        return false;
      }
    }

    document.addEventListener("click", async (event) => {
      const target = event.target.closest("button, .review-card");
      if (!target) return;
      if (target.classList.contains("tab")) return setMode(target.dataset.mode);
      if (target.classList.contains("chip")) return setFilter(target.dataset.filter);
      const action = target.dataset.action;
      const words = activeWords();
      const word = currentWord(words);
      if (action === "filter-all") return setFilter("all");
      if (action === "filter-wrong") return setFilter("wrong");
      if (action === "filter-fav") return setFilter("favorite");
      if (action === "flip") { state.flipped = !state.flipped; return render(); }
      if (action === "prev") return advance(-1);
      if (action === "next") return advance(1);
      if (action === "toggle-direction") { state.reviewDirection = state.reviewDirection === "en2cn" ? "cn2en" : "en2cn"; state.flipped = false; return render(); }
      if (action === "favorite" && word) { setWordState(word.id, isFavorite(word.id) ? { favoriteRemovedAt: nowIso() } : { favoriteAt: nowIso() }); return render(); }
      if (action === "known" && word) { setWordState(word.id, { masteredAt: nowIso() }); return render(); }
      if (action === "wrong" && word) { setWordState(word.id, { wrongAt: nowIso() }); return render(); }
      if (action === "practice-prev") return advancePractice(target.dataset.kind, -1);
      if (action === "practice-next") return advancePractice(target.dataset.kind, 1);
      if (action === "check-cn2en") return checkCn2En();
      if (action === "reveal-cn2en") { state.practice.cn2en.checked = { correct: false, revealed: true }; return render(); }
      if (action === "reveal-en2cn") { state.practice.en2cn.revealed = true; return render(); }
      if (action === "self-good") return gradeEn2Cn(true);
      if (action === "self-bad") return gradeEn2Cn(false);
      if (action === "new-exam") { startExam(words); return render(); }
      if (action === "submit-exam") return submitExam();
      if (action === "exam-self-good") return gradeExamSelf(target.dataset.id, true);
      if (action === "exam-self-bad") return gradeExamSelf(target.dataset.id, false);
      if (action === "row-fav") { setWordState(target.dataset.id, isFavorite(target.dataset.id) ? { favoriteRemovedAt: nowIso() } : { favoriteAt: nowIso() }); return render(); }
      if (action === "row-wrong") { setWordState(target.dataset.id, { wrongAt: nowIso() }); return render(); }
    });
    document.addEventListener("input", (event) => {
      if (event.target.id === "cn2enInput") state.practice.cn2en.answer = event.target.value;
      if (event.target.id === "en2cnInput") state.practice.en2cn.answer = event.target.value;
      const examId = event.target.dataset.examAnswer;
      if (examId && state.exam) {
        const question = state.exam.questions.find((item) => item.id === examId);
        if (question) question.user = event.target.value;
      }
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.id === "cn2enInput") { event.preventDefault(); checkCn2En(); }
      if ((event.key === "Enter" || event.key === " ") && event.target.closest(".review-card")) { event.preventDefault(); state.flipped = !state.flipped; render(); }
    });
    function checkCn2En() {
      const words = activeWords();
      const data = state.practice.cn2en;
      const word = currentWord(words, data.index);
      const correct = isEnglishCorrect(word, data.answer);
      data.checked = { correct, revealed: false };
      setWordState(word.id, correct ? { masteredAt: nowIso() } : { wrongAt: nowIso() });
      render();
    }
    function gradeEn2Cn(correct) {
      const words = activeWords();
      const word = currentWord(words, state.practice.en2cn.index);
      setWordState(word.id, correct ? { masteredAt: nowIso() } : { wrongAt: nowIso() });
      showToast(correct ? "已记为答对" : "已加入错题");
      advancePractice("en2cn", 1);
    }
    function gradeExamSelf(id, correct) {
      const question = state.exam && state.exam.questions.find((item) => item.id === id);
      if (!question) return;
      question.self = correct ? "good" : "bad";
      setWordState(question.wordId, correct ? { masteredAt: nowIso() } : { wrongAt: nowIso() });
      state.progress.lastExam = { date: nowIso(), score: examScore() };
      saveProgress(true);
      render();
    }

    els.unitSelect.addEventListener("change", () => { state.unit = els.unitSelect.value; state.index = 0; state.exam = null; render(); });
    els.shuffleBtn.addEventListener("click", () => { state.random = !state.random; els.shuffleBtn.classList.toggle("primary", state.random); els.shuffleBtn.textContent = state.random ? "↻ 随机中" : "↻ 随机"; showToast(state.random ? "已开启随机推进" : "已切回顺序推进"); });
    els.syncTopBtn.addEventListener("click", () => els.syncPanel.scrollIntoView({ behavior: "smooth", block: "center" }));
    els.resetBtn.addEventListener("click", () => { if (!confirm("清空掌握、错题、收藏和考试记录？")) return; state.progress = defaultProgress(); state.exam = null; saveProgress(true); render(); showToast("学习记录已清空"); });
    els.generateSyncBtn.addEventListener("click", () => { els.syncCodeInput.value = generateSyncCode(); els.syncCodeInput.select(); });
    els.connectSyncBtn.addEventListener("click", async () => { try { await connectSync(els.syncCodeInput.value); } catch (error) { showToast(error.message || "连接失败"); } });
    els.syncNowBtn.addEventListener("click", () => syncNow());
    els.copySyncBtn.addEventListener("click", async () => { const value = els.syncCodeInput.value || state.sync.syncCode || ""; if (!value) return showToast("还没有同步码"); await navigator.clipboard.writeText(value); showToast("同步码已复制"); });
    els.disconnectSyncBtn.addEventListener("click", () => { state.sync = { version: 1 }; saveSync(); showToast("已断开云同步，本机进度保留"); });

    initUnits();
    updateStats();
    updateSyncUI();
    render();
    if (state.sync.hash) syncNow();
    window.__vocabTest = { WORDS, normalizeEnglish, isEnglishCorrect, activeWords, mergeProgress };
