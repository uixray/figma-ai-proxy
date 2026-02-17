#!/bin/bash

# Figma AI Proxy - Deployment Script v2.0.0
# Usage: bash deploy.sh

set -e

echo "Deploying Figma AI Proxy v2.0.0..."
echo ""

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Check Node.js
echo "Checking Node.js installation..."
if ! command -v node &> /dev/null; then
    echo -e "${RED}Node.js not found!${NC}"
    echo "Install: curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash - && sudo apt-get install -y nodejs"
    exit 1
fi

NODE_VERSION=$(node --version)
echo -e "${GREEN}Node.js $NODE_VERSION${NC}"
echo ""

# Check npm
if ! command -v npm &> /dev/null; then
    echo -e "${RED}npm not found!${NC}"
    exit 1
fi

# Install dependencies
echo "Installing dependencies..."
npm install
echo -e "${GREEN}Dependencies installed${NC}"
echo ""

# Create .env if missing
if [ ! -f .env ]; then
    echo "Creating .env file..."
    cp .env.example .env
    echo -e "${YELLOW}Please edit .env file with your settings${NC}"
    echo ""
fi

# Check PM2
echo "Checking PM2..."
if ! command -v pm2 &> /dev/null; then
    echo -e "${YELLOW}PM2 not found. Installing...${NC}"
    sudo npm install -g pm2
    echo -e "${GREEN}PM2 installed${NC}"
fi
echo ""

# Stop old process (both old and new names)
echo "Stopping old processes..."
pm2 stop figma-proxy 2>/dev/null || true
pm2 delete figma-proxy 2>/dev/null || true
pm2 stop figma-ai-proxy 2>/dev/null || true
pm2 delete figma-ai-proxy 2>/dev/null || true
echo ""

# Start new process
echo "Starting Figma AI Proxy..."
pm2 start server.js --name "figma-ai-proxy" --time
echo -e "${GREEN}Server started${NC}"
echo ""

# Configure startup
echo "Configuring startup..."
pm2 save
echo -e "${GREEN}Startup configured${NC}"
echo ""

# Show status
echo "Server status:"
pm2 status figma-ai-proxy
echo ""

# Final instructions
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}Deployment complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "Next steps:"
echo ""
echo "1. Check logs:"
echo "   pm2 logs figma-ai-proxy"
echo ""
echo "2. Test the server:"
echo "   curl http://localhost:3001/health"
echo ""
echo "3. Configure Nginx reverse proxy (see README.md)"
echo ""
echo "4. Test providers:"
echo "   node test.js              # structural tests"
echo "   node test.js groq claude  # real API tests"
echo ""
