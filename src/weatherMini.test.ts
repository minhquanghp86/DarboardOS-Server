import { describe, expect, it } from "vitest";
import { parseWeatherMini } from "./weatherMini.js";

const J = {
  current: { time: "2026-10-07T17:00", temperature_2m: 31.4, apparent_temperature: 36.2, relative_humidity_2m: 71.6, wind_speed_10m: 9.4, weather_code: 3, is_day: 1 },
  daily: { precipitation_probability_max: [40], temperature_2m_max: [33.1], temperature_2m_min: [25.6] },
  hourly: {
    time: ["2026-10-07T17:00", "2026-10-07T18:00", "2026-10-07T19:00", "2026-10-07T20:00", "2026-10-07T21:00", "2026-10-07T22:00", "2026-10-07T23:00", "2026-10-08T00:00"],
    temperature_2m: [31.4, 30.2, 28.9, 28.1, 27.6, 27.2, 26.9, 26.5],
    weather_code: [3, 3, 61, 61, 2, 1, 0, 0],
    precipitation_probability: [10, 20, 55, 60, 30, 10, 5, 0],
  },
};

describe("thoi tiet mini chi tiet (07/10/2026)", () => {
  it("doc du truong + 6 gio toi (bo gio hien tai, qua nua dem)", () => {
    const w = parseWeatherMini(J, { current: { us_aqi: 87.4, pm2_5: 29.6 } }, "Nhà", 1);
    expect([w.t, w.code, w.day, w.pp, w.name, w.at]).toEqual([31, 3, true, 40, "Nhà", 1]);
    expect([w.fl, w.rh, w.ws, w.hi, w.lo, w.aqi, w.pm]).toEqual([36, 72, 9, 33, 26, 87, 30]);
    expect(w.hr?.map((h) => [h.h, h.t, h.c, h.p])).toEqual([[18, 30, 3, 20], [19, 29, 61, 55], [20, 28, 61, 60], [21, 28, 2, 30], [22, 27, 1, 10], [23, 27, 0, 5]]);
  });
  it("thieu API khong khi / thieu truong -> null, khong vo", () => {
    const w = parseWeatherMini({ current: { temperature_2m: 20, weather_code: 0, is_day: 0 } }, null, "X", 1);
    expect([w.t, w.day, w.pp, w.fl, w.hi, w.aqi]).toEqual([20, false, null, null, null, null]);
    expect(w.hr).toEqual([]);
  });
});
