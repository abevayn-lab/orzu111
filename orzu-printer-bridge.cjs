// ORZU local thermal-printer bridge for Windows laptops
// Run: node orzu-printer-bridge.cjs

const http = require('http');
const net = require('net');

const HOST = '127.0.0.1';
const PORT = 17891;

const API_BASE = (
  process.env.APP_URL ||
  process.env.API_BASE ||
  process.argv[2] ||
  'https://orzu111-production.up.railway.app'
).replace(/\/$/, '');

const PRINT_KEY = process.env.ORZU_PRINT_KEY || 'ORZU-LOCAL-PRINT-KEY-9f42c7b1-2026-11';

let polling = false;
let lastIdleLog = 0;

const esc = s => String(s ?? '').normalize('NFKD')
  .replace(/[‘’ʻʼ`]/g, "'")
  .replace(/[“”]/g, '"')
  .replace(/o'/gi, m => m[0] === 'O' ? 'O' : 'o')
  .replace(/g'/gi, m => m[0] === 'G' ? 'G' : 'g')
  .replace(/[^\x20-\x7E]/g, '?');

const money = n =>
  Math.round(Number(n) || 0).toLocaleString('en-US') + ' som';

function line(s = '') {
  return Buffer.from(esc(s) + '\n', 'ascii');
}

// 80 mm receipt styled to match the supplied ORZU sample.
function makeReceipt(o) {
  const W = 42;
  const items = Array.isArray(o.items) ? o.items : [];
  const qtyOf = it => Math.max(0, Number(it.qty) || 0);
  const priceOf = it => Math.max(0, Number(it.price) || 0);
  const subtotal = items.reduce((sum, it) => sum + qtyOf(it) * priceOf(it), 0);
  // 5% service charge, rounded to the nearest 1,000 so the printed
  // amounts match the supplied sample (43,000 -> 2,000).
  const service = Math.round(subtotal * 0.05);
  const grandTotal = subtotal + service;

  const pad = (s, n) => esc(s).slice(0, n).padEnd(n, ' ');
  const right = (s, n) => esc(s).slice(-n).padStart(n, ' ');
  const amount = n => (Math.round(Number(n) || 0) / 1).toFixed(2);
  const rule = '-'.repeat(W);
  const date = new Date(o.paidAt || o.time || Date.now());
  const opened = new Date(o.createdAt || o.openedAt || o.time || date);
  const dateText = d => d.toLocaleDateString('en-GB');
  const timeText = d => d.toLocaleTimeString('en-GB', {hour:'2-digit', minute:'2-digit', hour12:false});
  const table = o.table ?? o.tableNumber ?? '-';
  const guests = o.guests ?? o.guestCount ?? 0;
  const cashier = o.cashierName || o.cashier || 'Admin';
  const waiter = o.waiterName || o.waiter || 'Admin';
  const orderNo = o.id ?? '-';

  const out = [
    Buffer.from([0x1b, 0x40]),
    Buffer.from([0x1b, 0x61, 0x01]),
    Buffer.from([0x1b, 0x45, 0x01]),
    Buffer.from([0x1d, 0x21, 0x11]),
    line('ORZU RESTAURANT'),
    Buffer.from([0x1d, 0x21, 0x00]),
    Buffer.from([0x1b, 0x45, 0x00]),
    Buffer.from([0x1b, 0x61, 0x00]),
    line('Chek #' + orderNo + '          Stol ' + table + '   Mehmon ' + guests),
    line(dateText(date) + '  Ochilgan ' + timeText(opened) + '  Chop etildi ' + timeText(date)),
    line('Kassir: ' + cashier),
    line('Ofitsiant: ' + waiter),
    line(rule),
    line(pad('Taom', 23) + right('Soni', 7) + right('Summa', 12)),
    line(rule)
  ];

  for (const it of items) {
    const name = esc(it.name || 'Mahsulot');
    const qty = qtyOf(it);
    const total = qty * priceOf(it);
    const qtyText = qty.toFixed(2);
    const sumText = amount(total);
    const nameLines = [];
    for (let i = 0; i < name.length; i += 23) nameLines.push(name.slice(i, i + 23));
    if (!nameLines.length) nameLines.push('Mahsulot');
    out.push(line(pad(nameLines[0], 23) + right(qtyText, 7) + right(sumText, 12)));
    for (const extra of nameLines.slice(1)) out.push(line(extra));
  }

  out.push(
    line(rule),
    line(pad('Jami:', 30) + right(amount(subtotal), 12)),
    line(pad('Xizmat 5%:', 30) + right(amount(service), 12)),
    line(rule),
    Buffer.from([0x1b, 0x45, 0x01]),
    Buffer.from([0x1d, 0x21, 0x11]),
    line(pad('Sum:', 16) + right(amount(grandTotal), 20)),
    Buffer.from([0x1d, 0x21, 0x00]),
    Buffer.from([0x1b, 0x45, 0x00]),
    line(rule),
    Buffer.from([0x1b, 0x61, 0x01]),
    line('TASHRIFINGIZ UCHUN RAHMAT!'),
    line('INSTAGRAM sahifamizga obuna'),
    line('@orzu_arnasoy'),
    line(''),
    Buffer.from([0x1d, 0x56, 0x42, 0x00])
  );

  return Buffer.concat(out);
}

function send(ip, bytes) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(
      { host: ip, port: 9100, timeout: 5000 },
      () => socket.end(bytes, () => resolve())
    );

    socket.on('error', reject);
    socket.on('timeout', () =>
      socket.destroy(new Error('Printer ulanish vaqti tugadi'))
    );
  });
}

async function pollPrintJobs() {
  if (polling) return;
  polling = true;

  try {
    const r = await fetch(API_BASE + '/api/printer/jobs', {
      headers: { 'x-orzu-print-key': PRINT_KEY }
    });

    if (!r.ok) throw new Error('Print queue HTTP ' + r.status);

    const data = await r.json();

    if (data.job) {
      const job = data.job;

      if (!job.order || !Array.isArray(job.order.items) || !job.order.items.length) {
        throw new Error('Buyurtma ma’lumoti noto‘g‘ri');
      }

      console.log('ORZU buyurtma topildi:', job.order.id);

      await send(
        job.printerIp || '192.168.1.51',
        makeReceipt(job.order)
      );

      const ack = await fetch(API_BASE + '/api/printer/jobs/ack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-orzu-print-key': PRINT_KEY
        },
        body: JSON.stringify({ id: data.job.id })
      });

      if (!ack.ok) throw new Error('Print acknowledgement failed');

      console.log('ORZU chek muvaffaqiyatli chiqarildi:', job.order.id);

    } else if (Date.now() - lastIdleLog > 30000) {
      console.log('ORZU: server bilan aloqa bor, navbat bo‘sh.');
      lastIdleLog = Date.now();
    }

  } catch (e) {
    if (Date.now() - lastIdleLog > 15000) {
      console.warn('ORZU printer xabari:', e.message);
      lastIdleLog = Date.now();
    }
  } finally {
    polling = false;
  }
}

function startBridge() {
let pollTimer;
const server = http.createServer((req, res) => {
  const origin = req.headers.origin || '*';

  res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-orzu-print-key');
  res.setHeader('Access-Control-Allow-Private-Network', 'true');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({
      ok: true,
      service: 'ORZU printer bridge',
      targetServer: API_BASE
    }));
  }

  if (req.method !== 'POST' || req.url !== '/print') {
    res.writeHead(404);
    return res.end('Not found');
  }

  let raw = '';

  req.on('data', c => {
    raw += c;

    if (raw.length > 1000000) {
      res.writeHead(413);
      res.end('Too large');
      req.destroy();
    }
  });

  req.on('end', async () => {
    try {
      const body = JSON.parse(raw || '{}');
      const ip = String(body.printerIp || '192.168.1.51');
      const o = body.order;

      if (!o || !Array.isArray(o.items)) {
        throw new Error('Chek ma’lumoti noto‘g‘ri');
      }

      await send(ip, makeReceipt(o));

      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));

    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        error: e.message || 'Printer xatosi'
      }));
    }
  });
});

server.listen(PORT, HOST, () => {
  console.log('ORZU printer bridge ishga tushdi: http://' + HOST + ':' + PORT);
  console.log('Bog‘langan server manzili: ' + API_BASE);

  pollPrintJobs();
  pollTimer = setInterval(pollPrintJobs, 1000);
  if (typeof pollTimer.unref === 'function') pollTimer.unref();
});

server.on('error', error => console.error('ORZU printer bridge xatosi:', error));
return {
  server,
  stop() {
    clearInterval(pollTimer);
    server.close();
  }
};
}

module.exports = { startBridge };

if (require.main === module) startBridge();
