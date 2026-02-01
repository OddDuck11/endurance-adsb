# Endurance Aircraft Tracker

**Real-time aircraft tracking and watchlist system using ADSB.fi data**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Python 3.8+](https://img.shields.io/badge/python-3.8+-blue.svg)](https://www.python.org/downloads/)
[![ADSB.fi](https://img.shields.io/badge/data-ADSB.fi-green.svg)](https://adsb.fi/)

A comprehensive aircraft tracking system for monitoring military and civilian aircraft using ADSB.fi real-time data. Features include a customizable watchlist, automated tracking, military aircraft logging, and a clean web interface.

![Endurance Aircraft Tracker](https://img.shields.io/badge/status-active-success)

---

## 🚀 Features

### 📡 Real-Time Aircraft Tracking
- Query ADSB.fi API for aircraft within customizable distances (5-250 NM)
- Live position, altitude, speed, heading, and callsign data
- Filter by distance, altitude, type, and operator
- Automatic aircraft type detection

### ⭐ Watchlist System
- Track specific aircraft by tail number or hex code
- Customizable alert distances per aircraft
- Real-time status updates (airborne/not detected)
- Automatic encounter logging with timestamps
- Desktop notifications when watchlist aircraft detected
- Web-based management interface

### 🎖️ Military Aircraft Logger
- Automatic detection and logging of military aircraft
- Comprehensive mission profile database (40+ aircraft types)
- Historical encounter tracking
- Links to ADSB.fi flight replays
- Wikipedia integration for aircraft information

### 🖥️ Web Interface
- Clean, terminal-inspired design
- Mobile responsive
- Real-time updates
- Add/remove watchlist aircraft
- View encounter history
- Check aircraft status with one click

### 🤖 Automation
- Automated watchlist checking via cron
- Configurable check intervals
- Rate limit compliance (ADSB.fi API)
- Automatic database updates
- Encounter history tracking

---

## 📋 Table of Contents

- [Features](#-features)
- [Installation](#-installation)
- [Quick Start](#-quick-start)
- [Usage](#-usage)
  - [Watchlist](#watchlist)
  - [Military Log](#military-log)
  - [Automation](#automation)
- [Configuration](#-configuration)
- [API Documentation](#-api-documentation)
- [Project Structure](#-project-structure)
- [Contributing](#-contributing)
- [License](#-license)
- [Acknowledgments](#-acknowledgments)

---

## 🔧 Installation

### Prerequisites

- **Python 3.8+**
- **Bash shell** (Linux/macOS)
- **curl** and **jq** (for shell scripts)
- Internet connection for ADSB.fi API access

### System Dependencies

**Debian/Ubuntu:**
```bash
sudo apt-get update
sudo apt-get install -y python3 python3-pip curl jq
```

**macOS (Homebrew):**
```bash
brew install python3 curl jq
```

### Installation Steps

1. **Clone the repository:**
```bash
git clone https://github.com/OddDuck11/endurance-adsb.git
cd endurance-adsb
```

2. **Set your location** in configuration files:
```bash
# Edit track-watchlist.sh and track-military.sh
# Update LAT and LON variables with your coordinates
LAT="YOUR_LATITUDE"
LON="YOUR_LONGITUDE"
```

3. **Make scripts executable:**
```bash
chmod +x *.sh *.py
```

4. **Start the web server:**
```bash
./restart-server.sh
```

5. **Access the web interface:**
```
http://localhost:8080/watchlist.html
http://localhost:8080/military-log.html
```

---

## 🚀 Quick Start

### 1. Add Aircraft to Watchlist

**Via Web Interface:**
1. Open `http://localhost:8080/watchlist.html`
2. Fill in aircraft details:
   - Registration: `N12345`
   - Hex: `abc123`
   - Name: `EVAL01 - Military ISR Aircraft`
   - Alert Distance: `100` NM
3. Click **ADD TO WATCHLIST**

**Via JSON (manual):**
```bash
# Edit watchlist.json
nano watchlist.json
```

### 2. Check Watchlist Aircraft

**Manual Check:**
```bash
./track-watchlist.sh
```

**Web Interface:**
- Click **↻ CHECK ALL AIRCRAFT** button

### 3. View Military Aircraft Log

```
http://localhost:8080/military-log.html
```

---

## 📖 Usage

### Watchlist

**Add Aircraft:**
```bash
# Via web interface (recommended)
http://localhost:8080/watchlist.html

# Or edit JSON directly
nano watchlist.json
```

**Check Aircraft Status:**
```bash
# Check all watchlist aircraft
./track-watchlist.sh

# Output:
# [1/3] Checking: N12345 (EVAL01 - Military ISR Aircraft)
#   ✓ AIRBORNE - 34000ft, 387kts, 46.3NM
#     Callsign: EVAL01   | Squawk: 2350 | Track: 277°
#     🔔 ALERT: Within 100NM alert distance!
```

**Remove Aircraft:**
- Use web interface: Click **✕ REMOVE** button
- Or edit `watchlist.json` manually

### Military Log

**Track Military Aircraft:**
```bash
# Run military tracker
./track-military.sh

# Output:
# Detected 2 military aircraft within 50 NM
#   - 08-3927 (T-6A) [hex: ae1e9b] at 14.4 NM, 3850ft
```

**View Military Log:**
```
http://localhost:8080/military-log.html
```

**Add Aircraft Mission Profiles:**
```bash
# Edit aircraft-missions.json
nano aircraft-missions.json

# Add new type:
{
  "TEX2": {
    "name": "Beechcraft T-6A Texan II",
    "mission": "Primary trainer aircraft for USAF/Navy..."
  }
}
```

### Automation

**Set up automated tracking:**

```bash
# Edit crontab
crontab -e

# Check watchlist every 5 minutes
*/5 * * * * /path/to/endurance-adsb/track-watchlist.sh >> /path/to/watchlist-tracking.log 2>&1

# Check military aircraft every 10 minutes
*/10 * * * * /path/to/endurance-adsb/track-military.sh >> /path/to/military-tracking.log 2>&1

# Daytime-only checks (6am-10pm)
*/10 6-22 * * * /path/to/endurance-adsb/track-watchlist.sh
```

---

## ⚙️ Configuration

### Location Settings

Update your coordinates in tracking scripts:

**`track-watchlist.sh`:**
```bash
LAT="YOUR_LATITUDE"  # Your latitude
LON="YOUR_LONGITUDE" # Your longitude
```

**`track-military.sh`:**
```bash
LAT="YOUR_LATITUDE"
LON="YOUR_LONGITUDE"
RANGE_NM=50      # Detection range in nautical miles
```

### Watchlist Settings

**Alert Distance:**
- Set per aircraft in `watchlist.json`
- Default: 100 NM
- Range: 1-250 NM

**Check Interval:**
- Respects ADSB.fi rate limits (1 req/sec public, 1 req/30sec feeder)
- Recommended: 5-10 minute intervals via cron

### Server Configuration

**Port:**
Default: `8080`

Change in `watchlist-server.py`:
```python
def run_server(port=8080):  # Change port here
```

---

## 📡 API Documentation

### ADSB.fi Endpoints Used

**Aircraft by Hex Code:**
```
GET https://opendata.adsb.fi/api/v2/hex/{hex}
```

**Aircraft by Registration:**
```
GET https://opendata.adsb.fi/api/v2/registration/{registration}
```

**Aircraft by Distance:**
```
GET https://opendata.adsb.fi/api/v3/lat/{lat}/lon/{lon}/dist/{distance}
```

**Military Aircraft:**
```
GET https://opendata.adsb.fi/api/v2/mil
```

### Local API Endpoints

**Check Aircraft (via proxy):**
```
GET http://localhost:8080/api/adsb/hex/{hex}
GET http://localhost:8080/api/adsb/registration/{registration}
```

**Save Watchlist:**
```
POST http://localhost:8080/api/watchlist/save
Content-Type: application/json

{
  "aircraft": [...]
}
```

---

## 📂 Project Structure

```
endurance-adsb/
├── README.md                      # This file
├── LICENSE                        # MIT License
├── .gitignore                     # Git ignore rules
│
├── watchlist.json                 # Watchlist database
├── watchlist.html                 # Watchlist web interface
├── watchlist-server.py            # API server
├── track-watchlist.sh             # Watchlist tracking script
│
├── military-log.json              # Military encounter log
├── military-log.html              # Military log web interface
├── track-military.sh              # Military aircraft tracker
├── aircraft-missions.json         # Aircraft mission profiles database
│
├── restart-server.sh              # Server restart utility
├── check-missing-aircraft.sh      # Database coverage checker
│
└── assets/
    ├── military-jet.svg           # Military aircraft icon
    └── military-jet.png           # Military aircraft icon
```

---

## 🛠️ Development

### Running in Development Mode

```bash
# Start server with debug output
python3 watchlist-server.py

# Test watchlist tracker
./track-watchlist.sh

# Test military tracker
./track-military.sh
```

### Adding Aircraft Types

Edit `aircraft-missions.json`:

```json
{
  "TYPE_CODE": {
    "name": "Aircraft Full Name",
    "mission": "Detailed mission description..."
  }
}
```

### Modifying Web Interface

- `watchlist.html` - Watchlist interface
- `military-log.html` - Military log interface
- Both use inline CSS/JS for simplicity
- Endurance-themed dark color scheme

---

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

### Contribution Guidelines

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

### Areas for Contribution

- Additional aircraft mission profiles
- Enhanced visualizations (maps, charts)
- Mobile app integration
- Additional data sources
- Performance improvements
- Bug fixes

---

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---

## 🙏 Acknowledgments

- **[ADSB.fi](https://adsb.fi/)** - Free, open-source aircraft tracking data
- **[ADS-B Exchange](https://www.adsbexchange.com/)** - Unfiltered flight tracking
- **ADS-B feeder community** - For maintaining receiver networks
- **Military aviation enthusiasts** - For aircraft type documentation

---

## 📊 Statistics

- **40+ Aircraft Types** in mission database
- **Real-time tracking** via ADSB.fi API
- **250 NM** maximum detection range
- **Sub-second** query response time
- **Rate-limited** API calls for compliance

---

## 🔮 Roadmap

- [ ] Interactive map visualization
- [ ] Flight path recording and replay
- [ ] Email/SMS notifications
- [ ] Mobile app (iOS/Android)
- [ ] Machine learning for pattern detection
- [ ] Integration with Flightradar24/FlightAware
- [ ] Export to KML/GPX
- [ ] Multi-user support
- [ ] Docker containerization
- [ ] REST API for third-party integration

---

## 📞 Support

- **Issues:** [GitHub Issues](https://github.com/OddDuck11/endurance-adsb/issues)
- **Discussions:** [GitHub Discussions](https://github.com/OddDuck11/endurance-adsb/discussions)

---

## ⚠️ Disclaimer

This software is provided for educational and personal use only. Always comply with:
- Local aviation regulations
- ADSB.fi Terms of Service
- Applicable privacy laws
- Rate limiting requirements

**Do not use this software for:**
- Commercial purposes without proper licensing
- Stalking or harassment
- Violations of privacy
- Any illegal activities

---

<p align="center">
  <strong>Made with ❤️ by aviation enthusiasts</strong><br>
  <sub>Inspired by the Endurance mission</sub>
</p>

<p align="center">
  <em>"Do not go gentle into that good night"</em>
</p>
