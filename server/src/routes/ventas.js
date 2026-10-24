import { Router } from 'express';
import { catalogId, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../errors.js';
import { isAdmin, requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';
import {
  asignarLotesFEFO, normalizarItems, registrarMovimiento, restarStock, sumarStock, verificarSucursalActiva,
} from '../services/inventario.js';

const router = Router();

const RECETA_VALIDA = /^[A-Za-z0-9-]{4,80}$/;

router.get('/', requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  // El administrador supervisa toda la red; el farmacéutico ve su sucursal.
  const idSucursal = isAdmin(req.user) ? (req.query.sucursal ? Number(req.query.sucursal) : null) : req.user.id_sucursal;
  const result = await query(
    `SELECT v.id, v.fecha_venta, v.total, v.numero_receta, ev.nombre_estado AS estado,
            pa.nombre_completo AS paciente, s.nombre AS sucursal, e.nombre AS vendedor,
            mp.nombre AS metodo_pago, ep.nombre_estado AS estado_pago,
            ed.nombre_estado AS estado_despacho,
            (SELECT json_agg(json_build_object(
                      'producto', p.nombre_generico, 'numero_lote', l.numero_lote, 'cantidad', dv.cantidad,
                      'precio_unitario', dv.precio_unitario, 'subtotal', dv.subtotal) ORDER BY dv.id)
             FROM detalle_venta dv JOIN lotes l ON l.id = dv.id_lote JOIN productos p ON p.id = l.id_producto
             WHERE dv.id_venta = v.id) AS items,
            COUNT(*) OVER () AS total_count
     FROM ventas v
     JOIN estados_venta ev ON ev.id = v.id_estado
     JOIN sucursales s ON s.id = v.id_sucursal
     JOIN empleados e ON e.id = v.id_empleado
     LEFT JOIN pacientes pa ON pa.id = v.id_paciente
     LEFT JOIN pagos pg ON pg.id_venta = v.id
     LEFT JOIN metodos_pago mp ON mp.id = pg.id_metodo_pago
     LEFT JOIN estados_pago ep ON ep.id = pg.id_estado
     LEFT JOIN despachos d ON d.id_venta = v.id
     LEFT JOIN estados_despacho ed ON ed.id = d.id_estado
     WHERE ($1::int IS NULL OR v.id_sucursal = $1)
     ORDER BY v.id DESC
     LIMIT $2 OFFSET $3`,
    [idSucursal, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

/**
 * RF-06 — Registrar venta y pago.
 * Todo ocurre en UNA transacción atómica:
 *   1. bloquea los productos (precio estable) y valida fórmula médica
 *   2. asigna lotes con FEFO y bloquea su stock (FOR UPDATE)
 *   3. inserta venta + detalle con el precio de la base de datos
 *   4. descuenta stock y escribe cada salida en el ledger
 *   5. registra el pago (subproceso) y, si aplica, abre el despacho
 * Si cualquier paso falla → ROLLBACK: no queda venta, ni pago, ni
 * descuento de stock a medias.
 */
router.post('/', requireRole(ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const items = normalizarItems(req.body.items);
  const idPaciente = req.body.id_paciente ? Number(req.body.id_paciente) : null;
  const idMetodoPago = Number(req.body.id_metodo_pago);
  const numeroReceta = String(req.body.numero_receta || '').trim().toUpperCase();
  const direccionDespacho = String(req.body.despacho?.direccion || '').trim();
  const fechaProgramada = req.body.despacho?.fecha_programada || null;
  const simularRechazo = Boolean(req.body.simular_pago_rechazado) && process.env.NODE_ENV !== 'production';
  const idSucursal = req.user.id_sucursal;

  if (!idMetodoPago) throw badRequest('Selecciona el método de pago.');

  const venta = await withTransaction(async (client) => {
    await verificarSucursalActiva(client, idSucursal);

    // 1) Productos bloqueados en modo compartido: nadie puede cambiar su
    //    precio mientras esta venta está en curso.
    const productos = await client.query(
      `SELECT id, nombre_generico, precio, activo, requiere_receta, control_especial
       FROM productos WHERE id = ANY($1::int[]) ORDER BY id FOR SHARE`,
      [items.map((i) => i.idProducto)]
    );
    const porId = new Map(productos.rows.map((p) => [p.id, p]));

    let exigeReceta = false;
    let tieneControlEspecial = false;
    for (const item of items) {
      const producto = porId.get(item.idProducto);
      if (!producto) throw notFound(`El producto ${item.idProducto} no existe.`);
      if (!producto.activo) throw badRequest(`${producto.nombre_generico} está inactivo y no se puede vender.`);
      exigeReceta ||= producto.requiere_receta || producto.control_especial;
      tieneControlEspecial ||= producto.control_especial;
    }

    // Validación obligatoria de fórmula médica (Res. 1478/2006, Ley 30/1986).
    if (exigeReceta && !RECETA_VALIDA.test(numeroReceta)) {
      throw badRequest('Uno o más productos requieren fórmula médica: ingresa un número de receta válido (4 a 80 letras, números o guiones).');
    }
    if (tieneControlEspecial && !idPaciente) {
      throw badRequest('Los medicamentos de control especial solo se dispensan a un paciente identificado.');
    }

    // 2) Asignación FEFO de lotes con bloqueo de filas.
    const lineas = [];
    for (const item of items) {
      const producto = porId.get(item.idProducto);
      const asignaciones = await asignarLotesFEFO(client, {
        idProducto: item.idProducto, idSucursal, cantidad: item.cantidad, nombreProducto: producto.nombre_generico,
      });
      for (const a of asignaciones) {
        lineas.push({ ...a, precioUnitario: producto.precio, subtotal: producto.precio * a.cantidad, producto: producto.nombre_generico });
      }
    }
    const total = lineas.reduce((sum, l) => sum + l.subtotal, 0);

    // 3) Cabecera y detalle.
    const idCompletada = await catalogId(client, 'estados_venta', 'completada');
    const cabecera = await client.query(
      `INSERT INTO ventas (id_paciente, id_sucursal, id_empleado, id_estado, total, numero_receta)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [idPaciente, idSucursal, req.user.id, idCompletada, total, exigeReceta ? numeroReceta : null]
    );
    const idVenta = cabecera.rows[0].id;

    for (const linea of lineas) {
      await client.query(
        `INSERT INTO detalle_venta (id_venta, id_lote, cantidad, precio_unitario, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [idVenta, linea.idLote, linea.cantidad, linea.precioUnitario, linea.subtotal]
      );
      // 4) Descuento de stock + ledger.
      await restarStock(client, { idLote: linea.idLote, idSucursal, cantidad: linea.cantidad });
      await registrarMovimiento(client, {
        idLote: linea.idLote, idSucursal, tipo: 'venta', cantidad: -linea.cantidad,
        tipoReferencia: 'venta', idReferencia: idVenta, creadoPor: req.user.id,
      });
    }

    // 5) Subproceso de pago.
    const idAprobado = await catalogId(client, 'estados_pago', 'aprobado');
    await client.query(
      `INSERT INTO pagos (id_venta, id_metodo_pago, monto, id_estado, fecha_pago)
       VALUES ($1, $2, $3, $4, NOW())`,
      [idVenta, idMetodoPago, total, idAprobado]
    );

    // Modo demostración: un pago rechazado por la pasarela revierte TODO lo
    // anterior (venta, detalle, stock y ledger) gracias al ROLLBACK.
    if (simularRechazo) {
      throw badRequest('Pago rechazado por la entidad financiera (simulación). La transacción se revirtió por completo: no se descontó inventario.');
    }

    if (direccionDespacho) {
      const idPendiente = await catalogId(client, 'estados_despacho', 'pendiente');
      await client.query(
        `INSERT INTO despachos (id_venta, id_estado, direccion, fecha_programada) VALUES ($1, $2, $3, $4)`,
        [idVenta, idPendiente, direccionDespacho, fechaProgramada]
      );
    }

    return { ...cabecera.rows[0], items: lineas };
  });

  res.status(201).json(venta);
}));

/**
 * Anulación de venta (RNF-12): también atómica. Devuelve cada unidad al
 * mismo lote del que salió, deja el reverso en el ledger, reembolsa el
 * pago y cancela el despacho pendiente.
 */
router.post('/:id/anular', requireRole(ROLES.FARMACEUTICO, ROLES.ADMIN), asyncHandler(async (req, res) => {
  const idVenta = Number(req.params.id);
  const motivo = String(req.body.motivo || '').trim();
  if (motivo.length < 5) throw badRequest('Indica el motivo de la anulación (mínimo 5 caracteres).');

  const resultado = await withTransaction(async (client) => {
    const ventaResult = await client.query(
      `SELECT v.*, ev.nombre_estado AS estado FROM ventas v JOIN estados_venta ev ON ev.id = v.id_estado
       WHERE v.id = $1 FOR UPDATE OF v`,
      [idVenta]
    );
    const venta = ventaResult.rows[0];
    if (!venta) throw notFound('Venta no encontrada.');
    if (venta.estado !== 'completada') throw badRequest('Solo se pueden anular ventas completadas.');
    if (!isAdmin(req.user) && venta.id_sucursal !== req.user.id_sucursal) {
      throw forbidden('Solo puedes anular ventas de tu sucursal.');
    }

    const despacho = await client.query(
      `SELECT d.id, ed.nombre_estado AS estado FROM despachos d JOIN estados_despacho ed ON ed.id = d.id_estado
       WHERE d.id_venta = $1 FOR UPDATE OF d`,
      [idVenta]
    );
    if (despacho.rows[0] && ['en_ruta', 'entregado'].includes(despacho.rows[0].estado)) {
      throw badRequest(`No se puede anular: el despacho está ${despacho.rows[0].estado.replace('_', ' ')}.`);
    }

    const detalle = await client.query('SELECT id_lote, cantidad FROM detalle_venta WHERE id_venta = $1 ORDER BY id_lote', [idVenta]);
    for (const linea of detalle.rows) {
      await sumarStock(client, { idLote: linea.id_lote, idSucursal: venta.id_sucursal, cantidad: linea.cantidad });
      await registrarMovimiento(client, {
        idLote: linea.id_lote, idSucursal: venta.id_sucursal, tipo: 'anulacion_venta', cantidad: linea.cantidad,
        tipoReferencia: 'venta', idReferencia: idVenta, nota: motivo, creadoPor: req.user.id,
      });
    }

    await client.query('UPDATE ventas SET id_estado = $1 WHERE id = $2', [await catalogId(client, 'estados_venta', 'anulada'), idVenta]);
    await client.query('UPDATE pagos SET id_estado = $1 WHERE id_venta = $2', [await catalogId(client, 'estados_pago', 'reembolsado'), idVenta]);
    if (despacho.rows[0]) {
      await client.query('UPDATE despachos SET id_estado = $1 WHERE id = $2', [await catalogId(client, 'estados_despacho', 'cancelado'), despacho.rows[0].id]);
    }
    return { id: idVenta, estado: 'anulada', unidades_devueltas: detalle.rows.reduce((s, l) => s + l.cantidad, 0) };
  });

  res.json(resultado);
}));

export default router;
