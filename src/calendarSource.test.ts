import { describe, expect, it } from "vitest";
import { maskUrl, normIcalUrl, parseIcal, sanitizeIcal } from "./calendarSource.js";

// Tep iCal kieu Google Calendar (rut gon): mui gio VTIMEZONE, su kien thuong, ca ngay, lap hang tuan co mot lan doi gio.
const ICS = [
  "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Google Inc//Google Calendar 70.9054//EN",
  "BEGIN:VTIMEZONE", "TZID:Asia/Ho_Chi_Minh", "BEGIN:STANDARD", "TZOFFSETFROM:+0700", "TZOFFSETTO:+0700", "TZNAME:+07",
  "DTSTART:19700101T000000", "END:STANDARD", "END:VTIMEZONE",
  "BEGIN:VEVENT", "UID:a1", "DTSTART;TZID=Asia/Ho_Chi_Minh:20261010T090000", "DTEND;TZID=Asia/Ho_Chi_Minh:20261010T100000",
  "SUMMARY:Họp phụ huynh", "END:VEVENT",
  "BEGIN:VEVENT", "UID:a2", "DTSTART;VALUE=DATE:20261011", "DTEND;VALUE=DATE:20261012", "SUMMARY:Sinh nhật bà", "END:VEVENT",
  "BEGIN:VEVENT", "UID:w1", "DTSTART;TZID=Asia/Ho_Chi_Minh:20260901T180000", "DTEND;TZID=Asia/Ho_Chi_Minh:20260901T190000",
  "RRULE:FREQ=WEEKLY;BYDAY=TU", "SUMMARY:Học bơi", "END:VEVENT",
  "BEGIN:VEVENT", "UID:w1", "RECURRENCE-ID;TZID=Asia/Ho_Chi_Minh:20261013T180000",
  "DTSTART;TZID=Asia/Ho_Chi_Minh:20261013T190000", "DTEND;TZID=Asia/Ho_Chi_Minh:20261013T200000", "SUMMARY:Học bơi (dời)", "END:VEVENT",
  "BEGIN:VEVENT", "UID:old", "DTSTART:20250101T010000Z", "DTEND:20250101T020000Z", "SUMMARY:Cũ", "END:VEVENT",
  "END:VCALENDAR",
].join("\r\n");

describe("(09/10/2026) lich iCal (Google Calendar) cho man hinh khoa / Hom nay", () => {
  const from = Date.parse("2026-10-09T00:00:00+07:00"), to = Date.parse("2026-10-16T00:00:00+07:00");
  const ev = parseIcal(ICS, from, to);
  it("su kien thuong theo mui gio cua lich (09:00 +07 = 02:00Z)", () => {
    expect(ev.find((e) => e.summary === "Họp phụ huynh")).toEqual({ summary: "Họp phụ huynh",
      start: { dateTime: "2026-10-10T02:00:00.000Z" }, end: { dateTime: "2026-10-10T03:00:00.000Z" } });
  });
  it("su kien ca ngay -> date (ket thuc la ngay ke tiep, nhu HA)", () => {
    expect(ev.find((e) => e.summary === "Sinh nhật bà")).toEqual({ summary: "Sinh nhật bà", start: { date: "2026-10-11" }, end: { date: "2026-10-12" } });
  });
  it("lap hang tuan trong khoang xem + lan bi doi gio (RECURRENCE-ID)", () => {
    const boi = ev.filter((e) => e.summary.startsWith("Học bơi"));
    expect(boi).toEqual([{ summary: "Học bơi (dời)", start: { dateTime: "2026-10-13T12:00:00.000Z" }, end: { dateTime: "2026-10-13T13:00:00.000Z" } }]);
  });
  it("bo su kien ngoai khoang xem", () => { expect(ev.some((e) => e.summary === "Cũ")).toBe(false); });
  it("webcal:// -> https://; dia chi sai bi bo; che dia chi bi mat khi hien", () => {
    expect(normIcalUrl("webcal://calendar.google.com/x/basic.ics")).toBe("https://calendar.google.com/x/basic.ics");
    expect(normIcalUrl("ftp://x/y.ics")).toBeNull();
    expect(sanitizeIcal([{ name: "", url: "https://a.b/c.ics" }, { url: "https://a.b/c.ics" }, { url: "khong" }])).toEqual([{ name: "a.b", url: "https://a.b/c.ics" }]);
    const m = maskUrl("https://calendar.google.com/calendar/ical/abc%40gmail.com/private-0123456789abcdef/basic.ics");
    expect(m.startsWith("calendar.google.com/…")).toBe(true);
    expect(m).not.toContain("private-0123456789abcdef");
  });
});
