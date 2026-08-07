import { put, getAll, del } from "./idb.js";

export const BACKOFF_MS = [10000, 30000, 120000, 600000];

function backoffFor(attempts) {
  return BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length - 1)];
}

export async function enqueue(db, item) {
  await put(db, "outbox", {
    clientUuid: item.clientUuid,
    payload: item.payload,
    photos: item.photos ?? [],
    queuedAt: Date.now(),
    attempts: 0,
    nextAttemptAt: 0,
    lastError: null,
  });
  return item.clientUuid;
}

export async function listPending(db) {
  return getAll(db, "outbox");
}

export async function pendingCount(db) {
  return (await getAll(db, "outbox")).length;
}

// กันไม่ให้ flush สองรอบทำงานทับกัน เช่น event online ยิงขึ้นมาระหว่างที่ผู้ใช้กด "ส่งเดี๋ยวนี้"
// ถ้าปล่อยไว้ ทั้งสองรอบจะอ่านแถวเดียวกันที่ยังไม่ถูกลบ แล้วส่งซ้ำจริง ๆ ที่ชั้นเครือข่าย
let flushing = false;

/**
 * ส่งรายการที่ค้างในคิว
 * - ส่งซ้ำได้เสมอ เพราะเซิร์ฟเวอร์ทำ upsert ตาม clientUuid
 * - ล้มเหลวแล้วไม่ลบทิ้ง แต่เลื่อนเวลาส่งครั้งถัดไปแบบถอยห่างขึ้นเรื่อย ๆ
 * - บันทึกความคืบหน้าทีละรูป การส่งใหม่จึงทำต่อจากเดิม ไม่ใช่เริ่มอัปโหลดทั้งชุดซ้ำ
 */
export async function flush(db, sender, now = Date.now()) {
  if (flushing) return { sent: 0, failed: 0, skipped: 0, busy: true };
  flushing = true;
  try {
    const items = await getAll(db, "outbox");
    let sent = 0;
    let failed = 0;
    let skipped = 0;

    for (const item of items) {
      if (item.nextAttemptAt && item.nextAttemptAt > now) {
        skipped += 1;
        continue;
      }
      let progress = item;
      try {
        // ถ้าเคยส่งผลตรวจสำเร็จแล้วแต่มาตกตอนอัปโหลดรูป ไม่ต้องส่งผลตรวจซ้ำอีก
        const inspectionId =
          progress.inspectionId ?? (await sender.submit(progress.payload)).inspectionId;
        if (progress.inspectionId !== inspectionId) {
          progress = { ...progress, inspectionId };
          await put(db, "outbox", progress);
        }

        // เก็บความคืบหน้าหลังอัปโหลดสำเร็จทีละรูป
        // ไม่งั้นรูปที่ขึ้นไปแล้วจะถูกอัปโหลดซ้ำและเกิดหลักฐานซ้ำบนเซิร์ฟเวอร์
        while ((progress.photos ?? []).length > 0) {
          await sender.upload(inspectionId, progress.photos[0]);
          progress = { ...progress, photos: progress.photos.slice(1) };
          await put(db, "outbox", progress);
        }

        await del(db, "outbox", progress.clientUuid);
        sent += 1;
      } catch (err) {
        const attempts = (progress.attempts ?? 0) + 1;
        await put(db, "outbox", {
          ...progress,
          attempts,
          nextAttemptAt: now + backoffFor(attempts - 1),
          lastError: String(err?.message ?? err),
        });
        failed += 1;
      }
    }

    return { sent, failed, skipped };
  } finally {
    flushing = false;
  }
}
