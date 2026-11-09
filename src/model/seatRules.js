// Nhân viên mô phỏng (employees.json) cũng phải tuân theo chủ chỗ thật (server):
// bàn đã có chủ thật hoặc bị khóa thì người mô phỏng nhường bàn, chuyển sang bàn trống; hết bàn thì không vào mô hình.

/** seats: danh sách seatView từ server. Trả về { data, notes } với data là bản sao employees.json đã điều chỉnh. */
export function applySeatRules(model, empData, seats) {
  const taken = new Map();
  for (const s of seats || []) if (s.owner || s.locked) taken.set(s.deskId, s.owner ? s.owner.display : 'đang khóa');
  const data = { ...empData, employees: [] };
  const notes = [];
  const used = new Set();
  const list = empData.employees || [];
  for (const e of list) if (e.deskId && !taken.has(e.deskId) && model.deskById.has(e.deskId)) used.add(e.deskId);
  const free = model.desks.filter(d => d.kind !== 'reception' && !taken.has(d.id) && !used.has(d.id)).map(d => d.id);
  for (const e of list) {
    if (!e.deskId || !taken.has(e.deskId)) { data.employees.push(e); continue; }
    const owner = taken.get(e.deskId);
    const alt = free.shift();
    if (alt) { data.employees.push({ ...e, deskId: alt }); notes.push(`Mô phỏng: ${e.name} nhường bàn ${e.deskId} (${owner}), chuyển sang ${alt}.`); }
    else notes.push(`Mô phỏng: ${e.name} không còn bàn vì ${e.deskId} ${owner === 'đang khóa' ? 'đang khóa' : `thuộc về ${owner}`}; tạm không đưa vào mô hình.`);
  }
  return { data, notes };
}
