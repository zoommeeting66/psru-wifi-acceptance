import { api } from "../core/api.js";
import { h, qs } from "../core/dom.js";
import { EVIDENCE_ORDER, EVIDENCE_TH } from "../core/labels.js";
import { shrinkImage } from "../offline/imageResize.js";
import { enqueue } from "../offline/outbox.js";
import { getDb, refreshBadge, syncNow } from "./sync.js";

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)
  );
}

function photoTile(kind, photos) {
  const input = h("input", { type: "file", accept: "image/*", capture: "environment" });
  const preview = h("div", {}, "แตะเพื่อถ่ายรูป");
  const tile = h("label", { class: "m-photo" }, h("b", {}, EVIDENCE_TH[kind]), preview, input);
  let previewUrl = null;

  input.addEventListener("change", async () => {
    const file = input.files?.[0];
    if (!file) return;
    preview.textContent = "กำลังย่อรูป...";
    try {
      const blob = await shrinkImage(file);
      photos.set(kind, { kind, blob, capturedAt: new Date().toISOString() });
      // ถ่ายซ้ำช่องเดิมได้ ต้องคืน URL เดิมก่อน ไม่งั้นค้างสะสมทั้งกะการทำงาน
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      previewUrl = URL.createObjectURL(blob);
      tile.classList.add("filled");
      preview.replaceChildren(h("img", { src: previewUrl, alt: EVIDENCE_TH[kind] }));
    } catch {
      preview.textContent = "ย่อรูปไม่สำเร็จ แตะเพื่อถ่ายใหม่";
    }
  });

  return tile;
}

export async function renderCaptureForm(pointId) {
  const root = qs("#mroot");
  const cached = JSON.parse(sessionStorage.getItem("psru_wifi_today") || "{}");
  const point = (cached.points || []).find((p) => p.id === pointId);
  if (!point) { location.hash = "#/today"; return; }

  const criteria = JSON.parse(localStorage.getItem("psru_wifi_criteria") || "[]");
  const photos = new Map();
  const fields = {};
  const msg = h("div", { class: "m-msg" });

  const measurementFields = criteria.map((c) => {
    const input = h("input", { type: "number", inputmode: "decimal", step: "any" });
    fields[c.key] = input;
    return h("div", { class: "m-field" },
      h("label", {}, c.label),
      h("div", { class: "hint" },
        `เกณฑ์ ${c.operator === "gte" ? "ไม่น้อยกว่า" : "ไม่เกิน"} ${c.threshold} ${c.unit} · ${c.torClause}`),
      input
    );
  });

  const serial = h("input", { value: point.serial || "", placeholder: "หมายเลขเครื่อง" });
  const mac = h("input", { value: point.mac || "", placeholder: "MAC Address" });
  const note = h("textarea", { rows: "3", placeholder: "บันทึกเพิ่มเติม (ไม่บังคับ)" });
  const defectTitle = h("input", { placeholder: "หัวข้อข้อบกพร่อง (เว้นว่างหากไม่พบ)" });
  const defectDetail = h("textarea", { rows: "2", placeholder: "รายละเอียดข้อบกพร่อง" });
  const defectSeverity = h("select", {},
    h("option", { value: "MINOR" }, "ทั่วไป"),
    h("option", { value: "MAJOR" }, "สำคัญ"),
    h("option", { value: "URGENT" }, "เร่งด่วน")
  );

  const saveBtn = h("button", {}, "บันทึกผลตรวจ");
  let saving = false;

  const submit = async () => {
    // กันการกดสองครั้งติดกันบนจอสัมผัส ไม่งั้นจะได้ผลตรวจสองรายการจากการลงพื้นที่ครั้งเดียว
    if (saving) return;
    msg.textContent = "";
    if (photos.size === 0) { msg.textContent = "ต้องถ่ายหลักฐานอย่างน้อย 1 รูปก่อนบันทึก"; return; }

    const measurements = {};
    for (const [key, input] of Object.entries(fields)) {
      if (input.value !== "") measurements[key] = Number(input.value);
    }

    const clientUuid = uuid();
    const payload = {
      clientUuid,
      pointCode: point.code,
      inspectedAt: new Date().toISOString(),
      measurements,
      note: note.value.trim() || undefined,
      serial: serial.value.trim() || undefined,
      mac: mac.value.trim() || undefined,
      planId: cached.plan?.id,
      ...(defectTitle.value.trim()
        ? {
            defect: {
              severity: defectSeverity.value,
              title: defectTitle.value.trim(),
              detail: defectDetail.value.trim() || defectTitle.value.trim(),
            },
          }
        : {}),
    };

    saving = true;
    saveBtn.disabled = true;
    try {
      // นี่คือจุดเดียวที่ต้องสำเร็จให้ได้ ถ้าเขียนลงเครื่องไม่ได้ (พื้นที่เต็ม โหมดส่วนตัว ฯลฯ)
      // ห้ามเงียบ เพราะช่างจะเดินจากจุดนั้นไปโดยเชื่อว่างานถูกบันทึกแล้ว
      await enqueue(getDb(), { clientUuid, payload, photos: [...photos.values()] });
    } catch (err) {
      msg.textContent = `บันทึกลงเครื่องไม่สำเร็จ ยังไม่ได้บันทึกผลตรวจนี้ กรุณาลองใหม่ (${err?.message ?? "ไม่ทราบสาเหตุ"})`;
      saving = false;
      saveBtn.disabled = false;
      return;
    }
    await refreshBadge();
    syncNow();
    location.hash = "#/today";
  };
  saveBtn.addEventListener("click", submit);

  root.replaceChildren(
    h("div", { class: "m-top" },
      h("div", {},
        h("b", {}, point.code),
        h("div", { style: "font-size:13px;opacity:.8" }, `${point.buildingName} · ${point.floor} · ${point.room}`)
      ),
      h("button", { onclick: () => { location.hash = "#/today"; } }, "ย้อนกลับ")
    ),
    h("div", { class: "m-body" },
      h("div", { class: "m-form" },
        h("div", { class: "m-field" }, h("label", {}, "Serial Number"), serial),
        h("div", { class: "m-field" }, h("label", {}, "MAC Address"), mac),
        measurementFields,
        h("div", { class: "m-field" },
          h("label", {}, "หลักฐาน"),
          h("div", { class: "hint" }, "ถ่ายให้ครบ 6 ประเภทเมื่อทำได้ ระบบบันทึกได้แม้ยังไม่ครบ"),
          h("div", { class: "m-photos" }, EVIDENCE_ORDER.map((kind) => photoTile(kind, photos)))
        ),
        h("div", { class: "m-field" }, h("label", {}, "หมายเหตุ"), note),
        h("div", { class: "m-field" },
          h("label", {}, "ข้อบกพร่องที่พบ"),
          defectTitle, defectDetail, defectSeverity
        )
      ),
      msg
    ),
    h("div", { class: "m-submit" }, saveBtn)
  );
}
