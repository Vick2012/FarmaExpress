// Especificación OpenAPI 3 de la API (RNF-15). Se sirve en /api/docs.

const json = (schema) => ({ content: { 'application/json': { schema } } });
const ok = (description = 'OK') => ({ description });
const paged = { page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 }, description: '25 registros por página' } };

const op = (tag, summary, { roles, body, params = [], description } = {}) => ({
  tags: [tag],
  summary,
  description: [description, roles && `**Roles:** ${roles}`].filter(Boolean).join('\n\n'),
  parameters: params,
  ...(body ? { requestBody: { required: true, ...json(body) } } : {}),
  responses: { 200: ok(), 201: ok('Creado'), 400: ok('Validación'), 401: ok('Sin sesión'), 403: ok('Rol no autorizado') },
});

const idParam = { name: 'id', in: 'path', required: true, schema: { type: 'integer' } };
const items = {
  type: 'array',
  items: { type: 'object', required: ['id_producto', 'cantidad'], properties: { id_producto: { type: 'integer' }, cantidad: { type: 'integer', minimum: 1 } } },
};

export default {
  openapi: '3.0.3',
  info: {
    title: 'FarmaExpress API',
    version: '2.0.0',
    description:
      'API transaccional de la red de farmacias FarmaExpress. Todas las operaciones que afectan varias tablas ' +
      '(ventas, compras, traslados, ajustes, anulaciones) se ejecutan en una única transacción PostgreSQL.\n\n' +
      'Autenticación: `POST /api/auth/login` devuelve un JWT; envíalo como `Authorization: Bearer <token>`. ' +
      'Cada respuesta trae un token renovado en la cabecera `x-session-token` (sesión de 15 minutos de inactividad).',
  },
  servers: [{ url: '/' }],
  components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
  security: [{ bearer: [] }],
  paths: {
    '/api/auth/login': {
      post: {
        ...op('Autenticación', 'Iniciar sesión', {
          description: 'Bloquea 15 minutos tras 5 intentos fallidos (RNF-02).',
          body: { type: 'object', properties: { correo: { type: 'string' }, contrasena: { type: 'string' } } },
        }),
        security: [],
      },
    },
    '/api/auth/me': { get: op('Autenticación', 'Empleado de la sesión actual') },
    '/api/catalogos': { get: op('Catálogos', 'Sucursales, categorías, marcas, aseguradoras, roles, contratos, métodos de pago y repartidores') },
    '/api/dashboard': { get: op('Dashboard', 'Indicadores y series para gráficos', { roles: 'Administrador, Farmacéutico' }) },
    '/api/productos': {
      get: op('Medicamentos (RF-01)', 'Listar medicamentos', { params: [paged.page, { name: 'q', in: 'query', schema: { type: 'string' } }] }),
      post: op('Medicamentos (RF-01)', 'Registrar medicamento (nace con stock cero)', {
        roles: 'Administrador, Farmacéutico',
        body: {
          type: 'object',
          properties: {
            nombre_generico: { type: 'string' }, presentacion: { type: 'string' }, sku: { type: 'string' },
            id_categoria: { type: 'integer' }, id_marca: { type: 'integer' }, precio: { type: 'number' }, costo: { type: 'number' },
            requiere_receta: { type: 'boolean' }, control_especial: { type: 'boolean' },
          },
        },
      }),
    },
    '/api/productos/{id}': { put: op('Medicamentos (RF-01)', 'Actualizar medicamento', { roles: 'Administrador, Farmacéutico', params: [idParam] }) },
    '/api/productos/opciones': { get: op('Medicamentos (RF-01)', 'Lista compacta con stock vendible de una sucursal') },
    '/api/inventario/stock': { get: op('Inventario (RF-02, RF-03)', 'Stock centralizado y por sucursal', { params: [paged.page, { name: 'sucursal', in: 'query', schema: { type: 'integer' } }] }) },
    '/api/inventario/lotes': { get: op('Inventario (RF-02, RF-03)', 'Lotes con stock y días para vencer') },
    '/api/inventario/alertas': { get: op('Inventario (RF-02, RF-03)', 'Lotes por vencer (90 días) y stock bajo') },
    '/api/inventario/movimientos': { get: op('Inventario (RF-02, RF-03)', 'Ledger de movimientos (inalterable)', { roles: 'Administrador, Farmacéutico', params: [paged.page] }) },
    '/api/inventario/ajustes': {
      post: op('Inventario (RF-02, RF-03)', 'Ajuste manual auditado (transacción)', {
        roles: 'Administrador, Farmacéutico',
        body: { type: 'object', properties: { id_lote: { type: 'integer' }, id_sucursal: { type: 'integer' }, cantidad: { type: 'integer' }, nota: { type: 'string' } } },
      }),
    },
    '/api/compras': {
      get: op('Compras (RF-05)', 'Listar compras', { roles: 'Administrador', params: [paged.page] }),
      post: op('Compras (RF-05)', 'Registrar compra: lotes + detalle + stock + ledger en una transacción', {
        roles: 'Administrador',
        body: {
          type: 'object',
          properties: {
            id_proveedor: { type: 'integer' }, id_sucursal: { type: 'integer' }, numero_factura: { type: 'string' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id_producto: { type: 'integer' }, numero_lote: { type: 'string' }, fecha_vencimiento: { type: 'string', format: 'date' },
                  cantidad: { type: 'integer' }, costo_unitario: { type: 'number' },
                },
              },
            },
          },
        },
      }),
    },
    '/api/compras/proveedores': {
      get: op('Compras (RF-05)', 'Listar proveedores'),
      post: op('Compras (RF-05)', 'Registrar proveedor', { roles: 'Administrador' }),
    },
    '/api/ventas': {
      get: op('Ventas (RF-06)', 'Listar ventas', { roles: 'Administrador, Farmacéutico', params: [paged.page] }),
      post: op('Ventas (RF-06)', 'Registrar venta y pago (transacción atómica, FEFO, validación de fórmula)', {
        roles: 'Farmacéutico',
        body: {
          type: 'object',
          properties: {
            id_paciente: { type: 'integer' }, id_metodo_pago: { type: 'integer' }, numero_receta: { type: 'string' }, items,
            despacho: { type: 'object', properties: { direccion: { type: 'string' }, fecha_programada: { type: 'string', format: 'date-time' } } },
            simular_pago_rechazado: { type: 'boolean', description: 'Solo demostración: fuerza ROLLBACK' },
          },
        },
      }),
    },
    '/api/ventas/{id}/anular': { post: op('Ventas (RF-06)', 'Anular venta (devuelve stock, reembolsa pago)', { roles: 'Farmacéutico, Administrador', params: [idParam] }) },
    '/api/despachos': { get: op('Despachos (RF-07)', 'Listar despachos (el repartidor ve solo los suyos)', { params: [paged.page] }) },
    '/api/despachos/{id}/asignar': { patch: op('Despachos (RF-07)', 'Asignar repartidor', { roles: 'Farmacéutico', params: [idParam] }) },
    '/api/despachos/{id}/estado': { patch: op('Despachos (RF-07)', 'Cambiar estado (pendiente → en_ruta → entregado)', { roles: 'Repartidor, Farmacéutico (solo cancelar)', params: [idParam] }) },
    '/api/pacientes': {
      get: op('Pacientes (RF-08, RF-09)', 'Listar pacientes', { roles: 'Administrador, Farmacéutico', params: [paged.page] }),
      post: op('Pacientes (RF-08, RF-09)', 'Registrar paciente con acudiente y aseguradora', { roles: 'Administrador, Farmacéutico' }),
    },
    '/api/pacientes/{id}': { put: op('Pacientes (RF-08, RF-09)', 'Actualizar paciente', { params: [idParam] }) },
    '/api/pacientes/{id}/historial': { get: op('Pacientes (RF-08, RF-09)', 'Historial de medicamentos', { roles: 'Farmacéutico', params: [idParam] }) },
    '/api/empleados': {
      get: op('Empleados (RF-10)', 'Listar empleados', { roles: 'Administrador', params: [paged.page] }),
      post: op('Empleados (RF-10)', 'Registrar empleado (contraseña con bcrypt)', { roles: 'Administrador' }),
    },
    '/api/empleados/{id}': { put: op('Empleados (RF-10)', 'Actualizar o desactivar empleado', { roles: 'Administrador', params: [idParam] }) },
    '/api/empleados/{id}/contrasena': { patch: op('Empleados (RF-10)', 'Restablecer contraseña', { roles: 'Administrador', params: [idParam] }) },
    '/api/traslados': {
      get: op('Traslados (RF-04)', 'Listar traslados', { roles: 'Administrador, Farmacéutico', params: [paged.page] }),
      post: op('Traslados (RF-04)', 'Crear traslado (descuenta origen, queda pendiente)', {
        roles: 'Administrador, Farmacéutico',
        body: { type: 'object', properties: { id_sucursal_origen: { type: 'integer' }, id_sucursal_destino: { type: 'integer' }, items } },
      }),
    },
    '/api/traslados/{id}/confirmar': { post: op('Traslados (RF-04)', 'Confirmar recepción (suma en destino)', { params: [idParam] }) },
    '/api/traslados/{id}/cancelar': { post: op('Traslados (RF-04)', 'Cancelar traslado pendiente (devuelve al origen)', { params: [idParam] }) },
  },
};
