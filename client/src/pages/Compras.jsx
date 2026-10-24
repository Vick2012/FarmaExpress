import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { confirmar, DataTable, Feedback, Field, formatCurrency, formatDate, formatDateTime, Pagination, Panel, useAction, useApi } from '../ui.jsx';

const LINEA_VACIA = { id_producto: '', numero_lote: '', fecha_vencimiento: '', cantidad: '', costo_unitario: '' };

function NuevaCompra({ proveedores, onCreada }) {
  const { catalogos } = useSession();
  const productos = useApi('/api/productos/opciones');
  const [cabecera, setCabecera] = useState({ id_proveedor: '', id_sucursal: String(catalogos.sucursales[0]?.id ?? ''), numero_factura: '' });
  const [lineas, setLineas] = useState([{ ...LINEA_VACIA }]);
  const { feedback, busy, run } = useAction();

  const cambiarLinea = (index, campo, valor) => setLineas((ls) => ls.map((l, i) => {
    if (i !== index) return l;
    const nueva = { ...l, [campo]: valor };
    if (campo === 'id_producto') {
      const producto = productos.data?.find((p) => p.id === Number(valor));
      if (producto && !l.costo_unitario) nueva.costo_unitario = String(producto.costo);
    }
    return nueva;
  }));
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0);

  const registrar = async (event) => {
    event.preventDefault();
    const sucursal = catalogos.sucursales.find((s) => s.id === Number(cabecera.id_sucursal))?.nombre;
    if (!confirmar(`¿Registrar la recepción de ${lineas.length} línea(s) por ${formatCurrency(total)} en ${sucursal}?`)) return;
    const ok = await run(
      () => api('/api/compras', {
        method: 'POST',
        body: {
          ...cabecera,
          id_proveedor: Number(cabecera.id_proveedor),
          id_sucursal: Number(cabecera.id_sucursal),
          items: lineas.map((l) => ({ ...l, id_producto: Number(l.id_producto), cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) })),
        },
      }),
      (c) => `Compra #${c.id} registrada: ${formatCurrency(c.total)}. Stock y ledger actualizados en la misma transacción.`
    );
    if (ok) {
      setLineas([{ ...LINEA_VACIA }]);
      setCabecera({ ...cabecera, numero_factura: '' });
      onCreada();
    }
  };

  return (
    <Panel title="Registrar compra (recepción de mercancía)">
      <form className="module-form" onSubmit={registrar}>
        <Feedback feedback={feedback} />
        <div className="two-columns">
          <Field label="Proveedor" htmlFor="compra-proveedor">
            <select id="compra-proveedor" value={cabecera.id_proveedor} onChange={(e) => setCabecera({ ...cabecera, id_proveedor: e.target.value })} required>
              <option value="">Selecciona…</option>
              {proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}
            </select>
          </Field>
          <Field label="Sucursal que recibe" htmlFor="compra-sucursal">
            <select id="compra-sucursal" value={cabecera.id_sucursal} onChange={(e) => setCabecera({ ...cabecera, id_sucursal: e.target.value })}>
              {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
            </select>
          </Field>
        </div>
        <Field label="Número de factura" htmlFor="compra-factura">
          <input id="compra-factura" value={cabecera.numero_factura} onChange={(e) => setCabecera({ ...cabecera, numero_factura: e.target.value })} />
        </Field>

        {lineas.map((l, i) => (
          <fieldset className="line-box" key={i}>
            <legend>Línea {i + 1}</legend>
            <Field label="Medicamento" htmlFor={`compra-prod-${i}`}>
              <select id={`compra-prod-${i}`} value={l.id_producto} onChange={(e) => cambiarLinea(i, 'id_producto', e.target.value)} required>
                <option value="">Selecciona…</option>
                {(productos.data ?? []).map((p) => <option key={p.id} value={p.id}>{p.nombre_generico} ({p.sku})</option>)}
              </select>
            </Field>
            <div className="two-columns">
              <Field label="Número de lote" htmlFor={`compra-lote-${i}`}>
                <input id={`compra-lote-${i}`} value={l.numero_lote} onChange={(e) => cambiarLinea(i, 'numero_lote', e.target.value)} required />
              </Field>
              <Field label="Vence" htmlFor={`compra-venc-${i}`}>
                <input id={`compra-venc-${i}`} type="date" value={l.fecha_vencimiento} onChange={(e) => cambiarLinea(i, 'fecha_vencimiento', e.target.value)} required />
              </Field>
            </div>
            <div className="two-columns">
              <Field label="Cantidad" htmlFor={`compra-cant-${i}`}>
                <input id={`compra-cant-${i}`} type="number" min="1" value={l.cantidad} onChange={(e) => cambiarLinea(i, 'cantidad', e.target.value)} required />
              </Field>
              <Field label="Costo unitario" htmlFor={`compra-costo-${i}`}>
                <input id={`compra-costo-${i}`} type="number" min="0" value={l.costo_unitario} onChange={(e) => cambiarLinea(i, 'costo_unitario', e.target.value)} required />
              </Field>
            </div>
            {lineas.length > 1 && (
              <button type="button" className="icon-btn" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}><Trash2 size={14} /> Quitar línea</button>
            )}
          </fieldset>
        ))}
        <button type="button" className="ghost-btn" onClick={() => setLineas((ls) => [...ls, { ...LINEA_VACIA }])}><Plus size={14} /> Agregar línea</button>
        <p className="cart-total"><span>Total</span><strong>{formatCurrency(total)}</strong></p>
        <button className="primary-btn" type="submit" disabled={busy}>Registrar compra</button>
      </form>
    </Panel>
  );
}

function Proveedores({ proveedores, onCreado }) {
  const [form, setForm] = useState({ nombre: '', nombre_contacto: '', telefono: '', correo: '', direccion: '' });
  const { feedback, busy, run } = useAction();
  const guardar = async (event) => {
    event.preventDefault();
    const ok = await run(() => api('/api/compras/proveedores', { method: 'POST', body: form }), 'Proveedor registrado.');
    if (ok) {
      setForm({ nombre: '', nombre_contacto: '', telefono: '', correo: '', direccion: '' });
      onCreado();
    }
  };
  return (
    <Panel title="Proveedores">
      <form className="module-form compact" onSubmit={guardar}>
        <Feedback feedback={feedback} />
        <div className="two-columns">
          <Field label="Nombre" htmlFor="prov-nombre"><input id="prov-nombre" value={form.nombre} onChange={(e) => setForm({ ...form, nombre: e.target.value })} required /></Field>
          <Field label="Contacto" htmlFor="prov-contacto"><input id="prov-contacto" value={form.nombre_contacto} onChange={(e) => setForm({ ...form, nombre_contacto: e.target.value })} /></Field>
        </div>
        <div className="two-columns">
          <Field label="Teléfono" htmlFor="prov-tel"><input id="prov-tel" value={form.telefono} onChange={(e) => setForm({ ...form, telefono: e.target.value })} /></Field>
          <Field label="Correo" htmlFor="prov-correo"><input id="prov-correo" type="email" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} /></Field>
        </div>
        <button className="ghost-btn" type="submit" disabled={busy}>Agregar proveedor</button>
      </form>
      <ul className="items-list">
        {proveedores.map((p) => <li key={p.id}><strong>{p.nombre}</strong> · {p.nombre_contacto || 'Sin contacto'} · {p.telefono || '—'}</li>)}
      </ul>
    </Panel>
  );
}

export default function Compras() {
  const [page, setPage] = useState(1);
  const compras = useApi('/api/compras', { page });
  const proveedores = useApi('/api/compras/proveedores');

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-05 · Solo administrador</p>
          <h2>Compras a proveedores</h2>
        </div>
      </header>
      <section className="module-grid">
        <NuevaCompra proveedores={proveedores.data ?? []} onCreada={compras.reload} />
        <div className="stack">
          <Panel title="Compras registradas">
            <DataTable
              loading={compras.loading}
              rows={compras.data?.data ?? []}
              empty="Aún no hay compras."
              columns={[
                { header: '#', render: (c) => `#${c.id}` },
                { header: 'Fecha', render: (c) => formatDateTime(c.fecha_compra) },
                { header: 'Proveedor', field: 'proveedor' },
                { header: 'Sucursal', field: 'sucursal' },
                { header: 'Total', render: (c) => formatCurrency(c.total) },
              ]}
              renderExpanded={(c) => (
                <ul className="items-list">
                  <li className="form-hint">Factura {c.numero_factura || '—'} · registrada por {c.registrado_por}</li>
                  {(c.items ?? []).map((i, idx) => (
                    <li key={idx}>{i.cantidad} × {i.producto} · lote {i.numero_lote} (vence {formatDate(i.fecha_vencimiento)}) — {formatCurrency(i.subtotal)}</li>
                  ))}
                </ul>
              )}
            />
            <Pagination {...(compras.data ?? {})} page={page} onChange={setPage} />
          </Panel>
          <Proveedores proveedores={proveedores.data ?? []} onCreado={proveedores.reload} />
        </div>
      </section>
    </>
  );
}
