(() => {
  const $ = (id) => document.getElementById(id);

  function tokenHeader() {
    const t = $('token').value.trim();
    return {
      'Content-Type': 'application/json',
      'X-Admin-Token': t,
    };
  }

  async function api(path, body, method = 'POST') {
    const res = await fetch(`/admin/api${path}`, {
      method,
      headers: tokenHeader(),
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.json();
  }

  // ====== 統計 ======
  async function loadStats() {
    const r = await api('/stats', null, 'GET');
    if (r?.ok) {
      $('stats').innerHTML =
        `總數：<b>${r.total}</b>　` +
        `preorder：<b>${r.preorder}</b>　` +
        `active：<b>${r.active}</b>`;
    } else {
      $('stats').innerHTML = `<span class="err">${r?.error || '讀取失敗'}</span>`;
    }
  }

  // ====== 單筆新增 ======
  async function addOne() {
    const handle = $('add_handle').value.trim();
    const wechat = $('add_wechat').value.trim();
    const email  = $('add_email').value.trim();
    if (!handle) {
      $('add_msg').innerHTML = `<span class="err">handle 必填</span>`;
      return;
    }
    const r = await api('/preorder/add', { handle, wechat, email });
    $('add_msg').innerHTML = r.ok
      ? `<span class="ok">OK：新增 ${r.handle}</span>`
      : `<span class="err">${r.error || '新增失敗'}</span>`;
    if (r.ok) loadStats();
  }

  // ====== 批量新增 ======
  async function bulkImport() {
    const lines = $('bulk_text').value.split('\n').map(s => s.trim()).filter(Boolean);
    if (!lines.length) {
      $('bulk_msg').innerHTML = `<span class="err">沒有可匯入的內容</span>`;
      return;
    }
    const r = await api('/preorder/bulk', { lines });
    if (r?.ok) {
      $('bulk_msg').innerHTML =
        `<span class="ok">Imported: ${r.imported}，Skipped: ${r.skipped}</span>`;
      loadStats();
    } else {
      $('bulk_msg').innerHTML = `<span class="err">${r?.error || '匯入失敗'}</span>`;
    }
  }

  // ====== 查詢/列表 ======
  async function search() {
    const q = $('q').value.trim();
    const status = $('q_status').value;
    const limit  = Number($('q_limit').value) || 50;

    const r = await api('/preorder/search', { q, status, limit });
    if (!r?.ok) {
      $('list_wrap').innerHTML = `<span class="err">${r?.error || '搜尋失敗'}</span>`;
      return;
    }

    if (!r.items?.length) {
      $('list_wrap').innerHTML = `<div>無資料</div>`;
      return;
    }

    const rows = r.items.map(u => `
      <tr>
        <td>${u.handle}</td>
        <td>${u.wechat_id || ''}</td>
        <td>${u.email || ''}</td>
        <td>${u.status}</td>
        <td class="right">
          <button data-act="activate" data-h="${u.handle}">啟用</button>
          <button data-act="del" data-h="${u.handle}">刪</button>
        </td>
      </tr>
    `).join('');

    $('list_wrap').innerHTML = `
      <table>
        <thead><tr><th>handle</th><th>wechat</th><th>email</th><th>status</th><th></th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    `;

    $('list_wrap').querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const act = e.currentTarget.dataset.act;
        const h   = e.currentTarget.dataset.h;
        if (act === 'activate') {
          const rr = await api('/member/activate', { identifier: h });
          alert(rr.ok ? 'OK：已啟用' : (rr.error || '失敗'));
        } else if (act === 'del') {
          if (!confirm(`確定刪除 ${h} ?`)) return;
          const rr = await api('/preorder/delete', { handle: h });
          alert(rr.ok ? 'OK：已刪除' : (rr.error || '失敗'));
        }
        search(); loadStats();
      });
    });
  }

  // ====== 測試 / 啟用 / 重設密碼 / Login 檢查 ======
  async function activate() {
    const id = $('test_id').value.trim();
    if (!id) return;
    const r = await api('/member/activate', { identifier: id });
    $('test_msg').innerHTML = r.ok ? `<span class="ok">OK：已啟用</span>`
                                   : `<span class="err">${r.error || '失敗'}</span>`;
  }

  async function resetPass() {
    const id = $('test_id').value.trim();
    const password = $('test_pass').value.trim();
    if (!id || !password) return;
    const r = await api('/member/reset-password', { identifier: id, new_password: password });
    $('test_msg').innerHTML = r.ok ? `<span class="ok">OK：已重設</span>`
                                   : `<span class="err">${r.error || '失敗'}</span>`;
  }

  async function loginCheck() {
    const id = $('test_id').value.trim();
    if (!id) return;
    const r = await api('/debug/login-check', { identifier: id });
    $('test_msg').innerHTML = r.ok
      ? `<span class="ok">found: ${r.found ? 'true' : 'false'}，user: ${r.user?.handle || ''}</span>`
      : `<span class="err">${r.error || '失敗'}</span>`;
  }

  // 綁定
  function bind() {
    $('btn_stats').addEventListener('click', loadStats);
    $('btn_add').addEventListener('click', addOne);
    $('btn_bulk').addEventListener('click', bulkImport);
    $('btn_search').addEventListener('click', search);
    $('btn_activate').addEventListener('click', activate);
    $('btn_reset').addEventListener('click', resetPass);
    $('btn_login_check').addEventListener('click', loginCheck);
  }

  // init
  bind();
})();
