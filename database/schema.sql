SET client_encoding = 'UTF8';

-- ============================================================
-- Catálogo y sucursales
-- ============================================================

CREATE TABLE IF NOT EXISTS categories (
  id SERIAL PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  address TEXT,
  is_main BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  sku VARCHAR(100) UNIQUE,
  category_id INT REFERENCES categories(id),
  price NUMERIC(12,2) NOT NULL DEFAULT 0,
  cost NUMERIC(12,2) NOT NULL DEFAULT 0,
  brand VARCHAR(100),
  expiration_date DATE,
  is_active BOOLEAN DEFAULT TRUE,
  requires_prescription BOOLEAN NOT NULL DEFAULT FALSE,
  controlled_substance BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- El stock ya no vive en products: cada producto tiene un renglón de stock
-- por sucursal (requisito "control de inventario por sucursal").
CREATE TABLE IF NOT EXISTS product_stock (
  product_id INT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  branch_id INT NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
  stock INT NOT NULL DEFAULT 0,
  PRIMARY KEY (product_id, branch_id)
);

-- ============================================================
-- Compras y proveedores
-- ============================================================

CREATE TABLE IF NOT EXISTS suppliers (
  id SERIAL PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  contact_name VARCHAR(120),
  phone VARCHAR(50),
  email VARCHAR(120),
  address TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchases (
  id SERIAL PRIMARY KEY,
  supplier_id INT REFERENCES suppliers(id),
  branch_id INT REFERENCES branches(id),
  invoice_number VARCHAR(80),
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  purchase_date TIMESTAMP DEFAULT NOW(),
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS purchase_items (
  id SERIAL PRIMARY KEY,
  purchase_id INT REFERENCES purchases(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  unit_cost NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL
);

-- ============================================================
-- Pacientes (clientes) — un paciente puede depender de otro
-- (familiar dependiente) vía guardian_id.
-- ============================================================

CREATE TABLE IF NOT EXISTS customers (
  id SERIAL PRIMARY KEY,
  full_name VARCHAR(150) NOT NULL,
  email VARCHAR(120),
  phone VARCHAR(50),
  document_number VARCHAR(30),
  address TEXT,
  guardian_id INT REFERENCES customers(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Empleados — roles fijos: Administrador, Farmacéutico, Repartidor
-- ============================================================

CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  email VARCHAR(120) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(30) NOT NULL DEFAULT 'Farmacéutico'
    CHECK (role IN ('Administrador', 'Farmacéutico', 'Repartidor')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Ventas, pagos y despacho/entrega
-- ============================================================

CREATE TABLE IF NOT EXISTS sales (
  id SERIAL PRIMARY KEY,
  customer_id INT REFERENCES customers(id),
  branch_id INT REFERENCES branches(id),
  total NUMERIC(12,2) NOT NULL DEFAULT 0,
  sale_date TIMESTAMP DEFAULT NOW(),
  payment_method VARCHAR(50),
  prescription_number VARCHAR(80),
  status VARCHAR(30) DEFAULT 'completed'
);

CREATE TABLE IF NOT EXISTS sale_items (
  id SERIAL PRIMARY KEY,
  sale_id INT REFERENCES sales(id) ON DELETE CASCADE,
  product_id INT REFERENCES products(id),
  quantity INT NOT NULL,
  unit_price NUMERIC(12,2) NOT NULL,
  subtotal NUMERIC(12,2) NOT NULL
);

-- Requisito "transacciones de pago": el pago es su propia entidad
-- transaccional, con estado, no solo un texto en la venta.
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

-- Requisito "despacho y entrega": estado del despacho, asignable a un
-- empleado con rol Repartidor.
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

-- ============================================================
-- Requisito "transacción de inventario": ledger de cada movimiento
-- de stock (venta, compra, ajuste manual), separado del número de
-- stock en sí — sin esto, el stock cambia pero no queda "por qué".
-- ============================================================

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id SERIAL PRIMARY KEY,
  product_id INT NOT NULL REFERENCES products(id),
  branch_id INT NOT NULL REFERENCES branches(id),
  change_type VARCHAR(20) NOT NULL CHECK (change_type IN ('venta', 'compra', 'ajuste')),
  quantity INT NOT NULL, -- negativo = salida, positivo = entrada
  reference_type VARCHAR(20),
  reference_id INT,
  note TEXT,
  created_by INT REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- ============================================================
-- Datos base
-- ============================================================

INSERT INTO branches (name, address, is_main)
SELECT 'Sede Principal', 'Cra 15 #40-20', TRUE
WHERE NOT EXISTS (SELECT 1 FROM branches);

INSERT INTO categories (name, description) VALUES
('Analgesicos', 'Medicamentos para dolor y fiebre'),
('Antibióticos', 'Productos farmacológicos para infecciones'),
('Vitaminas', 'Suplementos nutricionales'),
('Dermatológicos', 'Cuidado de la piel y heridas')
ON CONFLICT DO NOTHING;

INSERT INTO products (name, sku, category_id, price, cost, brand, requires_prescription) VALUES
('Paracetamol 500mg', 'PAR-500', 1, 6200, 4200, 'Genfar', FALSE),
('Ibuprofeno 400mg', 'IBU-400', 1, 8800, 5600, 'Mundipharma', FALSE),
('Amoxicilina 500mg', 'AMX-500', 2, 14250, 9800, 'Bayer', TRUE),
('Vitamina C 1000mg', 'VITC-1000', 3, 9800, 6200, 'Pharmacia', FALSE),
('Crema Antibacterial', 'CREMA-01', 4, 11500, 7600, 'Farmacol', FALSE)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO product_stock (product_id, branch_id, stock)
SELECT p.id, b.id, seed.stock
FROM (VALUES ('PAR-500', 120), ('IBU-400', 88), ('AMX-500', 64), ('VITC-1000', 75), ('CREMA-01', 42)) AS seed(sku, stock)
JOIN products p ON p.sku = seed.sku
CROSS JOIN (SELECT id FROM branches WHERE is_main = TRUE LIMIT 1) b
ON CONFLICT (product_id, branch_id) DO NOTHING;

INSERT INTO customers (full_name, email, phone, document_number) VALUES
('María Pérez', 'maria@example.com', '3001234567', '1012345678'),
('Carlos Rojas', 'carlos@example.com', '3019876543', '1023456789'),
('Ana Gómez', 'ana@example.com', '3024567890', '1034567890')
ON CONFLICT DO NOTHING;

INSERT INTO sales (customer_id, branch_id, total, payment_method, status)
SELECT 1, b.id, 6200, 'Efectivo', 'completed' FROM branches b WHERE b.is_main = TRUE
UNION ALL
SELECT 2, b.id, 23050, 'Tarjeta', 'completed' FROM branches b WHERE b.is_main = TRUE
UNION ALL
SELECT 3, b.id, 9800, 'Transferencia', 'pending' FROM branches b WHERE b.is_main = TRUE
ON CONFLICT DO NOTHING;

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal) VALUES
(1, 1, 1, 6200, 6200),
(2, 2, 1, 8800, 8800),
(2, 3, 1, 14250, 14250),
(3, 4, 1, 9800, 9800);

INSERT INTO suppliers (name, contact_name, phone, email, address) VALUES
('Distribuidora Salud', 'Luis Ortega', '3100001111', 'salud@distribuidora.com', 'Cra 12 #34-56'),
('Farmacia Pro', 'Sofia Diaz', '3111112222', 'sofia@farmaciapro.com', 'Av. 7 #23-12')
ON CONFLICT DO NOTHING;

INSERT INTO users (name, email, password_hash, role) VALUES
('Administrador General', 'admin@farmaexpress.com', 'change-me', 'Administrador'),
('Farmacéutica de Turno', 'farmaceutico@farmaexpress.com', 'change-me', 'Farmacéutico'),
('Repartidor Zona Norte', 'repartidor@farmaexpress.com', 'change-me', 'Repartidor')
ON CONFLICT (email) DO NOTHING;
