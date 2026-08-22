"""Read-only MetaTrader 5 bridge for Sentinel Markets AI.

The bridge never receives credentials and intentionally exposes no order methods.
It connects to the locally running terminal selected by MetaTrader 5.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import Counter
from datetime import datetime, timezone, timedelta
from typing import Any

import MetaTrader5 as mt5


TIMEFRAMES = {
    "M1": mt5.TIMEFRAME_M1,
    "M2": mt5.TIMEFRAME_M2,
    "M3": mt5.TIMEFRAME_M3,
    "M4": mt5.TIMEFRAME_M4,
    "M5": mt5.TIMEFRAME_M5,
    "M6": mt5.TIMEFRAME_M6,
    "M10": mt5.TIMEFRAME_M10,
    "M12": mt5.TIMEFRAME_M12,
    "M15": mt5.TIMEFRAME_M15,
    "M20": mt5.TIMEFRAME_M20,
    "M30": mt5.TIMEFRAME_M30,
    "H1": mt5.TIMEFRAME_H1,
    "H2": mt5.TIMEFRAME_H2,
    "H3": mt5.TIMEFRAME_H3,
    "H4": mt5.TIMEFRAME_H4,
    "H6": mt5.TIMEFRAME_H6,
    "H8": mt5.TIMEFRAME_H8,
    "H12": mt5.TIMEFRAME_H12,
    "D1": mt5.TIMEFRAME_D1,
    "W1": mt5.TIMEFRAME_W1,
    "MN1": mt5.TIMEFRAME_MN1,
}

TIMEFRAME_SECONDS = {
    "M1": 60, "M2": 120, "M3": 180, "M4": 240, "M5": 300,
    "M6": 360, "M10": 600, "M12": 720, "M15": 900, "M20": 1200,
    "M30": 1800, "H1": 3600, "H2": 7200, "H3": 10800,
    "H4": 14400, "H6": 21600, "H8": 28800, "H12": 43200,
    "D1": 86400, "W1": 604800, "MN1": 2678400,
}

CLOCK_OFFSET_QUANTUM_SECONDS = 15 * 60
CLOCK_OFFSET_MAX_SECONDS = 14 * 60 * 60
CLOCK_SAMPLE_TOLERANCE_SECONDS = 5 * 60
_clock_info_cache: dict[str, Any] | None = None


def _clock_candidate(raw_epoch: int, now_epoch: float) -> int | None:
    """Return a plausible broker epoch offset for a currently ticking symbol.

    Some terminals expose Unix-looking values in broker-server time.  A value
    several hours in the future must never be treated as UTC.  Offsets are
    quantized to 15 minutes to support half/quarter-hour server zones while a
    five-minute residual prevents stale market ticks from becoming a clock
    calibration sample.
    """
    delta = raw_epoch - now_epoch
    rounded = int(round(delta / CLOCK_OFFSET_QUANTUM_SECONDS) * CLOCK_OFFSET_QUANTUM_SECONDS)
    if abs(rounded) > CLOCK_OFFSET_MAX_SECONDS:
        return None
    if abs(delta - rounded) > CLOCK_SAMPLE_TOLERANCE_SECONDS:
        return None
    return rounded


def _detect_broker_clock(now: datetime | None = None) -> dict[str, Any]:
    observed = now or datetime.now(timezone.utc)
    now_epoch = observed.timestamp()
    symbols = mt5.symbols_get() or ()
    raw_ticks: list[int] = []
    candidates: list[int] = []
    # Visible symbols are enough in normal operation.  The fallback keeps
    # calibration possible immediately after a clean terminal installation.
    universe = [item for item in symbols if getattr(item, "visible", False)] or list(symbols)
    for item in universe[:500]:
        tick = mt5.symbol_info_tick(item.name)
        if tick is None or not getattr(tick, "time", 0):
            continue
        raw_ticks.append(int(tick.time))

    # Closed markets leave many stale quotes in the terminal.  Those values
    # can sit near a 15-minute boundary and impersonate a timezone offset.
    # Calibrate only with the newest quote cohort from the active terminal.
    if raw_ticks:
        newest_tick = max(raw_ticks)
        raw_ticks = [
            raw_tick for raw_tick in raw_ticks
            if newest_tick - raw_tick <= CLOCK_SAMPLE_TOLERANCE_SECONDS
        ]

    for raw_tick in raw_ticks:
        candidate = _clock_candidate(raw_tick, now_epoch)
        if candidate is not None:
            candidates.append(candidate)

    if not candidates:
        return {
            "status": "UNVERIFIED",
            "offsetSeconds": 0,
            "sampleCount": 0,
            "measuredAt": observed.isoformat(),
        }

    offset, count = Counter(candidates).most_common(1)[0]
    return {
        "status": "UTC_CONFIRMED" if offset == 0 else "BROKER_CLOCK_CORRECTED",
        "offsetSeconds": offset,
        "sampleCount": count,
        "measuredAt": observed.isoformat(),
    }


def broker_clock() -> dict[str, Any]:
    global _clock_info_cache
    if _clock_info_cache is None:
        _clock_info_cache = _detect_broker_clock()
    return _clock_info_cache


def _normalized_epoch(raw_epoch: int | float, clock: dict[str, Any] | None = None) -> float:
    info = clock or broker_clock()
    return float(raw_epoch) - float(info.get("offsetSeconds", 0))


def _normalized_iso(raw_epoch: int | float, clock: dict[str, Any] | None = None) -> str:
    return datetime.fromtimestamp(_normalized_epoch(raw_epoch, clock), timezone.utc).isoformat()


def _broker_query_time(value: datetime, clock: dict[str, Any]) -> datetime:
    """Translate a normalized UTC cursor to the epoch space used by MT5."""
    return datetime.fromtimestamp(value.timestamp() + int(clock.get("offsetSeconds", 0)), timezone.utc)


def emit(payload: dict[str, Any], exit_code: int = 0) -> None:
    print(json.dumps(payload, ensure_ascii=False, separators=(",", ":")))
    raise SystemExit(exit_code)


def canonical_symbol(value: str) -> str:
    """Return a broker-independent comparison key."""
    aliases = {
        "XBT": "BTC",
        "GOLD": "XAUUSD",
        "SILVER": "XAGUSD",
        "USTEC": "NAS100",
        "US100": "NAS100",
        "NDX": "NAS100",
        "DE40": "GER40",
    }
    # Strip the explicit broker suffix before punctuation is removed.  Without
    # this, EURUSD.m became EURUSDM in portfolio/risk aggregation.
    unsuffixed = re.sub(r"\.[A-Z0-9]+$", "", value.upper().strip())
    cleaned = re.sub(r"[^A-Z0-9]", "", unsuffixed)
    for source, target in aliases.items():
        cleaned = cleaned.replace(source, target)
    return cleaned


def symbol_score(requested: str, broker_symbol: str) -> tuple[int, int, str]:
    wanted = canonical_symbol(requested)
    candidate = canonical_symbol(broker_symbol)
    if candidate == wanted:
        suffix = re.search(r"\.([A-Z0-9]+)$", broker_symbol.upper().strip())
        if suffix:
            return (1, len(suffix.group(1)), broker_symbol)
        return (0, len(broker_symbol), broker_symbol)
    if candidate.startswith(wanted):
        return (1, len(candidate) - len(wanted), broker_symbol)
    if wanted in candidate:
        return (2, len(candidate) - len(wanted), broker_symbol)
    return (99, len(candidate), broker_symbol)


def instrument_metadata(item: Any) -> dict[str, Any]:
    """Expose only read-only broker metadata needed by Sentinel's market router."""
    return {
        "symbol": item.name,
        "description": item.description,
        "path": item.path,
        "category": getattr(item, "category", "") or "",
        "exchange": getattr(item, "exchange", "") or "",
        "isin": getattr(item, "isin", "") or "",
        "sector": getattr(item, "sector", None),
        "industry": getattr(item, "industry", None),
        "currencyBase": item.currency_base,
        "currencyProfit": item.currency_profit,
        "currencyMargin": item.currency_margin,
        "tradeCalcMode": int(item.trade_calc_mode),
    }


def connect() -> None:
    if not mt5.initialize():
        code, message = mt5.last_error()
        emit({"ok": False, "error": "MT5_INIT_FAILED", "detail": message, "code": code}, 2)


def sanitized_status() -> dict[str, Any]:
    terminal = mt5.terminal_info()
    account = mt5.account_info()
    if terminal is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "TERMINAL_INFO_UNAVAILABLE", "detail": message, "code": code}
    clock = broker_clock()
    return {
        "ok": True,
        "connected": bool(terminal.connected),
        "tradeAllowed": bool(terminal.trade_allowed),
        "terminal": {
            "name": terminal.name,
            "company": terminal.company,
            "path": terminal.path,
            "dataPath": terminal.data_path,
            "build": terminal.build,
        },
        "account": None if account is None else {
            "server": account.server,
            "company": account.company,
            "currency": account.currency,
            "leverage": account.leverage,
            "tradeMode": account.trade_mode,
        },
        "checkedAt": datetime.now(timezone.utc).isoformat(),
        "clock": clock,
        "permissions": "read-only",
    }


def portfolio() -> dict[str, Any]:
    account = mt5.account_info()
    positions = mt5.positions_get()
    if account is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "ACCOUNT_INFO_UNAVAILABLE", "detail": message, "code": code}
    if positions is None:
        positions = []
    clock = broker_clock()
    rows = []
    for item in positions:
        info = mt5.symbol_info(item.symbol)
        tick = mt5.symbol_info_tick(item.symbol)
        rows.append({
            "ticket": int(item.ticket), "symbol": item.symbol, "canonical": canonical_symbol(item.symbol),
            "side": "BUY" if item.type == mt5.POSITION_TYPE_BUY else "SELL", "volume": float(item.volume),
            "priceOpen": float(item.price_open), "priceCurrent": float(item.price_current),
            "stopLoss": float(item.sl), "takeProfit": float(item.tp), "profit": float(item.profit),
            "swap": float(item.swap), "currencyProfit": info.currency_profit if info else account.currency,
            "contractSize": float(info.trade_contract_size) if info else 0.0,
            "tickSize": float(info.trade_tick_size) if info else 0.0,
            "tickValueLoss": float(info.trade_tick_value_loss) if info else 0.0,
            "bid": float(tick.bid) if tick else None, "ask": float(tick.ask) if tick else None,
            "openedAt": _normalized_iso(item.time, clock),
            "hasStop": bool(item.sl and item.sl > 0), "magic": int(item.magic)
        })
    return {"ok": True, "account": {"currency": account.currency, "balance": float(account.balance),
            "equity": float(account.equity), "margin": float(account.margin), "marginFree": float(account.margin_free),
            "marginLevel": float(account.margin_level), "profit": float(account.profit), "leverage": int(account.leverage)},
            "positions": rows, "checkedAt": datetime.now(timezone.utc).isoformat(), "clock": clock,
            "permissions": "read-only"}


def resolve_symbol(requested: str) -> dict[str, Any]:
    """Resolve a broker contract without silently choosing an ambiguous alias."""
    symbols = mt5.symbols_get()
    if symbols is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "SYMBOLS_UNAVAILABLE", "detail": message, "code": code}

    exact_name = [item for item in symbols if item.name.casefold() == requested.strip().casefold()]
    if len(exact_name) == 1:
        return {"ok": True, "item": exact_name[0], "method": "EXACT_BROKER_SYMBOL", "score": [0, 0]}

    # Canonical equality and a unique broker suffix are accepted. Generic
    # substring matches are deliberately rejected because they can map an
    # equity, index, future or CFD to a different contract.
    ranked = sorted((symbol_score(requested, item.name), item) for item in symbols)
    eligible = [(score, item) for score, item in ranked if score[0] <= 1]
    if not eligible:
        return {"ok": False, "error": "SYMBOL_NOT_FOUND", "requested": requested}

    best_key = eligible[0][0][:2]
    finalists = [(score, item) for score, item in eligible if score[:2] == best_key]
    if len(finalists) != 1:
        return {
            "ok": False,
            "error": "SYMBOL_AMBIGUOUS",
            "requested": requested,
            "candidates": [instrument_metadata(item) for _, item in finalists[:12]],
        }

    score, item = finalists[0]
    return {
        "ok": True,
        "item": item,
        "method": "EXACT_CANONICAL" if score[0] == 0 else "UNIQUE_BROKER_SUFFIX",
        "score": [score[0], score[1]],
    }


def find_symbol(requested: str) -> Any:
    resolution = resolve_symbol(requested)
    return resolution.get("item") if resolution.get("ok") else None


def catalog(search: str, limit: int) -> dict[str, Any]:
    symbols = mt5.symbols_get()
    if symbols is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "SYMBOLS_UNAVAILABLE", "detail": message, "code": code}
    query = search.casefold().strip()
    selected = [item for item in symbols if not query or query in f"{item.name} {item.description} {item.path}".casefold()]
    return {
        "ok": True,
        "total": len(symbols),
        "returned": min(len(selected), limit),
        "symbols": [{
            **instrument_metadata(item),
            "canonical": canonical_symbol(item.name),
            "digits": item.digits,
            "contractSize": item.trade_contract_size,
            "volumeMin": item.volume_min,
            "volumeMax": item.volume_max,
            "volumeStep": item.volume_step,
            "visible": bool(item.visible),
        } for item in selected[:limit]],
    }


def _serialize_candles(data: Any, clock: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    return [{
        "time": _normalized_iso(int(row["time"]), clock),
        "open": float(row["open"]), "high": float(row["high"]),
        "low": float(row["low"]), "close": float(row["close"]),
        "tickVolume": int(row["tick_volume"]), "spread": int(row["spread"]),
        "realVolume": int(row["real_volume"]),
    } for row in data]


def _rates_payload(
    requested_symbol: str,
    timeframe: str,
    resolution: dict[str, Any],
    matched: Any,
    data: Any,
    clock: dict[str, Any] | None = None,
) -> dict[str, Any]:
    clock = clock or broker_clock()
    tick = mt5.symbol_info_tick(matched.name)
    return {
        "ok": True,
        "requested": requested_symbol,
        "symbol": matched.name,
        "canonical": canonical_symbol(requested_symbol),
        "resolution": {
            "method": resolution["method"],
            "score": resolution["score"],
            "ambiguous": False,
        },
        "instrument": instrument_metadata(matched),
        "timeframe": timeframe.upper(),
        "digits": matched.digits,
        "specification": {
            "contractSize": matched.trade_contract_size,
            "tickSize": matched.trade_tick_size,
            "tickValue": matched.trade_tick_value,
            "tickValueProfit": matched.trade_tick_value_profit,
            "tickValueLoss": matched.trade_tick_value_loss,
            "volumeMin": matched.volume_min,
            "volumeMax": matched.volume_max,
            "volumeStep": matched.volume_step,
            "currencyProfit": matched.currency_profit,
            "currencyMargin": matched.currency_margin,
        },
        "tick": None if tick is None else {
            "bid": tick.bid, "ask": tick.ask, "last": tick.last,
            "time": _normalized_iso(tick.time, clock),
            "rawBrokerTime": datetime.fromtimestamp(tick.time, timezone.utc).isoformat(),
        },
        "candles": _serialize_candles(data, clock),
        "clock": clock,
        "source": "MetaTrader 5 local terminal",
        "permissions": "read-only",
        "liveOrderSent": False,
        "executionAuthorized": False,
    }


def rates(symbol: str, timeframe: str, count: int) -> dict[str, Any]:
    resolution = resolve_symbol(symbol)
    if not resolution.get("ok"):
        return {key: value for key, value in resolution.items() if key != "item"}
    matched = resolution["item"]
    mt5.symbol_select(matched.name, True)
    frame = TIMEFRAMES.get(timeframe.upper())
    if frame is None:
        return {"ok": False, "error": "INVALID_TIMEFRAME", "supported": list(TIMEFRAMES)}
    clock = broker_clock()
    # Request one extra bar and exclude the still-forming candle.  Analysis and
    # simulation must never consume shift 0 by default.
    data = mt5.copy_rates_from_pos(matched.name, frame, 0, count + 1)
    if data is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "RATES_UNAVAILABLE", "detail": message, "code": code}
    now_epoch = datetime.now(timezone.utc).timestamp()
    normalized_frame = timeframe.upper()
    closed = [
        row for row in data
        if _closed_bar(int(_normalized_epoch(row["time"], clock)), normalized_frame, now_epoch)
    ]
    return _rates_payload(symbol, timeframe, resolution, matched, closed[-count:], clock)


def _parse_utc(value: str) -> datetime | None:
    try:
        parsed = datetime.fromisoformat(value.strip().replace("Z", "+00:00"))
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        return parsed.astimezone(timezone.utc)
    except (TypeError, ValueError):
        return None


def _closed_bar(open_epoch: int, timeframe: str, now_epoch: float) -> bool:
    opened = datetime.fromtimestamp(open_epoch, timezone.utc)
    if timeframe == "MN1":
        if opened.month == 12:
            closes = opened.replace(year=opened.year + 1, month=1, day=1)
        else:
            closes = opened.replace(month=opened.month + 1, day=1)
        return closes.timestamp() <= now_epoch
    return open_epoch + TIMEFRAME_SECONDS[timeframe] <= now_epoch


def rates_after(symbol: str, timeframe: str, after: str, count: int, until: str = "") -> dict[str, Any]:
    """Return the earliest page of bars strictly after a simulation cursor.

    MT5 range queries are inclusive, so the consumer still enforces a strict
    temporal comparison. The query advances through bounded calendar windows
    to cross weekends/closures without loading an unbounded history in memory.
    """
    resolution = resolve_symbol(symbol)
    if not resolution.get("ok"):
        return {key: value for key, value in resolution.items() if key != "item"}
    matched = resolution["item"]
    mt5.symbol_select(matched.name, True)
    normalized_frame = timeframe.upper()
    frame = TIMEFRAMES.get(normalized_frame)
    if frame is None:
        return {"ok": False, "error": "INVALID_TIMEFRAME", "supported": list(TIMEFRAMES)}
    after_time = _parse_utc(after)
    if after_time is None:
        return {"ok": False, "error": "INVALID_AFTER_TIME"}

    actual_now = datetime.now(timezone.utc)
    requested_until = _parse_utc(until) if until else actual_now
    if requested_until is None or requested_until <= after_time:
        return {"ok": False, "error": "INVALID_UNTIL_TIME"}
    now = min(actual_now, requested_until)
    clock = broker_clock()
    if after_time >= now:
        payload = _rates_payload(symbol, normalized_frame, resolution, matched, [], clock)
        return {**payload, "after": after_time.isoformat(), "queryUntil": now.isoformat(),
                "hasMore": False, "pageLimit": count}

    seconds = TIMEFRAME_SECONDS[normalized_frame]
    # At most a bounded slice is requested from MT5 at a time. Four nominal
    # pages plus fourteen days covers closures while keeping M1 queries safe.
    window = max(timedelta(days=14), timedelta(seconds=seconds * count * 4))
    cursor = after_time
    max_empty_windows = 64
    for _ in range(max_empty_windows):
        query_until = min(now, cursor + window)
        data = mt5.copy_rates_range(
            matched.name, frame, _broker_query_time(cursor, clock), _broker_query_time(query_until, clock)
        )
        if data is None:
            code, message = mt5.last_error()
            return {
                "ok": False,
                "error": "RATES_UNAVAILABLE",
                "detail": message,
                "code": code,
                "after": after_time.isoformat(),
                "queryUntil": query_until.isoformat(),
            }
        if len(data):
            after_epoch = after_time.timestamp()
            now_epoch = now.timestamp()
            # MT5 can include the still-forming candle. Advancing the outcome
            # cursor with a partial OHLC would lose later changes in that bar.
            filtered = [
                row for row in data
                if int(_normalized_epoch(row["time"], clock)) > after_epoch
                and _closed_bar(int(_normalized_epoch(row["time"], clock)), normalized_frame, now_epoch)
            ]
            if filtered:
                page = filtered[:count]
                payload = _rates_payload(symbol, normalized_frame, resolution, matched, page, clock)
                return {
                    **payload,
                    "after": after_time.isoformat(),
                    "queryUntil": query_until.isoformat(),
                    "hasMore": len(filtered) > count or query_until < now,
                    "pageLimit": count,
                }
        if query_until >= now:
            payload = _rates_payload(symbol, normalized_frame, resolution, matched, [], clock)
            return {**payload, "after": after_time.isoformat(), "queryUntil": now.isoformat(),
                    "hasMore": False, "pageLimit": count}
        cursor = query_until + timedelta(seconds=1)

    return {
        "ok": False,
        "error": "RATES_AFTER_SCAN_LIMIT",
        "detail": "No se encontraron barras dentro del límite seguro de ventanas.",
        "after": after_time.isoformat(),
        "queryUntil": cursor.isoformat(),
    }


def multi_rates(symbol: str, frames: list[str], count: int) -> dict[str, Any]:
    results = {frame: rates(symbol, frame, count) for frame in frames if frame in TIMEFRAMES}
    available = [frame for frame, payload in results.items() if payload.get("ok")]
    clock = next((results[frame].get("clock") for frame in available if results[frame].get("clock")), broker_clock())
    return {
        "ok": bool(available),
        "requested": symbol,
        "requestedTimeframes": frames,
        "availableTimeframes": available,
        "results": results,
        "clock": clock,
        "source": "MetaTrader 5 local terminal",
    }


def _ema(values: list[float], period: int) -> float:
    if not values:
        return 0.0
    alpha = 2.0 / (period + 1.0)
    result = values[0]
    for value in values[1:]:
        result = alpha * value + (1.0 - alpha) * result
    return result


def _scan_frame(symbol: str, frame: int, count: int = 180) -> dict[str, Any] | None:
    rows = mt5.copy_rates_from_pos(symbol, frame, 1, count)
    if rows is None or len(rows) < 80:
        return None
    closes = [float(row["close"]) for row in rows]
    highs = [float(row["high"]) for row in rows]
    lows = [float(row["low"]) for row in rows]
    volumes = [int(row["tick_volume"]) for row in rows]
    ema20, ema50 = _ema(closes, 20), _ema(closes, 50)
    ranges = [max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1])) for i in range(1, len(closes))]
    atr = sum(ranges[-14:]) / 14 if len(ranges) >= 14 else 0.0
    slope = (closes[-1] - closes[-12]) / max(abs(closes[-12]), 1e-12) * 100
    volume_mean = sum(volumes[-30:-1]) / max(len(volumes[-30:-1]), 1)
    relative_volume = volumes[-1] / volume_mean if volume_mean else 0.0
    direction = 1 if closes[-1] > ema20 > ema50 and slope > 0 else -1 if closes[-1] < ema20 < ema50 and slope < 0 else 0
    return {"close": closes[-1], "ema20": ema20, "ema50": ema50, "atr": atr, "slopePct": slope,
            "relativeVolume": relative_volume, "direction": direction, "bars": len(rows)}


def scan_market(limit: int) -> dict[str, Any]:
    symbols = mt5.symbols_get()
    if symbols is None:
        code, message = mt5.last_error()
        return {"ok": False, "error": "SYMBOLS_UNAVAILABLE", "detail": message, "code": code}
    clock = broker_clock()
    candidates = []
    universe = [item for item in symbols if item.visible][:limit]
    if len(universe) < min(20, limit):
        universe = list(symbols)[:limit]
    for item in universe:
        mt5.symbol_select(item.name, True)
        h1 = _scan_frame(item.name, mt5.TIMEFRAME_H1)
        h4 = _scan_frame(item.name, mt5.TIMEFRAME_H4)
        tick = mt5.symbol_info_tick(item.name)
        if not h1 or not h4 or tick is None:
            continue
        aligned = h1["direction"] != 0 and h1["direction"] == h4["direction"]
        spread_points = max(0.0, (tick.ask - tick.bid) / item.point) if item.point else 0.0
        activity = min(20.0, max(0.0, h1["relativeVolume"] * 10.0))
        trend = min(45.0, abs(h1["slopePct"]) * 18.0 + abs(h4["slopePct"]) * 12.0)
        alignment = 25.0 if aligned else 8.0 if h1["direction"] or h4["direction"] else 0.0
        spread_penalty = min(25.0, spread_points / 4.0)
        tick_age_minutes = (datetime.now(timezone.utc).timestamp() - _normalized_epoch(tick.time, clock)) / 60.0
        if tick_age_minutes < -2.0:
            tick_age_minutes = float("inf")
        stale = tick_age_minutes > 30.0
        score = round(max(0.0, min(45.0 if stale else 100.0, 25.0 + trend + alignment + activity - spread_penalty)), 1)
        direction = "ESPERAR" if stale else "BUY" if aligned and h1["direction"] > 0 else "SELL" if aligned else "ESPERAR"
        candidates.append({"symbol": item.name, "canonical": canonical_symbol(item.name), "description": item.description,
                           "path": item.path, "instrument": instrument_metadata(item),
                           "direction": direction, "score": score, "spreadPoints": round(spread_points, 1),
                           "tickAgeMinutes": round(tick_age_minutes, 1), "marketStatus": "DESACTUALIZADO/CERRADO" if stale else "ACTIVO",
                           "h1": h1, "h4": h4, "observedAt": datetime.now(timezone.utc).isoformat(),
                           "clock": clock, "source": "MetaTrader 5 local terminal"})
    candidates.sort(key=lambda item: item["score"], reverse=True)
    return {"ok": True, "scanned": len(universe), "qualified": len(candidates), "candidates": candidates[:50],
            "method": "H1/H4 prefilter; deep analysis required", "permissions": "read-only",
            "checkedAt": datetime.now(timezone.utc).isoformat(), "clock": clock}


def factor_snapshot() -> dict[str, Any]:
    requested = ["EURUSD", "GBPUSD", "USDJPY", "USDCHF", "US100", "US500", "XAUUSD", "WTI", "BTCUSD"]
    clock = broker_clock()
    factors, errors = [], []
    for universal in requested:
        item = find_symbol(universal)
        if item is None:
            errors.append(f"{universal}: no disponible en el bróker")
            continue
        mt5.symbol_select(item.name, True)
        rows = mt5.copy_rates_from_pos(item.name, mt5.TIMEFRAME_H1, 1, 150)
        tick = mt5.symbol_info_tick(item.name)
        if rows is None or len(rows) < 121 or tick is None:
            errors.append(f"{universal}: historial H1 insuficiente")
            continue
        closes = [float(row["close"]) for row in rows]
        returns = [(closes[i] / closes[i-1] - 1) * 100 for i in range(1, len(closes)) if closes[i-1]]
        mean = sum(returns[-48:]) / max(1, len(returns[-48:]))
        variance = sum((x - mean) ** 2 for x in returns[-48:]) / max(1, len(returns[-48:]))
        age = (datetime.now(timezone.utc).timestamp() - _normalized_epoch(tick.time, clock)) / 60.0
        if age < -2.0:
            age = float("inf")
        factors.append({"id": universal, "symbol": item.name, "description": item.description,
                        "price": closes[-1], "change1h": (closes[-1] / closes[-2] - 1) * 100,
                        "change24h": (closes[-1] / closes[-25] - 1) * 100,
                        "change5d": (closes[-1] / closes[-121] - 1) * 100,
                        "volatility48h": variance ** 0.5, "tickAgeMinutes": age,
                        "fresh": age <= 30, "source": "MetaTrader 5 local terminal"})
    return {"ok": bool(factors), "factors": factors, "errors": errors,
            "checkedAt": datetime.now(timezone.utc).isoformat(), "clock": clock, "permissions": "read-only"}


def microstructure(symbol: str) -> dict[str, Any]:
    item = find_symbol(symbol)
    if item is None:
        return {"ok": False, "error": "SYMBOL_NOT_FOUND", "requested": symbol}
    mt5.symbol_select(item.name, True)
    now = datetime.now(timezone.utc)
    clock = broker_clock()
    ticks = mt5.copy_ticks_from(
        item.name, _broker_query_time(now - timedelta(minutes=15), clock), 10000, mt5.COPY_TICKS_ALL
    )
    if ticks is None or len(ticks) < 2:
        code, message = mt5.last_error()
        return {"ok": False, "error": "TICKS_UNAVAILABLE", "detail": message, "code": code}
    mids, spreads, buy_flags, sell_flags, real_volume = [], [], 0, 0, 0.0
    for tick in ticks:
        bid, ask = float(tick["bid"]), float(tick["ask"])
        if bid > 0 and ask > 0:
            mids.append((bid + ask) / 2)
            spreads.append((ask - bid) / item.point if item.point else ask - bid)
        flags = int(tick["flags"])
        if flags & mt5.TICK_FLAG_BUY: buy_flags += 1
        if flags & mt5.TICK_FLAG_SELL: sell_flags += 1
        real_volume += float(tick["volume_real"])
    upticks = sum(1 for a, b in zip(mids, mids[1:]) if b > a)
    downticks = sum(1 for a, b in zip(mids, mids[1:]) if b < a)
    directional = upticks + downticks
    tick_imbalance = (upticks - downticks) / directional if directional else 0.0
    trade_flags = buy_flags + sell_flags
    trade_imbalance = (buy_flags - sell_flags) / trade_flags if trade_flags else None
    depth, depth_available = [], False
    if mt5.market_book_add(item.name):
        try:
            book = mt5.market_book_get(item.name) or []
            depth = [{"type": int(row.type), "price": float(row.price), "volume": float(row.volume_dbl)} for row in book]
            depth_available = bool(depth)
        finally:
            mt5.market_book_release(item.name)
    sell_depth = sum(x["volume"] for x in depth if x["type"] in (1, 3))
    buy_depth = sum(x["volume"] for x in depth if x["type"] in (2, 4))
    depth_total = buy_depth + sell_depth
    return {"ok": True, "requested": symbol, "symbol": item.name, "windowMinutes": 15,
            "tickCount": len(ticks), "midObservations": len(mids), "spreadPointsCurrent": spreads[-1] if spreads else None,
            "spreadPointsMean": sum(spreads) / len(spreads) if spreads else None,
            "spreadPointsMax": max(spreads) if spreads else None, "tickImbalance": tick_imbalance,
            "tradeFlagImbalance": trade_imbalance, "buyTradeFlags": buy_flags, "sellTradeFlags": sell_flags,
            "realVolume": real_volume, "depthAvailable": depth_available, "depth": depth,
            "buyDepth": buy_depth, "sellDepth": sell_depth,
            "depthImbalance": (buy_depth - sell_depth) / depth_total if depth_total else None,
            "quality": "REAL_TRADES_AND_DOM" if real_volume > 0 and depth_available else "BROKER_TICKS_AND_OPTIONAL_DOM",
            "observedAt": now.isoformat(), "clock": clock,
            "source": "MetaTrader 5 local terminal", "permissions": "read-only"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["status", "catalog", "rates", "rates_after", "multi_rates", "scan", "portfolio", "factors", "microstructure"])
    parser.add_argument("--search", default="")
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--symbol", default="EUR/USD")
    parser.add_argument("--timeframe", default="H1")
    parser.add_argument("--timeframes", default=",".join(TIMEFRAMES))
    parser.add_argument("--count", type=int, default=300)
    parser.add_argument("--after", default="")
    parser.add_argument("--until", default="")
    args = parser.parse_args()
    connect()
    try:
        if args.command == "status":
            emit(sanitized_status())
        if args.command == "portfolio":
            emit(portfolio())
        if args.command == "factors":
            emit(factor_snapshot())
        if args.command == "microstructure":
            emit(microstructure(args.symbol))
        if args.command == "catalog":
            emit(catalog(args.search, max(1, min(args.limit, 2000))))
        if args.command == "scan":
            emit(scan_market(max(10, min(args.limit, 500))))
        if args.command == "multi_rates":
            frames = [item.strip().upper() for item in args.timeframes.split(",") if item.strip()]
            emit(multi_rates(args.symbol, frames, max(60, min(args.count, 1000))))
        if args.command == "rates_after":
            emit(rates_after(args.symbol, args.timeframe, args.after, max(1, min(args.count, 5000)), args.until))
        emit(rates(args.symbol, args.timeframe, max(10, min(args.count, 5000))))
    finally:
        mt5.shutdown()


if __name__ == "__main__":
    main()
