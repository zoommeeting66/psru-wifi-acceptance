import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { thDateTime } from "../core/format.js";
import {
  POINT_STATUS_TH, POINT_STATUS_CLASS, SEVERITY_TH, SEVERITY_CLASS,
  DEFECT_STATUS_TH, EVIDENCE_TH,
} from "../core/labels.js";

// ตัวนับรุ่นของคำขอ กันไม่ให้คำตอบของจุดที่กดก่อนหน้ามาทับจุดที่ผู้ใช้กดล่าสุด
// ถ้าปล่อยไว้ ผู้ใช้จะเห็นประวัติของอีกจุดหนึ่งใต้หัวข้อของจุดที่ตัวเองเลือก
let drawerRequest = 0;
let objectUrls = [];

function releaseObjectUrls() {
  objectUrls.forEach((url) => URL.revokeObjectURL(url));
  objectUrls = [];
}

export function closeDrawer() {
  drawerRequest += 1;
  releaseObjectUrls();
  qs("#drawer").classList.remove("open");
  qs("#drawerBackdrop").classList.remove("open");
}

function checkRow(c) {
  const shown = c.value === null ? "ยังไม่ได้วัด" : `${c.value} ${c.unit}`;
  const target = `${c.operator === "gte" ? "ไม่น้อยกว่า" : "ไม่เกิน"} ${c.threshold} ${c.unit}`;
  return h("tr", {},
    h("td", {}, c.label, h("div", { class: "kpi-note" }, c.torClause)),
    h("td", {}, shown),
    h("td", {}, target),
    h("td", {}, c.belowThreshold ? h("span", { class: "chip fail" }, "ต่ำกว่าเกณฑ์") : h("span", { class: "chip idle" }, "—"))
  );
}

async function evidenceThumb(ev) {
  // ไฟล์หลักฐานต้องส่ง token จึงดึงเป็น blob แทนการใส่ URL ตรงใน src
  const label = EVIDENCE_TH[ev.kind] ?? ev.kind;
  const img = h("img", { alt: label });
  const status = h("div", { class: "kpi-note" }, label);
  try {
    const res = await fetch(ev.url, { headers: { authorization: `Bearer ${api.token()}` } });
    if (res.ok) {
      const url = URL.createObjectURL(await res.blob());
      objectUrls.push(url);
      img.src = url;
    } else {
      status.textContent = `${label} — โหลดไฟล์ไม่สำเร็จ`;
    }
  } catch {
    // ต้องบอกให้รู้ว่าโหลดไม่ได้ ไม่ใช่ปล่อยกล่องว่างที่แยกไม่ออกจากกำลังโหลด
    status.textContent = `${label} — โหลดไฟล์ไม่สำเร็จ`;
  }
  return h("div", {}, img, status);
}

function inspectionBlock(ins) {
  const wrap = h("div", { style: "border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:14px" },
    h("div", { style: "display:flex;justify-content:space-between;flex-wrap:wrap;gap:8px" },
      h("b", {}, thDateTime(ins.inspectedAt)),
      h("span", { class: "kpi-note" }, `ผู้ตรวจ: ${ins.inspectorName}`)
    ),
    ins.note ? h("div", { style: "margin:8px 0" }, ins.note) : null,
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {}, h("tr", {}, ["เกณฑ์", "ค่าที่วัดได้", "เกณฑ์ TOR", "ผลเทียบ"].map((t) => h("th", {}, t)))),
        h("tbody", {}, ins.checks.map(checkRow))
      )
    ),
    h("div", { class: "kpi-note", style: "margin:12px 0 6px" }, `หลักฐานแนบ ${ins.evidences.length} รายการ`)
  );
  const grid = h("div", { class: "evidence-grid" });
  wrap.append(grid);
  const token = drawerRequest;
  ins.evidences.forEach((ev) =>
    evidenceThumb(ev).then((node) => {
      if (token === drawerRequest) grid.append(node);
    })
  );
  return wrap;
}

export async function openPointDrawer(pointId) {
  const drawer = qs("#drawer");
  const backdrop = qs("#drawerBackdrop");
  const token = (drawerRequest += 1);
  releaseObjectUrls();
  backdrop.classList.add("open");
  drawer.classList.add("open");
  backdrop.onclick = closeDrawer;
  drawer.replaceChildren(h("div", { class: "empty" }, "กำลังโหลด..."));

  let p;
  try {
    p = await api.get(`/points/${pointId}`);
  } catch (err) {
    if (token !== drawerRequest) return;
    if (err?.status === 401) return;
    drawer.replaceChildren(
      h("div", { class: "drawer-head" },
        h("b", {}, "โหลดข้อมูลจุดไม่สำเร็จ"),
        h("button", { class: "close-x", onclick: closeDrawer, "aria-label": "ปิด" }, "×")
      ),
      h("div", { class: "drawer-body" },
        h("div", { class: "error-banner" }, err?.message || "กรุณาลองใหม่อีกครั้ง")
      )
    );
    return;
  }
  // ผู้ใช้กดจุดอื่นไปแล้วระหว่างรอ — ทิ้งคำตอบนี้
  if (token !== drawerRequest) return;

  drawer.replaceChildren(
    h("div", { class: "drawer-head" },
      h("div", {},
        h("h2", { style: "margin:0;font-size:22px" }, p.code),
        h("div", { class: "kpi-note" }, `${p.buildingName} · ${p.floor} · ${p.room}`),
        h("div", { style: "margin-top:8px" },
          h("span", { class: `chip ${POINT_STATUS_CLASS[p.status]}` }, POINT_STATUS_TH[p.status])
        )
      ),
      h("button", { class: "close-x", onclick: closeDrawer, "aria-label": "ปิด" }, "×")
    ),
    h("div", { class: "drawer-body" },
      h("div", { style: "display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px" },
        h("div", {}, h("div", { class: "kpi-note" }, "อุปกรณ์"), h("b", {}, p.deviceModel || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "Serial"), h("b", {}, p.serial || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "MAC"), h("b", {}, p.mac || "—")),
        h("div", {}, h("div", { class: "kpi-note" }, "จำนวนรอบการตรวจ"), h("b", {}, String(p.inspections.length)))
      ),
      h("h3", { style: "font-size:17px" }, "ข้อบกพร่อง"),
      p.defects.length === 0
        ? h("div", { class: "kpi-note", style: "margin-bottom:18px" }, "ไม่มีข้อบกพร่องที่จุดนี้")
        : h("div", { style: "margin-bottom:18px" },
            p.defects.map((d) =>
              h("div", { style: "border:1px solid var(--line);border-radius:10px;padding:12px;margin-bottom:8px" },
                h("div", { style: "display:flex;gap:8px;align-items:center;flex-wrap:wrap" },
                  h("span", { class: `chip ${SEVERITY_CLASS[d.severity]}` }, SEVERITY_TH[d.severity]),
                  h("b", {}, d.title),
                  h("span", { class: "kpi-note" }, DEFECT_STATUS_TH[d.status])
                ),
                h("div", { class: "kpi-note", style: "margin-top:6px" }, d.detail)
              )
            )
          ),
      h("h3", { style: "font-size:17px" }, "ประวัติการตรวจ"),
      p.inspections.length === 0
        ? h("div", { class: "kpi-note" }, "ยังไม่มีการลงตรวจที่จุดนี้")
        : h("div", {}, p.inspections.map(inspectionBlock))
    )
  );
}
