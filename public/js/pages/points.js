import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDateTime, pct } from "../core/format.js";
import { POINT_STATUS_TH, POINT_STATUS_CLASS } from "../core/labels.js";
import { openPointDrawer } from "./pointDrawer.js";

const state = { search: "", buildingId: "", status: "", page: 1, pageSize: 50 };

// ตัวนับรุ่นของคำขอ ตารางนี้ถูกสั่งโหลดจากทั้งช่องค้นหา ตัวกรอง และปุ่มเปลี่ยนหน้า
// ถ้าคำตอบเก่ามาถึงทีหลัง แถวที่แสดงกับตัวเลขหน้าจะไม่ตรงกับสิ่งที่ผู้ใช้เลือกไว้
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const params = new URLSearchParams({ page: String(state.page), pageSize: String(state.pageSize) });
  if (state.search) params.set("search", state.search);
  if (state.buildingId) params.set("buildingId", state.buildingId);
  if (state.status) params.set("status", state.status);

  const body = qs("#pointsBody");
  let data;
  try {
    data = await api.get(`/points?${params}`);
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    body.replaceChildren(
      h("tr", {}, h("td", { colspan: "7" },
        h("div", { class: "error-banner" }, err?.message || "โหลดทะเบียนจุดไม่สำเร็จ")))
    );
    qs("#pagerInfo").textContent = "";
    return;
  }
  if (token !== loadToken) return;

  const pages = Math.max(1, Math.ceil(data.total / data.pageSize));

  body.replaceChildren(
    ...(data.rows.length
      ? data.rows.map((r) =>
          h("tr", {},
            h("td", {},
              h("button", { class: "linkbtn", onclick: () => openPointDrawer(r.id) }, r.code),
              h("div", { class: "kpi-note" }, r.serial || "—")
            ),
            h("td", {}, h("b", {}, r.buildingName), h("div", { class: "kpi-note" }, `${r.floor} · ${r.room}`)),
            h("td", {}, r.deviceModel || "—"),
            h("td", {}, h("span", { class: `chip ${POINT_STATUS_CLASS[r.status]}` }, POINT_STATUS_TH[r.status])),
            h("td", {},
              h("div", { class: "bar", style: "width:110px" }, h("i", { style: `width:${pct(r.evidenceHave, r.evidenceNeed)}%` })),
              h("div", { class: "kpi-note" }, `${r.evidenceHave}/${r.evidenceNeed}`)
            ),
            h("td", {}, r.openDefects ? h("span", { class: "chip fail" }, thNumber(r.openDefects)) : "—"),
            h("td", {}, thDateTime(r.lastInspectedAt))
          )
        )
      : [h("tr", {}, h("td", { colspan: "7" }, h("div", { class: "empty" }, "ไม่พบจุดติดตั้งตามเงื่อนไขที่เลือก")))])
  );

  qs("#pagerInfo").textContent =
    `พบ ${thNumber(data.total)} จุด · หน้า ${thNumber(data.page)} จาก ${thNumber(pages)}`;
  qs("#prevBtn").disabled = data.page <= 1;
  qs("#nextBtn").disabled = data.page >= pages;
}

export async function renderPoints() {
  const view = qs("#view");
  const buildings = await store.loadBuildings();

  const searchInput = h("input", {
    class: "input", placeholder: "ค้นหารหัสจุด อาคาร ห้อง หรือ Serial", value: state.search,
  });
  let timer = null;
  searchInput.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => { state.search = searchInput.value.trim(); state.page = 1; load(); }, 250);
  });

  const buildingSelect = h("select", { class: "select", onchange: (e) => { state.buildingId = e.target.value; state.page = 1; load(); } },
    h("option", { value: "" }, "ทุกอาคาร"),
    buildings.map((b) => h("option", { value: b.id, ...(b.id === state.buildingId ? { selected: "selected" } : {}) }, b.name))
  );

  const statusSelect = h("select", { class: "select", onchange: (e) => { state.status = e.target.value; state.page = 1; load(); } },
    h("option", { value: "" }, "ทุกสถานะ"),
    Object.entries(POINT_STATUS_TH).map(([k, v]) =>
      h("option", { value: k, ...(k === state.status ? { selected: "selected" } : {}) }, v)
    )
  );

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "ทะเบียนตรวจรับ"),
          h("h1", {}, "จุดติดตั้ง")
        ),
        h("div", { class: "toolbar" }, searchInput, buildingSelect, statusSelect)
      ),
      h("div", { style: "height:16px" }),
      h("div", { class: "card" },
        h("div", { class: "table-wrap" },
          h("table", {},
            h("thead", {},
              h("tr", {}, ["รหัสจุด", "สถานที่", "อุปกรณ์", "สถานะ", "หลักฐาน", "ข้อบกพร่อง", "ตรวจล่าสุด"].map((t) => h("th", {}, t)))
            ),
            h("tbody", { id: "pointsBody" })
          )
        ),
        h("div", { class: "pager" },
          h("span", { id: "pagerInfo" }),
          h("button", { class: "btn secondary small", id: "prevBtn", onclick: () => { state.page -= 1; load(); } }, "ก่อนหน้า"),
          h("button", { class: "btn secondary small", id: "nextBtn", onclick: () => { state.page += 1; load(); } }, "ถัดไป")
        )
      )
    )
  );

  await load();
}
