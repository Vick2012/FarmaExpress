import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { asyncHandler, badRequest } from '../errors.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';
import { registrarMovimiento, sumarStock, verificarSucursalActiva } from '../services/inventario.js';

const router = Router();
const soloAdmin = requireRole(ROLES.ADMIN);

// ------------------------------------------------------------------
// Proveedores
// ------------------------------------------------------------------

router.get('/proveedores', asyncHandler(async (req, res) => {
  const result = await query('SELECT * FROM proveedores ORDER BY nombre');
  res.json(result.rows);
}));

router.post('/proveedores', soloAdmin, asyncHandler(async (req, res) => {
  const nombre = String(req.body.nombre || '').trim();
  if (!nombre) throw badRequest('El nombre del proveedor es obligatorio.');
  const { nombre_contacto, telefono, correo, direccion } = req.body;
  const result = await query(
    `INSERT INTO proveedores (nombre, nombre_contacto, telefono, correo, direccion)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [nombre, nombre_contacto || null, telefono || null, correo || null, direccion || null]
  );
  res.status(201).json(result.rows[0]);
}));

// ------------------------------------------------------------------
// Compras (RF-05)
// ------------------------------------------------------------------

router.get('/', soloAdmin, asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const result = await query(
    `SELECT c.id, c.numero_factura, c.total, c.fecha_compra, pr.nombre AS proveedor, s.nombre AS sucursal,
            e.nombre AS registrado_por,
            (SELECT json_agg(json_build_object(
                      'producto', p.nombre_generico, 'numero_lote', l.numero_lote,
                      'fecha_vencimiento', l.fecha_vencimiento, 'cantidad', dc.cantidad,
                      'costo_unitario', dc.costo_unitario, 'subtotal', dc.subtotal) ORDER BY dc.id)
             FROM detalle_compra dc JOIN lotes l ON l.id = dc.id_lote JOIN productos p ON p.id = l.id_producto
             WHERE dc.id_compra = c.id) AS items,
            COUNT(*) OVER () AS total_count
     FROM compras c
     JOIN proveedores pr ON pr.id = c.id_proveedor
     JOIN sucursales s ON s.id = c.id_sucursal
     JOIN empleados e ON e.id = c.id_empleado
     ORDER BY c.id DESC
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

/**
 * Registra la recepción de una compra en UNA transacción:
 * cabecera + lotes (nuevos o existentes) + detalle + stock + ledger.
 * El total lo calcula el servidor, nunca se acepta desde el cliente.
 */
router.post('/', soloAdmin, asyncHandler(async (req, res) => {
  const idProveedor = Number(req.body.id_proveedor);
  const idSucursal = Number(req.body.id_sucursal);
  const numeroFactura = String(req.body.numero_factura || '').trim() || null;
  const items = Array.isArray(req.body.items) ? req.body.items : [];

  if (!idProveedor) throw badRequest('Selecciona un proveedor.');
  if (!idSucursal) throw badRequest('Selecciona la sucursal que recibe la compra.');
  if (items.length === 0) throw badRequest('La compra debe incluir al menos un producto.');

  const normalizados = items.map((item, index) => {
    const fila = index + 1;
    const idProducto = Number(item.id_producto);
    const cantidad = Number(item.cantidad);
    const costoUnitario = Number(item.costo_unitario);
    const numeroLote = String(item.numero_lote || '').trim().toUpperCase();
    const fechaVencimiento = item.fecha_vencimiento;
    if (!idProducto) throw badRequest(`Fila ${fila}: producto inválido.`);
    if (!Number.isInteger(cantidad) || cantidad <= 0) throw badRequest(`Fila ${fila}: la cantidad debe ser un entero mayor que cero.`);
    if (!(costoUnitario >= 0)) throw badRequest(`Fila ${fila}: costo unitario inválido.`);
    if (!numeroLote) throw badRequest(`Fila ${fila}: el número de lote es obligatorio.`);
    if (!fechaVencimiento) throw badRequest(`Fila ${fila}: la fecha de vencimiento es obligatoria.`);
    if (new Date(fechaVencimiento) <= new Date()) throw badRequest(`Fila ${fila}: no se reciben lotes vencidos.`);
    return { idProducto, cantidad, costoUnitario, numeroLote, fechaVencimiento, fechaFabricacion: item.fecha_fabricacion || null };
  });

  const compra = await withTransaction(async (client) => {
    await verificarSucursalActiva(client, idSucursal);

    const total = normalizados.reduce((sum, i) => sum + i.cantidad * i.costoUnitario, 0);
    const cabecera = await client.query(
      `INSERT INTO compras (id_proveedor, id_sucursal, id_empleado, numero_factura, total)
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [idProveedor, idSucursal, req.user.id, numeroFactura, total]
    );
    const idCompra = cabecera.rows[0].id;

    for (const item of normalizados) {
      // Si el lote ya existe para el producto se reutiliza; su vencimiento
      // debe coincidir, porque un lote tiene una sola fecha de vencimiento.
      const lote = await client.query(
        `INSERT INTO lotes (id_producto, numero_lote, fecha_fabricacion, fecha_vencimiento)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (id_producto, numero_lote) DO UPDATE SET numero_lote = EXCLUDED.numero_lote
         RETURNING id, fecha_vencimiento::text AS fecha_vencimiento`,
        [item.idProducto, item.numeroLote, item.fechaFabricacion, item.fechaVencimiento]
      );
      const { id: idLote, fecha_vencimiento: vencimientoGuardado } = lote.rows[0];
      if (vencimientoGuardado !== String(item.fechaVencimiento).slice(0, 10)) {
        throw badRequest(`El lote ${item.numeroLote} ya existe con vencimiento ${vencimientoGuardado}.`);
      }

      await client.query(
        `INSERT INTO detalle_compra (id_compra, id_lote, cantidad, costo_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [idCompra, idLote, item.cantidad, item.costoUnitario, item.cantidad * item.costoUnitario]
      );
      await sumarStock(client, { idLote, idSucursal, cantidad: item.cantidad });
      await registrarMovimiento(client, {
        idLote, idSucursal, tipo: 'compra', cantidad: item.cantidad,
        tipoReferencia: 'compra', idReferencia: idCompra, creadoPor: req.user.id,
      });
    }

    return cabecera.rows[0];
  });

  res.status(201).json(compra);
}));

export default router;
