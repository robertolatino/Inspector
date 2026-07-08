# 1. Imagen base oficial de Playwright con Ubuntu Noble y Node.js preinstalado
FROM mcr.microsoft.com/playwright:v1.49.1-noble AS base

# --- Etapa de dependencias ---
FROM base AS deps
WORKDIR /app

# Copiar manifiestos de paquetes
COPY package.json package-lock.json* ./
# Instala dependencias limpias de producción y desarrollo (necesarias para compilar Next.js)
RUN npm ci

# --- Etapa de compilación ---
FROM base AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .

# Desactivar telemetría de Next.js durante la build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# --- Etapa final de ejecución ---
FROM base AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=8080
ENV HOSTNAME="0.0.0.0"

# Decirle a Playwright dónde están los navegadores instalados globalmente en la imagen base
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Copiar el build standalone generado por Next.js
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

EXPOSE 8080

# Comando para arrancar el servidor optimizado de Next.js
CMD ["node", "server.js"]