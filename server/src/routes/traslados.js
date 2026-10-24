import { Router } from 'express';
import { catalogId, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../errors.js';
import { isAdmin, requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';
import {
  asignarLotesFEFO, normalizarItems, registrarMovimiento, restarStock, sumarStock, verificarSucursalActiva,
} from '../services/inventario.js';

const router = Router();
router.use(requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const idSucursal = isAdmin(req.user) ? null : req.user.id_sucursal;
  const result = await query(
    `SELECT t.id, t.fecha_traslado, t.fecha_recepcion, et.nombre_estado AS estado,
            t.id_sucursal_origen, so.nombre AS origen, t.id_sucursal_destino, sd.nombre AS destino,
            es.nombre AS solicitado_por, er.nombre AS recibido_por,
            (SELECT json_agg(json_build_object('producto', p.nombre_generico, 'numero_lote', l.numero_lote,
                                               'fecha_vencimiento', l.fecha_vencimiento, 'cantidad', dt.cantidad) ORDER BY dt.id)
             FROM detalle_traslado dt JOIN lotes l ON l.id = dt.id_lote JOIN productos p ON p.id = l.id_producto
             WHERE dt.id_traslado = t.id) AS items,
            COUNT(*) OVER () AS total_count
     FROM traslados_inventario t
     JOIN estados_traslado et ON et.id = t.id_estado
     JOIN sucursales so ON so.id = t.id_sucursal_origen
     JOIN sucursales sd ON sd.id = t.id_sucursal_destino
     JOIN empleados es ON es.id = t.id_empleado
     LEFT JOIN empleados er ON er.id = t.id_empleado_recibe
     WHERE ($1::int IS NULL OR t.id_sucursal_origen = $1 OR t.id_sucursal_destino = $1)
     ORDER BY (et.nombre_estado <> 'pendiente'), t.id DESC
     LIMIT $2 OFFSET $3`,
    [idSucursal, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

/**
 * RF-04 (1/2) — Crear traslado. En una transacción: valida sucursales,
 * toma lotes FEFO en el origen, descuenta el stock de origen y deja la
 * salida en el ledger. El traslado queda "pendiente" (mercancía en tránsito):
 * el destino todavía NO suma stock, así el inventario nunca se duplica.
 */
router.post('/', asyncHandler(async (req, res) => {
  const items = normalizarItems(req.body.items);
  const idOrigen = isAdmin(req.user) ? Number(req.body.id_sucursal_origen) : req.user.id_sucursal;
  const idDestino = Number(req.body.id_sucursal_destino);
  if (!idOrigen || !idDestino) throw badRequest('Selecciona sucursal de origen y destino.');
  if (idOrigen === idDestino) throw badRequest('El origen y el destino deben ser sucursales distintas.');

  const traslado = await withTransaction(async (client) => {
    await verificarSucursalActiva(client, idOrigen);
    await verificarSucursalActiva(client, idDestino);

    const cabecera = await client.query(
      `INSERT INTO traslados_inventario (id_sucursal_origen, id_sucursal_destino, id_empleado, id_estado)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [idOrigen, idDestino, req.user.id, await catalogId(client, 'estados_traslado', 'pendiente')]
    );
    const idTraslado = cabecera.rows[0].id;

    for (const item of items) {
      const asignaciones = await asignarLotesFEFO(client, { idProducto: item.idProducto, idSucursal: idOrigen, cantidad: item.cantidad });
      for (const a of asignaciones) {
        await client.query(
          'INSERT INTO detalle_traslado (id_traslado, id_lote, cantidad) VALUES ($1, $2, $3)',
          [idTraslado, a.idLote, a.cantidad]
        );
        await restarStock(client, { idLote: a.idLote, idSucursal: idOrigen, cantidad: a.cantidad });
        await registrarMovimiento(client, {
          idLote: a.idLote, idSucursal: idOrigen, tipo: 'traslado_salida', cantidad: -a.cantidad,
          tipoReferencia: 'traslado', idReferencia: idTraslado, creadoPor: req.user.id,
        });
      }
    }
    return cabecera.rows[0];
  });

  res.status(201).json(traslado);
}));

async function trasladoPendienteBloqueado(client, id) {
  const result = await client.query(
    `SELECT t.*, et.nombre_estado AS estado FROM traslados_inventario t
     JOIN estados_traslado et ON et.id = t.id_estado
     WHERE t.id = $1 FOR UPDATE OF t`,
    [id]
  );
  const traslado = result.rows[0];
  if (!traslado) throw notFound('Traslado no encontrado.');
  if (traslado.estado !== 'pendiente') throw badRequest(`El traslado ya está ${traslado.estado}.`);
  return traslado;
}

/**
 * RF-04 (2/2) — Confirmar recepción. Solo el destino (o el administrador)
 * confirma; el stock entra al destino con los mismos lotes que salieron.
 */
router.post('/:id/confirmar', asyncHandler(async (req, res) => {
  const resultado = await withTransaction(async (client) => {
    const traslado = await trasladoPendienteBloqueado(client, req.params.id);
    if (!isAdmin(req.user) && traslado.id_sucursal_destino !== req.user.id_sucursal) {
      throw forbidden('Solo la sucursal de destino puede confirmar la recepción.');
    }
    await verificarSucursalActiva(client, traslado.id_sucursal_destino);

    const detalle = await client.query('SELECT id_lote, cantidad FROM detalle_traslado WHERE id_traslado = $1 ORDER BY id_lote', [traslado.id]);
    for (const linea of detalle.rows) {
      await sumarStock(client, { idLote: linea.id_lote, idSucursal: traslado.id_sucursal_destino, cantidad: linea.cantidad });
      await registrarMovimiento(client, {
        idLote: linea.id_lote, idSucursal: traslado.id_sucursal_destino, tipo: 'traslado_entrada', cantidad: linea.cantidad,
        tipoReferencia: 'traslado', idReferencia: traslado.id, creadoPor: req.user.id,
      });
    }

    const result = await client.query(
      `UPDATE traslados_inventario SET id_estado = $1, id_empleado_recibe = $2, fecha_recepcion = NOW()
       WHERE id = $3 RETURNING *`,
      [await catalogId(client, 'estados_traslado', 'completado'), req.user.id, traslado.id]
    );
    return result.rows[0];
  });
  res.json(resultado);
}));

// Cancelar un traslado pendiente devuelve la mercancía al origen.
router.post('/:id/cancelar', asyncHandler(async (req, res) => {
  const resultado = await withTransaction(async (client) => {
    const traslado = await trasladoPendienteBloqueado(client, req.params.id);
    if (!isAdmin(req.user) && traslado.id_sucursal_origen !== req.user.id_sucursal) {
      throw forbidden('Solo la sucursal de origen puede cancelar el traslado.');
    }

    const detalle = await client.query('SELECT id_lote, cantidad FROM detalle_traslado WHERE id_traslado = $1 ORDER BY id_lote', [traslado.id]);
    for (const linea of detalle.rows) {
      await sumarStock(client, { idLote: linea.id_lote, idSucursal: traslado.id_sucursal_origen, cantidad: linea.cantidad });
      await registrarMovimiento(client, {
        idLote: linea.id_lote, idSucursal: traslado.id_sucursal_origen, tipo: 'traslado_reverso', cantidad: linea.cantidad,
        tipoReferencia: 'traslado', idReferencia: traslado.id, nota: 'Traslado cancelado', creadoPor: req.user.id,
      });
    }

    const result = await client.query(
      'UPDATE traslados_inventario SET id_estado = $1 WHERE id = $2 RETURNING *',
      [await catalogId(client, 'estados_traslado', 'cancelado'), traslado.id]
    );
    return result.rows[0];
  });
  res.json(resultado);
}));

export default router;
