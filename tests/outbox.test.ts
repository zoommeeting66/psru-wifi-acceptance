import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import "fake-indexeddb/auto";
import { openDb, getAll, clear } from "../public/js/offline/idb.js";
import { enqueue, flush, pendingCount, BACKOFF_MS } from "../public/js/offline/outbox.js";

function item(uuid: string, photos = 1) {
  return {
    clientUuid: uuid,
    payload: { clientUuid: uuid, pointCode: "AP-0001", inspectedAt: new Date().toISOString(), measurements: { rssi: -50 } },
    photos: Array.from({ length: photos }, (_, i) => ({ kind: "LOCATION", blob: new Blob([`p${i}`]), capturedAt: new Date().toISOString() })),
  };
}

function okSender() {
  const submitted: string[] = [];
  const uploaded: string[] = [];
  return {
    submitted,
    uploaded,
    async submit(payload: { clientUuid: string }) {
      submitted.push(payload.clientUuid);
      return { inspectionId: `ins-${payload.clientUuid}` };
    },
    async upload(inspectionId: string) {
      uploaded.push(inspectionId);
    },
  };
}

let db: IDBDatabase;

describe("offline outbox", () => {
  // เปิดฐานข้อมูลครั้งเดียวแล้วล้างเฉพาะข้อมูลก่อนแต่ละเทสต์
  // ห้ามใช้ deleteDatabase ที่นี่ เพราะถ้ายังมี connection เปิดค้างอยู่
  // คำสั่งลบจะถูกบล็อกและ hook จะค้างจนหมดเวลา
  beforeAll(async () => {
    db = await openDb("psru_wifi_test_store", 1);
  });

  afterAll(() => {
    (db as unknown as { close(): void }).close();
  });

  beforeEach(async () => {
    await clear(db, "outbox");
  });

  it("queues an item and reports it as pending", async () => {
    await enqueue(db, item("a"));
    expect(await pendingCount(db)).toBe(1);
  });

  it("sends queued items and clears them", async () => {
    await enqueue(db, item("a"));
    await enqueue(db, item("b"));
    const sender = okSender();
    const result = await flush(db, sender);
    expect(result.sent).toBe(2);
    expect(await pendingCount(db)).toBe(0);
    expect(sender.submitted.sort()).toEqual(["a", "b"]);
  });

  it("uploads every photo attached to an item", async () => {
    await enqueue(db, item("a", 3));
    const sender = okSender();
    await flush(db, sender);
    expect(sender.uploaded).toHaveLength(3);
  });

  it("keeps an item queued when the send fails and applies backoff", async () => {
    await enqueue(db, item("a"));
    const failing = {
      async submit() { throw new Error("offline"); },
      async upload() {},
    };
    const result = await flush(db, failing, 1_000_000);
    expect(result.failed).toBe(1);
    expect(await pendingCount(db)).toBe(1);

    const [row] = await getAll(db, "outbox");
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt).toBe(1_000_000 + BACKOFF_MS[0]);
    expect(row.lastError).toBeTruthy();
  });

  it("skips an item that is still inside its backoff window", async () => {
    await enqueue(db, item("a"));
    const failing = { async submit() { throw new Error("offline"); }, async upload() {} };
    await flush(db, failing, 1_000_000);

    const sender = okSender();
    const tooSoon = await flush(db, sender, 1_000_001);
    expect(tooSoon.skipped).toBe(1);
    expect(sender.submitted).toHaveLength(0);

    const later = await flush(db, sender, 1_000_000 + BACKOFF_MS[0] + 1);
    expect(later.sent).toBe(1);
  });

  it("survives replay: flushing twice never sends the same item twice", async () => {
    await enqueue(db, item("a"));
    const sender = okSender();
    await flush(db, sender);
    await flush(db, sender);
    expect(sender.submitted).toEqual(["a"]);
  });

  it("resumes photo uploads instead of re-uploading ones that already landed", async () => {
    await enqueue(db, item("a", 3));

    const uploaded: string[] = [];
    let submits = 0;
    const failsOnSecondPhoto = {
      async submit() {
        submits += 1;
        return { inspectionId: "ins-a" };
      },
      async upload(_id: string, photo: { blob: Blob }) {
        const tag = await photo.blob.text();
        if (tag === "p1" && !uploaded.includes("p1-retry")) {
          uploaded.push("p1-retry");
          throw new Error("upload failed");
        }
        uploaded.push(tag);
      },
    };

    const first = await flush(db, failsOnSecondPhoto, 1_000_000);
    expect(first.failed).toBe(1);
    expect(uploaded).toEqual(["p0", "p1-retry"]);

    const [queued] = await getAll(db, "outbox");
    expect(queued.inspectionId).toBe("ins-a");
    expect(queued.photos).toHaveLength(2);

    const second = await flush(db, failsOnSecondPhoto, 1_000_000 + BACKOFF_MS[0] + 1);
    expect(second.sent).toBe(1);
    expect(submits).toBe(1);
    expect(uploaded).toEqual(["p0", "p1-retry", "p1", "p2"]);
    expect(await pendingCount(db)).toBe(0);
  });

  it("does not double-send when two flushes overlap", async () => {
    await enqueue(db, item("a"));

    const sender = okSender();
    const slow = {
      submitted: sender.submitted,
      async submit(payload: { clientUuid: string }) {
        await new Promise((r) => setTimeout(r, 20));
        return sender.submit(payload);
      },
      async upload(inspectionId: string) {
        return sender.upload(inspectionId);
      },
    };

    const [a, b] = await Promise.all([flush(db, slow), flush(db, slow)]);

    expect(sender.submitted).toEqual(["a"]);
    expect([a.sent, b.sent].sort()).toEqual([0, 1]);
    expect(await pendingCount(db)).toBe(0);
  });

  it("never drops an item after repeated failures", async () => {
    await enqueue(db, item("a"));
    const failing = { async submit() { throw new Error("offline"); }, async upload() {} };
    let t = 1_000_000;
    for (let i = 0; i < 8; i += 1) {
      await flush(db, failing, t);
      t += 3_600_000;
    }
    expect(await pendingCount(db)).toBe(1);
  });
});
