// (25/09/2026) Am lich Viet Nam — thuat toan cua Ho Ngoc Duc (https://www.informatik.uni-leipzig.de/~duc/amlich/),
// mui gio +7. Dung chung: launcher (tiem vao moi trang, ngay am o dau menu) va calendar.html (/lunar.js).
// KHONG dung dau "\" hay "${" trong file nay: no duoc chen nguyen van vao template string cua launcher (TypeScript).
(function (g) {
  if (g.RwvLunar) return;
  var PI = Math.PI;
  function INT(d) { return Math.floor(d); }
  function jdFromDate(dd, mm, yy) {
    var a = INT((14 - mm) / 12), y = yy + 4800 - a, m = mm + 12 * a - 3;
    var jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - INT(y / 100) + INT(y / 400) - 32045;
    if (jd < 2299161) jd = dd + INT((153 * m + 2) / 5) + 365 * y + INT(y / 4) - 32083;
    return jd;
  }
  function newMoon(k) {
    var T = k / 1236.85, T2 = T * T, T3 = T2 * T, dr = PI / 180;
    var Jd1 = 2415020.75933 + 29.53058868 * k + 0.0001178 * T2 - 0.000000155 * T3;
    Jd1 = Jd1 + 0.00033 * Math.sin((166.56 + 132.87 * T - 0.009173 * T2) * dr);
    var M = 359.2242 + 29.10535608 * k - 0.0000333 * T2 - 0.00000347 * T3;
    var Mpr = 306.0253 + 385.81691806 * k + 0.0107306 * T2 + 0.00001236 * T3;
    var F = 21.2964 + 390.67050646 * k - 0.0016528 * T2 - 0.00000239 * T3;
    var C1 = (0.1734 - 0.000393 * T) * Math.sin(M * dr) + 0.0021 * Math.sin(2 * dr * M);
    C1 = C1 - 0.4068 * Math.sin(Mpr * dr) + 0.0161 * Math.sin(dr * 2 * Mpr);
    C1 = C1 - 0.0004 * Math.sin(dr * 3 * Mpr);
    C1 = C1 + 0.0104 * Math.sin(dr * 2 * F) - 0.0051 * Math.sin(dr * (M + Mpr));
    C1 = C1 - 0.0074 * Math.sin(dr * (M - Mpr)) + 0.0004 * Math.sin(dr * (2 * F + M));
    C1 = C1 - 0.0004 * Math.sin(dr * (2 * F - M)) - 0.0006 * Math.sin(dr * (2 * F + Mpr));
    C1 = C1 + 0.0010 * Math.sin(dr * (2 * F - Mpr)) + 0.0005 * Math.sin(dr * (2 * Mpr + M));
    var deltat;
    if (T < -11) deltat = 0.001 + 0.000839 * T + 0.0002261 * T2 - 0.00000845 * T3 - 0.000000081 * T * T3;
    else deltat = -0.000278 + 0.000265 * T + 0.000262 * T2;
    return Jd1 + C1 - deltat;
  }
  function getNewMoonDay(k, tz) { return INT(newMoon(k) + 0.5 + tz / 24); }
  function sunLongitude(jdn) {
    var T = (jdn - 2451545.0) / 36525, T2 = T * T, dr = PI / 180;
    var M = 357.52910 + 35999.05030 * T - 0.0001559 * T2 - 0.00000048 * T * T2;
    var L0 = 280.46645 + 36000.76983 * T + 0.0003032 * T2;
    var DL = (1.914600 - 0.004817 * T - 0.000014 * T2) * Math.sin(dr * M);
    DL = DL + (0.019993 - 0.000101 * T) * Math.sin(dr * 2 * M) + 0.000290 * Math.sin(dr * 3 * M);
    var L = (L0 + DL) * dr;
    L = L - PI * 2 * INT(L / (PI * 2));
    return L;
  }
  function getSunLongitude(dayNumber, tz) { return INT(sunLongitude(dayNumber - 0.5 - tz / 24) / PI * 6); }
  function getLunarMonth11(yy, tz) {
    var off = jdFromDate(31, 12, yy) - 2415021;
    var k = INT(off / 29.530588853);
    var nm = getNewMoonDay(k, tz);
    if (getSunLongitude(nm, tz) >= 9) nm = getNewMoonDay(k - 1, tz);
    return nm;
  }
  function getLeapMonthOffset(a11, tz) {
    var k = INT((a11 - 2415021.076998695) / 29.530588853 + 0.5), last, i = 1;
    var arc = getSunLongitude(getNewMoonDay(k + i, tz), tz);
    do { last = arc; i++; arc = getSunLongitude(getNewMoonDay(k + i, tz), tz); } while (arc !== last && i < 14);
    return i - 1;
  }
  function solar2lunar(dd, mm, yy, tz) {
    if (tz == null) tz = 7;
    var dayNumber = jdFromDate(dd, mm, yy);
    var k = INT((dayNumber - 2415021.076998695) / 29.530588853);
    var monthStart = getNewMoonDay(k + 1, tz);
    if (monthStart > dayNumber) monthStart = getNewMoonDay(k, tz);
    var a11 = getLunarMonth11(yy, tz), b11 = a11, lunarYear;
    if (a11 >= monthStart) { lunarYear = yy; a11 = getLunarMonth11(yy - 1, tz); }
    else { lunarYear = yy + 1; b11 = getLunarMonth11(yy + 1, tz); }
    var lunarDay = dayNumber - monthStart + 1;
    var diff = INT((monthStart - a11) / 29);
    var lunarLeap = 0, lunarMonth = diff + 11;
    if (b11 - a11 > 365) {
      var leapMonthDiff = getLeapMonthOffset(a11, tz);
      if (diff >= leapMonthDiff) { lunarMonth = diff + 10; if (diff === leapMonthDiff) lunarLeap = 1; }
    }
    if (lunarMonth > 12) lunarMonth = lunarMonth - 12;
    if (lunarMonth >= 11 && diff < 4) lunarYear -= 1;
    return { day: lunarDay, month: lunarMonth, year: lunarYear, leap: lunarLeap, jd: dayNumber };
  }
  var CAN = ['Giáp', 'Ất', 'Bính', 'Đinh', 'Mậu', 'Kỷ', 'Canh', 'Tân', 'Nhâm', 'Quý'];
  var CHI = ['Tý', 'Sửu', 'Dần', 'Mão', 'Thìn', 'Tỵ', 'Ngọ', 'Mùi', 'Thân', 'Dậu', 'Tuất', 'Hợi'];
  function canChiYear(y) { return CAN[(y + 6) % 10] + ' ' + CHI[(y + 8) % 12]; }
  function canChiDay(jd) { return CAN[(jd + 9) % 10] + ' ' + CHI[(jd + 1) % 12]; }
  function canChiMonth(m, y) { return CAN[(y * 12 + m + 3) % 10] + ' ' + CHI[(m + 1) % 12]; }
  // (07/10/2026) LICH VAN NIEN (calendar.html): duong lich tu am lich, tiet khi, gio / ngay hoang dao, truc, nap am, tuoi xung.
  function jdToDate(jd) {
    var a, b, c;
    if (jd > 2299160) { a = jd + 32044; b = INT((4 * a + 3) / 146097); c = a - INT((b * 146097) / 4); }
    else { b = 0; c = jd + 32082; }
    var d = INT((4 * c + 3) / 1461), e = c - INT((1461 * d) / 4), m = INT((5 * e + 2) / 153);
    return { day: e - INT((153 * m + 2) / 5) + 1, month: m + 3 - 12 * INT(m / 10), year: b * 100 + d - 4800 + INT(m / 10) };
  }
  /** Am lich -> duong lich ({day, month, year}); null neu thang nhuan khong ton tai. */
  function lunar2solar(ld, lm, ly, leap, tz) {
    if (tz == null) tz = 7;
    var a11, b11;
    if (lm < 11) { a11 = getLunarMonth11(ly - 1, tz); b11 = getLunarMonth11(ly, tz); }
    else { a11 = getLunarMonth11(ly, tz); b11 = getLunarMonth11(ly + 1, tz); }
    var k = INT(0.5 + (a11 - 2415021.076998695) / 29.530588853);
    var off = lm - 11;
    if (off < 0) off += 12;
    if (b11 - a11 > 365) {
      var leapOff = getLeapMonthOffset(a11, tz), leapMonth = leapOff - 2;
      if (leapMonth < 0) leapMonth += 12;
      if (leap && lm !== leapMonth) return null;
      if (leap || off >= leapOff) off += 1;
    }
    return jdToDate(getNewMoonDay(k + off, tz) + ld - 1);
  }
  var TIETKHI = ['Xuân phân', 'Thanh minh', 'Cốc vũ', 'Lập hạ', 'Tiểu mãn', 'Mang chủng', 'Hạ chí', 'Tiểu thử', 'Đại thử',
    'Lập thu', 'Xử thử', 'Bạch lộ', 'Thu phân', 'Hàn lộ', 'Sương giáng', 'Lập đông', 'Tiểu tuyết', 'Đại tuyết', 'Đông chí',
    'Tiểu hàn', 'Đại hàn', 'Lập xuân', 'Vũ thủy', 'Kinh trập'];
  /** Chi so tiet khi (0 = Xuan phan) CUOI ngay jd (kinh do mat troi luc nua dem dau ngay hom sau, gio dia phuong): tiet
   *  khi bat dau trong ngay nao thi ngay do da mang ten tiet khi moi (vd Dong chi 22/12/2026, 03:50 gio VN). */
  function solarTerm(jd, tz) { if (tz == null) tz = 7; return INT(sunLongitude(jd + 1 - 0.5 - tz / 24) / PI * 12); }
  function termStartsOn(jd, tz) { return solarTerm(jd, tz) !== solarTerm(jd - 1, tz); }
  var GIO_HD = ['110100101100', '001101001011', '110011010010', '101100110100', '001011001101', '010010110011'];
  /** 6 gio hoang dao cua ngay (theo chi ngay): [{ chi, from, to }] — gio Ty 23-1, Suu 1-3... */
  function gioHoangDao(jd) {
    var s = GIO_HD[((jd + 1) % 12) % 6], out = [];
    for (var i = 0; i < 12; i++) if (s.charAt(i) === '1') out.push({ chi: CHI[i], from: (i * 2 + 23) % 24, to: (i * 2 + 1) % 24 });
    return out;
  }
  var THAN = ['Thanh Long', 'Minh Đường', 'Thiên Hình', 'Chu Tước', 'Kim Quỹ', 'Kim Đường', 'Bạch Hổ', 'Ngọc Đường',
    'Thiên Lao', 'Nguyên Vũ', 'Tư Mệnh', 'Câu Trận'];
  var THAN_TOT = [1, 1, 0, 0, 1, 1, 0, 1, 0, 0, 1, 0];
  /** Than truc nhat -> ngay hoang dao / hac dao. Thang Gieng, 7: Thanh Long o ngay Ty; thang 2, 8: Dan; 3, 9: Thin;
   *  4, 10: Ngo; 5, 11: Than; 6, 12: Tuat — roi lan luot theo chi ngay. */
  function thanNgay(jd, lunarMonth) {
    var i = ((jd + 1) % 12 - ((lunarMonth - 1) % 6) * 2 + 12) % 12;
    return { name: THAN[i], good: THAN_TOT[i] === 1 };
  }
  var TRUC = ['Kiến', 'Trừ', 'Mãn', 'Bình', 'Định', 'Chấp', 'Phá', 'Nguy', 'Thành', 'Thu', 'Khai', 'Bế'];
  /** 12 truc: ngay co chi trung chi THANG TIET KHI (Lap xuan -> Dan, Kinh trap -> Mao...) la Kien, roi lan luot. */
  function truc(jd, tz) {
    var t = solarTerm(jd, tz), tiet = t % 2 === 1 ? t : (t + 23) % 24;
    var monthChi = ((tiet - 1) / 2 + 4) % 12;
    return TRUC[((jd + 1) % 12 - monthChi + 12) % 12];
  }
  var NAP_AM = ['Hải Trung Kim', 'Lư Trung Hỏa', 'Đại Lâm Mộc', 'Lộ Bàng Thổ', 'Kiếm Phong Kim', 'Sơn Đầu Hỏa', 'Giản Hạ Thủy',
    'Thành Đầu Thổ', 'Bạch Lạp Kim', 'Dương Liễu Mộc', 'Tuyền Trung Thủy', 'Ốc Thượng Thổ', 'Tích Lịch Hỏa', 'Tùng Bách Mộc',
    'Trường Lưu Thủy', 'Sa Trung Kim', 'Sơn Hạ Hỏa', 'Bình Địa Mộc', 'Bích Thượng Thổ', 'Kim Bạch Kim', 'Phú Đăng Hỏa',
    'Thiên Hà Thủy', 'Đại Trạch Thổ', 'Thoa Xuyến Kim', 'Tang Đố Mộc', 'Đại Khê Thủy', 'Sa Trung Thổ', 'Thiên Thượng Hỏa',
    'Thạch Lựu Mộc', 'Đại Hải Thủy'];
  /** Ngu hanh nap am cua ngay (vi tri trong vong 60 Giap Ty = (jd + 49) mod 60, hai ngay chung mot nap am). */
  function napAm(jd) { return NAP_AM[INT(((jd + 49) % 60) / 2)]; }
  /** Chi tuoi xung voi ngay (luc xung: Ty-Ngo, Suu-Mui, Dan-Than, Mao-Dau, Thin-Tuat, Ty-Hoi). */
  function xung(jd) { return CHI[((jd + 1) % 12 + 6) % 12]; }
  g.RwvLunar = { solar2lunar: solar2lunar, canChiYear: canChiYear, canChiDay: canChiDay, canChiMonth: canChiMonth, jdFromDate: jdFromDate,
    jdToDate: jdToDate, lunar2solar: lunar2solar, TIETKHI: TIETKHI, solarTerm: solarTerm, termStartsOn: termStartsOn,
    gioHoangDao: gioHoangDao, thanNgay: thanNgay, truc: truc, napAm: napAm, xung: xung };
})(typeof window !== 'undefined' ? window : globalThis);
