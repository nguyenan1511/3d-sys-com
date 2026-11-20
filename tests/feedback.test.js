// Góp ý & báo lỗi (server/feedback.js): nhân viên tạo cuộc + nhắn kèm ảnh; chỉ chủ cuộc và Admin xem được; chưa đọc; trạng thái; xoá dọn ảnh.
import { describe, it, expect } from 'vitest';
import { openDb } from '../server/db.js';
import { MemBlobs, QuotaBlobs } from '../server/blobs.js';
import { Feedback } from '../server/feedback.js';

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4a00000000049454e44ae426082', 'hex');
const A = { kind: 'employee', code: '1001' }, B = { kind: 'employee', code: '1002' }, ADM = { kind: 'admin', username: 'admin' };
const make = async () => { const db = openDb(); db.blobs = await new QuotaBlobs(new MemBlobs(), 10e6).init(); return { db, F: new Feedback({ db }, k => k.replace('employee:', '') + '-Tên') }; };

describe('góp ý & báo lỗi', () => {
  it('tạo cuộc (chữ + ảnh), Admin thấy chưa đọc, trả lời → người gửi thấy chưa đọc', async () => {
    const { db, F } = await make();
    const { thread, msg } = await F.create(A, { kind: 'bug', text: '  Bảng vẽ không hiện ảnh  ', image: { type: 'image/png', data: PNG.toString('base64') } });
    expect(F.view(thread, A)).toMatchObject({ kind: 'bug', status: 'open', ownerName: '1001-Tên', preview: 'Bảng vẽ không hiện ảnh', unread: false, count: 1 });
    expect(F.msgView(msg).image).toMatch(/^\/api\/feedback\/\d+\/img\/\d+\?v=\d+$/);
    expect((await F.image(ADM, thread.id, msg.id)).data.equals(PNG)).toBe(true);
    expect(F.list(ADM)[0].unread).toBe(true);
    F.messages(ADM, thread.id); expect(F.list(ADM)[0].unread).toBe(false);   // (mở là đã đọc)
    await F.add(ADM, thread.id, { text: 'Đã sửa, bạn thử lại nhé' });
    expect(F.list(A)[0]).toMatchObject({ unread: true, lastBy: 'admin', preview: 'Đã sửa, bạn thử lại nhé' });
    expect(F.messages(A, thread.id).messages.map(m => [m.admin, m.byName])).toEqual([[false, '1001-Tên'], [true, 'Admin']]);
    expect(db.blobs.usage().used).toBe(PNG.length);
  });
  it('người khác không xem / nhắn / xem ảnh được; Admin không tự tạo cuộc; nội dung rỗng / ảnh giả bị chặn', async () => {
    const { F } = await make();
    const { thread, msg } = await F.create(A, { kind: 'idea', text: 'Thêm máy pha cà phê', image: { type: 'image/png', data: PNG.toString('base64') } });
    expect(F.list(B)).toEqual([]);
    expect(() => F.messages(B, thread.id)).toThrow(expect.objectContaining({ status: 404 }));
    await expect(F.add(B, thread.id, { text: 'xen vào' })).rejects.toMatchObject({ status: 404 });
    await expect(F.image(B, thread.id, msg.id)).rejects.toMatchObject({ status: 404 });
    await expect(F.create(ADM, { kind: 'idea', text: 'x' })).rejects.toMatchObject({ status: 403 });
    await expect(F.create(A, { kind: 'khac', text: 'x' })).rejects.toMatchObject({ status: 400 });
    await expect(F.add(A, thread.id, { text: '   ' })).rejects.toMatchObject({ status: 400 });
    await expect(F.add(A, thread.id, { image: { type: 'image/png', data: Buffer.from('<svg onload=alert(1)>').toString('base64') } })).rejects.toMatchObject({ status: 400 });
    await expect(F.add(A, thread.id, { text: 'x'.repeat(2001) })).rejects.toMatchObject({ status: 400 });
  });
  it('trạng thái: Admin đánh dấu đã xử lý / mở lại; người gửi nhắn tiếp thì tự mở lại; chỉ Admin xoá — xoá dọn cả ảnh', async () => {
    const { db, F } = await make();
    const { thread } = await F.create(A, { kind: 'bug', text: 'Lỗi', image: { type: 'image/png', data: PNG.toString('base64') } });
    expect(F.setStatus(ADM, thread.id, 'done').status).toBe('done');
    expect(() => F.setStatus(A, thread.id, 'open')).toThrow(expect.objectContaining({ status: 403 }));
    await F.add(A, thread.id, { text: 'Vẫn còn lỗi' });
    expect(db.feedback_threads.get(thread.id).status).toBe('open');
    await expect(F.remove(A, thread.id)).rejects.toMatchObject({ status: 403 });
    await F.remove(ADM, thread.id);
    expect(db.feedback_threads.count()).toBe(0); expect(db.feedback_messages.count()).toBe(0); expect(db.blobs.usage().used).toBe(0);
  });
});
