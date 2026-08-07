import { api } from "../core/api.js";
import { h, mount, qs } from "../core/dom.js";
import { thNumber, thDate, thDateTime, pct, todayStr } from "../core/format.js";
import {
  POINT_STATUS_TH, POINT_STATUS_CLASS, SEVERITY_TH, SEVERITY_CLASS,
  GATE_ORDER, GATE_TH, GATE_STATE_TH, DISCLAIMER,
} from "../core/labels.js";

function kpi(mark, markClass, label, value, note, ratio) {
  return h("div", { class: "card kpi" },
    h("div", { class: "kpi-top" },
      h("div", { class: `kpi-mark ${markClass}` }, mark),
      h("div", { class: "kpi-label" }, label)
    ),
    h("div", { class: "kpi-value" }, thNumber(value)),
    h("div", { class: "kpi-note" }, note),
    ratio === null ? null : h("div", { class: "bar" }, h("i", { style: `width:${ratio}%` }))
  );
}

function planCard(plan) {
  if (!plan) {
    return h("div", { class: "card card-pad" },
      h("div", { class: "kpi-label" }, "แผนงานวันนี้"),
      h("div", { class: "empty" }, "ยังไม่มีแผนลงพื้นที่สำหรับวันนี้")
    );
  }
  const ratio = pct(plan.done, plan.total);
  return h("div", { class: "card card-pad" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
      h("div", { class: "kpi-label" }, "แผนงานวันนี้"),
      h("a", { href: "#/plans", class: "linkbtn" }, "ดูแผนทั้งหมด")
    ),
    h("h2", { style: "margin:8px 0 16px;font-size:22px;font-weight:600" }, "ความคืบหน้าการตรวจภาคสนาม"),
    h("div", { style: "display:flex;gap:16px;align-items:center;flex-wrap:wrap" },
      h("div", { style: "background:var(--sidebar);color:#fff;border-radius:12px;padding:14px 18px;text-align:center;min-width:92px" },
        h("div", { style: "font-size:26px;font-weight:600" }, thDate(plan.date).split(" ")[0]),
        h("div", { style: "font-size:12px;opacity:.75" }, plan.team)
      ),
      h("div", { style: "flex:1;min-width:220px" },
        h("div", { style: "font-weight:600" }, `${plan.team} · ${thNumber(plan.total)} จุด`),
        h("div", { class: "bar", style: "margin:10px 0 6px" }, h("i", { style: `width:${ratio}%` })),
        h("div", { class: "kpi-note" }, `ตรวจแล้ว ${thNumber(plan.done)} จาก ${thNumber(plan.total)} จุด`)
      )
    ),
    h("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:18px" },
      GATE_ORDER.map((key, i) =>
        h("div", { style: "border-left:2px solid var(--line);padding-left:12px" },
          h("div", { class: "kpi-note" }, `Gate ${i + 1}`),
          h("div", { style: "font-weight:600" }, GATE_TH[key]),
          h("div", {
            class: "kpi-note",
            style: (plan.gates?.[key] === "DONE" ? "color:var(--pass-ink)" : plan.gates?.[key] === "ACTIVE" ? "color:var(--warn-ink)" : ""),
          }, GATE_STATE_TH[plan.gates?.[key] ?? "PENDING"])
        )
      )
    )
  );
}

function defectsCard(defects) {
  const groups = ["URGENT", "MAJOR", "MINOR"].map((sev) => ({
    sev,
    items: defects.filter((d) => d.severity === sev),
  }));
  return h("div", { class: "card card-pad" },
    h("div", { style: "display:flex;justify-content:space-between;align-items:center" },
      h("div", { class: "kpi-label" }, "ต้องดำเนินการ"),
      h("span", { class: "chip fail" }, thNumber(defects.length))
    ),
    h("h2", { style: "margin:8px 0 14px;font-size:22px;font-weight:600" }, "ข้อบกพร่องคงค้าง"),
    defects.length === 0
      ? h("div", { class: "empty" }, "ไม่มีข้อบกพร่องคงค้าง")
      : h("div", {},
          groups.filter((g) => g.items.length).map((g) =>
            h("div", { style: "padding:12px 0;border-top:1px solid var(--line)" },
              h("div", { style: "display:flex;gap:10px;align-items:baseline" },
                h("span", { class: `chip ${SEVERITY_CLASS[g.sev]}` }, SEVERITY_TH[g.sev]),
                h("b", {}, `${thNumber(g.items.length)} รายการ`)
              ),
              h("div", { class: "kpi-note", style: "margin-top:6px" },
                g.items.slice(0, 2).map((d) => d.pointCode + " " + d.title).join(" · ")
              )
            )
          )
        ),
    h("a", { href: "#/defects", class: "linkbtn", style: "display:inline-block;margin-top:12px" }, "จัดการข้อบกพร่องทั้งหมด")
  );
}

function recentTable(rows) {
  return h("div", { class: "card" },
    h("div", { style: "padding:18px 20px 4px" },
      h("div", { class: "kpi-label" }, "ทะเบียนตรวจรับ"),
      h("h2", { style: "margin:6px 0 0;font-size:22px;font-weight:600" }, "จุดติดตั้งล่าสุด")
    ),
    h("div", { class: "table-wrap" },
      h("table", {},
        h("thead", {},
          h("tr", {},
            ["รหัสจุด", "สถานที่", "อุปกรณ์", "สถานะ", "หลักฐาน", "ตรวจล่าสุด"].map((t) => h("th", {}, t))
          )
        ),
        h("tbody", {},
          rows.map((r) =>
            h("tr", {},
              h("td", {}, h("b", {}, r.code), h("div", { class: "kpi-note" }, r.serial || "—")),
              h("td", {}, h("b", {}, r.buildingName), h("div", { class: "kpi-note" }, `${r.floor} · ${r.room}`)),
              h("td", {}, r.deviceModel || "—"),
              h("td", {}, h("span", { class: `chip ${POINT_STATUS_CLASS[r.status]}` }, POINT_STATUS_TH[r.status])),
              h("td", {},
                h("div", { class: "bar", style: "width:110px" },
                  h("i", { style: `width:${pct(r.evidenceHave, r.evidenceNeed)}%` })
                ),
                h("div", { class: "kpi-note" }, `${r.evidenceHave}/${r.evidenceNeed}`)
              ),
              h("td", {}, thDateTime(r.lastInspectedAt))
            )
          )
        )
      )
    ),
    h("div", { style: "padding:14px 20px" }, h("a", { href: "#/points", class: "linkbtn" }, "ดูทะเบียนทั้งหมด"))
  );
}

export async function renderOverview() {
  const view = qs("#view");
  mount(view, h("div", { class: "empty" }, "กำลังโหลดข้อมูล..."));

  const today = todayStr();
  const [summary, plans, defects, points] = await Promise.all([
    api.get("/summary"),
    api.get(`/plans?date=${today}`),
    api.get("/defects?status=OPEN"),
    api.get("/points?page=1&pageSize=6"),
  ]);

  mount(view,
    h("div", {},
      h("div", { class: "page-head" },
        h("div", {},
          h("div", { class: "eyebrow" }, "ระบบควบคุมหลักฐานการตรวจรับ"),
          h("h1", {}, "ภาพรวม")
        ),
        h("div", { class: "toolbar" },
          h("a", { class: "btn secondary", href: "#/reports" }, "รายงาน"),
          h("a", { class: "btn", href: "#/points" }, "เปิดทะเบียนจุด")
        )
      ),
      h("div", { class: "notice" }, h("b", {}, "หมายเหตุสำคัญ: "), DISCLAIMER),
      h("div", { class: "kpis" },
        kpi("จ", "a", "จุดทั้งหมด", summary.total, "ครบตามทะเบียนโครงการ", null),
        kpi("ต", "b", "ตรวจแล้ว", summary.inspected, `${pct(summary.inspected, summary.total)}% ของแผนทั้งหมด`, pct(summary.inspected, summary.total)),
        kpi("ร", "c", "รอตรวจ", summary.pending, `${pct(summary.pending, summary.total)}% ยังไม่ลงพื้นที่`, pct(summary.pending, summary.total)),
        kpi("พ", "d", "พบข้อบกพร่อง", summary.withDefects, "ต้องแก้ไข / ตรวจซ้ำ", null)
      ),
      h("div", { class: "grid-2" }, planCard(plans.plans[0] ?? null), defectsCard(defects.defects)),
      h("div", { style: "height:16px" }),
      recentTable(points.rows)
    )
  );
}
