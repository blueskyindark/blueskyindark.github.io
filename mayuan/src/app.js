(async () => {
  let bank;
  try {
    bank = await loadQuestionBank();
  } catch (error) {
    document.body.textContent = `题库数据载入失败：${error.message || "未知错误"}`;
    return;
  }
  const progressVersion = window.ProgressSync ? window.ProgressSync.progressVersion : 2;
  const testStorageKey = new URLSearchParams(location.search).get("test");
  const storageKey = testStorageKey !== null
    ? `mayuan-quiz-progress-test-${testStorageKey || "default"}-v1`
    : "mayuan-quiz-progress-v1";
  const syncSettingsKey = testStorageKey !== null
    ? `mayuan-sync-test-${testStorageKey || "default"}-v1`
    : "mayuan-sync-v1";
  const examQuestionCount = 60;
  const autoAdvanceDelay = 600;

  const els = {
    bankMeta: document.getElementById("bankMeta"),
    chapterSelect: document.getElementById("chapterSelect"),
    searchInput: document.getElementById("searchInput"),
    modeTabs: document.getElementById("modeTabs"),
    orderTabs: document.getElementById("orderTabs"),
    answeredStat: document.getElementById("answeredStat"),
    accuracyStat: document.getElementById("accuracyStat"),
    favoriteStat: document.getElementById("favoriteStat"),
    wrongStat: document.getElementById("wrongStat"),
    progressFill: document.getElementById("progressFill"),
    questionCounter: document.getElementById("questionCounter"),
    questionTitle: document.getElementById("questionTitle"),
    prevBtn: document.getElementById("prevBtn"),
    nextBtn: document.getElementById("nextBtn"),
    examPanel: document.getElementById("examPanel"),
    examSummary: document.getElementById("examSummary"),
    startExamBtn: document.getElementById("startExamBtn"),
    submitExamBtn: document.getElementById("submitExamBtn"),
    exitExamBtn: document.getElementById("exitExamBtn"),
    examReport: document.getElementById("examReport"),
    chapterBadge: document.getElementById("chapterBadge"),
    typeBadge: document.getElementById("typeBadge"),
    statusBadge: document.getElementById("statusBadge"),
    contextNotice: document.getElementById("contextNotice"),
    questionText: document.getElementById("questionText"),
    figureNotice: document.getElementById("figureNotice"),
    options: document.getElementById("options"),
    shortBox: document.getElementById("shortBox"),
    shortNote: document.getElementById("shortNote"),
    feedback: document.getElementById("feedback"),
    favoriteBtn: document.getElementById("favoriteBtn"),
    submitBtn: document.getElementById("submitBtn"),
    showAnswerBtn: document.getElementById("showAnswerBtn"),
    masterBtn: document.getElementById("masterBtn"),
    listTitle: document.getElementById("listTitle"),
    listCount: document.getElementById("listCount"),
    questionList: document.getElementById("questionList"),
    exportBtn: document.getElementById("exportBtn"),
    importBtn: document.getElementById("importBtn"),
    importInput: document.getElementById("importInput"),
    resetBtn: document.getElementById("resetBtn"),
    syncPanel: document.getElementById("syncPanel"),
    syncStatus: document.getElementById("syncStatus"),
    syncCodeInput: document.getElementById("syncCodeInput"),
    generateSyncBtn: document.getElementById("generateSyncBtn"),
    connectSyncBtn: document.getElementById("connectSyncBtn"),
    syncNowBtn: document.getElementById("syncNowBtn"),
    copySyncBtn: document.getElementById("copySyncBtn"),
    disconnectSyncBtn: document.getElementById("disconnectSyncBtn"),
  };

  const freshState = () => ({
    version: progressVersion,
    progressVersion,
    currentId: "",
    seed: String(Date.now()),
    filters: {
      chapter: "all",
      mode: "all",
      order: "normal",
      query: "",
    },
    answers: {},
    favorites: {},
    exam: freshExamState(),
  });

  function freshExamState() {
    return {
      version: 1,
      seed: "",
      questionIds: [],
      currentId: "",
      answers: {},
      drafts: {},
      startedAt: "",
      submittedAt: "",
      completed: false,
    };
  }

  let state = loadState();
  let filteredQuestions = [];
  let syncManager = null;
  let latestSyncStatus = { state: "unconfigured", message: "云同步未配置" };
  let autoAdvanceTimer = 0;

  function nowIso() {
    return new Date().toISOString();
  }

  function normalizeProgress(record, fallbackAt = nowIso()) {
    const source = record && typeof record === "object" ? record : {};
    return {
      selected: Array.isArray(source.selected) ? source.selected.filter(Boolean) : [],
      attempts: Number.isFinite(Number(source.attempts)) ? Number(source.attempts) : 0,
      correct: typeof source.correct === "boolean" ? source.correct : null,
      wrongCount: Number.isFinite(Number(source.wrongCount)) ? Number(source.wrongCount) : 0,
      revealed: Boolean(source.revealed),
      mastered: Boolean(source.mastered),
      note: typeof source.note === "string" ? source.note : "",
      lastAnsweredAt: typeof source.lastAnsweredAt === "string" ? source.lastAnsweredAt : "",
      updatedAt: typeof source.updatedAt === "string" && source.updatedAt ? source.updatedAt : fallbackAt,
    };
  }

  function normalizeFavorite(record, fallbackAt = nowIso()) {
    if (typeof record === "boolean") {
      return { value: record, updatedAt: fallbackAt };
    }
    if (!record || typeof record !== "object") {
      return { value: false, updatedAt: fallbackAt };
    }
    return {
      value: Boolean(record.value),
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : fallbackAt,
    };
  }

  function normalizeExamAnswer(record) {
    const source = record && typeof record === "object" ? record : {};
    return {
      selected: Array.isArray(source.selected) ? source.selected.filter(Boolean) : [],
      correct: typeof source.correct === "boolean" ? source.correct : false,
      answeredAt: typeof source.answeredAt === "string" ? source.answeredAt : "",
    };
  }

  function normalizeExamState(record) {
    const source = record && typeof record === "object" ? record : {};
    const next = {
      ...freshExamState(),
      ...source,
      version: 1,
      questionIds: Array.isArray(source.questionIds) ? source.questionIds.filter(Boolean) : [],
      currentId: typeof source.currentId === "string" ? source.currentId : "",
      answers: {},
      drafts: {},
      startedAt: typeof source.startedAt === "string" ? source.startedAt : "",
      submittedAt: typeof source.submittedAt === "string" ? source.submittedAt : "",
      completed: Boolean(source.completed),
    };
    Object.entries(source.answers || {}).forEach(([id, answer]) => {
      next.answers[id] = normalizeExamAnswer(answer);
    });
    Object.entries(source.drafts || {}).forEach(([id, selected]) => {
      next.drafts[id] = Array.isArray(selected) ? selected.filter(Boolean) : [];
    });
    return next;
  }

  function migrateState(saved) {
    const fallbackAt = nowIso();
    const next = {
      ...freshState(),
      ...(saved || {}),
      version: progressVersion,
      progressVersion,
      filters: { ...freshState().filters, ...((saved && saved.filters) || {}) },
      answers: {},
      favorites: {},
      exam: normalizeExamState(saved && saved.exam),
    };

    Object.entries((saved && saved.answers) || {}).forEach(([id, record]) => {
      next.answers[id] = normalizeProgress(record, fallbackAt);
    });
    Object.entries((saved && saved.favorites) || {}).forEach(([id, record]) => {
      next.favorites[id] = normalizeFavorite(record, fallbackAt);
    });
    return next;
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(storageKey));
      if (!saved) return freshState();
      return migrateState(saved);
    } catch {
      return freshState();
    }
  }

  function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
  }

  function getProgress(id) {
    return (
      state.answers[id] || {
        selected: [],
        attempts: 0,
        correct: null,
        wrongCount: 0,
        revealed: false,
        mastered: false,
        note: "",
        lastAnsweredAt: "",
        updatedAt: "",
      }
    );
  }

  function markProgressChanged() {
    saveState();
    if (syncManager) syncManager.markDirty();
  }

  function setProgress(id, patch) {
    state.answers[id] = { ...getProgress(id), ...patch, updatedAt: patch.updatedAt || nowIso() };
    markProgressChanged();
  }

  function isFavorite(id) {
    return Boolean(state.favorites[id] && state.favorites[id].value);
  }

  function setFavorite(id, value) {
    state.favorites[id] = { value: Boolean(value), updatedAt: nowIso() };
    markProgressChanged();
  }

  function answerText(answer) {
    return answer.length ? answer.join("、") : "无";
  }

  function formatAccuracy(correct, total) {
    return total ? `${Math.round((correct / total) * 100)}%` : "0%";
  }

  function cleanSelected(selected) {
    return [...new Set((selected || []).filter(Boolean))];
  }

  function sameAnswer(a, b) {
    return [...a].sort().join("") === [...b].sort().join("");
  }

  function hashText(text) {
    let hash = 2166136261;
    for (let index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function isExamMode() {
    return state.filters.mode === "exam";
  }

  function examHasQuestions() {
    return state.exam.questionIds.length > 0;
  }

  function questionById(id) {
    return bank.questions.find((question) => question.id === id) || null;
  }

  function choiceQuestions() {
    return bank.questions.filter((question) => question.type === "choice");
  }

  function sortedBySeed(questions, seed) {
    return [...questions].sort((a, b) => hashText(`${seed}:${a.id}`) - hashText(`${seed}:${b.id}`));
  }

  function examAllocation(targetCount) {
    const choiceByChapter = new Map();
    choiceQuestions().forEach((question) => {
      const key = String(question.chapterIndex);
      if (!choiceByChapter.has(key)) choiceByChapter.set(key, []);
      choiceByChapter.get(key).push(question);
    });

    const total = choiceQuestions().length;
    const rows = bank.chapters.map((chapter) => {
      const questions = choiceByChapter.get(String(chapter.index)) || [];
      const exact = total ? (questions.length / total) * targetCount : 0;
      return {
        chapter,
        questions,
        exact,
        count: Math.min(questions.length, Math.floor(exact)),
      };
    });

    let remaining = targetCount - rows.reduce((sum, row) => sum + row.count, 0);
    [...rows]
      .sort((a, b) => {
        const remainder = (b.exact - Math.floor(b.exact)) - (a.exact - Math.floor(a.exact));
        return remainder || b.questions.length - a.questions.length;
      })
      .forEach((row) => {
        if (remaining <= 0 || row.count >= row.questions.length) return;
        row.count += 1;
        remaining -= 1;
      });

    return rows;
  }

  function buildExamQuestionIds(seed) {
    const target = Math.min(examQuestionCount, choiceQuestions().length);
    const picked = [];
    examAllocation(target).forEach((row) => {
      picked.push(...sortedBySeed(row.questions, `${seed}:chapter:${row.chapter.index}`).slice(0, row.count));
    });
    return sortedBySeed(picked, `${seed}:paper`).map((question) => question.id);
  }

  function startExam() {
    clearAutoAdvance();
    const seed = String(Date.now());
    const questionIds = buildExamQuestionIds(seed);
    state.exam = {
      ...freshExamState(),
      seed,
      questionIds,
      currentId: questionIds[0] || "",
      startedAt: nowIso(),
    };
    state.filters.mode = "exam";
    state.currentId = state.exam.currentId;
    saveState();
    render();
  }

  function exitExamMode() {
    clearAutoAdvance();
    state.filters.mode = "all";
    state.currentId = "";
    saveState();
    render();
  }

  function submitExam() {
    if (!examHasQuestions()) return;
    clearAutoAdvance();
    state.exam.completed = true;
    state.exam.submittedAt = nowIso();
    saveState();
    render();
  }

  function getExamAnswer(id) {
    return state.exam.answers[id] || null;
  }

  function getExamDraft(id) {
    return state.exam.drafts[id] || [];
  }

  function setExamDraft(id, selected) {
    state.exam.drafts[id] = cleanSelected(selected);
    saveState();
  }

  function clearAutoAdvance() {
    if (!autoAdvanceTimer) return;
    window.clearTimeout(autoAdvanceTimer);
    autoAdvanceTimer = 0;
  }

  function setCurrentQuestion(id) {
    clearAutoAdvance();
    state.currentId = id || "";
    if (isExamMode()) {
      state.exam.currentId = state.currentId;
    }
    saveState();
  }

  function scheduleAutoAdvance(questionId) {
    clearAutoAdvance();
    autoAdvanceTimer = window.setTimeout(() => {
      autoAdvanceTimer = 0;
      if (state.currentId !== questionId) return;
      const index = filteredQuestions.findIndex((question) => question.id === questionId);
      const next = filteredQuestions[index + 1];
      if (!next) return;
      setCurrentQuestion(next.id);
      render();
    }, autoAdvanceDelay);
  }

  function displayProgress(question) {
    if (isExamMode() && question.type === "choice") {
      const examAnswer = getExamAnswer(question.id);
      if (examAnswer) {
        return {
          ...getProgress(question.id),
          selected: examAnswer.selected,
          attempts: 1,
          correct: examAnswer.correct,
          revealed: false,
          mastered: false,
          wrongCount: examAnswer.correct ? 0 : 1,
        };
      }
      return {
        ...getProgress(question.id),
        selected: getExamDraft(question.id),
        attempts: 0,
        correct: null,
        revealed: false,
        wrongCount: 0,
      };
    }
    return getProgress(question.id);
  }

  function currentExamMetrics() {
    const rows = state.exam.questionIds
      .map((id) => questionById(id))
      .filter(Boolean);
    const answered = rows.filter((question) => getExamAnswer(question.id));
    const correct = answered.filter((question) => getExamAnswer(question.id).correct);
    const wrong = answered.length - correct.length;
    const unanswered = rows.length - answered.length;
    return { total: rows.length, answered: answered.length, correct: correct.length, wrong, unanswered };
  }

  function examChapterRows() {
    const rowsByChapter = new Map();
    state.exam.questionIds
      .map((id) => questionById(id))
      .filter(Boolean)
      .forEach((question) => {
        if (!rowsByChapter.has(question.chapterIndex)) {
          rowsByChapter.set(question.chapterIndex, {
            chapterIndex: question.chapterIndex,
            chapter: question.chapter,
            total: 0,
            correct: 0,
            wrong: 0,
            unanswered: 0,
          });
        }
        const row = rowsByChapter.get(question.chapterIndex);
        const answer = getExamAnswer(question.id);
        row.total += 1;
        if (!answer) row.unanswered += 1;
        else if (answer.correct) row.correct += 1;
        else row.wrong += 1;
      });
    return [...rowsByChapter.values()]
      .map((row) => ({
        ...row,
        accuracy: row.total ? Math.round((row.correct / row.total) * 100) : 0,
      }))
      .sort((a, b) => a.chapterIndex - b.chapterIndex);
  }

  function weakChapterRows() {
    return [...examChapterRows()]
      .sort((a, b) => {
        const accuracy = a.accuracy - b.accuracy;
        return accuracy || b.wrong - a.wrong || b.unanswered - a.unanswered || a.chapterIndex - b.chapterIndex;
      })
      .slice(0, 3);
  }

  function getFilteredQuestions() {
    if (isExamMode()) {
      return state.exam.questionIds.map((id) => questionById(id)).filter(Boolean);
    }

    const query = state.filters.query.trim().toLowerCase();
    const chapter = state.filters.chapter;
    const mode = state.filters.mode;

    let result = bank.questions.filter((question) => {
      const progress = getProgress(question.id);
      if (chapter !== "all" && String(question.chapterIndex) !== chapter) return false;
      if (query) {
        const haystack = [
          question.chapter,
          question.stem,
          question.context,
          ...question.choices.map((choice) => choice.text),
        ]
          .join(" ")
          .toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      if (mode === "undone") {
        return question.type === "choice" ? progress.attempts === 0 : !progress.note && !progress.mastered;
      }
      if (mode === "starred") return isFavorite(question.id);
      if (mode === "wrong") return question.type === "choice" && progress.wrongCount > 0 && !progress.mastered;
      if (mode === "short") return question.type === "short";
      return true;
    });

    if (state.filters.order === "random") {
      result = [...result].sort(
        (a, b) => hashText(`${state.seed}:${a.id}`) - hashText(`${state.seed}:${b.id}`),
      );
    }

    return result;
  }

  function ensureCurrentQuestion() {
    if (!filteredQuestions.length) {
      const hadCurrent = state.currentId || (isExamMode() && state.exam.currentId);
      state.currentId = "";
      if (isExamMode()) state.exam.currentId = "";
      if (hadCurrent) saveState();
      return null;
    }
    const targetId = isExamMode() ? state.exam.currentId || state.currentId : state.currentId;
    const exists = filteredQuestions.some((question) => question.id === targetId);
    if (!exists) {
      state.currentId = filteredQuestions[0].id;
      if (isExamMode()) state.exam.currentId = state.currentId;
      saveState();
    } else if (state.currentId !== targetId) {
      state.currentId = targetId;
      if (isExamMode()) state.exam.currentId = targetId;
      saveState();
    }
    return filteredQuestions.find((question) => question.id === state.currentId);
  }

  function render() {
    filteredQuestions = getFilteredQuestions();
    const current = ensureCurrentQuestion();
    renderControls();
    renderStats();
    renderExamPanel();
    renderQuestion(current);
    renderQuestionList(current);
  }

  function renderControls() {
    const examMode = isExamMode();
    const choiceCount = bank.questions.filter((question) => question.type === "choice").length;
    const shortCount = bank.questions.filter((question) => question.type === "short").length;
    els.bankMeta.textContent = `${choiceCount} 道选择题 · ${shortCount} 道简答/论述 · ${bank.chapters.length} 章`;
    els.chapterSelect.value = state.filters.chapter;
    els.searchInput.value = state.filters.query;
    els.chapterSelect.disabled = examMode;
    els.searchInput.disabled = examMode;
    els.orderTabs.querySelectorAll("button").forEach((button) => {
      button.disabled = examMode;
    });
    setActiveButton(els.modeTabs, "mode", state.filters.mode);
    setActiveButton(els.orderTabs, "order", state.filters.order);
    renderSyncControls();
  }

  function setActiveButton(root, key, value) {
    root.querySelectorAll("button").forEach((button) => {
      button.classList.toggle("active", button.dataset[key] === value);
    });
  }

  function renderStats() {
    const choiceQuestions = bank.questions.filter((question) => question.type === "choice");
    const answered = choiceQuestions.filter((question) => getProgress(question.id).attempts > 0);
    const correct = answered.filter((question) => getProgress(question.id).correct === true);
    const favorites = Object.values(state.favorites).filter((favorite) => favorite && favorite.value).length;
    const wrong = choiceQuestions.filter((question) => {
      const progress = getProgress(question.id);
      return progress.wrongCount > 0 && !progress.mastered;
    });

    els.answeredStat.textContent = `${answered.length} / ${choiceQuestions.length}`;
    els.accuracyStat.textContent = answered.length ? `${Math.round((correct.length / answered.length) * 100)}%` : "0%";
    els.favoriteStat.textContent = String(favorites);
    els.wrongStat.textContent = String(wrong.length);
    els.progressFill.style.width = `${Math.round((answered.length / choiceQuestions.length) * 100)}%`;
  }

  function renderExamPanel() {
    if (!isExamMode()) {
      hide(els.examPanel);
      return;
    }

    show(els.examPanel);
    const metrics = currentExamMetrics();
    const hasPaper = examHasQuestions();
    const completed = state.exam.completed;
    const accuracy = formatAccuracy(metrics.correct, metrics.total);

    els.startExamBtn.textContent = hasPaper ? "重新开始考试" : "开始模拟考试";
    els.startExamBtn.classList.toggle("hidden", hasPaper && !completed);
    els.submitExamBtn.classList.toggle("hidden", !hasPaper || completed);
    els.exitExamBtn.classList.remove("hidden");

    if (!hasPaper) {
      els.examSummary.textContent = `按章节占比抽取 ${examQuestionCount} 道选择题`;
      hide(els.examReport);
      return;
    }

    if (completed) {
      els.examSummary.textContent = `已交卷 · 正确 ${metrics.correct} / ${metrics.total} · 正确率 ${accuracy}`;
      renderExamReport(metrics);
      show(els.examReport);
      return;
    }

    els.examSummary.textContent = `已答 ${metrics.answered} / ${metrics.total} · 正确 ${metrics.correct} · 错误 ${metrics.wrong} · 未答 ${metrics.unanswered}`;
    hide(els.examReport);
  }

  function renderExamReport(metrics = currentExamMetrics()) {
    const accuracy = formatAccuracy(metrics.correct, metrics.total);
    const fragment = document.createDocumentFragment();

    const metricGrid = document.createElement("div");
    metricGrid.className = "exam-metrics";
    [
      ["总题数", metrics.total],
      ["已答", metrics.answered],
      ["正确", metrics.correct],
      ["错误", metrics.wrong],
      ["未答", metrics.unanswered],
      ["正确率", accuracy],
    ].forEach(([label, value]) => {
      const item = document.createElement("div");
      item.className = "exam-metric";
      const strong = document.createElement("strong");
      strong.textContent = String(value);
      const span = document.createElement("span");
      span.textContent = label;
      item.append(strong, span);
      metricGrid.append(item);
    });
    fragment.append(metricGrid);

    const weakTitle = document.createElement("strong");
    weakTitle.textContent = "薄弱章节";
    fragment.append(weakTitle);

    const weakList = document.createElement("div");
    weakList.className = "weak-list";
    weakChapterRows().forEach((row) => {
      const item = document.createElement("div");
      item.textContent = `${row.chapter}：${row.correct}/${row.total}，正确率 ${row.accuracy}%`;
      weakList.append(item);
    });
    fragment.append(weakList);

    const chapterTitle = document.createElement("strong");
    chapterTitle.textContent = "章节表现";
    fragment.append(chapterTitle);

    const chapterRows = document.createElement("div");
    chapterRows.className = "chapter-results";
    examChapterRows().forEach((row) => {
      const item = document.createElement("div");
      item.className = "chapter-row";
      const name = document.createElement("span");
      name.textContent = row.chapter;
      const result = document.createElement("strong");
      result.textContent = `${row.correct} 对 / ${row.wrong} 错 / ${row.unanswered} 未答 · ${row.accuracy}%`;
      item.append(name, result);
      chapterRows.append(item);
    });
    fragment.append(chapterRows);

    els.examReport.replaceChildren(fragment);
  }

  function renderQuestion(question) {
    if (!question) {
      els.questionCounter.textContent = "第 0 / 0 题";
      els.questionTitle.textContent = isExamMode() ? "准备模拟考试" : "没有符合条件的题目";
      els.chapterBadge.textContent = "";
      els.typeBadge.textContent = "";
      els.statusBadge.textContent = "";
      els.questionText.textContent = isExamMode()
        ? "点击“开始模拟考试”生成一套 60 道选择题。"
        : "换一个章节、搜索词或题目范围试试。";
      els.options.replaceChildren();
      hide(els.contextNotice);
      hide(els.figureNotice);
      hide(els.shortBox);
      hide(els.feedback);
      hideActions(true);
      els.prevBtn.disabled = true;
      els.nextBtn.disabled = true;
      return;
    }

    hideActions(false);
    const progress = displayProgress(question);
    const index = filteredQuestions.findIndex((item) => item.id === question.id);
    els.questionCounter.textContent = `第 ${index + 1} / ${filteredQuestions.length} 题`;
    els.questionTitle.textContent = `${question.chapter} · ${question.type === "choice" ? "选择题" : "简答题"} ${question.number}`;
    els.chapterBadge.textContent = `第 ${question.chapterIndex} 章`;
    els.typeBadge.textContent = question.type === "choice" ? (question.multi ? "多选" : "单选") : "简答";
    els.statusBadge.textContent = statusLabel(question, progress);
    els.statusBadge.className = statusClass(question, progress);
    els.questionText.textContent = question.stem;
    els.prevBtn.disabled = index <= 0;
    els.nextBtn.disabled = index >= filteredQuestions.length - 1;

    if (question.context) {
      els.contextNotice.textContent = question.context;
      show(els.contextNotice);
    } else {
      hide(els.contextNotice);
    }

    if (question.figureRefs.length) {
      els.figureNotice.textContent = `原文提示参考附图 ${question.figureRefs.join("、")}。当前转换未能导出附图。`;
      show(els.figureNotice);
    } else {
      hide(els.figureNotice);
    }

    els.favoriteBtn.textContent = isFavorite(question.id) ? "★ 已收藏" : "☆ 收藏";
    els.masterBtn.textContent = progress.mastered ? "已掌握" : "标记掌握";

    if (question.type === "choice") {
      const examMode = isExamMode();
      const examAnswered = examMode && Boolean(getExamAnswer(question.id));
      hide(els.shortBox);
      show(els.options);
      els.submitBtn.textContent = progress.attempts > 0 ? "再交一次" : "提交答案";
      if (examMode) {
        hide(els.showAnswerBtn);
        hide(els.masterBtn);
      } else {
        show(els.showAnswerBtn);
        els.masterBtn.classList.toggle("hidden", progress.wrongCount === 0 && !progress.mastered);
      }
      els.submitBtn.classList.toggle("hidden", !question.multi || (examMode && (examAnswered || state.exam.completed)));
      renderOptions(question, progress);
      renderFeedback(question, progress);
    } else {
      els.options.replaceChildren();
      hide(els.options);
      if (question.answerText) {
        show(els.showAnswerBtn);
        els.showAnswerBtn.textContent = "看参考答案";
      } else {
        hide(els.showAnswerBtn);
      }
      show(els.shortBox);
      show(els.masterBtn);
      els.submitBtn.textContent = "保存笔记";
      els.shortNote.value = progress.note || "";
      renderShortFeedback(question, progress);
    }
  }

  function hideActions(hidden) {
    [els.favoriteBtn, els.submitBtn, els.showAnswerBtn, els.masterBtn].forEach((button) => {
      button.classList.toggle("hidden", hidden);
    });
  }

  function renderOptions(question, progress) {
    const locked = isExamMode() && (Boolean(getExamAnswer(question.id)) || state.exam.completed);
    const submitted = progress.attempts > 0 || progress.revealed || (isExamMode() && state.exam.completed);
    const fragment = document.createDocumentFragment();

    question.choices.forEach((choice) => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "option-button";
      button.dataset.choice = choice.id;
      if (progress.selected.includes(choice.id)) button.classList.add("selected");
      if (submitted && question.answer.includes(choice.id)) button.classList.add("correct");
      if (submitted && progress.correct === false && progress.selected.includes(choice.id) && !question.answer.includes(choice.id)) {
        button.classList.add("wrong");
      }
      if (locked) {
        button.disabled = true;
        button.classList.add("locked");
      }

      const key = document.createElement("span");
      key.className = "option-key";
      key.textContent = choice.id;

      const text = document.createElement("span");
      text.className = "option-text";
      text.textContent = choice.text;

      button.append(key, text);
      fragment.append(button);
    });

    els.options.replaceChildren(fragment);
  }

  function renderFeedback(question, progress) {
    els.feedback.className = "feedback";
    if (progress.correct === true) {
      els.feedback.textContent = progress.wrongCount > 0
        ? `答对了。正确答案：${answerText(question.answer)}。这题之前错过 ${progress.wrongCount} 次，可标记掌握。`
        : `答对了。正确答案：${answerText(question.answer)}。`;
      els.feedback.classList.add("good");
      show(els.feedback);
      return;
    }
    if (progress.correct === false) {
      els.feedback.textContent = `答错了，已记入错题本。正确答案：${answerText(question.answer)}。`;
      els.feedback.classList.add("bad");
      show(els.feedback);
      return;
    }
    if (progress.revealed) {
      els.feedback.textContent = `正确答案：${answerText(question.answer)}。`;
      els.feedback.classList.add("info");
      show(els.feedback);
      return;
    }
    if (isExamMode() && state.exam.completed && !getExamAnswer(question.id)) {
      els.feedback.textContent = `未作答。正确答案：${answerText(question.answer)}。`;
      els.feedback.classList.add("info");
      show(els.feedback);
      return;
    }
    hide(els.feedback);
  }

  function renderShortFeedback(question, progress) {
    els.feedback.className = "feedback info";
    if (progress.revealed && question.answerText) {
      els.feedback.textContent = `参考答案：${question.answerText}`;
      show(els.feedback);
    } else if (progress.mastered) {
      els.feedback.textContent = "已标记掌握。";
      show(els.feedback);
    } else if (progress.note) {
      els.feedback.textContent = "笔记已保存。";
      show(els.feedback);
    } else {
      hide(els.feedback);
    }
  }

  function statusLabel(question, progress) {
    if (question.type === "short") return progress.mastered ? "已掌握" : progress.revealed ? "看过答案" : progress.note ? "有笔记" : "自测";
    if (progress.mastered) return "已掌握";
    if (progress.correct === true) return progress.wrongCount > 0 ? "已订正" : "正确";
    if (progress.correct === false) return `错 ${progress.wrongCount} 次`;
    if (progress.revealed) return "看过答案";
    return "未做";
  }

  function statusClass(question, progress) {
    if (progress.mastered || progress.correct === true) return "badge-good";
    if (progress.correct === false) return "badge-bad";
    if (question.type === "short" && progress.note) return "badge-warn";
    return "";
  }

  function renderQuestionList(current) {
    const metrics = currentExamMetrics();
    els.listTitle.textContent = isExamMode() ? "模拟考试" : state.filters.mode === "wrong" ? "错题本" : "题目列表";
    els.listCount.textContent = isExamMode() && examHasQuestions()
      ? `已答 ${metrics.answered} / ${metrics.total}`
      : `${filteredQuestions.length} 题`;
    els.questionList.replaceChildren();

    if (!filteredQuestions.length) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "没有符合条件的题目。";
      els.questionList.append(empty);
      return;
    }

    const fragment = document.createDocumentFragment();
    filteredQuestions.forEach((question) => {
      const progress = displayProgress(question);
      const button = document.createElement("button");
      button.type = "button";
      button.className = "question-jump";
      if (current && question.id === current.id) button.classList.add("active");
      button.dataset.id = question.id;

      const title = document.createElement("span");
      title.className = "jump-title";
      title.textContent = `${question.chapterIndex}-${question.number} ${question.stem}`;

      const meta = document.createElement("span");
      meta.className = "jump-meta";
      const markers = [];
      markers.push(question.type === "choice" ? "选择" : "简答");
      if (isFavorite(question.id)) markers.push("★");
      markers.push(statusLabel(question, progress));
      meta.textContent = markers.join(" · ");

      button.append(title, meta);
      fragment.append(button);
    });
    els.questionList.append(fragment);
  }

  function currentQuestion() {
    return filteredQuestions.find((question) => question.id === state.currentId) || null;
  }

  function chooseOption(choiceId) {
    clearAutoAdvance();
    const question = currentQuestion();
    if (!question || question.type !== "choice") return;
    if (isExamMode() && (state.exam.completed || getExamAnswer(question.id))) return;

    const selected = isExamMode() ? [...getExamDraft(question.id)] : [...getProgress(question.id).selected];
    let nextSelected;
    if (question.multi) {
      nextSelected = selected.includes(choiceId)
        ? selected.filter((item) => item !== choiceId)
        : [...selected, choiceId];
      if (isExamMode()) {
        setExamDraft(question.id, nextSelected);
      } else {
        setProgress(question.id, { selected: nextSelected, correct: null, revealed: false });
      }
      render();
      return;
    } else {
      nextSelected = [choiceId];
    }
    submitChoiceAnswer(question, nextSelected, { autoAdvance: true });
  }

  function submitChoiceAnswer(question, selected, { autoAdvance = false } = {}) {
    const clean = cleanSelected(selected);
    if (!clean.length) return;
    if (isExamMode() && (state.exam.completed || getExamAnswer(question.id))) return;

    const correct = sameAnswer(clean, question.answer);
    const progress = getProgress(question.id);
    if (isExamMode()) {
      state.exam.answers[question.id] = {
        selected: clean,
        correct,
        answeredAt: nowIso(),
      };
      delete state.exam.drafts[question.id];
    }
    setProgress(question.id, {
      selected: clean,
      attempts: progress.attempts + 1,
      correct,
      wrongCount: correct ? progress.wrongCount : progress.wrongCount + 1,
      mastered: correct ? progress.mastered : false,
      revealed: false,
      lastAnsweredAt: nowIso(),
    });
    render();
    if (autoAdvance && correct && !question.multi) {
      scheduleAutoAdvance(question.id);
    }
  }

  function submitCurrent() {
    const question = currentQuestion();
    if (!question) return;
    const progress = getProgress(question.id);

    if (question.type === "short") {
      setProgress(question.id, { note: els.shortNote.value.trim() });
      render();
      return;
    }

    if (isExamMode() && (state.exam.completed || getExamAnswer(question.id))) return;

    const selected = isExamMode() ? getExamDraft(question.id) : progress.selected;
    if (!selected.length) {
      els.feedback.textContent = "请选择答案。";
      els.feedback.className = "feedback info";
      show(els.feedback);
      return;
    }

    submitChoiceAnswer(question, selected);
  }

  function revealAnswer() {
    const question = currentQuestion();
    if (!question) return;
    if (isExamMode() && question.type === "choice") return;
    setProgress(question.id, { revealed: true });
    render();
  }

  function toggleMastered() {
    const question = currentQuestion();
    if (!question) return;
    if (isExamMode() && question.type === "choice") return;
    const progress = getProgress(question.id);
    setProgress(question.id, { mastered: !progress.mastered, note: question.type === "short" ? els.shortNote.value.trim() : progress.note });
    render();
  }

  function moveCurrent(offset) {
    const index = filteredQuestions.findIndex((question) => question.id === state.currentId);
    const next = filteredQuestions[index + offset];
    if (!next) return;
    setCurrentQuestion(next.id);
    render();
  }

  function populateChapters() {
    const all = document.createElement("option");
    all.value = "all";
    all.textContent = "全部章节";
    els.chapterSelect.append(all);
    bank.chapters.forEach((chapter) => {
      const option = document.createElement("option");
      option.value = String(chapter.index);
      option.textContent = `${chapter.index}. ${chapter.title}（${chapter.choiceCount + chapter.shortCount}）`;
      els.chapterSelect.append(option);
    });
  }

  function show(element) {
    element.classList.remove("hidden");
  }

  function hide(element) {
    element.classList.add("hidden");
  }

  function localProgressData() {
    return window.ProgressSync.normalizeProgressData({
      answers: state.answers,
      favorites: state.favorites,
    });
  }

  function applyMergedProgressData(data) {
    const normalized = window.ProgressSync.normalizeProgressData(data);
    state.answers = normalized.answers;
    state.favorites = normalized.favorites;
    saveState();
    render();
  }

  function renderSyncControls() {
    if (!syncManager || !syncManager.available) {
      hide(els.syncPanel);
      return;
    }

    show(els.syncPanel);
    const settings = syncManager.getSettings();
    const connected = Boolean(settings.syncId);
    const statusClass = latestSyncStatus.state || "disconnected";

    els.syncStatus.textContent = latestSyncStatus.message || "未连接";
    els.syncStatus.className = statusClass;
    els.syncCodeInput.value = connected ? settings.syncCode || "" : els.syncCodeInput.value;
    els.syncCodeInput.disabled = connected;
    els.generateSyncBtn.disabled = connected || statusClass === "syncing";
    els.connectSyncBtn.disabled = connected || statusClass === "syncing";
    els.syncNowBtn.disabled = !connected || statusClass === "syncing";
    els.copySyncBtn.disabled = !connected || !settings.syncCode;
    els.disconnectSyncBtn.disabled = !connected || statusClass === "syncing";
  }

  function setupSync() {
    if (!window.ProgressSync) return null;
    const manager = window.ProgressSync.createProgressSyncManager({
      config: window.SYNC_CONFIG || {},
      settingsKey: syncSettingsKey,
      getLocalData: localProgressData,
      applyMergedData: applyMergedProgressData,
      onStatusChange: (status) => {
        latestSyncStatus = status;
        renderSyncControls();
      },
    });
    return manager;
  }

  function exportProgress() {
    const payload = {
      title: bank.title,
      exportedAt: new Date().toISOString(),
      state,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob);
    anchor.download = "马原题库进度.json";
    anchor.click();
    URL.revokeObjectURL(anchor.href);
  }

  function importProgress(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.addEventListener("load", () => {
      try {
        const payload = JSON.parse(String(reader.result || "{}"));
        const imported = payload.state || payload;
        if (!imported.answers || !imported.favorites) throw new Error("invalid");
        state = migrateState(imported);
        saveState();
        if (syncManager) syncManager.markDirty();
        render();
      } catch {
        window.alert("导入失败：请选择由本网页导出的进度文件。");
      }
    });
    reader.readAsText(file, "utf-8");
  }

  function resetProgress() {
    const ok = window.confirm("确定清空本网页保存在浏览器里的练习进度吗？");
    if (!ok) return;
    localStorage.removeItem(storageKey);
    state = freshState();
    render();
  }

  function bindEvents() {
    els.chapterSelect.addEventListener("change", () => {
      state.filters.chapter = els.chapterSelect.value;
      state.currentId = "";
      saveState();
      render();
    });

    els.searchInput.addEventListener("input", () => {
      state.filters.query = els.searchInput.value;
      state.currentId = "";
      saveState();
      render();
    });

    els.modeTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-mode]");
      if (!button) return;
      state.filters.mode = button.dataset.mode;
      clearAutoAdvance();
      state.currentId = state.filters.mode === "exam" ? state.exam.currentId || state.exam.questionIds[0] || "" : "";
      if (state.filters.mode === "exam") state.exam.currentId = state.currentId;
      saveState();
      render();
    });

    els.orderTabs.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-order]");
      if (!button) return;
      if (state.filters.order === "random" && button.dataset.order === "random") {
        state.seed = String(Date.now());
      }
      state.filters.order = button.dataset.order;
      state.currentId = "";
      saveState();
      render();
    });

    els.prevBtn.addEventListener("click", () => moveCurrent(-1));
    els.nextBtn.addEventListener("click", () => moveCurrent(1));
    els.startExamBtn.addEventListener("click", startExam);
    els.submitExamBtn.addEventListener("click", submitExam);
    els.exitExamBtn.addEventListener("click", exitExamMode);
    els.options.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-choice]");
      if (button) chooseOption(button.dataset.choice);
    });

    els.favoriteBtn.addEventListener("click", () => {
      const question = currentQuestion();
      if (!question) return;
      setFavorite(question.id, !isFavorite(question.id));
      render();
    });

    els.submitBtn.addEventListener("click", submitCurrent);
    els.showAnswerBtn.addEventListener("click", revealAnswer);
    els.masterBtn.addEventListener("click", toggleMastered);
    els.shortNote.addEventListener("input", () => {
      const question = currentQuestion();
      if (question && question.type === "short") {
        setProgress(question.id, { note: els.shortNote.value });
      }
    });

    els.questionList.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-id]");
      if (!button) return;
      setCurrentQuestion(button.dataset.id);
      render();
    });

    els.exportBtn.addEventListener("click", exportProgress);
    els.importBtn.addEventListener("click", () => els.importInput.click());
    els.importInput.addEventListener("change", () => {
      importProgress(els.importInput.files[0]);
      els.importInput.value = "";
    });
    els.resetBtn.addEventListener("click", resetProgress);
    els.generateSyncBtn.addEventListener("click", async () => {
      if (!syncManager) return;
      const code = syncManager.generateSyncCode();
      els.syncCodeInput.value = code;
      await syncManager.connect(code);
      render();
    });
    els.connectSyncBtn.addEventListener("click", async () => {
      if (!syncManager) return;
      try {
        const code = window.ProgressSync.formatSyncCode(els.syncCodeInput.value);
        els.syncCodeInput.value = code;
        await syncManager.connect(code);
        render();
      } catch (error) {
        latestSyncStatus = { state: "error", message: error.message || "同步码无效" };
        renderSyncControls();
      }
    });
    els.syncNowBtn.addEventListener("click", async () => {
      if (!syncManager) return;
      await syncManager.syncNow();
      render();
    });
    els.copySyncBtn.addEventListener("click", async () => {
      if (!syncManager) return;
      const code = syncManager.getSettings().syncCode || "";
      if (!code) return;
      try {
        await navigator.clipboard.writeText(code);
        latestSyncStatus = { state: "synced", message: "同步码已复制" };
        renderSyncControls();
      } catch {
        window.prompt("复制同步码", code);
      }
    });
    els.disconnectSyncBtn.addEventListener("click", () => {
      if (!syncManager) return;
      syncManager.disconnect();
      els.syncCodeInput.value = "";
      render();
    });

    document.addEventListener("keydown", (event) => {
      if (event.target.matches("input, textarea, select")) return;
      const keyMap = { 1: "A", 2: "B", 3: "C", 4: "D" };
      if (keyMap[event.key]) chooseOption(keyMap[event.key]);
      if (event.key === "Enter") submitCurrent();
      if (event.key === "ArrowLeft") moveCurrent(-1);
      if (event.key === "ArrowRight") moveCurrent(1);
    });
  }

  if (!bank) {
    document.body.textContent = "题库数据载入失败。";
    return;
  }

  populateChapters();
  syncManager = setupSync();
  bindEvents();
  render();
  if (syncManager) syncManager.init();
})();

function loadQuestionBank() {
  if (window.QUESTION_BANK) return Promise.resolve(window.QUESTION_BANK);
  if (window.QUESTION_BANK_READY) return window.QUESTION_BANK_READY;
  return Promise.resolve(null);
}
