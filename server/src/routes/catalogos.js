import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler } from '../errors.js';

const router = Router();

// Catálogos de solo lectura que la interfaz usa para llenar selectores.
router.get('/', asyncHandler(async (req, res) => {
  const [sucursales, categorias, marcas, aseguradoras, roles, tiposContrato, metodosPago, repartidores] = await Promise.all([
    query('SELECT id, nombre, direccion, es_principal, activa FROM sucursales ORDER BY es_principal DESC, nombre'),
    query('SELECT id, nombre FROM categorias ORDER BY nombre'),
    query('SELECT id, nombre FROM marcas ORDER BY nombre'),
    query('SELECT id, nombre FROM aseguradoras ORDER BY nombre'),
    query('SELECT id, nombre_rol AS nombre FROM roles ORDER BY id'),
    query('SELECT id, nombre_tipo AS nombre FROM tipos_contrato ORDER BY id'),
    query('SELECT id, nombre FROM metodos_pago ORDER BY id'),
    query(`SELECT e.id, e.nombre, e.id_sucursal FROM empleados e JOIN roles r ON r.id = e.id_rol
           WHERE r.nombre_rol = 'Repartidor' AND e.activo ORDER BY e.nombre`),
  ]);

  res.json({
    sucursales: sucursales.rows,
    categorias: categorias.rows,
    marcas: marcas.rows,
    aseguradoras: aseguradoras.rows,
    roles: roles.rows,
    tiposContrato: tiposContrato.rows,
    metodosPago: metodosPago.rows,
    repartidores: repartidores.rows,
  });
}));

export default router;
