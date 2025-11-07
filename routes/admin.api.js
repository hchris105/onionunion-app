// admin.api.js
export const AdminAPI = {
  async load() {
    const r = await fetch("/admin/data");
    return r.json();
  },
  async save(payload) {
    const r = await fetch("/admin/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    return r.json();
  },
  async test(body) {
    const r = await fetch("/admin/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });
    return r.json();
  },
  async rebuild() {
    const r = await fetch("/admin/rebuild-kb", { method: "POST" });
    return r.json();
  }
};
