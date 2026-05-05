from fastapi import APIRouter, HTTPException, Query
import os, httpx

router = APIRouter(prefix="/api/lookup", tags=["lookup"])

AVIATIONSTACK_BASE = "http://api.aviationstack.com/v1/flights"

@router.get("/flight")
def lookup_flight(flight_iata: str = Query(...), flight_date: str = Query(...)):
    """
    Given a flight IATA code (e.g. LX392) and date (YYYY-MM-DD),
    returns scheduled departure/arrival info from AviationStack.
    """
    key = os.getenv("AVIATIONSTACK_KEY")
    if not key:
        raise HTTPException(500, "AviationStack key not configured")

    params = {
        "access_key": key,
        "flight_iata": flight_iata.upper(),
        "flight_date": flight_date,
    }
    try:
        resp = httpx.get(AVIATIONSTACK_BASE, params=params, timeout=10)
        resp.raise_for_status()
    except httpx.HTTPError as e:
        raise HTTPException(502, f"AviationStack error: {e}")

    results = resp.json().get("data", [])
    if not results:
        return {"found": False, "flight_iata": flight_iata, "flight_date": flight_date}

    f = results[0]
    dep = f.get("departure", {})
    arr = f.get("arrival", {})

    return {
        "found": True,
        "flight_iata": flight_iata.upper(),
        "flight_date": flight_date,
        "airline": f.get("airline", {}).get("name"),
        "flight_number": f.get("flight", {}).get("iata"),
        "origin_iata": dep.get("iata"),
        "origin_airport": dep.get("airport"),
        "origin_timezone": dep.get("timezone"),
        "destination_iata": arr.get("iata"),
        "destination_airport": arr.get("airport"),
        "destination_timezone": arr.get("timezone"),
        "scheduled_departure": dep.get("scheduled"),
        "scheduled_arrival": arr.get("scheduled"),
        "terminal_departure": dep.get("terminal"),
        "terminal_arrival": arr.get("terminal"),
        "gate_departure": dep.get("gate"),
        "status": f.get("flight_status"),
    }
