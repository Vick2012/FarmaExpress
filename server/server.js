import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { query, default as pool } from './db.js';

dotenv.config();

const app = express();
const PORT = process.env.PORT || 5001;

const fallbackDashboard = {
  salesTotal: 0,
  products: 0,
  customers: 0,
  lowStock: 0,
};

const fallbackList = [];

const EMPLOYEE_ROLES = ['Administrador', 'Farmacéutico', 'Repartidor'];
const DELIVERY_STATUSES = ['pendiente', 'en_ruta', 'entregado', 'cancelado'];

app.use(cors());
app.use(express.json());

// Sucursal por defecto: hoy la UI no ofrece selector de sucursal, así que
// todas las operaciones (venta, compra, alta de producto) usan la sede
// marcada como is_main. El esquema ya soporta más sucursales si se agrega
// el selector más adelante.
const getMainBranchId = async (executor) => {
  const result = await executor('SELECT id FROM branches WHERE is_main = TRUE ORDER BY id LIMIT 1');
  return result.rows[0]?.id ?? null;
};

app.get('/api/health', async (req, res) => {
  try {
    const result = await query('SELECT NOW() as now');
    res.json({ ok: true, server: 'FarmaExpress API', time: result.rows[0].now });
  } catch (error) {
    res.status(200).json({ ok: false, server: 'FarmaExpress API', message: 'PostgreSQL no está listo aún', error: error.message });
  }
});

app.get('/api/dashboard', async (req, res) => {
  try {
    const [ventas, productos, clientes, inventario] = await Promise.all([
      query("SELECT COALESCE(SUM(total),0) AS total FROM sales"),
      query("SELECT COUNT(*) AS total FROM products"),
      query("SELECT COUNT(*) AS total FROM customers"),
      query(`
        SELECT COUNT(*) AS total FROM (
          SELECT p.id
          FROM products p
          LEFT JOIN product_stock ps ON ps.product_id = p.id
          GROUP BY p.id
          HAVING COALESCE(SUM(ps.stock), 0) <= 10
        ) low_stock
      `),
    ]);

    res.json({
      salesTotal: Number(ventas.rows[0].total || 0),
      products: Number(productos.rows[0].total || 0),
      customers: Number(clientes.rows[0].total || 0),
      lowStock: Number(inventario.rows[0].total || 0),
    });
  } catch (error) {
    res.status(200).json(fallbackDashboard);
  }
});

app.get('/api/categories', async (req, res) => {
  try {
    const result = await query('SELECT * FROM categories ORDER BY name ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.get('/api/branches', async (req, res) => {
  try {
    const result = await query('SELECT * FROM branches ORDER BY is_main DESC, name ASC');
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.get('/api/dashboard/charts', async (req, res) => {
  try {
    const [salesTimeseries, topProducts, paymentMethods] = await Promise.all([
      query(`
        SELECT to_char(gs.day, 'YYYY-MM-DD') AS day, COALESCE(SUM(s.total), 0) AS total
        FROM generate_series(CURRENT_DATE - INTERVAL '13 days', CURRENT_DATE, INTERVAL '1 day') AS gs(day)
        LEFT JOIN sales s ON date_trunc('day', s.sale_date) = gs.day
        GROUP BY gs.day
        ORDER BY gs.day
      `),
      query(`
        SELECT p.name, COALESCE(SUM(si.quantity), 0) AS quantity, COALESCE(SUM(si.subtotal), 0) AS revenue
        FROM sale_items si
        JOIN products p ON p.id = si.product_id
        GROUP BY p.id, p.name
        ORDER BY quantity DESC
        LIMIT 5
      `),
      query(`
        SELECT COALESCE(NULLIF(TRIM(payment_method), ''), 'Otro') AS method, COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
        FROM sales
        GROUP BY 1
        ORDER BY total DESC
      `),
    ]);

    res.json({
      salesTimeseries: salesTimeseries.rows.map((row) => ({ day: row.day, total: Number(row.total) })),
      topProducts: topProducts.rows.map((row) => ({ name: row.name, quantity: Number(row.quantity), revenue: Number(row.revenue) })),
      paymentMethods: paymentMethods.rows.map((row) => ({ method: row.method, count: Number(row.count), total: Number(row.total) })),
    });
  } catch (error) {
    res.status(200).json({ salesTimeseries: [], topProducts: [], paymentMethods: [] });
  }
});

// ---------------------------------------------------------------
// Productos (medicamentos) — el stock ahora vive en product_stock,
// una fila por sucursal. La API sigue exponiendo `stock` como el
// total sumado entre sucursales para no romper el frontend existente.
// ---------------------------------------------------------------

app.get('/api/products', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, COALESCE(SUM(ps.stock), 0) AS stock
      FROM products p
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      GROUP BY p.id
      ORDER BY p.id DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/products', async (req, res) => {
  const {
    name, sku, category_id = 1, price = 0, cost = 0, stock = 0, brand = '',
    requires_prescription = false, controlled_substance = false,
  } = req.body;

  if (!name || !sku) {
    return res.status(400).json({ message: 'Nombre y SKU son obligatorios.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const productResult = await client.query(
      `INSERT INTO products (name, sku, category_id, price, cost, brand, requires_prescription, controlled_substance)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [name, sku, category_id, Number(price), Number(cost), brand, Boolean(requires_prescription), Boolean(controlled_substance)]
    );
    const product = productResult.rows[0];

    const branchId = await getMainBranchId(client.query.bind(client));
    const initialStock = Number(stock) || 0;

    if (branchId) {
      await client.query(
        `INSERT INTO product_stock (product_id, branch_id, stock) VALUES ($1, $2, $3)`,
        [product.id, branchId, initialStock]
      );

      if (initialStock > 0) {
        await client.query(
          `INSERT INTO inventory_transactions (product_id, branch_id, change_type, quantity, reference_type, note)
           VALUES ($1, $2, 'ajuste', $3, 'manual', 'Stock inicial al registrar el producto')`,
          [product.id, branchId, initialStock]
        );
      }
    }

    await client.query('COMMIT');
    return res.status(201).json({ ...product, stock: initialStock });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'No se pudo guardar el producto', error: error.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// Pacientes (clientes) — pueden depender de otro paciente registrado
// (familiar dependiente) vía guardian_id.
// ---------------------------------------------------------------

app.get('/api/customers', async (req, res) => {
  try {
    const result = await query(`
      SELECT c.*, g.full_name AS guardian_name
      FROM customers c
      LEFT JOIN customers g ON g.id = c.guardian_id
      ORDER BY c.id DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/customers', async (req, res) => {
  const { full_name, email, phone, document_number, address, guardian_id } = req.body;

  if (!full_name) {
    return res.status(400).json({ message: 'El nombre completo es obligatorio.' });
  }

  try {
    const result = await query(
      `INSERT INTO customers (full_name, email, phone, document_number, address, guardian_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING *`,
      [full_name, email || '', phone || '', document_number || '', address || '', guardian_id || null]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo guardar el cliente', error: error.message });
  }
});

// Historial de medicamentos de un paciente — requisito "Paciente: historial medicamentos".
app.get('/api/customers/:id/history', async (req, res) => {
  try {
    const result = await query(
      `SELECT s.id AS sale_id, s.sale_date, p.name AS product_name, si.quantity, si.subtotal
       FROM sales s
       JOIN sale_items si ON si.sale_id = s.id
       JOIN products p ON p.id = si.product_id
       WHERE s.customer_id = $1
       ORDER BY s.sale_date DESC
       LIMIT 50`,
      [req.params.id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

// ---------------------------------------------------------------
// Empleados — roles fijos: Administrador, Farmacéutico, Repartidor.
// ---------------------------------------------------------------

app.get('/api/employees', async (req, res) => {
  try {
    const result = await query('SELECT id, name, email, role, is_active, created_at FROM users ORDER BY id DESC LIMIT 50');
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/employees', async (req, res) => {
  const { name, email, role } = req.body;

  if (!name || !email) {
    return res.status(400).json({ message: 'Nombre y correo son obligatorios.' });
  }

  if (!EMPLOYEE_ROLES.includes(role)) {
    return res.status(400).json({ message: `El rol debe ser uno de: ${EMPLOYEE_ROLES.join(', ')}.` });
  }

  try {
    const result = await query(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES ($1, $2, 'change-me', $3)
       RETURNING id, name, email, role, is_active, created_at`,
      [name, email, role]
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      return res.status(409).json({ message: 'Ya existe un empleado con ese correo.' });
    }
    return res.status(500).json({ message: 'No se pudo registrar el empleado', error: error.message });
  }
});

// Actualizar datos o activar/desactivar un empleado.
app.patch('/api/employees/:id', async (req, res) => {
  const { name, role, is_active } = req.body;

  if (role !== undefined && !EMPLOYEE_ROLES.includes(role)) {
    return res.status(400).json({ message: `El rol debe ser uno de: ${EMPLOYEE_ROLES.join(', ')}.` });
  }

  try {
    const result = await query(
      `UPDATE users SET
         name = COALESCE($1, name),
         role = COALESCE($2, role),
         is_active = COALESCE($3, is_active)
       WHERE id = $4
       RETURNING id, name, email, role, is_active, created_at`,
      [name ?? null, role ?? null, typeof is_active === 'boolean' ? is_active : null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Empleado no encontrado.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo actualizar el empleado', error: error.message });
  }
});

// ---------------------------------------------------------------
// Ventas — dentro de una sola transacción: valida fórmula/receta,
// descuenta stock por sucursal, deja el movimiento en el ledger de
// inventario y registra el pago como su propia entidad.
// ---------------------------------------------------------------

app.get('/api/sales', async (req, res) => {
  try {
    const result = await query(`
      SELECT s.*,
        pay.status AS payment_status,
        d.status AS delivery_status,
        COALESCE(
          json_agg(
            json_build_object(
              'product_name', p.name,
              'quantity', si.quantity,
              'unit_price', si.unit_price,
              'subtotal', si.subtotal
            )
          ) FILTER (WHERE si.id IS NOT NULL), '[]'
        ) AS items
      FROM sales s
      LEFT JOIN sale_items si ON si.sale_id = s.id
      LEFT JOIN products p ON p.id = si.product_id
      LEFT JOIN payments pay ON pay.sale_id = s.id
      LEFT JOIN deliveries d ON d.sale_id = s.id
      GROUP BY s.id, pay.status, d.status
      ORDER BY s.id DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/sales', async (req, res) => {
  const {
    customer_id, payment_method = 'Efectivo', items = [], total = 0,
    prescription_number = '', delivery_address = '',
  } = req.body;

  if (!items.length) {
    return res.status(400).json({ message: 'Debes enviar al menos un producto en la venta.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const branchId = await getMainBranchId(client.query.bind(client));
    if (!branchId) {
      throw new Error('No hay una sucursal principal configurada.');
    }

    const normalizedItems = [];
    let calculatedTotal = 0;
    let needsPrescription = false;

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity || 1);

      if (!productId || quantity <= 0) {
        throw new Error('La venta debe incluir un producto válido y una cantidad mayor que cero.');
      }

      const productResult = await client.query(
        `SELECT id, name, price, requires_prescription, controlled_substance FROM products WHERE id = $1`,
        [productId]
      );

      if (productResult.rowCount === 0) {
        throw new Error('El producto seleccionado no existe.');
      }

      const product = productResult.rows[0];

      const stockResult = await client.query(
        `SELECT stock FROM product_stock WHERE product_id = $1 AND branch_id = $2`,
        [productId, branchId]
      );
      const availableStock = Number(stockResult.rows[0]?.stock || 0);

      if (quantity > availableStock) {
        throw new Error(`No hay suficiente stock para ${product.name}. Disponible: ${availableStock}.`);
      }

      if (product.requires_prescription || product.controlled_substance) {
        needsPrescription = true;
      }

      const unitPrice = Number(item.unit_price ?? product.price ?? 0);
      const subtotal = unitPrice * quantity;

      normalizedItems.push({ productId, quantity, unitPrice, subtotal, productName: product.name });
      calculatedTotal += subtotal;
    }

    // Requisito "Validación de fórmula": si algún producto requiere receta
    // o es de control especial, la venta se rechaza (rollback) sin el número.
    if (needsPrescription && !String(prescription_number).trim()) {
      throw new Error('Uno o más productos requieren fórmula médica. Ingresa el número de la receta para continuar.');
    }

    const saleTotal = Number(total || 0) > 0 ? Number(total) : calculatedTotal;

    const saleResult = await client.query(
      `INSERT INTO sales (customer_id, branch_id, total, payment_method, prescription_number, status)
       VALUES ($1, $2, $3, $4, $5, 'completed')
       RETURNING *`,
      [customer_id || null, branchId, saleTotal, payment_method, String(prescription_number).trim() || null]
    );

    const saleId = saleResult.rows[0].id;

    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [saleId, item.productId, item.quantity, item.unitPrice, item.subtotal]
      );

      const stockUpdate = await client.query(
        `UPDATE product_stock SET stock = stock - $1
         WHERE product_id = $2 AND branch_id = $3 AND stock >= $1`,
        [item.quantity, item.productId, branchId]
      );

      if (stockUpdate.rowCount === 0) {
        throw new Error(`Stock insuficiente para el producto ${item.productName}.`);
      }

      // Requisito "Transacción de inventario": queda un movimiento propio,
      // no solo el número de stock cambiando en silencio.
      await client.query(
        `INSERT INTO inventory_transactions (product_id, branch_id, change_type, quantity, reference_type, reference_id)
         VALUES ($1, $2, 'venta', $3, 'sale', $4)`,
        [item.productId, branchId, -item.quantity, saleId]
      );
    }

    // Requisito "Transacciones de pago": el pago es su propia entidad
    // transaccional, consistente con la venta porque vive en el mismo COMMIT.
    await client.query(
      `INSERT INTO payments (sale_id, method, amount, status)
       VALUES ($1, $2, $3, 'aprobado')`,
      [saleId, payment_method, saleTotal]
    );

    // Requisito "Despacho y entrega": si viene una dirección de entrega,
    // se abre el despacho en estado pendiente para asignar un repartidor luego.
    if (String(delivery_address).trim()) {
      await client.query(
        `INSERT INTO deliveries (sale_id, status, address)
         VALUES ($1, 'pendiente', $2)`,
        [saleId, String(delivery_address).trim()]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ ...saleResult.rows[0], items: normalizedItems });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(400).json({ message: error.message || 'No se pudo registrar la venta' });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// Proveedores y compras
// ---------------------------------------------------------------

app.get('/api/suppliers', async (req, res) => {
  try {
    const result = await query('SELECT * FROM suppliers ORDER BY id DESC LIMIT 20');
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/suppliers', async (req, res) => {
  const { name, contact_name, phone, email, address } = req.body;

  if (!name) {
    return res.status(400).json({ message: 'El nombre del proveedor es obligatorio.' });
  }

  try {
    const result = await query(
      `INSERT INTO suppliers (name, contact_name, phone, email, address)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [name, contact_name || '', phone || '', email || '', address || '']
    );
    return res.status(201).json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo guardar el proveedor', error: error.message });
  }
});

app.get('/api/purchases', async (req, res) => {
  try {
    const result = await query(`
      SELECT pu.*,
        COALESCE(
          json_agg(
            json_build_object(
              'product_name', pr.name,
              'quantity', pi.quantity,
              'unit_cost', pi.unit_cost,
              'subtotal', pi.subtotal
            )
          ) FILTER (WHERE pi.id IS NOT NULL), '[]'
        ) AS items
      FROM purchases pu
      LEFT JOIN purchase_items pi ON pi.purchase_id = pu.id
      LEFT JOIN products pr ON pr.id = pi.product_id
      GROUP BY pu.id
      ORDER BY pu.id DESC
      LIMIT 20
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.post('/api/purchases', async (req, res) => {
  const { supplier_id, invoice_number, total = 0, items = [] } = req.body;

  if (!items.length) {
    return res.status(400).json({ message: 'Debes enviar al menos un producto en la compra.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const branchId = await getMainBranchId(client.query.bind(client));
    if (!branchId) {
      throw new Error('No hay una sucursal principal configurada.');
    }

    const purchaseResult = await client.query(
      `INSERT INTO purchases (supplier_id, branch_id, invoice_number, total)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [supplier_id || null, branchId, invoice_number || '', Number(total || 0)]
    );

    const purchaseId = purchaseResult.rows[0].id;

    for (const item of items) {
      const productId = Number(item.product_id);
      const quantity = Number(item.quantity || 1);
      const unitCost = Number(item.unit_cost || item.cost || 0);
      const subtotal = unitCost * quantity;

      if (!productId || quantity <= 0) {
        throw new Error('La compra debe incluir un producto válido y una cantidad mayor que cero.');
      }

      await client.query(
        `INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
         VALUES ($1, $2, $3, $4, $5)`,
        [purchaseId, productId, quantity, unitCost, subtotal]
      );

      await client.query(
        `INSERT INTO product_stock (product_id, branch_id, stock)
         VALUES ($1, $2, $3)
         ON CONFLICT (product_id, branch_id) DO UPDATE SET stock = product_stock.stock + EXCLUDED.stock`,
        [productId, branchId, quantity]
      );

      await client.query(
        `INSERT INTO inventory_transactions (product_id, branch_id, change_type, quantity, reference_type, reference_id)
         VALUES ($1, $2, 'compra', $3, 'purchase', $4)`,
        [productId, branchId, quantity, purchaseId]
      );
    }

    await client.query('COMMIT');
    return res.status(201).json({ ...purchaseResult.rows[0], items });
  } catch (error) {
    await client.query('ROLLBACK');
    return res.status(500).json({ message: 'No se pudo registrar la compra', error: error.message });
  } finally {
    client.release();
  }
});

// ---------------------------------------------------------------
// Inventario: vista de stock crítico/vencimientos y el ledger de
// movimientos (requisito "transacción de inventario").
// ---------------------------------------------------------------

app.get('/api/inventory', async (req, res) => {
  try {
    const result = await query(`
      SELECT p.*, c.name AS category_name, COALESCE(SUM(ps.stock), 0) AS stock
      FROM products p
      LEFT JOIN categories c ON c.id = p.category_id
      LEFT JOIN product_stock ps ON ps.product_id = p.id
      GROUP BY p.id, c.name
      HAVING COALESCE(SUM(ps.stock), 0) <= 10 OR p.expiration_date IS NOT NULL
      ORDER BY stock ASC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.get('/api/inventory-transactions', async (req, res) => {
  try {
    const result = await query(`
      SELECT it.*, p.name AS product_name, b.name AS branch_name
      FROM inventory_transactions it
      JOIN products p ON p.id = it.product_id
      JOIN branches b ON b.id = it.branch_id
      ORDER BY it.id DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

// ---------------------------------------------------------------
// Despacho y entrega
// ---------------------------------------------------------------

app.get('/api/deliveries', async (req, res) => {
  try {
    const result = await query(`
      SELECT d.*, s.total AS sale_total, c.full_name AS customer_name, u.name AS employee_name
      FROM deliveries d
      JOIN sales s ON s.id = d.sale_id
      LEFT JOIN customers c ON c.id = s.customer_id
      LEFT JOIN users u ON u.id = d.employee_id
      ORDER BY d.id DESC
      LIMIT 50
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(200).json(fallbackList);
  }
});

app.patch('/api/deliveries/:id', async (req, res) => {
  const { status, employee_id } = req.body;

  if (status !== undefined && !DELIVERY_STATUSES.includes(status)) {
    return res.status(400).json({ message: `El estado debe ser uno de: ${DELIVERY_STATUSES.join(', ')}.` });
  }

  try {
    const result = await query(
      `UPDATE deliveries SET
         status = COALESCE($1, status),
         employee_id = COALESCE($2, employee_id),
         delivered_at = CASE WHEN $1 = 'entregado' THEN NOW() ELSE delivered_at END
       WHERE id = $3
       RETURNING *`,
      [status ?? null, employee_id ?? null, req.params.id]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Despacho no encontrado.' });
    }

    return res.json(result.rows[0]);
  } catch (error) {
    return res.status(500).json({ message: 'No se pudo actualizar el despacho', error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`Servidor FarmaExpress escuchando en http://localhost:${PORT}`);
});
