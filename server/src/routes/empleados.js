import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';

const router = Router();

// RF-10: gestión de personal exclusiva del administrador.
router.use(requireRole(ROLES.ADMIN));

const BCRYPT_ROUNDS = 10;

function validarContrasena(contrasena) {
  if (typeof contrasena !== 'string' || contrasena.length < 8 || !/\d/.test(contrasena) || !/[A-Za-z]/.test(contrasena)) {
    throw badRequest('La contraseña debe tener al menos 8 caracteres, con letras y números.');
  }
}

router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const result = await query(
    `SELECT e.id, e.nombre, e.correo, e.activo, e.fecha_creacion,
            e.id_rol, r.nombre_rol AS rol, e.id_sucursal, s.nombre AS sucursal,
            e.id_tipo_contrato, tc.nombre_tipo AS tipo_contrato,
            COUNT(*) OVER () AS total_count
     FROM empleados e
     JOIN roles r ON r.id = e.id_rol
     JOIN sucursales s ON s.id = e.id_sucursal
     JOIN tipos_contrato tc ON tc.id = e.id_tipo_contrato
     ORDER BY e.activo DESC, e.nombre
     LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

function validarEmpleado(body) {
  const nombre = String(body.nombre || '').trim();
  const correo = String(body.correo || '').trim().toLowerCase();
  if (!nombre) throw badRequest('El nombre es obligatorio.');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(correo)) throw badRequest('Correo inválido.');
  const idRol = Number(body.id_rol);
  const idSucursal = Number(body.id_sucursal);
  const idTipoContrato = Number(body.id_tipo_contrato);
  if (!idRol || !idSucursal || !idTipoContrato) throw badRequest('Rol, sucursal y tipo de contrato son obligatorios.');
  return { nombre, correo, idRol, idSucursal, idTipoContrato };
}

// RNF-01: la contraseña se guarda solo como hash bcrypt con salt.
router.post('/', asyncHandler(async (req, res) => {
  const e = validarEmpleado(req.body);
  validarContrasena(req.body.contrasena);
  const hash = await bcrypt.hash(req.body.contrasena, BCRYPT_ROUNDS);
  const result = await query(
    `INSERT INTO empleados (nombre, correo, hash_contrasena, id_rol, id_sucursal, id_tipo_contrato)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, nombre, correo, id_rol, id_sucursal, id_tipo_contrato, activo`,
    [e.nombre, e.correo, hash, e.idRol, e.idSucursal, e.idTipoContrato]
  );
  res.status(201).json(result.rows[0]);
}));

router.put('/:id', asyncHandler(async (req, res) => {
  const e = validarEmpleado(req.body);
  const activo = req.body.activo === undefined ? true : Boolean(req.body.activo);
  if (Number(req.params.id) === req.user.id && !activo) throw badRequest('No puedes desactivar tu propio usuario.');
  const result = await query(
    `UPDATE empleados SET nombre = $1, correo = $2, id_rol = $3, id_sucursal = $4, id_tipo_contrato = $5, activo = $6
     WHERE id = $7
     RETURNING id, nombre, correo, id_rol, id_sucursal, id_tipo_contrato, activo`,
    [e.nombre, e.correo, e.idRol, e.idSucursal, e.idTipoContrato, activo, req.params.id]
  );
  if (result.rowCount === 0) throw notFound('Empleado no encontrado.');
  res.json(result.rows[0]);
}));

router.patch('/:id/contrasena', asyncHandler(async (req, res) => {
  validarContrasena(req.body.contrasena);
  const hash = await bcrypt.hash(req.body.contrasena, BCRYPT_ROUNDS);
  const result = await query('UPDATE empleados SET hash_contrasena = $1 WHERE id = $2', [hash, req.params.id]);
  if (result.rowCount === 0) throw notFound('Empleado no encontrado.');
  res.json({ ok: true });
}));

export default router;
