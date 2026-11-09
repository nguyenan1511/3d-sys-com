// Hệ thống phòng ban SYSONE và chỗ của từng phòng trong toà nhà (dùng chung: bộ sinh bố cục, người hướng dẫn, bản đồ).
// Mỗi cụm 4 bàn làm việc của nội thất my-office thuộc một phòng ban. Danh sách thành viên cụ thể cập nhật sau
// (employees.json / CSV); bàn trống của phòng nào thì người mới thuộc phòng đó được dẫn tới.
//
//   Tầng trệt — khu làm việc chung: Hành chính - Nhân sự (cạnh lễ tân), Tài chính - Kế toán, Team Fresher (gần sảnh)
//   Tầng 2   — 4 phòng: Phát triển ứng dụng (cả phòng) · Mobile App + Data Backbone · Phân tích nghiệp vụ + Triển khai ·
//              Hệ thống + Security
//   Tầng 3   — phòng làm việc trên sân thượng: Ban giám đốc · Team Đối tác · Team Cộng tác viên
export const DEPARTMENTS = [
  { id: 'ctv', name: 'Team Cộng Tác Viên', floor: 2, desks: ['T3-07', 'T3-08', 'T3-09'], color: '#8d6cab' },
  { id: 'bgd', name: 'Ban giám đốc', floor: 2, desks: ['T3-01', 'T3-02', 'T3-03'], color: '#202124' },
  { id: 'hcns', name: 'Phòng Hành chính - Nhân sự', floor: 0, desks: ['T1-01', 'T1-02', 'T1-03', 'T1-04', 'LT-01'], color: '#e07a5f' },
  { id: 'tk', name: 'Phòng Triển khai', floor: 1, desks: ['T2-21', 'T2-22', 'T2-23', 'T2-24'], color: '#3d8b6d' },
  { id: 'tckt', name: 'Phòng Tài chính - Kế toán', floor: 0, desks: ['T1-05', 'T1-06', 'T1-07', 'T1-08'], color: '#c9a227' },
  { id: 'ptnv', name: 'Phòng Phân tích nghiệp vụ', floor: 1, desks: ['T2-17', 'T2-18', 'T2-19', 'T2-20'], color: '#577590' },
  { id: 'ptud', name: 'Phòng Phát triển ứng dụng', floor: 1, desks: ['T2-01', 'T2-02', 'T2-03', 'T2-04', 'T2-05', 'T2-06', 'T2-07', 'T2-08'], color: '#1b4fa0' },
  { id: 'mobile', name: 'Phòng Mobile App', floor: 1, desks: ['T2-09', 'T2-10', 'T2-11', 'T2-12'], color: '#f3722c' },
  { id: 'data', name: 'Phòng Data Backbone', floor: 1, desks: ['T2-13', 'T2-14', 'T2-15', 'T2-16'], color: '#4d908e' },
  { id: 'ht', name: 'Phòng Hệ thống', floor: 1, desks: ['T2-25', 'T2-26', 'T2-27', 'T2-28'], color: '#6c757d' },
  { id: 'dt', name: 'Team Đối tác', floor: 2, desks: ['T3-04', 'T3-05', 'T3-06'], color: '#b56576' },
  { id: 'sec', name: 'Phòng Security', floor: 1, desks: ['T2-29', 'T2-30', 'T2-31', 'T2-32'], color: '#9b2226' },
  { id: 'fresher', name: 'Team Fresher', floor: 0, desks: ['T1-09', 'T1-10', 'T1-11', 'T1-12'], color: '#43aa8b' }
];
export const FLOOR_NAMES = ['tầng trệt', 'tầng 2', 'tầng 3'];
/** Tên phòng của các phòng (bản đồ 2D, bản đồ nhỏ) theo phòng ban ngồi trong đó. */
export const ROOM_NAMES = { dev: 'HC-NS · TC-KT · Fresher', dept1: 'Phát triển ứng dụng', dept2: 'Mobile App · Data Backbone', dept3: 'Phân tích nghiệp vụ · Triển khai', dept4: 'Hệ thống · Security', cozy: 'Ban giám đốc · Đối tác · CTV' };

const norm = s => String(s || '').normalize('NFC').toLowerCase().replace(/^(phòng|team|ban)\s+/u, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
/** Phòng ban theo tên (không phân biệt hoa thường, bỏ tiền tố "Phòng"/"Team"), id, hoặc null. */
export function findDepartment(name) {
  if (!name) return null;
  const n = norm(name);
  return DEPARTMENTS.find(d => d.id === name || norm(d.name) === n) || DEPARTMENTS.find(d => n && (norm(d.name).includes(n) || n.includes(norm(d.name)))) || null;
}
export const departmentOfDesk = id => DEPARTMENTS.find(d => d.desks.includes(id)) || null;

/** Việc tuần đầu người hướng dẫn giao cho người mới (chung + theo phòng). */
const COMMON = ['Nhận laptop, thẻ ra vào và tài khoản email công ty', 'Đọc nội quy và quy định bảo mật thông tin của SYSONE', 'Gặp trưởng phòng để nhận mục tiêu tháng đầu'];
const BY_DEPT = {
  ctv: ['Ký hợp đồng cộng tác và thống nhất lịch làm việc', 'Nhận đầu việc đầu tiên từ phòng phụ trách'],
  bgd: ['Xem báo cáo tổng hợp các phòng ban tuần trước', 'Lịch họp giao ban với trưởng các phòng'],
  hcns: ['Nắm quy trình tiếp nhận nhân sự mới', 'Cập nhật hồ sơ nhân sự và chấm công'],
  tk: ['Đọc tài liệu triển khai của dự án đang chạy', 'Đi cùng đồng nghiệp một buổi triển khai tại khách hàng'],
  tckt: ['Làm quen phần mềm kế toán và quy trình thanh toán', 'Xem kế hoạch ngân sách quý này'],
  ptnv: ['Đọc tài liệu đặc tả nghiệp vụ của sản phẩm chính', 'Dự một buổi lấy yêu cầu với khách hàng'],
  ptud: ['Cài môi trường phát triển và clone mã nguồn', 'Nhận task đầu tiên trên bảng công việc của nhóm'],
  mobile: ['Cài môi trường build iOS / Android', 'Chạy thử ứng dụng mobile trên máy thật'],
  data: ['Nhận quyền truy cập kho dữ liệu và pipeline', 'Đọc sơ đồ luồng dữ liệu của hệ thống'],
  ht: ['Nhận quyền truy cập hệ thống giám sát', 'Đọc quy trình trực vận hành và xử lý sự cố'],
  dt: ['Xem danh sách đối tác đang hợp tác', 'Nắm quy trình làm việc và đầu mối với đối tác'],
  sec: ['Đọc chính sách an toàn thông tin', 'Làm quen công cụ quét lỗ hổng và quy trình báo cáo'],
  fresher: ['Tham gia khoá đào tạo nhập môn tuần đầu', 'Gặp người hướng dẫn (mentor) và nhận bài tập đầu tiên']
};
export const onboardingTasks = dept => [...COMMON, ...(BY_DEPT[dept?.id] || [])];

/** Nhân vật CEO: cố định (không chỉnh được) — bộ vest tối, sơ mi trắng, cà vạt đỏ, đeo kính (nhân vật "Sếp" của my-office). */
export const CEO_LOOK = { model: 'mo-sep', pixel: 'mo-sep' };
