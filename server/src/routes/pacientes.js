import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';

const router = Router();

// RNF-19: los datos personales y de salud solo los ven administrador y
// farmacéutico; el repartidor no tiene acceso a este módulo.
router.use(requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO));

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const q = `%${String(req.query.q || '').trim()}%`;
  const result = await query(
    `SELECT p.id, p.nombre_completo, p.correo, p.telefono, p.documento_numero, p.direccion,
            p.id_acudiente, a.nombre_completo AS acudiente, p.id_aseguradora, ase.nombre AS aseguradora,
            COUNT(*) OVER () AS total_count
     FROM pacientes p
     LEFT JOIN pacientes a ON a.id = p.id_acudiente
     LEFT JOIN aseguradoras ase ON ase.id = p.id_aseguradora
     WHERE p.nombre_completo ILIKE $1 OR p.documento_numero ILIKE $1
     ORDER BY p.nombre_completo
     LIMIT $2 OFFSET $3`,
    [q, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

// Lista compacta para selectores (venta, acudiente).
router.get('/opciones', asyncHandler(async (req, res) => {
  const result = await query('SELECT id, nombre_completo, documento_numero, direccion FROM pacientes ORDER BY nombre_completo');
  res.json(result.rows);
}));

function validarPaciente(body) {
  const nombre = String(body.nombre_completo || '').trim();
  const documento = String(body.documento_numero || '').trim();
  if (!nombre) throw badRequest('El nombre completo es obligatorio.');
  if (!documento) throw badRequest('El número de documento es obligatorio.');
  return [
    nombre,
    String(body.correo || '').trim() || null,
    String(body.telefono || '').trim() || null,
    documento,
    String(body.direccion || '').trim() || null,
    body.id_acudiente ? Number(body.id_acudiente) : null,
    body.id_aseguradora ? Number(body.id_aseguradora) : null,
  ];
}

// RF-08: el acudiente debe existir (lo garantiza la FK) y el documento es único.
router.post('/', asyncHandler(async (req, res) => {
  const result = await query(
    `INSERT INTO pacientes (nombre_completo, correo, telefono, documento_numero, direccion, id_acudiente, id_aseguradora)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    validarPaciente(req.body)
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const valores = validarPaciente(req.body);
  if (valores[5] === Number(req.params.id)) throw badRequest('Un paciente no puede ser su propio acudiente.');
  const result = await query(
    `UPDATE pacientes SET nombre_completo = $1, correo = $2, telefono = $3, documento_numero = $4,
       direccion = $5, id_acudiente = $6, id_aseguradora = $7
     WHERE id = $8 RETURNING *`,
    [...valores, req.params.id]
  );
  if (result.rowCount === 0) throw notFound('Paciente no encontrado.');
  res.json(result.rows[0]);
}));

// RF-09: historial de medicamentos — exclusivo del farmacéutico.
router.get('/:id/historial', requireRole(ROLES.FARMACEUTICO), asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT v.id AS id_venta, v.fecha_venta, ev.nombre_estado AS estado, v.numero_receta,
            p.nombre_generico, p.presentacion, l.numero_lote, dv.cantidad, dv.subtotal, s.nombre AS sucursal
     FROM ventas v
     JOIN estados_venta ev ON ev.id = v.id_estado
     JOIN detalle_venta dv ON dv.id_venta = v.id
     JOIN lotes l ON l.id = dv.id_lote
     JOIN productos p ON p.id = l.id_producto
     JOIN sucursales s ON s.id = v.id_sucursal
     WHERE v.id_paciente = $1
     ORDER BY v.fecha_venta DESC, dv.id
     LIMIT 100`,
    [req.params.id]
  );
  res.json(result.rows);
}));

export default router;
