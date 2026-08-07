import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, pct, todayStr } from "../core/format.js";
import { SEVERITY_TH, DISCLAIMER } from "../core/labels.js";

function canExport() {
  return ["COMMITTEE", "ADMIN"].includes(api.user()?.role);
}

async function withBusy(button, label, fn) {
  const original = button.textContent;
  // ล้างข้อความผิดพลาดของครั้งก่อนเสมอ ไม่งั้นดาวน์โหลดสำเร็จแล้ว
  // แต่ยังมีข้อความสีแดงค้างอยู่ข้าง ๆ ทำให้เข้าใจว่ายังทำไม่สำเร็จ
  qs("#exportMsg").textContent = "";
  button.disabled = true;
  button.textContent = label;
  try {
    await fn();
  } catch (err) {
    if (err?.status !== 401) qs("#exportMsg").textContent = err?.message || "ดำเนินการไม่สำเร็จ";
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

export async function renderReports() {
  const view = qs("#view");
  mount(view, h("div", { class: "empty" }, "กำลังโหลดข้อมูล..."));
  const summary = await api.get("/summary");
  const stamp = todayStr();

  const csvBtn = h("button", { class: "btn secondary", onclick: () =>
    withBusy(csvBtn, "กำลังสร้างไฟล์...", () => api.download("/reports/points.csv", `PSRU_WiFi_Acceptance_${stamp}.csv`))
  }, "ส่งออก CSV");

  const pdfBtn = h("button", { class: "btn", onclick: () =>
    withBusy(pdfBtn, "กำลังสร้างเอกสาร...", () => api.download("/reports/committee.pdf", `PSRU_WiFi_Committee_${stamp}.pdf`))
  }, "สร้าง PDF เสนอกรรมการ");

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "สรุปผลและการส่งออก"),
          h("h1", {}, "รายงาน")
        ),
        canExport()
          ? h("div", { class: "toolbar" }, csvBtn, pdfBtn)
          : h("div", { class: "kpi-note" }, "บทบาทของคุณไม่มีสิทธิ์ส่งออกรายงาน")
      ),
      h("div", { class: "kpi-note", id: "exportMsg", style: "color:var(--fail-ink);margin-top:8px" }),
      h("div", { class: "notice" }, h("b", {}, "หมายเหตุสำคัญ: "), DISCLAIMER),

      h("div", { class: "kpis" },
        [
          ["จุดทั้งหมด", summary.total],
          ["ตรวจแล้ว", summary.inspected],
          ["หลักฐานครบ", summary.evidenceComplete],
          ["รอตรวจซ้ำ", summary.awaitingRetest],
        ].map(([label, value]) =>
          h("div", { class: "card kpi" },
            h("div", { class: "kpi-label" }, label),
            h("div", { class: "kpi-value" }, thNumber(value))
          )
        )
      ),

      h("div", { class: "card card-pad", style: "margin-bottom:16px" },
        h("b", {}, "ข้อบกพร่องคงค้างตามระดับ"),
        h("div", { style: "display:flex;gap:22px;margin-top:12px;flex-wrap:wrap" },
          Object.entries(summary.defectsBySeverity).map(([sev, count]) =>
            h("div", {},
              h("div", { class: "kpi-note" }, SEVERITY_TH[sev] ?? sev),
              h("div", { style: "font-size:26px;font-weight:600" }, thNumber(count))
            )
          )
        )
      ),

      h("div", { class: "card" },
        h("div", { style: "padding:18px 20px 4px" }, h("b", {}, "ความคืบหน้าตามอาคาร")),
        h("div", { class: "table-wrap" },
          h("table", {},
            h("thead", {}, h("tr", {}, ["อาคาร", "จุดทั้งหมด", "ตรวจแล้ว", "มีข้อบกพร่อง", "ความคืบหน้า"].map((t) => h("th", {}, t)))),
            h("tbody", {},
              summary.byBuilding.map((b) =>
                h("tr", {},
                  h("td", {}, b.buildingName),
                  h("td", {}, thNumber(b.total)),
                  h("td", {}, thNumber(b.inspected)),
                  h("td", {}, b.withDefects ? h("span", { class: "chip fail" }, thNumber(b.withDefects)) : "—"),
                  h("td", {},
                    h("div", { class: "bar", style: "width:150px" }, h("i", { style: `width:${pct(b.inspected, b.total)}%` })),
                    h("div", { class: "kpi-note" }, `${pct(b.inspected, b.total)}%`)
                  )
                )
              )
            )
          )
        )
      )
    )
  );
}
