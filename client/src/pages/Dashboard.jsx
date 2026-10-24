import { AlertTriangle, ArrowLeftRight, CalendarClock, DollarSign, Package, Truck, Users } from 'lucide-react';
import { ChartCard, PaymentMethodsChart, SalesTrendChart, TopProductsChart } from '../charts.jsx';
import { useSession } from '../session.js';
import { DataTable, formatCurrency, formatDate, Panel, ROLES, useApi } from '../ui.jsx';

export default function Dashboard() {
  const { usuario } = useSession();
  const { data, loading, error } = useApi('/api/dashboard');
  const alertas = useApi('/api/inventario/alertas');
  const r = data?.resumen ?? {};

  const tarjetas = [
    { label: 'Ventas de hoy', value: formatCurrency(r.ventas_hoy), tone: 'green', icon: DollarSign },
    { label: 'Ventas del mes', value: formatCurrency(r.ventas_mes), tone: 'green', icon: DollarSign },
    { label: 'Lotes por vencer (90 días)', value: r.lotes_por_vencer ?? '—', tone: 'red', icon: CalendarClock },
    { label: 'Despachos activos', value: r.despachos_activos ?? '—', tone: 'blue', icon: Truck },
    { label: 'Traslados pendientes', value: r.traslados_pendientes ?? '—', tone: 'purple', icon: ArrowLeftRight },
    { label: 'Medicamentos activos', value: r.productos ?? '—', tone: 'blue', icon: Package },
    { label: 'Pacientes', value: r.pacientes ?? '—', tone: 'purple', icon: Users },
  ];

  return (
    <>
      <header className="topbar">
        <div>
          <p className="eyebrow">{usuario.rol === ROLES.ADMIN ? 'Toda la red' : usuario.sucursal}</p>
          <h2>Hola, {usuario.nombre.split(' ')[0]}</h2>
        </div>
      </header>

      {error && <div className="alert-box danger">{error}</div>}

      <section className="stats-grid">
        {tarjetas.map(({ label, value, tone, icon: Icon }) => (
          <article className={`stat-card ${tone}`} key={label}>
            <div className="stat-header">
              <span>{label}</span>
              <div className="stat-icon"><Icon size={18} /></div>
            </div>
            <strong>{loading ? '…' : value}</strong>
          </article>
        ))}
      </section>

      {data && (
        <section className="charts-grid">
          <ChartCard title="Ventas — últimos 14 días" subtitle="Ventas completadas (las anuladas no suman)">
            <SalesTrendChart data={data.salesTimeseries} />
          </ChartCard>
          <div className="charts-grid-secondary">
            <ChartCard title="Medicamentos más vendidos" subtitle="Top 5 por unidades">
              <TopProductsChart data={data.topProducts} />
            </ChartCard>
            <ChartCard title="Pagos aprobados por método" subtitle="Total cobrado por método">
              <PaymentMethodsChart data={data.paymentMethods} />
            </ChartCard>
          </div>
        </section>
      )}

      <section className="module-grid">
        <Panel title={<><AlertTriangle size={16} /> Vencimientos próximos</>}>
          <DataTable
            loading={alertas.loading}
            rows={alertas.data?.vencimientos ?? []}
            rowKey={(row) => `${row.id_lote}-${row.sucursal}`}
            empty="No hay lotes por vencer en los próximos 90 días."
            columns={[
              { header: 'Medicamento', field: 'nombre_generico' },
              { header: 'Lote', field: 'numero_lote' },
              { header: 'Sucursal', field: 'sucursal' },
              { header: 'Stock', field: 'stock' },
              {
                header: 'Vence',
                render: (row) => (
                  <span className={row.dias_para_vencer <= 0 ? 'stock-low' : ''}>
                    {formatDate(row.fecha_vencimiento)} {row.dias_para_vencer <= 0 ? '(vencido)' : `(${row.dias_para_vencer} d)`}
                  </span>
                ),
              },
            ]}
          />
        </Panel>
        <Panel title={<><AlertTriangle size={16} /> Stock bajo por sucursal</>}>
          <DataTable
            loading={alertas.loading}
            rows={alertas.data?.stockBajo ?? []}
            rowKey={(row) => `${row.id}-${row.sucursal}`}
            empty="Ningún medicamento por debajo de 10 unidades vendibles."
            columns={[
              { header: 'Medicamento', field: 'nombre_generico' },
              { header: 'Sucursal', field: 'sucursal' },
              { header: 'Unidades vendibles', render: (row) => <span className="stock-low">{row.stock}</span> },
            ]}
          />
        </Panel>
      </section>
    </>
  );
}
