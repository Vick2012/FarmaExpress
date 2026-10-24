import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../errors.js';
import { isAdmin, requireRole, ROLES } from '../middleware/auth.js';

const router = Router();
router.use(requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO));

// Indicadores del panel. El administrador ve toda la red; el
// farmacéutico, su sucursal.
router.get('/', asyncHandler(async (req, res) => {
  const suc = isAdmin(req.user) ? null : req.user.id_sucursal;
  const [resumen, serie, top, metodos] = await Promise.all([
    query(
      `SELECT
         (SELECT COALESCE(SUM(v.total), 0) FROM ventas v JOIN estados_venta ev ON ev.id = v.id_estado
          WHERE ev.nombre_estado = 'completada' AND v.fecha_venta >= CURRENT_DATE AND ($1::int IS NULL OR v.id_sucursal = $1)) AS ventas_hoy,
         (SELECT COALESCE(SUM(v.total), 0) FROM ventas v JOIN estados_venta ev ON ev.id = v.id_estado
          WHERE ev.nombre_estado = 'completada' AND v.fecha_venta >= date_trunc('month', CURRENT_DATE) AND ($1::int IS NULL OR v.id_sucursal = $1)) AS ventas_mes,
         (SELECT COUNT(*) FROM productos WHERE activo) AS productos,
         (SELECT COUNT(*) FROM pacientes) AS pacientes,
         (SELECT COUNT(*) FROM stock_lote sl JOIN lotes l ON l.id = sl.id_lote
          WHERE sl.stock > 0 AND l.fecha_vencimiento <= CURRENT_DATE + 90 AND ($1::int IS NULL OR sl.id_sucursal = $1)) AS lotes_por_vencer,
         (SELECT COUNT(*) FROM despachos d JOIN estados_despacho ed ON ed.id = d.id_estado JOIN ventas v ON v.id = d.id_venta
          WHERE ed.nombre_estado IN ('pendiente', 'en_ruta') AND ($1::int IS NULL OR v.id_sucursal = $1)) AS despachos_activos,
         (SELECT COUNT(*) FROM traslados_inventario t JOIN estados_traslado et ON et.id = t.id_estado
          WHERE et.nombre_estado = 'pendiente' AND ($1::int IS NULL OR t.id_sucursal_destino = $1 OR t.id_sucursal_origen = $1)) AS traslados_pendientes`,
      [suc]
    ),
    query(
      `SELECT to_char(gs.dia, 'YYYY-MM-DD') AS day, COALESCE(SUM(v.total), 0) AS total
       FROM generate_series((CURRENT_DATE - 13)::timestamp, CURRENT_DATE::timestamp, INTERVAL '1 day') AS gs(dia)
       LEFT JOIN ventas v ON v.fecha_venta::date = gs.dia::date
         AND v.id_estado = (SELECT id FROM estados_venta WHERE nombre_estado = 'completada')
         AND ($1::int IS NULL OR v.id_sucursal = $1)
       GROUP BY gs.dia ORDER BY gs.dia`,
      [suc]
    ),
    query(
      `SELECT p.nombre_generico AS name, SUM(dv.cantidad)::int AS quantity, SUM(dv.subtotal) AS revenue
       FROM detalle_venta dv
       JOIN ventas v ON v.id = dv.id_venta
       JOIN estados_venta ev ON ev.id = v.id_estado AND ev.nombre_estado = 'completada'
       JOIN lotes l ON l.id = dv.id_lote JOIN productos p ON p.id = l.id_producto
       WHERE ($1::int IS NULL OR v.id_sucursal = $1)
       GROUP BY p.id ORDER BY quantity DESC LIMIT 5`,
      [suc]
    ),
    query(
      `SELECT mp.nombre AS method, COUNT(*)::int AS count, COALESCE(SUM(pg.monto), 0) AS total
       FROM pagos pg
       JOIN metodos_pago mp ON mp.id = pg.id_metodo_pago
       JOIN estados_pago ep ON ep.id = pg.id_estado AND ep.nombre_estado = 'aprobado'
       JOIN ventas v ON v.id = pg.id_venta
       WHERE ($1::int IS NULL OR v.id_sucursal = $1)
       GROUP BY mp.id ORDER BY total DESC`,
      [suc]
    ),
  ]);

  res.json({
    resumen: resumen.rows[0],
    salesTimeseries: serie.rows,
    topProducts: top.rows,
    paymentMethods: metodos.rows,
  });
}));

export default router;
