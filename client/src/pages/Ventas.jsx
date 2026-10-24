import { useMemo, useState } from 'react';
import { Plus, ShieldAlert, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import {
  Badge, confirmar, DataTable, EstadoBadge, Feedback, Field, formatCurrency, formatDateTime, Pagination, Panel, ROLES, useAction, useApi,
} from '../ui.jsx';

const VENTA_VACIA = { id_paciente: '', id_metodo_pago: '', numero_receta: '', direccion: '', fecha_programada: '', simular: false };

function NuevaVenta({ onCreada }) {
  const { catalogos, usuario } = useSession();
  const productos = useApi('/api/productos/opciones');
  const pacientes = useApi('/api/pacientes/opciones');
  const [venta, setVenta] = useState({ ...VENTA_VACIA, id_metodo_pago: String(catalogos.metodosPago[0]?.id ?? '') });
  const [carrito, setCarrito] = useState([]);
  const [linea, setLinea] = useState({ id_producto: '', cantidad: '1' });
  const { feedback, setFeedback, busy, run } = useAction();

  const porId = useMemo(() => new Map((productos.data ?? []).map((p) => [p.id, p])), [productos.data]);
  const lineas = carrito.map((l) => ({ ...l, producto: porId.get(l.id_producto) })).filter((l) => l.producto);
  const total = lineas.reduce((s, l) => s + l.producto.precio * l.cantidad, 0);
  const exigeReceta = lineas.some((l) => l.producto.requiere_receta || l.producto.control_especial);
  const tieneControl = lineas.some((l) => l.producto.control_especial);

  const agregar = () => {
    const idProducto = Number(linea.id_producto);
    const cantidad = Number(linea.cantidad);
    const producto = porId.get(idProducto);
    if (!producto || !(cantidad > 0)) return;
    const yaEnCarrito = carrito.find((l) => l.id_producto === idProducto)?.cantidad ?? 0;
    if (yaEnCarrito + cantidad > producto.stock_disponible) {
      setFeedback({ type: 'danger', message: `Solo hay ${producto.stock_disponible} unidades vendibles de ${producto.nombre_generico}.` });
      return;
    }
    setFeedback(null);
    setCarrito((c) => (yaEnCarrito
      ? c.map((l) => (l.id_producto === idProducto ? { ...l, cantidad: l.cantidad + cantidad } : l))
      : [...c, { id_producto: idProducto, cantidad }]));
    setLinea({ id_producto: '', cantidad: '1' });
  };

  const registrar = async (event) => {
    event.preventDefault();
    if (lineas.length === 0) {
      setFeedback({ type: 'danger', message: 'Agrega al menos un medicamento a la venta.' });
      return;
    }
    const creada = await run(
      () => api('/api/ventas', {
        method: 'POST',
        body: {
          id_paciente: venta.id_paciente ? Number(venta.id_paciente) : null,
          id_metodo_pago: Number(venta.id_metodo_pago),
          numero_receta: venta.numero_receta,
          items: carrito,
          despacho: venta.direccion ? { direccion: venta.direccion, fecha_programada: venta.fecha_programada || null } : null,
          simular_pago_rechazado: venta.simular,
        },
      }),
      (v) => `Venta #${v.id} registrada por ${formatCurrency(v.total)}. Stock descontado con FEFO de ${v.items.length} lote(s).`
    );
    // Tras un rollback simulado o real, el stock se recarga para mostrar
    // que no cambió.
    productos.reload();
    if (creada) {
      setCarrito([]);
      setVenta({ ...VENTA_VACIA, id_metodo_pago: venta.id_metodo_pago });
      onCreada();
    }
  };

  const seleccionado = porId.get(Number(linea.id_producto));

  return (
    <Panel title={`Nueva venta · ${usuario.sucursal}`}>
      <form className="module-form" onSubmit={registrar}>
        <Feedback feedback={feedback} />

        <div className="cart-line">
          <Field label="Medicamento" htmlFor="venta-producto">
            <select id="venta-producto" value={linea.id_producto} onChange={(e) => setLinea({ ...linea, id_producto: e.target.value })}>
              <option value="">Selecciona…</option>
              {(productos.data ?? []).map((p) => (
                <option key={p.id} value={p.id} disabled={p.stock_disponible === 0}>
                  {p.nombre_generico} — {formatCurrency(p.precio)} · {p.stock_disponible} disp.{p.control_especial ? ' · CONTROL' : p.requiere_receta ? ' · Rx' : ''}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Cant." htmlFor="venta-cantidad">
            <input id="venta-cantidad" type="number" min="1" value={linea.cantidad} onChange={(e) => setLinea({ ...linea, cantidad: e.target.value })} />
          </Field>
          <button type="button" className="ghost-btn add-btn" onClick={agregar} disabled={!seleccionado} aria-label="Agregar al carrito"><Plus size={16} /></button>
        </div>

        {lineas.length > 0 && (
          <ul className="cart-list">
            {lineas.map((l) => (
              <li key={l.id_producto}>
                <span>
                  {l.cantidad} × {l.producto.nombre_generico}
                  {l.producto.control_especial && <Badge tone="danger">Control especial</Badge>}
                  {!l.producto.control_especial && l.producto.requiere_receta && <Badge tone="warning">Requiere fórmula</Badge>}
                </span>
                <span className="cart-amount">
                  {formatCurrency(l.producto.precio * l.cantidad)}
                  <button type="button" className="icon-btn" onClick={() => setCarrito((c) => c.filter((x) => x.id_producto !== l.id_producto))} aria-label="Quitar"><Trash2 size={14} /></button>
                </span>
              </li>
            ))}
            <li className="cart-total"><span>Total (calculado por el servidor)</span><strong>{formatCurrency(total)}</strong></li>
          </ul>
        )}

        <Field label={tieneControl ? 'Paciente (obligatorio: control especial)' : 'Paciente'} htmlFor="venta-paciente">
          <select id="venta-paciente" value={venta.id_paciente} onChange={(e) => setVenta({ ...venta, id_paciente: e.target.value })} required={tieneControl}>
            <option value="">Venta de mostrador (sin paciente)</option>
            {(pacientes.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre_completo} · {p.documento_numero}</option>)}
          </select>
        </Field>

        {exigeReceta && (
          <Field label="Número de fórmula médica" htmlFor="venta-receta" hint="Obligatorio (Res. 1478/2006). Sin él, la transacción se rechaza completa.">
            <input id="venta-receta" value={venta.numero_receta} onChange={(e) => setVenta({ ...venta, numero_receta: e.target.value })} placeholder="Ej. RX-000123" required />
          </Field>
        )}

        <Field label="Método de pago" htmlFor="venta-metodo">
          <select id="venta-metodo" value={venta.id_metodo_pago} onChange={(e) => setVenta({ ...venta, id_metodo_pago: e.target.value })}>
            {catalogos.metodosPago.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
          </select>
        </Field>

        <Field label="Dirección de entrega (opcional, crea un despacho)" htmlFor="venta-direccion">
          <input id="venta-direccion" value={venta.direccion} onChange={(e) => setVenta({ ...venta, direccion: e.target.value })} placeholder="Vacío si el paciente se lleva el pedido" />
        </Field>
        {venta.direccion && (
          <Field label="Fecha programada de entrega" htmlFor="venta-fecha">
            <input id="venta-fecha" type="datetime-local" value={venta.fecha_programada} onChange={(e) => setVenta({ ...venta, fecha_programada: e.target.value })} />
          </Field>
        )}

        <label className="checkbox-field demo-toggle">
          <input type="checkbox" checked={venta.simular} onChange={(e) => setVenta({ ...venta, simular: e.target.checked })} />
          <ShieldAlert size={14} /> Demostración: simular pago rechazado (fuerza ROLLBACK)
        </label>

        <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Procesando transacción…' : `Cobrar ${formatCurrency(total)}`}</button>
      </form>
    </Panel>
  );
}

export default function Ventas() {
  const { usuario } = useSession();
  const [page, setPage] = useState(1);
  const ventas = useApi('/api/ventas', { page });
  const { feedback, run } = useAction();
  const puedeVender = usuario.rol === ROLES.FARMACEUTICO;

  const anular = async (venta) => {
    if (!confirmar(`¿Anular la venta #${venta.id} por ${formatCurrency(venta.total)}?\n\nSe devolverá el stock a sus lotes, se reembolsará el pago y se cancelará el despacho pendiente. Esta acción queda registrada en el ledger.`)) return;
    const motivo = window.prompt('Motivo de la anulación (obligatorio):');
    if (!motivo) return;
    await run(() => api(`/api/ventas/${venta.id}/anular`, { method: 'POST', body: { motivo } }), (r) => `Venta #${r.id} anulada: ${r.unidades_devueltas} unidad(es) devueltas al inventario.`);
    ventas.reload();
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-06 · Transacción atómica</p>
          <h2>Ventas y pagos</h2>
        </div>
      </header>
      <section className={puedeVender ? 'module-grid' : ''}>
        {puedeVender && <NuevaVenta onCreada={ventas.reload} />}
        <Panel title={usuario.rol === ROLES.ADMIN ? 'Ventas de la red' : 'Ventas de la sucursal'}>
          <Feedback feedback={feedback} />
          {ventas.error && <div className="alert-box danger">{ventas.error}</div>}
          <DataTable
            loading={ventas.loading}
            rows={ventas.data?.data ?? []}
            empty="Aún no hay ventas."
            columns={[
              { header: '#', render: (v) => `#${v.id}` },
              { header: 'Fecha', render: (v) => formatDateTime(v.fecha_venta) },
              { header: 'Paciente', render: (v) => v.paciente || <span className="form-hint">Mostrador</span> },
              { header: 'Total', render: (v) => formatCurrency(v.total) },
              { header: 'Estado', render: (v) => <EstadoBadge estado={v.estado} /> },
            ]}
            renderExpanded={(v) => (
              <div className="detail-grid">
                <ul className="items-list">
                  {(v.items ?? []).map((i, idx) => (
                    <li key={idx}>{i.cantidad} × {i.producto} <span className="form-hint">(lote {i.numero_lote})</span> — {formatCurrency(i.subtotal)}</li>
                  ))}
                </ul>
                <p className="form-hint">
                  {v.sucursal} · Vendió: {v.vendedor} · Pago: {v.metodo_pago} <EstadoBadge estado={v.estado_pago} />
                  {v.numero_receta && <> · Fórmula: <strong>{v.numero_receta}</strong></>}
                  {v.estado_despacho && <> · Despacho: <EstadoBadge estado={v.estado_despacho} /></>}
                </p>
                {v.estado === 'completada' && usuario.rol !== ROLES.REPARTIDOR && (
                  <button type="button" className="danger-btn" onClick={() => anular(v)}>Anular venta</button>
                )}
              </div>
            )}
          />
          <Pagination {...(ventas.data ?? {})} page={page} onChange={setPage} />
        </Panel>
      </section>
    </>
  );
}
