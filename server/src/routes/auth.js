import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { query } from '../db.js';
import { asyncHandler, badRequest, HttpError } from '../errors.js';
import { requireAuth, signToken } from '../middleware/auth.js';

const router = Router();

// RNF-02: protección anti fuerza bruta. Tras 5 intentos fallidos para el
// mismo correo, el login se bloquea 15 minutos.
const MAX_INTENTOS = 5;
const BLOQUEO_MS = 15 * 60 * 1000;
const intentos = new Map();
const HASH_FICTICIO = bcrypt.hashSync('contrasena-inexistente', 10);

function verificarBloqueo(correo) {
  const registro = intentos.get(correo);
  if (registro?.bloqueadoHasta && registro.bloqueadoHasta > Date.now()) {
    const minutos = Math.ceil((registro.bloqueadoHasta - Date.now()) / 60000);
    throw new HttpError(429, `Demasiados intentos fallidos. Intenta de nuevo en ${minutos} minuto(s).`);
  }
}

function registrarFallo(correo) {
  const registro = intentos.get(correo) || { fallos: 0 };
  registro.fallos += 1;
  if (registro.fallos >= MAX_INTENTOS) {
    registro.bloqueadoHasta = Date.now() + BLOQUEO_MS;
    registro.fallos = 0;
  }
  intentos.set(correo, registro);
}

router.post('/login', asyncHandler(async (req, res) => {
  const correo = String(req.body.correo || '').trim().toLowerCase();
  const contrasena = String(req.body.contrasena || '');
  if (!correo || !contrasena) throw badRequest('Correo y contraseña son obligatorios.');

  verificarBloqueo(correo);

  const result = await query(
    `SELECT e.id, e.nombre, e.correo, e.hash_contrasena, e.activo, e.id_sucursal,
            r.nombre_rol AS rol, s.nombre AS sucursal
     FROM empleados e
     JOIN roles r ON r.id = e.id_rol
     JOIN sucursales s ON s.id = e.id_sucursal
     WHERE lower(e.correo) = $1`,
    [correo]
  );
  const empleado = result.rows[0];

  // Se compara siempre (aunque el correo no exista) para no revelar por
  // tiempo de respuesta qué correos están registrados.
  const hash = empleado?.hash_contrasena ?? HASH_FICTICIO;
  const valida = await bcrypt.compare(contrasena, hash);

  if (!empleado || !valida) {
    registrarFallo(correo);
    throw new HttpError(401, 'Correo o contraseña incorrectos.');
  }
  if (!empleado.activo) throw new HttpError(403, 'El empleado está inactivo. Contacta al administrador.');

  intentos.delete(correo);
  const usuario = {
    id: empleado.id,
    nombre: empleado.nombre,
    correo: empleado.correo,
    rol: empleado.rol,
    id_sucursal: empleado.id_sucursal,
    sucursal: empleado.sucursal,
  };
  res.json({ token: signToken(usuario), usuario });
}));

router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const result = await query(
    `SELECT e.id, e.nombre, e.correo, r.nombre_rol AS rol, e.id_sucursal, s.nombre AS sucursal
     FROM empleados e JOIN roles r ON r.id = e.id_rol JOIN sucursales s ON s.id = e.id_sucursal
     WHERE e.id = $1 AND e.activo`,
    [req.user.id]
  );
  if (result.rowCount === 0) throw new HttpError(401, 'El empleado ya no está activo.');
  res.json(result.rows[0]);
}));

export default router;
