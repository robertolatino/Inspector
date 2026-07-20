# 1. Usar una imagen oficial de Node.js (Debian Bookworm es muy estable)
FROM node:20-bookworm

# 2. Establecer el directorio de trabajo dentro del servidor
WORKDIR /app

# 3. Copiar solo los archivos de dependencias primero (Optimización de caché)
COPY package*.json ./

# 4. Instalar las dependencias de Node.js de tu proyecto
RUN npm install

# 5. EL PASO MÁGICO: Instalar Chromium y TODAS las librerías de Linux necesarias (fuentes, audio, video)
RUN npx playwright install --with-deps chromium

# 6. Copiar el resto de tu código fuente al servidor
COPY . .

# 7. Construir la versión optimizada de Next.js
RUN npm run build

# 8. Configurar las variables de entorno obligatorias para Google Cloud Run
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# 9. Exponer el puerto 8080
EXPOSE 8080

# 10. Comando final para encender tu aplicación
CMD ["npm", "start"]