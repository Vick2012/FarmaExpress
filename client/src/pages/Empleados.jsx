import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { Badge, confirmar, DataTable, Feedback, Field, Pagination, Panel, useAction, useApi } from '../ui.jsx';

export default function Empleados() {
  const { catalogos, usuario, cargarCatalogos } = useSession();
  const vacio = {
    nombre: '', correo: '', contrasena: '',
    id_rol: String(catalogos.roles[1]?.id ?? ''), id_sucursal: String(catalogos.sucursales[0]?.id ?? ''), id_tipo_contrato: String(catalogos.tiposContrato[0]?.id ?? ''),
  };
  const [page, setPage] = useState(1);
  const empleados = useApi('/api/empleados', { page });
  const [form, setForm] = useState(vacio);
  const [editando, setEditando] = useState(null);
  const { feedback, busy, run } = useAction();

  const set = (campo) => (e) => setForm({ ...form, [campo]: e.target.value });

  const guardar = async (event) => {
    event.preventDefault();
    const ok = await run(
      () => api(editando ? `/api/empleados/${editando.id}` : '/api/empleados', { method: editando ? 'PUT' : 'POST', body: { ...form, activo: editando?.activo ?? true } }),
      editando ? 'Empleado actualizado.' : 'Empleado registrado. Ya puede iniciar sesión con los permisos de su rol.'
    );
    if (ok) {
      setForm(vacio);
      setEditando(null);
      empleados.reload();
      cargarCatalogos();
    }
  };

  const alternarActivo = async (e) => {
    const accion = e.activo ? 'desactivar' : 'activar';
    if (!confirmar(`¿Seguro que deseas ${accion} a ${e.nombre}?${e.activo ? ' No podrá iniciar sesión.' : ''}`)) return;
    await run(
      () => api(`/api/empleados/${e.id}`, { method: 'PUT', body: { nombre: e.nombre, correo: e.correo, id_rol: e.id_rol, id_sucursal: e.id_sucursal, id_tipo_contrato: e.id_tipo_contrato, activo: !e.activo } }),
      `${e.nombre} ${e.activo ? 'desactivado' : 'activado'}.`
    );
    empleados.reload();
    cargarCatalogos();
  };

  const restablecer = async (e) => {
    const contrasena = window.prompt(`Nueva contraseña para ${e.nombre} (mínimo 8 caracteres, letras y números):`);
    if (!contrasena) return;
    await run(() => api(`/api/empleados/${e.id}/contrasena`, { method: 'PATCH', body: { contrasena } }), 'Contraseña restablecida.');
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-10 · Solo administrador</p>
          <h2>Empleados y accesos</h2>
        </div>
      </header>
      <section className="module-grid">
        <Panel title={editando ? `Editar a ${editando.nombre}` : 'Registrar empleado'}>
          <form className="module-form" onSubmit={guardar}>
            <Feedback feedback={feedback} />
            <Field label="Nombre" htmlFor="emp-nombre"><input id="emp-nombre" value={form.nombre} onChange={set('nombre')} required /></Field>
            <Field label="Correo (usuario de acceso)" htmlFor="emp-correo"><input id="emp-correo" type="email" value={form.correo} onChange={set('correo')} required /></Field>
            {!editando && (
              <Field label="Contraseña inicial" htmlFor="emp-pass" hint="Se guarda cifrada con bcrypt; nunca en texto plano.">
                <input id="emp-pass" type="password" autoComplete="new-password" value={form.contrasena} onChange={set('contrasena')} required minLength={8} />
              </Field>
            )}
            <div className="two-columns">
              <Field label="Rol" htmlFor="emp-rol">
                <select id="emp-rol" value={form.id_rol} onChange={set('id_rol')}>
                  {catalogos.roles.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
                </select>
              </Field>
              <Field label="Sucursal" htmlFor="emp-sucursal">
                <select id="emp-sucursal" value={form.id_sucursal} onChange={set('id_sucursal')}>
                  {catalogos.sucursales.map((s) => <option key={s.id} value={s.id}>{s.nombre}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Tipo de contrato" htmlFor="emp-contrato">
              <select id="emp-contrato" value={form.id_tipo_contrato} onChange={set('id_tipo_contrato')}>
                {catalogos.tiposContrato.map((t) => <option key={t.id} value={t.id}>{t.nombre}</option>)}
              </select>
            </Field>
            <div className="button-row">
              <button className="primary-btn" type="submit" disabled={busy}>{editando ? 'Guardar cambios' : 'Registrar empleado'}</button>
              {editando && <button type="button" className="ghost-btn" onClick={() => { setEditando(null); setForm(vacio); }}>Cancelar</button>}
            </div>
          </form>
        </Panel>

        <Panel title="Equipo">
          <DataTable
            loading={empleados.loading}
            rows={empleados.data?.data ?? []}
            empty="Sin empleados."
            columns={[
              { header: 'Nombre', render: (e) => <>{e.nombre}<br /><span className="form-hint">{e.correo}</span></> },
              { header: 'Rol', field: 'rol' },
              { header: 'Sucursal', field: 'sucursal' },
              { header: 'Contrato', field: 'tipo_contrato' },
              { header: 'Estado', render: (e) => <Badge tone={e.activo ? 'success' : 'danger'}>{e.activo ? 'Activo' : 'Inactivo'}</Badge> },
              {
                header: '',
                render: (e) => (
                  <div className="button-row">
                    <button type="button" className="ghost-btn small" onClick={() => {
                      setEditando(e);
                      setForm({ nombre: e.nombre, correo: e.correo, contrasena: '', id_rol: String(e.id_rol), id_sucursal: String(e.id_sucursal), id_tipo_contrato: String(e.id_tipo_contrato) });
                    }}
                    >Editar</button>
                    <button type="button" className="ghost-btn small" onClick={() => restablecer(e)}>Clave</button>
                    {e.id !== usuario.id && (
                      <button type="button" className={`${e.activo ? 'danger-btn' : 'ghost-btn'} small`} onClick={() => alternarActivo(e)}>{e.activo ? 'Desactivar' : 'Activar'}</button>
                    )}
                  </div>
                ),
              },
            ]}
          />
          <Pagination {...(empleados.data ?? {})} page={page} onChange={setPage} />
        </Panel>
      </section>
    </>
  );
}
