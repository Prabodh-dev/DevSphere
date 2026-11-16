# Use official Node.js LTS image
FROM node:20-alpine

# Enable pnpm via corepack (version comes from package.json "packageManager")
RUN corepack enable

# Set working directory
WORKDIR /usr/src/app

# Install dependencies
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile --prod

# Copy source code
COPY . .

# Expose the port the app runs on
EXPOSE 5000

# Start the application
CMD ["node", "server.js"]
