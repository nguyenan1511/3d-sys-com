// Kiểm tra và chuẩn hóa cấu hình dụng cụ theo equipment.json. Dùng chung client/server.

/** Dùng chung cho mọi cấu hình theo schema (dụng cụ, tạo hình nhân vật). */
export const normalizeBySchema = (schema, input) => normalizeEquipment(schema, input);

export function defaultEquipment(schema) {
  const out = {};
  for (const it of schema.items || []) out[it.key] = it.default;
  return out;
}

/** Trả về { ok, value, errors }. Khóa lạ bị bỏ, khóa thiếu lấy mặc định. */
export function normalizeEquipment(schema, input) {
  const value = {}, errors = [];
  const src = input && typeof input === 'object' ? input : {};
  for (const it of schema.items || []) {
    let v = src[it.key];
    if (v === undefined || v === null) { value[it.key] = it.default; continue; }
    switch (it.type) {
      case 'int': {
        const n = Number(v);
        if (!Number.isInteger(n) || n < (it.min ?? -Infinity) || n > (it.max ?? Infinity)) { errors.push(`${it.label}: phải là số nguyên từ ${it.min} đến ${it.max}.`); v = it.default; } else v = n;
        break;
      }
      case 'bool': if (typeof v !== 'boolean') { errors.push(`${it.label}: phải là có/không.`); v = it.default; } break;
      case 'select': if (!(it.options || []).some(o => o.value === v)) { errors.push(`${it.label}: lựa chọn không hợp lệ.`); v = it.default; } break;
      case 'color': if (v === '' && it.allowEmpty) break; // '' = giữ màu gốc
        if (typeof v !== 'string' || !/^#[0-9a-f]{6}$/i.test(v) || (it.options && !it.options.map(c => c.toLowerCase()).includes(v.toLowerCase()))) { errors.push(`${it.label}: màu không hợp lệ.`); v = it.default; } else v = v.toLowerCase(); break;
      default: v = it.default;
    }
    value[it.key] = v;
  }
  return { ok: errors.length === 0, value, errors };
}
