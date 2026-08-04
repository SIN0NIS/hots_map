# -*- coding: utf-8 -*-
"""
히오스 리플레이 타임라인 추출기 v4 (구조물 좌표 포함)
- player_command: 플레이어당 초당 1개로 다운샘플, [초, x, y] 배열로 저장
- hero_position_tracks: [초, x, y, 출처코드] 배열 (s=스폰, c=전투스냅샷, d=사망)
- timeline: 의미있는 이벤트만 (킬/철거/용병/오브젝트/레벨업/특성 등)
- 들여쓰기 없음, 좌표 소수점 1자리
사용법: python extract_replay_v3.py 리플레이.StormReplay [--gzip]
"""
import sys, json, gzip, mpyq
from collections import defaultdict
import protocol91756 as _proto

# 타임라인에서 제외할 저가치 반복 이벤트 (원하면 여기서 조절)
SKIP_STAT = {"RegenGlobePickedUp", "PeriodicXPBreakdown", "PlayerInit",
             "TownStructureInit", "JungleCampInit", "LootSprayUsed",
             "LootWheelUsed", "LootVoiceLineUsed", "EndOfGameRegenMasterStacks",
             "EndOfGameUpVotesCollected"}

def ds(v):
    return v.decode("utf-8", errors="replace") if isinstance(v, bytes) else v

def extract(path):
    archive = mpyq.MPQArchive(path)
    protocol = _proto

    details = protocol.decode_replay_details(archive.read_file("replay.details"))
    players = {}
    for i, p in enumerate(details["m_playerList"]):
        players[i] = {"name": ds(p["m_name"]), "hero": ds(p["m_hero"]),
                      "team": p["m_teamId"],
                      "result": "win" if p["m_result"] == 1 else "loss"}
    def pname(one_based):
        p = players.get(one_based - 1)
        return f"{p['name']}({p['hero']})" if p else f"?{one_based}"

    timeline = []
    tag_index_info = {}
    tracks = defaultdict(list)     # pid -> [sec, x, y, src]
    structures = []                # 게임 시작 시 구조물 좌표 (SVG 정렬용)

    tracker = protocol.decode_replay_tracker_events(archive.read_file("replay.tracker.events"))
    for ev in tracker:
        sec, et = ev["_gameloop"] // 16, ev["_event"]

        if et == "NNet.Replay.Tracker.SUnitBornEvent":
            idx = ev["m_unitTagIndex"]
            uname = ds(ev["m_unitTypeName"])
            tag_index_info[idx] = {"name": uname, "control": ev["m_controlPlayerId"]}
            if uname.startswith("Hero"):
                tracks[ev["m_controlPlayerId"]].append([sec, ev["m_x"], ev["m_y"], "s"])
            elif ev["_gameloop"] < 16 and any(k in uname for k in
                    ("TownHall", "CannonTower", "Moonwell", "Core", "GateL",
                     "WallRadial", "MercCampCaptureBeacon", "King")):
                structures.append({"unit": uname, "x": ev["m_x"], "y": ev["m_y"]})

        elif et == "NNet.Replay.Tracker.SUnitDiedEvent":
            idx = ev["m_unitTagIndex"]
            info = tag_index_info.get(idx, {})
            uname = info.get("name", "?")
            if uname.startswith("Hero"):
                tracks[info.get("control")].append([sec, ev["m_x"], ev["m_y"], "d"])
            elif "Town" in uname or "Core" in uname:
                timeline.append({"t": sec, "e": "structure_died", "unit": uname,
                                 "x": ev["m_x"], "y": ev["m_y"]})

        elif et == "NNet.Replay.Tracker.SUnitPositionsEvent":
            idx = ev["m_firstUnitIndex"]
            items = ev["m_items"]
            for i in range(0, len(items), 3):
                idx += items[i]
                info = tag_index_info.get(idx)
                if info and info["name"].startswith("Hero"):
                    tracks[info["control"]].append([sec, items[i+1], items[i+2], "c"])

        elif et == "NNet.Replay.Tracker.SStatGameEvent":
            name = ds(ev["m_eventName"])
            if name in SKIP_STAT:
                continue
            rec = {"t": sec, "e": name}
            multi = defaultdict(list)
            for s in (ev.get("m_stringData") or []):
                multi[ds(s["m_key"])].append(ds(s["m_value"]))
            for s in (ev.get("m_intData") or []):
                multi[ds(s["m_key"])].append(s["m_value"])
            for s in (ev.get("m_fixedData") or []):
                multi[ds(s["m_key"])].append(round(s["m_value"] / 4096.0, 1))
            for k, vals in multi.items():
                rec[k] = vals[0] if len(vals) == 1 else vals
            if isinstance(rec.get("PlayerID"), int):
                rec["player"] = pname(rec["PlayerID"])
            if "KillingPlayer" in rec:
                kills = rec["KillingPlayer"]
                rec["killers"] = [pname(k) for k in (kills if isinstance(kills, list) else [kills])]
                del rec["KillingPlayer"]
            rec.pop("PlayerID", None)
            rec.pop("GameTime", None)   # t와 중복
            timeline.append(rec)

    # 이동/공격 명령: 플레이어당 초당 1개로 다운샘플
    commands = defaultdict(list)    # 플레이어이름 -> [sec, x, y]
    last_sec = {}
    game_events = protocol.decode_replay_game_events(archive.read_file("replay.game.events"))
    for ev in game_events:
        if ev["_event"] != "NNet.Game.SCmdEvent":
            continue
        data = ev.get("m_data") or {}
        target = data.get("TargetPoint") or ((data.get("TargetUnit") or {}).get("m_snapshotPoint"))
        if not target:
            continue
        uid = ev["_userid"]["m_userId"]
        sec = ev["_gameloop"] // 16
        if last_sec.get(uid) == sec:     # 같은 초의 명령은 마지막 것으로 교체
            commands[uid][-1] = [sec, round(target["x"]/4096.0, 1), round(target["y"]/4096.0, 1)]
        else:
            commands[uid].append([sec, round(target["x"]/4096.0, 1), round(target["y"]/4096.0, 1)])
            last_sec[uid] = sec

    timeline.sort(key=lambda e: e["t"])
    out = {
        "map": ds(details["m_title"]),
        "format_note": "t는 게임 시작 후 초. tracks/commands 항목은 [초,x,y(,출처)] 배열. 출처 s=스폰 c=전투스냅샷 d=사망",
        "players": players,
        "structures": structures,
        "hero_position_tracks": {pname(pid): pts for pid, pts in tracks.items()},
        "movement_commands": {(players.get(uid, {}) or {}).get("name", f"user{uid}"): pts
                              for uid, pts in commands.items()},
        "timeline": timeline,
    }
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))
