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


# 잡은 대상의 종류. 앵커의 신뢰도가 종류마다 다르다 —
# 미니언·용병은 «싸워서» 잡으므로 가까이 있었고, 구조물도 마찬가지다.
# 포탈·배너 같은 것은 상호작용 거리가 제각각이라 뺀다.
def kill_kind(uname):
    u = uname or ""
    if u.startswith("Hero"):
        return "hero"
    if any(k in u for k in ("Minion", "Footman", "Wizard", "Ranged", "Melee",
                            "Catapult", "Siege", "Laner")):
        return "minion"
    if any(k in u for k in ("Merc", "Camp", "Golem", "Bruiser", "Knight",
                            "Slime", "Boss", "Giant", "Sapper")):
        return "merc"
    if any(k in u for k in ("TownHall", "CannonTower", "Core", "King",
                            "Moonwell", "WallRadial", "GateL")):
        return "struct"
    return ""

BUNDLED_BUILD = 91756          # py/protocol91756.py 가 만들어진 빌드

def extract(path):
    archive = mpyq.MPQArchive(path)
    protocol = _proto

    # 리플레이가 만들어진 빌드를 확인한다. 빌드마다 스키마가 달라서 다른 빌드의
    # 리플레이는 조용히 어긋난 값을 뱉을 수 있다. 담아 둔 프로토콜이 하나뿐이라
    # 일단 시도는 하되, 다르면 결과에 적어 화면에서 알 수 있게 한다.
    build = None
    try:
        header = protocol.decode_replay_header(archive.header["user_data_header"]["content"])
        build = header["m_version"]["m_baseBuild"]
    except Exception:
        pass

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
    # «무엇을 언제 어디서 잡았나» — 영웅 위치를 좁히는 앵커다.
    # SUnitDiedEvent 는 죽은 유닛의 «정확한 좌표»와 «막타 친 플레이어»를 같이 남긴다.
    # 그래서 미니언 궤적을 따로 복원할 필요가 전혀 없다 — 죽은 자리가 곧 관측점이다.
    # 잡은 영웅은 그 순간 그 자리에서 사거리 안에 있었다.
    kill_anchor = defaultdict(list)   # pid -> [초, x, y, 종류]
    # 구간 통계용 «시각이 붙은» 개인 사건. 재생구슬은 좌표가 없어 앵커로는 못 쓰지만
    # «언제 몇 개 먹었나» 는 구간 비교에 쓸모가 있다.
    globes = defaultdict(list)        # pid -> [초, ...]
    dead_time = {}                    # pid -> 총 사망 시간(초)
    team_xp = []                   # 팀별 레벨·경험치 시계열 (그래프용)

    # 플레이어의 «본체» 영웅 유닛만 추적한다.
    # 이름이 Hero 로 시작한다고 다 본체가 아니다: D.Va 조종사(HeroDVaPilot),
    # 첸의 정령(HeroChenStorm...), 아바투르 궁극 진화체, 사무로 분신 등이 섞이면
    # 한 트랙 안에서 좌표가 널뛴다. 경기 시작 때 태어난 것을 본체로 본다.
    main_unit = {}                 # pid -> 본체 유닛 이름
    hero_idx = {}                  # unitTagIndex -> pid (본체만 · 지금 살아 있는 것)
    # 유닛 식별자는 "인덱스-재활용번호" 여야 한다. 인덱스만 쓰면 서로 다른 유닛이
    # 섞인다 (실측: Born 2032건이 인덱스 253개를 돌려 쓰고, 한 인덱스는 25번 재사용).
    # 다만 SUnitPositionsEvent 는 인덱스만 주므로, 인덱스 -> 지금 살아 있는 uid 를
    # 따로 들고 다니며 Born/Died 로 갱신한다.
    live_uid = {}                  # unitTagIndex -> "인덱스-재활용번호"
    def uid_of(ev):
        return f'{ev["m_unitTagIndex"]}-{ev.get("m_unitTagRecycle", 0)}'

    tracker = list(protocol.decode_replay_tracker_events(archive.read_file("replay.tracker.events")))

    # 게임 시계의 0:00 은 «성문이 열리는 순간» 이다. 그 전은 준비 시간이라
    # 게임 내 시계에 안 잡힌다. 예전에는 gameloop//16 을 그대로 써서 화면의
    # 모든 시각이 실제보다 빨랐다 — 정식 전장 38초, 난투 전장 75초 (실측).
    # 관례로 610 을 쓰는 코드가 많은데 난투는 1206 이라 하드코딩하면 틀린다.
    T0 = 0
    for ev in tracker:
        if (ev["_event"] == "NNet.Replay.Tracker.SStatGameEvent"
                and ds(ev["m_eventName"]) == "GatesOpen"):
            T0 = ev["_gameloop"]; break
    # 16 게임루프 = 1초. 준비 시간의 사건은 0 초로 몰아 둔다 (스폰 위치 등).
    def sec_of(loop):
        return round(max(0.0, (loop - T0) / 16.0), 2)

    for ev in tracker:
        sec, et = sec_of(ev["_gameloop"]), ev["_event"]

        if et == "NNet.Replay.Tracker.SUnitBornEvent":
            idx = ev["m_unitTagIndex"]
            uid = uid_of(ev)
            uname = ds(ev["m_unitTypeName"])
            pid = ev["m_controlPlayerId"]
            tag_index_info[uid] = {"name": uname, "control": pid}
            live_uid[idx] = uid
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
            info = tag_index_info.get(uid_of(ev), {})
            uname = info.get("name", "?")
            pid = hero_idx.get(idx)
            if pid:
                tracks[pid].append([sec, ev["m_x"], ev["m_y"], "d"])

            # 막타를 친 영웅에게 «그때 그 자리 사거리 안» 이라는 앵커를 준다
            kp = ev.get("m_killerPlayerId")
            if kp and 1 <= kp <= 10 and ev["m_x"] is not None:
                kind = kill_kind(uname)
                if kind:
                    kill_anchor[kp].append([sec, ev["m_x"], ev["m_y"], kind])

            if not uname.startswith("Hero") and ("Town" in uname or "Core" in uname):
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
            if name == "RegenGlobePickedUp":
                pid = {ds(s["m_key"]): s["m_value"]
                       for s in (ev.get("m_intData") or [])}.get("PlayerID")
                if pid: globes[pid].append(sec)
            elif name == "EndOfGameTimeSpentDead":
                iv = {ds(s["m_key"]): s["m_value"] for s in (ev.get("m_intData") or [])}
                fv = {ds(s["m_key"]): s["m_value"] / 4096.0
                      for s in (ev.get("m_fixedData") or [])}
                if iv.get("PlayerID"): dead_time[iv["PlayerID"]] = round(fv.get("Time", 0), 1)
            elif name == "PeriodicXPBreakdown":
                # 팀별 레벨·경험치 시계열. 그래프에 쓴다 (타임라인에는 안 넣는다).
                ints = {ds(s["m_key"]): s["m_value"] for s in (ev.get("m_intData") or [])}
                fixed = {ds(s["m_key"]): s["m_value"] / 4096.0
                         for s in (ev.get("m_fixedData") or [])}
                team = 0 if ints.get("Team", 1) == 1 else 1
                team_xp.append({
                    "t": int(fixed.get("GameTime", sec)), "team": team,
                    "lv": ints.get("TeamLevel", 0),
                    "minion": round(fixed.get("MinionXP", 0)),
                    "hero": round(fixed.get("HeroXP", 0)),
                    "struct": round(fixed.get("StructureXP", 0)),
                    "creep": round(fixed.get("CreepXP", 0)),
                    "trickle": round(fixed.get("TrickleXP", 0)),
                })
                continue
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
    apm = defaultdict(lambda: defaultdict(int))   # userId -> 분 -> 명령 수 (APM 용)
    commands = defaultdict(list)    # userId -> [sec, x, y]   순수 이동 명령
    aims = defaultdict(list)        # userId -> [sec, x, y]   스킬 조준점
    # 어택무브(A + 클릭)는 «스킬» 로 분류되지만 실제로는 이동 명령이다.
    # 실측: 한 판에 1713건(점표적 814 · 유닛표적 899)이 나오는데, 지금까지는
    # 약한 조준점 앵커로만 써서 목적지 정보를 통째로 버리고 있었다.
    amoves = defaultdict(list)      # userId -> [sec, x, y]
    last_am = {}
    ATTACK_LINK = 26                # 실측: 공격 / A-이동
    last_sec, last_aim = {}, {}
    game_events = protocol.decode_replay_game_events(archive.read_file("replay.game.events"))
    for ev in game_events:
        if ev["_event"] != "NNet.Game.SCmdEvent":
            continue
        uid = ev["_userid"]["m_userId"]
        sec = sec_of(ev["_gameloop"])   # 트래커와 같은 시계 (성문 열림 = 0:00)
        apm[uid][int(sec // 60)] += 1   # 좌표 유무와 무관하게 «행동»으로 센다
        data = ev.get("m_data") or {}
        target = data.get("TargetPoint") or ((data.get("TargetUnit") or {}).get("m_snapshotPoint"))
        if not target:
            continue
        pt = [sec, round(target["x"] / 4096.0, 1), round(target["y"] / 4096.0, 1)]
        abil = ev.get("m_abil")
        if abil is not None and abil.get("m_abilLink") == ATTACK_LINK:
            # 어택무브는 «거기까지 걸어간다» 이므로 이동 목적지로 쓴다.
            # 다만 사거리 안에 적이 들어오면 도중에 멈춘다 — 그 시점은 알 수 없으니
            # 다음 명령이나 위치 스냅샷이 바로잡게 맡긴다.
            if last_am.get(uid) == sec:
                amoves[uid][-1] = pt
            else:
                amoves[uid].append(pt)
                last_am[uid] = sec
            continue
        if abil is not None:
            # 스킬을 그 지점에 썼다 = «그때 사거리 안에 있었다»는 약한 단서다.
            # 이동 목적지로 쓰면 안 된다 (갈처럼 이동 명령이 없는 영웅이 끌려간다).
            # 스킬 번호(abilLink)도 같이 담는다. 같은 영웅 안에서는 번호가 스킬을
            # 구분하므로 «몇 번 스킬을 언제 썼나»를 화면에 보여줄 수 있다.
            pt = pt + [abil.get("m_abilLink")]
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
        # 어느 빌드의 리플레이를 어느 프로토콜로 읽었나. 다르면 값이 조용히
        # 어긋날 수 있어 화면에서 알 수 있게 남긴다.
        "build": build, "parser_build": BUNDLED_BUILD,
        "gates_open_loop": T0,
        "format_note": "t는 게임 시작 후 초. tracks/commands 항목은 [초,x,y(,출처)] 배열. "
                       "출처 s=스폰 c=전투스냅샷 d=사망 r=부활",
        "players": players,
        "structures": structures,
        "hero_position_tracks": {pname(pid): pts for pid, pts in tracks.items()},
        # 키를 «이름»이 아니라 트랙과 같은 «이름(영웅)» 라벨로 쓴다. 예전에는 이름으로
        # 묶어서 동명이인이 있으면 한 명의 이동명령이 통째로 사라졌다.
        "movement_commands": {pname(uid + 1): pts for uid, pts in commands.items()},
        "ability_aims": {pname(uid + 1): pts for uid, pts in aims.items()},
        # 어택무브 목적지 [초, x, y] — 이동 명령과 같은 성질이지만 따로 담아
        # 효과를 따로 잴 수 있게 한다
        "attack_moves": {pname(uid + 1): pts for uid, pts in amoves.items()},
        # 잡은 것 = 위치 앵커. [초, x, y, 종류] · 종류 minion/merc/struct/hero
        "kill_anchors": {pname(pid): v for pid, v in kill_anchor.items()},
        # 재생구슬 획득 시각 [초, ...] · 총 사망 시간(초)
        "globes": {pname(pid): v for pid, v in globes.items()},
        "dead_time": {pname(pid): v for pid, v in dead_time.items()},
        "team_xp": sorted(team_xp, key=lambda r: (r["t"], r["team"])),
        # 분 단위 명령 수 (APM). {"이름(영웅)": {"0": 42, "1": 55, ...}}
        "apm": {pname(uid + 1): {str(m): n for m, n in sorted(b.items())}
                for uid, b in apm.items()},
        "timeline": timeline,
    }
    return json.dumps(out, ensure_ascii=False, separators=(",", ":"))
