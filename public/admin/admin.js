// public/admin/admin.js
(() => {
  const $  = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const qs = (obj) => new URLSearchParams(obj).toString();

  const state = {
    token: localStorage.getItem("ou_admin_token") || "",
    page: 1,
    limit: 20,
    q: "",
    status: "all",
    role: "all",
    items: [],
    total: 0,
  };

  const el = {
    token: $("#admin-token-input") || { value: "" },
    btnApply: $("#btn-apply-token"),
    tableBody: $("#tbl-body"),
    pagerPrev: $("#btn-prev"),
    pagerNext: $("#btn-next"),
    selLimit: $("#sel-limit"),
    selStatus: $("#sel-status"),
    selRole: $("#sel-role"),
    txtSearch: $("#txt-search"),
    btnSearch: $("#btn-search"),
    btnReload: $("#btn-reload"),
  };

  if (el.token) el.token.value = state.token;

  function headers() {
    const h = { "Content-Type": "application/json" };
    if (state.token) h["X-Admin-Token"] = state.token;
    return h;
  }

  async function listUsers() {
    const url = `/admin/api/users?${qs({
      q: state.q, status: state.status, role: state.role,
      page: state.page, limit: state.limit,
      sort: "createdAt", order: "desc",
    })}`;
    const r = await fetch(url, { headers: headers() });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) {
      el.tableBody.innerHTML =
        `<tr><td colspan="8" style="color:#f88">Error: ${j.error || r.status}</td></tr>`;
      return;
    }
    state.items = j.items || [];
    state.total = j.total || 0;
    renderTable();
  }

  function renderTable() {
    if (!state.items.length) {
      el.tableBody.innerHTML = `<tr><td colspan="8" style="opacity:.7">（沒有資料）</td></tr>`;
      return;
    }
    el.tableBody.innerHTML = state.items.map(u => {
      const wechat = u.wechat_id || "-";
      const nickname = u.nickname || "-";
      const role = (u.roles || []).join(", ") || "-";
      const status = u.status || "-";
      const created = u.createdAt ? new Date(u.createdAt).toLocaleString() : "-";
      return `
        <tr data-id="${u._id}">
          <td class="cell-handle">${u.handle || "-"}</td>
          <td>${nickname}</td>
          <td>${u.email || "-"}</td>
          <td>${wechat}</td>
          <td><span class="badge">${status}</span></td>
          <td>${role}</td>
          <td>${created}</td>
          <td><button class="btn-edit" data-id="${u._id}">編輯</button></td>
        </tr>`;
    }).join("");

    $$(".btn-edit").forEach(b => b.addEventListener("click", e => openEditor(e.target.dataset.id)));
  }

  async function openEditor(id) {
    const r = await fetch(`/admin/api/users/${id}`, { headers: headers() });
    const j = await r.json().catch(() => ({}));
    if (!j.ok) return toast(`取得資料失敗：${j.error || r.status}`);
    const u = j.item;

    const nickname = prompt("暱稱（可留空）", u.nickname || "");
    if (nickname === null) return;

    const r2 = await fetch(`/admin/api/users/${u._id}`, {
      method: "PATCH",
      headers: headers(),
      body: JSON.stringify({ nickname }),
    });
    const j2 = await r2.json().catch(() => ({}));
    if (!j2.ok) return toast(`更新失敗：${j2.error || r2.status}`);
    toast("已更新");
    listUsers();
  }

  function toast(msg) { console.log("[Admin]", msg); }

  // 綁定 UI
  el.btnApply?.addEventListener("click", () => {
    state.token = (el.token?.value || "").trim();
    localStorage.setItem("ou_admin_token", state.token);
    listUsers();
  });
  el.btnReload?.addEventListener("click", () => listUsers());
  el.btnSearch?.addEventListener("click", () => {
    state.q = (el.txtSearch?.value || "").trim();
    state.page = 1;
    listUsers();
  });
  el.selLimit?.addEventListener("change", () => {
    state.limit = parseInt(el.selLimit.value) || 20;
    listUsers();
  });
  el.selStatus?.addEventListener("change", () => {
    state.status = el.selStatus.value || "all";
    state.page = 1;
    listUsers();
  });
  el.selRole?.addEventListener("change", () => {
    state.role = el.selRole.value || "all";
    state.page = 1;
    listUsers();
  });
  el.pagerPrev?.addEventListener("click", () => {
    if (state.page > 1) { state.page -= 1; listUsers(); }
  });
  el.pagerNext?.addEventListener("click", () => {
    const maxPage = Math.ceil(state.total / state.limit) || 1;
    if (state.page < maxPage) { state.page += 1; listUsers(); }
  });

  listUsers();
})();

