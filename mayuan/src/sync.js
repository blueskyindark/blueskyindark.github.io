(() => {
  const progressVersion = 2;
  const emptyData = () => ({ progressVersion, answers: {}, favorites: {} });

  function nowIso() {
    return new Date().toISOString();
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function normalizeAnswerRecord(record, fallbackAt = nowIso()) {
    const source = isObject(record) ? record : {};
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

  function normalizeFavoriteRecord(record, fallbackAt = nowIso()) {
    if (typeof record === "boolean") {
      return { value: record, updatedAt: fallbackAt };
    }
    if (!isObject(record)) {
      return { value: false, updatedAt: fallbackAt };
    }
    return {
      value: Boolean(record.value),
      updatedAt: typeof record.updatedAt === "string" && record.updatedAt ? record.updatedAt : fallbackAt,
    };
  }

  function normalizeProgressData(data, fallbackAt = nowIso()) {
    const source = isObject(data) ? data : {};
    const answers = {};
    const favorites = {};

    Object.entries(source.answers || {}).forEach(([id, record]) => {
      answers[id] = normalizeAnswerRecord(record, fallbackAt);
    });
    Object.entries(source.favorites || {}).forEach(([id, record]) => {
      favorites[id] = normalizeFavoriteRecord(record, fallbackAt);
    });

    return { progressVersion, answers, favorites };
  }

  function timeValue(value) {
    const parsed = Date.parse(value || "");
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function latestIso(a, b) {
    return timeValue(a) >= timeValue(b) ? a || b || "" : b || a || "";
  }

  function sameJson(a, b) {
    return JSON.stringify(a) === JSON.stringify(b);
  }

  function mergeAnswerRecord(localRecord, remoteRecord) {
    if (!localRecord) return normalizeAnswerRecord(remoteRecord);
    if (!remoteRecord) return normalizeAnswerRecord(localRecord);

    const local = normalizeAnswerRecord(localRecord);
    const remote = normalizeAnswerRecord(remoteRecord);
    const newer = timeValue(local.updatedAt) >= timeValue(remote.updatedAt) ? local : remote;

    return {
      selected: [...newer.selected],
      attempts: Math.max(local.attempts, remote.attempts),
      correct: newer.correct,
      wrongCount: Math.max(local.wrongCount, remote.wrongCount),
      revealed: newer.revealed,
      mastered: local.mastered || remote.mastered,
      note: newer.note,
      lastAnsweredAt: latestIso(local.lastAnsweredAt, remote.lastAnsweredAt),
      updatedAt: latestIso(local.updatedAt, remote.updatedAt) || nowIso(),
    };
  }

  function mergeFavoriteRecord(localRecord, remoteRecord) {
    if (!localRecord) return normalizeFavoriteRecord(remoteRecord);
    if (!remoteRecord) return normalizeFavoriteRecord(localRecord);

    const local = normalizeFavoriteRecord(localRecord);
    const remote = normalizeFavoriteRecord(remoteRecord);
    return timeValue(local.updatedAt) >= timeValue(remote.updatedAt) ? local : remote;
  }

  function mergeProgressData(localData, remoteData) {
    const local = normalizeProgressData(localData);
    const remote = normalizeProgressData(remoteData);
    const merged = emptyData();

    new Set([...Object.keys(local.answers), ...Object.keys(remote.answers)]).forEach((id) => {
      merged.answers[id] = mergeAnswerRecord(local.answers[id], remote.answers[id]);
    });
    new Set([...Object.keys(local.favorites), ...Object.keys(remote.favorites)]).forEach((id) => {
      merged.favorites[id] = mergeFavoriteRecord(local.favorites[id], remote.favorites[id]);
    });

    return {
      data: merged,
      changed: !sameJson(local, merged),
    };
  }

  function validConfig(config) {
    return Boolean(
      config
        && typeof config.supabaseUrl === "string"
        && /^https:\/\/.+\.supabase\.co\/?$/.test(config.supabaseUrl.trim())
        && typeof config.supabaseAnonKey === "string"
        && config.supabaseAnonKey.trim().length > 20,
    );
  }

  function normalizeSyncCode(code) {
    return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  }

  function formatSyncCode(code) {
    return normalizeSyncCode(code).replace(/(.{4})/g, "$1-").replace(/-$/, "");
  }

  function generateSyncCode() {
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(20);
    crypto.getRandomValues(bytes);
    return formatSyncCode(Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join(""));
  }

  function bytesToHex(buffer) {
    return Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }

  async function hashSyncCode(code) {
    const normalized = normalizeSyncCode(code);
    if (normalized.length < 16) {
      throw new Error("同步码太短，请输入完整同步码。");
    }
    if (!crypto.subtle) {
      throw new Error("当前浏览器不支持安全哈希，无法使用云同步。");
    }
    const bytes = new TextEncoder().encode(`mayuan-sync:${normalized}`);
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return bytesToHex(digest);
  }

  function createProgressSyncManager(options) {
    const config = options.config || {};
    const available = validConfig(config);
    const settingsKey = options.settingsKey;
    const onStatusChange = options.onStatusChange || (() => {});
    const baseUrl = String(config.supabaseUrl || "").replace(/\/$/, "");
    let timer = 0;
    let status = {
      state: available ? "disconnected" : "unconfigured",
      message: available ? "未连接同步码" : "云同步未配置",
    };
    let settings = loadSettings();

    function loadSettings() {
      try {
        const saved = JSON.parse(localStorage.getItem(settingsKey));
        if (!saved || saved.version !== 1) return { version: 1 };
        return saved;
      } catch {
        return { version: 1 };
      }
    }

    function saveSettings() {
      localStorage.setItem(settingsKey, JSON.stringify(settings));
    }

    function setStatus(next) {
      status = { ...status, ...next };
      onStatusChange(status);
    }

    function headers() {
      return {
        apikey: config.supabaseAnonKey,
        Authorization: `Bearer ${config.supabaseAnonKey}`,
        "Content-Type": "application/json",
      };
    }

    async function rpc(name, body) {
      const response = await fetch(`${baseUrl}/rest/v1/rpc/${name}`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });
      const text = await response.text();
      const data = text ? JSON.parse(text) : null;
      if (!response.ok) {
        const message = data && data.message ? data.message : `同步请求失败：${response.status}`;
        throw new Error(message);
      }
      return Array.isArray(data) ? data[0] || null : data;
    }

    async function pullRemote(syncId) {
      return rpc("pull_progress", { p_sync_id: syncId });
    }

    async function pushRemote(syncId, data, baseRevision) {
      return rpc("push_progress", {
        p_sync_id: syncId,
        p_data: data,
        p_base_revision: baseRevision,
      });
    }

    async function pushMerged(syncId, baseRevision) {
      const result = await pushRemote(syncId, options.getLocalData(), baseRevision);
      if (result && result.status === "conflict") {
        const merged = mergeProgressData(options.getLocalData(), result.data);
        options.applyMergedData(merged.data);
        return pushRemote(syncId, merged.data, result.revision);
      }
      return result;
    }

    async function syncNow() {
      if (!available || !settings.syncId) return false;
      window.clearTimeout(timer);
      setStatus({ state: "syncing", message: "正在同步" });
      try {
        const remote = await pullRemote(settings.syncId);
        let baseRevision = null;

        if (remote && remote.data) {
          baseRevision = remote.revision;
          const merged = mergeProgressData(options.getLocalData(), remote.data);
          if (merged.changed) {
            options.applyMergedData(merged.data);
          }
        }

        const saved = await pushMerged(settings.syncId, baseRevision);
        if (saved) {
          settings.remoteRevision = saved.revision;
          settings.lastSyncedAt = nowIso();
          settings.pending = false;
          saveSettings();
        }
        setStatus({ state: "synced", message: "已同步" });
        return true;
      } catch (error) {
        settings.pending = true;
        saveSettings();
        setStatus({ state: navigator.onLine === false ? "pending" : "error", message: error.message || "同步失败" });
        return false;
      }
    }

    async function connect(code) {
      if (!available) return false;
      const formattedCode = formatSyncCode(code);
      const syncId = await hashSyncCode(formattedCode);
      settings = {
        version: 1,
        syncCode: formattedCode,
        syncId,
        remoteRevision: null,
        pending: true,
        connectedAt: nowIso(),
      };
      saveSettings();
      await syncNow();
      return true;
    }

    function disconnect() {
      window.clearTimeout(timer);
      settings = { version: 1 };
      saveSettings();
      setStatus({ state: "disconnected", message: "未连接同步码" });
    }

    function markDirty() {
      if (!available || !settings.syncId) return;
      settings.pending = true;
      saveSettings();
      setStatus({ state: "pending", message: "有本地更改待同步" });
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        syncNow();
      }, 1200);
    }

    function init() {
      if (!available) {
        setStatus({ state: "unconfigured", message: "云同步未配置" });
        return;
      }
      if (settings.syncId) {
        setStatus({ state: settings.pending ? "pending" : "disconnected", message: settings.pending ? "有本地更改待同步" : "已连接同步码" });
        syncNow();
      } else {
        setStatus({ state: "disconnected", message: "未连接同步码" });
      }
      window.addEventListener("online", () => {
        if (settings.syncId && settings.pending) syncNow();
      });
    }

    return {
      available,
      init,
      syncNow,
      connect,
      disconnect,
      markDirty,
      generateSyncCode,
      getStatus: () => status,
      getSettings: () => ({ ...settings }),
    };
  }

  window.ProgressSync = {
    createProgressSyncManager,
    formatSyncCode,
    mergeProgressData,
    normalizeProgressData,
    progressVersion,
  };
})();
