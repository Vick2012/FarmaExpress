import { useCallback, useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from './api.js';

export const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(Number(value) || 0);

export const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

export const formatDateTime = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : date.toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
};

export const ROLES = { ADMIN: 'Administrador', FARMACEUTICO: 'Farmacéutico', REPARTIDOR: 'Repartidor' };

export const Field = ({ label, htmlFor, hint, children }) => (
  <div className="field">
    <label className="field-label" htmlFor={htmlFor}>{label}</label>
    {children}
    {hint && <span className="form-hint">{hint}</span>}
  </div>
);

export const Feedback = ({ feedback }) =>
  feedback ? <div className={`alert-box ${feedback.type}`} role="status">{feedback.message}</div> : null;

export const Badge = ({ tone = '', children }) => <span className={`badge ${tone ? `badge-${tone}` : ''}`}>{children}</span>;

const ESTADO_TONO = {
  completada: 'success', aprobado: 'success', entregado: 'success', completado: 'success',
  pendiente: 'warning', en_ruta: 'info',
  anulada: 'danger', cancelado: 'danger', rechazado: 'danger', reembolsado: 'danger',
};
export const EstadoBadge = ({ estado }) =>
  estado ? <Badge tone={ESTADO_TONO[estado]}>{String(estado).replace('_', ' ')}</Badge> : <span className="form-hint">—</span>;

export const Panel = ({ title, actions, children, className = '' }) => (
  <div className={`panel ${className}`}>
    {(title || actions) && (
      <div className="panel-header">
        <h3>{title}</h3>
        {actions}
      </div>
    )}
    {children}
  </div>
);

export function DataTable({ columns, rows, loading, empty = 'Sin registros.', rowKey = (row) => row.id, renderExpanded }) {
  const [expanded, setExpanded] = useState(null);
  const colSpan = columns.length + (renderExpanded ? 1 : 0);
  return (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            {columns.map((c) => <th key={c.header} className={c.className}>{c.header}</th>)}
            {renderExpanded && <th className="chevron-cell" aria-label="Detalle" />}
          </tr>
        </thead>
        <tbody>
          {loading && rows.length === 0 && Array.from({ length: 4 }).map((_, i) => (
            <tr key={`sk-${i}`} className="skeleton-row">
              {Array.from({ length: colSpan }).map((__, j) => <td key={j}><span className="skeleton-block" /></td>)}
            </tr>
          ))}
          {!loading && rows.length === 0 && (
            <tr><td colSpan={colSpan} className="empty-state">{empty}</td></tr>
          )}
          {rows.map((row) => {
            const key = rowKey(row);
            const isOpen = expanded === key;
            return [
              <tr
                key={key}
                className={renderExpanded ? 'clickable-row' : undefined}
                onClick={renderExpanded ? () => setExpanded(isOpen ? null : key) : undefined}
              >
                {columns.map((c) => <td key={c.header} className={c.className}>{c.render ? c.render(row) : row[c.field]}</td>)}
                {renderExpanded && <td className="chevron-cell">{isOpen ? '▴' : '▾'}</td>}
              </tr>,
              isOpen && (
                <tr key={`${key}-detail`} className="detail-row">
                  <td colSpan={colSpan}>{renderExpanded(row)}</td>
                </tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}

// RNF-04: navegación de páginas de 25 registros.
export function Pagination({ page, totalPages, total, onChange }) {
  if (!total) return null;
  return (
    <div className="pagination">
      <span className="form-hint">{total} registro(s) · página {page} de {totalPages}</span>
      <div className="pagination-buttons">
        <button type="button" className="ghost-btn" disabled={page <= 1} onClick={() => onChange(page - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button>
        <button type="button" className="ghost-btn" disabled={page >= totalPages} onClick={() => onChange(page + 1)} aria-label="Página siguiente"><ChevronRight size={16} /></button>
      </div>
    </div>
  );
}

/** Carga un recurso de la API y expone `reload`. Para listados paginados devuelve {data, page, ...}. */
export function useApi(path, params = {}, { skip = false } = {}) {
  const [state, setState] = useState({ data: null, loading: !skip, error: null });
  const key = JSON.stringify(params);

  const reload = useCallback(async () => {
    if (skip) return;
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await api(path, { params: JSON.parse(key) });
      setState({ data, loading: false, error: null });
    } catch (error) {
      setState({ data: null, loading: false, error: error.message });
    }
  }, [path, key, skip]);

  useEffect(() => { reload(); }, [reload]);
  return { ...state, reload };
}

/** Ejecuta una acción contra la API mostrando el resultado como feedback. */
export function useAction() {
  const [feedback, setFeedback] = useState(null);
  const [busy, setBusy] = useState(false);

  const run = useCallback(async (action, successMessage) => {
    setBusy(true);
    setFeedback(null);
    try {
      const result = await action();
      if (successMessage) setFeedback({ type: 'success', message: typeof successMessage === 'function' ? successMessage(result) : successMessage });
      return result;
    } catch (error) {
      setFeedback({ type: 'danger', message: error.message });
      return null;
    } finally {
      setBusy(false);
    }
  }, []);

  return { feedback, setFeedback, busy, run };
}

// RNF-12: toda acción crítica pide confirmación explícita.
export const confirmar = (mensaje) => window.confirm(mensaje);
