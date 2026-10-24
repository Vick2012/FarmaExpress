import { catalogId } from '../db.js';
import { badRequest } from '../errors.js';

// ------------------------------------------------------------------
// Operaciones de bajo nivel sobre stock_lote + ledger.
// Todas reciben el `client` de una transacción abierta: nunca se
// llaman fuera de withTransaction, así el stock y su movimiento en el
// ledger se confirman o se deshacen juntos.
// ------------------------------------------------------------------

export async function registrarMovimiento(client, {
  idLote, idSucursal, tipo, cantidad, tipoReferencia = null, idReferencia = null, nota = null, creadoPor,
}) {
  const idTipo = await catalogId(client, 'tipos_movimiento', tipo);
  await client.query(
    `INSERT INTO movimientos_inventario
       (id_lote, id_sucursal, id_tipo_movimiento, cantidad, tipo_referencia, id_referencia, nota, creado_por)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [idLote, idSucursal, idTipo, cantidad, tipoReferencia, idReferencia, nota, creadoPor]
  );
}

export async function sumarStock(client, { idLote, idSucursal, cantidad }) {
  await client.query(
    `INSERT INTO stock_lote (id_lote, id_sucursal, stock) VALUES ($1, $2, $3)
     ON CONFLICT (id_lote, id_sucursal) DO UPDATE SET stock = stock_lote.stock + EXCLUDED.stock`,
    [idLote, idSucursal, cantidad]
  );
}

/**
 * Descuenta stock de forma condicional: el UPDATE solo afecta la fila si
 * todavía hay unidades suficientes. Si otra transacción concurrente se
 * llevó el stock primero, rowCount = 0 y toda la operación se revierte.
 */
export async function restarStock(client, { idLote, idSucursal, cantidad }) {
  const result = await client.query(
    `UPDATE stock_lote SET stock = stock - $1
     WHERE id_lote = $2 AND id_sucursal = $3 AND stock >= $1`,
    [cantidad, idLote, idSucursal]
  );
  if (result.rowCount === 0) {
    throw badRequest('Stock insuficiente: otra operación consumió las unidades. Intenta de nuevo.');
  }
}

/**
 * Elige de qué lotes sale la mercancía con la regla FEFO (First Expired,
 * First Out): primero lo que vence antes. Los lotes vencidos nunca se
 * despachan. Las filas quedan bloqueadas (FOR UPDATE) hasta el COMMIT,
 * así dos ventas simultáneas no pueden vender la misma unidad.
 */
export async function asignarLotesFEFO(client, { idProducto, idSucursal, cantidad, nombreProducto }) {
  const result = await client.query(
    `SELECT sl.id_lote, sl.stock, l.numero_lote, l.fecha_vencimiento
     FROM stock_lote sl
     JOIN lotes l ON l.id = sl.id_lote
     WHERE l.id_producto = $1
       AND sl.id_sucursal = $2
       AND sl.stock > 0
       AND l.fecha_vencimiento > CURRENT_DATE
     ORDER BY l.fecha_vencimiento, l.id
     FOR UPDATE OF sl`,
    [idProducto, idSucursal]
  );

  const disponible = result.rows.reduce((sum, row) => sum + row.stock, 0);
  if (disponible < cantidad) {
    throw badRequest(
      `Stock insuficiente de ${nombreProducto ?? `producto ${idProducto}`} en la sucursal. ` +
      `Disponible (sin vencidos): ${disponible}, solicitado: ${cantidad}.`
    );
  }

  const asignaciones = [];
  let pendiente = cantidad;
  for (const row of result.rows) {
    if (pendiente === 0) break;
    const tomar = Math.min(row.stock, pendiente);
    asignaciones.push({ idLote: row.id_lote, numeroLote: row.numero_lote, cantidad: tomar });
    pendiente -= tomar;
  }
  return asignaciones;
}

export async function verificarSucursalActiva(client, idSucursal) {
  const result = await client.query('SELECT activa FROM sucursales WHERE id = $1', [idSucursal]);
  if (result.rowCount === 0) throw badRequest(`La sucursal ${idSucursal} no existe.`);
  if (!result.rows[0].activa) throw badRequest(`La sucursal ${idSucursal} está inactiva.`);
}

// Valida y normaliza una lista de ítems {id_producto, cantidad}. Suma
// cantidades repetidas y ordena por producto: bloquear siempre en el mismo
// orden evita interbloqueos (deadlocks) entre transacciones concurrentes.
export function normalizarItems(items) {
  if (!Array.isArray(items) || items.length === 0) {
    throw badRequest('Debes incluir al menos un producto.');
  }
  const porProducto = new Map();
  for (const item of items) {
    const idProducto = Number(item.id_producto);
    const cantidad = Number(item.cantidad);
    if (!Number.isInteger(idProducto) || idProducto <= 0) throw badRequest('Producto inválido.');
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw badRequest('La cantidad debe ser un entero mayor que cero.');
    porProducto.set(idProducto, (porProducto.get(idProducto) || 0) + cantidad);
  }
  return [...porProducto.entries()]
    .sort(([a], [b]) => a - b)
    .map(([idProducto, cantidad]) => ({ idProducto, cantidad }));
}
