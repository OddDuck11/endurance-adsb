# Contributing to Endurance Aircraft Tracker

First off, thank you for considering contributing to Endurance Aircraft Tracker! It's people like you that make this tool better for the aviation community.

## Table of Contents

- [Code of Conduct](#code-of-conduct)
- [How Can I Contribute?](#how-can-i-contribute)
  - [Reporting Bugs](#reporting-bugs)
  - [Suggesting Enhancements](#suggesting-enhancements)
  - [Adding Aircraft Profiles](#adding-aircraft-profiles)
  - [Pull Requests](#pull-requests)
- [Style Guidelines](#style-guidelines)
- [Development Setup](#development-setup)

---

## Code of Conduct

This project and everyone participating in it is governed by respect and professionalism. By participating, you are expected to uphold this standard.

---

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates.

**When submitting a bug report, include:**
- A clear and descriptive title
- Steps to reproduce the issue
- Expected behavior vs actual behavior
- Screenshots if applicable
- Your environment (OS, Python version, etc.)
- Relevant log files

**Example:**
```
Title: Watchlist aircraft not updating status

Environment:
- OS: Ubuntu 22.04
- Python: 3.10.6
- Browser: Firefox 120

Steps to reproduce:
1. Add aircraft N12345 to watchlist
2. Click "Check Status"
3. Status shows "Not Detected" but aircraft is airborne on ADSB.fi

Expected: Status should show airborne
Actual: Shows not detected

Logs: (attach server.log)
```

### Suggesting Enhancements

Enhancement suggestions are welcome! Please provide:
- Clear description of the enhancement
- Why this enhancement would be useful
- Possible implementation approach (if you have ideas)

**Example:**
```
Title: Add flight path visualization on map

Description:
Display watchlist aircraft positions on an interactive map using Leaflet.js

Benefits:
- Visual representation of aircraft locations
- See flight paths over time
- Better situational awareness

Implementation ideas:
- Use Leaflet.js for mapping
- Store position history in JSON
- Add map view to watchlist.html
```

### Adding Aircraft Profiles

We always need more aircraft types in the mission database!

**To add an aircraft profile:**

1. Fork the repository
2. Edit `aircraft-missions.json`
3. Add your aircraft type following this format:

```json
{
  "TYPE_CODE": {
    "name": "Manufacturer Model Name",
    "mission": "Detailed mission description including role, capabilities, operators, and interesting facts. 2-3 sentences minimum."
  }
}
```

**Example:**
```json
{
  "F35": {
    "name": "Lockheed Martin F-35 Lightning II",
    "mission": "Fifth-generation multirole stealth fighter with variants for conventional takeoff/landing (F-35A), carrier operations (F-35C), and short takeoff/vertical landing (F-35B). Advanced sensor fusion, network connectivity, and stealth for air superiority and precision strike missions. Operated by USAF, Navy, Marines, and allied nations worldwide."
  }
}
```

4. Submit a pull request with title: `Add aircraft profile: [TYPE_CODE]`

### Pull Requests

**Process:**
1. Fork the repo
2. Create a feature branch (`git checkout -b feature/AmazingFeature`)
3. Make your changes
4. Test thoroughly
5. Commit with clear messages (`git commit -m 'Add flight path visualization'`)
6. Push to your fork (`git push origin feature/AmazingFeature`)
7. Open a Pull Request

**Pull Request Guidelines:**
- Reference any related issues
- Include screenshots for UI changes
- Update README.md if adding features
- Test on multiple platforms if possible
- Follow existing code style

**Example PR Description:**
```
## Description
Adds interactive map visualization for watchlist aircraft

## Changes
- Added Leaflet.js integration
- New map view in watchlist.html
- Position history tracking in watchlist.json
- Updated README with map usage

## Testing
- Tested on Ubuntu 22.04 + Firefox
- Tested on macOS + Safari
- Verified map updates in real-time

## Screenshots
[Include screenshots]

Closes #42
```

---

## Style Guidelines

### Python Code

- Follow PEP 8
- Use meaningful variable names
- Add docstrings to functions
- Keep functions focused and small
- Comment complex logic

**Example:**
```python
def check_aircraft_status(hex_code: str) -> dict:
    """
    Query ADSB.fi for aircraft status by hex code.

    Args:
        hex_code: Aircraft Mode-S hex code (e.g., 'abc123')

    Returns:
        dict: Aircraft data or empty dict if not found
    """
    api_url = f"{ADSB_API_BASE}/v2/hex/{hex_code}"
    # ... implementation
```

### Bash Scripts

- Use descriptive variable names (UPPERCASE for constants)
- Add comments for complex operations
- Check for errors
- Use `set -e` for critical scripts

**Example:**
```bash
#!/bin/bash
# Track watchlist aircraft and update status

set -e  # Exit on error

WATCHLIST_FILE="${SCRIPT_DIR}/watchlist.json"
ADSB_API_BASE="https://opendata.adsb.fi/api"

# Check if watchlist exists
if [ ! -f "$WATCHLIST_FILE" ]; then
    echo "Error: Watchlist file not found"
    exit 1
fi
```

### JavaScript

- Use `const` and `let`, avoid `var`
- Use async/await for promises
- Add comments for complex logic
- Use meaningful function names

### JSON

- Proper indentation (2 spaces)
- Valid JSON structure
- Descriptive keys

---

## Development Setup

### 1. Clone Your Fork
```bash
git clone https://github.com/YOUR_USERNAME/endurance-adsb.git
cd endurance-adsb
```

### 2. Set Up Environment
```bash
# Install dependencies
sudo apt-get install python3 curl jq

# Make scripts executable
chmod +x *.sh *.py

# Configure your location
nano track-watchlist.sh  # Update LAT/LON
```

### 3. Test Your Changes
```bash
# Start server
./restart-server.sh

# Test watchlist
./track-watchlist.sh

# Test military tracker
./track-military.sh

# Access web interface
open http://localhost:8080/watchlist.html
```

### 4. Run Tests
```bash
# Test API endpoints
curl http://localhost:8080/api/adsb/hex/abc123

# Test watchlist save
# (Use web interface to add/remove aircraft)

# Verify JSON syntax
jq . watchlist.json
jq . aircraft-missions.json
```

---

## Aircraft Profile Contribution Tips

**Good aircraft mission descriptions include:**
1. Primary role/mission
2. Key capabilities or features
3. Operating forces/users
4. Interesting facts or history

**Example (good):**
> "Twin-engine turboprop military transport aircraft. Primary missions include tactical airlift, medical evacuation, aerial refueling, weather reconnaissance, and special operations support. Backbone of tactical airlift for U.S. and allied forces since 1956."

**Example (too short):**
> "Military transport plane"

**Example (too technical):**
> "Four-engine turboprop featuring Allison T56-A-15 engines producing 4,591 shp each, with a maximum payload of 42,000 lbs and a range of 2,050 nautical miles at maximum gross weight of 155,000 lbs..."

---

## Questions?

Feel free to open an issue with the `question` label or start a discussion on GitHub Discussions.

---

## Recognition

Contributors will be recognized in the project README. Significant contributions may be highlighted in release notes.

Thank you for contributing! ✈️
