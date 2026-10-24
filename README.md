# FarmaExpress

Sistema transaccional para el control de inventario multi-sucursal y la venta centralizada de la red de farmacias FarmaExpress.
Proyecto de Sistemas Transaccionales, Universidad Manuela Beltrán, 2026.
Autores: Víctor Alfonso Alarcón Ospina y Diego Alejandro Arias Torres.

## Stack

| Capa | Tecnología |
|---|---|
| Frontend | React 18 + Vite |
| Backend | Node.js 18+ y Express (API REST documentada con OpenAPI/Swagger) |
| Base de datos | PostgreSQL 14+ (transacciones ACID, bloqueo de filas, WAL) |
| Seguridad | bcrypt para contraseñas, JWT con expiración por inactividad, control de acceso por rol |

## Puesta en marcha

1. Copia `server/.env.example` a `server/.env` y escribe la contraseña de tu usuario de PostgreSQL.
2. Instala las dependencias:
   ```bash
   npm install
   ```
3. Crea la base, el esquema y los datos de demostración. Este paso **borra y recrea** el esquema de la base `farmaexpress`:
   ```bash
   npm run db:setup
   ```
4. Inicia la API y la interfaz:
   ```bash
   npm run dev
   ```
   - Interfaz: http://localhost:5173
   - API: http://localhost:4000
   - Documentación de la API: http://localhost:4000/api/docs
5. Ejecuta las pruebas de integración. Usan una base aparte, `farmaexpress_test`:
   ```bash
   npm test
   ```

### Usuarios de demostración

| Rol | Correo | Contraseña | Sucursal |
|---|---|---|---|
| Administrador | admin@farmaexpress.com | Admin2026 | Sede Principal |
| Farmacéutico | farmaceutico@farmaexpress.com | Farma2026 | Sede Principal |
| Farmacéutico | farmaceutico.norte@farmaexpress.com | Farma2026 | Sucursal Norte |
| Repartidor | repartidor@farmaexpress.com | Reparto2026 | Sede Principal |

## Arquitectura

```
client/src/
  App.jsx            login, sesión con cierre por inactividad y menú según el rol
  api.js             cliente HTTP que renueva el token en cada respuesta
  pages/             un módulo por proceso de negocio
server/
  server.js          arranque
  src/app.js         rutas y middlewares
  src/db.js          pool de PostgreSQL y withTransaction (BEGIN/COMMIT/ROLLBACK)
  src/services/      reglas de inventario: FEFO, stock condicional y ledger
  src/routes/        una ruta por módulo (ventas, compras, traslados…)
  src/middleware/    autenticación JWT y autorización por rol
  scripts/setup-db.js  esquema y datos de demostración
  test/              pruebas de integración de las reglas transaccionales
database/schema.sql  modelo relacional (3FN)
```

## Cómo se garantiza la integridad transaccional

| Mecanismo | Dónde | Qué evita |
|---|---|---|
| `withTransaction` (BEGIN, COMMIT, ROLLBACK) | `server/src/db.js` | Ventas, compras, traslados, ajustes y anulaciones a medias |
| `SELECT … FOR UPDATE` sobre `stock_lote` | `services/inventario.js` (`asignarLotesFEFO`) | Que dos ventas simultáneas vendan la misma unidad |
| `UPDATE … WHERE stock >= cantidad` | `services/inventario.js` (`restarStock`) | Sobreventa aunque falle la validación previa |
| `CHECK (stock >= 0)` | `schema.sql` | Inventario negativo incluso con acceso directo a la base |
| Bloqueo en orden fijo (por producto y lote) | `normalizarItems` | Interbloqueos (*deadlocks*) |
| `SELECT … FOR SHARE` sobre `productos` | `routes/ventas.js` | Cambios de precio en medio de una venta |
| Precio y total calculados en el servidor | `routes/ventas.js`, `routes/compras.js` | Manipulación del total desde el navegador |
| Trigger `trg_ledger_inalterable` | `schema.sql` | Modificar o borrar el historial de movimientos (RNF-21) |
| FEFO (lo que vence primero sale primero), sin lotes vencidos | `asignarLotesFEFO` | Pérdidas por merma y despacho de vencidos |
| Máquinas de estado con bloqueo | `despachos.js`, `traslados.js` | Saltos de estado inválidos y doble confirmación |

En la pantalla de ventas, la casilla **"Demostración: simular pago rechazado"** fuerza un error después de insertar la venta, el detalle, el stock y el ledger. Sirve para mostrar en vivo que el `ROLLBACK` revierte todo.

## Requerimientos funcionales y su implementación

| RF | Descripción | API | Pantalla |
|---|---|---|---|
| RF-01 | Gestionar medicamento | `POST/PUT /api/productos` | Medicamentos |
| RF-02 | Consultar stock centralizado | `GET /api/inventario/stock` | Inventario |
| RF-03 | Registrar movimiento de inventario | `POST /api/inventario/ajustes`, `GET /api/inventario/movimientos` | Inventario → Lotes / Ledger |
| RF-04 | Registrar y confirmar traslado | `POST /api/traslados`, `POST /api/traslados/:id/confirmar` | Traslados |
| RF-05 | Registrar compra a proveedor | `POST /api/compras` | Compras |
| RF-06 | Registrar venta y pago | `POST /api/ventas`, `POST /api/ventas/:id/anular` | Ventas |
| RF-07 | Asignar y actualizar despacho | `PATCH /api/despachos/:id/asignar` y `/estado` | Despachos |
| RF-08 | Registrar paciente y acudiente | `POST/PUT /api/pacientes` | Pacientes |
| RF-09 | Historial de medicamentos | `GET /api/pacientes/:id/historial` | Pacientes (farmacéutico) |
| RF-10 | Registrar y actualizar empleado | `POST/PUT /api/empleados` | Empleados |

## Requerimientos no funcionales cubiertos

- **RNF-01:** contraseñas guardadas con bcrypt y sal.
- **RNF-02:** consultas parametrizadas y bloqueo de 15 minutos tras 5 intentos fallidos de inicio de sesión.
- **RNF-03:** la sesión expira tras 15 minutos de inactividad.
- **RNF-04:** listados paginados de 25 en 25.
- **RNF-07:** transacciones atómicas.
- **RNF-08:** WAL nativo de PostgreSQL.
- **RNF-10:** el menú y la API se restringen según el rol.
- **RNF-12:** las acciones críticas piden confirmación.
- **RNF-13:** modelo en 3FN, con todos los estados en tablas de catálogo.
- **RNF-14:** módulos separados en rutas, servicios y acceso a datos.
- **RNF-15:** documentación Swagger en `/api/docs`.
- **RNF-19:** los datos de pacientes solo son visibles para el administrador y el farmacéutico.
- **RNF-20:** número de receta obligatorio en la venta.
- **RNF-21:** ledger inalterable.
