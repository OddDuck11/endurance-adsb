#!/bin/bash
# Track Aircraft Watchlist
# Queries ADSB.fi for all aircraft on watchlist and updates their status

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WATCHLIST_FILE="${SCRIPT_DIR}/watchlist.json"
ADSB_API_BASE="https://opendata.adsb.fi/api"
LAT="YOUR_LATITUDE"
LON="YOUR_LONGITUDE"

# Check if watchlist exists
if [ ! -f "$WATCHLIST_FILE" ]; then
    echo "Watchlist file not found: $WATCHLIST_FILE"
    exit 1
fi

# Read watchlist
WATCHLIST=$(cat "$WATCHLIST_FILE")
AIRCRAFT_COUNT=$(echo "$WATCHLIST" | jq '.aircraft | length')

if [ "$AIRCRAFT_COUNT" -eq 0 ]; then
    echo "No aircraft on watchlist"
    exit 0
fi

echo "Checking $AIRCRAFT_COUNT aircraft on watchlist..."
echo ""

DETECTED_COUNT=0
UPDATED_WATCHLIST="$WATCHLIST"

# Process each aircraft
for i in $(seq 0 $((AIRCRAFT_COUNT - 1))); do
    HEX=$(echo "$WATCHLIST" | jq -r ".aircraft[$i].hex // empty")
    REG=$(echo "$WATCHLIST" | jq -r ".aircraft[$i].registration // empty")
    NAME=$(echo "$WATCHLIST" | jq -r ".aircraft[$i].name // empty")
    ALERT_DIST=$(echo "$WATCHLIST" | jq -r ".aircraft[$i].alert_distance // 100")

    IDENTIFIER="${REG:-$HEX}"
    echo "[$((i+1))/$AIRCRAFT_COUNT] Checking: $IDENTIFIER ($NAME)"

    # Query ADSB.fi
    RESPONSE=""
    if [ -n "$HEX" ]; then
        RESPONSE=$(curl -s "${ADSB_API_BASE}/v2/hex/${HEX}")
    elif [ -n "$REG" ]; then
        RESPONSE=$(curl -s "${ADSB_API_BASE}/v2/registration/${REG}")
    else
        echo "  ✗ No hex or registration available"
        continue
    fi

    # Check if aircraft detected
    AC_DATA=$(echo "$RESPONSE" | jq -r '.ac[0] // empty')

    if [ -n "$AC_DATA" ] && [ "$AC_DATA" != "null" ]; then
        # Aircraft detected - extract data
        ALT=$(echo "$AC_DATA" | jq -r '.alt_baro // "N/A"')
        SPEED=$(echo "$AC_DATA" | jq -r '.gs // "N/A"')
        TRACK=$(echo "$AC_DATA" | jq -r '.track // "N/A"')
        DISTANCE=$(echo "$AC_DATA" | jq -r '.dst // "N/A"')
        CALLSIGN=$(echo "$AC_DATA" | jq -r '.flight // "N/A"' | xargs)
        SQUAWK=$(echo "$AC_DATA" | jq -r '.squawk // "N/A"')
        LAT_POS=$(echo "$AC_DATA" | jq -r '.lat // "N/A"')
        LON_POS=$(echo "$AC_DATA" | jq -r '.lon // "N/A"')
        TYPE=$(echo "$AC_DATA" | jq -r '.t // "N/A"')

        DETECTED_COUNT=$((DETECTED_COUNT + 1))

        echo "  ✓ AIRBORNE - ${ALT}ft, ${SPEED}kts, ${DISTANCE}NM"
        echo "    Callsign: $CALLSIGN | Squawk: $SQUAWK | Track: ${TRACK}°"

        # Check if within alert distance
        if [ "$DISTANCE" != "N/A" ]; then
            DIST_INT=$(echo "$DISTANCE" | cut -d. -f1)
            if [ "$DIST_INT" -le "$ALERT_DIST" ]; then
                echo "    🔔 ALERT: Within ${ALERT_DIST}NM alert distance!"

                # Send notification (if notification system available)
                if command -v notify-send &> /dev/null; then
                    notify-send "Watchlist Alert" "$IDENTIFIER detected at ${DISTANCE}NM"
                fi
            fi
        fi

        # Update watchlist with current status
        TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")
        UPDATED_WATCHLIST=$(echo "$UPDATED_WATCHLIST" | jq \
            --arg idx "$i" \
            --argjson alt "$ALT" \
            --argjson speed "$SPEED" \
            --argjson track "$TRACK" \
            --argjson dist "$DISTANCE" \
            --arg callsign "$CALLSIGN" \
            --arg squawk "$SQUAWK" \
            --arg lat "$LAT_POS" \
            --arg lon "$LON_POS" \
            --arg type "$TYPE" \
            --arg ts "$TIMESTAMP" \
            '
            .aircraft[($idx|tonumber)].current_status = {
                detected: true,
                altitude: $alt,
                speed: $speed,
                track: $track,
                distance: $dist,
                callsign: $callsign,
                squawk: $squawk,
                lat: $lat,
                lon: $lon,
                timestamp: $ts
            } |
            .aircraft[($idx|tonumber)].last_seen = $ts |
            if $type != "N/A" and .aircraft[($idx|tonumber)].type == null then
                .aircraft[($idx|tonumber)].type = $type
            else
                .
            end
        ')

        # Add encounter to history
        UPDATED_WATCHLIST=$(echo "$UPDATED_WATCHLIST" | jq \
            --arg idx "$i" \
            --arg ts "$TIMESTAMP" \
            --argjson dist "$DISTANCE" \
            --argjson alt "$ALT" \
            '
            .aircraft[($idx|tonumber)].encounters += [{
                timestamp: $ts,
                distance: $dist,
                altitude: $alt
            }]
        ')

    else
        echo "  ○ Not detected"

        # Update status as not detected
        UPDATED_WATCHLIST=$(echo "$UPDATED_WATCHLIST" | jq \
            --arg idx "$i" \
            '.aircraft[($idx|tonumber)].current_status = {detected: false}')
    fi

    # Small delay to respect rate limits (1 req/sec)
    sleep 1.2
done

# Save updated watchlist
echo "$UPDATED_WATCHLIST" > "$WATCHLIST_FILE"

echo ""
echo "Watchlist check complete: $DETECTED_COUNT of $AIRCRAFT_COUNT aircraft airborne"
