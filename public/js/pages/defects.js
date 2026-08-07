import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDate, thDateTime } from "../core/format.js";
import { SEVERITY_TH, SEVERITY_CLASS, DEFECT_STATUS_TH } from "../core/labels.js";
import { openPointDrawer } from "./pointDrawer.js";

const state = { status: "OPEN" };

function canClose() {
  return ["COMMITTEE", "ADMIN"].includes(api.user()?.role);
}

/** ให้เลือกผลตรวจซ้ำที่มีหลักฐานแนบเท่านั้น เพราะเป็นเงื่อนไขการปิดของฝั่งเซิร์ฟเวอร์ */
async function closeFlow(defect, reload) {
  const msgEl = qs(`#msg-${defect.id}`);
  let point;
  try {
    point = await api.get(`/points/${defect.pointId}`);
  } catch (err) {
    if (err?.status !== 401) msgEl.textContent = err?.message || "โหลดข้อมูลจุดไม่สำเร็จ";
    return;
  }
  const eligible = point.inspections.filter(
    (i) => i.evidences.length > 0 && new Date(i.inspectedAt) > new Date(defect.createdAt)
  );

  const msg = msgEl;
  if (eligible.length === 0) {
    msg.textContent = "ยังไม่มีผลตรวจซ้ำที่มีหลักฐานแนบหลังจากเปิดข้อบกพร่องนี้ ปิดไม่ได้";
    return;
  }

  const select = h("select", { class: "select" },
    eligible.map((i) => h("option", { value: i.id }, `${thDateTime(i.inspectedAt)} · ${i.inspectorName} · หลักฐาน ${i.evidences.length} รายการ`))
  );
  const confirm = h("button", { class: "btn small", onclick: async () => {
    try {
      await api.post(`/defects/${defect.id}/close`, { closingInspectionId: select.value });
      await reload();
    } catch (err) {
      if (err?.status !== 401) msg.textContent = err?.message || "ปิดข้อบกพร่องไม่สำเร็จ";
    }
  } }, "ยืนยันปิดข้อบกพร่อง");

  msg.replaceChildren(h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:8px" }, select, confirm));
}

function card(defect, reload) {
  const actions = h("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px" });

  if (defect.status === "OPEN") {
    actions.append(
      h("button", { class: "btn secondary small", onclick: async () => {
        try {
          await api.post(`/defects/${defect.id}/fix`, {});
        } catch (err) {
          if (err?.status !== 401) qs(`#msg-${defect.id}`).textContent = err?.message || "บันทึกไม่สำเร็จ";
          return;
        }
        await reload();
      } }, "ทำเครื่องหมายว่าแก้ไขแล้ว")
    );
  }
  if (defect.status !== "CLOSED" && canClose()) {
    actions.append(h("button", { class: "btn small", onclick: () => closeFlow(defect, reload) }, "ปิดข้อบกพร่อง"));
  }
  actions.append(
    h("button", { class: "btn secondary small", onclick: () => openPointDrawer(defect.pointId) }, "ดูจุดติดตั้ง")
  );

  return h("div", { class: "card card-pad", style: "margin-bottom:12px" },
    h("div", { style: "display:flex;gap:10px;align-items:center;flex-wrap:wrap" },
      h("span", { class: `chip ${SEVERITY_CLASS[defect.severity]}` }, SEVERITY_TH[defect.severity]),
      h("b", {}, defect.title),
      h("span", { class: "chip idle" }, DEFECT_STATUS_TH[defect.status])
    ),
    h("div", { class: "kpi-note", style: "margin:8px 0" },
      `${defect.pointCode} · ${defect.buildingName} ${defect.floor} ${defect.room}`),
    h("div", {}, defect.detail),
    h("div", { class: "kpi-note", style: "margin-top:8px" },
      `เปิดเมื่อ ${thDate(defect.createdAt)}`,
      defect.owner ? ` · ผู้รับผิดชอบ ${defect.owner}` : "",
      defect.dueDate ? ` · กำหนดเสร็จ ${thDate(defect.dueDate)}` : ""
    ),
    actions,
    h("div", { class: "kpi-note", id: `msg-${defect.id}`, style: "color:var(--fail-ink)" })
  );
}

// สั่งโหลดได้จากตัวกรองสถานะและหลังการปิด/แก้ไขข้อบกพร่องทุกครั้ง
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const list = qs("#defectsList");
  let data;
  try {
    data = await api.get(state.status ? `/defects?status=${state.status}` : "/defects");
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    list.replaceChildren(
      h("div", { class: "card card-pad" },
        h("div", { class: "error-banner" }, err?.message || "โหลดรายการข้อบกพร่องไม่สำเร็จ"))
    );
    return;
  }
  if (token !== loadToken) return;

  const groups = ["URGENT", "MAJOR", "MINOR"];

  list.replaceChildren(
    ...(data.defects.length
      ? groups
          .map((sev) => ({ sev, items: data.defects.filter((d) => d.severity === sev) }))
          .filter((g) => g.items.length)
          .map((g) =>
            h("section", { style: "margin-bottom:22px" },
              h("h2", { style: "font-size:19px;margin:0 0 10px" },
                `${SEVERITY_TH[g.sev]} (${thNumber(g.items.length)})`),
              g.items.map((d) => card(d, load))
            )
          )
      : [h("div", { class: "card card-pad" }, h("div", { class: "empty" }, "ไม่มีข้อบกพร่องตามเงื่อนไขที่เลือก"))])
  );
}

export async function renderDefects() {
  const view = qs("#view");
  // state อยู่ระดับโมดูล ถ้าไม่สะท้อนค่าที่เลือกไว้กลับมาที่ช่อง
  // ผู้ใช้ที่กรอง "ปิดแล้ว" แล้วออกไปหน้าอื่นและกลับมา จะเห็นช่องเขียนว่า "ยังไม่แก้ไข"
  // ทั้งที่รายการข้างล่างยังเป็นข้อบกพร่องที่ปิดแล้ว — อันตรายบนหน้าจอที่ใช้ติดตามข้อบกพร่อง
  const statusOptions = [
    ["OPEN", "ยังไม่แก้ไข"],
    ["FIXED", "แก้ไขแล้ว รอตรวจซ้ำ"],
    ["CLOSED", "ปิดแล้ว"],
    ["", "ทั้งหมด"],
  ];
  const statusSelect = h("select", { class: "select", onchange: (e) => { state.status = e.target.value; load(); } },
    statusOptions.map(([value, label]) =>
      h("option", { value, ...(value === state.status ? { selected: "selected" } : {}) }, label)
    )
  );

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "การจัดการข้อบกพร่อง (NCR)"),
          h("h1", {}, "ข้อบกพร่อง")
        ),
        h("div", { class: "toolbar" }, statusSelect)
      ),
      h("div", { class: "notice" },
        h("b", {}, "เงื่อนไขการปิด: "),
        "ต้องอ้างอิงผลตรวจซ้ำที่มีหลักฐานแนบ และปิดได้เฉพาะกรรมการตรวจรับหรือผู้ดูแลระบบ"),
      h("div", { id: "defectsList" })
    )
  );

  await load();
}
