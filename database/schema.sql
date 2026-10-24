-- ============================================================
-- FarmaExpress — Modelo relacional (PostgreSQL)
-- Alineado con el MER del documento del proyecto (v4: inventario por lote).
-- Normalizado en 3FN (RNF-13): todos los estados y tipos viven en
-- tablas catálogo, no como texto libre.
--
-- Ejecutar sobre una base vacía:
--   psql -U postgres -d farmaexpress -f database/schema.sql
-- (o `npm run db:setup`, que además carga los datos de prueba).
-- ============================================================

SET client_encoding = 'UTF8';

DROP SCHEMA IF EXISTS public CASCADE;
CREATE SCHEMA public;

-- ------------------------------------------------------------
-- Catálogos
-- ------------------------------------------------------------

CREATE TABLE categorias (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE,
  descripcion TEXT,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE marcas (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(100) NOT NULL UNIQUE
);

CREATE TABLE sucursales (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL UNIQUE,
  direccion TEXT,
  es_principal BOOLEAN NOT NULL DEFAULT FALSE,
  activa BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE roles (
  id SERIAL PRIMARY KEY,
  nombre_rol VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE tipos_contrato (
  id SERIAL PRIMARY KEY,
  nombre_tipo VARCHAR(40) NOT NULL UNIQUE
);

CREATE TABLE aseguradoras (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL UNIQUE
);

CREATE TABLE estados_venta (
  id SERIAL PRIMARY KEY,
  nombre_estado VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE estados_pago (
  id SERIAL PRIMARY KEY,
  nombre_estado VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE metodos_pago (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(50) NOT NULL UNIQUE
);

CREATE TABLE estados_despacho (
  id SERIAL PRIMARY KEY,
  nombre_estado VARCHAR(30) NOT NULL UNIQUE
);

CREATE TABLE tipos_movimiento (
  id SERIAL PRIMARY KEY,
  nombre_tipo VARCHAR(20) NOT NULL UNIQUE
);

CREATE TABLE estados_traslado (
  id SERIAL PRIMARY KEY,
  nombre_estado VARCHAR(30) NOT NULL UNIQUE
);

-- ------------------------------------------------------------
-- Entidades principales
-- ------------------------------------------------------------

CREATE TABLE proveedores (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(150) NOT NULL,
  nombre_contacto VARCHAR(120),
  telefono VARCHAR(50),
  correo VARCHAR(120),
  direccion TEXT,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE productos (
  id SERIAL PRIMARY KEY,
  nombre_generico VARCHAR(150) NOT NULL,
  presentacion VARCHAR(50),
  sku VARCHAR(100) NOT NULL UNIQUE,
  id_categoria INT REFERENCES categorias(id),
  id_marca INT REFERENCES marcas(id),
  precio NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (precio >= 0),
  costo NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (costo >= 0),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  requiere_receta BOOLEAN NOT NULL DEFAULT FALSE,
  control_especial BOOLEAN NOT NULL DEFAULT FALSE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

-- El vencimiento vive en el lote, no en el producto: un mismo
-- medicamento puede tener varios lotes con fechas distintas.
CREATE TABLE lotes (
  id SERIAL PRIMARY KEY,
  id_producto INT NOT NULL REFERENCES productos(id),
  numero_lote VARCHAR(50) NOT NULL,
  fecha_fabricacion DATE,
  fecha_vencimiento DATE NOT NULL,
  UNIQUE (id_producto, numero_lote),
  CHECK (fecha_fabricacion IS NULL OR fecha_fabricacion <= fecha_vencimiento)
);

CREATE TABLE pacientes (
  id SERIAL PRIMARY KEY,
  nombre_completo VARCHAR(150) NOT NULL,
  correo VARCHAR(120),
  telefono VARCHAR(50),
  documento_numero VARCHAR(30) UNIQUE,
  direccion TEXT,
  id_acudiente INT REFERENCES pacientes(id),
  id_aseguradora INT REFERENCES aseguradoras(id),
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (id_acudiente IS NULL OR id_acudiente <> id)
);

CREATE TABLE empleados (
  id SERIAL PRIMARY KEY,
  nombre VARCHAR(120) NOT NULL,
  correo VARCHAR(120) NOT NULL UNIQUE,
  hash_contrasena VARCHAR(255) NOT NULL,
  id_rol INT NOT NULL REFERENCES roles(id),
  id_sucursal INT NOT NULL REFERENCES sucursales(id),
  id_tipo_contrato INT NOT NULL REFERENCES tipos_contrato(id),
  activo BOOLEAN NOT NULL DEFAULT TRUE,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Stock por LOTE y SUCURSAL. El CHECK es la última barrera: aunque la
-- aplicación fallara, la base nunca acepta inventario negativo.
CREATE TABLE stock_lote (
  id_lote INT NOT NULL REFERENCES lotes(id),
  id_sucursal INT NOT NULL REFERENCES sucursales(id),
  stock INT NOT NULL DEFAULT 0 CHECK (stock >= 0),
  PRIMARY KEY (id_lote, id_sucursal)
);

-- ------------------------------------------------------------
-- Compras
-- ------------------------------------------------------------

CREATE TABLE compras (
  id SERIAL PRIMARY KEY,
  id_proveedor INT NOT NULL REFERENCES proveedores(id),
  id_sucursal INT NOT NULL REFERENCES sucursales(id),
  id_empleado INT NOT NULL REFERENCES empleados(id),
  numero_factura VARCHAR(80),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  fecha_compra TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE detalle_compra (
  id SERIAL PRIMARY KEY,
  id_compra INT NOT NULL REFERENCES compras(id),
  id_lote INT NOT NULL REFERENCES lotes(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  costo_unitario NUMERIC(12,2) NOT NULL CHECK (costo_unitario >= 0),
  subtotal NUMERIC(12,2) NOT NULL
);

-- ------------------------------------------------------------
-- Ventas, pagos y despachos
-- ------------------------------------------------------------

CREATE TABLE ventas (
  id SERIAL PRIMARY KEY,
  id_paciente INT REFERENCES pacientes(id),
  id_sucursal INT NOT NULL REFERENCES sucursales(id),
  id_empleado INT NOT NULL REFERENCES empleados(id), -- quién dispensó (auditoría)
  id_estado INT NOT NULL REFERENCES estados_venta(id),
  total NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
  fecha_venta TIMESTAMP NOT NULL DEFAULT NOW(),
  numero_receta VARCHAR(80)
);

CREATE TABLE detalle_venta (
  id SERIAL PRIMARY KEY,
  id_venta INT NOT NULL REFERENCES ventas(id),
  id_lote INT NOT NULL REFERENCES lotes(id),
  cantidad INT NOT NULL CHECK (cantidad > 0),
  precio_unitario NUMERIC(12,2) NOT NULL CHECK (precio_unitario >= 0),
  subtotal NUMERIC(12,2) NOT NULL
);

CREATE TABLE pagos (
  id SERIAL PRIMARY KEY,
  id_venta INT NOT NULL REFERENCES ventas(id),
  id_metodo_pago INT NOT NULL REFERENCES metodos_pago(id),
  monto NUMERIC(12,2) NOT NULL CHECK (monto >= 0),
  id_estado INT NOT NULL REFERENCES estados_pago(id),
  fecha_pago TIMESTAMP,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE despachos (
  id SERIAL PRIMARY KEY,
  id_venta INT NOT NULL UNIQUE REFERENCES ventas(id),
  id_empleado INT REFERENCES empleados(id), -- repartidor asignado
  id_estado INT NOT NULL REFERENCES estados_despacho(id),
  direccion TEXT NOT NULL,
  fecha_programada TIMESTAMP,
  fecha_entrega TIMESTAMP,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

-- ------------------------------------------------------------
-- Ledger de inventario y traslados
-- ------------------------------------------------------------

-- Cada cambio de stock deja una fila aquí (positivo = entrada,
-- negativo = salida). tipo_referencia/id_referencia apuntan al
-- documento que lo originó (venta, compra, traslado o ajuste).
CREATE TABLE movimientos_inventario (
  id SERIAL PRIMARY KEY,
  id_lote INT NOT NULL REFERENCES lotes(id),
  id_sucursal INT NOT NULL REFERENCES sucursales(id),
  id_tipo_movimiento INT NOT NULL REFERENCES tipos_movimiento(id),
  cantidad INT NOT NULL CHECK (cantidad <> 0),
  tipo_referencia VARCHAR(20),
  id_referencia INT,
  nota TEXT,
  creado_por INT NOT NULL REFERENCES empleados(id),
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE TABLE traslados_inventario (
  id SERIAL PRIMARY KEY,
  id_sucursal_origen INT NOT NULL REFERENCES sucursales(id),
  id_sucursal_destino INT NOT NULL REFERENCES sucursales(id),
  id_empleado INT NOT NULL REFERENCES empleados(id),           -- quién lo solicita
  id_empleado_recibe INT REFERENCES empleados(id),             -- quién confirma en destino
  id_estado INT NOT NULL REFERENCES estados_traslado(id),
  fecha_traslado TIMESTAMP NOT NULL DEFAULT NOW(),
  fecha_recepcion TIMESTAMP,
  fecha_creacion TIMESTAMP NOT NULL DEFAULT NOW(),
  CHECK (id_sucursal_origen <> id_sucursal_destino)
);

CREATE TABLE detalle_traslado (
  id SERIAL PRIMARY KEY,
  id_traslado INT NOT NULL REFERENCES traslados_inventario(id),
  id_lote INT NOT NULL REFERENCES lotes(id),
  cantidad INT NOT NULL CHECK (cantidad > 0)
);

-- ------------------------------------------------------------
-- RNF-21: el ledger es inalterable. Ni la aplicación ni un usuario
-- con acceso directo a la base pueden modificar o borrar movimientos;
-- las correcciones se hacen con un nuevo movimiento de ajuste.
-- ------------------------------------------------------------

CREATE FUNCTION bloquear_modificacion_ledger() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'movimientos_inventario es inalterable: registre un ajuste en lugar de %', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_ledger_inalterable
  BEFORE UPDATE OR DELETE ON movimientos_inventario
  FOR EACH ROW EXECUTE FUNCTION bloquear_modificacion_ledger();

-- ------------------------------------------------------------
-- Índices para las consultas frecuentes (RNF-05)
-- ------------------------------------------------------------

CREATE INDEX idx_lotes_producto_venc ON lotes (id_producto, fecha_vencimiento);
CREATE INDEX idx_stock_lote_sucursal ON stock_lote (id_sucursal);
CREATE INDEX idx_mov_lote_sucursal_fecha ON movimientos_inventario (id_lote, id_sucursal, fecha_creacion);
CREATE INDEX idx_mov_fecha ON movimientos_inventario (fecha_creacion);
CREATE INDEX idx_ventas_paciente ON ventas (id_paciente, fecha_venta);
CREATE INDEX idx_ventas_fecha ON ventas (fecha_venta);
CREATE INDEX idx_detalle_venta_venta ON detalle_venta (id_venta);
CREATE INDEX idx_despachos_empleado ON despachos (id_empleado);
CREATE INDEX idx_traslados_estado ON traslados_inventario (id_estado);

-- ------------------------------------------------------------
-- Datos de catálogo obligatorios (la aplicación busca los IDs por
-- nombre, nunca los asume fijos).
-- ------------------------------------------------------------

INSERT INTO roles (nombre_rol) VALUES ('Administrador'), ('Farmacéutico'), ('Repartidor');
INSERT INTO tipos_contrato (nombre_tipo) VALUES ('Indefinido'), ('Fijo'), ('Prestación de servicios'), ('Aprendizaje');
INSERT INTO estados_venta (nombre_estado) VALUES ('completada'), ('anulada');
INSERT INTO estados_pago (nombre_estado) VALUES ('pendiente'), ('aprobado'), ('rechazado'), ('reembolsado');
INSERT INTO metodos_pago (nombre) VALUES ('Efectivo'), ('Tarjeta'), ('Transferencia');
INSERT INTO estados_despacho (nombre_estado) VALUES ('pendiente'), ('en_ruta'), ('entregado'), ('cancelado');
INSERT INTO tipos_movimiento (nombre_tipo) VALUES ('compra'), ('venta'), ('ajuste'), ('traslado_salida'), ('traslado_entrada'), ('anulacion_venta'), ('traslado_reverso');
INSERT INTO estados_traslado (nombre_estado) VALUES ('pendiente'), ('completado'), ('cancelado');
