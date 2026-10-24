import { Router } from 'express';
import { query } from '../db.js';
import { asyncHandler, badRequest, notFound } from '../errors.js';
import { requireRole, ROLES } from '../middleware/auth.js';
import { pageParams, pageResponse } from '../pagination.js';

const router = Router();
const puedeEditar = requireRole(ROLES.ADMIN, ROLES.FARMACEUTICO);

const SELECT_PRODUCTO = `
  SELECT p.id, p.nombre_generico, p.presentacion, p.sku, p.precio, p.costo, p.activo,
         p.requiere_receta, p.control_especial, p.id_categoria, p.id_marca,
         c.nombre AS categoria, m.nombre AS marca,
         COALESCE((SELECT SUM(sl.stock) FROM stock_lote sl JOIN lotes l ON l.id = sl.id_lote
                   WHERE l.id_producto = p.id), 0)::int AS stock_total
  FROM productos p
  LEFT JOIN categorias c ON c.id = p.id_categoria
  LEFT JOIN marcas m ON m.id = p.id_marca`;

// RF-01 / RF-02: listado paginado con búsqueda por nombre o SKU.
router.get('/', asyncHandler(async (req, res) => {
  const { page, limit, offset } = pageParams(req);
  const q = `%${String(req.query.q || '').trim()}%`;
  const result = await query(
    `SELECT *, COUNT(*) OVER () AS total_count FROM (${SELECT_PRODUCTO}) t
     WHERE t.nombre_generico ILIKE $1 OR t.sku ILIKE $1
     ORDER BY t.nombre_generico
     LIMIT $2 OFFSET $3`,
    [q, limit, offset]
  );
  res.json(pageResponse(result.rows, page));
}));

// Lista compacta de productos activos para los selectores de venta,
// compra y traslado, con el stock vendible (no vencido) de una sucursal.
router.get('/opciones', asyncHandler(async (req, res) => {
  const idSucursal = Number(req.query.sucursal || req.user.id_sucursal);
  const result = await query(
    `SELECT p.id, p.nombre_generico, p.presentacion, p.sku, p.precio, p.costo,
            p.requiere_receta, p.control_especial,
            COALESCE(SUM(sl.stock) FILTER (WHERE l.fecha_vencimiento > CURRENT_DATE), 0)::int AS stock_disponible
     FROM productos p
     LEFT JOIN lotes l ON l.id_producto = p.id
     LEFT JOIN stock_lote sl ON sl.id_lote = l.id AND sl.id_sucursal = $1
     WHERE p.activo
     GROUP BY p.id
     ORDER BY p.nombre_generico`,
    [idSucursal]
  );
  res.json(result.rows);
}));

function validarProducto(body) {
  const nombre = String(body.nombre_generico || '').trim();
  const sku = String(body.sku || '').trim().toUpperCase();
  const precio = Number(body.precio);
  const costo = Number(body.costo);
  if (!nombre || !sku) throw badRequest('Nombre genérico y SKU son obligatorios.');
  if (!(precio >= 0) || !(costo >= 0)) throw badRequest('Precio y costo deben ser números mayores o iguales a cero.');
  const controlEspecial = Boolean(body.control_especial);
  return {
    nombre,
    sku,
    presentacion: String(body.presentacion || '').trim() || null,
    idCategoria: body.id_categoria ? Number(body.id_categoria) : null,
    idMarca: body.id_marca ? Number(body.id_marca) : null,
    precio,
    costo,
    // Todo medicamento de control especial exige fórmula médica.
    requiereReceta: Boolean(body.requiere_receta) || controlEspecial,
    controlEspecial,
  };
}

// RF-01: el medicamento nace sin stock. El inventario solo entra por
// compras (con lote y vencimiento), traslados o ajustes auditados.
router.post('/', puedeEditar, asyncHandler(async (req, res) => {
  const p = validarProducto(req.body);
  const result = await query(
    `INSERT INTO productos (nombre_generico, presentacion, sku, id_categoria, id_marca, precio, costo, requiere_receta, control_especial)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [p.nombre, p.presentacion, p.sku, p.idCategoria, p.idMarca, p.precio, p.costo, p.requiereReceta, p.controlEspecial]
  );
  const creado = await query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [result.rows[0].id]);
  res.status(201).json(creado.rows[0]);
}));

// RF-01: actualizar no afecta transacciones pasadas, porque cada detalle
// de venta guarda su propio precio_unitario.
router.put('/:id', puedeEditar, asyncHandler(async (req, res) => {
  const p = validarProducto(req.body);
  const activo = req.body.activo === undefined ? true : Boolean(req.body.activo);
  const result = await query(
    `UPDATE productos SET nombre_generico = $1, presentacion = $2, sku = $3, id_categoria = $4, id_marca = $5,
       precio = $6, costo = $7, requiere_receta = $8, control_especial = $9, activo = $10
     WHERE id = $11`,
    [p.nombre, p.presentacion, p.sku, p.idCategoria, p.idMarca, p.precio, p.costo, p.requiereReceta, p.controlEspecial, activo, req.params.id]
  );
  if (result.rowCount === 0) throw notFound('Medicamento no encontrado.');
  const actualizado = await query(`${SELECT_PRODUCTO} WHERE p.id = $1`, [req.params.id]);
  res.json(actualizado.rows[0]);
}));

export default router;
