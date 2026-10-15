import { describe, expect, it } from "vitest";
import { HaEntity, HaState, SettingItem, buildSettingsView, findDeviceByMac, findNoSleepSwitch, findPresenceSelect, isSaverPhotosSwitchId, macFromDeviceId, placeSetting, planCamAuth, planSet, planWifi, statusEntityIds, statusIconsOf, wifiBars } from "./settingsModel.js";
import { REAL_P4, REAL_S3 } from "./settingsModel.fixture.js";

const dev = { id: "d1", name: "7.0 Guition JC1060P470C", model: "esp32-p4-evboard", sw_version: "2026.9.0",
  connections: [["mac", "0a:0b:0c:0d:00:02"]] as [string, string][] };
const ents: HaEntity[] = [
  { entity_id: "light.p4_lcd_backlight", device_id: "d1" },
  { entity_id: "switch.p4_man_hinh_cho", device_id: "d1" },
  { entity_id: "number.p4_sleep_time", device_id: "d1" },
  { entity_id: "select.p4_xoay_man_hinh", device_id: "d1" },
  { entity_id: "text.p4_home_url", device_id: "d1" },
  { entity_id: "button.p4_khoi_dong_lai", device_id: "d1", entity_category: "config" },
  { entity_id: "button.p4_factory_default_settings", device_id: "d1" },
  { entity_id: "sensor.p4_wifi_signal", device_id: "d1", entity_category: "diagnostic" },
  { entity_id: "update.p4_firmware", device_id: "d1" },
  { entity_id: "switch.p4_an", device_id: "d1", hidden_by: "user" },
  { entity_id: "switch.khac", device_id: "d2" },
];
const S = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): [string, HaState] =>
  [entity_id, { entity_id, state, attributes: { friendly_name: `7.0 Guition JC1060P470C ${entity_id.split(".")[1].slice(3)}`, ...attributes } }];
const states = new Map<string, HaState>([
  S("light.p4_lcd_backlight", "on", { brightness: 153 }),
  S("switch.p4_man_hinh_cho", "off", { friendly_name: "7.0 Guition JC1060P470C Màn hình chờ" }),
  S("number.p4_sleep_time", "15", { min: 0, max: 180, step: 5, unit_of_measurement: "s" }),
  S("select.p4_xoay_man_hinh", "0", { options: ["0", "90", "180", "270"] }),
  S("text.p4_home_url", "http://ha/x", { max: 255 }),
  S("button.p4_khoi_dong_lai", "unknown", { device_class: "restart" }),
  S("button.p4_factory_default_settings", "unknown"),
  S("sensor.p4_wifi_signal", "-55", { unit_of_measurement: "dBm" }),
]);

describe("cai dat tren panel: tim thiet bi + dung danh sach", () => {
  it("MAC tu id firmware, khop connections cua HA (khong phan biet hoa/thuong, dau :)", () => {
    expect(macFromDeviceId("esp32-0a0b0c0d0002")).toBe("0a0b0c0d0002");
    expect(macFromDeviceId("khac")).toBeNull();
    expect(findDeviceByMac([dev], "0a0b0c0d0002")?.id).toBe("d1");
    expect(findDeviceByMac([dev], "000000000000")).toBeUndefined();
  });

  it("chi thuc the cua thiet bi do, bo an/tat/factory/update; nhom + nhan + thu tu", () => {
    const v = buildSettingsView(dev, ents, states);
    expect(v.device).toEqual({ name: "7.0 Guition JC1060P470C", model: "esp32-p4-evboard", version: "2026.9.0" });
    expect(v.items.map((i) => i.id)).toEqual([
      "light.p4_lcd_backlight", "switch.p4_man_hinh_cho", "number.p4_sleep_time", "select.p4_xoay_man_hinh",
      "text.p4_home_url", "button.p4_khoi_dong_lai", "sensor.p4_wifi_signal",
    ]);
    const by = Object.fromEntries(v.items.map((i) => [i.id, i]));
    expect(by["switch.p4_man_hinh_cho"]).toMatchObject({ label: "Màn hình chờ", group: "control", on: false });
    expect(by["light.p4_lcd_backlight"]).toMatchObject({ on: true, bri: 60 });
    expect(by["number.p4_sleep_time"]).toMatchObject({ min: 0, max: 180, step: 5, unit: "s" });
    expect(by["button.p4_khoi_dong_lai"]).toMatchObject({ group: "config", confirm: true });
    expect(by["sensor.p4_wifi_signal"]).toMatchObject({ group: "diag", value: "-55", unit: "dBm" });
  });
});

describe("cai dat tren panel: kiem tra thao tac", () => {
  const v = buildSettingsView(dev, ents, states);
  it("doi thanh dich vu HA dung loai, lam tron theo step, kep khoang", () => {
    expect(planSet(v, "switch.p4_man_hinh_cho", true)).toEqual({ domain: "switch", service: "turn_on", data: { entity_id: "switch.p4_man_hinh_cho" } });
    expect(planSet(v, "number.p4_sleep_time", 23)).toMatchObject({ service: "set_value", data: { value: 25 } });
    expect(planSet(v, "number.p4_sleep_time", 999)).toMatchObject({ data: { value: 180 } });
    expect(planSet(v, "light.p4_lcd_backlight", 0)).toMatchObject({ service: "turn_on", data: { brightness_pct: 1 } });
    expect(planSet(v, "select.p4_xoay_man_hinh", "90")).toMatchObject({ service: "select_option", data: { option: "90" } });
    expect(planSet(v, "button.p4_khoi_dong_lai", null)).toMatchObject({ domain: "button", service: "press" });
  });
  it("tu choi: thuc the cua thiet bi khac / factory reset / lua chon la / chi de xem", () => {
    expect(typeof planSet(v, "switch.khac", true)).toBe("string");
    expect(typeof planSet(v, "button.p4_factory_default_settings", null)).toBe("string");
    expect(typeof planSet(v, "select.p4_xoay_man_hinh", "45")).toBe("string");
    expect(typeof planSet(v, "sensor.p4_wifi_signal", 1)).toBe("string");
    expect(typeof planSet(v, "text.p4_home_url", "x".repeat(300))).toBe("string");
  });
});

describe("thanh trang thai: select nguon phat hien nguoi", () => {
  const view = (items: any[]) => ({ device: { name: 'x' }, items });
  const sel = (id: string, label: string, extra: any = {}) => ({ id, kind: 'select', group: 'control', label, value: 'Cả 2',
    options: ['Chuyển động', 'Person', 'Cả 2', 'Tắt'], ...extra });
  it("tim theo entity_id hoac nhan, bo qua khi khong co / khong dung duoc", () => {
    expect(findPresenceSelect(view([sel('select.p4_nguon_phat_hien_nguoi', 'Khác')]))?.id).toBe('select.p4_nguon_phat_hien_nguoi');
    expect(findPresenceSelect(view([sel('select.abc', 'Nguồn phát hiện người')]))?.id).toBe('select.abc');
    expect(findPresenceSelect(view([sel('select.xoay', 'Xoay màn hình')]))).toBeUndefined();
    expect(findPresenceSelect(view([sel('select.abc', 'Nguồn phát hiện người', { unavailable: true })]))).toBeUndefined();
    expect(findPresenceSelect(view([]))).toBeUndefined();
  });
});

describe("bat/tat anh man hinh cho -> No Sleep", () => {
  const view = (items: any[]) => ({ device: { name: 'x' }, items });
  const sw = (id: string, label: string, extra: any = {}) => ({ id, kind: 'switch', group: 'control', label, value: 'off', on: false, ...extra });
  it("tim theo entity_id (P4) hoac nhan (S3), bo qua khi khong dung duoc", () => {
    expect(findNoSleepSwitch(view([sw('switch.7_0_guition_jc1060p470c_no_sleep', 'No Sleep')]))?.id).toBe('switch.7_0_guition_jc1060p470c_no_sleep');
    expect(findNoSleepSwitch(view([sw('switch.abc', 'No Sleep')]))?.id).toBe('switch.abc');
    expect(findNoSleepSwitch(view([sw('switch.amp', 'Audio Amplifier')]))).toBeUndefined();
    expect(findNoSleepSwitch(view([sw('switch.x_no_sleep', 'No Sleep', { unavailable: true })]))).toBeUndefined();
    // firmware 01/10: doi ten "Màn hình chờ"; khong nham voi "Ảnh màn hình chờ"
    expect(findNoSleepSwitch(view([sw('switch.p4_anh_man_hinh_cho', 'Ảnh màn hình chờ'), sw('switch.p4_man_hinh_cho', 'Màn hình chờ')]))?.id).toBe('switch.p4_man_hinh_cho');
    expect(findNoSleepSwitch(view([sw('switch.p4_anh_man_hinh_cho', 'Ảnh màn hình chờ')]))).toBeUndefined();
    expect(isSaverPhotosSwitchId('switch.p4_anh_man_hinh_cho')).toBe(true);
    expect(isSaverPhotosSwitchId('switch.p4_man_hinh_cho')).toBe(false);
  });
});

describe('muc Luong camera (01/10/2026)', () => {
  it('hai cong tac tieng camera vao nhom stream, kem goi y', () => {
    const e: HaEntity[] = [
      { entity_id: 'switch.p4_tieng_luong_camera', device_id: 'd1', entity_category: 'config' },
      { entity_id: 'switch.p4_tieng_khi_quay_video', device_id: 'd1', entity_category: 'config' },
      { entity_id: 'switch.p4_man_hinh_cho', device_id: 'd1' },
    ];
    const st = new Map<string, HaState>([
      ['switch.p4_tieng_luong_camera', { entity_id: 'switch.p4_tieng_luong_camera', state: 'off', attributes: { friendly_name: '7.0 Guition JC1060P470C Tiếng luồng camera' } }],
      ['switch.p4_tieng_khi_quay_video', { entity_id: 'switch.p4_tieng_khi_quay_video', state: 'on', attributes: { friendly_name: '7.0 Guition JC1060P470C Tiếng khi quay video' } }],
      ['switch.p4_man_hinh_cho', { entity_id: 'switch.p4_man_hinh_cho', state: 'on', attributes: { friendly_name: '7.0 Guition JC1060P470C Màn hình chờ' } }],
    ]);
    const v = buildSettingsView(dev, e, st);
    const s = v.items.filter((i) => i.group === 'stream');
    expect(s.map((i) => i.label).sort()).toEqual(['Tiếng khi quay video', 'Tiếng luồng camera']);
    expect(s.every((i) => !!i.hint)).toBe(true);
    expect(v.items.find((i) => i.label === 'Màn hình chờ')?.group).toBe('control');
  });
});

describe("(08/10/2026) Cai dat kieu iOS — xep muc lon / nhom con", () => {
  const place = (id: string, kind: string, group: string, label: string) =>
    placeSetting({ id, kind: kind as SettingItem["kind"], group: group as SettingItem["group"], label, value: "" });
  it("moi thuc the THAT cua P4 va S3 vao dung muc (khong muc nao roi vao 'Khác')", () => {
    for (const [id, kind, group, label] of [...REAL_P4, ...REAL_S3]) {
      const p = place(id, kind, group, label);
      expect(p.cat, id).not.toBe("other");
      expect(p.sub, id).toBeTruthy();
    }
  });
  it("vi du: ten de hieu, an muc trung, nhom dung", () => {
    const by = (list: typeof REAL_P4, suffix: string) => { const t = list.find((x) => x[0].endsWith(suffix))!; return place(...t); };
    expect(by(REAL_P4, "_lcd_backlight")).toMatchObject({ cat: "display", sub: "Độ sáng", title: "Đèn nền" });
    expect(by(REAL_P4, "_anh_man_hinh_cho")).toMatchObject({ cat: "wall", hide: true });
    expect(by(REAL_P4, "c_man_hinh_cho")).toMatchObject({ cat: "display", sub: "Tự tắt màn hình", title: "Luôn sáng (màn hình chờ)" });
    expect(by(REAL_P4, "_am_luong_video_web")).toMatchObject({ cat: "sound", sub: "Âm lượng" });
    expect(by(REAL_P4, "_tai_loi_1")).toMatchObject({ cat: "diag", sub: "Hiệu năng", title: "Tải lõi 1" });
    expect(by(REAL_P4, "_khoi_dong_lai")).toMatchObject({ cat: "about", title: "Khởi động lại" });
    expect(by(REAL_P4, "_tieng_luong_camera")).toMatchObject({ cat: "camera", sub: "Âm thanh camera" });
    expect(by(REAL_P4, "_person")).toMatchObject({ cat: "camera", sub: "Trạng thái", title: "Có người" });
    expect(by(REAL_P4, "_do_nhay_chuyen_dong")).toMatchObject({ cat: "camera", sub: "Phát hiện người" });
    expect(by(REAL_S3, "_wifi_ket_noi")).toMatchObject({ cat: "net", sub: "Wi-Fi", title: "Mạng đang kết nối" });
    expect(by(REAL_S3, "_local_ip")).toMatchObject({ cat: "net", title: "Địa chỉ IP" });
    expect(by(REAL_S3, "_url_hien_thi")).toMatchObject({ cat: "home", title: "Trang đang hiển thị" });
    expect(by(REAL_S3, "_url_hien_tai")).toMatchObject({ cat: "diag", sub: "Kết nối" });
  });
  it("khong khop luat nao -> theo group cua HA", () => {
    expect(place("switch.x_den_bao", "switch", "control", "Đèn báo")).toMatchObject({ cat: "other", sub: "Điều khiển" });
    expect(place("sensor.x_nhiet_do_chip", "value", "diag", "Nhiệt độ chip")).toMatchObject({ cat: "diag", sub: "Khác" });
  });
});

describe("(08/10/2026) doi Wi-Fi tu Cai dat — tim dich vu ESPHome cua man hinh nay", () => {
  const view = (node: string | null) => ({ device: { name: "x" }, items: node == null ? [] :
    [{ id: "sensor.7_0_guition_jc1060p470c_ten_esphome", kind: "value" as const, group: "diag" as const, label: "Tên ESPHome", value: node }] });
  it("ten node (khong theo tien to thuc the) -> esphome.<node>_wifi_*", () => {
    expect(planWifi(view("esp32-p4-tab7"), "scan")).toEqual({ domain: "esphome", service: "esp32_p4_tab7_wifi_scan", data: {} });
    expect(planWifi(view("guition-webview-4848s040"), "connect", "Nhà Tầng 2", "matkhau123"))
      .toEqual({ domain: "esphome", service: "guition_webview_4848s040_wifi_connect", data: { ssid: "Nhà Tầng 2", password: "matkhau123" } });
    expect(planWifi(view("esp32-p4-tab7"), "connect", "Quan cafe", "")).toMatchObject({ data: { password: "" } });   // mang mo
  });
  it("tu choi: firmware cu (khong co cam bien), ten mang / mat khau sai", () => {
    expect(planWifi(view(null), "scan")).toBe("firmware chua ho tro doi Wi-Fi");
    expect(planWifi(view("Bad Name!"), "scan")).toBe("firmware chua ho tro doi Wi-Fi");
    expect(planWifi(view("p4"), "connect", "", "12345678")).toBe("ten mang khong hop le");
    expect(planWifi(view("p4"), "connect", "a".repeat(33), "12345678")).toBe("ten mang khong hop le");
    expect(planWifi(view("p4"), "connect", "Nhà", "1234567")).toBe("mat khau phai 8-63 ky tu");
    expect(planWifi(view("p4"), "connect", "Nhà", "x".repeat(64))).toBe("mat khau phai 8-63 ky tu");
    expect(planWifi(view("p4"), "xoa")).toBe("thao tac la");
  });
  it("cam bien moi cua firmware vao dung muc", () => {
    const P = (id: string) => placeSetting({ id, kind: "value", group: "diag", label: "x", value: "" });
    expect(P("sensor.7_0_guition_jc1060p470c_bssid")).toMatchObject({ cat: "net", title: "BSSID (điểm phát)" });
    expect(P("sensor.7_0_guition_jc1060p470c_dns")).toMatchObject({ cat: "net", title: "DNS" });
    expect(P("sensor.7_0_guition_jc1060p470c_wi_fi_ssid")).toMatchObject({ cat: "net", title: "Mạng đang kết nối" });
    expect(P("sensor.4_3_guition_4848s040_mang_wi_fi_xung_quanh")).toMatchObject({ cat: "net", hide: true });
    expect(P("sensor.4_3_guition_4848s040_doi_wi_fi")).toMatchObject({ cat: "net", hide: true });
    expect(P("sensor.4_3_guition_4848s040_ten_esphome")).toMatchObject({ cat: "about", title: "Tên ESPHome" });
    expect(P("sensor.4_3_guition_4848s040_thoi_gian_chay")).toMatchObject({ cat: "diag", sub: "Hiệu năng" });
    expect(P("sensor.7_0_guition_jc1060p470c_lien_ket_wi_fi")).toMatchObject({ cat: "net", sub: "Wi-Fi", title: "Kênh & chuẩn kết nối", ord: 6 });
    expect(P("sensor.7_0_guition_jc1060p470c_kenh_wi_fi_xung_quanh")).toMatchObject({ cat: "net", hide: true });
  });
});

describe("(08/10/2026) mat khau luong camera dat luc chay", () => {
  const view = (st: string | null) => ({ device: { name: "x" }, items: [
    { id: "sensor.7_0_guition_jc1060p470c_ten_esphome", kind: "value" as const, group: "diag" as const, label: "Tên ESPHome", value: "esp32-p4-tab7" },
    ...(st == null ? [] : [{ id: "sensor.7_0_guition_jc1060p470c_mat_khau_luong_camera", kind: "value" as const, group: "diag" as const, label: "Mật khẩu luồng camera", value: st }])] });
  it("bat / doi / tat -> esphome.<node>_set_camera_auth", () => {
    expect(planCamAuth(view("Tắt"), true, "admin", "abcd1234"))
      .toEqual({ domain: "esphome", service: "esp32_p4_tab7_set_camera_auth", data: { enabled: true, username: "admin", password: "abcd1234" } });
    expect(planCamAuth(view("Bật · admin"), true, "camera", "")).toMatchObject({ data: { username: "camera", password: "" } });  // giu mat khau cu
    expect(planCamAuth(view("Bật · admin"), false, "", "")).toMatchObject({ data: { enabled: false } });
  });
  it("tu choi: firmware cu, ten / mat khau sai, bat lan dau khong co mat khau", () => {
    expect(planCamAuth(view(null), true, "admin", "abcd1234")).toBe("firmware chua ho tro mat khau camera");
    expect(planCamAuth(view("Tắt"), true, "ad min", "abcd1234")).toBe("ten dang nhap khong hop le");
    expect(planCamAuth(view("Tắt"), true, "admin", "abc")).toBe("mat khau phai 4-64 ky tu");
    expect(planCamAuth(view("Tắt"), true, "admin", "")).toBe("can mat khau");
    expect(planCamAuth(view("Tắt"), "co", "admin", "abcd1234")).toBe("thieu bat / tat");
  });
});

describe("(08/10/2026) pin + mang canh dong ho", () => {
  const S = (state: string, unit?: string) => ({ entity_id: "x", state, attributes: unit ? { unit_of_measurement: unit } : {} });
  it("tim thuc the cua dung thiet bi (ten that tren HA 08/10)", () => {
    const ents = [
      { entity_id: "sensor.7inch_tab_wifi_signal", device_id: "p4" },
      { entity_id: "sensor.7inch_tab_battery_percent", device_id: "p4" },
      { entity_id: "sensor.7inch_tab_battery_voltage", device_id: "p4" },
      { entity_id: "sensor.4_3_guition_4848s040_wifi_signal", device_id: "s3" },
      { entity_id: "sensor.x_ket_noi_mang", device_id: "p4", disabled_by: "user" },
    ];
    expect(statusEntityIds(ents, "p4")).toEqual({ sig: "sensor.7inch_tab_wifi_signal", bat: "sensor.7inch_tab_battery_percent" });
    expect(statusEntityIds(ents, "s3")).toEqual({ sig: "sensor.4_3_guition_4848s040_wifi_signal" });
  });
  it("vach Wi-Fi theo dBm (do that P4 -64 -> 2, S3 -45 -> 3) va theo %", () => {
    expect([-45, -60, -64, -70, -75, -80, -88].map((v) => wifiBars(v))).toEqual([3, 3, 2, 2, 1, 1, 0]);
    expect([90, 50, 25, 10].map((v) => wifiBars(v, "%"))).toEqual([3, 2, 1, 0]);
  });
  it("Ethernet uu tien; khong co so lieu -> an; pin lam tron, chan 0..100", () => {
    expect(statusIconsOf(S("-64", "dBm"), S("Ethernet"), S("57.4", "%"))).toEqual({ nw: { k: "eth" }, bt: 57 });
    expect(statusIconsOf(S("-64", "dBm"), S("Wi-Fi"), S("unknown", "%"))).toEqual({ nw: { k: "wifi", q: 2 }, bt: null });
    expect(statusIconsOf(S("unavailable"), null, S("104", "%"))).toEqual({ nw: null, bt: 100 });
    expect(statusIconsOf(null, null, null)).toEqual({ nw: null, bt: null });
  });
});

describe("(09/10/2026) chon mang Cap / Wi-Fi", () => {
  const S = (state: string, unit?: string) => ({ entity_id: "x", state, attributes: unit ? { unit_of_measurement: unit } : {} });
  it("HA mat ket noi (moi thuc the unavailable) -> an bieu tuong", () => {
    expect(statusIconsOf(S("unavailable"), S("unavailable"), S("unavailable"))).toEqual({ nw: null, bt: null });
    expect(statusIconsOf(S("unavailable"), S("Ethernet"), null)).toEqual({ nw: { k: "eth" }, bt: null });
  });
  it("cap cam vao mang khac -> bieu tuong Wi-Fi (khong phai cap)", () => {
    expect(statusIconsOf(S("-62", "dBm"), S("Wi-Fi · cáp khác mạng"), null)).toEqual({ nw: { k: "wifi", q: 2 }, bt: null });
  });
  it("select / cam bien moi vao muc Wi-Fi & Mang", () => {
    const P = (id: string) => placeSetting({ id, kind: "value", group: "diag", label: "x", value: "" });
    expect(P("select.7_0_guition_jc1060p470c_mang_su_dung")).toMatchObject({ cat: "net", hide: true });
    expect(P("sensor.7_0_guition_jc1060p470c_ket_noi_mang")).toMatchObject({ cat: "net", hide: true });
    expect(P("sensor.7_0_guition_jc1060p470c_ip_mang_day")).toMatchObject({ cat: "net", title: "IP mạng dây" });
  });
});
