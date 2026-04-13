// 사용자 알레르기 목록 VS Neo4j Ingredient 비교

async function checkAllergens(session, foodName, userAllergens) {
  if (!userAllergens || userAllergens.length === 0) return [];

  const result = await session.run(
    `MATCH (f:Food {name: $foodName})-[:HAS_INGREDIENT]->(i:Ingredient)
     WHERE i.name IN $allergens
     RETURN i.name AS allergen`,
    { foodName, allergens: userAllergens }
  );

  return result.records.map((r) => r.get("allergen"));
}

module.exports = { checkAllergens };
