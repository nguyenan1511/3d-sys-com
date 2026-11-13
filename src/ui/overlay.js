// Lớp phủ toàn màn hình (bảng thông báo, lịch họp, phòng họp…): khi còn ít nhất một lớp đang mở thì body có class
// overlay-open — main.js thôi vẽ cảnh 3D bên dưới (cuộn mượt, không chớp, đỡ tốn pin).
let open = 0;
export function overlayOn() { open++; document.body.classList.add('overlay-open'); }
export function overlayOff() { open = Math.max(0, open - 1); if (!open && !document.querySelector('.intro-back')) document.body.classList.remove('overlay-open'); }
