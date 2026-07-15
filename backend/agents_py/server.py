from flask import Flask, request, jsonify
app = Flask(__name__)

@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    return jsonify({
        'signal': 'HOLD',
        'confidence': 50,
        'reason': 'Python agent is running (stub)'
    })

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5002)
