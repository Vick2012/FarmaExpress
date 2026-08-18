SET client_encoding = 'UTF8';

BEGIN;

-- Categorías base para la farmacia
INSERT INTO categories (name, description)
SELECT 'Analgesicos', 'Medicamentos para dolor y fiebre'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Analgesicos'));

INSERT INTO categories (name, description)
SELECT 'Antibióticos', 'Productos farmacológicos para infecciones'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Antibióticos'));

INSERT INTO categories (name, description)
SELECT 'Vitaminas', 'Suplementos nutricionales'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Vitaminas'));

INSERT INTO categories (name, description)
SELECT 'Dermatológicos', 'Cuidados de la piel y heridas'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Dermatológicos'));

INSERT INTO categories (name, description)
SELECT 'Antiinflamatorios', 'Medicamentos para inflamación y dolor muscular'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Antiinflamatorios'));

INSERT INTO categories (name, description)
SELECT 'Respiratorios', 'Cuidado de vías respiratorias y tos'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Respiratorios'));

INSERT INTO categories (name, description)
SELECT 'Antihistamínicos', 'Alergias e histamina'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Antihistamínicos'));

INSERT INTO categories (name, description)
SELECT 'Gastrointestinales', 'Digestión y acidez'
WHERE NOT EXISTS (SELECT 1 FROM categories WHERE LOWER(TRIM(name)) = LOWER('Gastrointestinales'));

-- Productos de farmacia realistas
INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Paracetamol 500mg', 'PAR-500', c.id, 6200, 4200, 'Genfar', '2027-12-15'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Analgesicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'PAR-500');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Ibuprofeno 400mg', 'IBU-400', c.id, 8800, 5600, 'Mundipharma', '2027-10-20'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Antiinflamatorios')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'IBU-400');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Amoxicilina 500mg', 'AMX-500', c.id, 14250, 9800, 'Bayer', '2028-02-11'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Antibióticos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'AMX-500');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Vitamina C 1000mg', 'VITC-1000', c.id, 9800, 6200, 'Pharmacia', '2028-01-19'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Vitaminas')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'VITC-1000');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Crema Antibacterial', 'CREMA-01', c.id, 11500, 7600, 'Farmacol', '2027-08-09'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Dermatológicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'CREMA-01');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Loratadina 10mg', 'LOR-10', c.id, 5600, 3400, 'Aché', '2027-11-25'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Antihistamínicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'LOR-10');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Salbutamol Inhalador', 'SAL-100', c.id, 19500, 12800, 'Medihealth', '2027-09-30'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Respiratorios')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'SAL-100');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Omeprazol 20mg', 'OME-20', c.id, 7600, 5000, 'Cimic', '2027-07-12'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Gastrointestinales')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'OME-20');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Cefalexina 500mg', 'CEF-500', c.id, 14900, 10100, 'Bayer', '2028-03-18'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Antibióticos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'CEF-500');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Metformina 850mg', 'MET-850', c.id, 9800, 6400, 'GSK', '2027-06-27'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Analgesicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'MET-850');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Clotrimazol 100mg', 'CLOT-100', c.id, 7300, 4700, 'Pfizer', '2028-01-10'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Dermatológicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'CLOT-100');

INSERT INTO products (name, sku, category_id, price, cost, brand, expiration_date)
SELECT 'Gotas Oculares Lubricantes', 'GOT-01', c.id, 12300, 8200, 'Mundo Ofta', '2027-10-14'
FROM categories c
WHERE LOWER(TRIM(c.name)) = LOWER('Dermatológicos')
AND NOT EXISTS (SELECT 1 FROM products WHERE sku = 'GOT-01');

-- Stock inicial (sede principal) para los productos de arriba
INSERT INTO product_stock (product_id, branch_id, stock)
SELECT pr.id, b.id, seed.stock
FROM (VALUES
  ('PAR-500', 120), ('IBU-400', 80), ('AMX-500', 64), ('VITC-1000', 75),
  ('CREMA-01', 42), ('LOR-10', 35), ('SAL-100', 18), ('OME-20', 27),
  ('CEF-500', 52), ('MET-850', 22), ('CLOT-100', 12), ('GOT-01', 15)
) AS seed(sku, stock)
JOIN products pr ON pr.sku = seed.sku
CROSS JOIN (SELECT id FROM branches WHERE is_main = TRUE LIMIT 1) b
ON CONFLICT (product_id, branch_id) DO NOTHING;

-- Clientes
INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'María Pérez', 'maria@example.com', '3001234567', '1012345678', 'Cra 12 #34-56'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('maria@example.com'));

INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'Carlos Rojas', 'carlos@example.com', '3019876543', '1023456789', 'Av. 7 #23-12'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('carlos@example.com'));

INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'Ana Gómez', 'ana@example.com', '3024567890', '1034567890', 'Cl. 10 #20-30'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('ana@example.com'));

INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'Daniel Torres', 'daniel@farmacia.co', '3006543210', '1045678901', 'Transv. 15 #45-80'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('daniel@farmacia.co'));

INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'Paula Medina', 'paula@correo.com', '3051122334', '1056789012', 'Cra 20 #12-33'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('paula@correo.com'));

INSERT INTO customers (full_name, email, phone, document_number, address)
SELECT 'Javier Ruiz', 'javier@salud.com', '3029988776', '1067890123', 'Av. 80 #10-18'
WHERE NOT EXISTS (SELECT 1 FROM customers WHERE LOWER(TRIM(email)) = LOWER('javier@salud.com'));

-- Proveedores
INSERT INTO suppliers (name, contact_name, phone, email, address)
SELECT 'Distribuidora Salud', 'Luis Ortega', '3100001111', 'salud@distribuidora.com', 'Cra 12 #34-56'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE LOWER(TRIM(name)) = LOWER('Distribuidora Salud'));

INSERT INTO suppliers (name, contact_name, phone, email, address)
SELECT 'Farmacia Pro', 'Sofía Díaz', '3111112222', 'sofia@farmaciapro.com', 'Av. 7 #23-12'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE LOWER(TRIM(name)) = LOWER('Farmacia Pro'));

INSERT INTO suppliers (name, contact_name, phone, email, address)
SELECT 'Bodega Medicinal', 'Carlos Peña', '3123334444', 'bodega@medicinal.com', 'Calle 30 #18-25'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE LOWER(TRIM(name)) = LOWER('Bodega Medicinal'));

INSERT INTO suppliers (name, contact_name, phone, email, address)
SELECT 'Pharma Global', 'Andrea López', '3134445555', 'andrea@pharmaglobal.com', 'Cra 9 #15-40'
WHERE NOT EXISTS (SELECT 1 FROM suppliers WHERE LOWER(TRIM(name)) = LOWER('Pharma Global'));

-- Compras de prueba
INSERT INTO purchases (supplier_id, invoice_number, total, purchase_date)
SELECT s.id, 'FAC-2026-001', 246400, '2026-08-01 09:30:00'
FROM suppliers s
WHERE LOWER(TRIM(s.name)) = LOWER('Distribuidora Salud')
AND NOT EXISTS (SELECT 1 FROM purchases WHERE invoice_number = 'FAC-2026-001');

INSERT INTO purchases (supplier_id, invoice_number, total, purchase_date)
SELECT s.id, 'FAC-2026-002', 186700, '2026-08-05 11:00:00'
FROM suppliers s
WHERE LOWER(TRIM(s.name)) = LOWER('Farmacia Pro')
AND NOT EXISTS (SELECT 1 FROM purchases WHERE invoice_number = 'FAC-2026-002');

INSERT INTO purchases (supplier_id, invoice_number, total, purchase_date)
SELECT s.id, 'FAC-2026-003', 143500, '2026-08-09 10:15:00'
FROM suppliers s
WHERE LOWER(TRIM(s.name)) = LOWER('Bodega Medicinal')
AND NOT EXISTS (SELECT 1 FROM purchases WHERE invoice_number = 'FAC-2026-003');

-- Items de compra
INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 40, pr.cost, pr.cost * 40
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'PAR-500'
WHERE p.invoice_number = 'FAC-2026-001' AND LOWER(TRIM(s.name)) = LOWER('Distribuidora Salud')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 25, pr.cost, pr.cost * 25
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'AMX-500'
WHERE p.invoice_number = 'FAC-2026-001' AND LOWER(TRIM(s.name)) = LOWER('Distribuidora Salud')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 18, pr.cost, pr.cost * 18
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'LOR-10'
WHERE p.invoice_number = 'FAC-2026-002' AND LOWER(TRIM(s.name)) = LOWER('Farmacia Pro')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 15, pr.cost, pr.cost * 15
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'CREMA-01'
WHERE p.invoice_number = 'FAC-2026-002' AND LOWER(TRIM(s.name)) = LOWER('Farmacia Pro')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 30, pr.cost, pr.cost * 30
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'VITC-1000'
WHERE p.invoice_number = 'FAC-2026-003' AND LOWER(TRIM(s.name)) = LOWER('Bodega Medicinal')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

INSERT INTO purchase_items (purchase_id, product_id, quantity, unit_cost, subtotal)
SELECT p.id, pr.id, 20, pr.cost, pr.cost * 20
FROM purchases p
JOIN suppliers s ON s.id = p.supplier_id
JOIN products pr ON pr.sku = 'OME-20'
WHERE p.invoice_number = 'FAC-2026-003' AND LOWER(TRIM(s.name)) = LOWER('Bodega Medicinal')
AND NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id = p.id AND pi.product_id = pr.id);

-- Ventas
INSERT INTO sales (customer_id, total, sale_date, payment_method, status)
SELECT c.id, 18600, '2026-08-02 10:00:00', 'Efectivo', 'completed'
FROM customers c
WHERE LOWER(TRIM(c.full_name)) = LOWER('María Pérez')
AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = c.id AND total = 18600 AND payment_method = 'Efectivo');

INSERT INTO sales (customer_id, total, sale_date, payment_method, status)
SELECT c.id, 31050, '2026-08-02 13:15:00', 'Tarjeta', 'completed'
FROM customers c
WHERE LOWER(TRIM(c.full_name)) = LOWER('Carlos Rojas')
AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = c.id AND total = 31050 AND payment_method = 'Tarjeta');

INSERT INTO sales (customer_id, total, sale_date, payment_method, status)
SELECT c.id, 11500, '2026-08-03 09:45:00', 'Transferencia', 'completed'
FROM customers c
WHERE LOWER(TRIM(c.full_name)) = LOWER('Ana Gómez')
AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = c.id AND total = 11500 AND payment_method = 'Transferencia');

INSERT INTO sales (customer_id, total, sale_date, payment_method, status)
SELECT c.id, 21400, '2026-08-04 16:20:00', 'Efectivo', 'completed'
FROM customers c
WHERE LOWER(TRIM(c.full_name)) = LOWER('Daniel Torres')
AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = c.id AND total = 21400 AND payment_method = 'Efectivo');

INSERT INTO sales (customer_id, total, sale_date, payment_method, status)
SELECT c.id, 27800, '2026-08-05 12:30:00', 'Tarjeta', 'completed'
FROM customers c
WHERE LOWER(TRIM(c.full_name)) = LOWER('Paula Medina')
AND NOT EXISTS (SELECT 1 FROM sales WHERE customer_id = c.id AND total = 27800 AND payment_method = 'Tarjeta');

-- Items de venta
INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 2, pr.price, pr.price * 2
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'PAR-500'
WHERE LOWER(TRIM(c.full_name)) = LOWER('María Pérez')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 1, pr.price, pr.price * 1
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'AMX-500'
WHERE LOWER(TRIM(c.full_name)) = LOWER('Carlos Rojas')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 1, pr.price, pr.price * 1
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'SAL-100'
WHERE LOWER(TRIM(c.full_name)) = LOWER('Carlos Rojas')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 1, pr.price, pr.price * 1
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'CREMA-01'
WHERE LOWER(TRIM(c.full_name)) = LOWER('Ana Gómez')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 2, pr.price, pr.price * 2
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'VITC-1000'
WHERE LOWER(TRIM(c.full_name)) = LOWER('Daniel Torres')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

INSERT INTO sale_items (sale_id, product_id, quantity, unit_price, subtotal)
SELECT s.id, pr.id, 3, pr.price, pr.price * 3
FROM sales s
JOIN customers c ON c.id = s.customer_id
JOIN products pr ON pr.sku = 'OME-20'
WHERE LOWER(TRIM(c.full_name)) = LOWER('Paula Medina')
AND NOT EXISTS (SELECT 1 FROM sale_items si WHERE si.sale_id = s.id AND si.product_id = pr.id);

-- Ajustes de stock (sede principal): las compras de arriba entran, las ventas salen.
-- Usamos una función corta para no repetir el JOIN contra product_stock 12 veces.
DO $$
DECLARE
  main_branch INT;
BEGIN
  SELECT id INTO main_branch FROM branches WHERE is_main = TRUE LIMIT 1;

  UPDATE product_stock SET stock = stock + 40 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'PAR-500');
  UPDATE product_stock SET stock = stock + 25 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'AMX-500');
  UPDATE product_stock SET stock = stock + 18 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'LOR-10');
  UPDATE product_stock SET stock = stock + 15 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'CREMA-01');
  UPDATE product_stock SET stock = stock + 30 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'VITC-1000');
  UPDATE product_stock SET stock = stock + 20 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'OME-20');

  UPDATE product_stock SET stock = stock - 2 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'PAR-500');
  UPDATE product_stock SET stock = stock - 1 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'AMX-500');
  UPDATE product_stock SET stock = stock - 1 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'SAL-100');
  UPDATE product_stock SET stock = stock - 1 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'CREMA-01');
  UPDATE product_stock SET stock = stock - 2 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'VITC-1000');
  UPDATE product_stock SET stock = stock - 3 WHERE branch_id = main_branch AND product_id = (SELECT id FROM products WHERE sku = 'OME-20');
END $$;

COMMIT;
