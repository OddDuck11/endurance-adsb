#!/bin/bash

# Military Aircraft Tracking Script
# Detects and logs military aircraft within 50 NM

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MILITARY_LOG="${SCRIPT_DIR}/military-log.json"
MILITARY_HTML="${SCRIPT_DIR}/military-log.html"
AIRCRAFT_DB="${SCRIPT_DIR}/aircraft-missions.json"

# Location (YOUR_CITY, STATE)
LAT="YOUR_LATITUDE"
LON="YOUR_LONGITUDE"
RANGE_NM=50

# Fetch military aircraft within range
fetch_military_aircraft() {
    # Query ADSB.fi for all aircraft within 100 NM, then filter for military within 50 NM
    local response=$(curl -s "https://opendata.adsb.fi/api/v3/lat/${LAT}/lon/${LON}/dist/100")

    if [ $? -eq 0 ] && [ -n "$response" ]; then
        # Filter for aircraft within 50 NM and extract relevant data
        # Military aircraft often have specific type codes or registrations
        echo "$response" | jq -r --arg range "$RANGE_NM" '
            [.ac[]? | select(.dst < ($range | tonumber)) | {
                registration: .r,
                type: .t,
                distance: .dst,
                altitude: .alt_baro,
                heading: .track,
                speed: .gs,
                squawk: .squawk,
                timestamp: now
            }]
        '
    else
        echo '[]'
    fi
}

# Also check dedicated military endpoint
fetch_military_endpoint() {
    local response=$(curl -s "https://opendata.adsb.fi/api/v2/mil")

    if [ $? -eq 0 ] && [ -n "$response" ]; then
        # Filter for aircraft within 50 NM
        echo "$response" | jq -r --argjson lat $LAT --argjson lon $LON --arg range "$RANGE_NM" '
            def distance($lat1; $lon1; $lat2; $lon2):
                ($lat1 - $lat2) as $dlat |
                ($lon1 - $lon2) as $dlon |
                (($dlat * $dlat + $dlon * $dlon) | sqrt) * 69.0;

            [.ac[]? |
                (.lat // 0) as $aclat |
                (.lon // 0) as $aclon |
                distance($lat; $lon; $aclat; $aclon) as $dist |
                select($dist < ($range | tonumber) and $aclat != 0) |
                {
                    hex: .hex,
                    registration: .r,
                    type: .t,
                    distance: $dist,
                    altitude: .alt_baro,
                    heading: .track,
                    speed: .gs,
                    squawk: .squawk,
                    callsign: .flight,
                    lat: .lat,
                    lon: .lon,
                    timestamp: now,
                    military: true
                }
            ]
        '
    else
        echo '[]'
    fi
}

# Initialize log file if it doesn't exist
if [ ! -f "$MILITARY_LOG" ]; then
    echo '{"encounters": []}' > "$MILITARY_LOG"
fi

# Fetch military aircraft
echo "Checking for military aircraft within ${RANGE_NM} NM..."
MILITARY=$(fetch_military_endpoint)

# Count detected aircraft
COUNT=$(echo "$MILITARY" | jq 'length')

if [ "$COUNT" -gt 0 ]; then
    echo "Detected $COUNT military aircraft within ${RANGE_NM} NM"

    # Read existing log
    EXISTING=$(cat "$MILITARY_LOG")

    # Add new encounters to log
    for aircraft in $(echo "$MILITARY" | jq -r '.[] | @base64'); do
        _jq() {
            echo ${aircraft} | base64 --decode | jq -r ${1}
        }

        HEX=$(_jq '.hex')
        REG=$(_jq '.registration')
        TYPE=$(_jq '.type')
        DIST=$(_jq '.distance')
        ALT=$(_jq '.altitude')
        CALLSIGN=$(_jq '.callsign')
        TIMESTAMP=$(date '+%Y-%m-%d %H:%M:%S %Z')

        echo "  - $REG ($TYPE) [hex: $HEX] at $DIST NM, ${ALT}ft"

        # Add to log (avoid duplicates within same hour)
        HOUR_AGO=$(date -d '1 hour ago' '+%s' 2>/dev/null || date -v-1H '+%s')

        UPDATED=$(echo "$EXISTING" | jq --arg hex "$HEX" --arg reg "$REG" --arg type "$TYPE" \
            --arg dist "$DIST" --arg alt "$ALT" --arg ts "$TIMESTAMP" \
            --arg callsign "$CALLSIGN" --argjson hourago "$HOUR_AGO" '
            # Check if this aircraft was logged in the last hour
            (.encounters | map(select(.registration == $reg and (.timestamp_unix // 0) > $hourago)) | length) as $recent |
            if $recent == 0 then
                .encounters += [{
                    hex: $hex,
                    registration: $reg,
                    type: $type,
                    distance: ($dist | tonumber),
                    altitude: ($alt | tonumber),
                    callsign: $callsign,
                    timestamp: $ts,
                    timestamp_unix: now
                }]
            else
                .
            end
        ')

        EXISTING="$UPDATED"
    done

    # Save updated log
    echo "$EXISTING" > "$MILITARY_LOG"

    # Update HTML page
    python3 - <<'PYTHON_SCRIPT'
import json
from datetime import datetime

MILITARY_LOG = "/home/vboxuser/endurance/military-log.json"
MILITARY_HTML = "/home/vboxuser/endurance/military-log.html"
AIRCRAFT_DB = "/home/vboxuser/endurance/aircraft-missions.json"

# Load data
with open(MILITARY_LOG, 'r') as f:
    log_data = json.load(f)

with open(AIRCRAFT_DB, 'r') as f:
    aircraft_db = json.load(f)

# Sort encounters by timestamp (newest first)
encounters = sorted(log_data.get('encounters', []),
                   key=lambda x: x.get('timestamp_unix', 0),
                   reverse=True)

# Build HTML
html = '''<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Military Aircraft Log - Endurance</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: 'Courier New', monospace;
            background: #0a0a0f;
            color: #c0c0c0;
            min-height: 100vh;
            padding: 40px 20px;
        }
        .container {
            max-width: 1200px;
            margin: 0 auto;
        }
        header {
            text-align: center;
            margin-bottom: 40px;
            border-bottom: 1px solid #333;
            padding-bottom: 30px;
        }
        h1 {
            font-size: 2.5em;
            color: #fff;
            letter-spacing: 0.2em;
            margin-bottom: 10px;
        }
        .subtitle {
            color: #ff9f4a;
            font-size: 0.9em;
            letter-spacing: 0.15em;
        }
        .back-link {
            display: inline-block;
            margin-bottom: 20px;
            color: #4a9eff;
            text-decoration: none;
            padding: 10px 20px;
            border: 1px solid #4a9eff;
            transition: all 0.3s;
        }
        .back-link:hover {
            background: #4a9eff;
            color: #0a0a0f;
        }
        .stats {
            background: #111;
            border-left: 3px solid #ff9f4a;
            padding: 20px;
            margin-bottom: 40px;
            text-align: center;
        }
        .stats-value {
            font-size: 3em;
            color: #ff9f4a;
            font-weight: bold;
        }
        .stats-label {
            color: #666;
            margin-top: 10px;
            letter-spacing: 0.1em;
        }
        .encounter {
            background: #111;
            border: 1px solid #333;
            border-left: 3px solid #ff9f4a;
            padding: 25px;
            margin-bottom: 20px;
            transition: border-color 0.3s;
        }
        .encounter:hover {
            border-left-color: #4a9eff;
        }
        .encounter-header {
            display: flex;
            justify-content: space-between;
            align-items: center;
            margin-bottom: 15px;
            flex-wrap: wrap;
            gap: 15px;
        }
        .aircraft-id {
            font-size: 1.3em;
            color: #fff;
            font-weight: bold;
        }
        .timestamp {
            color: #666;
            font-size: 0.85em;
        }
        .aircraft-type {
            color: #ff9f4a;
            font-size: 1.1em;
            margin-bottom: 15px;
        }
        .mission-desc {
            color: #aaa;
            line-height: 1.7;
            margin-bottom: 15px;
            padding: 15px;
            background: #0d0d0d;
            border-left: 2px solid #333;
        }
        .wiki-link-container {
            margin-bottom: 15px;
            padding-left: 15px;
        }
        .wiki-link {
            color: #4a9eff;
            text-decoration: none;
            font-size: 0.9em;
            letter-spacing: 0.05em;
            transition: color 0.3s;
        }
        .wiki-link:hover {
            color: #ff9f4a;
            text-decoration: underline;
        }
        .encounter-details {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
            gap: 15px;
            margin-top: 15px;
        }
        .detail-item {
            background: #0d0d0d;
            padding: 12px;
            border: 1px solid #222;
        }
        .detail-label {
            color: #666;
            font-size: 0.75em;
            letter-spacing: 0.1em;
            margin-bottom: 5px;
        }
        .detail-value {
            color: #4a9eff;
            font-size: 1.1em;
            font-weight: bold;
        }
        .no-encounters {
            text-align: center;
            color: #666;
            padding: 60px 20px;
            font-size: 1.1em;
        }
        footer {
            margin-top: 60px;
            text-align: center;
            color: #333;
            font-size: 0.8em;
            padding-top: 30px;
            border-top: 1px solid #222;
        }
    </style>
</head>
<body>
    <div class="container">
        <header>
            <h1>MILITARY AIRCRAFT LOG</h1>
            <p class="subtitle">DETECTED WITHIN 50 NAUTICAL MILES</p>
        </header>

        <a href="index.html" class="back-link">← BACK TO ENDURANCE</a>

        <div class="stats">
            <div class="stats-value">''' + str(len(encounters)) + '''</div>
            <div class="stats-label">TOTAL ENCOUNTERS LOGGED</div>
        </div>

        <div class="encounters-list">
'''

if encounters:
    for encounter in encounters:
        hex_code = encounter.get('hex', 'UNKNOWN')
        reg = encounter.get('registration', 'UNKNOWN')
        type_code = encounter.get('type', 'UNKNOWN')
        dist = encounter.get('distance', 0)
        alt = encounter.get('altitude', 0)
        callsign = encounter.get('callsign', 'N/A')
        timestamp = encounter.get('timestamp', 'Unknown')

        # Look up aircraft mission info
        aircraft_info = aircraft_db.get(type_code, {})
        aircraft_name = aircraft_info.get('name', type_code)
        mission_desc = aircraft_info.get('mission', 'Mission profile not available in database.')

        # Create Wikipedia link from aircraft name
        # Clean up name for Wikipedia URL (remove variant suffixes like R/T, keep roman numerals)
        import re
        wiki_name = aircraft_name
        # Remove variant codes in parentheses or after slashes (e.g., "KC-135R/T" -> "KC-135")
        wiki_name = re.sub(r'([A-Z]{1,2}-\d+)[A-Z/]+', r'\1', wiki_name)  # Remove variant letters after aircraft designations
        wiki_url = f"https://en.wikipedia.org/wiki/{wiki_name.replace(' ', '_')}"

        # Create ADSB.fi replay link if hex code available
        adsb_link = None
        if hex_code and hex_code != 'UNKNOWN' and hex_code != 'null':
            # Extract date from timestamp for replay link
            try:
                # Parse timestamp like "2026-01-14 10:12:03 CST"
                date_part = timestamp.split()[0]  # Gets "2026-01-14"
                # Leonard's location: YOUR_CITY, STATE
                lat = "32.000"
                lon = "-95.000"
                zoom = "8.5"
                adsb_link = f"https://globe.adsb.fi/?icao={hex_code.lower()}&lat={lat}&lon={lon}&zoom={zoom}&showTrace={date_part}"
            except:
                # Fallback if date parsing fails
                adsb_link = f"https://globe.adsb.fi/?icao={hex_code.lower()}&lat=32.000&lon=-95.000&zoom=8.5"

        html += f'''            <div class="encounter">
                <div class="encounter-header">
                    <div class="aircraft-id">{reg}</div>
                    <div class="timestamp">{timestamp}</div>
                </div>
                <div class="aircraft-type">{aircraft_name}</div>
                <div class="mission-desc">{mission_desc}</div>
                <div class="wiki-link-container">
                    <a href="{wiki_url}" target="_blank" class="wiki-link">→ Learn more on Wikipedia</a>
'''

        # Add ADSB.fi replay link if available
        if adsb_link:
            html += f'''                    <br>
                    <a href="{adsb_link}" target="_blank" class="wiki-link">→ View flight replay on ADSB.fi</a>
'''

        html += f'''                </div>
                <div class="encounter-details">
                    <div class="detail-item">
                        <div class="detail-label">MODE-S HEX</div>
                        <div class="detail-value">{hex_code}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">DISTANCE</div>
                        <div class="detail-value">{dist:.1f} NM</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">ALTITUDE</div>
                        <div class="detail-value">{alt:,} ft</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">CALLSIGN</div>
                        <div class="detail-value">{callsign}</div>
                    </div>
                    <div class="detail-item">
                        <div class="detail-label">TYPE CODE</div>
                        <div class="detail-value">{type_code}</div>
                    </div>
                </div>
            </div>
'''
else:
    html += '''            <div class="no-encounters">
                No military aircraft encounters logged yet.<br>
                System is monitoring for military aircraft within 50 NM.
            </div>
'''

html += '''        </div>

        <footer>
            ENDURANCE MISSION // MILITARY AIRCRAFT TRACKING // DO NOT GO GENTLE
        </footer>
    </div>
</body>
</html>
'''

# Write HTML file
with open(MILITARY_HTML, 'w') as f:
    f.write(html)

print(f"Military log page updated: {len(encounters)} total encounters")
PYTHON_SCRIPT

else
    echo "No military aircraft detected within ${RANGE_NM} NM"
fi

# Check for missing aircraft type descriptions
echo ""
echo "Checking aircraft database coverage..."
"${SCRIPT_DIR}/check-missing-aircraft.sh"
if [ $? -ne 0 ]; then
    echo "⚠️  ACTION REQUIRED: New aircraft types detected without mission profiles"
fi

exit 0
