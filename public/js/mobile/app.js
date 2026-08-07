import { api, SESSION_EXPIRED_EVENT } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { initSync, syncNow } from "./sync.js";
import { renderTodayList } from "./todayList.js";
import { renderCaptureForm } from "./captureForm.js";

function loginView() {
  const error = h("div", { class: "m-msg" });
  const username = h("input", { autocomplete: "username" });
  const password = h("input", { type: "password", autocomplete: "current-password" });

  qs("#mroot").replaceChildren(
    h("div", { class: "m-top" }, h("b", {}, "บันทึกผลตรวจภาคสนาม")),
    h("div", { class: "m-body" },
      h("form", { class: "m-form", onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.login(username.value.trim(), password.value);
          await start();
        } catch (err) {
          error.textContent = err.message;
        }
      } },
        h("div", { class: "m-field" }, h("label", {}, "ชื่อผู้ใช้"), username),
        h("div", { class: "m-field" }, h("label", {}, "รหัสผ่าน"), password),
        error,
        h("button", { class: "btn", type: "submit", style: "padding:15px;font-size:16px" }, "เข้าสู่ระบบ")
      )
    )
  );
}

async function route() {
  const hash = location.hash || "#/today";
  if (hash.startsWith("#/point/")) return renderCaptureForm(hash.slice("#/point/".length));
  return renderTodayList();
}

let routing = false;

async function start() {
  await initSync();
  // เข้าสู่ระบบใหม่หลังเซสชันหมดอายุจะเรียก start() ซ้ำ ต้องไม่ผูก listener ซ้อน
  if (!routing) {
    window.addEventListener("hashchange", route);
    routing = true;
  }
  await route();
  syncNow();
}

if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

window.addEventListener(SESSION_EXPIRED_EVENT, () => loginView());

if (api.token()) start();
else loginView();
