import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma";
import { CriteriaDef, evaluateMeasurements, MeasurementCheck } from "./criteria";
import { derivePointStatus, evidenceCompleteness, PointStatus } from "./pointStatus";
import { AppError } from "../middleware/error";

export interface PointListRow {
  id: string;
  code: string;
  buildingId: string;
  buildingName: string;
  floor: string;
  room: string;
  deviceModel: string | null;
  serial: string | null;
  mac: string | null;
  status: PointStatus;
  evidenceHave: number;
  evidenceNeed: number;
  openDefects: number;
  lastInspectedAt: string | null;
  lastInspector: string | null;
}

export interface PointListResult {
  rows: PointListRow[];
  total: number;
  page: number;
  pageSize: number;
}

async function loadCriteria(): Promise<CriteriaDef[]> {
  const rows = await prisma.criteria.findMany({ orderBy: { key: "asc" } });
  return rows.map((r) => ({
    key: r.key,
    label: r.label,
    operator: r.operator === "lte" ? "lte" : "gte",
    threshold: r.threshold,
    unit: r.unit,
    torClause: r.torClause,
  }));
}

const pointInclude = {
  building: true,
  defects: { select: { status: true } },
  inspections: {
    orderBy: { inspectedAt: "desc" as const },
    take: 1,
    include: { evidences: { select: { kind: true } }, inspector: { select: { name: true } } },
  },
};

type PointWithRelations = Prisma.PointGetPayload<{ include: typeof pointInclude }>;

function toRow(p: PointWithRelations, defs: CriteriaDef[]): PointListRow {
  const latest = p.inspections[0] ?? null;
  const checks = latest
    ? evaluateMeasurements(defs, (latest.measurements ?? {}) as Record<string, unknown>)
    : [];
  const kinds = latest ? latest.evidences.map((e) => e.kind as string) : [];
  const status = derivePointStatus({
    latestInspection: latest ? { evidenceKinds: kinds, checks } : null,
    defects: p.defects,
  });
  const { have, need } = evidenceCompleteness(kinds);
  return {
    id: p.id,
    code: p.code,
    buildingId: p.buildingId,
    buildingName: p.building.name,
    floor: p.floor,
    room: p.room,
    deviceModel: p.deviceModel,
    serial: p.serial,
    mac: p.mac,
    status,
    evidenceHave: have,
    evidenceNeed: need,
    openDefects: p.defects.filter((d) => d.status === "OPEN").length,
    lastInspectedAt: latest ? latest.inspectedAt.toISOString() : null,
    lastInspector: latest ? latest.inspector.name : null,
  };
}

/**
 * สถานะเป็นค่าที่คำนวณ จึงกรองสถานะในหน่วยความจำหลังดึงข้อมูล
 * ตัวกรองที่เป็นคอลัมน์จริง (ค้นหา/อาคาร) ทำที่ฐานข้อมูลเพื่อลดปริมาณข้อมูล
 */
export async function listPoints(q: {
  search?: string;
  buildingId?: string;
  status?: PointStatus;
  page?: number;
  pageSize?: number;
}): Promise<PointListResult> {
  const page = Math.max(1, q.page ?? 1);
  // ไม่จำกัดเพดานที่ชั้นนี้ เพราะ summary/CSV/PDF เรียกใช้เพื่อดึงทั้งทะเบียน
  // การจำกัดค่าที่ผู้ใช้ส่งเข้ามาทำที่ schema ของ route แทน
  const pageSize = Math.max(1, q.pageSize ?? 50);
  const search = q.search?.trim();

  const where: Prisma.PointWhereInput = {
    ...(q.buildingId ? { buildingId: q.buildingId } : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" } },
            { serial: { contains: search, mode: "insensitive" } },
            { mac: { contains: search, mode: "insensitive" } },
            { room: { contains: search, mode: "insensitive" } },
            { floor: { contains: search, mode: "insensitive" } },
            { building: { name: { contains: search, mode: "insensitive" } } },
          ],
        }
      : {}),
  };

  const defs = await loadCriteria();
  const found = await prisma.point.findMany({ where, include: pointInclude, orderBy: { code: "asc" } });
  const all = found.map((p) => toRow(p, defs));
  const filtered = q.status ? all.filter((r) => r.status === q.status) : all;

  return {
    rows: filtered.slice((page - 1) * pageSize, page * pageSize),
    total: filtered.length,
    page,
    pageSize,
  };
}

export interface PointDetailInspection {
  id: string;
  clientUuid: string;
  inspectedAt: string;
  inspectorName: string;
  note: string | null;
  serial: string | null;
  mac: string | null;
  checks: MeasurementCheck[];
  evidences: { id: string; kind: string; mime: string; capturedAt: string; url: string }[];
}

export async function getPointDetail(pointId: string) {
  const defs = await loadCriteria();
  const point = await prisma.point.findUnique({
    where: { id: pointId },
    include: {
      building: true,
      defects: { orderBy: { createdAt: "desc" } },
      inspections: {
        orderBy: { inspectedAt: "desc" },
        include: { evidences: true, inspector: { select: { name: true } } },
      },
    },
  });
  if (!point) throw new AppError(404, "ไม่พบจุดติดตั้งที่ร้องขอ");

  const inspections: PointDetailInspection[] = point.inspections.map((i) => ({
    id: i.id,
    clientUuid: i.clientUuid,
    inspectedAt: i.inspectedAt.toISOString(),
    inspectorName: i.inspector.name,
    note: i.note,
    serial: i.serial,
    mac: i.mac,
    checks: evaluateMeasurements(defs, (i.measurements ?? {}) as Record<string, unknown>),
    evidences: i.evidences.map((e) => ({
      id: e.id,
      kind: e.kind,
      mime: e.mime,
      capturedAt: e.capturedAt.toISOString(),
      url: `/api/v1/evidence/${e.id}/file`,
    })),
  }));

  const latest = point.inspections[0] ?? null;
  const status = derivePointStatus({
    latestInspection: latest
      ? { evidenceKinds: latest.evidences.map((e) => e.kind as string), checks: inspections[0].checks }
      : null,
    defects: point.defects,
  });

  return {
    id: point.id,
    code: point.code,
    buildingId: point.buildingId,
    buildingName: point.building.name,
    floor: point.floor,
    room: point.room,
    deviceModel: point.deviceModel,
    serial: point.serial,
    mac: point.mac,
    status,
    criteria: defs,
    inspections,
    defects: point.defects.map((d) => ({
      id: d.id,
      severity: d.severity,
      title: d.title,
      detail: d.detail,
      owner: d.owner,
      dueDate: d.dueDate ? d.dueDate.toISOString() : null,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    })),
  };
}
