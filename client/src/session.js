import { createContext, useContext } from 'react';

// Usuario autenticado, catálogos compartidos y navegación entre módulos.
export const SessionContext = createContext(null);
export const useSession = () => useContext(SessionContext);
