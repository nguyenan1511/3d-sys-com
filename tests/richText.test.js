// Ô soạn thảo bảng tin (src/ui/richText.js): Markdown gọn → HTML an toàn; chữ thuần cho bảng 3D.
import { describe, it, expect } from 'vitest';
import { mdToHtml, mdToText } from '../src/ui/richText.js';

describe('richText', () => {
  it('định dạng: đậm, nghiêng, gạch chân, gạch ngang, tiêu đề, danh sách, liên kết', () => {
    const h = mdToHtml('## Tiệc cuối năm\n**Đậm** *nghiêng* __gạch__ ~~bỏ~~\n- Một\n- Hai\n1. A\n2. B\n[Đăng ký](https://forms.sysone.vn/x) và https://sysone.vn');
    expect(h).toContain('<h4>Tiệc cuối năm</h4>');
    expect(h).toContain('<b>Đậm</b> <i>nghiêng</i> <u>gạch</u> <s>bỏ</s>');
    expect(h).toContain('<ul><li>Một</li><li>Hai</li></ul><ol><li>A</li><li>B</li></ol>');
    expect(h).toContain('<a href="https://forms.sysone.vn/x" target="_blank" rel="noopener noreferrer">Đăng ký</a>');
    expect(h).toContain('<a href="https://sysone.vn"');
  });
  it('an toàn: HTML / script bị escape, liên kết javascript: không thành thẻ a', () => {
    const h = mdToHtml('<img src=x onerror=alert(1)> [x](javascript:alert(1)) **<script>**');
    expect(h).not.toMatch(/<img|<script|href="javascript/i);
    expect(h).toContain('&lt;img');
  });
  it('chữ thuần cho bảng 3D / đoạn trích', () => {
    expect(mdToText('## Tiêu đề\n**Đậm** và [link](https://a.vn)\n- Một')).toBe('Tiêu đề\nĐậm và link\n• Một');
  });
});

describe('richText: ảnh trong nội dung', () => {
  it('chỉ hiện ảnh đã tải lên server của app; ảnh ngoài / javascript bị bỏ; chữ thuần bỏ ảnh', () => {
    const ok = '/api/board/img/mi4abc12-0123456789ab';
    expect(mdToHtml(`Xem ảnh:\n![](${ok})`)).toContain(`<p class="rt-imgp"><img class="rt-img" src="${ok}" alt="Ảnh" loading="lazy" decoding="async"></p>`);
    expect(mdToHtml('![](https://evil.example/x.png) ![](javascript:alert(1))')).not.toMatch(/<img/);
    expect(mdToText(`Tiệc\n![](${ok})\nnhé`)).toBe('Tiệc\n\nnhé');
  });
});

describe('richText: màu chữ / tô nền', () => {
  it('chỉ nhận màu trong bảng màu; chữ thuần bỏ mã màu', () => {
    expect(mdToHtml('Hạn chót {c:red}**thứ Sáu**{/c} · {h:yellow}quan trọng{/h}')).toContain('<span class="rt-c-red"><b>thứ Sáu</b></span> · <mark class="rt-h-yellow">quan trọng</mark>');
    expect(mdToHtml('{c:#f00}x{/c} {c:red" onclick="a}y{/c}')).not.toMatch(/<span|onclick="a/);
    expect(mdToText('{c:red}Gấp{/c} {h:pink}nhé{/h}')).toBe('Gấp nhé');
  });
});
