// Stage 5: shared categories use live Supabase only. Never put other users' tasks in localStorage.
(() => {
  const db = window.supabaseClient;
  const section = document.getElementById("sharedSection");
  const container = document.getElementById("sharedCategories");
  const status = document.getElementById("sharedStatus");
  let epoch = 0;
  let sharedCategories = [];
  let sharedTasks = [];
  const sharedKey = (c) => "shared:" + c.id;
  window.getSharedCategoryOptions = () =>
    [...sharedCategories]
      .filter(
        () =>
          !(
            currentView === "organized" &&
            document.getElementById("excludeShared")?.checked
          ),
      )
      .sort(
        (a, b) =>
          (a.role === "editor" ? 0 : 1) - (b.role === "editor" ? 0 : 1) ||
          a.name.localeCompare(b.name, "ja"),
      )
      .map((c) => [
        sharedKey(c),
        `【${c.role === "editor" ? "共同編集" : "閲覧のみ"}】${c.name}`,
      ]);
  window.getSharedTaskRows = () => sharedTasks.map((t) => ({ ...t }));
  window.updateSharedSectionVisibility = () => {
    section.hidden =
      currentView !== "all" || !navigator.onLine || !sharedCategories.length;
  };
  function updateIntegratedList() {
    window.updateSharedSectionVisibility();
    renderCategoryFilter();
    renderTasks();
  }
  function sharedToTask(row, category) {
    return {
      id: row.id,
      title: row.title,
      completed: !!row.completed,
      completedAt: row.completed_at,
      category: category.name,
      date: row.date || "",
      time: row.time || "",
      repeat: row.repeat || "none",
      repeatAnchor: row.repeat_anchor || "",
      priority: Number(row.priority) || 4,
      createdAt: row.created_at || "",
      generatedNextId: row.generated_next_id,
      _shared: { category, role: category.role, ownerId: category.user_id },
    };
  }
  async function refreshSharedRows() {
    const snapshot = epoch;
    const result = [];
    for (const category of sharedCategories) {
      const rows = unwrap(
        await db
          .from("tasks")
          .select("*")
          .eq("user_id", category.user_id)
          .eq("category_id", category.id)
          .order("created_at", { ascending: true })
          .limit(1000),
      );
      result.push(...rows.map((row) => sharedToTask(row, category)));
    }
    if (snapshot !== epoch || !activeUserId) return;
    sharedTasks = result;
    updateIntegratedList();
  }
  async function refreshAfterChange() {
    await refreshSharedRows();
    if (currentView === "all") await window.refreshSharedPanel();
  }
  function assertEditor(t) {
    requireOnline();
    if (t._shared?.role !== "editor") throw new Error("編集権限がありません");
  }
  window.deleteSharedTask = async (t) => {
    assertEditor(t);
    unwrap(
      await db
        .from("tasks")
        .delete()
        .eq("id", t.id)
        .eq("user_id", t._shared.ownerId)
        .eq("category_id", t._shared.category.id),
    );
    await refreshAfterChange();
  };
  window.updateSharedTaskCompletion = async (t, completed) => {
    assertEditor(t);
    if (completed && getRepeat(t) !== "none" && t.date && !t.generatedNextId) {
      const existing = unwrap(
        await db
          .from("tasks")
          .select("id")
          .eq("user_id", t._shared.ownerId)
          .eq("source_task_id", t.id)
          .limit(1),
      );
      let nextId = existing[0]?.id;
      if (!nextId) {
        const base = t.date < today() ? today() : t.date;
        const nextDate = nextScheduledDate(t, base);
        if (nextDate) {
          nextId = crypto.randomUUID();
          unwrap(
            await db.from("tasks").insert({
              id: nextId,
              user_id: t._shared.ownerId,
              category_id: t._shared.category.id,
              category: t._shared.category.name,
              title: t.title,
              date: nextDate,
              time: t.time || null,
              priority: t.priority,
              repeat: getRepeat(t),
              repeat_anchor: getAnchor(t),
              source_task_id: t.id,
              completed: false,
              organized: true,
            }),
          );
        }
      }
      const patch = { completed: true, completed_at: new Date().toISOString() };
      if (nextId) patch.generated_next_id = nextId;
      unwrap(
        await db
          .from("tasks")
          .update(patch)
          .eq("id", t.id)
          .eq("user_id", t._shared.ownerId)
          .eq("category_id", t._shared.category.id),
      );
    } else {
      unwrap(
        await db
          .from("tasks")
          .update({
            completed,
            completed_at: completed ? new Date().toISOString() : null,
          })
          .eq("id", t.id)
          .eq("user_id", t._shared.ownerId)
          .eq("category_id", t._shared.category.id),
      );
    }
    await refreshAfterChange();
  };
  window.openSharedTaskEditor = (t) => {
    assertEditor(t);
    document.getElementById("sharedEditOverlay")?.remove();
    const overlay = el("div", undefined, "edit-overlay");
    overlay.id = "sharedEditOverlay";
    const panel = el("div", undefined, "edit-panel shared-edit-panel");
    panel.append(el("h2", "共有タスクを編集"));
    const form = el("form");
    form.className = "shared-edit-form";
    const field = (label, input) => {
      const wrap = el("label", undefined, "shared-edit-field");
      wrap.append(el("span", label), input);
      form.append(wrap);
      return input;
    };
    const title = field("タスク名", textInput(t.title));
    title.required = true;
    const category = field(
      "カテゴリー（変更不可）",
      textInput(t._shared.category.name),
    );
    category.disabled = true;
    const priority = document.createElement("select");
    for (const [value, label] of [
      ["1", "P1：超重要"],
      ["2", "P2：重要"],
      ["3", "P3：やや重要"],
      ["4", "P4：通常"],
    ]) {
      const option = el("option", label);
      option.value = value;
      priority.append(option);
    }
    priority.value = String(t.priority);
    field("優先度", priority);
    const date = document.createElement("input");
    date.type = "date";
    date.value = t.date || "";
    field("日付", date);
    const time = document.createElement("input");
    time.type = "time";
    time.value = (t.time || "").slice(0, 5);
    field("時刻", time);
    const repeat = document.createElement("select");
    for (const [value, label] of Object.entries(repeatLabels)) {
      const option = el("option", label);
      option.value = value;
      repeat.append(option);
    }
    repeat.value = getRepeat(t);
    field("繰り返し", repeat);
    const actions = el("div", undefined, "edit-actions");
    const save = el("button", "保存する");
    save.type = "submit";
    const cancel = btn("キャンセル", () => overlay.remove(), "cancel-button");
    actions.append(save, cancel);
    form.append(actions);
    panel.append(form);
    overlay.append(panel);
    document.body.append(overlay);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) overlay.remove();
    });
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (!title.value.trim()) return;
      if (repeat.value !== "none" && !date.value) {
        alert("繰り返し設定には日付が必要です");
        return;
      }
      save.disabled = true;
      try {
        assertEditor(t);
        const anchor =
          repeat.value === "none"
            ? null
            : repeat.value !== getRepeat(t) ||
                date.value !== t.date ||
                !t.repeatAnchor
              ? date.value
              : t.repeatAnchor;
        unwrap(
          await db
            .from("tasks")
            .update({
              title: title.value.trim(),
              date: date.value || null,
              time: time.value || null,
              priority: Number(priority.value),
              repeat: repeat.value,
              repeat_anchor: anchor,
            })
            .eq("id", t.id)
            .eq("user_id", t._shared.ownerId)
            .eq("category_id", t._shared.category.id),
        );
        overlay.remove();
        await refreshAfterChange();
      } catch (error) {
        showError(error);
      } finally {
        save.disabled = false;
      }
    });
    title.focus();
  };
  const errorText = (e) => e?.message || String(e);
  const unwrap = (r) => {
    if (r.error) throw r.error;
    return r.data;
  };
  const el = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const btn = (text, fn, className) => {
    const b = el("button", text, className);
    b.type = "button";
    b.addEventListener("click", fn);
    return b;
  };
  const requireOnline = () => {
    if (!navigator.onLine)
      throw new Error("共有機能はオンライン時のみ使用できます");
  };
  async function currentUser() {
    const { data, error } = await db.auth.getUser();
    if (error) throw error;
    return data.user;
  }
  function showError(e) {
    alert("共有機能のエラー：" + errorText(e));
  }
  window.clearSharedData = () => {
    ++epoch;
    section.hidden = true;
    container.replaceChildren();
    status.textContent = "";
    sharedCategories = [];
    sharedTasks = [];
    updateIntegratedList();
  };
  window.renderShareButtons = () => {
    document.querySelectorAll("#categoryList .category-item").forEach((li) => {
      if (li.querySelector(".share-settings-button")) return;
      const name = li.querySelector(".category-name")?.textContent;
      const category =
        window.categoryRecords?.find?.((r) => r.name === name) ||
        (typeof categoryRecords !== "undefined"
          ? categoryRecords.find((r) => r.name === name)
          : null);
      if (!category || !activeUserId) return;
      li.append(
        btn("共有", () => openShareDialog(category), "share-settings-button"),
      );
    });
  };
  async function openShareDialog(category) {
    try {
      requireOnline();
      const user = await currentUser();
      if (!user || user.id !== category.user_id)
        throw new Error("所有者のみ共有設定できます");
      let overlay = document.getElementById("shareOverlay");
      if (overlay) overlay.remove();
      overlay = el("div", undefined, "edit-overlay");
      overlay.id = "shareOverlay";
      const panel = el("div", undefined, "edit-panel share-dialog");
      panel.append(el("h2", `「${category.name}」の共有`));
      panel.append(
        el(
          "p",
          "相手は登録・メール認証済みのアカウントである必要があります。",
          "repeat-hint",
        ),
      );
      const form = el("form");
      form.className = "share-invite-form";
      const email = document.createElement("input");
      email.type = "email";
      email.placeholder = "招待先メールアドレス";
      email.required = true;
      const role = document.createElement("select");
      for (const [value, label] of [
        ["viewer", "閲覧のみ"],
        ["editor", "共同編集"],
      ]) {
        const o = el("option", label);
        o.value = value;
        role.append(o);
      }
      const submit = el("button", "招待・権限更新");
      submit.type = "submit";
      form.append(email, role, submit);
      panel.append(form);
      const memberTitle = el("h3", "共有メンバー");
      panel.append(memberTitle);
      const members = el("div");
      panel.append(members);
      panel.append(btn("閉じる", () => overlay.remove(), "cancel-button"));
      overlay.append(panel);
      document.body.append(overlay);
      overlay.addEventListener("click", (e) => {
        if (e.target === overlay) overlay.remove();
      });
      async function loadMembers() {
        const rows = unwrap(
          await db.rpc("my_tasks_share_members", { p_category: category.id }),
        );
        members.replaceChildren();
        if (!rows.length) members.append(el("p", "まだ共有していません。"));
        for (const m of rows) {
          const row = el("div", undefined, "share-member");
          row.append(
            el(
              "span",
              `${m.email}（${m.role === "editor" ? "共同編集" : "閲覧のみ"}）`,
            ),
          );
          row.append(
            btn(
              "解除",
              async () => {
                if (!confirm(`${m.email} の共有を解除しますか？`)) return;
                try {
                  requireOnline();
                  unwrap(
                    await db
                      .from("category_shares")
                      .delete()
                      .eq("id", m.share_id),
                  );
                  await loadMembers();
                } catch (e) {
                  showError(e);
                }
              },
              "delete-button",
            ),
          );
          members.append(row);
        }
      }
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          requireOnline();
          unwrap(
            await db.rpc("my_tasks_invite_by_email", {
              p_category: category.id,
              p_email: email.value.trim(),
              p_role: role.value,
            }),
          );
          email.value = "";
          await loadMembers();
          alert("共有設定を保存しました。相手がログインすると表示されます。");
        } catch (err) {
          showError(err);
        } finally {
          submit.disabled = false;
        }
      });
      await loadMembers();
    } catch (e) {
      showError(e);
    }
  }
  const textInput = (value, type = "text") => {
    const input = document.createElement("input");
    input.type = type;
    input.value = value ?? "";
    return input;
  };
  async function loadSharedTasks(card, category, role, ownerId) {
    requireOnline();
    const tasks = unwrap(
      await db
        .from("tasks")
        .select("*")
        .eq("user_id", ownerId)
        .eq("category_id", category.id)
        .order("created_at", { ascending: true })
        .limit(1000),
    );
    const area = card.querySelector(".share-tasks");
    area.replaceChildren();
    const sorter = card.querySelector(".share-sort-select");
    const sortMode = sorter?.value || "dateAsc";
    const dateKey = (t) => t.date || "9999-12-31";
    tasks.sort((a, b) => {
      if (sortMode === "dateAsc") {
        if (!a.date && b.date) return 1;
        if (a.date && !b.date) return -1;
        const cmp = dateKey(a).localeCompare(dateKey(b));
        if (cmp) return cmp;
      } else if (sortMode === "priority") {
        const cmp = (Number(a.priority) || 4) - (Number(b.priority) || 4);
        if (cmp) return cmp;
      }
      return String(a.created_at || "").localeCompare(
        String(b.created_at || ""),
      );
    });
    const writable = role === "editor";
    if (writable) {
      const form = el("form");
      form.className = "share-task-form";
      const input = textInput("");
      input.placeholder = "共有タスクを追加";
      input.required = true;
      const add = el("button", "追加");
      add.type = "submit";
      form.append(input, add);
      area.append(form);
      form.addEventListener("submit", async (e) => {
        e.preventDefault();
        add.disabled = true;
        try {
          requireOnline();
          unwrap(
            await db.from("tasks").insert({
              id: crypto.randomUUID(),
              user_id: ownerId,
              title: input.value.trim(),
              category: category.name,
              category_id: category.id,
              organized: true,
              completed: false,
              priority: 4,
              repeat: "none",
            }),
          );
          await refreshAfterChange();
        } catch (err) {
          showError(err);
        } finally {
          add.disabled = false;
        }
      });
    }
    if (!tasks.length) area.append(el("p", "タスクはありません。"));
    for (const task of tasks) {
      const row = el("div", undefined, "share-task-row");
      const check = document.createElement("input");
      check.type = "checkbox";
      check.checked = !!task.completed;
      check.disabled = !writable;
      check.addEventListener("change", async () => {
        try {
          await window.updateSharedTaskCompletion(
            sharedToTask(task, { ...category, role }),
            check.checked,
          );
        } catch (e) {
          check.checked = !check.checked;
          showError(e);
        }
      });
      const info = el(
        "span",
        task.title +
          (task.date ? " · " + task.date : "") +
          (task.time ? " " + String(task.time).slice(0, 5) : ""),
        task.completed ? "share-task-done" : "",
      );
      row.append(check, info);
      if (writable) {
        row.append(
          btn(
            "編集",
            () =>
              window.openSharedTaskEditor(
                sharedToTask(task, { ...category, role }),
              ),
            "edit-button",
          ),
        );
        row.append(
          btn(
            "削除",
            async () => {
              if (!confirm("この共有タスクを削除しますか？")) return;
              try {
                requireOnline();
                unwrap(
                  await db
                    .from("tasks")
                    .delete()
                    .eq("id", task.id)
                    .eq("user_id", ownerId)
                    .eq("category_id", category.id),
                );
                await refreshAfterChange();
              } catch (e) {
                showError(e);
              }
            },
            "delete-button",
          ),
        );
      }
      area.append(row);
    }
  }
  window.refreshSharedPanel = async () => {
    const token = ++epoch;
    section.hidden = true;
    container.replaceChildren();
    status.textContent = "";
    if (!navigator.onLine || !activeUserId) {
      sharedCategories = [];
      sharedTasks = [];
      updateIntegratedList();
      return;
    }
    try {
      const user = await currentUser();
      if (!user || token !== epoch) return;
      const shares = unwrap(
        await db
          .from("category_shares")
          .select("category_id,role")
          .eq("user_id", user.id),
      );
      if (token !== epoch) return;
      if (!shares.length) {
        sharedCategories = [];
        sharedTasks = [];
        updateIntegratedList();
        return;
      }
      const ids = shares.map((s) => s.category_id);
      const categories = unwrap(
        await db.from("categories").select("id,name,user_id").in("id", ids),
      );
      if (token !== epoch) return;
      sharedCategories = categories.map((c) => ({
        ...c,
        role: shares.find((s) => s.category_id === c.id)?.role || "viewer",
      }));
      // Only categories currently shared with the signed-in user are returned by this RPC.
      const memberRows = unwrap(
        await db.rpc("my_tasks_shared_category_members"),
      );
      if (token !== epoch) return;
      const membersByCategory = new Map();
      for (const member of memberRows || []) {
        if (!membersByCategory.has(member.category_id))
          membersByCategory.set(member.category_id, []);
        membersByCategory.get(member.category_id).push(member);
      }
      await refreshSharedRows();
      if (token !== epoch) return;
      window.updateSharedSectionVisibility();
      for (const category of categories) {
        const share = shares.find((s) => s.category_id === category.id);
        const card = el("div", undefined, "share-category-card");
        const heading = el(
          "h3",
          `${category.name}（${share.role === "editor" ? "共同編集" : "閲覧のみ"}）`,
        );
        const memberList = el("div", undefined, "share-member-summary");
        const categoryMembers = membersByCategory.get(category.id) || [];
        const owner = categoryMembers.find((m) => m.member_role === "owner");
        const ownerRow = el(
          "p",
          "所有者：" + (owner?.member_email || "取得できません"),
          "share-owner-email",
        );
        memberList.append(ownerRow);
        for (const [role, label] of [
          ["viewer", "共有（閲覧のみ）"],
          ["editor", "共有（共同編集）"],
        ]) {
          const users = categoryMembers.filter((m) => m.member_role === role);
          if (!users.length) continue;
          const group = el("div", undefined, "share-member-group");
          group.append(el("p", label, "share-member-group-title"));
          for (const member of users)
            group.append(el("p", member.member_email, "share-member-email"));
          memberList.append(group);
        }
        const leave = btn(
          "共有を辞退する",
          async () => {
            if (
              !confirm(
                `「${category.name}」の共有を辞退しますか？\nこのカテゴリーの共有タスクが見られなくなります。共有元のタスクは削除されません。`,
              )
            )
              return;
            leave.disabled = true;
            try {
              requireOnline();
              const me = await currentUser();
              if (!me || me.id !== activeUserId)
                throw new Error("ログイン状態を確認してください");
              unwrap(
                await db
                  .from("category_shares")
                  .delete()
                  .eq("category_id", category.id)
                  .eq("user_id", me.id)
                  .select("id"),
              );
              // Re-fetch, rather than retaining stale shared tasks after revocation.
              await window.refreshSharedPanel();
            } catch (e) {
              showError(e);
              leave.disabled = false;
            }
          },
          "share-leave-button",
        );
        const refresh = btn("更新", () =>
          loadSharedTasks(card, category, share.role, category.user_id).catch(
            showError,
          ),
        );
        const sortLabel = el("label", "並べ替え：", "share-sort-label");
        const sortSelect = document.createElement("select");
        sortSelect.className = "share-sort-select";
        for (const [value, label] of [
          ["dateAsc", "期限が近い順"],
          ["priority", "優先度順（P1→P4）"],
        ]) {
          const option = el("option", label);
          option.value = value;
          sortSelect.append(option);
        }
        sortSelect.addEventListener("change", () =>
          loadSharedTasks(card, category, share.role, category.user_id).catch(
            showError,
          ),
        );
        sortLabel.append(sortSelect);
        card.append(
          heading,
          memberList,
          refresh,
          sortLabel,
          leave,
          el("div", undefined, "share-tasks"),
        );
        container.append(card);
        await loadSharedTasks(card, category, share.role, category.user_id);
        if (token !== epoch) {
          container.replaceChildren();
          return;
        }
      }
    } catch (e) {
      if (token === epoch) {
        window.updateSharedSectionVisibility();
        status.textContent = "共有データを取得できません：" + errorText(e);
      }
    }
  };
  window.addEventListener("online", () => window.refreshSharedPanel());
  window.addEventListener("offline", () => window.clearSharedData());
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && navigator.onLine) window.refreshSharedPanel();
  });
  window.renderShareButtons();
  window.refreshSharedPanel();
})();
