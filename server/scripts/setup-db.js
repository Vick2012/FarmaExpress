// Crea la base de datos (si no existe), aplica database/schema.sql y carga
// datos de demostración coherentes: todo el stock entra por compras o
// ajustes con su movimiento en el ledger, y las ventas usan FEFO.
//
//   npm run db:setup          (desde la raíz del proyecto)
//
// ATENCIÓN: borra y recrea el esquema `public` de la base configurada.

import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import bcrypt from 'bcryptjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = path.resolve(__dirname, '../../database/schema.sql');

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
};

// Credenciales de prueba para la demostración (no usar en producción).
export const USUARIOS_DEMO = [
  { nombre: 'Laura Méndez', correo: 'admin@farmaexpress.com', contrasena: 'Admin2026', rol: 'Administrador', sucursal: 'Sede Principal', contrato: 'Indefinido' },
  { nombre: 'Andrés Ruiz', correo: 'farmaceutico@farmaexpress.com', contrasena: 'Farma2026', rol: 'Farmacéutico', sucursal: 'Sede Principal', contrato: 'Indefinido' },
  { nombre: 'Camila Torres', correo: 'farmaceutico.norte@farmaexpress.com', contrasena: 'Farma2026', rol: 'Farmacéutico', sucursal: 'Sucursal Norte', contrato: 'Fijo' },
  { nombre: 'Julián Pardo', correo: 'repartidor@farmaexpress.com', contrasena: 'Reparto2026', rol: 'Repartidor', sucursal: 'Sede Principal', contrato: 'Prestación de servicios' },
];

async function crearBaseSiNoExiste(nombreBase) {
  const admin = new pg.Client({ ...config, database: 'postgres' });
  await admin.connect();
  const existe = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [nombreBase]);
  if (existe.rowCount === 0) {
    await admin.query(`CREATE DATABASE "${nombreBase}" ENCODING 'UTF8' TEMPLATE template0`);
    console.log(`Base de datos ${nombreBase} creada.`);
  }
  await admin.end();
}

// Fecha local (no UTC) desplazada n días, en formato AAAA-MM-DD: en Bogotá,
// después de las 7 p. m. la fecha UTC ya es la del día siguiente.
const dias = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

async function sembrar(client) {
  const idDe = async (sql, params) => (await client.query(sql, params)).rows[0].id;
  const catalogo = async (tabla, columna, valor) => idDe(`SELECT id FROM ${tabla} WHERE ${columna} = $1`, [valor]);

  // --- Catálogos de negocio
  const sucursales = {};
  for (const [nombre, direccion, principal] of [
    ['Sede Principal', 'Cra 15 # 40-20, Bogotá', true],
    ['Sucursal Norte', 'Calle 140 # 19-35, Bogotá', false],
    ['Sucursal Sur', 'Av. 1 de Mayo # 68-10, Bogotá', false],
  ]) {
    sucursales[nombre] = await idDe('INSERT INTO sucursales (nombre, direccion, es_principal) VALUES ($1, $2, $3) RETURNING id', [nombre, direccion, principal]);
  }

  const categorias = {};
  for (const nombre of ['Analgésicos', 'Antiinflamatorios', 'Antibióticos', 'Antialérgicos', 'Gastrointestinales', 'Vitaminas', 'Psicotrópicos', 'Opioides', 'Cardiovasculares', 'Hidratación']) {
    categorias[nombre] = await idDe('INSERT INTO categorias (nombre) VALUES ($1) RETURNING id', [nombre]);
  }
  const marcas = {};
  for (const nombre of ['Genfar', 'MK', 'La Santé', 'Bayer', 'Pfizer', 'Roche', 'Procaps']) {
    marcas[nombre] = await idDe('INSERT INTO marcas (nombre) VALUES ($1) RETURNING id', [nombre]);
  }
  const aseguradoras = {};
  for (const nombre of ['Sanitas EPS', 'Sura EPS', 'Nueva EPS', 'Compensar EPS']) {
    aseguradoras[nombre] = await idDe('INSERT INTO aseguradoras (nombre) VALUES ($1) RETURNING id', [nombre]);
  }
  const proveedores = [];
  for (const p of [
    ['Distribuidora Salud S.A.S.', 'Luis Ortega', '3100001111', 'ventas@distrisalud.co', 'Cra 12 # 34-56'],
    ['Droguería Mayorista Andina', 'Sofía Díaz', '3111112222', 'pedidos@mayoristaandina.co', 'Av. 7 # 23-12'],
  ]) {
    proveedores.push(await idDe('INSERT INTO proveedores (nombre, nombre_contacto, telefono, correo, direccion) VALUES ($1,$2,$3,$4,$5) RETURNING id', p));
  }

  // --- Empleados (contraseñas con bcrypt, RNF-01)
  const empleados = {};
  for (const u of USUARIOS_DEMO) {
    empleados[u.correo] = await idDe(
      `INSERT INTO empleados (nombre, correo, hash_contrasena, id_rol, id_sucursal, id_tipo_contrato)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [u.nombre, u.correo, await bcrypt.hash(u.contrasena, 10), await catalogo('roles', 'nombre_rol', u.rol),
        sucursales[u.sucursal], await catalogo('tipos_contrato', 'nombre_tipo', u.contrato)]
    );
  }
  const admin = empleados['admin@farmaexpress.com'];

  // --- Medicamentos
  const productos = {};
  for (const [nombre, presentacion, sku, categoria, marca, precio, costo, receta, control] of [
    ['Acetaminofén 500 mg', 'Tableta x 20', 'ACE-500', 'Analgésicos', 'Genfar', 6200, 4200, false, false],
    ['Ibuprofeno 400 mg', 'Tableta x 10', 'IBU-400', 'Antiinflamatorios', 'MK', 8800, 5600, false, false],
    ['Amoxicilina 500 mg', 'Cápsula x 21', 'AMX-500', 'Antibióticos', 'La Santé', 14250, 9800, true, false],
    ['Loratadina 10 mg', 'Tableta x 10', 'LOR-10', 'Antialérgicos', 'Genfar', 7500, 4100, false, false],
    ['Omeprazol 20 mg', 'Cápsula x 14', 'OME-20', 'Gastrointestinales', 'Procaps', 9900, 5200, false, false],
    ['Vitamina C 1000 mg', 'Tableta efervescente x 10', 'VITC-1000', 'Vitaminas', 'Bayer', 9800, 6200, false, false],
    ['Losartán 50 mg', 'Tableta x 30', 'LOS-50', 'Cardiovasculares', 'MK', 12000, 7000, true, false],
    ['Clonazepam 2 mg', 'Tableta x 30', 'CLO-2', 'Psicotrópicos', 'Roche', 18500, 11000, true, true],
    ['Morfina 10 mg/ml', 'Ampolla x 1', 'MOR-10', 'Opioides', 'Pfizer', 32000, 21000, true, true],
    ['Suero oral', 'Sobre x 1', 'SUE-01', 'Hidratación', 'Procaps', 4500, 2500, false, false],
  ]) {
    productos[sku] = {
      id: await idDe(
        `INSERT INTO productos (nombre_generico, presentacion, sku, id_categoria, id_marca, precio, costo, requiere_receta, control_especial)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [nombre, presentacion, sku, categorias[categoria], marcas[marca], precio, costo, receta, control]
      ),
      precio,
      costo,
    };
  }

  const movimiento = async (idLote, idSucursal, tipo, cantidad, tipoRef, idRef, nota, creadoPor, fecha = null) => {
    await client.query(
      `INSERT INTO movimientos_inventario (id_lote, id_sucursal, id_tipo_movimiento, cantidad, tipo_referencia, id_referencia, nota, creado_por, fecha_creacion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8, COALESCE($9::timestamp, NOW()))`,
      [idLote, idSucursal, await catalogo('tipos_movimiento', 'nombre_tipo', tipo), cantidad, tipoRef, idRef, nota, creadoPor, fecha]
    );
  };
  const sumarStock = (idLote, idSucursal, cantidad) => client.query(
    `INSERT INTO stock_lote (id_lote, id_sucursal, stock) VALUES ($1,$2,$3)
     ON CONFLICT (id_lote, id_sucursal) DO UPDATE SET stock = stock_lote.stock + EXCLUDED.stock`,
    [idLote, idSucursal, cantidad]
  );

  // --- Compras iniciales (hace 20 días): dos lotes por producto, uno que
  // vence pronto y otro a un año, distribuidos entre las sucursales.
  const fechaCompra = `${dias(-20)} 09:00`;
  const reparto = { 'Sede Principal': 1, 'Sucursal Norte': 0.6, 'Sucursal Sur': 0.4 };
  let numeroFactura = 1001;
  for (const [nombreSucursal, factor] of Object.entries(reparto)) {
    const idSucursal = sucursales[nombreSucursal];
    const idCompra = await idDe(
      `INSERT INTO compras (id_proveedor, id_sucursal, id_empleado, numero_factura, total, fecha_compra, fecha_creacion)
       VALUES ($1, $2, $3, $4, 0, $5, $5) RETURNING id`,
      [proveedores[numeroFactura % 2], idSucursal, admin, `FAC-${numeroFactura++}`, fechaCompra]
    );
    let total = 0;
    for (const [sku, p] of Object.entries(productos)) {
      for (const [sufijo, vence, cantidadBase] of [['A', dias(45), 30], ['B', dias(365), 80]]) {
        const numeroLote = `${sku}-${sufijo}26`;
        const idLote = await idDe(
          `INSERT INTO lotes (id_producto, numero_lote, fecha_fabricacion, fecha_vencimiento) VALUES ($1, $2, $3, $4)
           ON CONFLICT (id_producto, numero_lote) DO UPDATE SET numero_lote = EXCLUDED.numero_lote RETURNING id`,
          [p.id, numeroLote, dias(-200), vence]
        );
        const cantidad = Math.round(cantidadBase * factor * (sku.startsWith('MOR') || sku.startsWith('CLO') ? 0.3 : 1));
        await client.query(
          'INSERT INTO detalle_compra (id_compra, id_lote, cantidad, costo_unitario, subtotal) VALUES ($1,$2,$3,$4,$5)',
          [idCompra, idLote, cantidad, p.costo, cantidad * p.costo]
        );
        await sumarStock(idLote, idSucursal, cantidad);
        await movimiento(idLote, idSucursal, 'compra', cantidad, 'compra', idCompra, null, admin, fechaCompra);
        total += cantidad * p.costo;
      }
    }
    await client.query('UPDATE compras SET total = $1 WHERE id = $2', [total, idCompra]);
  }

  // Un lote ya vencido en la sede principal: demuestra que FEFO nunca lo vende.
  const loteVencido = await idDe(
    'INSERT INTO lotes (id_producto, numero_lote, fecha_fabricacion, fecha_vencimiento) VALUES ($1, $2, $3, $4) RETURNING id',
    [productos['ACE-500'].id, 'ACE-500-V25', dias(-500), dias(-10)]
  );
  await sumarStock(loteVencido, sucursales['Sede Principal'], 12);
  await movimiento(loteVencido, sucursales['Sede Principal'], 'ajuste', 12, 'ajuste', null, 'Inventario inicial (conteo físico)', admin, fechaCompra);

  // --- Pacientes (con acudiente y aseguradora)
  const pacientes = [];
  for (const [nombre, documento, telefono, direccion, aseguradora] of [
    ['María Pérez', '1012345678', '3001234567', 'Calle 45 # 12-30, Bogotá', 'Sanitas EPS'],
    ['Carlos Rojas', '1023456789', '3019876543', 'Cra 7 # 72-15, Bogotá', 'Sura EPS'],
    ['Ana Gómez', '1034567890', '3024567890', 'Calle 100 # 15-20, Bogotá', 'Nueva EPS'],
    ['Jorge Castillo', '79876543', '3045558899', 'Av. Boyacá # 64-10, Bogotá', 'Compensar EPS'],
  ]) {
    pacientes.push(await idDe(
      `INSERT INTO pacientes (nombre_completo, documento_numero, telefono, direccion, id_aseguradora, correo)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [nombre, documento, telefono, direccion, aseguradoras[aseguradora], `${nombre.split(' ')[0].toLowerCase()}@correo.com`]
    ));
  }
  pacientes.push(await idDe(
    `INSERT INTO pacientes (nombre_completo, documento_numero, direccion, id_acudiente, id_aseguradora)
     VALUES ('Sofía Pérez', '1101234567', 'Calle 45 # 12-30, Bogotá', $1, $2) RETURNING id`,
    [pacientes[0], aseguradoras['Sanitas EPS']]
  ));

  // --- Ventas históricas de los últimos 14 días (FEFO, con ledger y pago)
  const estadoCompletada = await catalogo('estados_venta', 'nombre_estado', 'completada');
  const pagoAprobado = await catalogo('estados_pago', 'nombre_estado', 'aprobado');
  const idsMetodo = [];
  for (const nombre of ['Efectivo', 'Tarjeta', 'Transferencia']) idsMetodo.push(await catalogo('metodos_pago', 'nombre', nombre));
  const vendedores = [
    [empleados['farmaceutico@farmaexpress.com'], sucursales['Sede Principal']],
    [empleados['farmaceutico.norte@farmaexpress.com'], sucursales['Sucursal Norte']],
  ];
  const canasta = ['ACE-500', 'IBU-400', 'LOR-10', 'OME-20', 'VITC-1000', 'SUE-01', 'AMX-500', 'LOS-50'];

  let semilla = 7;
  const azar = (n) => { semilla = (semilla * 9301 + 49297) % 233280; return Math.floor((semilla / 233280) * n); };

  const ventasCreadas = [];
  for (let dia = 13; dia >= 0; dia -= 1) {
    const ventasDelDia = 1 + azar(3);
    for (let v = 0; v < ventasDelDia; v += 1) {
      const [idVendedor, idSucursal] = vendedores[azar(2)];
      // Las ventas de hoy quedan antes de la hora actual, nunca en el futuro.
      const hora = dia === 0 ? Math.max(0, new Date().getHours() - 1 - azar(3)) : 9 + azar(9);
      const fecha = `${dias(-dia)} ${String(hora).padStart(2, '0')}:${String(azar(60)).padStart(2, '0')}`;
      const skus = [...new Set([canasta[azar(canasta.length)], canasta[azar(canasta.length)]])];
      const conReceta = skus.some((s) => ['AMX-500', 'LOS-50'].includes(s));
      const idPaciente = pacientes[azar(pacientes.length)];

      const idVenta = await idDe(
        `INSERT INTO ventas (id_paciente, id_sucursal, id_empleado, id_estado, total, fecha_venta, numero_receta)
         VALUES ($1,$2,$3,$4,0,$5,$6) RETURNING id`,
        [idPaciente, idSucursal, idVendedor, estadoCompletada, fecha, conReceta ? `RX-${100000 + idPaciente * 37 + dia * 11 + v}` : null]
      );
      let total = 0;
      for (const sku of skus) {
        const cantidad = 1 + azar(3);
        const lote = await client.query(
          `SELECT sl.id_lote FROM stock_lote sl JOIN lotes l ON l.id = sl.id_lote
           WHERE l.id_producto = $1 AND sl.id_sucursal = $2 AND sl.stock >= $3 AND l.fecha_vencimiento > CURRENT_DATE
           ORDER BY l.fecha_vencimiento LIMIT 1`,
          [productos[sku].id, idSucursal, cantidad]
        );
        const idLote = lote.rows[0].id_lote;
        const subtotal = productos[sku].precio * cantidad;
        await client.query(
          'INSERT INTO detalle_venta (id_venta, id_lote, cantidad, precio_unitario, subtotal) VALUES ($1,$2,$3,$4,$5)',
          [idVenta, idLote, cantidad, productos[sku].precio, subtotal]
        );
        await client.query('UPDATE stock_lote SET stock = stock - $1 WHERE id_lote = $2 AND id_sucursal = $3', [cantidad, idLote, idSucursal]);
        await movimiento(idLote, idSucursal, 'venta', -cantidad, 'venta', idVenta, null, idVendedor, fecha);
        total += subtotal;
      }
      await client.query('UPDATE ventas SET total = $1 WHERE id = $2', [total, idVenta]);
      await client.query(
        'INSERT INTO pagos (id_venta, id_metodo_pago, monto, id_estado, fecha_pago, fecha_creacion) VALUES ($1,$2,$3,$4,$5,$5)',
        [idVenta, idsMetodo[azar(3)], total, pagoAprobado, fecha]
      );
      ventasCreadas.push({ idVenta, idSucursal, dia });
    }
  }

  // --- Despachos: uno entregado y uno pendiente en la sede principal
  const repartidor = empleados['repartidor@farmaexpress.com'];
  const principales = ventasCreadas.filter((v) => v.idSucursal === sucursales['Sede Principal']);
  const [entregada, pendiente] = [principales[0], principales[principales.length - 1]];
  // La dirección de entrega es la del paciente de cada venta.
  await client.query(
    `INSERT INTO despachos (id_venta, id_empleado, id_estado, direccion, fecha_programada, fecha_entrega)
     SELECT v.id, $2, $3, p.direccion, $4, $4 FROM ventas v JOIN pacientes p ON p.id = v.id_paciente WHERE v.id = $1`,
    [entregada.idVenta, repartidor, await catalogo('estados_despacho', 'nombre_estado', 'entregado'), `${dias(-entregada.dia)} 17:00`]
  );
  await client.query(
    `INSERT INTO despachos (id_venta, id_estado, direccion, fecha_programada)
     SELECT v.id, $2, p.direccion, $3 FROM ventas v JOIN pacientes p ON p.id = v.id_paciente WHERE v.id = $1`,
    [pendiente.idVenta, await catalogo('estados_despacho', 'nombre_estado', 'pendiente'), `${dias(1)} 10:00`]
  );

  // --- Un traslado pendiente de la sede principal a la sucursal Sur
  const loteTraslado = await idDe(
    `SELECT l.id FROM lotes l WHERE l.id_producto = $1 AND l.numero_lote = 'IBU-400-B26'`, [productos['IBU-400'].id]
  );
  const idTraslado = await idDe(
    `INSERT INTO traslados_inventario (id_sucursal_origen, id_sucursal_destino, id_empleado, id_estado)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [sucursales['Sede Principal'], sucursales['Sucursal Sur'], empleados['farmaceutico@farmaexpress.com'],
      await catalogo('estados_traslado', 'nombre_estado', 'pendiente')]
  );
  await client.query('INSERT INTO detalle_traslado (id_traslado, id_lote, cantidad) VALUES ($1, $2, 10)', [idTraslado, loteTraslado]);
  await client.query('UPDATE stock_lote SET stock = stock - 10 WHERE id_lote = $1 AND id_sucursal = $2', [loteTraslado, sucursales['Sede Principal']]);
  await movimiento(loteTraslado, sucursales['Sede Principal'], 'traslado_salida', -10, 'traslado', idTraslado, null, empleados['farmaceutico@farmaexpress.com']);

  return ventasCreadas.length;
}

/** Recrea el esquema y carga los datos de demostración en `database`. */
export async function prepararBase({ database = process.env.DB_NAME || 'farmaexpress', silencioso = false } = {}) {
  await crearBaseSiNoExiste(database);
  const client = new pg.Client({ ...config, database });
  await client.connect();
  try {
    await client.query(await readFile(SCHEMA_PATH, 'utf8'));
    await client.query('BEGIN');
    const ventas = await sembrar(client);
    await client.query('COMMIT');
    if (!silencioso) {
      console.log(`Esquema aplicado y datos de demostración cargados en "${database}" (${ventas} ventas).`);
      console.log('Usuarios de prueba:');
      for (const u of USUARIOS_DEMO) console.log(`  ${u.rol.padEnd(13)} ${u.correo} / ${u.contrasena}`);
    }
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  prepararBase().catch((error) => {
    console.error('No se pudo preparar la base de datos:', error.message);
    process.exit(1);
  });
}
