# FarmaExpress

Aplicación de gestión farmacéutica con interfaz moderna y base de datos PostgreSQL.

## Stack

- Frontend: React + Vite + CSS moderno
- Backend: Node.js + Express
- Base de datos: PostgreSQL

## Requisitos

- Node.js 18+
- PostgreSQL 14+
- npm

## Configuración rápida

1. Crear una base de datos PostgreSQL llamada `farmaexpress`.
2. Copiar el archivo `server/.env.example` a `server/.env` y ajustar las credenciales.
3. Ejecutar el script SQL en `database/schema.sql` para crear las tablas.
4. Instalar dependencias:
   ```bash
   npm install
   ```
5. Iniciar el proyecto:
   ```bash
   npm run dev
   ```

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

## Módulos base incluidos

- Dashboard ejecutivo
- Catálogo de productos
- Gestión de ventas
- Compras y proveedores
- Clientes
- Inventario
- Reportes básicos
- Seguridad/configuración
