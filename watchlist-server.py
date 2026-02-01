#!/usr/bin/env python3
"""
Watchlist API Server for Endurance
Handles aircraft watchlist queries and updates
"""

from http.server import HTTPServer, SimpleHTTPRequestHandler
import json
import urllib.request
import urllib.parse
from pathlib import Path
import os

WATCHLIST_FILE = Path(__file__).parent / "watchlist.json"
ADSB_API_BASE = "https://opendata.adsb.fi/api"

class WatchlistHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        # Handle ADSB API proxy requests
        if self.path.startswith('/api/adsb/'):
            self.handle_adsb_query()
        else:
            # Serve static files
            super().do_GET()

    def do_POST(self):
        # Handle watchlist save requests
        if self.path == '/api/watchlist/save':
            self.handle_watchlist_save()
        else:
            self.send_error(404, "Not Found")

    def handle_adsb_query(self):
        """Proxy ADSB.fi API requests"""
        try:
            # Extract query type from path: /api/adsb/hex/abc123 or /api/adsb/registration/N12345
            parts = self.path.split('/')
            if len(parts) < 5:
                self.send_error(400, "Invalid query")
                return

            query_type = parts[3]  # 'hex' or 'registration'
            query_value = parts[4]

            # Build ADSB.fi API URL
            if query_type == 'hex':
                api_url = f"{ADSB_API_BASE}/v2/hex/{query_value}"
            elif query_type == 'registration':
                api_url = f"{ADSB_API_BASE}/v2/registration/{query_value}"
            else:
                self.send_error(400, "Invalid query type")
                return

            # Query ADSB.fi
            with urllib.request.urlopen(api_url, timeout=10) as response:
                data = response.read()

            # Return response
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(data)

        except urllib.error.HTTPError as e:
            self.send_error(e.code, str(e))
        except Exception as e:
            self.send_error(500, f"Error: {str(e)}")

    def handle_watchlist_save(self):
        """Save watchlist data to file"""
        try:
            # Read POST data
            content_length = int(self.headers['Content-Length'])
            post_data = self.rfile.read(content_length)
            watchlist_data = json.loads(post_data)

            # Validate data structure
            if 'aircraft' not in watchlist_data:
                self.send_error(400, "Invalid watchlist data")
                return

            # Save to file
            with open(WATCHLIST_FILE, 'w') as f:
                json.dump(watchlist_data, f, indent=2)

            # Return success
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Access-Control-Allow-Origin', '*')
            self.end_headers()
            self.wfile.write(json.dumps({"status": "success"}).encode())

        except Exception as e:
            self.send_error(500, f"Error saving watchlist: {str(e)}")

    def end_headers(self):
        # Add CORS headers for all responses
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        super().end_headers()

def run_server(port=8080):
    """Run the watchlist server"""
    # Change to endurance directory
    os.chdir(Path(__file__).parent)

    server_address = ('', port)
    httpd = HTTPServer(server_address, WatchlistHandler)

    print(f"Endurance Watchlist Server running on http://localhost:{port}")
    print(f"Serving from: {Path.cwd()}")
    print("Press Ctrl+C to stop")

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down server...")
        httpd.shutdown()

if __name__ == '__main__':
    run_server()
