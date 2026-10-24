// RNF-04: todos los listados se paginan exactamente de a 25 registros.
export const PAGE_SIZE = 25;

export function pageParams(req) {
  const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
  return { page, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

// Las consultas paginadas usan COUNT(*) OVER () AS total_count para traer
// el total en la misma consulta; aquí se separa del resto de columnas.
export function pageResponse(rows, page) {
  const total = rows[0]?.total_count ?? 0;
  return {
    data: rows.map(({ total_count, ...row }) => row), // eslint-disable-line no-unused-vars
    page,
    pageSize: PAGE_SIZE,
    total,
    totalPages: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}
