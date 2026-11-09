import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { normalizeBySchema, defaultEquipment } from '../src/shared/equipment.js';
import { custom } from '../src/pixel/billboard.js';

const schema = JSON.parse(readFileSync('public/data/appearance.json', 'utf8'));
const pixels = JSON.parse(readFileSync('public/data/pixel-characters.json', 'utf8'));
const base = (Array.isArray(pixels) ? pixels : pixels.characters)[0];

describe('tuỳ chỉnh nhân vật — 2D và 3D tách riêng', () => {
  it('mặc định để trống = giữ màu gốc; hợp lệ khi lưu', () => {
    const r = normalizeBySchema(schema, defaultEquipment(schema));
    expect(r.ok).toBe(true);
    for (const k of ['pxHairColor', 'pxSkinColor', 'pxTopColor', 'pxBottomColor', 'pxShoeColor', 'hairColor', 'skinColor', 'topColor', 'bottomColor', 'shoeColor']) expect(r.value[k], k).toBe('');
  });
  it('nhận màu trong bảng màu, từ chối màu ngoài bảng và kiểu áo lạ', () => {
    const ok = normalizeBySchema(schema, { hairColor: '#C68642', topColor: '#1f4e9c' });
    expect(ok.ok).toBe(true); expect(ok.value.hairColor).toBe('#c68642');
    const bad = normalizeBySchema(schema, { hairColor: '#123456' });
    expect(bad.ok).toBe(false); expect(bad.value.hairColor).toBe('');
    expect(schema.items.some(i => /TopStyle|topStyle/.test(i.key))).toBe(false); // đã bỏ chọn kiểu áo
  });
  it('ghi đè lên nhân vật pixel gốc, không đổi bản gốc', () => {
    const s = custom(base, { pxHairColor: '#e6c27a', pxSkinColor: '', pxTopColor: '#e63946', pxTopStyle: 'dress', pxBottomColor: '#ffffff', pxShoeColor: '#111111', topColor: '#1f4e9c' });
    expect(s).not.toBe(base);
    expect(s).toMatchObject({ hair: '#e6c27a', skin: base.skin, shirt: '#e63946', pants: '#ffffff', shoes: '#111111', dress: true, style: 'dress' });
    expect(s.id).not.toBe(base.id);
    expect(custom(base, { pxHairColor: '', topColor: '#e63946' })).toBe(base); // màu của bản 3D không ảnh hưởng nhân vật 2D
  });
});

describe('danh sách nhân vật', () => {
  it('2D và 3D: cùng bộ nhân vật my-office', () => {
    const it2 = schema.items.find(i => i.key === 'pixel'), it3 = schema.items.find(i => i.key === 'model');
    expect(it2.options.map(o => o.value)).toEqual(['mo-nam', 'mo-nu', 'mo-nu-bob', 'mo-dev', 'mo-toy']);
    expect(it3.options.map(o => o.value)).toEqual(['mo-nam', 'mo-nu', 'mo-nu-bob', 'mo-dev', 'mo-toy']);
    const defs = JSON.parse(readFileSync('public/data/characters.json', 'utf8')).characters;
    expect(defs.every(d => d.format === 'mo')).toBe(true); // chỉ nhân vật của my-office
    for (const d of defs.filter(d => !['chibi', 'mo'].includes(d.format))) expect(d.logo || d.rig?.logo, d.id + ' có logo SYSONE').toBeTruthy(); // chibi: logo dựng sẵn trên áo
  });
});
