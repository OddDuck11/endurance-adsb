#!/bin/bash

# Check for aircraft types in log that are missing from database
# Returns exit code 1 if missing types found, 0 if all covered

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MILITARY_LOG="${SCRIPT_DIR}/military-log.json"
AIRCRAFT_DB="${SCRIPT_DIR}/aircraft-missions.json"

python3 - <<'PYTHON_SCRIPT'
import json
import sys

MILITARY_LOG = "/home/vboxuser/endurance/military-log.json"
AIRCRAFT_DB = "/home/vboxuser/endurance/aircraft-missions.json"

# Load data
try:
    with open(MILITARY_LOG, 'r') as f:
        log_data = json.load(f)
    with open(AIRCRAFT_DB, 'r') as f:
        aircraft_db = json.load(f)
except FileNotFoundError:
    print("Error: Required files not found")
    sys.exit(1)

# Check which types are in log
types_in_log = set()
for encounter in log_data.get('encounters', []):
    aircraft_type = encounter.get('type')
    if aircraft_type and aircraft_type != 'null':
        types_in_log.add(aircraft_type)

# Find missing types
missing_types = [t for t in types_in_log if t not in aircraft_db]

if missing_types:
    print("⚠️  MISSING AIRCRAFT TYPE DESCRIPTIONS")
    print("=" * 50)
    for aircraft_type in sorted(missing_types):
        # Find an example encounter
        example = next((e for e in log_data['encounters'] if e.get('type') == aircraft_type), None)
        if example:
            print(f"\nType Code: {aircraft_type}")
            print(f"  Registration: {example.get('registration', 'N/A')}")
            print(f"  Callsign: {example.get('callsign', 'N/A')}")
            print(f"  Last Seen: {example.get('timestamp', 'N/A')}")
    print("\n" + "=" * 50)
    print(f"Total missing: {len(missing_types)}")
    print("Run: Ask TARS to add mission profiles for these aircraft")
    sys.exit(1)
else:
    print("✓ All detected aircraft types have mission profiles")
    print(f"  Total types covered: {len(types_in_log)}")
    sys.exit(0)
PYTHON_SCRIPT
