import { api, SESSION_EXPIRED_EVENT } from "./core/api.js";
import { h, mount, qs } from "./core/dom.js";
import { startRouter, navigate } from "./core/router.js";
import { ROLE_TH } from "./core/labels.js";
import { renderOverview } from "./pages/overview.js";
import { renderPoints } from "./pages/points.js";
import { renderPlans } from "./pages/plans.js";
import { renderDefects } from "./pages/defects.js";
import { renderReports } from "./pages/reports.js";

const root = () => qs("#root");

const NAV = [
  { hash: "#/overview", label: "ภาพรวม" },
  { hash: "#/points", label: "จุดติดตั้ง" },
  { hash: "#/plans", label: "แผนตรวจ" },
  { hash: "#/defects", label: "ข้อบกพร่อง" },
  { hash: "#/reports", label: "รายงาน" },
];

function loginView() {
  const error = h("div", { class: "error-banner", style: "display:none" });
  const username = h("input", { class: "input", id: "u", autocomplete: "username" });
  const password = h("input", { class: "input", id: "p", type: "password", autocomplete: "current-password" });

  const submit = async (e) => {
    e.preventDefault();
    error.style.display = "none";
    try {
      await api.login(username.value.trim(), password.value);
      navigate("#/overview");
      renderShell();
    } catch (err) {
      error.textContent = err.message;
      error.style.display = "block";
    }
  };

  mount(
    root(),
    h("div", { class: "login-wrap" },
      h("form", { class: "login-card", onsubmit: submit },
        h("div", { class: "brand-mark" }, "W"),
        h("h1", {}, "ระบบสนับสนุนการตรวจรับ Wi-Fi"),
        h("div", { class: "brand-sub", style: "color:var(--muted)" }, "PSRU INSPECTION"),
        h("div", { style: "height:18px" }),
        error,
        h("div", { class: "field" }, h("label", { for: "u" }, "ชื่อผู้ใช้"), username),
        h("div", { class: "field" }, h("label", { for: "p" }, "รหัสผ่าน"), password),
        h("button", { class: "btn", style: "width:100%", type: "submit" }, "เข้าสู่ระบบ")
      )
    )
  );
}

function shell() {
  const user = api.user();
  return h("div", { class: "layout" },
    h("aside", { class: "sidebar" },
      h("div", { class: "brand" },
        h("div", { class: "brand-mark" }, "W"),
        h("div", {},
          h("div", { class: "brand-name" }, "WiFi Accept"),
          h("div", { class: "brand-sub" }, "PSRU Inspection")
        )
      ),
      h("nav", { class: "nav" }, NAV.map((n) => h("a", { href: n.hash }, n.label))),
      h("div", { class: "side-foot" },
        h("b", {}, user?.name ?? "-"),
        h("div", {}, ROLE_TH[user?.role] ?? "-"),
        user?.team ? h("div", {}, user.team) : null,
        h("button", {
          class: "linkbtn",
          style: "margin-top:10px;color:var(--accent)",
          onclick: () => { api.logout(); loginView(); },
        }, "ออกจากระบบ")
      )
    ),
    h("main", { class: "content", id: "view" })
  );
}

export function renderShell() {
  mount(root(), shell());
  startRouter(
    {
      "#/overview": renderOverview,
      "#/points": renderPoints,
      "#/plans": renderPlans,
      "#/defects": renderDefects,
      "#/reports": renderReports,
    },
    "#/overview"
  );
}

// โทเค็นหมดอายุระหว่างใช้งาน ต้องพากลับหน้าเข้าสู่ระบบจริง ๆ
// ไม่ใช่ปล่อยให้เชลล์เดิมค้างอยู่บนจอทั้งที่เรียก API ไม่ได้แล้ว
window.addEventListener(SESSION_EXPIRED_EVENT, () => loginView());

if (api.token()) renderShell();
else loginView();
