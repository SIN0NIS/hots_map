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

    # 플레이어의 «본체» 영웅 유닛만 추적한다.
    # 이름이 Hero 로 시작한다고 다 본체가 아니다: D.Va 조종사(HeroDVaPilot),
    # 첸의 정령(HeroChenStorm...), 아바투르 궁극 진화체, 사무로 분신 등이 섞이면
    # 한 트랙 안에서 좌표가 널뛴다. 경기 시작 때 태어난 것을 본체로 본다.
    main_unit = {}                 # pid -> 본체 유닛 이름
    hero_idx = {}                  # unitTagIndex -> pid (본체만)

    tracker = protocol.decode_replay_tracker_events(archive.read_file("replay.tracker.events"))
    for ev in tracker:
        sec, et = ev["_gameloop"] // 16, ev["_event"]

        if et == "NNet.Replay.Tracker.SUnitBornEvent":
            idx = ev["m_unitTagIndex"]
            uname = ds(ev["m_unitTypeName"])
            pid = ev["m_controlPlayerId"]
            tag_index_info[idx] = {"name": uname, "control": pid}
            hero_idx.pop(idx, None)          # 태그 번호는 재사용된다 — 옛 주인을 지운다
            if uname.startswith("Hero") and 1 <= pid <= 10:
                if pid not in main_unit:
                    main_unit[pid] = uname
                if uname == main_unit[pid]:
                    hero_idx[idx] = pid
                    tracks[pid].append([sec, ev["m_x"], ev["m_y"], "s"])
            elif ev["_gameloop"] < 16 and any(k in uname for k in
                    ("TownHall", "CannonTower", "Moonwell", "Core", "GateL",
                     "WallRadial", "MercCampCaptureBeacon", "King")):
                structures.append({"unit": uname, "x": ev["m_x"], "y": ev["m_y"]})

        elif et == "NNet.Replay.Tracker.SUnitRevivedEvent":
            # 부활은 새 유닛이 아니라 같은 유닛의 되살아남이다. 이걸 안 읽으면
            # 영웅이 죽은 자리에 ✕ 로 얼어붙은 채 다음 위치 스냅샷(15초 주기)까지 남는다.
            pid = hero_idx.get(ev["m_unitTagIndex"])
            if pid:
                tracks[pid].append([sec, ev["m_x"], ev["m_y"], "r"])

        elif et == "NNet.Replay.Tracker.SUnitDiedEvent":
            idx = ev["m_unitTagIndex"]
            info = tag_index_info.get(idx, {})
            uname = info.get("name", "?")
            pid = hero_idx.get(idx)
            if pid:
                tracks[pid].append([sec, ev["m_x"], ev["m_y"], "d"])
            elif not uname.startswith("Hero") and ("Town" in uname or "Core" in uname):
                timeline.append({"t": sec, "e": "structure_died", "unit": uname,
                                 "x": ev["m_x"], "y": ev["m_y"]})

        elif et == "NNet.Replay.Tracker.SUnitPositionsEvent":
            idx = ev["m_firstUnitIndex"]
            items = ev["m_items"]
            for i in range(0, len(items), 3):
                idx += items[i]
                pid = hero_idx.get(idx)
                if pid:
                    tracks[pid].append([sec, items[i+1], items[i+2], "c"])

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

    # 이동/공격 명령: 플레이어당 초당 1개로 다운샘플.
    # m_abil 이 있는 것은 «스킬을 그 지점에 쓴 것»이라 이동 목적지가 아니다.
    # (갈처럼 이동 명령이 아예 없는 영웅은 스킬 조준점이 전부 이동으로 오인됐다)
    commands = defaultdict(list)    # userId -> [sec, x, y]   순수 이동 명령
    aims = defaultdict(list)        # userId -> [sec, x, y]   스킬 조준점
    last_sec, last_aim = {}, {}
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
        pt = [sec, round(target["x"] / 4096.0, 1), round(target["y"] / 4096.0, 1)]
        if ev.get("m_abil") is not None:
            # 스킬을 그 지점에 썼다 = «그때 사거리 안에 있었다»는 약한 단서다.
            # 이동 목적지로 쓰면 안 된다 (갈처럼 이동 명령이 없는 영웅이 끌려간다).
            if last_aim.get(uid) == sec:
                aims[uid][-1] = pt
            else:
                aims[uid].append(pt)
                last_aim[uid] = sec
            continue
        if last_sec.get(uid) == sec:     # 같은 초의 명령은 마지막 것으로 교체
            commands[uid][-1] = pt
        else:
            commands[uid].append(pt)
            last_sec[uid] = sec

    timeline.sort(key=lambda e: e["t"])
    out = {
        "map": ds(details["m_title"]),
        "format_note": "t는 게임 시작 후 초. tracks/commands 항목은 [초,x,y(,출처)] 배열. "
                       "출처 s=스폰 c=전투스냅샷 d=사망 r=부활",
        "players": players,
        "structures": structures,
        "hero_position_tracks": {pname(pid): pts for pid, pts in tracks.items()},
        # 키를 «이름»이 아니라 트랙과 같은 «이름(영웅)» 라벨로 쓴다. 예전에는 이름으로
        # 묶어서 동명이인이 있으면 한 명의 이동명령이 통째로 사라졌다.
        "movement_commands": {pname(uid + 1): pts for uid, pts in commands.items()},
        "ability_aims": {pname(uid + 1): pts for uid, pts in aims.items()},
        "timeline": timeline,
    }
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))
