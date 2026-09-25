// (25/09/2026) Proxy Chrome DevTools ra LAN (tuy chon addon expose_debug_proxy, mac dinh TAT).
// Chrome chi mo cong debug o 127.0.0.1 (DEBUG_PORT); proxy nay chuyen tiep DEBUG_PROXY_PORT -> 127.0.0.1:DEBUG_PORT de
// may tinh vao chrome://inspect xem/thao tac truc tiep cac tab cua server (vd dang nhap HA lan dau).
// CANH BAO: ai trong LAN vao duoc cong nay la DIEU KHIEN DUOC trinh duyet (ke ca phien dang nhap HA). Chi bat khi can.
import net from 'node:net';

export function startDebugProxy(): void {
  if (!/^(1|true|yes|on)$/i.test(process.env.EXPOSE_DEBUG_PROXY ?? '')) return;
  const listen = Number(process.env.DEBUG_PROXY_PORT || 9222);
  const target = Number(process.env.DEBUG_PORT || 9221);
  const server = net.createServer((client) => {
    const up = net.connect(target, '127.0.0.1');
    client.pipe(up).pipe(client);
    const close = () => { client.destroy(); up.destroy(); };
    client.on('error', close); up.on('error', close);
  });
  server.on('error', (e) => console.warn(`[debug-proxy] loi: ${e.message}`));
  server.listen(listen, '0.0.0.0', () =>
    console.warn(`[debug-proxy] ⚠️ DevTools mo ra LAN o cong ${listen} -> 127.0.0.1:${target}. Tat expose_debug_proxy khi xong.`));
}
