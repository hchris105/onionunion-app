let TOKEN = "";

document.getElementById("btnLogin").onclick = async () => {
  const email = document.getElementById("email").value.trim();
  const password = document.getElementById("pass").value;
  const r = await fetch("/auth/login", {
    method: "POST",
    headers: { "Content-Type":"application/json" },
    body: JSON.stringify({ email, password })
  });
  const j = await r.json();
  if (j.ok && j.token) {
    TOKEN = j.token;
    document.getElementById("loginMsg").textContent = "登入成功";
  } else {
    document.getElementById("loginMsg").textContent = JSON.stringify(j);
  }
};

document.getElementById("btnImport").onclick = async () => {
  if (!TOKEN) { alert("請先登入"); return; }
  const txt = document.getElementById("handles").value;
  const r = await fetch("/admin/api/whitelist/import", {
    method: "POST",
    headers: {
      "Content-Type":"text/plain; charset=utf-8",
      "Authorization": "Bearer " + TOKEN
    },
    body: txt
  });
  const j = await r.json();
  document.getElementById("importMsg").textContent = JSON.stringify(j, null, 2);
};
