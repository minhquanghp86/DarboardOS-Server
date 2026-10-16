// SPDX-License-Identifier: Apache-2.0
//
// Copyright (c) 2026 minhquanghp86
// Licensed under the Apache License, Version 2.0 (see LICENSE).

import { describe, expect, it } from "vitest";
import { buildMedia, buildRooms, buildTodoLists, planAction, planTodo, shortName, todoItemsOf } from "./homeModel.js";
import type { HaState } from "./settingsModel.js";

const S = (entity_id: string, state: string, attributes: Record<string, unknown> = {}): HaState => ({ entity_id, state, attributes });
const areas = [{ area_id: "khach", name: "Phòng khách" }, { area_id: "ngu", name: "Phòng ngủ" }, { area_id: "kho", name: "Kho" }];
const devices = [{ id: "d_ac", name: "Điều hoà", area_id: "ngu" }, { id: "d_p4", name: "Panel P4", area_id: "khach" }];
const entities = [
  { entity_id: "light.phong_khach_den_tran", area_id: "khach" },
  { entity_id: "switch.quat_tran", area_id: "khach" },
  { entity_id: "cover.rem", area_id: "khach" },
  { entity_id: "sensor.nhiet_do_khach", area_id: "khach" },
  { entity_id: "binary_sensor.cua_so", area_id: "khach" },
  { entity_id: "binary_sensor.chuyen_dong", area_id: "khach" },
  { entity_id: "switch.p4_config", device_id: "d_p4", entity_category: "config" },
  { entity_id: "climate.dieu_hoa", device_id: "d_ac" },
  { entity_id: "light.an", area_id: "ngu", hidden_by: "user" },
  { entity_id: "sensor.kho_nhiet", area_id: "kho" },
  { entity_id: "light.khong_phong" },
];
const states = new Map([
  S("light.phong_khach_den_tran", "on", { friendly_name: "Phòng khách Đèn trần", brightness: 128, supported_color_modes: ["brightness"] }),
  S("switch.quat_tran", "off", { friendly_name: "Quạt trần" }),
  S("cover.rem", "open", { friendly_name: "Rèm", current_position: 60 }),
  S("sensor.nhiet_do_khach", "29.46", { device_class: "temperature" }),
  S("binary_sensor.cua_so", "on", { device_class: "window" }),
  S("binary_sensor.chuyen_dong", "on", { device_class: "motion" }),
  S("switch.p4_config", "on", {}),
  S("climate.dieu_hoa", "cool", { friendly_name: "Điều hoà", current_temperature: 28, temperature: 26, min_temp: 16, max_temp: 30, target_temp_step: 1, hvac_modes: ["off", "cool", "auto"] }),
  S("light.an", "on", {}),
  S("sensor.kho_nhiet", "30", { device_class: "temperature" }),
  S("light.khong_phong", "on", {}),
].map((s) => [s.entity_id, s]));

describe("ung dung Phong", () => {
  const rooms = buildRooms(areas, devices as any, entities as any, states);
  it("theo khu vuc (ca qua thiet bi), bo an/cau hinh, bo phong khong co gi dieu khien", () => {
    expect(rooms.map((r) => r.name)).toEqual(["Phòng khách", "Phòng ngủ"]);
    expect(rooms[0].items.map((i) => i.id)).toEqual(["light.phong_khach_den_tran", "switch.quat_tran", "cover.rem"]);
    expect(rooms[1].items.map((i) => i.id)).toEqual(["climate.dieu_hoa"]);
  });
  it("tom tat phong + ten gon + trang thai", () => {
    expect(rooms[0]).toMatchObject({ temp: 29.5, open: 1, motion: true, lightsOn: 1 });
    expect(rooms[0].items[0]).toMatchObject({ name: "Đèn trần", kind: "light", on: true, bri: 50, dim: true });
    expect(rooms[0].items[2]).toMatchObject({ kind: "cover", on: true, pos: 60 });
    expect(rooms[1].items[0]).toMatchObject({ kind: "climate", on: true, mode: "cool", cur: 28, target: 26, step: 1, modes: ["off", "cool", "auto"] });
    expect(shortName("Phòng khách Đèn", ["Phòng khách"])).toBe("Đèn");
    expect(shortName("Phòng khách", ["Phòng khách"])).toBe("Phòng khách");
  });
  it("thao tac: danh sach co dinh, kep gia tri, tu choi thuc the la", () => {
    expect(planAction(states, "light.phong_khach_den_tran", "bri", 150)).toMatchObject({ service: "turn_on", data: { brightness_pct: 100 } });
    expect(planAction(states, "switch.quat_tran", "toggle")).toMatchObject({ domain: "switch", service: "toggle" });
    expect(planAction(states, "cover.rem", "stop")).toMatchObject({ service: "stop_cover" });
    expect(planAction(states, "climate.dieu_hoa", "temp", 40)).toMatchObject({ service: "set_temperature", data: { temperature: 30 } });
    expect(planAction(states, "climate.dieu_hoa", "mode", "heat")).toBeTypeOf("string");
    expect(planAction(states, "switch.quat_tran", "turn_on_evil")).toBeTypeOf("string");
    expect(planAction(states, "lock.cua", "toggle")).toBeTypeOf("string");
    expect(planAction(new Map([["lock.cua", S("lock.cua", "locked")]]), "lock.cua", "toggle")).toBeTypeOf("string");
  });
});

describe("ung dung Dieu khien + Viec can lam", () => {
  it("media: dang phat len dau, tinh nang theo supported_features", () => {
    const m = buildMedia([
      S("media_player.loa", "idle", { friendly_name: "Loa", supported_features: 4 }),
      S("media_player.tv", "playing", { friendly_name: "TV", media_title: "Thời sự", volume_level: 0.3, entity_picture: "/api/x", supported_features: 16 | 32 | 4 | 128 | 256 }),
      S("media_player.hong", "unavailable", {}),
    ], () => "Phòng khách");
    expect(m.map((x) => x.id)).toEqual(["media_player.tv", "media_player.loa"]);
    expect(m[0]).toMatchObject({ vol: 30, art: true, canPrev: true, canNext: true, canVol: true, canPower: true, area: "Phòng khách" });
    const known = new Map([["media_player.tv", S("media_player.tv", "playing", { is_volume_muted: false })]]);
    expect(planAction(known, "media_player.tv", "vol", 55)).toMatchObject({ service: "volume_set", data: { volume_level: 0.55 } });
    expect(planAction(known, "media_player.tv", "mute")).toMatchObject({ data: { is_volume_muted: true } });
  });
  it("todo: danh sach, muc, thao tac hop le", () => {
    const lists = buildTodoLists([S("todo.mua_sam", "3", { friendly_name: "Mua sắm" }), S("sensor.x", "1")]);
    expect(lists).toEqual([{ id: "todo.mua_sam", name: "Mua sắm", open: 3 }]);
    expect(todoItemsOf({ items: [{ uid: "1", summary: "Sữa", status: "needs_action" }, { uid: "2", summary: "Gạo", status: "completed", due: "2026-09-30" }, { bad: 1 }] }))
      .toEqual([{ uid: "1", summary: "Sữa", done: false }, { uid: "2", summary: "Gạo", done: true, due: "2026-09-30" }]);
    expect(planTodo(lists, "todo.mua_sam", "add", "  Trứng ")).toMatchObject({ service: "add_item", data: { item: "Trứng" } });
    expect(planTodo(lists, "todo.mua_sam", "set", "1", true)).toMatchObject({ service: "update_item", data: { item: "1", status: "completed" } });
    expect(planTodo(lists, "todo.khac", "add", "x")).toBeTypeOf("string");
    expect(planTodo(lists, "todo.mua_sam", "add", "x".repeat(201))).toBeTypeOf("string");
  });
});
