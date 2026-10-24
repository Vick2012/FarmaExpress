import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { confirmar, DataTable, EstadoBadge, Feedback, Field, formatDate, formatDateTime, Pagination, Panel, ROLES, useAction, useApi } from '../ui.jsx';

function NuevoTraslado({ onCreado }) {
  const { catalogos, usuario } = useSession();
  const esAdmin = usuario.rol === ROLES.ADMIN;
  const [origen, setOrigen] = useState(String(usuario.id_sucursal));
  const [destino, setDestino] = useState('');
  const productos = useApi('/api/productos/opciones', { sucursal: origen });
  const [items, setItems] = useState([]);
  const [linea, setLinea] = useState({ id_producto: '', cantidad: '1' });
  const { feedback, setFeedback, busy, run } = useAction();

  const porId = new Map((productos.data ?? []).map((p) => [p.id, p]));

  const agregar = () => {
    const producto = porId.get(Number(linea.id_producto));
    const cantidad = Number(linea.cantidad);
    if (!producto || !(cantidad > 0)) return;
    if (cantidad > producto.stock_disponible) {
      setFeedback({ type: 'danger', message: `El origen solo tiene ${producto.stock_disponible} unidades vendibles.` });
      return;
    }
    setFeedback(null);
    setItems((it) => [...it.filter((i) => i.id_producto !== producto.id), { id_producto: producto.id, cantidad }]);
    setLinea({ id_producto: '', cantidad: '1' });
  };

  const crear = async (event) => {
    event.preventDefault();
    const nombre = (id) => catalogos.sucursales.find((s) => s.id === Number(id))?.nombre;
    if (!confirmar(`¿Enviar ${items.length} producto(s) de ${nombre(origen)} a ${nombre(destino)}?\nEl stock se descuenta del origen ahora y se suma en el destino cuando confirmen la recepción.`)) return;
    const ok = await run(
      () => api('/api/traslados', { method: 'POST', body: { id_sucursal_origen: Number(origen), id_sucursal_destino: Number(destino), items } }),
      (t) => `Traslado #${t.id} creado: mercancía en tránsito (pendiente).`
    );
    productos.reload();
    if (ok) {
      setItems([]);
      onCreado();
    }
  };

  return (
    <Panel title="Solicitar traslado">
      <form className="module-form" onSubmit={crear}>
        <Feedback feedback={feedback} />
        <div className="two-columns">
          <Field label="Origen" htmlFor="tras-origen">
            <select id="tras-origen" value={origen} onChange={(e) => { setOrigen(e.target.value); setItems([]); }} disabled={!esAdmin}>
              {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Field>
          <Field label="Destino" htmlFor="tras-destino">
            <select id="tras-destino" value={destino} onChange={(e) => setDestino(e.target.value)} required>
              <option value="">Selecciona…</option>
              {catalogos.sucursales.filter((s) => String(s.id) !== origen).map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Field>
        </div>
        <div className="cart-line">
          <Field label="Medicamento" htmlFor="tras-producto">
            <select id="tras-producto" value={linea.id_producto} onChange={(e) => setLinea({ ...linea, id_producto: e.target.value })}>
              <option value="">Selecciona…</option>
              {(productos.data ?? []).filter((p) => p.stock_disponible > 0).map((p) => <option key={p.id} value={p.id}>{p.nombre_generico} · {p.stock_disponible} disp.</option>)}
            </select>
          </Field>
          <Field label="Cant." htmlFor="tras-cantidad">
            <input id="tras-cantidad" type="number" min="1" value={linea.cantidad} onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })} />
          </Field>
          <button type="button" className="ghost-btn add-btn" onClick={agregar} aria-label="Agregar"><Plus size={16} /></button>
        </div>
        {items.length > 0 && (
          <ul className="cart-list">
            {items.map((i) => (
              <li key={i.id_producto}>
                <span>{i.cantidad} × {porId.get(i.id_producto)?.nombre_generico}</span>
                <button type="button" className="icon-btn" onClick={() => setItems((it) => it.filter((x) => x.id_producto !== i.id_producto))} aria-label="Quitar"><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
        )}
        <button className="primary-btn" type="submit" disabled={busy || items.length === 0 || !destino}>Crear traslado</button>
      </form>
    </Panel>
  );
}

export default function Traslados() {
  const { usuario } = useSession();
  const [page, setPage] = useState(1);
  const traslados = useApi('/api/traslados', { page });
  const { feedback, run } = useAction();
  const esAdmin = usuario.rol === ROLES.ADMIN;

  const confirmarRecepcion = async (t) => {
    if (!confirmar(`¿Confirmas que recibiste físicamente el traslado #${t.id} de ${t.origen}? El stock se sumará en ${t.destino}.`)) return;
    await run(() => api(`/api/traslados/${t.id}/confirmar`, { method: 'POST' }), `Traslado #${t.id} completado.`);
    traslados.reload();
  };
  const cancelar = async (t) => {
    if (!confirmar(`¿Cancelar el traslado #${t.id}? La mercancía vuelve al stock de ${t.origen}.`)) return;
    await run(() => api(`/api/traslados/${t.id}/cancelar`, { method: 'POST' }), `Traslado #${t.id} cancelado.`);
    traslados.reload();
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-04 · Logística multi-sucursal</p>
          <h2>Traslados de inventario</h2>
        </div>
      </header>
      <section className="module-grid">
        <NuevoTraslado onCreado={traslados.reload} />
        <Panel title="Traslados">
          <Feedback feedback={feedback} />
          <DataTable
            loading={traslados.loading}
            rows={traslados.data?.data ?? []}
            empty="No hay traslados."
            columns={[
              { header: '#', render: (t) => `#${t.id}` },
              { header: 'Ruta', render: (t) => <>{t.origen} → {t.destino}</> },
              { header: 'Fecha', render: (t) => formatDateTime(t.fecha_traslado) },
              { header: 'Estado', render: (t) => <EstadoBadge estado={t.estado} /> },
            ]}
            renderExpanded={(t) => (
              <div className="detail-grid">
                <ul className="items-list">
                  {(t.items ?? []).map((i, idx) => <li key={idx}>{i.cantidad} × {i.producto} · lote {i.numero_lote} (vence {formatDate(i.fecha_vencimiento)})</li>)}
                </ul>
                <p className="form-hint">
                  Solicitó: {t.solicitado_por}
                  {t.recibido_por && <> · Recibió: {t.recibido_por} el {formatDateTime(t.fecha_recepcion)}</>}
                </p>
                {t.estado === 'pendiente' && (
                  <div className="button-row">
                    {(esAdmin || t.id_sucursal_destino === usuario.id_sucursal) && <button type="button" className="primary-btn small" onClick={() => confirmarRecepcion(t)}>Confirmar recepción</button>}
                    {(esAdmin || t.id_sucursal_origen === usuario.id_sucursal) && <button type="button" className="danger-btn small" onClick={() => cancelar(t)}>Cancelar traslado</button>}
                  </div>
                )}
              </div>
            )}
          />
          <Pagination {...(traslados.data ?? {})} page={page} onChange={setPage} />
        </Panel>
      </section>
    </>
  );
}
