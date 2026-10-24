import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import {
  Badge, confirmar, DataTable, Feedback, Field, formatDate, formatDateTime, Pagination, Panel, ROLES, useAction, useApi,
} from '../ui.jsx';

function StockCentralizado() {
  const { catalogos } = useSession();
  const [page, setPage] = useState(1);
  const [sucursal, setSucursal] = useState('');
  const [q, setQ] = useState('');
  const stock = useApi('/api/inventario/stock', { page, sucursal, q });

  return (
    <Panel
      title="Stock centralizado (RF-02)"
      actions={(
        <div className="filters">
          <input className="search-input" type="search" placeholder="Buscar…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Buscar medicamento" />
          <select value={sucursal} onChange={(e) => { setSucursal(e.target.value); setPage(1); }} aria-label="Sucursal">
            <option value="">Toda la red</option>
            {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
        </div>
      )}
    >
      {stock.error && <div className="alert-box danger">{stock.error}</div>}
      <DataTable
        loading={stock.loading}
        rows={stock.data?.data ?? []}
        empty="Sin resultados."
        columns={[
          { header: 'Medicamento', render: (p) => <>{p.nombre_generico} {p.control_especial && <Badge tone="danger">Control</Badge>}<br /><span className="form-hint">{p.sku}</span></> },
          { header: 'Unidades', render: (p) => <span className={p.stock - p.stock_vencido <= 10 ? 'stock-low' : ''}>{p.stock}</span> },
          { header: 'Vencidas', render: (p) => (p.stock_vencido ? <span className="stock-low">{p.stock_vencido}</span> : '0') },
          { header: 'Próximo vencimiento', render: (p) => formatDate(p.proximo_vencimiento) },
        ]}
        renderExpanded={(p) => (
          <ul className="items-list">
            {p.por_sucursal.length === 0 && <li>Sin existencias en ninguna sucursal.</li>}
            {p.por_sucursal.map((s) => <li key={s.id_sucursal}>{s.sucursal}: <strong>{s.stock}</strong> unidades</li>)}
          </ul>
        )}
      />
      <Pagination {...(stock.data ?? {})} page={page} onChange={setPage} />
    </Panel>
  );
}

function Lotes({ onAjustar, puedeAjustar }) {
  const { catalogos, usuario } = useSession();
  const [sucursal, setSucursal] = useState(usuario.rol === ROLES.ADMIN ? '' : String(usuario.id_sucursal));
  const lotes = useApi('/api/inventario/lotes', { sucursal });

  return (
    <Panel
      title="Lotes y vencimientos"
      actions={(
        <select value={sucursal} onChange={(e) => setSucursal(e.target.value)} aria-label="Sucursal">
          <option value="">Toda la red</option>
          {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
        </select>
      )}
    >
      <p className="form-hint">Orden FEFO: las ventas y traslados toman primero el lote que vence antes. Los lotes vencidos nunca se despachan.</p>
      <DataTable
        loading={lotes.loading}
        rows={lotes.data ?? []}
        rowKey={(l) => `${l.id_lote}-${l.id_sucursal}`}
        empty="No hay lotes con existencias."
        columns={[
          { header: 'Medicamento', field: 'nombre_generico' },
          { header: 'Lote', field: 'numero_lote' },
          { header: 'Sucursal', field: 'sucursal' },
          { header: 'Stock', field: 'stock' },
          {
            header: 'Vence',
            render: (l) => (
              <>
                {formatDate(l.fecha_vencimiento)}{' '}
                {l.dias_para_vencer <= 0 ? <Badge tone="danger">Vencido</Badge> : l.dias_para_vencer <= 90 ? <Badge tone="warning">{l.dias_para_vencer} d</Badge> : null}
              </>
            ),
          },
          ...(puedeAjustar ? [{ header: '', render: (l) => <button type="button" className="ghost-btn" onClick={() => onAjustar(l)}>Ajustar</button> }] : []),
        ]}
      />
    </Panel>
  );
}

function Ajuste({ lote, onCerrar }) {
  const [form, setForm] = useState({ cantidad: '', nota: '' });
  const { feedback, busy, run } = useAction();

  const guardar = async (event) => {
    event.preventDefault();
    const cantidad = Number(form.cantidad);
    if (!confirmar(`¿Registrar un ajuste de ${cantidad > 0 ? '+' : ''}${cantidad} unidades al lote ${lote.numero_lote} en ${lote.sucursal}?\nEl movimiento quedará en el ledger y no se podrá borrar.`)) return;
    const r = await run(
      () => api('/api/inventario/ajustes', { method: 'POST', body: { id_lote: lote.id_lote, id_sucursal: lote.id_sucursal, cantidad, nota: form.nota } }),
      (res) => `Ajuste registrado. Stock resultante: ${res.stock_resultante}.`
    );
    if (r) setForm({ cantidad: '', nota: '' });
  };

  return (
    <Panel title={`Ajuste manual · ${lote.nombre_generico} (lote ${lote.numero_lote}, ${lote.sucursal})`} actions={<button type="button" className="ghost-btn" onClick={onCerrar}>Cerrar</button>}>
      <form className="module-form" onSubmit={guardar}>
        <Feedback feedback={feedback} />
        <p className="form-hint">Stock actual: {lote.stock}. Usa valores negativos para mermas o daños.</p>
        <Field label="Cantidad (+ entrada / − salida)" htmlFor="ajuste-cantidad">
          <input id="ajuste-cantidad" type="number" value={form.cantidad} onChange={(e) => setForm({ ...form, cantidad: e.target.value })} required />
        </Field>
        <Field label="Motivo" htmlFor="ajuste-nota">
          <input id="ajuste-nota" value={form.nota} onChange={(e) => setForm({ ...form, nota: e.target.value })} placeholder="Ej. Conteo físico, empaque dañado" required minLength={5} />
        </Field>
        <button className="primary-btn" type="submit" disabled={busy}>Registrar ajuste</button>
      </form>
    </Panel>
  );
}

function Ledger() {
  const { catalogos } = useSession();
  const [page, setPage] = useState(1);
  const [filtros, setFiltros] = useState({ sucursal: '', desde: '', hasta: '' });
  const movimientos = useApi('/api/inventario/movimientos', { page, ...filtros });
  const cambiar = (campo) => (e) => { setFiltros({ ...filtros, [campo]: e.target.value }); setPage(1); };

  return (
    <Panel
      title="Ledger de movimientos (RF-03)"
      actions={(
        <div className="filters">
          <select value={filtros.sucursal} onChange={cambiar('sucursal')} aria-label="Sucursal">
            <option value="">Todas</option>
            {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
          </select>
          <input type="date" value={filtros.desde} onChange={cambiar('desde')} aria-label="Desde" />
          <input type="date" value={filtros.hasta} onChange={cambiar('hasta')} aria-label="Hasta" />
        </div>
      )}
    >
      <p className="form-hint">Registro inalterable (RNF-21): un trigger de PostgreSQL bloquea cualquier UPDATE o DELETE.</p>
      <DataTable
        loading={movimientos.loading}
        rows={movimientos.data?.data ?? []}
        empty="Sin movimientos para el filtro."
        columns={[
          { header: 'Fecha', render: (m) => formatDateTime(m.fecha_creacion) },
          { header: 'Tipo', render: (m) => <Badge tone={m.cantidad > 0 ? 'success' : 'danger'}>{m.tipo.replace('_', ' ')}</Badge> },
          { header: 'Medicamento / lote', render: (m) => <>{m.nombre_generico}<br /><span className="form-hint">{m.numero_lote}</span></> },
          { header: 'Sucursal', field: 'sucursal' },
          { header: 'Cant.', render: (m) => <strong className={m.cantidad < 0 ? 'stock-low' : 'stock-ok'}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</strong> },
          { header: 'Referencia', render: (m) => (m.tipo_referencia ? `${m.tipo_referencia}${m.id_referencia ? ` #${m.id_referencia}` : ''}` : '—') },
          { header: 'Responsable', render: (m) => <>{m.responsable}{m.nota && <><br /><span className="form-hint">{m.nota}</span></>}</> },
        ]}
      />
      <Pagination {...(movimientos.data ?? {})} page={page} onChange={setPage} />
    </Panel>
  );
}

export default function Inventario() {
  const { usuario } = useSession();
  const auditor = usuario.rol !== ROLES.REPARTIDOR;
  const [vista, setVista] = useState('stock');
  const [lote, setLote] = useState(null);

  const vistas = [
    ['stock', 'Stock centralizado'],
    ['lotes', 'Lotes y vencimientos'],
    ...(auditor ? [['ledger', 'Ledger de movimientos']] : []),
  ];

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-02 · RF-03</p>
          <h2>Inventario multi-sucursal</h2>
        </div>
        <div className="tabs" role="tablist">
          {vistas.map(([key, label]) => (
            <button key={key} type="button" role="tab" aria-selected={vista === key} className={`tab ${vista === key ? 'active' : ''}`} onClick={() => { setVista(key); setLote(null); }}>{label}</button>
          ))}
        </div>
      </header>
      {vista === 'stock' && <StockCentralizado />}
      {vista === 'lotes' && (
        <div className="stack">
          {lote && <Ajuste lote={lote} onCerrar={() => setLote(null)} />}
          <Lotes key={lote ? 'con-ajuste' : 'sin-ajuste'} onAjustar={setLote} puedeAjustar={auditor} />
        </div>
      )}
      {vista === 'ledger' && <Ledger />}
    </>
  );
}
