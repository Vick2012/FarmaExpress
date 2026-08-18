import { Fragment, useEffect, useState } from 'react';
import {
  Activity,
  Boxes,
  ChevronDown,
  ChevronUp,
  CreditCard,
  DollarSign,
  Inbox,
  Moon,
  Package,
  ShoppingCart,
  Stethoscope,
  Sun,
  Truck,
  UserCog,
  Users,
} from 'lucide-react';
import { ChartCard, PaymentMethodsChart, SalesTrendChart, TopProductsChart } from './charts.jsx';
import logo from './assets/logo.png';

const safeNumber = (value) => {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
};

const formatCurrency = (value) =>
  new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency: 'COP',
    maximumFractionDigits: 0,
  }).format(safeNumber(value));

const formatDate = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const formatTime = (date) =>
  date ? date.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }) : '';

const navItems = [
  { key: 'dashboard', label: 'Dashboard', icon: Activity },
  { key: 'products', label: 'Medicamentos', icon: Package },
  { key: 'customers', label: 'Pacientes', icon: Users },
  { key: 'sales', label: 'Ventas', icon: ShoppingCart },
  { key: 'purchases', label: 'Compras', icon: Boxes },
  { key: 'suppliers', label: 'Proveedores', icon: Stethoscope },
  { key: 'inventory', label: 'Inventario', icon: Boxes },
  { key: 'deliveries', label: 'Despachos', icon: Truck },
  { key: 'employees', label: 'Empleados', icon: UserCog },
];

const DELIVERY_STATUS_LABEL = {
  pendiente: 'Pendiente',
  en_ruta: 'En ruta',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
};

const EMPLOYEE_ROLES = ['Administrador', 'Farmacéutico', 'Repartidor'];

const emptyDashboard = { salesTotal: 0, products: 0, customers: 0, lowStock: 0 };
const emptyCharts = { salesTimeseries: [], topProducts: [], paymentMethods: [] };
const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:5001';
const LOW_STOCK_THRESHOLD = 10;

const FeedbackBanner = ({ feedback }) => {
  if (!feedback) return null;
  return <div className={`alert-box ${feedback.type === 'error' ? 'danger' : 'success'}`}>{feedback.message}</div>;
};

const Field = ({ label, htmlFor, children }) => (
  <div className="field">
    <label className="field-label" htmlFor={htmlFor}>{label}</label>
    {children}
  </div>
);

const renderSkeletonRows = (columns, rows = 4) =>
  Array.from({ length: rows }).map((_, rowIndex) => (
    <tr key={`skeleton-${rowIndex}`} className="skeleton-row">
      {Array.from({ length: columns }).map((__, colIndex) => (
        <td key={colIndex}><span className="skeleton-block" /></td>
      ))}
    </tr>
  ));

const renderEmptyRow = (columns, message) => (
  <tr>
    <td colSpan={columns} className="empty-state">
      <Inbox size={20} />
      <span>{message}</span>
    </td>
  </tr>
);

function App() {
  const [theme, setTheme] = useState(() => {
    if (typeof window === 'undefined') return 'light';
    const stored = window.localStorage.getItem('farmaexpress-theme');
    if (stored) return stored;
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });

  const [activeTab, setActiveTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(emptyDashboard);
  const [charts, setCharts] = useState(emptyCharts);
  const [products, setProducts] = useState([]);
  const [categories, setCategories] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [sales, setSales] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [purchases, setPurchases] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [inventoryTransactions, setInventoryTransactions] = useState([]);
  const [employees, setEmployees] = useState([]);
  const [deliveries, setDeliveries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(null);

  const [expandedSaleId, setExpandedSaleId] = useState(null);
  const [expandedPurchaseId, setExpandedPurchaseId] = useState(null);
  const [expandedCustomerId, setExpandedCustomerId] = useState(null);
  const [customerHistory, setCustomerHistory] = useState({});

  const [productForm, setProductForm] = useState({ name: '', sku: '', price: '0', cost: '0', stock: '0', brand: '', category_id: '', requires_prescription: false, controlled_substance: false });
  const [customerForm, setCustomerForm] = useState({ full_name: '', email: '', phone: '', document_number: '', address: '', guardian_id: '' });
  const [supplierForm, setSupplierForm] = useState({ name: '', contact_name: '', phone: '', email: '', address: '' });
  const [saleForm, setSaleForm] = useState({ customer_id: '', payment_method: 'Efectivo', product_id: '', quantity: '1', total: '0', prescription_number: '', delivery_address: '' });
  const [purchaseForm, setPurchaseForm] = useState({ supplier_id: '', invoice_number: '', product_id: '', quantity: '1', unit_cost: '0' });
  const [employeeForm, setEmployeeForm] = useState({ name: '', email: '', role: 'Farmacéutico' });
  const [saleError, setSaleError] = useState('');
  const [productFeedback, setProductFeedback] = useState(null);
  const [customerFeedback, setCustomerFeedback] = useState(null);
  const [supplierFeedback, setSupplierFeedback] = useState(null);
  const [purchaseFeedback, setPurchaseFeedback] = useState(null);
  const [employeeFeedback, setEmployeeFeedback] = useState(null);

  const selectedSaleProduct = products.find((product) => String(product.id) === String(saleForm.product_id));
  const saleQuantity = safeNumber(saleForm.quantity);
  const computedSaleTotal = safeNumber(selectedSaleProduct?.price) * saleQuantity;
  const saleStockWarning = selectedSaleProduct && saleQuantity > safeNumber(selectedSaleProduct.stock);
  const saleNeedsPrescription = Boolean(selectedSaleProduct?.requires_prescription || selectedSaleProduct?.controlled_substance);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    window.localStorage.setItem('farmaexpress-theme', theme);
  }, [theme]);

  const loadData = async () => {
    setLoading(true);
    try {
      const results = await Promise.allSettled([
        fetch(`${API_BASE}/api/dashboard`),
        fetch(`${API_BASE}/api/products`),
        fetch(`${API_BASE}/api/customers`),
        fetch(`${API_BASE}/api/sales`),
        fetch(`${API_BASE}/api/suppliers`),
        fetch(`${API_BASE}/api/purchases`),
        fetch(`${API_BASE}/api/inventory`),
        fetch(`${API_BASE}/api/categories`),
        fetch(`${API_BASE}/api/dashboard/charts`),
        fetch(`${API_BASE}/api/inventory-transactions`),
        fetch(`${API_BASE}/api/employees`),
        fetch(`${API_BASE}/api/deliveries`),
      ]);

      const dashboardResponse = results[0].status === 'fulfilled' ? await results[0].value.json() : emptyDashboard;
      const productsResponse = results[1].status === 'fulfilled' ? await results[1].value.json() : [];
      const customersResponse = results[2].status === 'fulfilled' ? await results[2].value.json() : [];
      const salesResponse = results[3].status === 'fulfilled' ? await results[3].value.json() : [];
      const suppliersResponse = results[4].status === 'fulfilled' ? await results[4].value.json() : [];
      const purchasesResponse = results[5].status === 'fulfilled' ? await results[5].value.json() : [];
      const inventoryResponse = results[6].status === 'fulfilled' ? await results[6].value.json() : [];
      const categoriesResponse = results[7].status === 'fulfilled' ? await results[7].value.json() : [];
      const chartsResponse = results[8].status === 'fulfilled' ? await results[8].value.json() : emptyCharts;
      const inventoryTransactionsResponse = results[9].status === 'fulfilled' ? await results[9].value.json() : [];
      const employeesResponse = results[10].status === 'fulfilled' ? await results[10].value.json() : [];
      const deliveriesResponse = results[11].status === 'fulfilled' ? await results[11].value.json() : [];

      setDashboard({
        salesTotal: safeNumber(dashboardResponse.salesTotal),
        products: safeNumber(dashboardResponse.products),
        customers: safeNumber(dashboardResponse.customers),
        lowStock: safeNumber(dashboardResponse.lowStock),
      });
      setProducts(Array.isArray(productsResponse) ? productsResponse : []);
      setCustomers(Array.isArray(customersResponse) ? customersResponse : []);
      setSales(Array.isArray(salesResponse) ? salesResponse : []);
      setSuppliers(Array.isArray(suppliersResponse) ? suppliersResponse : []);
      setPurchases(Array.isArray(purchasesResponse) ? purchasesResponse : []);
      setInventory(Array.isArray(inventoryResponse) ? inventoryResponse : []);
      setCategories(Array.isArray(categoriesResponse) ? categoriesResponse : []);
      setCharts({
        salesTimeseries: Array.isArray(chartsResponse.salesTimeseries) ? chartsResponse.salesTimeseries : [],
        topProducts: Array.isArray(chartsResponse.topProducts) ? chartsResponse.topProducts : [],
        paymentMethods: Array.isArray(chartsResponse.paymentMethods) ? chartsResponse.paymentMethods : [],
      });
      setInventoryTransactions(Array.isArray(inventoryTransactionsResponse) ? inventoryTransactionsResponse : []);
      setEmployees(Array.isArray(employeesResponse) ? employeesResponse : []);
      setDeliveries(Array.isArray(deliveriesResponse) ? deliveriesResponse : []);
      setError('');
      setLastUpdated(new Date());
    } catch (err) {
      console.error(err);
      setError('No se pudo conectar con el backend. Verifica PostgreSQL y el puerto del servidor.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleProductSubmit = async (event) => {
    event.preventDefault();
    setProductFeedback(null);
    const payload = {
      ...productForm,
      category_id: Number(productForm.category_id) || 1,
      price: Number(productForm.price),
      cost: Number(productForm.cost),
      stock: Number(productForm.stock),
    };

    try {
      const response = await fetch(`${API_BASE}/api/products`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setProductForm({ name: '', sku: '', price: '0', cost: '0', stock: '0', brand: '', category_id: '', requires_prescription: false, controlled_substance: false });
        setProductFeedback({ type: 'success', message: 'Producto guardado correctamente.' });
        loadData();
      } else {
        setProductFeedback({ type: 'error', message: result.message || 'No se pudo guardar el producto.' });
      }
    } catch (err) {
      setProductFeedback({ type: 'error', message: 'No se pudo conectar con el servidor.' });
    }
  };

  const handleCustomerSubmit = async (event) => {
    event.preventDefault();
    setCustomerFeedback(null);

    const payload = { ...customerForm, guardian_id: customerForm.guardian_id ? Number(customerForm.guardian_id) : null };

    try {
      const response = await fetch(`${API_BASE}/api/customers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setCustomerForm({ full_name: '', email: '', phone: '', document_number: '', address: '', guardian_id: '' });
        setCustomerFeedback({ type: 'success', message: 'Paciente guardado correctamente.' });
        loadData();
      } else {
        setCustomerFeedback({ type: 'error', message: result.message || 'No se pudo guardar el cliente.' });
      }
    } catch (err) {
      setCustomerFeedback({ type: 'error', message: 'No se pudo conectar con el servidor.' });
    }
  };

  const handleSupplierSubmit = async (event) => {
    event.preventDefault();
    setSupplierFeedback(null);

    try {
      const response = await fetch(`${API_BASE}/api/suppliers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(supplierForm),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setSupplierForm({ name: '', contact_name: '', phone: '', email: '', address: '' });
        setSupplierFeedback({ type: 'success', message: 'Proveedor guardado correctamente.' });
        loadData();
      } else {
        setSupplierFeedback({ type: 'error', message: result.message || 'No se pudo guardar el proveedor.' });
      }
    } catch (err) {
      setSupplierFeedback({ type: 'error', message: 'No se pudo conectar con el servidor.' });
    }
  };

  const handleSaleSubmit = async (event) => {
    event.preventDefault();

    const quantity = Math.max(0, safeNumber(saleForm.quantity));
    const productId = Number(saleForm.product_id);
    const selectedProduct = products.find((product) => String(product.id) === String(productId));

    if (!productId || !selectedProduct) {
      setSaleError('Debes seleccionar un producto válido.');
      return;
    }

    if (quantity <= 0) {
      setSaleError('La cantidad debe ser mayor que cero.');
      return;
    }

    if (quantity > safeNumber(selectedProduct.stock)) {
      setSaleError(`No hay suficiente stock de ${selectedProduct.name}. Disponible: ${selectedProduct.stock}.`);
      return;
    }

    const productNeedsPrescription = Boolean(selectedProduct.requires_prescription || selectedProduct.controlled_substance);
    if (productNeedsPrescription && !saleForm.prescription_number.trim()) {
      setSaleError(`${selectedProduct.name} requiere fórmula médica. Ingresa el número de la receta.`);
      return;
    }

    const payload = {
      customer_id: Number(saleForm.customer_id),
      payment_method: saleForm.payment_method,
      total: computedSaleTotal,
      prescription_number: saleForm.prescription_number.trim(),
      delivery_address: saleForm.delivery_address.trim(),
      items: [{
        product_id: productId,
        quantity,
        unit_price: safeNumber(selectedProduct.price),
      }],
    };

    try {
      const response = await fetch(`${API_BASE}/api/sales`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setSaleError('');
        setSaleForm({ customer_id: '', payment_method: 'Efectivo', product_id: '', quantity: '1', total: '0', prescription_number: '', delivery_address: '' });
        loadData();
        return;
      }

      setSaleError(result.message || 'No se pudo registrar la venta.');
    } catch (err) {
      setSaleError('No se pudo conectar con el servidor.');
    }
  };

  const handlePurchaseSubmit = async (event) => {
    event.preventDefault();
    setPurchaseFeedback(null);

    if (!purchaseForm.supplier_id || !purchaseForm.product_id) {
      setPurchaseFeedback({ type: 'error', message: 'Selecciona proveedor y producto.' });
      return;
    }

    const payload = {
      supplier_id: Number(purchaseForm.supplier_id),
      invoice_number: purchaseForm.invoice_number,
      total: Number(purchaseForm.unit_cost || 0) * Number(purchaseForm.quantity || 1),
      items: [{
        product_id: Number(purchaseForm.product_id),
        quantity: Number(purchaseForm.quantity || 1),
        unit_cost: Number(purchaseForm.unit_cost || 0),
      }],
    };

    try {
      const response = await fetch(`${API_BASE}/api/purchases`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setPurchaseForm({ supplier_id: '', invoice_number: '', product_id: '', quantity: '1', unit_cost: '0' });
        setPurchaseFeedback({ type: 'success', message: 'Compra registrada correctamente.' });
        loadData();
      } else {
        setPurchaseFeedback({ type: 'error', message: result.message || 'No se pudo registrar la compra.' });
      }
    } catch (err) {
      setPurchaseFeedback({ type: 'error', message: 'No se pudo conectar con el servidor.' });
    }
  };

  const handleEmployeeSubmit = async (event) => {
    event.preventDefault();
    setEmployeeFeedback(null);

    try {
      const response = await fetch(`${API_BASE}/api/employees`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(employeeForm),
      });
      const result = await response.json().catch(() => ({}));

      if (response.ok) {
        setEmployeeForm({ name: '', email: '', role: 'Farmacéutico' });
        setEmployeeFeedback({ type: 'success', message: 'Empleado registrado correctamente.' });
        loadData();
      } else {
        setEmployeeFeedback({ type: 'error', message: result.message || 'No se pudo registrar el empleado.' });
      }
    } catch (err) {
      setEmployeeFeedback({ type: 'error', message: 'No se pudo conectar con el servidor.' });
    }
  };

  const handleToggleEmployeeActive = async (employee) => {
    try {
      const response = await fetch(`${API_BASE}/api/employees/${employee.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: !employee.is_active }),
      });
      if (response.ok) loadData();
    } catch (err) {
      setEmployeeFeedback({ type: 'error', message: 'No se pudo actualizar el estado del empleado.' });
    }
  };

  const handleDeliveryStatusChange = async (delivery, status) => {
    try {
      const response = await fetch(`${API_BASE}/api/deliveries/${delivery.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      });
      if (response.ok) loadData();
    } catch (err) {
      // El error se refleja simplemente en que la fila no cambia de estado.
    }
  };

  const handleDeliveryAssign = async (delivery, employeeId) => {
    try {
      const response = await fetch(`${API_BASE}/api/deliveries/${delivery.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employee_id: employeeId ? Number(employeeId) : null }),
      });
      if (response.ok) loadData();
    } catch (err) {
      // idem
    }
  };

  const handleToggleCustomerHistory = async (customerId) => {
    if (expandedCustomerId === customerId) {
      setExpandedCustomerId(null);
      return;
    }
    setExpandedCustomerId(customerId);
    if (!customerHistory[customerId]) {
      try {
        const response = await fetch(`${API_BASE}/api/customers/${customerId}/history`);
        const result = await response.json().catch(() => []);
        setCustomerHistory((prev) => ({ ...prev, [customerId]: Array.isArray(result) ? result : [] }));
      } catch (err) {
        setCustomerHistory((prev) => ({ ...prev, [customerId]: [] }));
      }
    }
  };

  const statCards = [
    { label: 'Ventas', value: formatCurrency(dashboard.salesTotal), tone: 'green', icon: DollarSign },
    { label: 'Productos', value: String(dashboard.products), tone: 'blue', icon: Package },
    { label: 'Pacientes', value: String(dashboard.customers), tone: 'purple', icon: Users },
    { label: 'Stock crítico', value: String(dashboard.lowStock), tone: 'red', icon: Activity },
  ];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <img className="brand-mark" src={logo} alt="FarmaExpress" />
          <div>
            <p className="eyebrow">Farmacia</p>
            <h1>FarmaExpress</h1>
          </div>
        </div>

        <nav className="nav">
          {navItems.map(({ key, label, icon: Icon }) => (
            <button key={key} className={`nav-item ${activeTab === key ? 'active' : ''}`} onClick={() => setActiveTab(key)}>
              <Icon size={18} /> {label}
            </button>
          ))}
        </nav>

        <button
          className="theme-toggle"
          onClick={() => setTheme((current) => (current === 'dark' ? 'light' : 'dark'))}
          type="button"
        >
          {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
          {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
        </button>

        <div className="sidebar-card">
          <Stethoscope size={18} />
          <div>
            <strong>Operación</strong>
            <span>En línea</span>
          </div>
        </div>
      </aside>

      <main className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">{lastUpdated ? `Actualizado a las ${formatTime(lastUpdated)}` : 'Panel general'}</p>
            <h2>Bienvenido</h2>
          </div>
          <button className="primary-btn" onClick={() => setActiveTab('sales')}>+ Nueva venta</button>
        </header>

        {error && <div className="alert-box danger">{error}</div>}

        {activeTab === 'dashboard' && (
          <>
            <section className="stats-grid">
              {statCards.map(({ label, value, tone, icon: Icon }) => (
                <article className={`stat-card ${tone}`} key={label}>
                  <div className="stat-header">
                    <span>{label}</span>
                    <div className="stat-icon"><Icon size={18} /></div>
                  </div>
                  <strong>{value}</strong>
                </article>
              ))}
            </section>

            <section className="quick-access">
              <div className="quick-item"><div className="quick-icon"><ShoppingCart size={20} /></div><div><strong>Ventas</strong><span>Registrar y revisar facturación</span></div></div>
              <div className="quick-item"><div className="quick-icon"><Boxes size={20} /></div><div><strong>Inventario</strong><span>Control de stock y vencimientos</span></div></div>
              <div className="quick-item"><div className="quick-icon"><Users size={20} /></div><div><strong>Pacientes</strong><span>Gestión de cartera y atención</span></div></div>
              <div className="quick-item"><div className="quick-icon"><CreditCard size={20} /></div><div><strong>Pagos</strong><span>Cobros y métodos de pago</span></div></div>
              <div className="quick-item"><div className="quick-icon"><Truck size={20} /></div><div><strong>Despachos</strong><span>Entregas y repartidores</span></div></div>
              <div className="quick-item"><div className="quick-icon"><UserCog size={20} /></div><div><strong>Empleados</strong><span>Roles y accesos del equipo</span></div></div>
            </section>

            {!loading && (
              <section className="charts-grid">
                <ChartCard title="Ventas — últimos 14 días" subtitle="Total facturado por día">
                  <SalesTrendChart data={charts.salesTimeseries} />
                </ChartCard>
                <div className="charts-grid-secondary">
                  <ChartCard title="Productos más vendidos" subtitle="Top 5 por unidades">
                    <TopProductsChart data={charts.topProducts} />
                  </ChartCard>
                  <ChartCard title="Ventas por método de pago" subtitle="Total facturado por método">
                    <PaymentMethodsChart data={charts.paymentMethods} />
                  </ChartCard>
                </div>
              </section>
            )}
          </>
        )}

        {activeTab === 'products' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar producto</h3></div>
              <form className="module-form" onSubmit={handleProductSubmit}>
                <FeedbackBanner feedback={productFeedback} />
                <Field label="Nombre del producto" htmlFor="product-name">
                  <input id="product-name" value={productForm.name} onChange={(e) => setProductForm({ ...productForm, name: e.target.value })} placeholder="Ej. Paracetamol 500mg" required />
                </Field>
                <Field label="SKU" htmlFor="product-sku">
                  <input id="product-sku" value={productForm.sku} onChange={(e) => setProductForm({ ...productForm, sku: e.target.value })} placeholder="Ej. PAR-500" required />
                </Field>
                <Field label="Marca" htmlFor="product-brand">
                  <input id="product-brand" value={productForm.brand} onChange={(e) => setProductForm({ ...productForm, brand: e.target.value })} placeholder="Marca" />
                </Field>
                <Field label="Categoría" htmlFor="product-category">
                  <select id="product-category" value={productForm.category_id} onChange={(e) => setProductForm({ ...productForm, category_id: e.target.value })}>
                    <option value="">Selecciona categoría</option>
                    {categories.map((category) => (<option key={category.id} value={category.id}>{category.name}</option>))}
                  </select>
                </Field>
                <div className="two-columns">
                  <Field label="Precio" htmlFor="product-price">
                    <input id="product-price" type="number" min="0" value={productForm.price} onChange={(e) => setProductForm({ ...productForm, price: e.target.value })} placeholder="Precio" />
                  </Field>
                  <Field label="Costo" htmlFor="product-cost">
                    <input id="product-cost" type="number" min="0" value={productForm.cost} onChange={(e) => setProductForm({ ...productForm, cost: e.target.value })} placeholder="Costo" />
                  </Field>
                </div>
                <Field label="Stock inicial" htmlFor="product-stock">
                  <input id="product-stock" type="number" min="0" value={productForm.stock} onChange={(e) => setProductForm({ ...productForm, stock: e.target.value })} placeholder="Stock" />
                </Field>
                <label className="checkbox-field">
                  <input type="checkbox" checked={productForm.requires_prescription} onChange={(e) => setProductForm({ ...productForm, requires_prescription: e.target.checked })} />
                  Requiere fórmula médica
                </label>
                <label className="checkbox-field">
                  <input type="checkbox" checked={productForm.controlled_substance} onChange={(e) => setProductForm({ ...productForm, controlled_substance: e.target.checked })} />
                  Medicamento de control especial
                </label>
                <button className="primary-btn" type="submit">Guardar producto</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Medicamentos recientes</h3></div>
              <table>
                <thead><tr><th>Nombre</th><th>SKU</th><th>Stock</th><th>Precio</th><th>Receta</th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(5)
                    : products.length === 0
                      ? renderEmptyRow(5, 'Aún no hay medicamentos registrados.')
                      : products.map((product) => (
                        <tr key={product.id}>
                          <td>{product.name}</td>
                          <td>{product.sku}</td>
                          <td className={safeNumber(product.stock) <= LOW_STOCK_THRESHOLD ? 'stock-low' : ''}>{product.stock}</td>
                          <td>{formatCurrency(product.price)}</td>
                          <td>
                            {product.controlled_substance
                              ? <span className="badge badge-warning">Control especial</span>
                              : product.requires_prescription
                                ? <span className="badge">Requiere receta</span>
                                : <span className="form-hint">—</span>}
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'customers' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar paciente</h3></div>
              <form className="module-form" onSubmit={handleCustomerSubmit}>
                <FeedbackBanner feedback={customerFeedback} />
                <Field label="Nombre completo" htmlFor="customer-name">
                  <input id="customer-name" value={customerForm.full_name} onChange={(e) => setCustomerForm({ ...customerForm, full_name: e.target.value })} placeholder="Nombre completo" required />
                </Field>
                <Field label="Correo" htmlFor="customer-email">
                  <input id="customer-email" type="email" value={customerForm.email} onChange={(e) => setCustomerForm({ ...customerForm, email: e.target.value })} placeholder="Correo" />
                </Field>
                <Field label="Teléfono" htmlFor="customer-phone">
                  <input id="customer-phone" value={customerForm.phone} onChange={(e) => setCustomerForm({ ...customerForm, phone: e.target.value })} placeholder="Teléfono" />
                </Field>
                <Field label="Documento" htmlFor="customer-document">
                  <input id="customer-document" value={customerForm.document_number} onChange={(e) => setCustomerForm({ ...customerForm, document_number: e.target.value })} placeholder="Documento" />
                </Field>
                <Field label="Dirección" htmlFor="customer-address">
                  <textarea id="customer-address" value={customerForm.address} onChange={(e) => setCustomerForm({ ...customerForm, address: e.target.value })} placeholder="Dirección" rows="3" />
                </Field>
                <Field label="Depende de (familiar titular)" htmlFor="customer-guardian">
                  <select id="customer-guardian" value={customerForm.guardian_id} onChange={(e) => setCustomerForm({ ...customerForm, guardian_id: e.target.value })}>
                    <option value="">Paciente independiente</option>
                    {customers.map((customer) => (<option key={customer.id} value={customer.id}>{customer.full_name}</option>))}
                  </select>
                </Field>
                <button className="primary-btn" type="submit">Guardar paciente</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Pacientes</h3></div>
              <table>
                <thead><tr><th>Nombre</th><th>Documento</th><th>Depende de</th><th className="chevron-cell"></th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(4)
                    : customers.length === 0
                      ? renderEmptyRow(4, 'Aún no hay pacientes registrados.')
                      : customers.map((customer) => (
                        <Fragment key={customer.id}>
                          <tr className="clickable-row" onClick={() => handleToggleCustomerHistory(customer.id)}>
                            <td>{customer.full_name}</td>
                            <td>{customer.document_number}</td>
                            <td>{customer.guardian_name || '—'}</td>
                            <td className="chevron-cell">{expandedCustomerId === customer.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                          </tr>
                          {expandedCustomerId === customer.id && (
                            <tr className="detail-row">
                              <td colSpan="4">
                                {!customerHistory[customer.id] ? (
                                  <span className="form-hint">Cargando historial…</span>
                                ) : customerHistory[customer.id].length === 0 ? (
                                  <span className="form-hint">Sin historial de medicamentos todavía.</span>
                                ) : (
                                  <ul className="items-list">
                                    {customerHistory[customer.id].map((entry, index) => (
                                      <li key={index}>{formatDate(entry.sale_date)} · {entry.quantity} × {entry.product_name} — {formatCurrency(entry.subtotal)}</li>
                                    ))}
                                  </ul>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'sales' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar venta</h3></div>
              <form className="module-form" onSubmit={handleSaleSubmit}>
                <Field label="Cliente" htmlFor="sale-customer">
                  <select id="sale-customer" value={saleForm.customer_id} onChange={(e) => setSaleForm({ ...saleForm, customer_id: e.target.value })}>
                    <option value="">Selecciona cliente</option>
                    {customers.map((customer) => (<option key={customer.id} value={customer.id}>{customer.full_name}</option>))}
                  </select>
                </Field>
                <Field label="Método de pago" htmlFor="sale-payment">
                  <select id="sale-payment" value={saleForm.payment_method} onChange={(e) => setSaleForm({ ...saleForm, payment_method: e.target.value })}>
                    <option>Efectivo</option>
                    <option>Tarjeta</option>
                    <option>Transferencia</option>
                  </select>
                </Field>
                <Field label="Producto" htmlFor="sale-product">
                  <select id="sale-product" value={saleForm.product_id} onChange={(e) => { setSaleError(''); setSaleForm({ ...saleForm, product_id: e.target.value }); }}>
                    <option value="">Selecciona producto</option>
                    {products.map((product) => (<option key={product.id} value={product.id}>{product.name}</option>))}
                  </select>
                </Field>
                <div className="two-columns">
                  <Field label="Cantidad" htmlFor="sale-quantity">
                    <input id="sale-quantity" type="number" min="1" value={saleForm.quantity} onChange={(e) => { setSaleError(''); setSaleForm({ ...saleForm, quantity: e.target.value }); }} placeholder="Cantidad" />
                  </Field>
                  <Field label="Total" htmlFor="sale-total">
                    <input id="sale-total" type="text" value={formatCurrency(computedSaleTotal)} readOnly placeholder="Total" />
                  </Field>
                </div>
                {selectedSaleProduct && (
                  <div className="form-hint">
                    Precio unitario: <strong>{formatCurrency(selectedSaleProduct.price)}</strong> · Stock disponible: <strong>{selectedSaleProduct.stock}</strong>
                  </div>
                )}
                {saleNeedsPrescription && (
                  <Field label="Número de fórmula / receta" htmlFor="sale-prescription">
                    <input
                      id="sale-prescription"
                      value={saleForm.prescription_number}
                      onChange={(e) => { setSaleError(''); setSaleForm({ ...saleForm, prescription_number: e.target.value }); }}
                      placeholder="Ej. RX-000123"
                    />
                    <span className="form-hint">
                      {selectedSaleProduct.controlled_substance ? 'Medicamento de control especial: ' : 'Requiere fórmula médica: '}
                      la venta se bloqueará sin este número.
                    </span>
                  </Field>
                )}
                <Field label="Dirección de entrega (opcional — abre un despacho)" htmlFor="sale-delivery">
                  <input
                    id="sale-delivery"
                    value={saleForm.delivery_address}
                    onChange={(e) => setSaleForm({ ...saleForm, delivery_address: e.target.value })}
                    placeholder="Déjalo vacío si el paciente se lleva el pedido"
                  />
                </Field>
                {saleStockWarning && <div className="alert-box danger">No hay suficiente stock para la cantidad solicitada.</div>}
                {saleError && <div className="alert-box danger">{saleError}</div>}
                <button className="primary-btn" type="submit">Registrar venta</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Ventas</h3></div>
              <table>
                <thead><tr><th>ID</th><th>Fecha</th><th>Total</th><th>Pago</th><th>Fórmula</th><th className="chevron-cell"></th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(6)
                    : sales.length === 0
                      ? renderEmptyRow(6, 'Aún no hay ventas registradas.')
                      : sales.map((sale) => (
                        <Fragment key={sale.id}>
                          <tr className="clickable-row" onClick={() => setExpandedSaleId(expandedSaleId === sale.id ? null : sale.id)}>
                            <td>#{sale.id}</td>
                            <td>{formatDate(sale.sale_date)}</td>
                            <td>{formatCurrency(sale.total)}</td>
                            <td>{sale.payment_method}{sale.payment_status ? <span className="form-hint"> · {sale.payment_status}</span> : null}</td>
                            <td>{sale.prescription_number || '—'}</td>
                            <td className="chevron-cell">{expandedSaleId === sale.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                          </tr>
                          {expandedSaleId === sale.id && (
                            <tr className="detail-row">
                              <td colSpan="6">
                                {Array.isArray(sale.items) && sale.items.length > 0 ? (
                                  <ul className="items-list">
                                    {sale.items.map((item, index) => (
                                      <li key={index}>{item.quantity} × {item.product_name} — {formatCurrency(item.subtotal)}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="form-hint">Sin detalle de productos.</span>
                                )}
                                {sale.delivery_status && (
                                  <p className="form-hint">Despacho: {DELIVERY_STATUS_LABEL[sale.delivery_status] || sale.delivery_status}</p>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'purchases' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar compra</h3></div>
              <form className="module-form" onSubmit={handlePurchaseSubmit}>
                <FeedbackBanner feedback={purchaseFeedback} />
                <Field label="Proveedor" htmlFor="purchase-supplier">
                  <select id="purchase-supplier" value={purchaseForm.supplier_id} onChange={(e) => setPurchaseForm({ ...purchaseForm, supplier_id: e.target.value })}>
                    <option value="">Selecciona proveedor</option>
                    {suppliers.map((supplier) => (<option key={supplier.id} value={supplier.id}>{supplier.name}</option>))}
                  </select>
                </Field>
                <Field label="Número de factura" htmlFor="purchase-invoice">
                  <input id="purchase-invoice" value={purchaseForm.invoice_number} onChange={(e) => setPurchaseForm({ ...purchaseForm, invoice_number: e.target.value })} placeholder="Número de factura" />
                </Field>
                <Field label="Producto" htmlFor="purchase-product">
                  <select id="purchase-product" value={purchaseForm.product_id} onChange={(e) => setPurchaseForm({ ...purchaseForm, product_id: e.target.value })}>
                    <option value="">Selecciona producto</option>
                    {products.map((product) => (<option key={product.id} value={product.id}>{product.name}</option>))}
                  </select>
                </Field>
                <div className="two-columns">
                  <Field label="Cantidad" htmlFor="purchase-quantity">
                    <input id="purchase-quantity" type="number" min="1" value={purchaseForm.quantity} onChange={(e) => setPurchaseForm({ ...purchaseForm, quantity: e.target.value })} placeholder="Cantidad" />
                  </Field>
                  <Field label="Costo unitario" htmlFor="purchase-cost">
                    <input id="purchase-cost" type="number" min="0" value={purchaseForm.unit_cost} onChange={(e) => setPurchaseForm({ ...purchaseForm, unit_cost: e.target.value })} placeholder="Costo unitario" />
                  </Field>
                </div>
                <button className="primary-btn" type="submit">Registrar compra</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Compras</h3></div>
              <table>
                <thead><tr><th>ID</th><th>Fecha</th><th>Factura</th><th>Total</th><th className="chevron-cell"></th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(5)
                    : purchases.length === 0
                      ? renderEmptyRow(5, 'Aún no hay compras registradas.')
                      : purchases.map((purchase) => (
                        <Fragment key={purchase.id}>
                          <tr className="clickable-row" onClick={() => setExpandedPurchaseId(expandedPurchaseId === purchase.id ? null : purchase.id)}>
                            <td>#{purchase.id}</td>
                            <td>{formatDate(purchase.purchase_date)}</td>
                            <td>{purchase.invoice_number}</td>
                            <td>{formatCurrency(purchase.total)}</td>
                            <td className="chevron-cell">{expandedPurchaseId === purchase.id ? <ChevronUp size={16} /> : <ChevronDown size={16} />}</td>
                          </tr>
                          {expandedPurchaseId === purchase.id && (
                            <tr className="detail-row">
                              <td colSpan="5">
                                {Array.isArray(purchase.items) && purchase.items.length > 0 ? (
                                  <ul className="items-list">
                                    {purchase.items.map((item, index) => (
                                      <li key={index}>{item.quantity} × {item.product_name} — {formatCurrency(item.subtotal)}</li>
                                    ))}
                                  </ul>
                                ) : (
                                  <span className="form-hint">Sin detalle de productos.</span>
                                )}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'suppliers' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar proveedor</h3></div>
              <form className="module-form" onSubmit={handleSupplierSubmit}>
                <FeedbackBanner feedback={supplierFeedback} />
                <Field label="Nombre" htmlFor="supplier-name">
                  <input id="supplier-name" value={supplierForm.name} onChange={(e) => setSupplierForm({ ...supplierForm, name: e.target.value })} placeholder="Nombre" required />
                </Field>
                <Field label="Contacto" htmlFor="supplier-contact">
                  <input id="supplier-contact" value={supplierForm.contact_name} onChange={(e) => setSupplierForm({ ...supplierForm, contact_name: e.target.value })} placeholder="Contacto" />
                </Field>
                <Field label="Teléfono" htmlFor="supplier-phone">
                  <input id="supplier-phone" value={supplierForm.phone} onChange={(e) => setSupplierForm({ ...supplierForm, phone: e.target.value })} placeholder="Teléfono" />
                </Field>
                <Field label="Correo" htmlFor="supplier-email">
                  <input id="supplier-email" type="email" value={supplierForm.email} onChange={(e) => setSupplierForm({ ...supplierForm, email: e.target.value })} placeholder="Correo" />
                </Field>
                <Field label="Dirección" htmlFor="supplier-address">
                  <textarea id="supplier-address" value={supplierForm.address} onChange={(e) => setSupplierForm({ ...supplierForm, address: e.target.value })} placeholder="Dirección" rows="3" />
                </Field>
                <button className="primary-btn" type="submit">Guardar proveedor</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Proveedores</h3></div>
              <table>
                <thead><tr><th>Nombre</th><th>Contacto</th><th>Teléfono</th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(3)
                    : suppliers.length === 0
                      ? renderEmptyRow(3, 'Aún no hay proveedores registrados.')
                      : suppliers.map((supplier) => (
                        <tr key={supplier.id}><td>{supplier.name}</td><td>{supplier.contact_name}</td><td>{supplier.phone}</td></tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'inventory' && (
          <section className="detail-grid">
            <div className="panel">
              <div className="panel-header"><h3>Inventario crítico</h3></div>
              <table>
                <thead><tr><th>Producto</th><th>Categoría</th><th>Stock</th><th>Vence</th><th>Marca</th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(5)
                    : inventory.length === 0
                      ? renderEmptyRow(5, 'No hay productos con stock crítico ni vencimientos próximos.')
                      : inventory.map((item) => (
                        <tr key={item.id}>
                          <td>{item.name}</td>
                          <td>{item.category_name || 'N/A'}</td>
                          <td className={safeNumber(item.stock) <= LOW_STOCK_THRESHOLD ? 'stock-low' : ''}>{item.stock}</td>
                          <td>{formatDate(item.expiration_date)}</td>
                          <td>{item.brand || 'N/A'}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            <div className="panel">
              <div className="panel-header">
                <div>
                  <h3>Movimientos de inventario</h3>
                  <p className="form-hint">Ledger de entradas y salidas por sucursal</p>
                </div>
              </div>
              <table>
                <thead><tr><th>Producto</th><th>Sucursal</th><th>Tipo</th><th>Cantidad</th><th>Fecha</th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(5)
                    : inventoryTransactions.length === 0
                      ? renderEmptyRow(5, 'Aún no hay movimientos registrados.')
                      : inventoryTransactions.map((movement) => (
                        <tr key={movement.id}>
                          <td>{movement.product_name}</td>
                          <td>{movement.branch_name}</td>
                          <td className="capitalize">{movement.change_type}</td>
                          <td className={Number(movement.quantity) < 0 ? 'stock-low' : ''}>
                            {Number(movement.quantity) > 0 ? '+' : ''}{movement.quantity}
                          </td>
                          <td>{formatDate(movement.created_at)}</td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        {activeTab === 'deliveries' && (
          <section className="panel">
            <div className="panel-header">
              <div>
                <h3>Despachos y entregas</h3>
                <p className="form-hint">Se crean automáticamente al registrar una venta con dirección de entrega</p>
              </div>
            </div>
            <table>
              <thead><tr><th>Venta</th><th>Paciente</th><th>Dirección</th><th>Repartidor</th><th>Estado</th></tr></thead>
              <tbody>
                {loading
                  ? renderSkeletonRows(5)
                  : deliveries.length === 0
                    ? renderEmptyRow(5, 'Aún no hay despachos pendientes.')
                    : deliveries.map((delivery) => (
                      <tr key={delivery.id}>
                        <td>#{delivery.sale_id} · {formatCurrency(delivery.sale_total)}</td>
                        <td>{delivery.customer_name || '—'}</td>
                        <td>{delivery.address || '—'}</td>
                        <td>
                          <select
                            value={delivery.employee_id || ''}
                            onChange={(e) => handleDeliveryAssign(delivery, e.target.value)}
                          >
                            <option value="">Sin asignar</option>
                            {employees.filter((employee) => employee.role === 'Repartidor').map((employee) => (
                              <option key={employee.id} value={employee.id}>{employee.name}</option>
                            ))}
                          </select>
                        </td>
                        <td>
                          <select
                            value={delivery.status}
                            onChange={(e) => handleDeliveryStatusChange(delivery, e.target.value)}
                          >
                            {Object.entries(DELIVERY_STATUS_LABEL).map(([value, label]) => (
                              <option key={value} value={value}>{label}</option>
                            ))}
                          </select>
                        </td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </section>
        )}

        {activeTab === 'employees' && (
          <section className="module-grid">
            <div className="panel">
              <div className="panel-header"><h3>Registrar empleado</h3></div>
              <form className="module-form" onSubmit={handleEmployeeSubmit}>
                <FeedbackBanner feedback={employeeFeedback} />
                <Field label="Nombre completo" htmlFor="employee-name">
                  <input id="employee-name" value={employeeForm.name} onChange={(e) => setEmployeeForm({ ...employeeForm, name: e.target.value })} placeholder="Nombre completo" required />
                </Field>
                <Field label="Correo" htmlFor="employee-email">
                  <input id="employee-email" type="email" value={employeeForm.email} onChange={(e) => setEmployeeForm({ ...employeeForm, email: e.target.value })} placeholder="Correo" required />
                </Field>
                <Field label="Rol" htmlFor="employee-role">
                  <select id="employee-role" value={employeeForm.role} onChange={(e) => setEmployeeForm({ ...employeeForm, role: e.target.value })}>
                    {EMPLOYEE_ROLES.map((role) => (<option key={role} value={role}>{role}</option>))}
                  </select>
                </Field>
                <button className="primary-btn" type="submit">Guardar empleado</button>
              </form>
            </div>

            <div className="panel">
              <div className="panel-header"><h3>Empleados</h3></div>
              <table>
                <thead><tr><th>Nombre</th><th>Correo</th><th>Rol</th><th>Estado</th></tr></thead>
                <tbody>
                  {loading
                    ? renderSkeletonRows(4)
                    : employees.length === 0
                      ? renderEmptyRow(4, 'Aún no hay empleados registrados.')
                      : employees.map((employee) => (
                        <tr key={employee.id}>
                          <td>{employee.name}</td>
                          <td>{employee.email}</td>
                          <td>{employee.role}</td>
                          <td>
                            <button
                              type="button"
                              className={`status-toggle ${employee.is_active ? 'is-active' : 'is-inactive'}`}
                              onClick={() => handleToggleEmployeeActive(employee)}
                            >
                              {employee.is_active ? 'Activo' : 'Inactivo'}
                            </button>
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

export default App;
