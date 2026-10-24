/* ==========================================================
   ADVANCE CLASH — RULE ENGINE  (แท็บ: Move & Siege Combat)
   State = POJO ทั้งหมด → บันทึก/ดู replay / ทดสอบใน node ง่าย
   ฝั่งผู้เล่น = p0 (ล่างกระดาน), ฝั่ง AI = p1 (บนกระดาน)
   ========================================================== */
const Engine = (function () {

  const R = RULES;
  let UID = 1;

  /* ---------------- utils ---------------- */
  const key = (r, c) => r + ',' + c;
  const parseKey = k => k.split(',').map(Number);
    const card = id => CARD_INDEX[id];

  function mulberry32(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function rngInt(S, n) { return Math.floor(S.rng() * n); }
  function shuffle(arr, rng) {
    for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1));[arr[i], arr[j]] = [arr[j], arr[i]]; }
    return arr;
  }

  function log(S, msg, kind) { S.log.push({ t: S.turn, p: S.active, msg, kind: kind || 'info' }); }

  /* side helpers ------------------------------------------------ */
  const CORE_CELL = { p0: { r: R.boardRows - 1, c: R.coreCol }, p1: { r: 0, c: R.coreCol } };
  const foe = side => (side === 'p0' ? 'p1' : 'p0');
  const homeRows = side => (side === 'p0' ? R.ownRows : R.foeRows);
  const isHome = (side, r) => homeRows(side).includes(r);
  const dist = (a, b) => Math.abs(a.r - b.r) + Math.abs(a.c - b.c);
  const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];

  function at(S, r, c) {
    for (const uid in S.units) { const u = S.units[uid]; if (u.r === r && u.c === c) return u; }
    return null;
  }
  const inBoard = (r, c) => r >= 0 && r < R.boardRows && c >= 0 && c < R.boardCols;
  const isCoreCell = (r, c) => (r === CORE_CELL.p0.r || r === CORE_CELL.p1.r) && c === R.coreCol;
  const isCoreRow = r => (r === CORE_CELL.p0.r || r === CORE_CELL.p1.r);   // แถวฐาน = ห้ามunit เข้า
  const unitList = S => Object.values(S.units);
  const sideUnits = (S, s) => unitList(S).filter(u => u.side === s);
  const hasKw = u => k => (card(u.cardId).keywords || []).includes(k);

  /* ---------------- setup ---------------- */
  function init(opts) {
    opts = opts || {};
    UID = 1;
    const seed = opts.seed || Math.floor(Math.random() * 1e9);
    const rng = mulberry32(seed);
    const S = {
      seed, turn: 0, active: 'p0', round: 0,
      units: {}, log: [], pending: null, winner: null,
      humanSide: opts.humanSide || 'p0', first: opts.p1GoesFirst ? 'p1' : 'p0',
      players: {}
    };
    // rng อยู่ใน state ไม่ได้ (function) → เก็บเป็น mutable ผ่าน closure ข้างนอก
    S._nextRandom = rng;
    ['p0', 'p1'].forEach(side => {
      const dkey = side === 'p0' ? (opts.p0deck || 'ember') : (opts.p1deck || 'tide');
      const deck = DECKS[dkey];
      S.players[side] = {
        side, deckKey: dkey, deckName: deck.name, coreName: deck.coreName,
        deck: shuffle(deck.main.slice(), rng), hand: [], drop: [], damage: [],
        force: 0, coreHP: R.coreHP, coreLevel: 1, convertedThisTurn: 0, promotedThisTurn: false,
      };
    });
    // จั่วเริ่มต้น
    ['p0', 'p1'].forEach(side => { for (let i = 0; i < 4; i++) draw(S, side, true); });
    S.active = S.first;
    startTurn(S);
    return S;
  }

  function roll(S, n) { return Math.floor(S._nextRandom() * n); }

  function draw(S, side, quiet) {
    const p = S.players[side];
    if (!p.deck.length) {
      if (!quiet) { log(S, `${p.deckName} หมดสมุด — พ่ายแพ้`, 'bad'); S.winner = foe(side); }
      return null;
    }
    const id = (() => {                                  // ทริกเกอร์ไม่เข้ามือ — ผลักลงก้นสมุด
      let n = p.deck.shift(), spins = 0;
      while (n && card(n).trigger && spins++ <= p.deck.length) { p.deck.push(n); n = p.deck.shift(); }
      return n;
    })();
    if (p.hand.length >= R.handMax) {
      p.drop.push(id);
      if (!quiet) log(S, `มือเต็ม — ${card(id).name} ถูกทิ้งลง trash`, 'bad');
      return null;
    }
    p.hand.push(id);
    return id;
  }

  /* drive check: สุ่มเปิดการ์ด 1 ใบจากสมุด -> Damage Zone (ทริกเกอร์ทำงานที่นี่เท่านั้น) */
  function driveFlip(S, side) {
    const p = S.players[side];
    if (!p.deck.length) return null;
    const id = p.deck.splice(roll(S, p.deck.length), 1)[0];
    p.damage.push(id);
    return id;
  }

  function startTurn(S) {
    S.turn++; S.round++;
    S.active = S.turn % 2 === 1 ? S.first : foe(S.first);
    const side = S.active, p = S.players[side];
    p.convertedThisTurn = 0; p.promotedThisTurn = false;
    const batteries = sideUnits(S, side).filter(u => (card(u.cardId).keywords || []).includes('battery') && !u.destroyed).length;
    p.force = Math.min(R.forceCap, p.force + R.forceBase + p.coreLevel + batteries);
    draw(S, side);
    unitList(S).forEach(u => { if (u.side === side) { u.moved = 0; u.attacked = false; u.deployed = false; u.shaken = false; } });
    S.pending = null;
    log(S, `— เทิร์น ${S.turn}: ${p.deckName} (พลังขับ ${p.force}) —`, 'turn');
  }

  /* ---------------- legality ---------------- */
  function legalDeploy(S, side, handIdx) {
    const out = [];
    const id = S.players[side].hand[handIdx];
    if (id == null || card(id).trigger) return out;   // การ์ดทริกเกอร์ไม่ลงในสนาม
    const cd = card(id);
    if (S.players[side].force < cd.grade) return out;
    for (const r of homeRows(side)) for (let c = 0; c < R.boardCols; c++) {
      if (!at(S, r, c) && !isCoreRow(r)) out.push(key(r, c));
    }
    return out;
  }

  function canAct(S, u) {
    const cd = card(u.cardId);
    if (u.attacked) return false;
    if (u.moved >= (cd.move || 0)) return false;
    return true;
  }

  function adjacentEnemies(S, u) {
    return unitList(S).filter(v => v.side !== u.side && ORTH.some(d => v.r === u.r + d[0] && v.c === u.c + d[1]));
  }

  function legalMoves(S, u) {
    const cd = card(u.cardId);
    const out = new Set();
    if (u.attacked && !(cd.keywords || []).includes('swift')) return [];       // โจมตีแล้ว = ปิดเทิร์นunit นั้น
    if (u.moved >= (cd.move || 0)) return [];
    const fearless = (cd.keywords || []).includes('fearless');
    const locked = adjacentEnemies(S, u).length > 0 && !fearless;
    const stayAdjacent = k => {
      const [r, c] = parseKey(k);
      return ORTH.some(d => { const v = at(S, r + d[0], c + d[1]); return v && v.side !== u.side; });
    };
    const start = key(u.r, u.c);
    const seen = { [start]: 0 };
    const q = [[u.r, u.c, 0]];
    while (q.length) {
      const [r, c, step] = q.shift();
      if (step >= (cd.move || 0)) continue;
      for (const [dr, dc] of ORTH) {
        const nr = r + dr, nc = c + dc, k = key(nr, nc);
        if (!inBoard(nr, nc) || isCoreRow(nr)) continue;
        const occ = at(S, nr, nc);
        if (occ) { if (!fearless) continue; else if (occ.side === u.side) continue; }   // fearless เลื่อนทับได้
        if (seen[k] != null && seen[k] <= step + 1) continue;
        if (locked && !stayAdjacent(k)) continue;
        if (!occ) out.add(k);
        seen[k] = step + 1;
        q.push([nr, nc, step + 1]);
      }
    }
    return [...out];
  }

  function attackableWalls(S, u) {
    const cd = card(u.cardId);
    if ((cd.keywords || []).includes('sniper')) return [];
    return adjacentEnemies(S, u).filter(v => (card(v.cardId).keywords || []).includes('wall'));
  }

  function legalAttacks(S, u) {
    const out = [];
    const cd = card(u.cardId);
    if (u.attacked || u.deployed && !(cd.keywords || []).includes('blitz')) return out;
    const range = cd.siege || 1;
    const foes_ = unitList(S).filter(v => v.side !== u.side && dist(u, v) <= range);
    const walls = attackableWalls(S, u).filter(v => dist(u, v) <= range);
    const pool = walls.length ? walls : foes_;
    pool.forEach(v => out.push('u:' + v.uid));
    const core = CORE_CELL[foe(u.side)];
    if (!walls.length && dist(u, core) <= range) out.push('c');
    return out;
  }

  /* พลังโถมเข้าปะทะ = พลังunit + บุก(+) + units ฝ่ายเดียวกันที่ขนาบเป้า */
  function strikePower(S, u, targetU) {
    let p = effPower(S, u) + RULES.assaultBonus;
    if (targetU) {
      const sup = unitList(S).filter(v => v.side === u.side && v.uid !== u.uid && dist(v, targetU) <= 1).length;
      p += Math.min(2, sup);
    }
    return p;
  }

  function effPower(S, u) {
    const cd = card(u.cardId);
    let p = cd.power - (u.shaken ? 2 : 0);
    // rally: unit ฝ่ายเดียวกันที่มี rally อยู่ข้างเคียง -> +1
    ORTH.forEach(([dr, dc]) => {
      const v = at(S, u.r + dr, u.c + dc);
      if (v && v.side === u.side && (card(v.cardId).keywords || []).includes('rally')) p += 1;
    });
    return p;
  }

  /* ================= mutators (API) ================= */
  function deploy(S, side, handIdx, k) {
    const p = S.players[side];
    const legal = legalDeploy(S, side, handIdx);
    if (!legal.includes(k)) return { ok: false, why: 'ลงตำแหน่งนี้ไม่ได้' };
    const id = p.hand.splice(handIdx, 1)[0];
    const [r, c] = parseKey(k);
    p.force -= card(id).grade;
    S.units['' + (UID++)] = {
      uid: '' + (UID - 1), cardId: id, side, r, c, moved: 0, attacked: false,
      deployed: true, tough: (card(id).keywords || []).includes('tough') ? 1 : 0,
    };
    log(S, `ลง [${card(id).name}] ที่ช่อง ${cellName(r, c)} (จ่าย ${card(id).grade})`, 'play');
    return { ok: true };
  }

  function move(S, uid, k) {
    const u = S.units[uid];
    if (!u || u.side !== S.active) return { ok: false, why: 'unit นี้ไม่ใช่ของคุณ' };
    if (!legalMoves(S, u).includes(k)) return { ok: false, why: 'เดินไปช่องนั้นไม่ได้' };
    const cd = card(u.cardId);
    const [nr, nc] = parseKey(k);
    const forward = (u.side === 'p0' ? nr < u.r : nr > u.r);
    u.r = nr; u.c = nc; u.moved += 1;
    if (forward) { S.players[u.side].force = Math.min(R.forceCap, S.players[u.side].force + 1); }
    log(S, `เลื่อน [${cd.name}] → ${cellName(nr, nc)}${forward ? '  (+1 พลังขับ)' : ''}`, 'move');
    return { ok: true };
  }

  /* โจมตี: ถ้า defender เป็นคน → รอ choices guarding */
  function declareAttack(S, uid, target) {
    const u = S.units[uid];
    if (!u || u.side !== S.active) return { ok: false, why: 'unit นี้ไม่ใช่ของคุณ' };
    const legal = legalAttacks(S, u);
    const tKey = target === 'core' ? 'c' : 'u:' + target;
    if (!legal.includes(tKey)) return { ok: false, why: 'โจมตีเป้าหมายนี้ไม่ได้' };
    const defender = foe(u.side);
    const d = target === 'core' ? null : S.units[target];
    const opts = guardOptions(S, defender, d);
    if (defender === S.humanSide) {
      S.pending = { type: 'attack', attacker: uid, target, opts, defender };
      return { ok: true, awaiting: true };
    }
    const k = aiGuard(S, defender, u, d);
    S.pending = { type: 'attack', attacker: uid, target: target === 'core' ? 'core' : target, opts, defender };
    return resolveAttack(S, k);
  }

  function guardOptions(S, defender, d) {
    if (!d) return [0];                                  // โจมตีฐาน: ไม่มี unit ให้ guard
    const maxK = Math.min(S.players[defender].force, Math.ceil(card(d.cardId).ward / 2));
    const arr = [];
    for (let k = 0; k <= maxK; k++) arr.push(k);
    return arr;
  }

  function resolveAttack(S, guardK) {
    const pend = S.pending;
    if (!pend || pend.type !== 'attack') return { ok: false, why: 'ไม่มีคำสั่งที่ค้างอยู่' };
    S.pending = null;
    guardK = guardK || 0;
    const u = S.units[pend.attacker];
    const atkP = S.players[u.side];
    const cd = card(u.cardId);
    u.attacked = true;
    if (!(cd.keywords || []).includes('swift')) u.moved = cd.move || 0;   // ปิด action หลังโจมตี

    // ---- drive check ----
    const flipped = driveFlip(S, u.side);
    let t = { power: 0, crit: 0 };
    if (flipped) {
      atkP.damage.push(flipped);
      const fc = card(flipped);
      if (fc && fc.trigger) {
        if (fc.trigger === 'boost') t.power += fc.power || 0;
        if (fc.trigger === 'crit') t.crit += fc.crit || 0;
        if (fc.trigger === 'charge') atkP.force = Math.min(R.forceCap, atkP.force + (fc.charge || 0));
        if (fc.trigger === 'draw') draw(S, u.side);
        log(S, `★ Drive: ${fc.name} — ${fc.text}`, 'good');
      } else {
        log(S, `Drive: ${fc ? fc.name : flipped} (ไม่มีผล)`, 'dim');
      }
    }

    let power = strikePower(S, u, pend.target === 'core' ? null : S.units[pend.target]) + t.power;
    const critLvl = (cd.crit || 0) + t.crit;
    const critRoll = roll(S, 6) + 1;
    const isCrit = critLvl > 0 && critRoll >= 7 - critLvl;

    if (pend.target === 'core') {
      const dmg = Math.max(1, power - R.coreGuard) * (isCrit ? 2 : 1);
      const dP = S.players[foe(u.side)];
      dP.coreHP = Math.max(0, dP.coreHP - dmg);
      log(S, `[${cd.name}] ทะลุฐาน! ทอย ${critRoll} → ${dmg} damage ใส่ ${dP.coreName}`, isCrit ? 'good' : 'attack');
      if (dP.coreHP <= 0) S.winner = u.side;
      return { ok: true, coreHit: dmg, crit: isCrit };
    }

    const d = S.units[pend.target];
    const dcd = card(d.cardId);
    if (guardK > 0) { S.players[d.side].force -= guardK; log(S, `Guard: จ่าย ${guardK} → +${guardK * 2} พลังกัน ( ward ${dcd.ward})`, 'guard'); }
    const defP = effPower(S, d) + guardK * 2;
    log(S, `⚔ [${cd.name}] ${power}${isCrit ? ' ✦CRIT' : ''}  ปะทะ  [${dcd.name}] ${defP} — ทอย ${critRoll}`, 'attack');
    if (power > defP) {
      if (d.tough > 0) {
        d.tough--; log(S, `[${dcd.name}] ใช้ tough รับไว้ได้ (เหลือ ${d.tough} ชั้น)`, 'guard');
      } else {
        destroy(S, d);
        if ((cd.keywords || []).includes('break') || isCrit) {
          const over = Math.max(1, Math.floor((power - defP) / 3));
          const dP = S.players[d.side];
          dP.coreHP = Math.max(0, dP.coreHP - over);
          log(S, `Break → ${over} damage ทะลุฐาน`, 'good');
          if (dP.coreHP <= 0) S.winner = u.side;
        }
      }
    } else {
      d.shaken = true;
      log(S, `[${dcd.name}] กันอยู่ — การโจมตีล่ม แต่ผู้รับเกิด "เซ" (-2 พลัง, กันไม่ได้ในเทิร์นหน้า)`, 'dim');
    }
    return { ok: true };
  }

  function destroy(S, u) {
    const cd = card(u.cardId);
    delete S.units[u.uid];
    S.players[u.side].drop.push(u.cardId);
    log(S, `💥 [${cd.name}] ล้มลง`, 'bad');
    if ((cd.keywords || []).includes('scavenge')) S.players[u.side].force = Math.min(R.forceCap, S.players[u.side].force + 2);
  }

  function promote(S, side) {
    const p = S.players[side];
    if (p.promotedThisTurn || p.coreLevel >= R.coreLevelMax) return { ok: false, why: 'ยกระดับไม่ได้' };
    const cost = R.promoteCost(p.coreLevel);
    if (p.force < cost) return { ok: false, why: `ต้องจ่ายพลังขับ ${cost}` };
    p.force -= cost; p.coreLevel++; p.coreHP = Math.min(R.coreHP, p.coreHP + 2);
    p.promotedThisTurn = true;
    log(S, `▲ ยกระดับฐาน → Lv.${p.coreLevel} (พลังขับ/เทิร์น +1, ฐานฟื้น 2)`, 'good');
    return { ok: true };
  }

  function convertScar(S, side, n) {
    const p = S.players[side];
    n = Math.min(n, R.scarConvertMax - p.convertedThisTurn, p.damage.length);
    if (n <= 0) return { ok: false, why: 'แปลงไม่ได้' };
    for (let i = 0; i < n; i++) p.drop.push(p.damage.pop());
    p.convertedThisTurn += n;
    p.force = Math.min(R.forceCap, p.force + n);
    log(S, `◤ Counter Charge: แปลง Damage ${n} ใบ → +${n} พลังขับ`, 'good');
    return { ok: true };
  }

  function endTurn(S) {
    const side = S.active, p = S.players[side];
    sideUnits(S, side).forEach(u => {
      if ((card(u.cardId).keywords || []).includes('medic')) {
        p.coreHP = Math.min(R.coreHP, p.coreHP + 1);
        log(S, `medic: ฐานฟื้น 1 (เหลือ ${p.coreHP})`, 'dim');
      }
    });
    const drop = p.deck.length === 0 && p.hand.length === 0;
    if (drop) { S.winner = foe(side); log(S, 'สมุดและมือหมด — พ่ายแพ้', 'bad'); }
    startTurn(S);
    return S;
  }

  /* เดินหลายช่อง: ค่อย ๆ step ตามเส้นทางที่ engine รับรอง */
  function moveTo(S, uid, k) {
    const u = S.units[uid]; if (!u) return { ok: false, why: 'ไม่มี unit นี้' };
    const [tr, tc] = parseKey(k);
    let hops = 0;
    while (!(u.r === tr && u.c === tc) && hops++ < 8) {
      const opts = legalMoves(S, u).map(x => parseKey(x));
      if (!opts.length) return { ok: false, why: 'หาเส้นทางต่อไม่ได้' };
      opts.sort((a, b) => dist(a, { r: tr, c: tc }) - dist(b, { r: tr, c: tc }));
      const r = move(S, uid, key(opts[0][0], opts[0][1]));
      if (!r.ok) return r;
    }
    return { ok: true };
  }

  /* ================= AI ================= */
  const val = cd => cd.power + cd.ward * 0.6 + cd.move * 1.2 + (cd.siege || 1) + (cd.crit || 0) * 1.5;
  const valU = u => val(card(u.cardId));

  function aiGuard(S, defender, attacker, d) {
    const p = S.players[defender];
    if (!d) return 0;                                  // โจมตีฐาน: ไม่มีunit ให้กัน
    if (d.shaken) return 0;
    const power = strikePower(S, attacker, d);
    const mine = effPower(S, d);
    if (power <= mine && guardOptions(S, defender, d).length > 1) {
      // กันไว้ถ้าunit有价值 && มีพลังขับเหลือพอสำหรับเทิร์นหน้า
      if (card(d.cardId).grade <= 1 || p.force <= 4) return 0;
    }
    const need = Math.ceil((power - mine) / 2);
    const maxK = Math.min(p.force - (p.force > 6 ? 3 : 0), Math.ceil(card(d.cardId).ward / 2));
    const k = Math.min(need, maxK);
    if (k <= 0) return 0;
    if (card(d.cardId).grade <= 1 && k >= 2) return 0;  // อย่าเปลืองกับunit ถูก
    return k;
  }

  function bestAttack(S, u) {
    const opts = legalAttacks(S, u);
    if (!opts.length) return null;
    const enemy = S.players[foe(u.side)];
    if (opts.includes('c')) {
      const est = Math.max(1, strikePower(S, u, null) - R.coreGuard);
      if (est >= enemy.coreHP) return 'c';                         // lethal ต้องทำ
      if (sideUnits(S, u.side).length >= 2 && enemy.coreHP <= R.coreHP - 6) return 'c';
    }
    const cands = opts.filter(o => o.startsWith('u:')).map(o => {
      const d = S.units[o.slice(2)];
      const gain = strikePower(S, u, d) - (effPower(S, d) + card(d.cardId).ward);
      return { o, score: valU(d) * 0.6 + gain * 2 + dist(d, CORE_CELL[u.side]) * 0.3 };
    }).filter(x => strikePower(S, u, S.units[x.o.slice(2)]) > effPower(S, S.units[x.o.slice(2)]))
      .sort((a, b) => b.score - a.score);
    if (cands.length) return cands[0].o;
    if (opts.includes('c')) return 'c';
    const press = opts.filter(o => o.startsWith('u:')).map(o => ({ o, d: S.units[o.slice(2)] }))
      .sort((a, b) => effPower(S, a.d) - effPower(S, b.d));
    return S.turn > 4 && press.length ? press[0].o : null;
  }

  function stepToward(S, u, target) {
    const opts = legalMoves(S, u).map(x => parseKey(x));
    if (!opts.length) return false;
    opts.sort((a, b) => dist(a, target) - dist(b, target));
    if (dist(opts[0], target) >= dist({ r: u.r, c: u.c }, target)) return false;
    return move(S, u.uid, key(opts[0][0], opts[0][1])).ok;
  }

  function aiDeployCell(S, side) {
    const rows = homeRows(side);
    const front = side === 'p1' ? Math.max(...rows) : Math.min(...rows);
    const back = side === 'p1' ? front - 1 : front + 1;
    const order = [];
    [2, 1, 3, 0, 4].forEach(c => { order.push(key(front, c)); order.push(key(back, c)); });
    return order.find(k => { const [r, c] = parseKey(k); return inBoard(r, c) && !isCoreRow(r) && !at(S, r, c); });
  }

  /* เฟสเตรียมการ: แปลงรอยแผล / ยกระดับ / ลงการ์ด (ไม่ถูกขัดจังหวะ) */
  function aiSetup(S) {
    const side = S.active, p = S.players[side];
    if (p.force < 4 && p.damage.length) convertScar(S, side, 2);
    if (p.coreLevel < R.coreLevelMax && p.force >= R.promoteCost(p.coreLevel) + 2) promote(S, side);
    if (p.coreHP <= 8 && p.force >= R.promoteCost(p.coreLevel)) promote(S, side);
    let guard = 0;
    while (guard++ < 30) {
      const plays = p.hand.map((id, i) => ({ id, cd: card(id) })).filter(x => !x.cd.trigger && x.cd.grade <= p.force);
      if (!plays.length) break;
      const cell = aiDeployCell(S, side);
      if (!cell) break;
      plays.sort((a, b) => val(b.cd) - val(a.cd));
      const idx = p.hand.indexOf(plays[0].id);
      if (!deploy(S, side, idx, cell).ok) break;
    }
    S.aiQueue = unitList(S).filter(u => u.side === side)
      .sort((a, b) => effPower(S, b) - effPower(S, a)).map(u => u.uid);
    return S;
  }

  /* 1 call = 1 การกระทำของunit ในคิว (ให้ UI ไล่render เป็นแอนิเมชัน) */
  function aiStep(S) {
    if (S.pending || S.winner) return { paused: true };
    if (!S.aiQueue || !S.aiQueue.length) return { done: true };
    const uid = S.aiQueue[0], u = S.units[uid];
    if (!u) { S.aiQueue.shift(); return { acted: false }; }
    u.aiTried = (u.aiTried || 0) + 1;
    if (u.aiTried > 6) { S.aiQueue.shift(); return { acted: false }; }
    const cd = card(u.cardId);
    const blitz = (cd.keywords || []).includes('blitz');
    const atk = bestAttack(S, u);
    if (atk && !(u.deployed && !blitz) && !u.attacked) {
      declareAttack(S, uid, atk === 'c' ? 'core' : atk.slice(2));
      if (S.pending) return { paused: true };
      if (!(cd.keywords || []).includes('swift')) S.aiQueue.shift();
      return { acted: true, kind: 'attack' };
    }
    const tgt = CORE_CELL[foe(u.side)];
    if (u.moved < (cd.move || 0) && !u.attacked) {
      const before = dist(u, tgt);
      if (u.aiLastDist == null || before < u.aiLastDist) {
        if (stepToward(S, u, tgt)) { u.aiLastDist = before; return { acted: true, kind: 'move' }; }
      }
    }
    S.aiQueue.shift();
    return { acted: false };
  }

  function aiFinish(S) {
    S.aiQueue = null;
    unitList(S).forEach(u => { delete u.aiLastDist; });
    const p = S.players[S.active];
    if (p.force >= 8 && p.damage.length) convertScar(S, S.active, 1);
    if (!S.winner) endTurn(S);
    return S;
  }

  function aiTurn(S) {                                   // ใช้ในการทดสอบแบบไม่ animate
    aiSetup(S);
    let n = 0;
    while (!S.pending && !S.winner && n++ < 80) { if (aiStep(S).done) break; }
    if (!S.pending && !S.winner) aiFinish(S);
    return S;
  }


  function cellName(r, c) { return (r + 1) + String.fromCharCode(65 + c); }
  return { init, isCoreRow, cellName, moveTo, deploy, move, declareAttack, resolveAttack, promote, convertScar, endTurn, startTurn,
           legalDeploy, legalMoves, legalAttacks, guardOptions, effPower, strikePower,
           aiSetup, aiStep, aiFinish, aiTurn, cellName, driveFlip, at, unitList, sideUnits, card,
           parseKey, key, CORE_CELL, dist, foe, RULES: R };
})();
