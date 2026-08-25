# Imagen multi-etapa: solo lo necesario para ejecutar llega a la imagen final.
#
# La anterior era una sola etapa que copiaba el repo entero, instalaba con
# `npm install` (ignorando el lockfile), arrastraba las devDependencies y corría
# como root. Además `output: 'standalone'` estaba configurado pero sin usar,
# porque el arranque era `npm start`.

# --- 1. Dependencias -------------------------------------------------------
# npm ci respeta el lockfile: builds reproducibles.
# Ojo: xlsx se instala desde cdn.sheetjs.com (la versión de npm tiene CVEs sin
# arreglo), así que el build necesita salida a ese host.
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# --- 2. Compilación --------------------------------------------------------
FROM node:22-bookworm-slim AS builder
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Genera .next/standalone con solo el node_modules que el servidor usa de verdad.
RUN npm run build

# --- 3. Ejecución ----------------------------------------------------------
# La imagen oficial de Playwright ya trae Chromium y todas sus librerías del
# sistema, así que no hace falta `playwright install --with-deps`. El tag debe
# coincidir con la versión del paquete playwright del lockfile (1.61.0).
FROM mcr.microsoft.com/playwright:v1.61.0-noble AS runner
WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=8080 \
    HOSTNAME=0.0.0.0

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# pwuser viene en la imagen de Playwright. Nada de root.
USER pwuser

EXPOSE 8080

# El servidor mínimo de `output: 'standalone'`, no `next start`.
CMD ["node", "server.js"]
