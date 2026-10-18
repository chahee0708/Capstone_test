/**
 * similarity.test.js
 *
 * 역할: services/similarity.js 가 분석용 Python 구현과 같은 값을 내는지 확인하는 테스트 스크립트.
 *       원재료 목록은 Neo4j 에서 실제로 읽는다 (HAS_INGREDIENT order 오름차순).
 *       백엔드에 테스트 도구가 없어서 node 로 바로 실행하는 스크립트로 만들었다.
 *
 * 실행 (backend 폴더에서, Neo4j 가 떠 있어야 함):
 *   node tests/similarity.test.js
 *   - 연결 정보: NEO4J_URI(기본 bolt://localhost:7687), NEO4J_USER(기본 neo4j), NEO4J_PASSWORD(기본 password123)
 *   - 하나라도 틀리면 종료 코드 1
 *
 * 이번에 바뀐 점: 새 파일
 *
 * 호출: 개발자가 직접 실행
 */

const neo4j = require("neo4j-driver");
const { similarity, sharedIngredients } = require("../services/similarity");

// 기대값: 소수 둘째 자리 반올림 기준
const CASES = [
  ["꼬깔콘 고소한맛", "꼬깔콘 매콤달콤한맛", 0.88],
  ["빙그레 딸기맛우유", "슈퍼제로 락토프리 우유", 0.44],
  ["스키피 땅콩버터 노슈거에디드 청크", "오뚜기 땅콩버터 크런치", 0.75],
];

const round2 = (n) => Math.round(n * 100) / 100;

/** 음식 이름 → 원재료 이름 배열 (order 오름차순). 대체음식 후보 데이터(alt_candidate) 기준 */
async function getIngredients(session, name) {
  const res = await session.run(
    `MATCH (f:Food {name: $name})-[r:HAS_INGREDIENT]->(i:Ingredient)
     WHERE f.alt_candidate = true
     WITH f, r, i ORDER BY r.order
     RETURN f.report_no AS reportNo, collect(i.name) AS ingredients
     LIMIT 1`,
    { name },
  );
  if (res.records.length === 0) throw new Error(`원재료를 찾을 수 없음: ${name}`);
  return res.records[0].get("ingredients");
}

async function main() {
  const driver = neo4j.driver(
    process.env.NEO4J_URI || "bolt://localhost:7687",
    neo4j.auth.basic(process.env.NEO4J_USER || "neo4j", process.env.NEO4J_PASSWORD || "password123"),
  );
  const session = driver.session();
  let failed = 0;
  try {
    for (const [nameA, nameB, expected] of CASES) {
      // 1. Neo4j 에서 두 음식의 원재료 읽기
      const a = await getIngredients(session, nameA);
      const b = await getIngredients(session, nameB);
      // 2. 유사도 계산 후 소수 둘째 자리로 비교
      const raw = similarity(a, b);
      const ok = round2(raw) === expected;
      if (!ok) failed++;
      console.log(
        `${ok ? "PASS" : "FAIL"}  ${nameA} vs ${nameB}: ${round2(raw)} (기대 ${expected}, 원값 ${raw.toFixed(4)})`,
      );
      console.log(`      겹친 원재료(앞 5개): ${sharedIngredients(a, b).slice(0, 5).join(", ")}`);
    }
  } finally {
    await session.close();
    await driver.close();
  }
  console.log(failed === 0 ? "\n전체 통과" : `\n실패 ${failed}건`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
