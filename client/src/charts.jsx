import { useEffect, useRef, useState } from 'react';

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(value || 0);

const formatNumber = (value) =>
  new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 }).format(value || 0);

const formatDayLabel = (isoDay) => {
  const date = new Date(`${isoDay}T00:00:00`);
  if (Number.isNaN(date.getTime())) return isoDay;
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short' });
};

// Redondea el techo del eje Y a un número "limpio" (1/2/5 × 10^n) para que
// las líneas de referencia terminen en valores legibles en vez de fracciones raras.
const niceMax = (value) => {
  if (!value || value <= 0) return 100;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  let niceNormalized = 10;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  return niceNormalized * magnitude;
};

export function ChartCard({ title, subtitle, children }) {
  return (
    <div className="panel chart-card">
      <div className="panel-header">
        <div>
          <h3>{title}</h3>
          {subtitle && <p className="form-hint">{subtitle}</p>}
        </div>
      </div>
      {children}
    </div>
  );
}

const CHART_HEIGHT = 200;
const CHART_MIN_WIDTH = 320;

export function SalesTrendChart({ data }) {
  const wrapperRef = useRef(null);
  const [width, setWidth] = useState(CHART_MIN_WIDTH);
  const [hoverIndex, setHoverIndex] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // El SVG se dibuja en píxeles reales del contenedor (medidos con ResizeObserver),
  // no escalado por CSS — así el alto queda fijo sin importar cuán ancha sea la pantalla.
  useEffect(() => {
    const el = wrapperRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) setWidth(Math.max(CHART_MIN_WIDTH, Math.round(entry.contentRect.width)));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  if (!data || data.length === 0) {
    return <p className="form-hint">Aún no hay datos de ventas para graficar.</p>;
  }

  const height = CHART_HEIGHT;
  const padding = { top: 20, right: 16, bottom: 26, left: 60 };
  const innerWidth = Math.max(width - padding.left - padding.right, 10);
  const innerHeight = height - padding.top - padding.bottom;

  const values = data.map((point) => point.total);
  const maxValue = niceMax(Math.max(...values, 0));
  const stepX = data.length > 1 ? innerWidth / (data.length - 1) : 0;

  const pointAt = (index) => ({
    x: padding.left + stepX * index,
    y: padding.top + innerHeight - (values[index] / maxValue) * innerHeight,
  });

  const linePath = data
    .map((_, index) => {
      const { x, y } = pointAt(index);
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(' ');

  const baseY = (padding.top + innerHeight).toFixed(1);
  const lastX = pointAt(data.length - 1).x.toFixed(1);
  const areaPath = `${linePath} L ${lastX} ${baseY} L ${padding.left.toFixed(1)} ${baseY} Z`;

  const gridFractions = [0, 0.25, 0.5, 0.75, 1];
  const lastPoint = pointAt(data.length - 1);

  // Máximo ~5 etiquetas en el eje X para que no se amontonen los textos.
  const labelEvery = Math.max(1, Math.ceil(data.length / 5));

  const handleMove = (index, event) => {
    const bounds = wrapperRef.current?.getBoundingClientRect();
    if (!bounds) return;
    setHoverIndex(index);
    setTooltipPos({ x: event.clientX - bounds.left, y: event.clientY - bounds.top });
  };

  return (
    <div className="chart-wrapper" ref={wrapperRef}>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="chart-svg"
        role="img"
        aria-label="Ventas de los últimos 14 días"
      >
        {gridFractions.map((fraction) => {
          const y = padding.top + innerHeight * (1 - fraction);
          const value = maxValue * fraction;
          return (
            <g key={fraction}>
              <line x1={padding.left} x2={width - padding.right} y1={y} y2={y} className="chart-grid-line" />
              <text x={padding.left - 10} y={y} textAnchor="end" dominantBaseline="middle" className="chart-axis-label">
                {formatNumber(value)}
              </text>
            </g>
          );
        })}

        <path d={areaPath} className="chart-area" />
        <path d={linePath} className="chart-line" />

        <circle cx={lastPoint.x} cy={lastPoint.y} r="5" className="chart-marker" />

        {hoverIndex !== null && (
          <>
            <line
              x1={pointAt(hoverIndex).x}
              x2={pointAt(hoverIndex).x}
              y1={padding.top}
              y2={padding.top + innerHeight}
              className="chart-crosshair"
            />
            <circle cx={pointAt(hoverIndex).x} cy={pointAt(hoverIndex).y} r="5" className="chart-marker chart-marker-active" />
          </>
        )}

        <text x={lastPoint.x} y={lastPoint.y - 12} textAnchor="end" className="chart-end-label">
          {formatCurrency(data[data.length - 1].total)}
        </text>

        {data.map((point, index) => (
          (index % labelEvery === 0 || index === data.length - 1) && (
            <text key={`x-${point.day}`} x={pointAt(index).x} y={height - 6} textAnchor="middle" className="chart-axis-label">
              {formatDayLabel(point.day)}
            </text>
          )
        ))}

        {data.map((point, index) => {
          const { x } = pointAt(index);
          return (
            <rect
              key={point.day}
              x={x - (stepX || innerWidth) / 2}
              y={padding.top}
              width={stepX || innerWidth}
              height={innerHeight}
              fill="transparent"
              onMouseMove={(event) => handleMove(index, event)}
              onMouseLeave={() => setHoverIndex(null)}
              onFocus={() => setHoverIndex(index)}
              tabIndex={0}
              aria-label={`${formatDayLabel(point.day)}: ${formatCurrency(point.total)}`}
            />
          );
        })}
      </svg>

      {hoverIndex !== null && (
        <div className="chart-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <strong>{formatCurrency(data[hoverIndex].total)}</strong>
          <span>{formatDayLabel(data[hoverIndex].day)}</span>
        </div>
      )}

      <table className="sr-only">
        <caption>Ventas de los últimos 14 días</caption>
        <thead><tr><th>Fecha</th><th>Total</th></tr></thead>
        <tbody>
          {data.map((point) => (
            <tr key={point.day}><td>{formatDayLabel(point.day)}</td><td>{formatCurrency(point.total)}</td></tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function TopProductsChart({ data }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!data || data.length === 0) {
    return <p className="form-hint">Aún no hay ventas registradas.</p>;
  }

  const maxQuantity = Math.max(...data.map((item) => item.quantity), 1);

  return (
    <div className="bar-list">
      {data.map((item, index) => {
        const widthPct = (item.quantity / maxQuantity) * 100;
        return (
          <div
            key={item.name}
            className={`bar-row ${hoverIndex === index ? 'bar-row-active' : ''}`}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
            onFocus={() => setHoverIndex(index)}
            onBlur={() => setHoverIndex(null)}
            tabIndex={0}
          >
            <span className="bar-row-label">{item.name}</span>
            <div className="bar-track">
              <div className="bar-fill bar-fill-sequential" style={{ width: `${widthPct}%` }} />
            </div>
            <span className="bar-row-value">{item.quantity} u.</span>
            {hoverIndex === index && (
              <div className="chart-tooltip chart-tooltip-static">
                <strong>{item.quantity} unidades</strong>
                <span>{formatCurrency(item.revenue)} en ventas</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// Orden categórico fijo: cada método de pago siempre pinta el mismo color,
// sin importar su posición u orden — el color identifica la entidad, no el ranking.
const PAYMENT_METHOD_SLOT = {
  Efectivo: 1,
  Tarjeta: 2,
  Transferencia: 3,
};

export function PaymentMethodsChart({ data }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!data || data.length === 0) {
    return <p className="form-hint">Aún no hay ventas registradas.</p>;
  }

  const maxTotal = Math.max(...data.map((item) => item.total), 1);

  return (
    <div className="bar-list">
      {data.map((item, index) => {
        const widthPct = (item.total / maxTotal) * 100;
        const slot = PAYMENT_METHOD_SLOT[item.method] || 'default';
        return (
          <div
            key={item.method}
            className={`bar-row ${hoverIndex === index ? 'bar-row-active' : ''}`}
            onMouseEnter={() => setHoverIndex(index)}
            onMouseLeave={() => setHoverIndex(null)}
            onFocus={() => setHoverIndex(index)}
            onBlur={() => setHoverIndex(null)}
            tabIndex={0}
          >
            <span className="bar-row-label">{item.method}</span>
            <div className="bar-track">
              <div className={`bar-fill bar-fill-slot-${slot}`} style={{ width: `${widthPct}%` }} />
            </div>
            <span className="bar-row-value">{formatCurrency(item.total)}</span>
            {hoverIndex === index && (
              <div className="chart-tooltip chart-tooltip-static">
                <strong>{formatCurrency(item.total)}</strong>
                <span>{item.count} venta{item.count === 1 ? '' : 's'}</span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
