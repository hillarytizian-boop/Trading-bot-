#!/bin/bash
cd "$(dirname "$0")"
echo "📦 Installing Python dependencies..."
pip install --quiet flask pandas numpy requests openai
echo "🐍 Starting Python agent server..."
python server.py
