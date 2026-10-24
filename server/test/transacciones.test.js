// Pruebas de integración de las reglas transaccionales contra PostgreSQL.
// Usan una base aparte (farmaexpress_test) que se recrea en cada corrida.
//
//   npm test            (requiere server/.env con credenciales válidas)

import 'dotenv/config';
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';

process.env.DB_NAME = process.env.DB_NAME_TEST || 'farmaexpress_test';
process.env.NODE_ENV = 'test';

const { prepararBase } = await import('../scripts/setup-db.js');
await prepararBase({ database: process.env.DB_NAME, silencioso: true });

const { default: app } = await import('../src/app.js');
const { pool } = await import('../src/db.js');

let server;
let base;
const tokens = {};

async function llamar(rol, ruta, { method = 'GET', body } = {}) {
  const res = await fetch(`${base}${ruta}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(tokens[rol] ? { Authorization: `Bearer ${tokens[rol]}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

const uno = async (sql, params) => (await pool.query(sql, params)).rows[0];

async function stockProducto(sku, sucursal) {
  const r = await uno(
    `SELECT COALESCE(SUM(sl.stock), 0)::int AS stock FROM stock_lote sl
     JOIN lotes l ON l.id = sl.id_lote JOIN productos p ON p.id = l.id_producto JOIN sucursales s ON s.id = sl.id_sucursal
     WHERE p.sku = $1 AND s.nombre = $2 AND l.fecha_vencimiento > CURRENT_DATE`,
    [sku, sucursal]
  );
  return r.stock;
}
const idProducto = async (sku) => (await uno('SELECT id FROM productos WHERE sku = $1', [sku])).id;
const idMetodo = async () => (await uno("SELECT id FROM metodos_pago WHERE nombre = 'Efectivo'")).id;
const conteos = () => uno(`SELECT (SELECT COUNT(*) FROM ventas) AS ventas, (SELECT COUNT(*) FROM pagos) AS pagos,
                                  (SELECT COUNT(*) FROM movimientos_inventario) AS movimientos`);

before(async () => {
  server = app.listen(0);
  base = `http://127.0.0.1:${server.address().port}`;
  for (const [rol, correo, contrasena] of [
    ['admin', 'admin@farmaexpress.com', 'Admin2026'],
    ['farma', 'farmaceutico@farmaexpress.com', 'Farma2026'],
    ['farmaNorte', 'farmaceutico.norte@farmaexpress.com', 'Farma2026'],
    ['repartidor', 'repartidor@farmaexpress.com', 'Reparto2026'],
  ]) {
    const r = await llamar(null, '/api/auth/login', { method: 'POST', body: { correo, contrasena } });
    assert.equal(r.status, 200, `login de ${correo}`);
    tokens[rol] = r.body.token;
  }
});

after(async () => {
  server.close();
  await pool.end();
});

describe('Seguridad', () => {
  test('rechaza credenciales inválidas y nunca guarda contraseñas en texto plano', async () => {
    const r = await llamar(null, '/api/auth/login', { method: 'POST', body: { correo: 'admin@farmaexpress.com', contrasena: 'incorrecta' } });
    assert.equal(r.status, 401);
    const { hash_contrasena: hash } = await uno("SELECT hash_contrasena FROM empleados WHERE correo = 'admin@farmaexpress.com'");
    assert.match(hash, /^\$2[aby]\$10\$/);
  });

  test('sin token no hay acceso y cada rol solo hace lo suyo', async () => {
    assert.equal((await llamar(null, '/api/productos')).status, 401);
    assert.equal((await llamar('repartidor', '/api/ventas', { method: 'POST', body: { items: [] } })).status, 403);
    assert.equal((await llamar('farma', '/api/compras')).status, 403);
    assert.equal((await llamar('admin', '/api/empleados')).status, 200);
  });

  test('las consultas son parametrizadas: una inyección SQL se trata como texto', async () => {
    const r = await llamar('farma', `/api/productos?q=${encodeURIComponent("' OR 1=1; DROP TABLE ventas; --")}`);
    assert.equal(r.status, 200);
    assert.equal(r.body.total, 0);
    assert.ok(await uno('SELECT COUNT(*) AS n FROM ventas'));
  });
});

describe('Venta atómica (RF-06)', () => {
  test('registra venta, detalle, pago, stock y ledger con el precio de la base', async () => {
    const antes = await stockProducto('IBU-400', 'Sede Principal');
    const c0 = await conteos();
    const r = await llamar('farma', '/api/ventas', {
      method: 'POST',
      body: { id_metodo_pago: await idMetodo(), total: 1, items: [{ id_producto: await idProducto('IBU-400'), cantidad: 3, precio_unitario: 1 }] },
    });
    assert.equal(r.status, 201, r.body.message);
    assert.equal(r.body.total, 8800 * 3, 'el total lo calcula el servidor, no el cliente');
    assert.equal(await stockProducto('IBU-400', 'Sede Principal'), antes - 3);
    const c1 = await conteos();
    assert.equal(c1.ventas, c0.ventas + 1);
    assert.equal(c1.pagos, c0.pagos + 1);
    assert.ok(c1.movimientos > c0.movimientos);
  });

  test('sin fórmula médica la venta se rechaza y no cambia nada', async () => {
    const antes = await stockProducto('AMX-500', 'Sede Principal');
    const c0 = await conteos();
    const r = await llamar('farma', '/api/ventas', {
      method: 'POST', body: { id_metodo_pago: await idMetodo(), items: [{ id_producto: await idProducto('AMX-500'), cantidad: 1 }] },
    });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /fórmula/);
    assert.equal(await stockProducto('AMX-500', 'Sede Principal'), antes);
    assert.deepEqual(await conteos(), c0);
  });

  test('control especial exige paciente identificado', async () => {
    const r = await llamar('farma', '/api/ventas', {
      method: 'POST',
      body: { id_metodo_pago: await idMetodo(), numero_receta: 'RX-9999', items: [{ id_producto: await idProducto('CLO-2'), cantidad: 1 }] },
    });
    assert.equal(r.status, 400);
    assert.match(r.body.message, /paciente/);
  });

  test('un pago rechazado revierte TODA la transacción (ROLLBACK)', async () => {
    const antes = await stockProducto('ACE-500', 'Sede Principal');
    const c0 = await conteos();
    const r = await llamar('farma', '/api/ventas', {
      method: 'POST',
      body: { id_metodo_pago: await idMetodo(), simular_pago_rechazado: true, items: [{ id_producto: await idProducto('ACE-500'), cantidad: 2 }] },
    });
    assert.equal(r.status, 400);
    assert.equal(await stockProducto('ACE-500', 'Sede Principal'), antes);
    assert.deepEqual(await conteos(), c0);
  });

  test('FEFO: vende primero el lote que vence antes y nunca el vencido', async () => {
    const r = await llamar('farma', '/api/ventas', {
      method: 'POST', body: { id_metodo_pago: await idMetodo(), items: [{ id_producto: await idProducto('ACE-500'), cantidad: 1 }] },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.items[0].numeroLote, 'ACE-500-A26');
    const vencido = await uno("SELECT COUNT(*) AS n FROM detalle_venta dv JOIN lotes l ON l.id = dv.id_lote WHERE l.numero_lote = 'ACE-500-V25'");
    assert.equal(vencido.n, 0);
  });

  test('ventas concurrentes nunca sobrevenden (bloqueo de filas)', async () => {
    const sku = 'MOR-10';
    const disponible = await stockProducto(sku, 'Sede Principal');
    const paciente = (await uno('SELECT id FROM pacientes ORDER BY id LIMIT 1')).id;
    const cantidad = 4;
    const intentos = Math.ceil(disponible / cantidad) + 5;
    const body = { id_metodo_pago: await idMetodo(), id_paciente: paciente, numero_receta: 'RX-CONC-1', items: [{ id_producto: await idProducto(sku), cantidad }] };

    const resultados = await Promise.all(Array.from({ length: intentos }, () => llamar('farma', '/api/ventas', { method: 'POST', body })));
    const exitosas = resultados.filter((r) => r.status === 201).length;

    assert.equal(exitosas, Math.floor(disponible / cantidad));
    assert.equal(await stockProducto(sku, 'Sede Principal'), disponible - exitosas * cantidad);
    assert.ok(resultados.every((r) => [201, 400].includes(r.status)));
  });

  test('anular una venta devuelve el stock al mismo lote', async () => {
    const antes = await stockProducto('LOR-10', 'Sede Principal');
    const venta = await llamar('farma', '/api/ventas', {
      method: 'POST', body: { id_metodo_pago: await idMetodo(), items: [{ id_producto: await idProducto('LOR-10'), cantidad: 2 }] },
    });
    assert.equal(await stockProducto('LOR-10', 'Sede Principal'), antes - 2);
    const r = await llamar('farma', `/api/ventas/${venta.body.id}/anular`, { method: 'POST', body: { motivo: 'Error de digitación' } });
    assert.equal(r.status, 200, r.body.message);
    assert.equal(await stockProducto('LOR-10', 'Sede Principal'), antes);
    const otra = await llamar('farma', `/api/ventas/${venta.body.id}/anular`, { method: 'POST', body: { motivo: 'Segundo intento' } });
    assert.equal(otra.status, 400);
  });
});

describe('Traslados (RF-04)', () => {
  test('descuenta en origen al crear y suma en destino solo al confirmar', async () => {
    const [origen, destino] = ['Sede Principal', 'Sucursal Norte'];
    const o0 = await stockProducto('OME-20', origen);
    const d0 = await stockProducto('OME-20', destino);
    const idDestino = (await uno('SELECT id FROM sucursales WHERE nombre = $1', [destino])).id;

    const t = await llamar('farma', '/api/traslados', {
      method: 'POST', body: { id_sucursal_destino: idDestino, items: [{ id_producto: await idProducto('OME-20'), cantidad: 5 }] },
    });
    assert.equal(t.status, 201, t.body.message);
    assert.equal(await stockProducto('OME-20', origen), o0 - 5);
    assert.equal(await stockProducto('OME-20', destino), d0, 'en tránsito no se duplica');

    assert.equal((await llamar('farma', `/api/traslados/${t.body.id}/confirmar`, { method: 'POST' })).status, 403, 'el origen no confirma');
    assert.equal((await llamar('farmaNorte', `/api/traslados/${t.body.id}/confirmar`, { method: 'POST' })).status, 200);
    assert.equal(await stockProducto('OME-20', destino), d0 + 5);
    assert.equal((await llamar('farmaNorte', `/api/traslados/${t.body.id}/confirmar`, { method: 'POST' })).status, 400, 'no se confirma dos veces');
  });
});

describe('Integridad del ledger', () => {
  test('el ledger es inalterable (trigger)', async () => {
    await assert.rejects(pool.query('UPDATE movimientos_inventario SET cantidad = 999 WHERE id = 1'), /inalterable/);
    await assert.rejects(pool.query('DELETE FROM movimientos_inventario WHERE id = 1'), /inalterable/);
  });

  test('el stock de cada lote y sucursal cuadra exactamente con la suma del ledger', async () => {
    const descuadres = await pool.query(
      `SELECT sl.id_lote, sl.id_sucursal, sl.stock, COALESCE(SUM(m.cantidad), 0) AS ledger
       FROM stock_lote sl
       LEFT JOIN movimientos_inventario m ON m.id_lote = sl.id_lote AND m.id_sucursal = sl.id_sucursal
       GROUP BY sl.id_lote, sl.id_sucursal, sl.stock
       HAVING sl.stock <> COALESCE(SUM(m.cantidad), 0)`
    );
    assert.deepEqual(descuadres.rows, []);
  });

  test('la base rechaza stock negativo aunque la aplicación fallara', async () => {
    await assert.rejects(pool.query('UPDATE stock_lote SET stock = -1 WHERE id_lote = (SELECT MIN(id_lote) FROM stock_lote)'), /stock_lote_stock_check|check/);
  });
});
