#!/bin/bash
# Curatorr - Dev startup script
# Run from project root

set -e

echo "=== Curatorr Dev Mode ==="

if [ ! -f "backend/.env" ]; then
    echo "No backend/.env found, creating from template..."
    cp backend/.env.example backend/.env
    echo "Edit backend/.env with your Plex token, then run this again."
    exit 1
fi

if [ ! -d "backend/venv" ]; then
    echo "Setting up Python venv..."
    cd backend
    python3 -m venv venv
    source venv/bin/activate
    pip install -r requirements.txt
    cd ..
fi

if [ ! -d "frontend/node_modules" ]; then
    echo "Installing frontend deps..."
    cd frontend && npm install && cd ..
fi

cleanup() {
    echo "Shutting down..."
    kill $BACKEND_PID $FRONTEND_PID 2>/dev/null || true
    exit 0
}
trap cleanup SIGINT SIGTERM

echo "Starting backend..."
cd backend && source venv/bin/activate && python main.py &
BACKEND_PID=$!
cd ..

sleep 2

echo "Starting frontend..."
cd frontend && npm run dev &
FRONTEND_PID=$!
cd ..

echo ""
echo "Frontend: http://localhost:3000"
echo "Backend:  http://localhost:5100"
echo "Ctrl+C to stop"

wait
