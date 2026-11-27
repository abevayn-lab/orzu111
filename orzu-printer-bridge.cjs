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
  // Takeaway ("Saboy") orders are exempt from the 5% service charge.
  const tableName = String(o.table ?? o.tableNumber ?? '').trim().toLowerCase();
  const isTakeaway = ['с собой', 'собой', 'saboy', 'soboy', 'takeaway'].includes(tableName);
  const service = (isTakeaway || o.serviceFeeRemoved) ? 0 : Math.floor((subtotal * 0.05) / 100) * 100;
  const grandTotal = subtotal + service;

  const pad = (s, n) => esc(s).slice(0, n).padEnd(n, ' ');
  const right = (s, n) => esc(s).slice(-n).padStart(n, ' ');
  const amount = n => Math.round(Number(n) || 0).toLocaleString('en-US');
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
    ...(isTakeaway ? [] : [line(pad('Xizmat 5%:', 30) + right(amount(service), 12))]),
    line(rule),
    Buffer.from([0x1b, 0x45, 0x01]),
    Buffer.from([0x1d, 0x21, 0x11]),
    line(pad('JAMI:', 6) + right(amount(grandTotal), 15)),
    Buffer.from([0x1d, 0x21, 0x00]),
    Buffer.from([0x1b, 0x45, 0x00]),
    line(rule),
    Buffer.from([0x1b, 0x61, 0x01]),
    line('TASHRIFINGIZ UCHUN RAHMAT!'),
    line('INSTAGRAM SAHIFAMIZGA OBUNA BOLING!'),
    line('@orzu_arnasoy'),
    line(''),
    Buffer.from([0x1d, 0x56, 0x42, 0x00])
  );

  return Buffer.concat(out);
}


function makeDailyReportReceipt(report) {
  const W = 42;
  const summary = report.summary || {};
  const categories = Array.isArray(summary.categories) ? summary.categories : [];
  const legacyItems = Array.isArray(summary.items) ? summary.items : [];
  const pad = (v, n) => esc(v).slice(0,n).padEnd(n,' ');
  const right = (v, n) => esc(v).slice(-n).padStart(n,' ');
  const amount = n => Math.round(Number(n) || 0).toLocaleString('en-US');
  const rule = '-'.repeat(W);
  const date = new Date(report.date || Date.now());
  const out = [
    Buffer.from([0x1b,0x40]),
    Buffer.from([0x1b,0x61,0x01]),
    Buffer.from([0x1b,0x45,0x01]),
    line('ORZU RESTAURANT'),
    Buffer.from([0x1b,0x45,0x00]),
    line('RASXOD BLYUD PO KATEGORIYAM'),
    line('KASSOVIY KUN ' + date.toLocaleDateString('ru-RU')),
    line('SMENA / KUNLIK HISOBOT'),
    line(date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',hour12:false})),
    line(rule),
    line(pad('BLYUDO',22) + right('KOL-VO',7) + right('SUMMA',13)),
    line(rule)
  ];
  const printItem = item => {
    const name = String(item.name || 'Mahsulot');
    const qty = Number(item.qty || 0);
    const sum = amount(item.total ?? (Number(item.price || 0) * qty));
    out.push(line(pad(name,22) + right(qty,7) + right(sum,13)));
  };
  if (categories.length) {
    for (const category of categories) {
      out.push(Buffer.from([0x1b,0x45,0x01]));
      out.push(line('KATEGORIYA: ' + String(category.name || 'Boshqa')));
      out.push(Buffer.from([0x1b,0x45,0x00]));
      for (const item of (category.items || [])) printItem(item);
      out.push(line(pad('VSEGO PO KATEGORII:',30) + right(amount(category.total),12)));
      out.push(line(''));
    }
  } else {
    for (const item of legacyItems) printItem(item);
  }
  out.push(
    line(rule),
    Buffer.from([0x1b,0x45,0x01]),
    line(pad('VSEGO:',30) + right(amount(summary.subtotal ?? summary.total),12)),
    Buffer.from([0x1b,0x45,0x00]),
    line(rule),
    line(''), Buffer.from([0x1d,0x56,0x42,0x00])
  );
  return Buffer.concat(out);
}


function makeShiftReportReceipt(report) {
  const W = 42;
  const summary = report.summary || {};
  const pad = (v, n) => esc(v).slice(0,n).padEnd(n,' ');
  const right = (v, n) => esc(v).slice(-n).padStart(n,' ');
  const amount = n => Math.round(Number(n) || 0).toLocaleString('en-US') + '.00';
  const rule = '-'.repeat(W);
  const date = new Date(report.date || Date.now());
  const out = [
    Buffer.from([0x1b,0x40]),
    Buffer.from([0x1b,0x61,0x01]),
    Buffer.from([0x1b,0x45,0x01]),
    line('ORZU RESTAURANT'),
    Buffer.from([0x1b,0x45,0x00]),
    line(date.toLocaleDateString('ru-RU') + ' ' + date.toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit',hour12:false})),
    line('OBSHCHIY SMENNIY OTCHET'),
    line('KASSOVIY KUN ' + date.toLocaleDateString('ru-RU')),
    line('SMENA: KUNLIK HISOBOT'),
    line(rule),
    line(pad('KORSATKICH',20) + right('CHEKLAR',8) + right('SUMMA',14)),
    line(pad('Jami cheklar',20) + right(summary.orders || 0,8) + right(amount(summary.total),14)),
    line(rule),
    line(pad('KASSA — STOLLAR',28) + right(amount(summary.tableSubtotal ?? summary.subtotal),14)),
    line(pad('Ustama 5% (stollar)',28) + right(amount(summary.markup),14)),
    ...(Number(summary.takeawaySubtotal || 0) > 0 ? [line(pad('SABOY SAVDOSI',28) + right(amount(summary.takeawaySubtotal),14))] : []),
    line(rule),
    line('OCHIRISHLAR'),
    line(summary.deletionsTracked ? 'Qayd etilgan o‘chirishlar: ' + (summary.deletions || 0) : 'O‘chirishlar: tizimda qayd etilmaydi'),
    line(rule),
    line('SUMMЫ PO KATEGORIYAM')
  ];
  for (const category of (summary.categories || [])) {
    out.push(line(pad(category.name || 'Boshqa',28) + right(amount(category.total),14)));
  }
  out.push(
    line(rule),
    Buffer.from([0x1b,0x45,0x01]),
    line(pad('JAMI TUSHUM:',28) + right(amount(summary.total),14)),
    Buffer.from([0x1b,0x45,0x00]),
    line(rule),
    line('OPLATA PO VIDAM:')
  );
  for (const payment of (summary.payments || [])) {
    out.push(line(pad(payment.name || 'Naqd',20) + right(payment.count || 0,5) + right(amount(payment.total),17)));
  }
  out.push(line(''), Buffer.from([0x1d,0x56,0x42,0x00]));
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

      if (job.report && job.report.type === 'daily') {
        console.log('ORZU kunlik hisobot topildi');
        await send(job.printerIp || '192.168.1.51', makeDailyReportReceipt(job.report));
      } else if (job.report && job.report.type === 'shift') {
        console.log('ORZU smena hisoboti topildi');
        await send(job.printerIp || '192.168.1.51', makeShiftReportReceipt(job.report));
      } else {
        if (!job.order || !Array.isArray(job.order.items) || !job.order.items.length) {
          throw new Error('Buyurtma ma’lumoti noto‘g‘ri');
        }
        console.log('ORZU buyurtma topildi:', job.order.id);
        await send(job.printerIp || '192.168.1.51', makeReceipt(job.order));
      }

      const ack = await fetch(API_BASE + '/api/printer/jobs/ack', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-orzu-print-key': PRINT_KEY
        },
        body: JSON.stringify({ id: data.job.id })
      });

      if (!ack.ok) throw new Error('Print acknowledgement failed');

      console.log('ORZU chek muvaffaqiyatli chiqarildi:', job.report ? job.report.type : (job.order?.id ?? job.id));

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
