# Use official Node.js LTS image
FROM node:18-bullseye

# Install unrar tool
RUN apt-get update && apt-get install -y unrar && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package.json package.json

# Install dependencies
RUN npm install

# Copy all source files
COPY . .

# Expose port
EXPOSE 3000

# Start the app
CMD ["npm", "start"]
