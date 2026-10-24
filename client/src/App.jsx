import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, ArrowLeftRight, Boxes, LogOut, Moon, Package, ShoppingCart, Sun, Truck, UserCog, Users, Warehouse,
} from 'lucide-react';
import { api, getToken, setSessionExpiredHandler, setToken } from './api.js';
import { Feedback, Field, ROLES } from './ui.jsx';
import { SessionContext } from './session.js';
import logo from './assets/logo.png';
import Dashboard from './pages/Dashboard.jsx';
import Medicamentos from './pages/Medicamentos.jsx';
import Inventario from './pages/Inventario.jsx';
import Compras from './pages/Compras.jsx';
import Ventas from './pages/Ventas.jsx';
import Pacientes from './pages/Pacientes.jsx';
import Despachos from './pages/Despachos.jsx';
import Traslados from './pages/Traslados.jsx';
import Empleados from './pages/Empleados.jsx';

const { ADMIN, FARMACEUTICO, REPARTIDOR } = ROLES;

// RNF-10: el menú solo muestra los módulos permitidos para el rol activo
// (el backend aplica las mismas reglas, así que ocultar no es la única defensa).
const MODULOS = [
  { key: 'dashboard', label: 'Dashboard', icon: Activity, roles: [ADMIN, FARMACEUTICO], component: Dashboard },
  { key: 'ventas', label: 'Ventas', icon: ShoppingCart, roles: [FARMACEUTICO, ADMIN], component: Ventas },
  { key: 'inventario', label: 'Inventario', icon: Warehouse, roles: [ADMIN, FARMACEUTICO, REPARTIDOR], component: Inventario },
  { key: 'medicamentos', label: 'Medicamentos', icon: Package, roles: [ADMIN, FARMACEUTICO], component: Medicamentos },
  { key: 'traslados', label: 'Traslados', icon: ArrowLeftRight, roles: [ADMIN, FARMACEUTICO], component: Traslados },
  { key: 'compras', label: 'Compras', icon: Boxes, roles: [ADMIN], component: Compras },
  { key: 'pacientes', label: 'Pacientes', icon: Users, roles: [ADMIN, FARMACEUTICO], component: Pacientes },
  { key: 'despachos', label: 'Despachos', icon: Truck, roles: [FARMACEUTICO, REPARTIDOR, ADMIN], component: Despachos },
  { key: 'empleados', label: 'Empleados', icon: UserCog, roles: [ADMIN], component: Empleados },
];

const INACTIVIDAD_MS = 15 * 60 * 1000;

function useTheme() {
  const [theme, setTheme] = useState(() => {
    try {
      const saved = localStorage.getItem('farmaexpress.theme');
      if (saved) return saved;
    } catch { /* sin almacenamiento */ }
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem('farmaexpress.theme', theme); } catch { /* sin almacenamiento */ }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

function Login({ onLogin, aviso }) {
  const [form, setForm] = useState({ correo: '', contrasena: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { token, usuario } = await api('/api/auth/login', { method: 'POST', body: form });
      setToken(token);
      onLogin(usuario);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-shell">
      <form className="panel login-card" onSubmit={submit}>
        <div className="brand login-brand">
          <img className="brand-mark" src={logo} alt="" />
          <div>
            <p className="eyebrow">Red de farmacias</p>
            <h1>FarmaExpress</h1>
          </div>
        </div>
        <p className="form-hint">Ingresa con tu cuenta de empleado.</p>
        {aviso && <div className="alert-box warning">{aviso}</div>}
        <Feedback feedback={error && { type: 'danger', message: error }} />
        <Field label="Correo" htmlFor="login-correo">
          <input id="login-correo" type="email" autoComplete="username" value={form.correo} onChange={(e) => setForm({ ...form, correo: e.target.value })} required />
        </Field>
        <Field label="Contraseña" htmlFor="login-contrasena">
          <input id="login-contrasena" type="password" autoComplete="current-password" value={form.contrasena} onChange={(e) => setForm({ ...form, contrasena: e.target.value })} required />
        </Field>
        <button className="primary-btn" type="submit" disabled={busy}>{busy ? 'Ingresando…' : 'Iniciar sesión'}</button>
      </form>
    </div>
  );
}

function Shell({ usuario, onLogout }) {
  const [theme, toggleTheme] = useTheme();
  const modulos = MODULOS.filter((m) => m.roles.includes(usuario.rol));
  const [activo, setActivo] = useState(modulos[0].key);
  const [catalogos, setCatalogos] = useState(null);

  const cargarCatalogos = useCallback(() => api('/api/catalogos').then(setCatalogos).catch(() => {}), []);
  useEffect(() => { cargarCatalogos(); }, [cargarCatalogos]);

  const sesion = useMemo(() => ({ usuario, catalogos, cargarCatalogos, irA: setActivo }), [usuario, catalogos, cargarCatalogos]);
  const Modulo = modulos.find((m) => m.key === activo)?.component ?? modulos[0].component;

  return (
    <SessionContext.Provider value={sesion}>
      <div className="app-shell">
        <aside className="sidebar">
          <div className="brand">
            <img className="brand-mark" src={logo} alt="" />
            <div>
              <p className="eyebrow">Farmacia</p>
              <h1>FarmaExpress</h1>
            </div>
          </div>

          <nav className="nav" aria-label="Módulos">
            {modulos.map(({ key, label, icon: Icon }) => (
              <button key={key} type="button" className={`nav-item ${activo === key ? 'active' : ''}`} onClick={() => setActivo(key)}>
                <Icon size={18} /> {label}
              </button>
            ))}
          </nav>

          <button className="theme-toggle" onClick={toggleTheme} type="button">
            {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            {theme === 'dark' ? 'Modo claro' : 'Modo oscuro'}
          </button>

          <div className="sidebar-card">
            <UserCog size={18} />
            <div>
              <strong>{usuario.nombre}</strong>
              <span>{usuario.rol} · {usuario.sucursal}</span>
            </div>
          </div>
          <button className="theme-toggle" type="button" onClick={() => onLogout()}>
            <LogOut size={16} /> Cerrar sesión
          </button>
        </aside>

        <main className="content">
          {catalogos ? <Modulo /> : <p className="form-hint">Cargando…</p>}
        </main>
      </div>
    </SessionContext.Provider>
  );
}

export default function App() {
  const [usuario, setUsuario] = useState(null);
  const [verificando, setVerificando] = useState(Boolean(getToken()));
  const [aviso, setAviso] = useState(null);
  const temporizador = useRef(null);

  const logout = useCallback((mensaje = null) => {
    setToken(null);
    setUsuario(null);
    setAviso(mensaje);
  }, []);

  useEffect(() => {
    setSessionExpiredHandler((mensaje) => logout(mensaje));
    if (!getToken()) return;
    api('/api/auth/me')
      .then(setUsuario)
      .catch(() => setToken(null))
      .finally(() => setVerificando(false));
  }, [logout]);

  // RNF-03: cierre automático tras 15 minutos sin actividad en la terminal.
  useEffect(() => {
    if (!usuario) return undefined;
    const reiniciar = () => {
      clearTimeout(temporizador.current);
      temporizador.current = setTimeout(() => logout('Sesión cerrada por 15 minutos de inactividad.'), INACTIVIDAD_MS);
    };
    const eventos = ['mousemove', 'keydown', 'click', 'touchstart'];
    eventos.forEach((e) => window.addEventListener(e, reiniciar, { passive: true }));
    reiniciar();
    return () => {
      clearTimeout(temporizador.current);
      eventos.forEach((e) => window.removeEventListener(e, reiniciar));
    };
  }, [usuario, logout]);

  if (verificando) return <div className="login-shell"><p className="form-hint">Verificando sesión…</p></div>;
  if (!usuario) return <Login onLogin={(u) => { setAviso(null); setUsuario(u); }} aviso={aviso} />;
  return <Shell usuario={usuario} onLogout={logout} />;
}
