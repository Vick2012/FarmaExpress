import { useState } from 'react';
import { api } from '../api.js';
import { useSession } from '../session.js';
import { confirmar, DataTable, EstadoBadge, Feedback, formatCurrency, formatDateTime, Pagination, Panel, ROLES, useAction, useApi } from '../ui.jsx';

export default function Despachos() {
  const { usuario, catalogos } = useSession();
  const [page, setPage] = useState(1);
  const despachos = useApi('/api/despachos', { page });
  const { feedback, run } = useAction();
  const esRepartidor = usuario.rol === ROLES.REPARTIDOR;
  const esFarmaceutico = usuario.rol === ROLES.FARMACEUTICO;

  const asignar = async (d, idEmpleado) => {
    if (!idEmpleado) return;
    await run(() => api(`/api/despachos/${d.id}/asignar`, { method: 'PATCH', body: { id_empleado: Number(idEmpleado) } }), `Repartidor asignado al despacho #${d.id}.`);
    despachos.reload();
  };

  const cambiarEstado = async (d, estado, mensaje) => {
    if (!confirmar(mensaje)) return;
    await run(() => api(`/api/despachos/${d.id}/estado`, { method: 'PATCH', body: { estado } }), `Despacho #${d.id}: ${estado.replace('_', ' ')}.`);
    despachos.reload();
  };

  const acciones = (d) => {
    if (esRepartidor && d.estado === 'pendiente') {
      return <button type="button" className="primary-btn small" onClick={() => cambiarEstado(d, 'en_ruta', `¿Salir a ruta con el pedido de la venta #${d.id_venta}?`)}>Salir a ruta</button>;
    }
    if (esRepartidor && d.estado === 'en_ruta') {
      return <button type="button" className="primary-btn small" onClick={() => cambiarEstado(d, 'entregado', `¿Confirmas que entregaste el pedido en ${d.direccion}?`)}>Marcar entregado</button>;
    }
    if (esFarmaceutico && d.estado === 'pendiente') {
      return (
        <div className="button-row">
          <select value={d.id_empleado ?? ''} onChange={(e) => asignar(d, e.target.value)} aria-label="Asignar repartidor">
            <option value="">Asignar repartidor…</option>
            {catalogos.repartidores.map((r) => <option key={r.id} value={r.id}>{r.nombre}</option>)}
          </select>
          <button type="button" className="danger-btn small" onClick={() => cambiarEstado(d, 'cancelado', `¿Cancelar el despacho #${d.id}?`)}>Cancelar</button>
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">RF-07</p>
          <h2>{esRepartidor ? 'Mis entregas' : 'Despachos a domicilio'}</h2>
        </div>
      </header>
      <Panel>
        <Feedback feedback={feedback} />
        {despachos.error && <div className="alert-box danger">{despachos.error}</div>}
        <DataTable
          loading={despachos.loading}
          rows={despachos.data?.data ?? []}
          empty={esRepartidor ? 'No tienes entregas asignadas.' : 'No hay despachos.'}
          columns={[
            { header: '#', render: (d) => `#${d.id}` },
            { header: 'Paciente', render: (d) => <>{d.paciente || 'Mostrador'}<br /><span className="form-hint">{d.telefono}</span></> },
            { header: 'Dirección', field: 'direccion' },
            { header: 'Programado', render: (d) => formatDateTime(d.fecha_programada) },
            { header: 'Repartidor', render: (d) => d.repartidor || <span className="form-hint">Sin asignar</span> },
            { header: 'Estado', render: (d) => <><EstadoBadge estado={d.estado} />{d.fecha_entrega && <><br /><span className="form-hint">{formatDateTime(d.fecha_entrega)}</span></>}</> },
            { header: 'Venta', render: (d) => <>#{d.id_venta}<br /><span className="form-hint">{formatCurrency(d.total)}</span></> },
            { header: 'Acciones', render: acciones },
          ]}
        />
        <Pagination {...(despachos.data ?? {})} page={page} onChange={setPage} />
      </Panel>
    </>
  );
}
