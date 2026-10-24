import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { DataTable, EstadoBadge, Feedback, Field, formatCurrency, formatDate, Pagination, Panel, ROLES, useAction, useApi } from '../ui.jsx';

const VACIO = { nombre_completo: '', documento_numero: '', correo: '', telefono: '', direccion: '', id_acudiente: '', id_aseguradora: '' };

function Historial({ idPaciente }) {
  const historial = useApi(`/api/pacientes/${idPaciente}/historial`);
  if (historial.loading) return <span className="form-hint">Cargando historial…</span>;
  if (historial.error) return <span className="form-hint">{historial.error}</span>;
  if (!historial.data?.length) return <span className="form-hint">Sin compras registradas.</span>;
  return (
    <ul className="items-list">
      {historial.data.map((h, i) => (
        <li key={i}>
          {formatDate(h.fecha_venta)} · {h.cantidad} × {h.nombre_generico} {h.presentacion && <span className="form-hint">({h.presentacion}, lote {h.numero_lote})</span>}
          {' '}— {formatCurrency(h.subtotal)} {h.numero_receta && <span className="form-hint">· Rx {h.numero_receta}</span>} <EstadoBadge estado={h.estado} />
        </li>
      ))}
    </ul>
  );
}

export default function Pacientes() {
  const { catalogos, usuario } = useSession();
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const pacientes = useApi('/api/pacientes', { page, q });
  const opciones = useApi('/api/pacientes/opciones');
  const [form, setForm] = useState(VACIO);
  const [editando, setEditando] = useState(null);
  const { feedback, busy, run } = useAction();
  const verHistorial = usuario.rol === ROLES.FARMACEUTICO; // RF-09: exclusivo del farmacéutico

  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });

  const guardar = async (event) => {
    event.preventDefault();
    const ok = await run(
      () => api(editando ? `/api/pacientes/${editando}` : '/api/pacientes', { method: editando ? 'PUT' : 'POST', body: form }),
      editando ? 'Paciente actualizado.' : 'Paciente registrado.'
    );
    if (ok) {
      setForm(VACIO);
      setEditando(null);
      pacientes.reload();
      opciones.reload();
    }
  };

  const editar = (p) => {
    setEditando(p.id);
    setForm({
      nombre_completo: p.nombre_completo, documento_numero: p.documento_numero ?? '', correo: p.correo ?? '', telefono: p.telefono ?? '',
      direccion: p.direccion ?? '', id_acudiente: p.id_acudiente ?? '', id_aseguradora: p.id_aseguradora ?? '',
    });
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-08 · RF-09</p>
          <h2>Pacientes y acudientes</h2>
        </div>
      </header>
      <section className="module-grid">
        <Panel title={editando ? 'Editar paciente' : 'Registrar paciente'}>
          <form className="module-form" onSubmit={guardar}>
            <Feedback feedback={feedback} />
            <Field label="Nombre completo" htmlFor="pac-nombre"><input id="pac-nombre" value={form.nombre_completo} onChange={set('nombre_completo')} required /></Field>
            <div className="two-columns">
              <Field label="Documento" htmlFor="pac-doc"><input id="pac-doc" value={form.documento_numero} onChange={set('documento_numero')} required /></Field>
              <Field label="Teléfono" htmlFor="pac-tel"><input id="pac-tel" value={form.telefono} onChange={set('telefono')} /></Field>
            </div>
            <Field label="Correo" htmlFor="pac-correo"><input id="pac-correo" type="email" value={form.correo} onChange={set('correo')} /></Field>
            <Field label="Dirección" htmlFor="pac-dir"><input id="pac-dir" value={form.direccion} onChange={set('direccion')} /></Field>
            <Field label="Aseguradora (EPS)" htmlFor="pac-eps">
              <select id="pac-eps" value={form.id_aseguradora} onChange={set('id_aseguradora')}>
                <option value="">Sin aseguradora</option>
                {catalogos.aseguradoras.map((a) => <option key={a.id} value={a.id}>{a.nombre}</option>)}
              </select>
            </Field>
            <Field label="Acudiente (familiar responsable)" htmlFor="pac-acudiente">
              <select id="pac-acudiente" value={form.id_acudiente} onChange={set('id_acudiente')}>
                <option value="">Paciente independiente</option>
                {(opciones.data ?? []).filter((p) => p.id !== editando).map((p) => <option key={p.id} value={p.id}>{p.nombre_completo} · {p.documento_numero}</option>)}
              </select>
            </Field>
            <div className="button-row">
              <button className="primary-btn" type="submit" disabled={busy}>{editando ? 'Guardar cambios' : 'Registrar paciente'}</button>
              {editando && <button type="button" className="ghost-btn" onClick={() => { setEditando(null); setForm(VACIO); }}>Cancelar</button>}
            </div>
          </form>
        </Panel>

        <Panel
          title="Pacientes"
          actions={<input className="search-input" type="search" placeholder="Nombre o documento…" value={q} onChange={(e) => { setQ(e.target.value); setPage(1); }} aria-label="Buscar paciente" />}
        >
          <DataTable
            loading={pacientes.loading}
            rows={pacientes.data?.data ?? []}
            empty="No hay pacientes que coincidan."
            columns={[
              { header: 'Nombre', render: (p) => <>{p.nombre_completo}<br /><span className="form-hint">{p.documento_numero}</span></> },
              { header: 'EPS', render: (p) => p.aseguradora || '—' },
              { header: 'Acudiente', render: (p) => p.acudiente || '—' },
              { header: '', render: (p) => <button type="button" className="ghost-btn" onClick={(e) => { e.stopPropagation(); editar(p); }}>Editar</button> },
            ]}
            renderExpanded={verHistorial ? (p) => <Historial idPaciente={p.id} /> : undefined}
          />
          {verHistorial && <p className="form-hint">Haz clic en un paciente para ver su historial de medicamentos.</p>}
          <Pagination {...(pacientes.data ?? {})} page={page} onChange={setPage} />
        </Panel>
      </section>
    </>
  );
}
