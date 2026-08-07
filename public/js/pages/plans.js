import { api } from "../core/api.js";
import { store } from "../core/store.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, pct, todayStr } from "../core/format.js";
import { GATE_ORDER, GATE_TH, GATE_STATE_TH } from "../core/labels.js";

const state = { date: todayStr() };

function gateSelect(plan, key) {
  const select = h("select", {
      class: "select", style: "min-width:0;width:100%", "data-gate": key,
      onchange: async () => {
        // อ่านค่าจากช่องจริงทั้งสี่ช่อง ไม่ใช้ค่าที่จำไว้ใน plan.gates
        // ถ้าใช้ค่าที่จำไว้ การเปลี่ยน Gate สองอันติดกันเร็ว ๆ อันหลังจะเขียนทับอันแรกกลับเป็นค่าเดิม
        const card = select.closest("[data-plan]");
        const gates = {};
        card.querySelectorAll("[data-gate]").forEach((el) => {
          gates[el.getAttribute("data-gate")] = el.value;
        });
        try {
          await api.patch(`/plans/${plan.id}/gates`, { gates });
        } catch (err) {
          if (err?.status !== 401) alert(err?.message || "บันทึกสถานะ Gate ไม่สำเร็จ");
        }
        await load();
      },
    },
    ["PENDING", "ACTIVE", "DONE"].map((s) =>
      h("option", { value: s, ...(plan.gates?.[key] === s ? { selected: "selected" } : {}) }, GATE_STATE_TH[s])
    )
  );
  return select;
}

function planCard(plan) {
  const ratio = pct(plan.done, plan.total);
  return h("div", { class: "card card-pad", style: "margin-bottom:14px", "data-plan": plan.id },
    h("div", { style: "display:flex;justify-content:space-between;gap:12px;flex-wrap:wrap" },
      h("div", {},
        h("b", { style: "font-size:18px" }, plan.team),
        h("div", { class: "kpi-note" }, plan.note || "ไม่มีหมายเหตุ")
      ),
      h("div", { style: "text-align:right" },
        h("b", {}, `${thNumber(plan.done)} / ${thNumber(plan.total)} จุด`),
        h("div", { class: "kpi-note" }, `${ratio}%`)
      )
    ),
    h("div", { class: "bar", style: "margin:12px 0 16px" }, h("i", { style: `width:${ratio}%` })),
    h("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:12px" },
      GATE_ORDER.map((key, i) =>
        h("div", {},
          h("div", { class: "kpi-note" }, `Gate ${i + 1} · ${GATE_TH[key]}`),
          gateSelect(plan, key)
        )
      )
    )
  );
}

// สั่งโหลดได้จากทั้งช่องเลือกวันที่และการเปลี่ยนสถานะ Gate
// ต้องกันคำตอบเก่ามาทับคำตอบใหม่ ไม่งั้นจะเห็นแผนของวันที่ไม่ได้เลือก
let loadToken = 0;

async function load() {
  const token = (loadToken += 1);
  const list = qs("#plansList");
  let data;
  try {
    data = await api.get(`/plans?date=${state.date}`);
  } catch (err) {
    if (token !== loadToken || err?.status === 401) return;
    list.replaceChildren(
      h("div", { class: "card card-pad" },
        h("div", { class: "error-banner" }, err?.message || "โหลดแผนตรวจไม่สำเร็จ"))
    );
    return;
  }
  if (token !== loadToken) return;

  list.replaceChildren(
    ...(data.plans.length
      ? data.plans.map(planCard)
      : [h("div", { class: "card card-pad" }, h("div", { class: "empty" }, "ยังไม่มีแผนลงพื้นที่ของวันที่เลือก"))])
  );
}

async function openCreateForm() {
  const buildings = await store.loadBuildings();
  const view = qs("#createForm");

  const teamInput = h("input", { class: "input", placeholder: "เช่น ทีม A" });
  const noteInput = h("input", { class: "input", placeholder: "หมายเหตุ (ไม่บังคับ)" });
  const buildingSelect = h("select", { class: "select" },
    h("option", { value: "" }, "เลือกอาคาร"),
    buildings.map((b) => h("option", { value: b.id }, b.name))
  );
  const statusSelect = h("select", { class: "select" },
    h("option", { value: "PENDING" }, "เฉพาะจุดที่ยังไม่ตรวจ"),
    h("option", { value: "" }, "ทุกสถานะ")
  );
  const limitInput = h("input", { class: "input", type: "number", value: "40", min: "1", max: "200" });
  const result = h("div", { class: "kpi-note", style: "margin-top:10px" });

  const submit = async () => {
    result.textContent = "";
    if (!teamInput.value.trim()) { result.textContent = "กรุณาระบุชื่อทีม"; return; }
    if (!buildingSelect.value) { result.textContent = "กรุณาเลือกอาคาร"; return; }

    // เซิร์ฟเวอร์จำกัด pageSize ไว้ที่ 200 ถ้าปล่อยค่าที่ผู้ใช้พิมพ์ผ่านไปตรง ๆ
    // ค่าอย่าง 0 หรือ 500 จะทำให้คำขอถูกปฏิเสธ แล้วฟอร์มจะว่างเปล่าโดยไม่บอกอะไรเลย
    const rawLimit = Number(limitInput.value);
    const limit = Number.isFinite(rawLimit) ? Math.min(200, Math.max(1, Math.trunc(rawLimit))) : 40;
    limitInput.value = String(limit);

    const params = new URLSearchParams({ page: "1", pageSize: String(limit), buildingId: buildingSelect.value });
    if (statusSelect.value) params.set("status", statusSelect.value);

    let points;
    try {
      points = await api.get(`/points?${params}`);
    } catch (err) {
      if (err?.status !== 401) result.textContent = err?.message || "ค้นหาจุดไม่สำเร็จ";
      return;
    }
    if (points.rows.length === 0) { result.textContent = "ไม่พบจุดที่ตรงเงื่อนไข"; return; }

    try {
      await api.post("/plans", {
        date: state.date,
        team: teamInput.value.trim(),
        note: noteInput.value.trim() || undefined,
        pointIds: points.rows.map((r) => r.id),
      });
      // บอกให้ชัดเมื่อจุดที่ตรงเงื่อนไขมีมากกว่าที่ใส่ลงแผนได้
      // ไม่งั้นกรรมการจะแยกไม่ออกระหว่าง "ครบแล้ว 40 จุด" กับ "ตัดเหลือ 40 จาก 87 จุด"
      result.textContent =
        points.total > points.rows.length
          ? `บันทึกแผนแล้ว ${points.rows.length} จุด จากที่ตรงเงื่อนไขทั้งหมด ${points.total} จุด — เพิ่มจำนวนจุดสูงสุดแล้วบันทึกซ้ำเพื่อให้ครบ`
          : `บันทึกแผนแล้ว ${points.rows.length} จุด ครบตามเงื่อนไขที่เลือก`;
      await load();
    } catch (err) {
      if (err?.status !== 401) result.textContent = err?.message || "บันทึกแผนไม่สำเร็จ";
    }
  };

  view.replaceChildren(
    h("div", { class: "card card-pad" },
      h("b", {}, "สร้าง / แก้ไขแผนของวันที่เลือก"),
      h("div", { class: "kpi-note", style: "margin:4px 0 14px" },
        "บันทึกซ้ำด้วยวันและทีมเดิมจะแทนที่รายการจุดของแผนนั้น"),
      h("div", { style: "display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:10px" },
        h("div", {}, h("div", { class: "kpi-note" }, "ทีม"), teamInput),
        h("div", {}, h("div", { class: "kpi-note" }, "อาคาร"), buildingSelect),
        h("div", {}, h("div", { class: "kpi-note" }, "เลือกจุด"), statusSelect),
        h("div", {}, h("div", { class: "kpi-note" }, "จำนวนจุดสูงสุด"), limitInput)
      ),
      h("button", { class: "btn", style: "margin-top:14px", onclick: submit }, "บันทึกแผน"),
      result
    )
  );
}

export async function renderPlans() {
  const view = qs("#view");
  const dateInput = h("input", {
    class: "input", type: "date", value: state.date,
    onchange: (e) => { state.date = e.target.value; load(); },
  });

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "การวางแผนลงพื้นที่" ),
          h("h1", {}, "แผนตรวจ")
        ),
        h("div", { class: "toolbar" }, dateInput)
      ),
      h("div", { style: "height:16px" }),
      h("div", { id: "createForm" }),
      h("div", { style: "height:16px" }),
      h("div", { id: "plansList" })
    )
  );

  await openCreateForm();
  await load();
}
