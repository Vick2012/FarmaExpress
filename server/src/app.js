import express from 'express';
import cors from 'cors';
import swaggerUi from 'swagger-ui-express';
import { query } from './db.js';
import { asyncHandler, errorMiddleware, notFound } from './errors.js';
import { requireAuth } from './middleware/auth.js';
import openapi from './openapi.js';
import authRoutes from './routes/auth.js';
import catalogosRoutes from './routes/catalogos.js';
import comprasRoutes from './routes/compras.js';
import dashboardRoutes from './routes/dashboard.js';
import despachosRoutes from './routes/despachos.js';
import empleadosRoutes from './routes/empleados.js';
import inventarioRoutes from './routes/inventario.js';
import pacientesRoutes from './routes/pacientes.js';
import productosRoutes from './routes/productos.js';
import trasladosRoutes from './routes/traslados.js';
import ventasRoutes from './routes/ventas.js';

const app = express();

app.use(cors({ exposedHeaders: ['x-session-token'] }));
app.use(express.json({ limit: '100kb' }));

app.get('/api/health', asyncHandler(async (req, res) => {
  const result = await query('SELECT NOW() AS now');
  res.json({ ok: true, server: 'FarmaExpress API', time: result.rows[0].now });
}));

// RNF-15: documentación OpenAPI navegable.
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi));
app.get('/api/openapi.json', (req, res) => res.json(openapi));

app.use('/api/auth', authRoutes);

// A partir de aquí todo exige sesión válida.
app.use('/api', requireAuth);
app.use('/api/catalogos', catalogosRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/productos', productosRoutes);
app.use('/api/inventario', inventarioRoutes);
app.use('/api/compras', comprasRoutes);
app.use('/api/ventas', ventasRoutes);
app.use('/api/despachos', despachosRoutes);
app.use('/api/pacientes', pacientesRoutes);
app.use('/api/empleados', empleadosRoutes);
app.use('/api/traslados', trasladosRoutes);

app.use('/api', (req, res, next) => next(notFound(`Ruta no encontrada: ${req.method} ${req.originalUrl}`)));
app.use(errorMiddleware);

export default app;
