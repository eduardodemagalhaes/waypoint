"""
Segment enrichment router.
POST /api/segments/{id}/enrich   — enrich a single segment
POST /api/trips/{trip_id}/enrich — enrich all segments in a trip
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from app.database import get_db
from app.models.models import Segment
from app.schemas.schemas import SegmentOut
import httpx, logging
import urllib.parse
from datetime import datetime, timezone

router = APIRouter(tags=["enrich"])
log = logging.getLogger("waypoint.enrich")

SBB_API = "https://transport.opendata.ch/v1"


# ── helpers ────────────────────────────────────────────────────────────────────

def _station_name(raw: str | None) -> str | None:
    """Normalise a stored origin/destination to something the SBB API likes."""
    if not raw:
        return None
    # The API understands common spellings; strip trailing country hints like "(CH)"
    return raw.replace("(CH)", "").replace("(IT)", "").strip()


def _parse_dt(dt_str: str | None) -> datetime | None:
    if not dt_str:
        return None
    for fmt in ("%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%00", "%Y-%m-%dT%H:%M"):
        try:
            return datetime.strptime(dt_str[:16], "%Y-%m-%dT%H:%M")
        except ValueError:
            pass
    return None


async def _enrich_train(seg: Segment) -> dict:
    """
    Query transport.opendata.ch for the stationboard at the departure station
    around the departure time, find the matching train, and return enrichment
    data to merge into seg.meta.
    """
    station = _station_name(seg.origin)
    dt = _parse_dt(seg.departs_at)
    if not station or not dt:
        return {"enrich_status": "skipped", "enrich_reason": "missing origin or departs_at"}

    # transport.opendata.ch stationboard
    # We ask for departures within a ±10-minute window
    params = {
        "station": station,
        "datetime": dt.strftime("%Y-%m-%d %H:%M"),
        "type": "departure",
        "limit": 20,
    }

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            r = await client.get(f"{SBB_API}/stationboard", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.warning("SBB API error for %s: %s", station, e)
        return {"enrich_status": "api_error", "enrich_reason": str(e)}

    stationboard = data.get("stationboard", [])
    if not stationboard:
        return {"enrich_status": "no_data", "enrich_reason": "empty stationboard response"}

    # Try to match by train number stored in meta
    train_number = (seg.meta or {}).get("train_number")
    matched = None

    for entry in stationboard:
        cat  = entry.get("category", "")
        num  = str(entry.get("number", ""))
        name = entry.get("name", "")          # e.g. "EC 37"

        # Match on train number or full name (carrier field may contain "SBB EC 37")
        if train_number and num == str(train_number):
            matched = entry
            break
        if train_number and train_number in name:
            matched = entry
            break
        # Fallback: match by scheduled departure minute
        sched = entry.get("stop", {}).get("departure")
        if sched:
            sched_dt = _parse_dt(sched)
            if sched_dt and abs((sched_dt - dt).total_seconds()) <= 90:
                matched = entry
                break

    if not matched:
        return {
            "enrich_status": "no_match",
            "enrich_reason": f"train {train_number} not found in stationboard for {station} at {dt}",
        }

    stop = matched.get("stop", {})
    platform_dep = stop.get("platform") or stop.get("track")

    # Try to get arrival platform via the /connections endpoint
    platform_arr = None
    dest = _station_name(seg.destination)
    if dest:
        try:
            conn_params = {
                "from": station,
                "to": dest,
                "date": dt.strftime("%Y-%m-%d"),
                "time": dt.strftime("%H:%M"),
                "limit": 3,
            }
            async with httpx.AsyncClient(timeout=10) as client:
                rc = await client.get(f"{SBB_API}/connections", params=conn_params)
                rc.raise_for_status()
                conns = rc.json().get("connections", [])
            for conn in conns:
                sections = conn.get("sections", [])
                for sec in sections:
                    journey = sec.get("journey", {})
                    j_num = str(journey.get("number", ""))
                    j_name = journey.get("name", "")
                    if (train_number and j_num == str(train_number)) or \
                       (train_number and train_number in j_name):
                        arr_stop = sec.get("arrival", {})
                        platform_arr = arr_stop.get("platform") or arr_stop.get("track")
                        break
                if platform_arr:
                    break
        except Exception as e:
            log.warning("SBB connections API error: %s", e)

    # Real-time delay
    dep_realtime = stop.get("departureTimestamp")
    delay_min = None
    if dep_realtime:
        rt_dt = datetime.fromtimestamp(dep_realtime, tz=timezone.utc).replace(tzinfo=None)
        delay_min = int((rt_dt - dt).total_seconds() // 60)

    return {
        "enrich_status": "ok",
        "platform_departure": str(platform_dep) if platform_dep else None,
        "platform_arrival":   str(platform_arr) if platform_arr else None,
        "delay_minutes":      delay_min,
        "enrich_source":      "transport.opendata.ch",
        "enrich_at":          datetime.utcnow().isoformat(),
    }




OSM_NOMINATIM = "https://nominatim.openstreetmap.org/search"
OSM_OVERPASS  = "https://overpass-api.de/api/interpreter"
OSM_HEADERS   = {"User-Agent": "waypoint-travel-app/1.0 (ed@emdm.ch)"}


async def _nominatim_by_address(address: str, hotel_name: str) -> dict | None:
    """Geocode a street address and find the hotel via Overpass nearby."""
    # Step 1: geocode the address
    params = {"q": address, "format": "jsonv2", "limit": 1, "addressdetails": 1}
    try:
        async with httpx.AsyncClient(timeout=10, headers=OSM_HEADERS) as client:
            r = await client.get(OSM_NOMINATIM, params=params)
            r.raise_for_status()
            results = r.json()
    except Exception:
        return None

    if not results:
        return None

    lat = float(results[0]["lat"])
    lon = float(results[0]["lon"])

    # Step 2: Overpass — find tourism=hotel within 100m of that point
    overpass_q = f"""
[out:json][timeout:15];
(
  node["tourism"="hotel"](around:250,{lat},{lon});
  way["tourism"="hotel"](around:250,{lat},{lon});
  node["tourism"="apartment"](around:250,{lat},{lon});
  node["building"="hotel"](around:250,{lat},{lon});
);
out tags center;
"""
    try:
        async with httpx.AsyncClient(timeout=15, headers=OSM_HEADERS) as client:
            rq = await client.post(OSM_OVERPASS, data={"data": overpass_q})
            rq.raise_for_status()
            elements = rq.json().get("elements", [])
    except Exception:
        return None

    if not elements:
        return None

    # Pick closest / best name match
    best = elements[0]
    for el in elements:
        el_name = el.get("tags", {}).get("name", "").lower()
        if any(w in el_name for w in hotel_name.lower().split()):
            best = el
            break

    tags = best.get("tags", {})
    center = best.get("center", {})
    return {
        "phone":   tags.get("phone") or tags.get("contact:phone"),
        "website": tags.get("website") or tags.get("contact:website"),
        "stars":   tags.get("stars"),
        "lat":     str(center.get("lat") or lat),
        "lon":     str(center.get("lon") or lon),
        "osm_id":  best.get("id"),
        "osm_type": best.get("type"),
    }

async def _enrich_hotel(seg: Segment) -> dict:
    """
    Query Nominatim to find the hotel, then Overpass for phone/website details.
    Falls back gracefully at each step.
    """
    hotel_name = seg.carrier  # e.g. "Staybridge Suites Sao Paulo"
    city       = seg.origin   # e.g. "Sao Paulo"

    if not hotel_name:
        return {"enrich_status": "skipped", "enrich_reason": "no carrier/hotel name"}

    # ── Step 1: Nominatim search ────────────────────────────────────────────
    query = hotel_name if not city or city.lower() in hotel_name.lower() \
            else f"{hotel_name}, {city}"

    nom_params = {
        "q": query,
        "format": "jsonv2",
        "limit": 5,
        "addressdetails": 1,
        "extratags": 1,
    }

    try:
        async with httpx.AsyncClient(timeout=10, headers=OSM_HEADERS) as client:
            r = await client.get(OSM_NOMINATIM, params=nom_params)
            r.raise_for_status()
            results = r.json()
    except Exception as e:
        log.warning("Nominatim error for %s: %s", hotel_name, e)
        return {"enrich_status": "api_error", "enrich_reason": str(e)}

    # Filter to hotel/accommodation results; fall back to first result
    hotel_results = [x for x in results
                     if x.get("category") in ("tourism", "building")
                     or x.get("type") in ("hotel", "hostel", "motel", "guest_house",
                                           "apartment", "inn", "resort")]
    best = hotel_results[0] if hotel_results else None  # only accept hotel-category results

    if not best:
        # Fallback: try geocoding by address + Overpass proximity search
        existing_addr = (seg.meta or {}).get("address")
        fallback = None
        if existing_addr:
            fallback = await _nominatim_by_address(existing_addr, hotel_name)
        if fallback:
            return {
                "enrich_status":  "ok",
                "enrich_source":  "openstreetmap/overpass-fallback",
                "enrich_at":      datetime.utcnow().isoformat(),
                "address":        existing_addr,
                **{k: v for k, v in fallback.items() if v is not None},
            }
        # Last resort: try Nominatim with city alone to get coords,
        # then Overpass to find any hotel near city centre
        city_fallback = None
        if city:
            city_fallback = await _nominatim_by_address(city, hotel_name)
        if city_fallback:
            return {
                "enrich_status":  "ok",
                "enrich_source":  "openstreetmap/city-fallback",
                "enrich_at":      datetime.utcnow().isoformat(),
                **{k: v for k, v in city_fallback.items() if v is not None},
            }
        return {"enrich_status": "no_match",
                "enrich_reason": f"Nominatim found nothing for: {query}"}

    osm_id   = best.get("osm_id")
    osm_type = best.get("osm_type")   # node / way / relation
    lat      = best.get("lat")
    lon      = best.get("lon")

    # Nominatim extratags sometimes already has phone/website
    extratags = best.get("extratags", {})
    phone   = extratags.get("phone") or extratags.get("contact:phone")
    website = extratags.get("website") or extratags.get("url") or extratags.get("contact:website")
    stars   = extratags.get("stars") or extratags.get("tourism:stars")

    address_obj = best.get("address", {})
    road    = address_obj.get("road", "")
    number  = address_obj.get("house_number", "")
    city_nm = (address_obj.get("city") or address_obj.get("town")
               or address_obj.get("village") or "")
    postcode = address_obj.get("postcode", "")
    country  = address_obj.get("country", "")
    osm_address = ", ".join(filter(None, [
        f"{road} {number}".strip(), city_nm, postcode, country
    ])) or None

    # ── Step 2: Overpass for richer tags if phone still missing ────────────
    if not phone and osm_id and osm_type:
        type_map = {"node": "node", "way": "way", "relation": "rel"}
        osm_el = type_map.get(osm_type)
        if osm_el:
            overpass_q = f"""
[out:json][timeout:10];
{osm_el}({osm_id});
out tags;
"""
            try:
                async with httpx.AsyncClient(timeout=15, headers=OSM_HEADERS) as client:
                    rq = await client.post(OSM_OVERPASS,
                                           data={"data": overpass_q})
                    rq.raise_for_status()
                    elements = rq.json().get("elements", [])
                if elements:
                    tags = elements[0].get("tags", {})
                    phone   = phone   or tags.get("phone") or tags.get("contact:phone")
                    website = website or tags.get("website") or tags.get("contact:website")
                    stars   = stars   or tags.get("stars")
            except Exception as e:
                log.warning("Overpass error for osm_id %s: %s", osm_id, e)

    return {
        "enrich_status":  "ok",
        "phone":          phone,
        "website":        website,
        "stars":          stars,
        "address":        osm_address or seg.meta.get("address"),
        "lat":            lat,
        "lon":            lon,
        "osm_id":         osm_id,
        "osm_type":       osm_type,
        "enrich_source":  "openstreetmap",
        "enrich_at":      datetime.utcnow().isoformat(),
    }

async def _enrich_flight(seg: Segment) -> dict:
    """
    Enrich a flight segment using AviationStack live data.
    Free tier: no date filter, only currently-scheduled/live flights.
    Falls back to schema-normalised if flight not found.
    """
    import re as _re, os as _os

    flight_keys = ["cabin_class", "seat", "boarding_time", "terminal_departure",
                   "terminal_arrival", "gate", "baggage_allowance", "fare_type",
                   "ticket_number", "price", "payment_card", "source"]
    base = {k: None for k in flight_keys if k not in (seg.meta or {})}

    # Extract IATA code from carrier string or existing meta
    carrier = seg.carrier or ""
    flight_iata = ((seg.meta or {}).get("flight_iata") or
                   (seg.meta or {}).get("flight_number"))
    if not flight_iata:
        m = _re.search(r"\b([A-Z]{2}\d{2,4})\b", carrier)
        if m:
            flight_iata = m.group(1)

    if not flight_iata:
        return {
            **base,
            "enrich_status": "needs_flight_number",
            "enrich_reason": "No flight number — edit carrier field to include it (e.g. \'Swiss LX318\')",
            "enrich_at":     datetime.utcnow().isoformat(),
        }

    # Try AviationStack live lookup (free tier — no date filter)
    key = _os.getenv("AVIATIONSTACK_KEY")
    if key:
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                resp = await client.get(
                    "http://api.aviationstack.com/v1/flights",
                    params={"access_key": key, "flight_iata": flight_iata.upper(), "limit": 1}
                )
            if resp.status_code == 200:
                flights = resp.json().get("data", [])
                if flights:
                    f   = flights[0]
                    dep = f.get("departure", {})
                    arr = f.get("arrival",   {})
                    dep_terminal = dep.get("terminal")
                    dep_gate     = dep.get("gate")
                    arr_terminal = arr.get("terminal")
                    arr_gate     = arr.get("gate")
                    arr_baggage  = arr.get("baggage")
                    delay_min    = arr.get("delay") or dep.get("delay")

                    # ZRH has no terminal designations — gate prefix is the concourse
                    # Gate AB → Concourse A/B, Gate E → Concourse E etc.
                    if not dep_terminal and dep_gate and dep.get("iata") == "ZRH":
                        prefix = dep_gate.rstrip("0123456789 ")
                        dep_terminal = f"Concourse {prefix}" if prefix else None

                    # Only show delay if segment departs within 24h
                    # (free tier has no date filter — data may be today's occurrence)
                    seg_dt = _parse_dt(seg.departs_at)
                    now    = datetime.utcnow()
                    within_24h = seg_dt and abs((seg_dt - now).total_seconds()) < 86400

                    enriched = {
                        **base,
                        "flight_number":      flight_iata,
                        "flight_iata":        flight_iata,
                        "enrich_status":      "ok",
                        "enrich_source":      "aviationstack-live",
                        "enrich_at":          datetime.utcnow().isoformat(),
                        "terminal_departure": dep_terminal,
                        "terminal_arrival":   arr_terminal,
                        "gate":               dep_gate,
                        "gate_arrival":       arr_gate,
                        "baggage_claim":      arr_baggage,
                        "delay_minutes":      delay_min if within_24h else None,
                        "aircraft":           (f.get("aircraft") or {}).get("iata"),
                    }
                    # Preserve existing meta values that are richer
                    existing = seg.meta or {}
                    for k in ["cabin_class","baggage_allowance","fare_type",
                              "ticket_number","price","payment_card","seat"]:
                        if existing.get(k) and not enriched.get(k):
                            enriched[k] = existing[k]
                    return {k: v for k, v in enriched.items() if v is not None or k in base}
        except Exception as e:
            log.warning("AviationStack lookup failed for %s: %s", flight_iata, e)

    # Fallback: schema-normalised (no live data available)
    return {
        **base,
        "flight_number":  flight_iata,
        "flight_iata":    flight_iata,
        "enrich_status":  "ok",
        "enrich_source":  "schema-normalised",
        "enrich_at":      datetime.utcnow().isoformat(),
    }

async def _enrich_segment(seg: Segment) -> dict:
    if seg.type == "train":
        return await _enrich_train(seg)
    if seg.type == "hotel":
        return await _enrich_hotel(seg)
    if seg.type == "flight":
        return await _enrich_flight(seg)
    return {"enrich_status": "skipped", "enrich_reason": f"type '{seg.type}' not supported yet"}


# ── routes ─────────────────────────────────────────────────────────────────────

@router.post("/api/segments/{segment_id}/enrich", response_model=SegmentOut)
async def enrich_segment(segment_id: str, db: Session = Depends(get_db)):
    seg = db.query(Segment).filter(Segment.id == segment_id).first()
    if not seg:
        raise HTTPException(404, "Segment not found")

    enrichment = await _enrich_segment(seg)

    # Merge into meta (never wipe existing keys, only update)
    meta = dict(seg.meta or {})
    meta.update(enrichment)
    seg.meta = meta
    seg.updated_at = datetime.utcnow()
    db.commit()
    db.refresh(seg)
    return seg


@router.post("/api/trips/{trip_id}/enrich", response_model=list[SegmentOut])
async def enrich_trip(trip_id: str, db: Session = Depends(get_db)):
    segments = (
        db.query(Segment)
        .filter(Segment.trip_id == trip_id)
        .order_by(Segment.departs_at.asc())
        .all()
    )
    if not segments:
        raise HTTPException(404, "No segments found for trip")

    for seg in segments:
        enrichment = await _enrich_segment(seg)
        meta = dict(seg.meta or {})
        meta.update(enrichment)
        seg.meta = meta
        seg.updated_at = datetime.utcnow()

    db.commit()
    for seg in segments:
        db.refresh(seg)
    return segments



# ── Connection search ─────────────────────────────────────────────────────────

TRANSPORT_API = "https://transport.opendata.ch/v1"

# Fallback booking sites by country/region
BOOKING_SITES = {
    "DE": ("DB (German Rail)", "https://www.bahn.de"),
    "IT": ("Trenitalia", "https://www.trenitalia.com"),
    "FR": ("SNCF Connect", "https://www.sncf-connect.com"),
    "ES": ("Renfe", "https://www.renfe.com"),
    "NL": ("NS", "https://www.ns.nl"),
    "AT": ("ÖBB", "https://www.oebb.at"),
    "BE": ("SNCB/NMBS", "https://www.belgiantrain.be"),
    "UK": ("National Rail", "https://www.nationalrail.co.uk"),
    "default": ("Google Maps", "https://maps.google.com"),
}

# Approx distance threshold for taxi suggestion (km)
TAXI_MAX_KM = 40


async def search_connections(
    from_station: str,
    to_station: str,
    datetime_str: str,   # "YYYY-MM-DD HH:MM"
    arrive_before: str | None = None,  # constrain by arrival time
    limit: int = 4,
) -> dict:
    """
    Search train connections via transport.opendata.ch.
    Returns {"connections": [...], "source": "...", "fallback": {...}}
    """
    # First resolve station names to IDs (handles German stations too)
    async def resolve(name):
        try:
            async with httpx.AsyncClient(timeout=6, headers={"User-Agent": "waypoint/1.0"}) as c:
                r = await c.get(f"{TRANSPORT_API}/locations",
                                params={"query": name, "type": "station"})
                stations = r.json().get("stations", [])
                return stations[0] if stations else None
        except Exception:
            return None

    # ── Try DB Vendo first for German domestic routes ──────────────────────────
    if _is_german_station(from_station) and _is_german_station(to_station):
        log.info("DB Vendo: trying German route %s → %s", from_station, to_station)
        db_results = await _search_db_vendo(
            from_station, to_station, datetime_str, arrive_before, limit
        )
        if db_results:
            return {"connections": db_results, "source": "db-vendo", "fallback": None}
        log.info("DB Vendo: no results for %s → %s, falling through to SBB", from_station, to_station)

    from_st = await resolve(from_station)
    to_st   = await resolve(to_station)

    if not from_st or not to_st:
        return {
            "connections": [],
            "source": None,
            "fallback": _build_fallback(from_station, to_station, "station_not_found")
        }

    # Parse datetime; if arrive_before given, search backwards
    params = {
        "from":     from_st["id"],
        "to":       to_st["id"],
        "limit":    limit,
    }
    if arrive_before:
        params["datetime"]    = arrive_before
        params["isArrivalTime"] = 1
    else:
        params["datetime"] = datetime_str

    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": "waypoint/1.0"}) as c:
            r = await c.get(f"{TRANSPORT_API}/connections", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        return {
            "connections": [],
            "source": None,
            "fallback": _build_fallback(from_station, to_station, "api_error", str(e))
        }

    conns = data.get("connections", [])
    if not conns:
        return {
            "connections": [],
            "source": "transport.opendata.ch",
            "fallback": _build_fallback(from_station, to_station, "no_results",
                                        from_coord=from_st.get("coordinate"),
                                        to_coord=to_st.get("coordinate"))
        }

    results = []
    for c in conns:
        dep  = c.get("from", {})
        arr  = c.get("to", {})
        legs = c.get("sections", [])
        results.append({
            "departs":          dep.get("departure", "")[:16].replace("T", " "),
            "arrives":          arr.get("arrival",   "")[:16].replace("T", " "),
            "duration":         c.get("duration", ""),
            "platform_dep":     dep.get("platform"),
            "platform_arr":     arr.get("platform"),
            "transfers":        c.get("transfers", 0),
            "carrier":          legs[0].get("journey", {}).get("name") if legs else None,
            "from_name":        dep.get("station", {}).get("name", from_station),
            "to_name":          arr.get("station", {}).get("name", to_station),
        })

    return {"connections": results, "source": "transport.opendata.ch", "fallback": None}


def _build_fallback(from_st, to_st, reason, detail=None,
                    from_coord=None, to_coord=None):
    """Build a fallback suggestion: taxi (short distance) or booking websites."""
    # Estimate distance if coords available
    dist_km = None
    if from_coord and to_coord:
        import math
        lat1, lon1 = from_coord.get("x", 0), from_coord.get("y", 0)
        lat2, lon2 = to_coord.get("x", 0), to_coord.get("y", 0)
        # Haversine approx
        dlat = math.radians(lat2 - lat1)
        dlon = math.radians(lon2 - lon1)
        a = math.sin(dlat/2)**2 + math.cos(math.radians(lat1))*math.cos(math.radians(lat2))*math.sin(dlon/2)**2
        dist_km = round(6371 * 2 * math.atan2(math.sqrt(a), math.sqrt(1-a)), 1)

    suggestions = []

    # Taxi suggestion for short distances
    if dist_km and dist_km <= TAXI_MAX_KM:
        est_time = max(10, int(dist_km * 1.8))  # rough minutes
        est_cost = max(15, int(dist_km * 2.2))  # rough CHF/EUR
        suggestions.append({
            "type": "taxi",
            "label": f"Taxi (~{est_time} min, ~€{est_cost})",
            "note": f"About {dist_km}km — a taxi is a practical option",
            "search_url": f"https://maps.google.com/maps?saddr={urllib.parse.quote(from_st)}&daddr={urllib.parse.quote(to_st)}&dirflg=d"
        })

    # Booking website suggestions
    # Try to guess country from station name (rough heuristic)
    def guess_country(name):
        name_l = name.lower()
        if any(x in name_l for x in ["münchen","berlin","frankfurt","hamburg","köln","mannheim","frankenthal","heidelberg"]): return "DE"
        if any(x in name_l for x in ["milano","roma","venezia","firenze","napoli","torino"]): return "IT"
        if any(x in name_l for x in ["paris","lyon","marseille","bordeaux","toulouse","nice"]): return "FR"
        if any(x in name_l for x in ["amsterdam","rotterdam","utrecht","eindhoven"]): return "NL"
        if any(x in name_l for x in ["wien","graz","salzburg","innsbruck","linz"]): return "AT"
        if any(x in name_l for x in ["london","manchester","birmingham","edinburgh"]): return "UK"
        return "default"

    country = guess_country(from_st) or guess_country(to_st)
    site_name, site_url = BOOKING_SITES.get(country, BOOKING_SITES["default"])

    # Build a direct search URL where possible
    if country == "DE":
        search_url = f"https://www.bahn.de/buchung/fahrplan/suche#sts=true&so={urllib.parse.quote(from_st)}&zo={urllib.parse.quote(to_st)}"
    elif country == "IT":
        search_url = f"https://www.trenitalia.com/en.html"
    elif country == "FR":
        search_url = f"https://www.sncf-connect.com/en-en/train-tickets"
    else:
        search_url = f"https://maps.google.com/maps?saddr={urllib.parse.quote(from_st)}&daddr={urllib.parse.quote(to_st)}&dirflg=r"

    suggestions.append({
        "type": "website",
        "label": site_name,
        "url": search_url,
        "note": f"Search on {site_name} for this route"
    })

    # Always add Google Maps transit as backup
    if country != "default":
        suggestions.append({
            "type": "website",
            "label": "Google Maps (transit)",
            "url": f"https://maps.google.com/maps?saddr={urllib.parse.quote(from_st)}&daddr={urllib.parse.quote(to_st)}&dirflg=r",
            "note": "View transit options on Google Maps"
        })

    return {
        "reason": reason,
        "detail": detail,
        "suggestions": suggestions,
        "dist_km": dist_km,
    }


# ── DB Vendo (Deutsche Bahn) connection search ─────────────────────────────────

DB_VENDO_API = "http://localhost:3000"

_GERMAN_KEYWORDS = [
    "hbf", "bahnhof", "münchen", "berlin", "frankfurt", "hamburg", "köln",
    "mannheim", "frankenthal", "heidelberg", "dortmund", "düsseldorf",
    "stuttgart", "nürnberg", "leipzig", "dresden", "hannover", "bremen",
    "karlsruhe", "augsburg", "wiesbaden", "mainz", "freiburg", "aachen",
    "koblenz", "saarbrücken", "magdeburg", "erfurt", "rostock", "kassel",
    "ludwigshafen", "würzburg", "ulm", "bonn", "münster", "bielefeld",
]

def _is_german_station(name: str) -> bool:
    n = name.lower()
    return any(kw in n for kw in _GERMAN_KEYWORDS)


async def _search_db_vendo(
    from_station: str,
    to_station: str,
    datetime_str: str,
    arrive_before: str | None = None,
    limit: int = 4,
) -> list[dict]:
    """
    Query the self-hosted db-vendo-client container for journeys.
    Returns a list of connection dicts (same shape as transport.opendata.ch results)
    or an empty list on any error.
    """
    headers = {"User-Agent": "waypoint/1.0", "Accept": "application/json"}

    async def resolve_db(name: str) -> dict | None:
        try:
            async with httpx.AsyncClient(timeout=6, headers=headers) as c:
                r = await c.get(f"{DB_VENDO_API}/locations",
                                params={"query": name, "results": 1})
                r.raise_for_status()
                stations = r.json()
                return stations[0] if stations else None
        except Exception as e:
            log.warning("db-vendo location lookup failed for %s: %s", name, e)
            return None

    from_st = await resolve_db(from_station)
    to_st   = await resolve_db(to_station)
    if not from_st or not to_st:
        return []

    # Parse datetime
    try:
        import zoneinfo as _zi
        dt_naive = datetime.strptime(datetime_str[:16], "%Y-%m-%d %H:%M")
        # Attach Europe/Berlin tz so db-vendo receives a proper local-time ISO string
        tz_berlin = _zi.ZoneInfo("Europe/Berlin")
        dt_local  = dt_naive.replace(tzinfo=tz_berlin)
        offset    = dt_local.strftime("%z")          # e.g. "+0200"
        offset_fmt = offset[:3] + ":" + offset[3:]   # "+02:00"
        iso_dt    = dt_naive.strftime("%Y-%m-%dT%H:%M:00") + offset_fmt
    except Exception:
        iso_dt = None

    params: dict = {
        "from":    from_st["id"],
        "to":      to_st["id"],
        "results": limit,
    }
    if arrive_before:
        try:
            arr_dt = datetime.strptime(arrive_before[:16], "%Y-%m-%d %H:%M")
            params["arrival"]         = arr_dt.strftime("%Y-%m-%dT%H:%M:00.000Z")
        except ValueError:
            pass
    elif iso_dt:
        params["departure"] = iso_dt

    try:
        async with httpx.AsyncClient(timeout=12, headers=headers) as c:
            r = await c.get(f"{DB_VENDO_API}/journeys", params=params)
            r.raise_for_status()
            data = r.json()
    except Exception as e:
        log.warning("db-vendo journeys error (%s → %s): %s", from_station, to_station, e)
        return []

    journeys = data.get("journeys", [])
    if not journeys:
        return []

    results = []
    for j in journeys:
        legs = j.get("legs", [])
        if not legs:
            continue
        first_leg = legs[0]
        last_leg  = legs[-1]

        dep_place = first_leg.get("origin", {})
        arr_place = last_leg.get("destination", {})
        dep_time  = first_leg.get("plannedDeparture") or first_leg.get("departure", "")
        arr_time  = last_leg.get("plannedArrival")    or last_leg.get("arrival", "")
        dep_plat  = first_leg.get("departurePlatform")
        arr_plat  = last_leg.get("arrivalPlatform")

        # Duration
        duration = ""
        if dep_time and arr_time:
            try:
                d = datetime.fromisoformat(dep_time.replace("Z", "+00:00"))
                a = datetime.fromisoformat(arr_time.replace("Z", "+00:00"))
                mins = int((a - d).total_seconds() // 60)
                duration = f"{mins // 60:02d}d{mins % 60:02d}:{00:02d}"
            except Exception:
                pass

        # First train/product name
        carrier = None
        for leg in legs:
            line = leg.get("line", {})
            if line:
                carrier = (line.get("name") or
                           f"{line.get('product','').upper()} {line.get('fahrtNr','')}".strip())
                break

        transfers = max(0, len([l for l in legs
                                 if l.get("line") or l.get("walking") is False]) - 1)

        results.append({
            "departs":      dep_time[:16].replace("T", " ") if dep_time else "",
            "arrives":      arr_time[:16].replace("T", " ") if arr_time else "",
            "duration":     duration,
            "platform_dep": str(dep_plat) if dep_plat else None,
            "platform_arr": str(arr_plat) if arr_plat else None,
            "transfers":    transfers,
            "carrier":      carrier,
            "from_name":    dep_place.get("name", from_station),
            "to_name":      arr_place.get("name", to_station),
        })

    return results
