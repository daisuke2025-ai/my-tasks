// My Tasks - Supabase cloud version
const $ = (id) => document.getElementById(id);
const taskForm = $("taskForm"),
  taskInput = $("taskInput"),
  taskList = $("taskList");
const taskCount = $("taskCount"),
  viewTitle = $("viewTitle");
const tabButtons = document.querySelectorAll(".tab-button");
const categoryForm = $("categoryForm"),
  categoryInput = $("categoryInput"),
  categoryList = $("categoryList");
const categoryFilter = $("categoryFilter"),
  statusFilter = $("statusFilter");
const sortSelect = $("sortSelect"),
  dateFilter = $("dateFilter"),
  completedLast = $("completedLast");
const bulkActions = $("bulkActions"),
  moveOverdueButton = $("moveOverdueButton");
const editOverlay = $("editOverlay"),
  editForm = $("editForm");
const editTitle = $("editTitle"),
  editCategory = $("editCategory");
const editDate = $("editDate"),
  editTime = $("editTime"),
  editRepeat = $("editRepeat"),
  editPriority = $("editPriority"),
  clearCompletedButton = $("clearCompletedButton"),
  categorySection = $("categorySection"),
  filterPanel = $("filterPanel"),
  sortField = $("sortField"),
  statusField = $("statusField"),
  completedLastRow = $("completedLastRow");
let currentView = "inbox",
  selectedCategory = "all",
  selectedStatus = "all";
let selectedDateFilter = "all",
  currentSort = "created",
  editingTaskId = null;
const SETTINGS_KEY = "myTasksViewSettingsV1";
const viewSettings = {
  inbox: { category: "all", status: "all", date: "all", sort: "created" },
  organized: {
    category: "all",
    status: "active",
    date: "all",
    sort: "dateAsc",
  },
  all: { category: "all", status: "all", date: "all", sort: "created" },
};
try {
  const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
  for (const view of Object.keys(viewSettings)) {
    if (saved[view] && typeof saved[view] === "object")
      Object.assign(viewSettings[view], saved[view]);
  }
  if (["inbox", "organized", "all"].includes(saved.currentView))
    currentView = saved.currentView;
} catch (e) {
  console.warn("表示設定の復元に失敗", e);
}
function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ ...viewSettings, currentView }),
    );
  } catch (e) {
    console.warn("表示設定を保存できません", e);
  }
}
function restoreViewSettings() {
  const state = viewSettings[currentView];
  selectedCategory = state.category || "all";
  selectedDateFilter = state.date || "all";
  selectedStatus =
    currentView === "organized" ? "active" : state.status || "all";
  currentSort =
    currentView === "organized" && !["dateAsc", "priority"].includes(state.sort)
      ? "dateAsc"
      : state.sort || "created";
  categoryFilter.value = selectedCategory;
  dateFilter.value = selectedDateFilter;
  statusFilter.value = selectedStatus;
  sortSelect.replaceChildren();
  const options =
    currentView === "organized"
      ? [
          ["dateAsc", "期限が近い順"],
          ["priority", "優先度順"],
        ]
      : [
          ["created", "登録順"],
          ["dateAsc", "期限が近い順"],
          ["dateDesc", "期限が遠い順"],
          ["priority", "優先度順"],
          ["completedAt", "完了順"],
        ];
  for (const [value, label] of options) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    sortSelect.append(option);
  }
  sortSelect.value = currentSort;
  filterPanel.hidden = currentView === "inbox";
  sortField.hidden = currentView === "inbox";
  statusField.hidden = currentView !== "all";
  completedLastRow.hidden = currentView !== "all";
  categorySection.hidden = currentView !== "all";
  clearCompletedButton.hidden = currentView !== "all";
  tabButtons.forEach((b) =>
    b.classList.toggle("active", b.dataset.view === currentView),
  );
}
function rememberViewSettings() {
  viewSettings[currentView] = {
    category: selectedCategory,
    status: selectedStatus,
    date: selectedDateFilter,
    sort: currentSort,
  };
  saveSettings();
}
let tasks = [],
  categories = [],
  activeUserId = null,
  busy = false,
  loadVersion = 0;
const repeatLabels = {
  none: "繰り返しなし",
  daily: "毎日",
  weekdays: "平日のみ",
  weekly: "毎週",
  monthly: "毎月",
};

function reportError(error) {
  console.error(error);
  alert("保存・読み込みに失敗しました。\n" + (error?.message || String(error)));
}
// Guest data is isolated from signed-in accounts and stored in this browser.
const GUEST_KEY = "myTasksGuestDataV1";
function readGuest() {
  try {
    const raw = localStorage.getItem(GUEST_KEY);
    if (!raw) return { tasks: [], categories: [] };
    const value = JSON.parse(raw);
    if (!Array.isArray(value.tasks) || !Array.isArray(value.categories))
      throw new Error("ゲストデータの形式が不正です");
    return value;
  } catch (error) {
    throw new Error(
      "端末内のデータを読み込めません。データを消さずに確認してください: " +
        error.message,
    );
  }
}
function writeGuest(data) {
  // localStorage can fail (private mode, storage full, blocked cookies).
  localStorage.setItem(GUEST_KEY, JSON.stringify(data));
}
const CLOUD_CACHE_PREFIX = "myTasksCloudCacheV1:";
const CLOUD_BASE_PREFIX = "myTasksCloudBaseV1:";
const syncIndicator = $("syncIndicator");
const syncNowButton = $("syncNowButton");
let syncing = false,
  syncRequested = false,
  syncTimer = null;
function readJson(key, fallback) {
  const raw = localStorage.getItem(key);
  if (raw === null) return fallback;
  const value = JSON.parse(raw);
  if (!value || !Array.isArray(value.tasks) || !Array.isArray(value.categories))
    throw new Error("保存データの形式が不正です: " + key);
  return value;
}
function cacheKey(id) {
  return CLOUD_CACHE_PREFIX + id;
}
function baseKey(id) {
  return CLOUD_BASE_PREFIX + id;
}
function readLocalStore() {
  return activeUserId
    ? readJson(cacheKey(activeUserId), { tasks: [], categories: [] })
    : readGuest();
}
function writeLocalStore(data) {
  if (activeUserId)
    localStorage.setItem(cacheKey(activeUserId), JSON.stringify(data));
  else writeGuest(data);
  updateSyncStatus();
}
function localQuery(table) {
  const kind =
    table === "tasks" ? "tasks" : table === "categories" ? "categories" : null;
  if (!kind) throw new Error("不明なテーブル: " + table);
  let operation = "select",
    payload = null,
    filters = [],
    ordering = null,
    maxRows = null;
  const query = {
    select() {
      return this;
    },
    insert(rows) {
      operation = "insert";
      payload = rows;
      return this;
    },
    update(values) {
      operation = "update";
      payload = values;
      return this;
    },
    delete() {
      operation = "delete";
      return this;
    },
    eq(field, value) {
      filters.push((row) => row[field] === value);
      return this;
    },
    in(field, values) {
      filters.push((row) => values.includes(row[field]));
      return this;
    },
    order(field, { ascending = true } = {}) {
      ordering = { field, ascending };
      return this;
    },
    limit(n) {
      maxRows = n;
      return this;
    },
    then(resolve, reject) {
      try {
        const store = readLocalStore();
        const rows = store[kind];
        const selected = rows.filter((row) =>
          filters.every((test) => test(row)),
        );
        let data;
        if (operation === "select") {
          data = selected.map((row) => ({ ...row }));
          if (ordering)
            data.sort((a, b) => {
              const x = String(a[ordering.field] ?? ""),
                y = String(b[ordering.field] ?? "");
              return (ordering.ascending ? 1 : -1) * x.localeCompare(y);
            });
          if (maxRows !== null) data = data.slice(0, maxRows);
        } else if (operation === "insert") {
          const inserted = (Array.isArray(payload) ? payload : [payload]).map(
            (row) => ({
              ...row,
              id: row.id || crypto.randomUUID(),
              created_at: row.created_at || new Date().toISOString(),
            }),
          );
          if (
            kind === "tasks" &&
            inserted.some((row) => rows.some((old) => old.id === row.id))
          )
            throw new Error("同じIDのタスクが既にあります");
          if (
            kind === "categories" &&
            inserted.some((row) => rows.some((old) => old.name === row.name))
          )
            throw new Error("同名のカテゴリーがあります");
          store[kind] = [...rows, ...inserted];
          writeLocalStore(store);
          data = inserted;
        } else if (operation === "update") {
          store[kind] = rows.map((row) =>
            selected.includes(row) ? { ...row, ...payload } : row,
          );
          writeLocalStore(store);
          data = [];
        } else {
          store[kind] = rows.filter((row) => !selected.includes(row));
          writeLocalStore(store);
          data = [];
        }
        return Promise.resolve({ data, error: null }).then(resolve, reject);
      } catch (error) {
        return Promise.resolve({ data: null, error }).then(resolve, reject);
      }
    },
  };
  return query;
}
const localClient = { from: localQuery };
function client() {
  return localClient;
}
function updateSyncStatus(message) {
  if (!syncIndicator) return;
  if (!activeUserId) {
    syncIndicator.textContent = "ゲスト：端末内に保存";
    syncNowButton.hidden = true;
    return;
  }
  syncNowButton.hidden = false;
  if (message) {
    syncIndicator.textContent = message;
    return;
  }
  const base = readJson(baseKey(activeUserId), { tasks: [], categories: [] });
  const local = readLocalStore();
  const pending = changedRows(base, local).length;
  syncIndicator.textContent = syncing
    ? "同期中…"
    : pending
      ? `同期待ち：${pending}件`
      : "同期済み（最終確認は同期ボタン）";
}
function normalized(obj) {
  return JSON.stringify(obj ?? null);
}
function changedRows(base, local) {
  const changes = [];
  for (const kind of ["categories", "tasks"]) {
    const old = new Map(base[kind].map((r) => [r.id, r]));
    const now = new Map(local[kind].map((r) => [r.id, r]));
    for (const id of new Set([...old.keys(), ...now.keys()]))
      if (normalized(old.get(id)) !== normalized(now.get(id)))
        changes.push({ kind, id, old: old.get(id), value: now.get(id) });
  }
  return changes;
}
function applyChanges(target, changes) {
  const result = {
    tasks: target.tasks.map((r) => ({ ...r })),
    categories: target.categories.map((r) => ({ ...r })),
  };
  for (const change of changes) {
    const arr = result[change.kind];
    const index = arr.findIndex((r) => r.id === change.id);
    if (change.value === undefined) {
      if (index >= 0) arr.splice(index, 1);
    } else if (index >= 0) arr[index] = { ...change.value };
    else arr.push({ ...change.value });
  }
  return result;
}
async function fetchAllRows(db, table, userId) {
  const result = [];
  for (let offset = 0; ; offset += 500) {
    const page = ensureResult(
      await db
        .from(table)
        .select("*")
        .eq("user_id", userId)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + 499),
    );
    result.push(...page);
    if (page.length < 500) break;
    if (offset > 100000)
      throw new Error("データが多すぎます。同期を中断しました");
  }
  return result;
}
async function fetchCloudSnapshot(userId) {
  const db = window.supabaseClient;
  const [tasks, categories] = await Promise.all([
    fetchAllRows(db, "tasks", userId),
    fetchAllRows(db, "categories", userId),
  ]);
  return { tasks, categories };
}
async function writeChangesToCloud(userId, changes) {
  const db = window.supabaseClient;
  // Upsert categories first, then tasks; delete tasks before categories.
  for (const kind of ["categories", "tasks"]) {
    const items = changes.filter(
      (c) => c.kind === kind && c.value !== undefined,
    );
    for (let i = 0; i < items.length; i += 100) {
      const rows = items
        .slice(i, i + 100)
        .map((c) => ({ ...c.value, user_id: userId }));
      ensureResult(await db.from(kind).upsert(rows, { onConflict: "id" }));
    }
  }
  for (const kind of ["tasks", "categories"]) {
    const items = changes.filter(
      (c) => c.kind === kind && c.value === undefined,
    );
    for (let i = 0; i < items.length; i += 100) {
      const ids = items.slice(i, i + 100).map((c) => c.id);
      ensureResult(
        await db.from(kind).delete().eq("user_id", userId).in("id", ids),
      );
    }
  }
}
async function syncCloud() {
  if (!activeUserId || syncing) {
    if (syncing) syncRequested = true;
    return;
  }
  if (!navigator.onLine) {
    updateSyncStatus("オフライン：端末に保存・同期待ち");
    return;
  }
  const userId = activeUserId;
  syncing = true;
  updateSyncStatus("同期中…");
  try {
    const cached = readJson(cacheKey(userId), null);
    const base = readJson(baseKey(userId), null);
    const remote = await fetchCloudSnapshot(userId);
    if (activeUserId !== userId) return;
    if (!base) {
      if (cached && (cached.tasks.length || cached.categories.length))
        throw new Error(
          "同期基準がない端末データがあります。上書き防止のため停止しました",
        );
      localStorage.setItem(cacheKey(userId), JSON.stringify(remote));
      localStorage.setItem(baseKey(userId), JSON.stringify(remote));
      reloadLocal();
      return;
    }
    const local = readLocalStore();
    const changes = changedRows(base, local);
    const remoteChanges = changedRows(base, remote);
    const remoteChangeMap = new Map(
      remoteChanges.map((c) => [c.kind + ":" + c.id, c]),
    );
    const conflicts = changes.filter((c) => {
      const r = remoteChangeMap.get(c.kind + ":" + c.id);
      return r && normalized(r.value) !== normalized(c.value);
    });
    if (conflicts.length) {
      updateSyncStatus(`競合：${conflicts.length}件（同期停止）`);
      const useLocal = confirm(
        `${conflicts.length}件のタスクまたはカテゴリーが別端末でも変更されています。\n\nOK：この端末の変更を優先\nキャンセル：同期を停止してデータを保持`,
      );
      if (!useLocal) return;
    }
    await writeChangesToCloud(userId, changes);
    const confirmed = await fetchCloudSnapshot(userId);
    if (activeUserId !== userId) return;
    // Changes made during network requests are preserved and queued for next sync.
    const latest = readLocalStore();
    const later = changedRows(local, latest);
    const merged = applyChanges(confirmed, later);
    localStorage.setItem(cacheKey(userId), JSON.stringify(merged));
    localStorage.setItem(baseKey(userId), JSON.stringify(confirmed));
    reloadLocal();
  } catch (error) {
    console.error("同期エラー", error);
    updateSyncStatus(
      "同期エラー：端末のデータは保持されています。再試行してください",
    );
  } finally {
    syncing = false;
    if (
      activeUserId === userId &&
      syncIndicator.textContent.startsWith("同期中")
    )
      updateSyncStatus();
    if (syncRequested) {
      syncRequested = false;
      setTimeout(() => syncCloud(), 300);
    }
  }
}
function scheduleSync() {
  if (!activeUserId) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncCloud(), 600);
}
function reloadLocal() {
  const data = readLocalStore();
  tasks = data.tasks.map(toTask);
  categories = data.categories.map((row) => row.name);
  renderAll();
  updateSyncStatus();
}
syncNowButton.addEventListener("click", () => syncCloud());
window.addEventListener("online", () => scheduleSync());
window.addEventListener("focus", () => scheduleSync());
document.addEventListener("visibilitychange", () => {
  if (!document.hidden) scheduleSync();
});
setInterval(() => {
  if (activeUserId && navigator.onLine) scheduleSync();
}, 30000);
function reloadGuest() {
  const data = readGuest();
  tasks = data.tasks.map(toTask);
  categories = data.categories.map((row) => row.name);
  renderAll();
}
async function importGuestToCloud(userId) {
  const guest = readGuest();
  if (!guest.tasks.length && !guest.categories.length) return;
  if (
    !confirm(
      `この端末のゲストデータ（タスク${guest.tasks.length}件・カテゴリー${guest.categories.length}件）をログイン中のアカウントへ引き継ぎますか？\n\nOK：クラウドへ追加\nキャンセル：ゲストデータは端末に残す`,
    )
  )
    return;
  // Keep guest data intact until every cloud write and final read succeeds.
  const db = window.supabaseClient;
  const existing = ensureResult(
    await db.from("categories").select("name").eq("user_id", userId),
  );
  const existingNames = new Set(existing.map((row) => row.name));
  for (const category of guest.categories) {
    if (activeUserId !== userId) throw new Error("ログイン先が変更されました");
    if (existingNames.has(category.name)) continue;
    ensureResult(
      await db
        .from("categories")
        .insert({ user_id: userId, name: category.name }),
    );
    existingNames.add(category.name);
  }
  for (let i = 0; i < guest.tasks.length; i += 100) {
    if (activeUserId !== userId) throw new Error("ログイン先が変更されました");
    const batch = guest.tasks
      .slice(i, i + 100)
      .map((row) => ({ ...row, user_id: userId }));
    // Stable guest UUIDs allow retry after partial failure without duplicate tasks.
    ensureResult(await db.from("tasks").upsert(batch, { onConflict: "id" }));
  }
  await syncCloud();
  if (activeUserId !== userId) throw new Error("ログイン先が変更されました");
  // Clear only the imported snapshot; prevent deleting newer guest data.
  const latest = readGuest();
  const importedIds = new Set(guest.tasks.map((t) => t.id));
  const importedNames = new Set(guest.categories.map((c) => c.name));
  writeGuest({
    tasks: latest.tasks.filter((t) => !importedIds.has(t.id)),
    categories: latest.categories.filter((c) => !importedNames.has(c.name)),
  });
  alert("ゲストデータをクラウドに引き継ぎました！");
}
function formatLocalDate(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function today() {
  return formatLocalDate(new Date());
}
function parseDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s || "")) return null;
  const [y, m, d] = s.split("-").map(Number);
  const x = new Date(y, m - 1, d, 12);
  return formatLocalDate(x) === s ? x : null;
}
function addDays(s, n) {
  const d = parseDate(s);
  if (!d) return "";
  d.setDate(d.getDate() + n);
  return formatLocalDate(d);
}
function isOverdue(t) {
  if (t.completed || !t.date) return false;
  const d = new Date(t.date + "T" + (t.time || "23:59") + ":59");
  return !Number.isNaN(d.getTime()) && d.getTime() < Date.now();
}
function getDeadline(t) {
  return t.date ? t.date + "T" + (t.time || "23:59") : null;
}
function getRepeat(t) {
  return repeatLabels[t.repeat] ? t.repeat : "none";
}
function getAnchor(t) {
  return t.repeatAnchor || t.date;
}
function isScheduledDate(t, s) {
  const d = parseDate(s),
    a = parseDate(getAnchor(t)),
    r = getRepeat(t);
  if (!d || !a || r === "none") return false;
  if (r === "daily") return true;
  if (r === "weekdays") return d.getDay() >= 1 && d.getDay() <= 5;
  if (r === "weekly") return d.getDay() === a.getDay();
  if (r === "monthly")
    return (
      d.getDate() ===
      Math.min(
        a.getDate(),
        new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(),
      )
    );
  return false;
}
function nextScheduledDate(t, after) {
  const a = parseDate(getAnchor(t)),
    d = parseDate(after),
    r = getRepeat(t);
  if (!a || !d || r === "none") return "";
  if (r === "daily") return addDays(after, 1);
  if (r === "weekdays" || r === "weekly") {
    let next = addDays(after, 1);
    for (let i = 0; i < 8; i++, next = addDays(next, 1))
      if (isScheduledDate(t, next)) return next;
  }
  if (r === "monthly") {
    for (let i = 0; i < 24; i++) {
      const first = new Date(d.getFullYear(), d.getMonth() + i, 1, 12);
      const day = Math.min(
        a.getDate(),
        new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate(),
      );
      const candidate = new Date(
        first.getFullYear(),
        first.getMonth(),
        day,
        12,
      );
      if (candidate > d) return formatLocalDate(candidate);
    }
  }
  return "";
}
function toTask(row) {
  return {
    id: row.id,
    title: row.title,
    completed: row.completed,
    completedAt: row.completed_at,
    category: row.category || "",
    date: row.date || "",
    time: row.time ? String(row.time).slice(0, 5) : "",
    organized: row.organized,
    repeat: row.repeat || "none",
    repeatAnchor: row.repeat_anchor || "",
    sourceTaskId: row.source_task_id || null,
    generatedNextId: row.generated_next_id || null,
    createdAt: row.created_at,
    priority: Number(row.priority) || 4,
  };
}
function taskRow(t) {
  return {
    id: t.id,
    user_id: activeUserId,
    title: t.title,
    completed: !!t.completed,
    completed_at: t.completedAt || null,
    category: t.category || "",
    date: t.date || null,
    time: t.time || null,
    organized: !!t.category,
    priority: Number(t.priority) || 4,
    repeat: getRepeat(t),
    repeat_anchor: t.repeatAnchor || null,
    source_task_id: t.sourceTaskId || null,
    generated_next_id: t.generatedNextId || null,
  };
}
function categoryRow(name) {
  return { user_id: activeUserId, name };
}
function ensureResult(result) {
  if (result.error) throw result.error;
  return result.data;
}
window.setCloudUser = async function (user) {
  const id = user?.id || null;
  if (busy)
    throw new Error("保存処理中です。完了後にもう一度操作してください。");
  ++loadVersion;
  activeUserId = id;
  tasks = [];
  categories = [];
  renderAll();
  if (!id) {
    reloadGuest();
    updateSyncStatus();
    return;
  }
  // Show cached data immediately, even without a network connection.
  let cache = readJson(cacheKey(id), null);
  if (!cache) {
    // An empty baseline allows first-time offline edits to merge with existing cloud rows later.
    cache = { tasks: [], categories: [] };
    localStorage.setItem(cacheKey(id), JSON.stringify(cache));
    if (!readJson(baseKey(id), null))
      localStorage.setItem(baseKey(id), JSON.stringify(cache));
  }
  reloadLocal();
  if (navigator.onLine) {
    await syncCloud();
    if (activeUserId === id && readJson(baseKey(id), null))
      await importGuestToCloud(id);
  } else updateSyncStatus("オフライン：端末に保存・同期待ち");
};
async function mutate(work) {
  if (busy) return;
  busy = true;
  const userAtStart = activeUserId;
  try {
    await work();
    if (userAtStart === activeUserId) {
      if (activeUserId) reloadLocal();
      else reloadGuest();
      scheduleSync();
    }
  } catch (error) {
    reportError(error);
    try {
      if (userAtStart === activeUserId) {
        if (activeUserId) reloadLocal();
        else reloadGuest();
      }
    } catch (e) {
      reportError(e);
    }
  } finally {
    busy = false;
  }
}
function renderAll() {
  renderCategories();
  renderCategoryFilter();
  renderTasks();
}
function formatCompletedAt(value) {
  if (!value) return "";
  const d = new Date(value);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString("ja-JP", {
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
      });
}

// Navigation and filters: each view remembers its own settings.
for (const b of tabButtons)
  b.addEventListener("click", () => {
    currentView = b.dataset.view;
    restoreViewSettings();
    saveSettings();
    renderTasks();
  });
categoryFilter.addEventListener("change", () => {
  selectedCategory = categoryFilter.value;
  rememberViewSettings();
  renderTasks();
});
statusFilter.addEventListener("change", () => {
  selectedStatus = statusFilter.value;
  rememberViewSettings();
  renderTasks();
});
dateFilter.addEventListener("change", () => {
  selectedDateFilter = dateFilter.value;
  rememberViewSettings();
  renderTasks();
});
sortSelect.addEventListener("change", () => {
  currentSort = sortSelect.value;
  rememberViewSettings();
  renderTasks();
});
completedLast.checked = localStorage.getItem("completedLast") === "true";
completedLast.addEventListener("change", () => {
  localStorage.setItem("completedLast", String(completedLast.checked));
  renderTasks();
});
function matchesFilters(t) {
  if (currentView === "inbox") return !t.category && !t.completed;
  if (currentView === "organized" && (!t.category || t.completed)) return false;
  if (selectedCategory !== "all" && (t.category || "") !== selectedCategory)
    return false;
  if (currentView === "all") {
    if (selectedStatus === "active" && t.completed) return false;
    if (selectedStatus === "completed" && !t.completed) return false;
  }
  if (selectedDateFilter === "today" && t.date !== today()) return false;
  if (selectedDateFilter === "overdue" && !isOverdue(t)) return false;
  return true;
}
function overdueTargets() {
  return tasks.filter((t) => isOverdue(t) && matchesFilters(t));
}
function resetFiltersForNewTask() {
  currentView = "inbox";
  restoreViewSettings();
  saveSettings();
}

// Task creation
taskForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const title = taskInput.value.trim();
  if (!title) return;
  let success = false;
  await mutate(async () => {
    const t = {
      id: crypto.randomUUID(),
      title,
      completed: false,
      completedAt: null,
      category: "",
      date: "",
      time: "",
      organized: false,
      priority: 4,
      repeat: "none",
      repeatAnchor: "",
      sourceTaskId: null,
      generatedNextId: null,
    };
    ensureResult(await client().from("tasks").insert(taskRow(t)));
    success = true;
  });
  if (success) {
    resetFiltersForNewTask();
    renderTasks();
    taskInput.value = "";
    taskInput.focus();
  }
});
// Category management. Category table is assumed to have id, user_id, name, created_at.
categoryForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const name = categoryInput.value.trim();
  if (!name) return;
  if (categories.includes(name)) {
    alert("同じ名前のカテゴリーが存在します");
    return;
  }
  let success = false;
  await mutate(async () => {
    ensureResult(await client().from("categories").insert(categoryRow(name)));
    success = true;
  });
  if (success) categoryInput.value = "";
});
function renderCategories() {
  categoryList.replaceChildren();
  for (const category of categories) {
    const li = document.createElement("li");
    li.className = "category-item";
    const label = document.createElement("span");
    label.className = "category-name";
    label.textContent = category;
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.textContent = "編集";
    edit.addEventListener("click", async () => {
      const input = prompt("カテゴリー名を変更", category);
      if (input === null) return;
      const name = input.trim();
      if (!name || name === category) return;
      if (categories.includes(name)) {
        alert("同じ名前のカテゴリーが存在します");
        return;
      }
      await mutate(async () => {
        // Update tasks first; if category update fails, reload will reflect server state.
        ensureResult(
          await client()
            .from("tasks")
            .update({ category: name, organized: true })
            .eq("user_id", activeUserId)
            .eq("category", category),
        );
        ensureResult(
          await client()
            .from("categories")
            .update({ name })
            .eq("user_id", activeUserId)
            .eq("name", category),
        );
        if (selectedCategory === category) selectedCategory = name;
        for (const v of Object.values(viewSettings))
          if (v.category === category) v.category = name;
        rememberViewSettings();
      });
    });
    const del = document.createElement("button");
    del.className = "delete-button";
    del.textContent = "削除";
    del.addEventListener("click", async () => {
      if (!confirm("このカテゴリーを削除しますか？")) return;
      await mutate(async () => {
        ensureResult(
          await client()
            .from("tasks")
            .update({ category: "", organized: false })
            .eq("user_id", activeUserId)
            .eq("category", category),
        );
        ensureResult(
          await client()
            .from("categories")
            .delete()
            .eq("user_id", activeUserId)
            .eq("name", category),
        );
        if (selectedCategory === category) selectedCategory = "all";
        for (const v of Object.values(viewSettings))
          if (v.category === category) v.category = "all";
        rememberViewSettings();
      });
    });
    li.append(label, edit, del);
    categoryList.append(li);
  }
}
function renderCategoryFilter() {
  categoryFilter.replaceChildren();
  for (const [value, label] of [
    ["all", "すべてのカテゴリー"],
    ["", "未分類"],
    ...categories.map((x) => [x, x]),
  ]) {
    const opt = document.createElement("option");
    opt.value = value;
    opt.textContent = label;
    categoryFilter.append(opt);
  }
  if (![...categoryFilter.options].some((o) => o.value === selectedCategory))
    selectedCategory = "all";
  categoryFilter.value = selectedCategory;
}
moveOverdueButton.addEventListener("click", async () => {
  const targets = overdueTargets();
  if (!targets.length) {
    alert("変更できる期限超過タスクはありません。");
    return;
  }
  if (
    !confirm(
      `${targets.length}件の期限超過タスクを今日の日付に変更しますか？\n※設定時刻は変更されません。`,
    )
  )
    return;
  const date = today();
  let success = false;
  await mutate(async () => {
    for (const t of targets) {
      const patch = { date };
      if (getRepeat(t) === "weekly" || getRepeat(t) === "monthly")
        patch.repeat_anchor = date;
      ensureResult(
        await client()
          .from("tasks")
          .update(patch)
          .eq("id", t.id)
          .eq("user_id", activeUserId),
      );
    }
    success = true;
  });
  if (success)
    alert(
      `${targets.length}件のタスクを変更しました。設定時刻が過ぎている場合、今日でも期限超過表示が残ります。`,
    );
});
// Routine completion: create child first, then mark parent. Retrying will not create duplicates.
async function completeTask(t) {
  const db = client(),
    patch = { completed: true, completed_at: new Date().toISOString() };
  if (getRepeat(t) !== "none" && t.date && !t.generatedNextId) {
    const existing = ensureResult(
      await db
        .from("tasks")
        .select("id")
        .eq("user_id", activeUserId)
        .eq("source_task_id", t.id)
        .limit(1),
    );
    let nextId = existing[0]?.id || null;
    if (!nextId) {
      const current = today(),
        overdueBeforeToday = t.date < current;
      let nextDate;
      if (overdueBeforeToday && isScheduledDate(t, current)) {
        const makeToday = confirm(
          "このルーティンは期限超過しています。\n当日分を作成しますか？\n\nOK：今日の分を作成\nキャンセル：今日を飛ばして次回分を作成",
        );
        nextDate = makeToday ? current : nextScheduledDate(t, current);
      } else
        nextDate = nextScheduledDate(t, t.date < current ? current : t.date);
      if (nextDate) {
        nextId = crypto.randomUUID();
        const next = {
          id: nextId,
          title: t.title,
          completed: false,
          completedAt: null,
          category: t.category,
          date: nextDate,
          time: t.time,
          organized: !!t.category,
          priority: Number(t.priority) || 4,
          repeat: getRepeat(t),
          repeatAnchor: getAnchor(t),
          sourceTaskId: t.id,
          generatedNextId: null,
        };
        ensureResult(await db.from("tasks").insert(taskRow(next)));
      }
    }
    if (nextId) patch.generated_next_id = nextId;
  }
  ensureResult(
    await db
      .from("tasks")
      .update(patch)
      .eq("id", t.id)
      .eq("user_id", activeUserId),
  );
}
function renderTasks() {
  taskList.replaceChildren();
  viewTitle.textContent = {
    inbox: "Inbox",
    organized: "タスク一覧",
    all: "すべてのタスク",
  }[currentView];
  const visible = tasks.filter(matchesFilters);
  if (currentView !== "inbox" && currentSort !== "created")
    visible.sort((a, b) => {
      if (currentSort === "completedAt") {
        if (a.completed !== b.completed) return a.completed ? -1 : 1;
        if (a.completed && b.completed) {
          const byCompletion = (b.completedAt || "").localeCompare(
            a.completedAt || "",
          );
          if (byCompletion) return byCompletion;
        }
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      }
      if (currentSort === "priority") {
        const difference =
          (Number(a.priority) || 4) - (Number(b.priority) || 4);
        if (difference) return difference;
      }
      const x = getDeadline(a),
        y = getDeadline(b);
      if (x === null && y === null) return 0;
      if (x === null) return 1;
      if (y === null) return -1;
      return currentSort === "dateDesc"
        ? y.localeCompare(x)
        : x.localeCompare(y);
    });
  if (
    currentView === "all" &&
    completedLast.checked &&
    currentSort !== "completedAt"
  )
    visible.sort((a, b) => Number(a.completed) - Number(b.completed));
  const completed = visible.filter((t) => t.completed).length;
  taskCount.textContent = `表示中：${visible.length}件（完了：${completed}件）`;
  const overdue = overdueTargets();
  bulkActions.hidden = selectedDateFilter !== "overdue" || !overdue.length;
  moveOverdueButton.textContent = `${overdue.length}件の期限超過タスクを今日に変更`;
  for (const t of visible) {
    const li = document.createElement("li");
    li.className = "task-item";
    if (isOverdue(t)) li.classList.add("overdue");
    const check = document.createElement("input");
    check.type = "checkbox";
    check.checked = t.completed;
    check.className = "task-checkbox";
    check.addEventListener("change", async () => {
      if (
        t.completed &&
        !check.checked &&
        !confirm(
          "未完了に切り替えます。よろしいですか？\n※記録されている完了日時は削除されます。",
        )
      ) {
        check.checked = true;
        return;
      }
      await mutate(async () => {
        if (!t.completed && check.checked) await completeTask(t);
        else
          ensureResult(
            await client()
              .from("tasks")
              .update({ completed: false, completed_at: null })
              .eq("id", t.id)
              .eq("user_id", activeUserId),
          );
      });
    });
    const info = document.createElement("div");
    info.className = "task-info";
    const title = document.createElement("span");
    title.className = "task-title";
    title.textContent = t.title;
    if (t.completed) title.classList.add("completed");
    const details = document.createElement("div");
    details.className = "task-details";
    const tag = (value, cls) => {
      if (!value) return;
      const el = document.createElement("span");
      el.textContent = value;
      if (cls) el.className = cls;
      details.append(el);
    };
    [t.category, t.date, t.time].forEach((x) => tag(x));
    if (getRepeat(t) !== "none")
      tag("🔁 " + repeatLabels[getRepeat(t)], "repeat-label");
    if (isOverdue(t)) tag("期限切れ", "overdue-label");
    if (t.completed && t.completedAt)
      tag("完了：" + formatCompletedAt(t.completedAt), "completed-date");
    if ((Number(t.priority) || 4) < 4) {
      const flag = document.createElement("span");
      flag.className = "priority-flag priority-p" + t.priority;
      flag.textContent = "⚑ P" + t.priority;
      flag.title = "優先度 P" + t.priority;
      details.prepend(flag);
    }
    info.append(title, details);
    const edit = document.createElement("button");
    edit.className = "edit-button";
    edit.textContent = "編集";
    edit.addEventListener("click", () => openEditor(t));
    const del = document.createElement("button");
    del.className = "delete-button";
    del.textContent = "削除";
    del.addEventListener("click", () => {
      if (confirm("このタスクを削除しますか？"))
        mutate(async () =>
          ensureResult(
            await client()
              .from("tasks")
              .delete()
              .eq("id", t.id)
              .eq("user_id", activeUserId),
          ),
        );
    });
    li.append(check, info, edit, del);
    taskList.append(li);
  }
}
function openEditor(t) {
  editingTaskId = t.id;
  editCategory.replaceChildren();
  for (const [value, label] of [
    ["", "未分類"],
    ...categories.map((x) => [x, x]),
  ]) {
    const o = document.createElement("option");
    o.value = value;
    o.textContent = label;
    editCategory.append(o);
  }
  editTitle.value = t.title;
  editCategory.value = t.category || "";
  editDate.value = t.date || "";
  editTime.value = t.time || "";
  editRepeat.value = getRepeat(t);
  editPriority.value = String(Number(t.priority) || 4);
  editOverlay.hidden = false;
  editTitle.focus();
}
function closeEditor() {
  editOverlay.hidden = true;
  editingTaskId = null;
}
editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const t = tasks.find((x) => x.id === editingTaskId);
  if (!t) return;
  const title = editTitle.value.trim(),
    repeat = editRepeat.value,
    date = editDate.value;
  if (!title) return;
  if (repeat !== "none" && !date) {
    alert("ルーティンを設定する場合は日付も指定してください。");
    return;
  }
  const anchor =
    repeat === "none"
      ? null
      : getRepeat(t) !== repeat || t.date !== date || !t.repeatAnchor
        ? date
        : t.repeatAnchor;
  let success = false;
  await mutate(async () => {
    ensureResult(
      await client()
        .from("tasks")
        .update({
          title,
          category: editCategory.value,
          organized: !!editCategory.value,
          priority: Number(editPriority.value),
          date: date || null,
          time: editTime.value || null,
          repeat,
          repeat_anchor: anchor,
        })
        .eq("id", t.id)
        .eq("user_id", activeUserId),
    );
    success = true;
  });
  if (success) closeEditor();
});
$("closeEditButton").addEventListener("click", closeEditor);
$("cancelEditButton").addEventListener("click", closeEditor);
editOverlay.addEventListener("click", (e) => {
  if (e.target === editOverlay) closeEditor();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !editOverlay.hidden) closeEditor();
});
clearCompletedButton.addEventListener("click", async () => {
  const completed = tasks.filter((t) => t.completed);
  if (!completed.length) {
    alert("削除する完了済みタスクはありません。");
    return;
  }
  if (
    !confirm(
      `${completed.length}件の完了済みタスクをすべて削除しますか？\nこの操作は元に戻せません。`,
    )
  )
    return;
  await mutate(async () => {
    // Delete in batches so requests do not become excessively large.
    for (let i = 0; i < completed.length; i += 100) {
      const ids = completed.slice(i, i + 100).map((t) => t.id);
      ensureResult(
        await client()
          .from("tasks")
          .delete()
          .eq("user_id", activeUserId)
          .in("id", ids),
      );
    }
  });
});
restoreViewSettings();
renderAll();
