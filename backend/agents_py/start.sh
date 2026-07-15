#!/bin/bash
cd "$(dirname "$0")"
echo "📦 Installing Python dependencies..."
pip install flask pandas numpy requests openai --quiet
echo "🐍 Starting Python agent server..."
python server.py
