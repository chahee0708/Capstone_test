/**
 * 테스트 공용 헬퍼: 메모리 DB(users 테이블 에뮬레이터) + 가짜 Neo4j 세션 + HTTP 클라이언트
 */

const { createApp } = require("../app");

/**
 * routes 가 사용하는 SQL 패턴만 지원하는 users 테이블 에뮬레이터
 */
function createFakeDb(initialUsers = []) {
  const users = initialUsers.map((u) => ({ ...u }));
  let nextId = users.reduce((m, u) => Math.max(m, u.id), 0) + 1;
  const calls = [];

  const baseRow = {
    name: null,
    email: null,
    password: null,
    age: null,
    weight: null,
    height: null,
    gender: null,
    diseases: "[]",
    allergens: "[]",
    hypertension_stage: 1,
    ldl_value: null,
    tg_value: null,
    hdl_value: null,
    gfr_value: 35,
  };

  async function execute(sql, params = []) {
    const q = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: q, params });

    if (/^SELECT .* FROM users WHERE email = \?$/.test(q)) {
      return [users.filter((u) => u.email === params[0]).map((u) => ({ ...u }))];
    }
    if (/^SELECT .* FROM users WHERE id = \?$/.test(q)) {
      return [users.filter((u) => u.id === Number(params[0])).map((u) => ({ ...u }))];
    }
    if (/^INSERT INTO users/.test(q)) {
      const cols = q.match(/\(([^)]+)\) VALUES/)[1].split(",").map((c) => c.trim());
      const row = { ...baseRow, id: nextId++ };
      cols.forEach((c, i) => {
        row[c] = params[i];
      });
      if (users.some((u) => u.email === row.email)) {
        const err = new Error("Duplicate entry");
        err.code = "ER_DUP_ENTRY";
        throw err;
      }
      users.push(row);
      return [{ insertId: row.id, affectedRows: 1 }];
    }
    if (/^UPDATE users SET .* WHERE id = \?$/.test(q)) {
      const setPart = q.match(/^UPDATE users SET (.*) WHERE id = \?$/)[1];
      const cols = setPart.split(",").map((s) => s.split("=")[0].trim());
      const id = Number(params[params.length - 1]);
      const user = users.find((u) => u.id === id);
      if (!user) return [{ affectedRows: 0 }];
      cols.forEach((c, i) => {
        user[c] = params[i];
      });
      return [{ affectedRows: 1 }];
    }
    throw new Error(`FakeDb: 지원하지 않는 SQL: ${q}`);
  }

  return { execute, users, calls };
}

const DEFAULT_NUTRITION = {
  sugar: 1, sodium: 2, saturatedFat: 3, protein: 4, calories: 5, carbohydrate: 6,
  fat: 7, transFat: 0, cholesterol: 8, fiber: 1, potassium: 0, phosphorus: 0,
};

/**
 * 가짜 Neo4j 세션: foodService 가 실행하는 쿼리 3종(조회/원재료/검색)만 지원한다.
 * foods: [{ name, manufacturer?, reportNo?, nutrition?, ingredients? }]
 */
function createFakeNeo4j({ foods = [], ingredients } = {}) {
  const sessions = { opened: 0, closed: 0, queries: [] };

  // 하위 호환: ingredients 만 넘기면 "라면" 한 건을 만든다
  const catalog = foods.length
    ? foods
    : [{ name: "라면", manufacturer: "테스트식품", reportNo: "R-1", ingredients: ingredients || [] }];

  const findFood = (query, key) => {
    if (/product_report_no: \$key/.test(query)) return catalog.find((f) => f.reportNo === key);
    return catalog.find((f) => f.name === key);
  };

  function getSession() {
    sessions.opened += 1;
    return {
      async run(query, params) {
        sessions.queries.push({ query, params });
        const q = query.replace(/\s+/g, " ");

        if (/HAS_INGREDIENT/.test(q)) {
          const f = findFood(q, params.key);
          return { records: (f?.ingredients || []).map((name) => ({ get: () => name })) };
        }
        if (/CONTAINS \$q/.test(q)) {
          const hits = catalog.filter((f) => f.name.includes(params.q));
          return {
            records: hits.map((f) => ({
              get: (k) => ({ name: f.name, manufacturer: f.manufacturer ?? null, reportNo: f.reportNo ?? null }[k]),
            })),
          };
        }
        if (/f\.sugar AS sugar/.test(q)) {
          const f = findFood(q, params.key);
          if (!f) return { records: [] };
          const n = { ...DEFAULT_NUTRITION, ...(f.nutrition || {}) };
          const row = { name: f.name, manufacturer: f.manufacturer ?? null, reportNo: f.reportNo ?? null, ...n };
          return { records: [{ get: (k) => row[k] }] };
        }
        throw new Error(`FakeNeo4j: 지원하지 않는 쿼리: ${q.slice(0, 80)}`);
      },
      async close() {
        sessions.closed += 1;
      },
    };
  }
  return { getSession, sessions };
}

/**
 * 가짜 ML 클라이언트 (바코드/OCR). 각 메서드는 호출 기록을 남기고 설정된 응답을 돌려준다.
 */
function createFakeMlClient(overrides = {}) {
  const calls = [];
  const base = {
    async barcodeLookup(code) {
      return { status: "not_found", code };
    },
    async barcodeDecode() {
      return { status: "decode_failed" };
    },
    async ocrLabel() {
      return { status: "partial", nutrition: {}, ingredients: "" };
    },
    async ocrCheckup() {
      return { status: "partial", profile: {} };
    },
  };
  const client = { calls };
  // 오버라이드 여부와 관계없이 모든 호출을 기록한다
  for (const name of Object.keys(base)) {
    const impl = overrides[name] || base[name];
    client[name] = async (...args) => {
      const first = args[0];
      calls.push([
        name,
        Array.isArray(first) ? first.length : first && first.originalname !== undefined ? first.originalname : first,
      ]);
      return impl(...args);
    };
  }
  return client;
}

async function startServer(deps) {
  const app = createApp({ enableRateLimit: false, ...deps });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, "127.0.0.1", () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  function client() {
    const jar = {};

    async function request(method, path, body) {
      const headers = {};
      const isForm = typeof FormData !== "undefined" && body instanceof FormData;
      if (!isForm) headers["Content-Type"] = "application/json";
      const cookie = Object.entries(jar)
        .map(([k, v]) => `${k}=${v}`)
        .join("; ");
      if (cookie) headers.Cookie = cookie;

      const res = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : isForm ? body : JSON.stringify(body),
      });

      const setCookies =
        typeof res.headers.getSetCookie === "function"
          ? res.headers.getSetCookie()
          : [res.headers.get("set-cookie")].filter(Boolean);
      for (const sc of setCookies) {
        const [pair] = sc.split(";");
        const idx = pair.indexOf("=");
        const name = pair.slice(0, idx);
        const value = pair.slice(idx + 1);
        const expired = /expires=Thu, 01 Jan 1970/i.test(sc) || value === "";
        if (expired) delete jar[name];
        else jar[name] = value;
      }

      let json = null;
      try {
        json = await res.json();
      } catch {
        /* 본문 없음 */
      }
      return { status: res.status, body: json, headers: res.headers, setCookies };
    }

    return {
      jar,
      get: (p) => request("GET", p),
      post: (p, b) => request("POST", p, b ?? {}),
      postForm: (p, form) => request("POST", p, form),
      put: (p, b) => request("PUT", p, b ?? {}),
    };
  }

  return {
    baseUrl,
    client,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

module.exports = { createFakeDb, createFakeNeo4j, createFakeMlClient, startServer };
