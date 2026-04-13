# Backend Coffee Bar

## Comandos

Desde `apps/backend`:

```bash
cmd /c ..\..\node_modules\.bin\prisma.cmd generate --schema prisma/schema.prisma
cmd /c ..\..\node_modules\.bin\prisma.cmd migrate deploy --schema prisma/schema.prisma
cmd /c ..\..\node_modules\.bin\tsc.cmd -p tsconfig.json
node dist/main.js
```

## Salud

```bash
http://localhost:3001/api/health
```
