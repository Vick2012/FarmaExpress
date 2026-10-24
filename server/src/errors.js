export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const badRequest = (message) => new HttpError(400, message);
export const notFound = (message) => new HttpError(404, message);
export const forbidden = (message) => new HttpError(403, message);
export const conflict = (message) => new HttpError(409, message);

// Envuelve un handler async para que sus errores lleguen al middleware de errores.
export const asyncHandler = (handler) => (req, res, next) =>
  Promise.resolve(handler(req, res, next)).catch(next);

// Traduce errores de PostgreSQL a mensajes entendibles por el usuario.
const PG_ERRORS = {
  23505: [409, 'Ya existe un registro con ese valor único.'],
  23503: [400, 'Referencia inválida: el registro relacionado no existe.'],
  23514: [400, 'Los datos violan una regla de integridad (por ejemplo, stock negativo).'],
};

export function errorMiddleware(error, req, res, next) { // eslint-disable-line no-unused-vars
  if (error instanceof HttpError) {
    return res.status(error.status).json({ message: error.message });
  }
  if (error.code && PG_ERRORS[error.code]) {
    const [status, message] = PG_ERRORS[error.code];
    return res.status(status).json({ message, detail: error.detail });
  }
  console.error(error);
  return res.status(500).json({ message: 'Error interno del servidor.' });
}
