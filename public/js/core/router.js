let table = {};
let fallbackRoute = "#/overview";

async function run() {
  const hash = location.hash || fallbackRoute;
  const path = hash.split("?")[0];
  const view = table[path] || table[fallbackRoute];
  document.querySelectorAll(".nav a").forEach((a) => {
    a.classList.toggle("active", a.getAttribute("href") === path);
  });
  if (!view) return;
  try {
    await view();
  } catch (err) {
    // ทุกหน้าโหลดข้อมูลผ่าน await ถ้าปล่อยให้ error หลุดไป
    // ผู้ใช้จะค้างอยู่กับข้อความ "กำลังโหลดข้อมูล..." ตลอดไปโดยไม่รู้ว่าเกิดอะไรขึ้น
    // เซสชันหมดอายุ (401) มีทางกลับหน้าเข้าสู่ระบบของตัวเองอยู่แล้ว จึงไม่ต้องแสดงซ้ำ
    if (err?.status === 401) return;
    const view0 = document.querySelector("#view");
    if (!view0) throw err;
    const box = document.createElement("div");
    box.className = "error-banner";
    box.textContent = err?.message || "โหลดข้อมูลไม่สำเร็จ กรุณาลองใหม่อีกครั้ง";
    const retry = document.createElement("button");
    retry.className = "btn secondary small";
    retry.style.marginLeft = "12px";
    retry.textContent = "ลองใหม่";
    retry.addEventListener("click", run);
    box.append(retry);
    view0.replaceChildren(box);
  }
}

export function startRouter(routes, fallback = "#/overview") {
  table = routes;
  fallbackRoute = fallback;
  window.addEventListener("hashchange", run);
  run();
}

export function navigate(hash) {
  if (location.hash === hash) run();
  else location.hash = hash;
}
