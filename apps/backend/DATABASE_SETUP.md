# Database Setup

## Requisitos

- PostgreSQL corriendo en `localhost:5432`
- Base de datos `coffee_bar`
- Usuario `coffee_user`
- Password `coffee_password`

La cadena actual vive en [apps/backend/.env](/c:/Trabajos/CoffeeBar/coffee-music/apps/backend/.env).

## Inicializar esquema

Desde `apps/backend`:

```bash
cmd /c ..\..\node_modules\.bin\prisma.cmd generate --schema prisma/schema.prisma
cmd /c ..\..\node_modules\.bin\prisma.cmd migrate deploy --schema prisma/schema.prisma
```

## Cargar datos base

Cuando dejemos listo el runner de seeds podremos ejecutar `prisma db seed`.
