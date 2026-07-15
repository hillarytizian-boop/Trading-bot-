#!/bin/bash
cd "$(dirname "$0")"
pip install -r requirements.txt --quiet
python server.py
