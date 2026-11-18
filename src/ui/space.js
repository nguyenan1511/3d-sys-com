// "Không gian" dùng chung của phòng họp và phòng dự án (docs/design/projects-workspace.md): mã phòng là số (cuộc họp) hoặc
// "p<id>" (dự án). Bảng vẽ (src/ui/excaliBoard.js), tài liệu, chat của phòng lấy đường dẫn API / kênh chat theo mã này.
export const isProjectRoom = id => typeof id === 'string' && /^p\d+$/.test(id);
/** Gốc API của không gian: /api/meetings/12 hoặc /api/projects/5. */
export const spaceBase = id => isProjectRoom(id) ? `/api/projects/${id.slice(1)}` : `/api/meetings/${id}`;
/** Kênh chat riêng: meet:12 hoặc proj:5. */
export const spaceChannel = id => isProjectRoom(id) ? `proj:${id.slice(1)}` : `meet:${id}`;
