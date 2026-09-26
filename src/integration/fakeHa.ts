// (27/09/2026) Home Assistant GIA cho thu tich hop: REST (/api/states, /api/services/*) + WebSocket (so dang ky khu
// vuc/thiet bi/thuc the, todo/item/list). Dich vu goi toi duoc ghi lai va doi trang thai nhu HA that (mot phan).
import http from 'node:http';
import net from 'node:net';
import { WebSocketServer } from 'ws';

export interface FakeHa { port: number; calls: { path: string; body: any }[]; st: Record<string, any>; todo: Record<string, any[]>; close(): Promise<void> }

export async function startFakeHa(o: { states: Record<string, any>; areas?: any[]; devices?: any[]; entities?: any[]; todo?: Record<string, any[]> }): Promise<FakeHa> {
  const port = await new Promise<number>((res) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = (s.address() as net.AddressInfo).port; s.close(() => res(p)); }); });
  const calls: { path: string; body: any }[] = [];
  const st = o.states;
  const todo = o.todo ?? {};
  const server = http.createServer((req, res) => {
    if (req.headers.authorization !== 'Bearer test') { res.writeHead(401); res.end(); return; }
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      if (req.url === '/api/states') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify(Object.entries(st).map(([entity_id, s]) => ({ entity_id, ...s }))));
        return;
      }
      const m = /^\/api\/services\/(\w+)\/(\w+)$/.exec(req.url || '');
      if (m && req.method === 'POST') {
        const b = JSON.parse(body || '{}');
        calls.push({ path: `${m[1]}.${m[2]}`, body: b });
        const e = st[b.entity_id];
        if (e && m[2] === 'toggle') e.state = e.state === 'on' ? 'off' : 'on';
        if (e && m[2] === 'set_temperature') e.attributes.temperature = b.temperature;
        if (m[1] === 'todo') {
          const l = (todo[b.entity_id] ??= []);
          if (m[2] === 'add_item') l.push({ uid: String(l.length + 100), summary: b.item, status: 'needs_action' });
          if (m[2] === 'update_item') { const it = l.find((x) => x.uid === b.item || x.summary === b.item); if (it) it.status = b.status; }
          if (m[2] === 'remove_completed_items') todo[b.entity_id] = l.filter((x) => x.status !== 'completed');
          if (st[b.entity_id]) st[b.entity_id].state = String(todo[b.entity_id].filter((x) => x.status !== 'completed').length);
        }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end('[]');
        return;
      }
      res.writeHead(404); res.end();
    });
  });
  const wss = new WebSocketServer({ server, path: '/websocket' });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ type: 'auth_required' }));
    ws.on('message', (raw) => {
      const m = JSON.parse(String(raw));
      if (m.type === 'auth') { ws.send(JSON.stringify({ type: m.access_token === 'test' ? 'auth_ok' : 'auth_invalid' })); return; }
      const result = m.type === 'config/device_registry/list' ? (o.devices ?? [])
        : m.type === 'config/entity_registry/list' ? (o.entities ?? Object.keys(st).map((entity_id) => ({ entity_id })))
          : m.type === 'config/area_registry/list' ? (o.areas ?? [])
            : m.type === 'todo/item/list' ? { items: todo[m.entity_id] ?? [] } : null;
      ws.send(JSON.stringify({ id: m.id, type: 'result', success: result !== null, result }));
    });
  });
  await new Promise<void>((r) => server.listen(port, '127.0.0.1', () => r()));
  return { port, calls, st, todo, close: () => new Promise((r) => { wss.close(); server.close(() => r()); }) };
}
