import jwt from 'jsonwebtoken';
import { query } from '../db.js';
import { HttpError } from '../errors.js';

export const ROLES = {
  ADMIN: 'Administrador',
  FARMACEUTICO: 'Farmacéutico',
  REPARTIDOR: 'Repartidor',
};

const SECRET = process.env.JWT_SECRET || 'farmaexpress-dev-secret';
// RNF-03: la sesión expira tras 15 minutos de inactividad.
const SESSION_MINUTES = Number(process.env.SESSION_MINUTES || 15);

export function signToken(empleado) {
  return jwt.sign(
    {
      sub: empleado.id,
      nombre: empleado.nombre,
      rol: empleado.rol,
      id_sucursal: empleado.id_sucursal,
    },
    SECRET,
    { expiresIn: `${SESSION_MINUTES}m` }
  );
}

/**
 * Exige un token válido. Cada petición autenticada devuelve un token
 * renovado en la cabecera `x-session-token`: mientras el usuario trabaje,
 * la sesión se extiende; tras 15 minutos sin peticiones, expira.
 */
export function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) return next(new HttpError(401, 'Debes iniciar sesión.'));

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return next(new HttpError(401, 'La sesión expiró por inactividad. Inicia sesión de nuevo.'));
  }
  // Se relee el empleado en cada petición: si el administrador lo
  // desactiva o le cambia el rol, el efecto es inmediato aunque el token
  // siga vigente.
  query(
    `SELECT e.id, e.nombre, r.nombre_rol AS rol, e.id_sucursal
     FROM empleados e JOIN roles r ON r.id = e.id_rol
     WHERE e.id = $1 AND e.activo`,
    [payload.sub]
  )
    .then((result) => {
      if (result.rowCount === 0) return next(new HttpError(401, 'Tu usuario fue desactivado.'));
      req.user = result.rows[0];
      res.setHeader('x-session-token', signToken(req.user));
      return next();
    })
    .catch(next);
}

// RNF-10: el backend también bloquea las acciones no permitidas por rol,
// no solo la interfaz.
export const requireRole = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user?.rol)) {
    return next(new HttpError(403, `Acción no permitida para el rol ${req.user?.rol ?? 'anónimo'}.`));
  }
  return next();
};

export const isAdmin = (user) => user.rol === ROLES.ADMIN;
