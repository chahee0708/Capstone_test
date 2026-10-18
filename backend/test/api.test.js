const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "test-secret";

const config = require("../config");
const { MlServiceError } = require("../services/scoreService");
const { createFakeDb, createFakeNeo4j, startServer } = require("../test-support/helpers");

const PASSWORD = "password123";
const hash = bcrypt.hashSync(PASSWORD, 4);

function seedUsers() {
  return [
    {
      id: 1, name: "홍길동", email: "user1@test.com", password: hash,
      age: 45, weight: 80, height: 170, gender: "male",
      diseases: '["고혈압"]', allergens: '["밀"]', hypertension_stage: 1,
      ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 35,
    },
    {
      id: 2, name: "이영희", email: "user2@test.com", password: hash,
      age: 55, weight: 70, height: 165, gender: "female",
      diseases: '["신장병"]', allergens: "[]", hypertension_stage: 1,
      ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 30,
    },
    {
      id: 3, name: "정하나", email: "healthy@test.com", password: hash,
      age: 30, weight: 58, height: 163, gender: "female",
      diseases: "[]", allergens: "[]", hypertension_stage: 1,
      ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 35,
    },
    {
      id: 4, name: "신규", email: "incomplete@test.com", password: hash,
      age: null, weight: null, height: null, gender: null,
      diseases: '["고혈압"]', allergens: "[]", hypertension_stage: 1,
      ldl_value: null, tg_value: null, hdl_value: null, gfr_value: 35,
    },
  ];
}

async function setup(overrides = {}) {
  const db = createFakeDb(seedUsers());
  const neo = createFakeNeo4j({ ingredients: ["밀가루", "팜유"] });
  const scored = [];
  const scoreForDiseaseUser =
    overrides.scoreForDiseaseUser ||
    (async (session, foodName, diseases, weight, height, age, gender, details) => {
      scored.push({ foodName, diseases, weight, height, age, gender, details });
      return {
        diseaseTrack: "rule",
        verdict: "주의",
        giCategory: null,
        warnings: ["나트륨 보통 (1일 기준 20%) — 주의"],
        nutrition: { sugar: 1, sodium: 2, saturatedFat: 3, protein: 4 },
        bmi: "27.7",
        evaluatedDiseases: diseases,
        unsupportedDiseases: [],
      };
    });
  const server = await startServer({
    db,
    getSession: neo.getSession,
    scoreForDiseaseUser,
  });
  return { db, neo, scored, server };
}

async function login(server, email = "user1@test.com") {
  const c = server.client();
  const r = await c.post("/auth/login", { email, password: PASSWORD });
  assert.equal(r.status, 200);
  return c;
}

// ── 인증 ───────────────────────────────────────────────────────

test("로그인 성공: httpOnly 쿠키 2종 발급, 응답에 비밀번호 없음", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    const r = await c.post("/auth/login", { email: "user1@test.com", password: PASSWORD });
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.user, { id: 1, name: "홍길동", email: "user1@test.com" });
    assert.ok(c.jar.accessToken && c.jar.refreshToken);
    for (const sc of r.setCookies) {
      assert.match(sc, /HttpOnly/i);
      assert.match(sc, /SameSite=Lax/i);
    }
    assert.equal(JSON.stringify(r.body).includes("password"), false);
  } finally {
    await server.close();
  }
});

test("로그인 실패: 잘못된 비밀번호/없는 계정 모두 동일한 401 메시지", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    const a = await c.post("/auth/login", { email: "user1@test.com", password: "wrong-password" });
    const b = await c.post("/auth/login", { email: "nobody@test.com", password: PASSWORD });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.body.message, b.body.message);
  } finally {
    await server.close();
  }
});

test("로그인: 이메일 대소문자/공백을 정규화한다", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    const r = await c.post("/auth/login", { email: "  USER1@Test.com ", password: PASSWORD });
    assert.equal(r.status, 200);
  } finally {
    await server.close();
  }
});

test("로그인: 문자열이 아닌 입력은 500 이 아니라 400", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    const r = await c.post("/auth/login", { email: { $ne: "" }, password: ["x"] });
    assert.equal(r.status, 400);
  } finally {
    await server.close();
  }
});

test("회원가입: 프로필이 함께 저장되고 즉시 로그인 상태가 된다", async () => {
  const { server, db } = await setup();
  try {
    const c = server.client();
    const r = await c.post("/auth/register", {
      name: "신규가입",
      email: "New@Test.com",
      password: "longenough1",
      profile: {
        age: "36",
        weight: "72",
        height: "176",
        gender: "male",
        diseases: ["고혈압", "이상지질혈증"],
        allergens: ["우유"],
        hypertension_stage: "Stage II",
        ldl_value: "165",
        tg_value: "",
        hdl_value: "38",
      },
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.user.email, "new@test.com");

    const saved = db.users.find((u) => u.email === "new@test.com");
    assert.equal(saved.age, 36);
    assert.equal(saved.gender, "male");
    assert.equal(saved.hypertension_stage, 2);
    assert.equal(saved.ldl_value, 165);
    assert.equal(saved.tg_value, null);
    assert.equal(saved.diseases, JSON.stringify(["고혈압", "이상지질혈증"]));
    assert.notEqual(saved.password, "longenough1"); // 해시로 저장
    assert.ok(await bcrypt.compare("longenough1", saved.password));

    const me = await c.get("/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.name, "신규가입");
  } finally {
    await server.close();
  }
});

test("회원가입: 프로필 없이도 가입된다", async () => {
  const { server, db } = await setup();
  try {
    const c = server.client();
    const r = await c.post("/auth/register", {
      name: "프로필없음",
      email: "bare@test.com",
      password: "longenough1",
    });
    assert.equal(r.status, 201);
    const saved = db.users.find((u) => u.email === "bare@test.com");
    assert.equal(saved.diseases, "[]");
    assert.equal(saved.age, null);
  } finally {
    await server.close();
  }
});

test("회원가입 검증: 짧은 비밀번호/중복 이메일/잘못된 이메일/잘못된 프로필", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    const base = { name: "홍", email: "ok@test.com", password: "longenough1" };

    assert.equal((await c.post("/auth/register", { ...base, password: "short" })).status, 400);
    assert.equal((await c.post("/auth/register", { ...base, email: "not-an-email" })).status, 400);
    assert.equal((await c.post("/auth/register", { ...base, email: "user1@test.com" })).status, 409);
    assert.equal(
      (await c.post("/auth/register", { ...base, profile: { age: 500 } })).status,
      400
    );
  } finally {
    await server.close();
  }
});

test("로그아웃: 쿠키 삭제 후 보호된 API 는 401", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    assert.equal((await c.get("/auth/me")).status, 200);
    await c.post("/auth/logout");
    assert.equal((await c.get("/auth/me")).status, 401);
  } finally {
    await server.close();
  }
});

test("토큰 갱신: refreshToken 으로 accessToken 을 다시 받는다", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    delete c.jar.accessToken; // access 만료 상황
    assert.equal((await c.get("/auth/me")).status, 401);

    const r = await c.post("/auth/refresh");
    assert.equal(r.status, 200);
    assert.ok(c.jar.accessToken);
    assert.equal((await c.get("/auth/me")).status, 200);
  } finally {
    await server.close();
  }
});

test("토큰 혼용 방지: refresh 토큰을 access 로 쓸 수 없고, access 토큰으로 refresh 할 수 없다", async () => {
  const { server } = await setup();
  try {
    const c = await login(server);
    const refresh = c.jar.refreshToken;
    const access = c.jar.accessToken;

    const c2 = server.client();
    c2.jar.accessToken = refresh;
    assert.equal((await c2.get("/auth/me")).status, 401);

    const c3 = server.client();
    c3.jar.refreshToken = access;
    assert.equal((await c3.post("/auth/refresh")).status, 401);
  } finally {
    await server.close();
  }
});

test("type 클레임이 없는 구버전/위조 토큰은 거부된다", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    c.jar.accessToken = jwt.sign({ id: 1, email: "user1@test.com", name: "x" }, config.JWT_SECRET);
    assert.equal((await c.get("/users/1")).status, 401);

    c.jar.accessToken = jwt.sign({ id: 1, type: "access" }, "wrong-secret");
    assert.equal((await c.get("/users/1")).status, 401);
  } finally {
    await server.close();
  }
});

test("인증 없이는 보호된 API 접근 불가", async () => {
  const { server } = await setup();
  try {
    const c = server.client();
    assert.equal((await c.get("/users/1")).status, 401);
    assert.equal((await c.post("/recommend", { foodName: "라면" })).status, 401);
  } finally {
    await server.close();
  }
});

// ── 사용자 프로필 (IDOR 방지) ───────────────────────────────────

test("IDOR: 다른 사용자의 프로필을 조회/수정할 수 없다", async () => {
  const { server, db } = await setup();
  try {
    const c = await login(server, "user1@test.com");

    assert.equal((await c.get("/users/2")).status, 403);
    const put = await c.put("/users/2", { weight: 1 });
    assert.equal(put.status, 403);
    assert.equal(db.users.find((u) => u.id === 2).weight, 70); // 변경되지 않음

    assert.equal((await c.get("/users/abc")).status, 403);
    assert.equal((await c.get("/users/1%20OR%201=1")).status, 403);
  } finally {
    await server.close();
  }
});

test("본인 프로필 조회: 비밀번호/이메일 없이 반환, /users/me 도 동작", async () => {
  const { server } = await setup();
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.get("/users/1");
    assert.equal(r.status, 200);
    assert.deepEqual(r.body.diseases, ["고혈압"]);
    assert.equal("password" in r.body, false);
    assert.equal("email" in r.body, false);

    const me = await c.get("/users/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.id, 1);
  } finally {
    await server.close();
  }
});

test("프로필 수정: 부분 업데이트, 검증 실패 시 400, 변경 없는 필드는 유지", async () => {
  const { server, db } = await setup();
  try {
    const c = await login(server, "user1@test.com");

    const ok = await c.put("/users/1", { weight: 75.5, allergens: ["우유", "밀"] });
    assert.equal(ok.status, 200);
    const u = db.users.find((x) => x.id === 1);
    assert.equal(u.weight, 75.5);
    assert.equal(u.allergens, '["우유","밀"]');
    assert.equal(u.height, 170); // 건드리지 않음
    assert.equal(u.name, "홍길동");

    assert.equal((await c.put("/users/1", { age: -1 })).status, 400);
    assert.equal((await c.put("/users/1", {})).status, 400);
    assert.equal(db.users.find((x) => x.id === 1).age, 45);
  } finally {
    await server.close();
  }
});

test("프로필 수정: 허용되지 않은 필드(email/password/id)는 무시된다", async () => {
  const { server, db } = await setup();
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.put("/users/1", {
      weight: 71,
      email: "hacker@evil.com",
      password: "x",
      id: 999,
    });
    assert.equal(r.status, 200);
    const u = db.users.find((x) => x.id === 1);
    assert.equal(u.email, "user1@test.com");
    assert.equal(u.password, hash);
    assert.equal(u.id, 1);
  } finally {
    await server.close();
  }
});

// ── 추천 ───────────────────────────────────────────────────────

test("추천: body 의 userId 는 무시하고 로그인한 사용자 정보로 판정한다", async () => {
  const { server, scored } = await setup();
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.post("/recommend", { foodName: "라면", userId: 2 });
    assert.equal(r.status, 200);
    assert.equal(scored.length, 1);
    assert.deepEqual(scored[0].diseases, ["고혈압"]); // user1 의 질환 (user2 는 신장병)
    assert.equal(scored[0].weight, 80);
    assert.equal(r.body.verdict, "주의");
    assert.deepEqual(r.body.registeredAllergens, ["밀"]);
    assert.deepEqual(r.body.allergenAlert, ["밀"]); // 밀가루 → 밀 (부분 일치)
  } finally {
    await server.close();
  }
});

test("추천: 질환이 없는 사용자는 크래시 없이 안내 메시지(userType=healthy)", async () => {
  const { server, scored } = await setup();
  try {
    const c = await login(server, "healthy@test.com");
    const r = await c.post("/recommend", { foodName: "라면" });
    assert.equal(r.status, 200);
    assert.equal(r.body.userType, "healthy");
    assert.ok(r.body.message);
    assert.equal(r.body.verdict, undefined);
    assert.equal(scored.length, 0);
  } finally {
    await server.close();
  }
});

test("추천: 나이/체중 등 프로필이 비어 있으면 422 + 누락 항목 안내", async () => {
  const { server, scored } = await setup();
  try {
    const c = await login(server, "incomplete@test.com");
    const r = await c.post("/recommend", { foodName: "라면" });
    assert.equal(r.status, 422);
    assert.equal(r.body.code, "PROFILE_INCOMPLETE");
    assert.deepEqual(r.body.missing, ["나이", "성별", "몸무게", "키"]);
    assert.equal(scored.length, 0);
  } finally {
    await server.close();
  }
});

test("추천: 음식이 없으면 404, foodName 누락/비문자열은 400", async () => {
  const { server } = await setup({ scoreForDiseaseUser: async () => null });
  try {
    const c = await login(server, "user1@test.com");
    assert.equal((await c.post("/recommend", { foodName: "없는음식" })).status, 404);
    assert.equal((await c.post("/recommend", {})).status, 400);
    assert.equal((await c.post("/recommend", { foodName: { a: 1 } })).status, 400);
    assert.equal((await c.post("/recommend", { foodName: "x".repeat(300) })).status, 400);
  } finally {
    await server.close();
  }
});

test("추천: 지원하지 않는 질환만 있으면 userType=unsupported", async () => {
  const { server } = await setup({
    scoreForDiseaseUser: async () => ({ unsupported: true, unsupportedDiseases: ["갑상선"] }),
  });
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.post("/recommend", { foodName: "라면" });
    assert.equal(r.status, 200);
    assert.equal(r.body.userType, "unsupported");
    assert.match(r.body.message, /갑상선/);
  } finally {
    await server.close();
  }
});

test("추천: ML 서비스 장애는 서버 크래시 없이 503, 세션은 반드시 닫힌다", async () => {
  const { server, neo } = await setup({
    scoreForDiseaseUser: async () => {
      throw new MlServiceError("연결 실패");
    },
  });
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.post("/recommend", { foodName: "라면" });
    assert.equal(r.status, 503);
    assert.equal(neo.sessions.opened, neo.sessions.closed);
    // 서버가 살아 있는지 확인
    assert.equal((await c.get("/auth/me")).status, 200);
  } finally {
    await server.close();
  }
});

test("추천: 예기치 않은 오류에서 내부 오류 메시지를 노출하지 않는다", async () => {
  const { server } = await setup({
    scoreForDiseaseUser: async () => {
      throw new Error("SECRET internal stack info");
    },
  });
  try {
    const c = await login(server, "user1@test.com");
    const r = await c.post("/recommend", { foodName: "라면" });
    assert.equal(r.status, 500);
    assert.equal(JSON.stringify(r.body).includes("SECRET"), false);
  } finally {
    await server.close();
  }
});

test("잘못된 JSON body 는 400 JSON 응답", async () => {
  const { server } = await setup();
  try {
    const res = await fetch(`${server.baseUrl}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{not json",
    });
    assert.equal(res.status, 400);
    const body = await res.json();
    assert.ok(body.message);
  } finally {
    await server.close();
  }
});

// ── 요청 제한 ───────────────────────────────────────────────────

test("로그인 시도가 반복되면 429 로 제한한다", async () => {
  const db = createFakeDb(seedUsers());
  const neo = createFakeNeo4j();
  const { createApp } = require("../app");
  const app = createApp({ db, getSession: neo.getSession, enableRateLimit: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/auth/login`;
    let last;
    for (let i = 0; i < 25; i++) {
      last = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "user1@test.com", password: "wrong-password" }),
      });
    }
    assert.equal(last.status, 429);
    assert.ok(last.headers.get("retry-after"));
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});
