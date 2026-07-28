# 1. imagen oficial de Node.js 
FROM node:20-bookworm

# 2. Directorio de trabajo dentro del servidor
WORKDIR /app

# 3. Copiar solo los archivos de dependencias primero
COPY package*.json ./

# 4. Instalar las dependencias
RUN npm install

# 5.  Chromium y TODAS las librerías necesarias
RUN npx playwright install --with-deps chromium

# 6. Código fuente al servidor
COPY . .

# 7. Versión optimizada de Next.js
RUN npm run build

# 8. Configurar las variables de entorno
ENV PORT=8080
ENV HOST=0.0.0.0
ENV NODE_ENV=production

# 9. Exponer el puerto 8080
EXPOSE 8080

# 10. Comando final.
CMD ["npm", "start"]