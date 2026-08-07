import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { getDb, refreshBadge, syncNow, onBadgeChange } from "./sync.js";
import { listPending } from "../offline/outbox.js";

async function loadToday() {
  try {
    const data = await api.get("/plans/today/mine");
    sessionStorage.setItem("psru_wifi_today", JSON.stringify(data));
    const { criteria } = await api.get("/criteria");
    localStorage.setItem("psru_wifi_criteria", JSON.stringify(criteria));
    return data;
  } catch {
    return JSON.parse(sessionStorage.getItem("psru_wifi_today") || '{"plan":null,"points":[]}');
  }
}

function syncBar() {
  const dot = h("span", { class: "dot" });
  const text = h("span", {}, "กำลังตรวจสอบคิว...");
  const button = h("button", { onclick: async () => {
    text.textContent = "กำลังส่ง...";
    const r = await syncNow();
    text.textContent = r.sent ? `ส่งแล้ว ${r.sent} รายการ` : "ส่งไม่สำเร็จ ลองใหม่เมื่อมีสัญญาณ";
    await refreshBadge();
  } }, "ส่งเดี๋ยวนี้");

  const bar = h("div", { class: "m-sync" }, dot, text, button);
  onBadgeChange((count) => {
    bar.classList.toggle("clear", count === 0);
    text.textContent = count === 0 ? "ส่งครบแล้ว" : `ค้างส่ง ${count} รายการ`;
    button.style.display = count === 0 ? "none" : "";
  });
  return bar;
}

export async function renderTodayList() {
  const root = qs("#mroot");
  root.replaceChildren(h("div", { class: "m-body" }, h("div", { class: "empty" }, "กำลังโหลด...")));

  const data = await loadToday();
  const pending = new Set((await listPending(getDb())).map((i) => i.payload.pointCode));

  root.replaceChildren(
    h("div", { class: "m-top" },
      h("div", {},
        h("b", {}, "จุดตรวจวันนี้"),
        h("div", { style: "font-size:13px;opacity:.8" }, data.plan ? data.plan.team : "ยังไม่มีแผน")
      ),
      syncBar()
    ),
    h("div", { class: "m-body" },
      data.points.length === 0
        ? h("div", { class: "empty" }, "ยังไม่มีจุดที่ได้รับมอบหมายสำหรับวันนี้")
        : h("div", { class: "m-list" },
            data.points.map((p) =>
              h("button", { class: "m-item", onclick: () => { location.hash = `#/point/${p.id}`; } },
                h("div", {},
                  h("b", {}, p.code),
                  h("div", { class: "meta" }, `${p.buildingName} · ${p.floor} · ${p.room}`)
                ),
                pending.has(p.code)
                  ? h("span", { class: "chip warn" }, "ค้างส่ง")
                  : p.doneAt
                    ? h("span", { class: "chip pass" }, "ตรวจแล้ว")
                    : h("span", { class: "chip idle" }, "รอตรวจ")
              )
            )
          )
    )
  );

  await refreshBadge();
}
