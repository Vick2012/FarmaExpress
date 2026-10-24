import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const { Pool, types } = pg;

// NUMERIC llega como string desde pg; para montos en COP (2 decimales)
// es seguro convertirlo a Number.
types.setTypeParser(1700, (value) => (value === null ? null : Number(value)));
// COUNT(*) devuelve BIGINT (string); los conteos de esta app caben en Number.
types.setTypeParser(20, (value) => (value === null ? null : Number(value)));

export const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'farmaexpress',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: Number(process.env.DB_POOL_MAX || 20),
});

export const query = (text, params) => pool.query(text, params);

/**
 * Ejecuta `work` dentro de una transacción de base de datos (RNF-07).
 * Todo lo que haga `work` con el `client` recibido se confirma junto con
 * COMMIT, o se deshace por completo con ROLLBACK si algo lanza un error.
 */
export async function withTransaction(work) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

// Los catálogos (estados, tipos, roles…) se buscan por nombre y se
// cachean: nunca se asume que 'aprobado' tiene el id 2.
const catalogCache = new Map();
const CATALOG_COLUMNS = {
  roles: 'nombre_rol',
  tipos_contrato: 'nombre_tipo',
  estados_venta: 'nombre_estado',
  estados_pago: 'nombre_estado',
  metodos_pago: 'nombre',
  estados_despacho: 'nombre_estado',
  tipos_movimiento: 'nombre_tipo',
  estados_traslado: 'nombre_estado',
};

export async function catalogId(executor, table, name) {
  const key = `${table}:${name}`;
  if (catalogCache.has(key)) return catalogCache.get(key);
  const column = CATALOG_COLUMNS[table];
  if (!column) throw new Error(`Catálogo desconocido: ${table}`);
  const result = await executor.query(`SELECT id FROM ${table} WHERE ${column} = $1`, [name]);
  if (result.rowCount === 0) throw new Error(`No existe "${name}" en ${table}`);
  catalogCache.set(key, result.rows[0].id);
  return result.rows[0].id;
}
