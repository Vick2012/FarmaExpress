import { Router } from 'express';
import { catalogId, query, withTransaction } from '../db.js';
import { asyncHandler, badRequest, forbidden, notFound } from '../errors.js';
import { isAdmin, requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';

const router = Router();

// Transiciones válidas del despacho (máquina de estados de RF-07).
const TRANSICIONES = {
  pendiente: ['en_ruta', 'cancelado'],
  en_ruta: ['entregado'],
  entregado: [],
  cancelado: [],
};

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const esRepartidor = req.user.rol === ROLES.REPARTIDOR;
  const result = await query(
    `SELECT d.id, d.id_venta, d.direccion, d.fecha_programada, d.fecha_entrega, d.fecha_creacion,
            ed.nombre_estado AS estado, d.id_empleado, e.nombre AS repartidor,
            v.total, pa.nombre_completo AS paciente, pa.telefono, s.nombre AS sucursal,
            COUNT(*) OVER () AS total_count
     FROM despachos d
     JOIN estados_despacho ed ON ed.id = d.id_estado
     JOIN ventas v ON v.id = d.id_venta
     JOIN sucursales s ON s.id = v.id_sucursal
     LEFT JOIN pacientes pa ON pa.id = v.id_paciente
     LEFT JOIN empleados e ON e.id = d.id_empleado
     WHERE ($1::int IS NULL OR d.id_empleado = $1)
       AND ($2::int IS NULL OR v.id_sucursal = $2)
     ORDER BY (ed.nombre_estado IN ('entregado', 'cancelado')), d.id DESC
     LIMIT $3 OFFSET $4`,
    [
      esRepartidor ? req.user.id : null,
      esRepartidor || isAdmin(req.user) ? null : req.user.id_sucursal,
      limit, offset,
    ]
  );
  res.json(pageResponse(result.rows, page));
}));

// Bloquea el despacho y su estado actual antes de modificarlo, para que
// dos usuarios no cambien el mismo despacho al mismo tiempo.
async function despachoBloqueado(client, id) {
  const result = await client.query(
    `SELECT d.*, ed.nombre_estado AS estado, v.id_sucursal
     FROM despachos d JOIN estados_despacho ed ON ed.id = d.id_estado JOIN ventas v ON v.id = d.id_venta
     WHERE d.id = $1 FOR UPDATE OF d`,
    [id]
  );
  if (result.rowCount === 0) throw notFound('Despacho no encontrado.');
  return result.rows[0];
}

// RF-07: el farmacéutico asigna repartidor y fecha programada.
router.patch('/:id/asignar', requireRole(ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const idRepartidor = Number(req.body.id_empleado);
  if (!idRepartidor) throw badRequest('Selecciona un repartidor.');

  const actualizado = await withTransaction(async (client) => {
    const despacho = await despachoBloqueado(client, req.params.id);
    if (despacho.id_sucursal !== req.user.id_sucursal) throw forbidden('El despacho pertenece a otra sucursal.');
    if (despacho.estado !== 'pendiente') throw badRequest('Solo se puede asignar repartidor a despachos pendientes.');

    const repartidor = await client.query(
      `SELECT e.id FROM empleados e JOIN roles r ON r.id = e.id_rol
       WHERE e.id = $1 AND e.activo AND r.nombre_rol = 'Repartidor'`,
      [idRepartidor]
    );
    if (repartidor.rowCount === 0) throw badRequest('El empleado seleccionado no es un repartidor activo.');

    const result = await client.query(
      `UPDATE despachos SET id_empleado = $1, fecha_programada = COALESCE($2, fecha_programada)
       WHERE id = $3 RETURNING *`,
      [idRepartidor, req.body.fecha_programada || null, despacho.id]
    );
    return result.rows[0];
  });
  res.json(actualizado);
}));

// RF-07: el repartidor actualiza el estado de SUS entregas; el
// farmacéutico puede cancelar un despacho pendiente de su sucursal.
router.patch('/:id/estado', requireRole(ROLES.REPARTIDOR, ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const nuevo = String(req.body.estado || '');

  const actualizado = await withTransaction(async (client) => {
    const despacho = await despachoBloqueado(client, req.params.id);

    if (req.user.rol === ROLES.REPARTIDOR) {
      if (despacho.id_empleado !== req.user.id) throw forbidden('Este despacho no está asignado a ti.');
      if (nuevo === 'cancelado') throw forbidden('El repartidor no puede cancelar despachos.');
    } else {
      if (despacho.id_sucursal !== req.user.id_sucursal) throw forbidden('El despacho pertenece a otra sucursal.');
      if (nuevo !== 'cancelado') throw forbidden('El estado de ruta y entrega lo actualiza el repartidor.');
    }

    if (!TRANSICIONES[despacho.estado]?.includes(nuevo)) {
      throw badRequest(`No se puede pasar de "${despacho.estado}" a "${nuevo}".`);
    }
    if (nuevo === 'en_ruta' && !despacho.id_empleado) throw badRequest('Asigna un repartidor antes de salir a ruta.');

    const result = await client.query(
      `UPDATE despachos SET id_estado = $1, fecha_entrega = CASE WHEN $2 = 'entregado' THEN NOW() ELSE fecha_entrega END
       WHERE id = $3 RETURNING *`,
      [await catalogId(client, 'estados_despacho', nuevo), nuevo, despacho.id]
    );
    return result.rows[0];
  });
  res.json(actualizado);
}));

export default router;
