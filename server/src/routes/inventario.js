import { Router } from 'express';
import { query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, forbidden } from '../errors.js';
import { isAdmin, requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';
import { registrarMovimiento, restarStock, sumarStock, verificarSucursalActiva } from '../services/inventario.js';

const router = Router();

// RF-02: stock centralizado. Sin `sucursal` muestra el total de la red y
// el desglose por sucursal de cada producto.
router.get('/stock', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const idSucursal = req.query.sucursal ? Number(req.query.sucursal) : null;
  const q = `%${String(req.query.q || '').trim()}%`;
  const result = await query(
    `SELECT p.id, p.nombre_generico, p.presentacion, p.sku, p.control_especial,
            COALESCE(SUM(sl.stock) FILTER (WHERE $1::int IS NULL OR sl.id_sucursal = $1), 0)::int AS stock,
            COALESCE(SUM(sl.stock) FILTER (WHERE ($1::int IS NULL OR sl.id_sucursal = $1)
                                            AND l.fecha_vencimiento <= CURRENT_DATE), 0)::int AS stock_vencido,
            MIN(l.fecha_vencimiento) FILTER (WHERE sl.stock > 0 AND l.fecha_vencimiento > CURRENT_DATE
                                             AND ($1::int IS NULL OR sl.id_sucursal = $1)) AS proximo_vencimiento,
            COALESCE(
              (SELECT json_agg(json_build_object('sucursal', s.nombre, 'id_sucursal', s.id, 'stock', x.stock) ORDER BY s.es_principal DESC, s.nombre)
               FROM (SELECT sl2.id_sucursal, SUM(sl2.stock)::int AS stock
                     FROM stock_lote sl2 JOIN lotes l2 ON l2.id = sl2.id_lote
                     WHERE l2.id_producto = p.id GROUP BY sl2.id_sucursal) x
               JOIN sucursales s ON s.id = x.id_sucursal), '[]') AS por_sucursal,
            COUNT(*) OVER () AS total_count
     FROM productos p
     LEFT JOIN lotes l ON l.id_producto = p.id
     LEFT JOIN stock_lote sl ON sl.id_lote = l.id
     WHERE p.activo AND (p.nombre_generico ILIKE $2 OR p.sku ILIKE $2)
     GROUP BY p.id
     ORDER BY p.nombre_generico
     LIMIT $3 OFFSET $4`,
    [idSucursal, q, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

// Lotes con stock de un producto o de una sucursal (control de vencimientos).
router.get('/lotes', asyncHandler(async (req, res) => {
  const idProducto = req.query.producto ? Number(req.query.producto) : null;
  const idSucursal = req.query.sucursal ? Number(req.query.sucursal) : null;
  const result = await query(
    `SELECT l.id AS id_lote, l.numero_lote, l.fecha_vencimiento, p.id AS id_producto, p.nombre_generico,
            s.id AS id_sucursal, s.nombre AS sucursal, sl.stock,
            (l.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer
     FROM stock_lote sl
     JOIN lotes l ON l.id = sl.id_lote
     JOIN productos p ON p.id = l.id_producto
     JOIN sucursales s ON s.id = sl.id_sucursal
     WHERE sl.stock > 0
       AND ($1::int IS NULL OR p.id = $1)
       AND ($2::int IS NULL OR s.id = $2)
     ORDER BY l.fecha_vencimiento, p.nombre_generico
     LIMIT 200`,
    [idProducto, idSucursal]
  );
  res.json(result.rows);
}));

// Alertas: lotes vencidos o que vencen en los próximos 90 días, y
// productos con stock bajo en alguna sucursal.
router.get('/alertas', asyncHandler(async (req, res) => {
  const [vencimientos, stockBajo] = await Promise.all([
    query(
      `SELECT l.id AS id_lote, l.numero_lote, l.fecha_vencimiento, p.nombre_generico, s.nombre AS sucursal, sl.stock,
              (l.fecha_vencimiento - CURRENT_DATE) AS dias_para_vencer
       FROM stock_lote sl JOIN lotes l ON l.id = sl.id_lote
       JOIN productos p ON p.id = l.id_producto JOIN sucursales s ON s.id = sl.id_sucursal
       WHERE sl.stock > 0 AND l.fecha_vencimiento <= CURRENT_DATE + 90
       ORDER BY l.fecha_vencimiento
       LIMIT 50`
    ),
    query(
      `SELECT p.id, p.nombre_generico, s.nombre AS sucursal,
              COALESCE(SUM(sl.stock) FILTER (WHERE l.fecha_vencimiento > CURRENT_DATE), 0)::int AS stock
       FROM productos p CROSS JOIN sucursales s
       LEFT JOIN lotes l ON l.id_producto = p.id
       LEFT JOIN stock_lote sl ON sl.id_lote = l.id AND sl.id_sucursal = s.id
       WHERE p.activo AND s.activa
       GROUP BY p.id, s.id
       HAVING COALESCE(SUM(sl.stock) FILTER (WHERE l.fecha_vencimiento > CURRENT_DATE), 0) <= 10
       ORDER BY stock, p.nombre_generico
       LIMIT 50`
    ),
  ]);
  res.json({ vencimientos: vencimientos.rows, stockBajo: stockBajo.rows });
}));

// RF-03: ledger de trazabilidad, filtrable por producto, sucursal y fechas.
router.get('/movimientos', requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const filtros = [
    req.query.producto ? Number(req.query.producto) : null,
    req.query.sucursal ? Number(req.query.sucursal) : null,
    req.query.desde || null,
    req.query.hasta || null,
  ];
  const result = await query(
    `SELECT m.id, m.fecha_creacion, m.cantidad, m.tipo_referencia, m.id_referencia, m.nota,
            tm.nombre_tipo AS tipo, l.numero_lote, p.nombre_generico, s.nombre AS sucursal,
            e.nombre AS responsable, COUNT(*) OVER () AS total_count
     FROM movimientos_inventario m
     JOIN tipos_movimiento tm ON tm.id = m.id_tipo_movimiento
     JOIN lotes l ON l.id = m.id_lote
     JOIN productos p ON p.id = l.id_producto
     JOIN sucursales s ON s.id = m.id_sucursal
     JOIN empleados e ON e.id = m.creado_por
     WHERE ($1::int IS NULL OR p.id = $1)
       AND ($2::int IS NULL OR m.id_sucursal = $2)
       AND ($3::date IS NULL OR m.fecha_creacion >= $3::date)
       AND ($4::date IS NULL OR m.fecha_creacion < $4::date + 1)
     ORDER BY m.id DESC
     LIMIT $5 OFFSET $6`,
    [...filtros, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

// RF-03: ajuste manual (merma, conteo físico, daño). Exige motivo y queda
// en el ledger con el responsable.
router.post('/ajustes', requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const idLote = Number(req.body.id_lote);
  const idSucursal = Number(req.body.id_sucursal || req.user.id_sucursal);
  const cantidad = Number(req.body.cantidad);
  const nota = String(req.body.nota || '').trim();

  if (!idLote) throw badRequest('Selecciona el lote a ajustar.');
  if (!Number.isInteger(cantidad) || cantidad === 0) throw badRequest('La cantidad del ajuste debe ser un entero distinto de cero.');
  if (nota.length < 5) throw badRequest('Describe el motivo del ajuste (mínimo 5 caracteres).');
  if (!isAdmin(req.user) && idSucursal !== req.user.id_sucursal) {
    throw forbidden('Solo puedes ajustar el inventario de tu propia sucursal.');
  }

  const movimiento = await withTransaction(async (client) => {
    await verificarSucursalActiva(client, idSucursal);
    if (cantidad > 0) {
      await sumarStock(client, { idLote, idSucursal, cantidad });
    } else {
      await restarStock(client, { idLote, idSucursal, cantidad: -cantidad });
    }
    await registrarMovimiento(client, {
      idLote, idSucursal, tipo: 'ajuste', cantidad, tipoReferencia: 'ajuste', nota, creadoPor: req.user.id,
    });
    const stock = await client.query('SELECT stock FROM stock_lote WHERE id_lote = $1 AND id_sucursal = $2', [idLote, idSucursal]);
    return { id_lote: idLote, id_sucursal: idSucursal, cantidad, stock_resultante: stock.rows[0]?.stock ?? 0 };
  });

  res.status(201).json(movimiento);
}));

export default router;
