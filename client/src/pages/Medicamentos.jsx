import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { Badge, confirmar, DataTable, Feedback, Field, formatCurrency, Pagination, Panel, useAction, useApi } from '../ui.jsx';

const VACIO = {
  nombre_generico: '', presentacion: '', sku: '', id_categoria: '', id_marca: '', precio: '', costo: '',
  requiere_receta: false, control_especial: false, activo: true,
};

export default function Medicamentos() {
  const { catalogos } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const productos = useApi('/api/productos', { page, q });
  const [form, setForm] = useState(VACIO);
  const [editando, setEditando] = useState(null);
  const { feedback, busy, run } = useAction();

  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });

  const guardar = async (event) => {
    event.preventDefault();
    // RNF-12: modificar un medicamento existente pide confirmación.
    if (editando && !confirmar(`¿Guardar los cambios de ${form.nombre_generico}? Las ventas ya registradas conservan su precio original.`)) return;
    const body = { ...form, precio: Number(form.precio), costo: Number(form.costo) };
    const ok = await run(
      () => api(editando ? `/api/productos/${editando}` : '/api/productos', { method: editando ? 'PUT' : 'POST', body }),
      editando ? 'Medicamento actualizado.' : 'Medicamento registrado con stock cero: el inventario entra por compras.'
    );
    if (ok) {
      setForm(VACIO);
      setEditando(null);
      productos.reload();
    }
  };

  const editar = (p) => {
    setEditando(p.id);
    setForm({
      nombre_generico: p.nombre_generico, presentacion: p.presentacion ?? '', sku: p.sku,
      id_categoria: p.id_categoria ?? '', id_marca: p.id_marca ?? '', precio: p.precio, costo: p.costo,
      requiere_receta: p.requiere_receta, control_especial: p.control_especial, activo: p.activo,
    });
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-01</p>
          <h2>Catálogo de medicamentos</h2>
        </div>
      </header>
      <section className="module-grid">
        <Panel title={editando ? 'Editar medicamento' : 'Registrar medicamento'}>
          <form className="module-form" onSubmit={guardar}>
            <Feedback feedback={feedback} />
            <Field label="Nombre genérico" htmlFor="med-nombre">
              <input id="med-nombre" value={form.nombre_generico} onChange={set('nombre_generico')} placeholder="Ej. Acetaminofén 500 mg" required />
            </Field>
            <div className="two-columns">
              <Field label="SKU" htmlFor="med-sku"><input id="med-sku" value={form.sku} onChange={set('sku')} required /></Field>
              <Field label="Presentación" htmlFor="med-presentacion"><input id="med-presentacion" value={form.presentacion} onChange={set('presentacion')} placeholder="Tableta x 20" /></Field>
            </div>
            <div className="two-columns">
              <Field label="Categoría" htmlFor="med-categoria">
                <select id="med-categoria" value={form.id_categoria} onChange={set('id_categoria')}>
                  <option value="">—</option>
                  {catalogos.categorias.map((c) => <option key={c.id} value={c.id}>{c.nombre}</option>)}
                </select>
              </Field>
              <Field label="Marca" htmlFor="med-marca">
                <select id="med-marca" value={form.id_marca} onChange={set('id_marca')}>
                  <option value="">—</option>
                  {catalogos.marcas.map((m) => <option key={m.id} value={m.id}>{m.nombre}</option>)}
                </select>
              </Field>
            </div>
            <div className="two-columns">
              <Field label="Precio de venta" htmlFor="med-precio"><input id="med-precio" type="number" min="0" value={form.precio} onChange={set('precio')} required /></Field>
              <Field label="Costo" htmlFor="med-costo"><input id="med-costo" type="number" min="0" value={form.costo} onChange={set('costo')} required /></Field>
            </div>
            <label className="checkbox-field"><input type="checkbox" checked={form.requiere_receta || form.control_especial} disabled={form.control_especial} onChange={set('requiere_receta')} /> Requiere fórmula médica</label>
            <label className="checkbox-field"><input type="checkbox" checked={form.control_especial} onChange={set('control_especial')} /> Medicamento de control especial (Ley 30/1986)</label>
            {editando && <label className="checkbox-field"><input type="checkbox" checked={form.activo} onChange={set('activo')} /> Activo (se puede vender)</label>}
            <div className="button-row">
              <button className="primary-btn" type="submit" disabled={busy}>{editando ? 'Guardar cambios' : 'Registrar medicamento'}</button>
              {editando && <button type="button" className="ghost-btn" onClick={() => { setEditando(null); setForm(VACIO); }}>Cancelar</button>}
            </div>
          </form>
        </Panel>

        <Panel
          title="Medicamentos"
          actions={<input className="search-input" type="search" placeholder="Buscar nombre o SKU…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Buscar medicamento" />}
        >
          <DataTable
            loading={productos.loading}
            rows={productos.data?.data ?? []}
            empty="No hay medicamentos que coincidan."
            columns={[
              { header: 'Nombre', render: (p) => <>{p.nombre_generico}<br /><span className="form-hint">{p.presentacion} · {p.marca ?? 'Sin marca'}</span></> },
              { header: 'SKU', field: 'sku' },
              { header: 'Precio', render: (p) => formatCurrency(p.precio) },
              { header: 'Stock red', render: (p) => <span className={p.stock_total <= 10 ? 'stock-low' : ''}>{p.stock_total}</span> },
              {
                header: 'Control',
                render: (p) => (
                  <>
                    {p.control_especial ? <Badge tone="danger">Control especial</Badge> : p.requiere_receta ? <Badge tone="warning">Fórmula</Badge> : <span className="form-hint">Libre</span>}
                    {!p.activo && <Badge>Inactivo</Badge>}
                  </>
                ),
              },
              { header: '', render: (p) => <button type="button" className="ghost-btn" onClick={() => editar(p)}>Editar</button> },
            ]}
          />
          <Pagination {...(productos.data ?? {})} page={page} onChange={setPage} />
        </Panel>
      </section>
    </>
  );
}
