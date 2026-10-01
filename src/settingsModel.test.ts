import { describe, expect, it } from "vitest";
import { HaEntity, HaState, buildSettingsView, findDeviceByMac, findNoSleepSwitch, findPresenceSelect, macFromDeviceId, planSet } from "./settingsModel.js";

const dev = { id: "d1", name: "7.0 Guition JC1060P470C", model: "esp32-p4-evboard", sw_version: "2026.9.0",
  connections: [["mac", "28:37:2F:8A:02:18"]] as [string, string][] };
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
  });
});
