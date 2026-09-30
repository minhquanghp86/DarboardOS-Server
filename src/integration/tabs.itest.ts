// (26/09/2026) Thu tich hop OS-2 "moi ung dung mot tab": server that + Chromium that + panel gia.
// Chay: npm run test:integration (can Chromium — xem harness.ts findChrome). Moi test mot server moi de doc lap.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { FakeDevice, TestServer, sleep } from './harness.js';

let srv: TestServer;
let dev: FakeDevice | null = null;

beforeEach(async () => { srv = await TestServer.start({ MAX_APP_TABS: '1' }); });
afterEach(async (ctx) => {
  dev?.close(); dev = null;
  const log = srv.log();
  await srv.stop();
  if (ctx.task.result?.state === 'fail' || process.env.ITEST_LOG) console.log(`--- log server (${ctx.task.name}) ---\n${log}`);
  // Moi kich ban: duong ong khung hinh khong duoc loi (vd tab trung lam anh lech kich thuoc viewport: "Frame error").
  expect(log.match(/\[device\] Frame error.*/g) ?? []).toEqual([]);
});

/** Ket noi panel voi Home URL = trang /ha cua chinh server (tra ve "ok"), cho toi khi server bao URL do. */
async function connectPanel(id: string): Promise<{ home: string }> {
  const home = srv.local('/ha');
  dev = await FakeDevice.connect(srv, id, { home });
  await dev.waitFor(() => dev!.currentUrls().includes(home), 20_000, 'server bao CurrentURL = Home URL');
  return { home };
}

/** Goi binding dieu khien cua Shell tu trang dang hien — y nhu nguoi dung cham mot ung dung. */
async function control(onUrl: string, ...msgs: unknown[]): Promise<void> {
  const page = await srv.waitPage((u) => u === onUrl);
  await srv.evaluate(page, msgs.map((m) => `window.__rwvControl(${JSON.stringify(JSON.stringify(m))});`).join(''));
}

/** Cu chi vuot len tu mep duoi (ve Home cua OS). Move cach nhau >= 12 ms (InputRouter bo bot Move qua day). */
async function swipeHome(d: FakeDevice): Promise<void> {
  d.touch(1, 500, 596); d.touch(2, 500, 540); d.touch(3, 500, 480);
  await sleep(13);
}

describe('OS-2: moi ung dung mot tab (server + Chromium that)', () => {
  it('panel ket noi: nhan khung hinh va URL hien tai, chi mot tab Home Assistant', async () => {
    const { home } = await connectPanel('it-basic');
    await dev!.waitFor(() => dev!.frameCount() > 0, 15_000, 'khung hinh dau tien');
    expect(await srv.pageUrls()).toEqual([home]);
  });

  it('vuot ve Home lap lai nhanh KHONG tao trung tab (race 2.9.48)', async () => {
    const { home } = await connectPanel('it-race');
    for (let i = 0; i < 3; i++) await swipeHome(dev!);
    const osHome = srv.local('/os/home');
    await srv.waitPage((u) => u === osHome);
    await sleep(3_000);  // cho moi lenh mo tab dang xep hang chay xong
    expect(await srv.pageUrls()).toEqual([home, osHome].sort());
  });

  it('cham dup mot ung dung (hai lenh {app} lien tiep) chi mo MOT tab', async () => {
    const { home } = await connectPanel('it-dbl');
    await control(home, { app: 'weather' }, { app: 'weather' });
    const weather = srv.local('/weather.html');
    await srv.waitPage((u) => u.startsWith(weather));
    await sleep(2_000);
    expect((await srv.pageUrls()).filter((u) => u.startsWith(weather))).toHaveLength(1);
  });

  it('quay lai Home Assistant khong tai lai trang (tab duoc giu am)', async () => {
    const { home } = await connectPanel('it-warm');
    const ha = await srv.waitPage((u) => u === home);
    await srv.evaluate(ha, 'window.__itestMarker = 42');
    await control(home, { app: 'weather' });
    await dev!.waitFor(() => dev!.currentUrls().some((u) => u.includes('/weather.html')), 15_000, 'chuyen sang Thoi tiet');
    await control(srv.local('/weather.html'), { app: 'home' });
    await dev!.waitFor(() => dev!.currentUrls().slice(-1)[0] === home, 15_000, 'quay lai Home Assistant');
    const haAfter = await srv.waitPage((u) => u === home);
    expect(haAfter.id).toBe(ha.id);
    expect(await srv.evaluate(haAfter, 'window.__itestMarker')).toBe(42);
  });

  it('vuot MAX_APP_TABS thi dong ung dung cu nhat; Home Assistant ghim khong bi dong', async () => {
    const { home } = await connectPanel('it-evict');
    await control(home, { app: 'weather' });
    const weather = await srv.waitPage((u) => u.includes('/weather.html'));
    await control(weather.url, { app: 'timer' });
    await srv.waitPage((u) => u.includes('/timer.html'));
    await sleep(1_000);
    const urls = await srv.pageUrls();
    expect(urls).toContain(home);
    expect(urls.some((u) => u.includes('/timer.html'))).toBe(true);
    expect(urls.some((u) => u.includes('/weather.html'))).toBe(false);
  });

  it('Radio dang phat nen: hien the "Dang phat", khong bi dong; dung phat roi thi dong duoc', async () => {
    const { home } = await connectPanel('it-np');
    await control(home, { app: 'radio' });
    const radio = await srv.waitPage((u) => u.includes('/radio.html'));
    // Nhu the <audio> bat dau phat (script khoa am thanh bao {media:1}) — khong can mang de phat that.
    await srv.evaluate(radio, `window.__rwvControl('{"media":1}')`);
    await sleep(300);
    await control(radio.url, { app: 'weather' });
    const weather = await srv.waitPage((u) => u.includes('/weather.html'));
    await sleep(1_000);
    // MAX_APP_TABS=1 nhung radio dang phat -> duoc mien (tam vuot han muc), va the Dang phat co radio.
    expect((await srv.pageUrls()).some((u) => u.includes('/radio.html'))).toBe(true);
    const np = await srv.evaluate<{ k: string; l: string }[]>(weather, 'window.__rwvLastState && window.__rwvLastState.np');
    expect(np).toEqual([{ k: 'radio', l: 'Radio' }]);

    // Dung phat -> mo ung dung khac thi radio bi dong nhu tab thuong.
    await srv.evaluate(radio, `window.__rwvControl('{"media":0}')`);
    await sleep(300);
    await control(weather.url, { app: 'timer' });
    await srv.waitPage((u) => u.includes('/timer.html'));
    await sleep(1_000);
    const urls = await srv.pageUrls();
    expect(urls.some((u) => u.includes('/radio.html'))).toBe(false);
    expect(urls.some((u) => u.includes('/weather.html'))).toBe(false);
  });

  it('URL tu HA thuoc mot ung dung trong menu mo vao DUNG tab ung dung do (khong phai tab Trinh duyet)', async () => {
    const { home } = await connectPanel('it-route');
    const url = srv.local('/weather.html?tu=ha');
    dev!.openUrl(url);
    await srv.waitPage((u) => u === url);
    await control(url, { app: 'weather' });   // mo Thoi tiet tu menu: dung lai tab do, khong tao tab moi
    await sleep(1_500);
    expect((await srv.pageUrls()).sort()).toEqual([home, url].sort());
  });

  it('tab nen bi tam dung JavaScript (dong bang), quay lai thi chay tiep', async () => {
    // (30/09/2026) Page.setWebLifecycleState 'frozen' tung "thanh cong" ma timer van chay du — test nay bat loai do.
    const { home } = await connectPanel('it-freeze');
    const ha = await srv.waitPage((u) => u === home);
    await srv.evaluate(ha, 'window.__cnt = 0; setInterval(function () { window.__cnt++; }, 100); 1');
    await srv.evaluate(ha, `window.__rwvControl('{"app":"weather"}')`);
    const w = await srv.waitPage((u) => u.includes('/weather.html'));
    await sleep(3_000);                                  // khong dong bang thi ~35 lan
    await srv.evaluate(w, `window.__rwvControl('{"app":"home"}')`);
    await sleep(500);
    const n = await srv.evaluate<number>(ha, 'window.__cnt');
    expect(n).toBeLessThan(15);
    await sleep(1_000);
    expect(await srv.evaluate<number>(ha, 'window.__cnt')).toBeGreaterThan(n + 5);   // chay tiep
  });

  it('vuot tu mep trai: Quay lai trang truoc trong ung dung; het lich su thi ve man hinh chinh', async () => {
    const { home } = await connectPanel('it-back');
    const ha = await srv.waitPage((u) => u === home);
    await srv.evaluate(ha, `history.pushState({}, '', '/ha/phong-khach')`);   // nhu dashboard HA chuyen tab
    const sub = srv.local('/ha/phong-khach');
    await dev!.waitFor(() => dev!.currentUrls().slice(-1)[0] === sub, 10_000, 'URL trang con');
    const swipeBack = async () => {   // Move cach nhau >= 12 ms (InputRouter bo bot Move qua day)
      dev!.touch(1, 4, 300); await sleep(15); dev!.touch(2, 40, 302); await sleep(15);
      dev!.touch(2, 150, 305); await sleep(15); dev!.touch(3, 150, 305);
    };
    await swipeBack();
    await dev!.waitFor(() => dev!.currentUrls().slice(-1)[0] === home, 10_000, 'quay lai trang dau');
    await swipeBack();
    const osHome = srv.local('/os/home');
    await dev!.waitFor(() => dev!.currentUrls().slice(-1)[0] === osHome, 10_000, 've man hinh chinh');
  });

  it('vuot len tu mep duoi roi GIU -> mo Gan day (khong ve Home khi tha tay)', async () => {
    const { home } = await connectPanel('it-hold');
    const ha = await srv.waitPage((u) => u === home);
    dev!.touch(1, 500, 596); await sleep(15); dev!.touch(2, 500, 560); await sleep(15); dev!.touch(2, 500, 470);
    await sleep(700);                                  // giu yen > 350 ms, khong gui su kien nao
    const l = await srv.evaluate<{ k: string }[] | null>(ha, 'window.__rwvLastRecents || null');
    expect(l?.map((c) => c.k)).toEqual(['home']);
    dev!.touch(3, 500, 470); await sleep(1_000);
    expect(dev!.currentUrls().slice(-1)[0]).toBe(home);   // khong ve man hinh chinh
    expect((await srv.pageUrls()).some((u) => u.includes('/os/home'))).toBe(false);
  });

  it('RepaintRect: trang dung yen van gui lai dung vung thiet bi xin ve lai (xoa vong tron phan hoi cham)', async () => {
    await connectPanel('it-repaint');
    await dev!.waitFor(() => dev!.frameCount() > 0, 15_000, 'khung dau');
    await sleep(2_500);                               // trang tinh: het khung moi
    const from = dev!.msgs.length;
    dev!.repaintRect(300, 200, 44, 44);
    await dev!.waitFor(() => dev!.tilesSince(from).length > 0, 5_000, 'server gui lai vung');
    const tiles = dev!.tilesSince(from);
    expect(tiles.some((r) => r.x <= 300 && r.x + r.w >= 344 && r.y <= 200 && r.y + r.h >= 244)).toBe(true);
  });
});
