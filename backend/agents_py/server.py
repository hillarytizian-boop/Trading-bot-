from flask import Flask, request, jsonify
import json
app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    # For now, return a simple signal – you can connect the full agent system here
    return jsonify({
        'signal': 'HOLD',
        'confidence': 50,
        'reason': 'Python agent stub – replace with full multi-agent system'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)
