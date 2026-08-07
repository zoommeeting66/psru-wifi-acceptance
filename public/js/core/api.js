const TOKEN_KEY = "psru_wifi_token";
const USER_KEY = "psru_wifi_user";

/** แจ้งให้ชั้นหน้าจอพากลับไปหน้าเข้าสู่ระบบ โดยที่ api.js ไม่ต้องรู้จักหน้าไหนเลย */
export const SESSION_EXPIRED_EVENT = "psru:session-expired";

/**
 * @param {Response} res
 * @param {{ handle401?: boolean }} opts
 *   handle401=false ใช้กับการเข้าสู่ระบบเอง เพราะ 401 ตรงนั้นแปลว่า
 *   "ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง" ไม่ใช่ "เซสชันหมดอายุ"
 *   ถ้าเหมารวมกัน ช่างที่พิมพ์รหัสผิดจะเห็นข้อความว่าเซสชันหมดอายุ ซึ่งไม่จริงและชวนงง
 */
async function handle(res, { handle401 = true } = {}) {
  if (res.status === 401 && handle401) {
    api.logout();
    window.dispatchEvent(new CustomEvent(SESSION_EXPIRED_EVENT));
    throw Object.assign(new Error("เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่"), { status: 401 });
  }
  const isJson = (res.headers.get("content-type") || "").includes("application/json");
  const payload = isJson ? await res.json() : null;
  if (!res.ok) {
    throw Object.assign(new Error(payload?.error || "เกิดข้อผิดพลาดในการเชื่อมต่อระบบ"), { status: res.status });
  }
  return payload;
}

function authHeaders(extra = {}) {
  const token = api.token();
  return token ? { ...extra, authorization: `Bearer ${token}` } : extra;
}

export const api = {
  token: () => localStorage.getItem(TOKEN_KEY),
  user: () => {
    try {
      return JSON.parse(localStorage.getItem(USER_KEY) || "null");
    } catch {
      return null;
    }
  },
  logout() {
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(USER_KEY);
  },
  async login(username, password) {
    const res = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const data = await handle(res, { handle401: false });
    localStorage.setItem(TOKEN_KEY, data.token);
    localStorage.setItem(USER_KEY, JSON.stringify(data.user));
    return data;
  },
  async get(path) {
    return handle(await fetch(`/api/v1${path}`, { headers: authHeaders() }));
  },
  async post(path, body) {
    return handle(
      await fetch(`/api/v1${path}`, {
        method: "POST",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body ?? {}),
      })
    );
  },
  async patch(path, body) {
    return handle(
      await fetch(`/api/v1${path}`, {
        method: "PATCH",
        headers: authHeaders({ "content-type": "application/json" }),
        body: JSON.stringify(body ?? {}),
      })
    );
  },
  async postForm(path, formData) {
    return handle(await fetch(`/api/v1${path}`, { method: "POST", headers: authHeaders(), body: formData }));
  },
  async download(path, filename) {
    const res = await fetch(`/api/v1${path}`, { headers: authHeaders() });
    if (!res.ok) throw new Error("ดาวน์โหลดไม่สำเร็จ");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
