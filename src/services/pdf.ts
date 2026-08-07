import path from "path";
import PdfPrinter from "pdfmake";
import type { TDocumentDefinitions } from "pdfmake/interfaces";
import { prisma } from "../lib/prisma";
import { buildSummary } from "./summary";
import { listPoints } from "./pointQuery";

const FONT_DIR = path.join(__dirname, "..", "..", "public", "fonts");

const printer = new PdfPrinter({
  Sarabun: {
    normal: path.join(FONT_DIR, "Sarabun-Regular.ttf"),
    bold: path.join(FONT_DIR, "Sarabun-Bold.ttf"),
    italics: path.join(FONT_DIR, "Sarabun-Regular.ttf"),
    bolditalics: path.join(FONT_DIR, "Sarabun-Bold.ttf"),
  },
});

const SEVERITY_TH: Record<string, string> = { URGENT: "เร่งด่วน", MAJOR: "สำคัญ", MINOR: "ทั่วไป" };

export async function buildCommitteePdf(): Promise<Buffer> {
  const project = await prisma.project.findFirst();
  const summary = await buildSummary();
  const { rows } = await listPoints({ page: 1, pageSize: 100000 });
  const defects = await prisma.defect.findMany({
    where: { status: { not: "CLOSED" } },
    orderBy: [{ severity: "asc" }, { createdAt: "asc" }],
    include: { point: { include: { building: true } } },
  });
  const flagged = rows.filter((r) => r.status === "DEFECT" || r.status === "UNDER_REVIEW");

  const doc: TDocumentDefinitions = {
    defaultStyle: { font: "Sarabun", fontSize: 11 },
    pageMargins: [40, 50, 40, 60],
    footer: (page, count) => ({
      columns: [
        { text: "เอกสารประกอบการพิจารณาของคณะกรรมการตรวจรับ ไม่ใช่คำวินิจฉัยของระบบ", fontSize: 8, color: "#666666" },
        { text: `หน้า ${page} / ${count}`, alignment: "right", fontSize: 8, color: "#666666" },
      ],
      margin: [40, 10, 40, 0],
    }),
    content: [
      { text: "รายงานสรุปผลการตรวจรับระบบเครือข่ายไร้สาย", style: "h1" },
      { text: project?.name ?? "-", margin: [0, 0, 0, 2] },
      { text: `เลขที่สัญญา: ${project?.contractNo ?? "-"} · อ้างอิง: ${project?.torRef ?? "-"}`, fontSize: 10, color: "#555555" },
      { text: `วันที่ออกรายงาน: ${new Date().toLocaleDateString("th-TH")}`, fontSize: 10, color: "#555555", margin: [0, 0, 0, 14] },

      {
        table: {
          widths: ["*", "auto"],
          body: [
            [{ text: "รายการ", bold: true }, { text: "จำนวน (จุด)", bold: true, alignment: "right" }],
            ["จุดติดตั้งทั้งหมด", { text: String(summary.total), alignment: "right" }],
            ["ตรวจแล้ว", { text: String(summary.inspected), alignment: "right" }],
            ["ยังไม่ได้ตรวจ", { text: String(summary.pending), alignment: "right" }],
            ["หลักฐานครบตามแบบตรวจ", { text: String(summary.evidenceComplete), alignment: "right" }],
            ["มีข้อบกพร่องคงค้าง", { text: String(summary.withDefects), alignment: "right" }],
            ["รอตรวจซ้ำ", { text: String(summary.awaitingRetest), alignment: "right" }],
          ],
        },
        layout: "lightHorizontalLines",
        margin: [0, 0, 0, 16],
      },

      { text: "จุดที่ต้องพิจารณา", style: "h2" },
      flagged.length === 0
        ? { text: "ไม่มีจุดที่ต้องพิจารณาเพิ่มเติม", italics: true, margin: [0, 0, 0, 14] }
        : {
            table: {
              headerRows: 1,
              widths: ["auto", "*", "auto", "auto"],
              body: [
                [
                  { text: "รหัสจุด", bold: true },
                  { text: "สถานที่", bold: true },
                  { text: "หลักฐาน", bold: true },
                  { text: "ข้อบกพร่อง", bold: true },
                ],
                // ไม่ตัดรายการ เอกสารนี้คือฐานการพิจารณาของกรรมการ
                // การซ่อนจุดที่เกินโควตาโดยไม่บอก คือข้อบกพร่องเดียวกับที่ระบบนี้ตั้งใจมาแก้
                ...flagged.map((r) => [
                  r.code,
                  `${r.buildingName} ${r.floor} ${r.room}`,
                  `${r.evidenceHave}/${r.evidenceNeed}`,
                  String(r.openDefects),
                ]),
              ],
            },
            layout: "lightHorizontalLines",
            fontSize: 9,
            margin: [0, 0, 0, 16],
          },

      { text: "ข้อบกพร่องคงค้าง (NCR)", style: "h2" },
      defects.length === 0
        ? { text: "ไม่มีข้อบกพร่องคงค้าง", italics: true, margin: [0, 0, 0, 14] }
        : {
            table: {
              headerRows: 1,
              widths: ["auto", "auto", "*", "auto"],
              body: [
                [
                  { text: "ระดับ", bold: true },
                  { text: "จุด", bold: true },
                  { text: "รายละเอียด", bold: true },
                  { text: "กำหนดเสร็จ", bold: true },
                ],
                ...defects.map((d) => [
                  SEVERITY_TH[d.severity] ?? d.severity,
                  d.point.code,
                  `${d.title} — ${d.detail}`,
                  d.dueDate ? d.dueDate.toLocaleDateString("th-TH") : "-",
                ]),
              ],
            },
            layout: "lightHorizontalLines",
            fontSize: 9,
            margin: [0, 0, 0, 20],
          },

      {
        text: "ข้อมูลในเอกสารนี้เป็นผลบันทึกจากการตรวจภาคสนามเทียบกับเกณฑ์ที่อ้างอิงจาก TOR/สัญญา ระบบไม่ได้วินิจฉัยว่างานผ่านการตรวจรับ การพิจารณาเป็นอำนาจของคณะกรรมการตรวจรับพัสดุ",
        fontSize: 9,
        color: "#7a5c00",
        margin: [0, 0, 0, 24],
      },

      {
        columns: [
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(ประธานกรรมการตรวจรับ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(กรรมการ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
          { stack: [{ text: "ลงชื่อ ........................................" }, { text: "(กรรมการ)", fontSize: 9, margin: [0, 4, 0, 0] }] },
        ],
        columnGap: 16,
      },
    ],
    styles: {
      h1: { fontSize: 18, bold: true, margin: [0, 0, 0, 6] },
      h2: { fontSize: 13, bold: true, margin: [0, 8, 0, 6] },
    },
  };

  const pdf = printer.createPdfKitDocument(doc);
  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on("data", (c: Buffer) => chunks.push(c));
    pdf.on("end", () => resolve(Buffer.concat(chunks)));
    pdf.on("error", reject);
    pdf.end();
  });
}
