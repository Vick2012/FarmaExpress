-- Migración aditiva para bases de datos FarmaExpress ya existentes
-- (creadas con la versión anterior de schema.sql).
-- Lleva el esquema a los 5 requerimientos fuertes del proyecto:
--   1. Control de inventario por sucursal
--   2. Transacciones de pago (entidad propia)
--   3. Validación de fórmula (receta / control especial)
--   4. Despacho y entrega
--   5. Transacción de inventario (ledger de movimientos)
-- más empleados con roles y pacientes con familiar dependiente.
--
-- Ejecutar UNA sola vez:
--   psql -U postgres -d farmaexpress -f database/migration_transactional_requirements.sql
-- Es seguro reintentar si falla a mitad de camino: cada paso usa
-- IF NOT EXISTS / IF EXISTS / ON CONFLICT.

SET client_encoding = 'UTF8';

BEGIN;

-- 1) Sucursales -------------------------------------------------

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address TEXT,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

INSERT INTO branches (name, address, is_main)
SELECT 'Sede Principal', 'Cra 15 #40-20', TRUE
WHERE NOT EXISTS (SELECT 1 FROM branches);

-- 2) Stock por sucursal ------------------------------------------

CREATE TABLE IF NOT EXISTS product_stock (
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  stock INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, branch_id)
);

-- Migra el stock que hoy vive en products.stock hacia la sede principal
-- (solo si esa columna todavía existe, es decir, primera corrida).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'products' AND column_name = 'stock'
  ) THEN
    INSERT INTO product_stock (product_id, branch_id, stock)
    SELECT p.id, b.id, p.stock
    FROM products p
    CROSS JOIN (SELECT id FROM branches WHERE is_main = TRUE LIMIT 1) b
    ON CONFLICT (product_id, branch_id) DO NOTHING;

    ALTER TABLE products DROP COLUMN stock;
  END IF;
END $$;

-- 3) Validación de fórmula: medicamentos con receta / control especial

ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_prescription BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE products ADD COLUMN IF NOT EXISTS controlled_substance BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE products SET requires_prescription = TRUE WHERE sku IN ('AMX-500', 'CEF-500');

ALTER TABLE sales ADD COLUMN IF NOT EXISTS prescription_number VARCHAR(80);
ALTER TABLE sales ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);
ALTER TABLE purchases ADD COLUMN IF NOT EXISTS branch_id INT REFERENCES branches(id);

UPDATE sales SET branch_id = (SELECT id FROM branches WHERE is_main = TRUE LIMIT 1) WHERE branch_id IS NULL;
UPDATE purchases SET branch_id = (SELECT id FROM branches WHERE is_main = TRUE LIMIT 1) WHERE branch_id IS NULL;

-- 4) Pacientes: familiar dependiente -----------------------------

ALTER TABLE customers ADD COLUMN IF NOT EXISTS guardian_id INT REFERENCES customers(id);

-- 5) Empleados con roles fijos ------------------------------------

ALTER TABLE users ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE users ALTER COLUMN role SET DEFAULT 'Farmacéutico';
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_role_check;
ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('Administrador', 'Farmacéutico', 'Repartidor'));

INSERT INTO users (name, email, password_hash, role) VALUES
('Administrador General', 'admin@farmaexpress.com', 'change-me', 'Administrador'),
('Farmacéutica de Turno', 'farmaceutico@farmaexpress.com', 'change-me', 'Farmacéutico'),
('Repartidor Zona Norte', 'repartidor@farmaexpress.com', 'change-me', 'Repartidor')
ON CONFLICT (email) DO NOTHING;

-- 6) Transacciones de pago (entidad propia) ------------------------

CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method VARCHAR(50) NOT NULL,
  amount NUMERIC(12,2) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'aprobado'
    CHECK (status IN ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
  paid_at TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Genera el registro de pago para las ventas que ya existían antes de esta migración.
INSERT INTO payments (sale_id, method, amount, status, paid_at)
SELECT s.id, COALESCE(s.payment_method, 'Efectivo'), s.total, 'aprobado', s.sale_date
FROM sales s
WHERE NOT EXISTS (SELECT 1 FROM payments pay WHERE pay.sale_id = s.id);

-- 7) Despacho y entrega ---------------------------------------------

CREATE TABLE IF NOT EXISTS deliveries (
  id SERIAL PRIMARY KEY,
  sale_id INT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  employee_id INT REFERENCES users(id),
  status VARCHAR(30) NOT NULL DEFAULT 'pendiente'
    CHECK (status IN ('pendiente', 'en_ruta', 'entregado', 'cancelado')),
  address TEXT,
  scheduled_at TIMESTAMP,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW()
);

-- 8) Ledger de movimientos de inventario -----------------------------

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  branch_id INT NOT NULL REFERENCES branches(id),
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('venta', 'compra', 'ajuste')),
  quantity INT NOT NULL,
  reference_type VARCHAR(20),
  reference_id INT,
  note TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- Deja un movimiento inicial de "ajuste" por cada stock que ya existía,
-- para que el ledger cuadre con el stock actual desde el arranque.
INSERT INTO inventory_transactions (product_id, branch_id, change_type, quantity, reference_type, note)
SELECT ps.product_id, ps.branch_id, 'ajuste', ps.stock, 'manual', 'Saldo inicial migrado desde products.stock'
FROM product_stock ps
WHERE ps.stock <> 0
  AND NOT EXISTS (SELECT 1 FROM inventory_transactions it WHERE it.reference_type = 'manual');

COMMIT;
