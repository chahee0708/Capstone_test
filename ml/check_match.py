import pandas as pd

nut = pd.read_csv("eurisko/Nutrition Dataset (1).csv", encoding='latin-1')
gi = pd.read_excel("eurisko/glycemicindex.xlsx")

# 매칭을 위해 소문자화
nut['food_lower'] = nut['FoodName'].str.lower().str.strip()
gi['food_lower'] = gi['FOOD'].str.lower().str.strip()

matched = []
not_matched = []

for _, gi_row in gi.iterrows():
    gi_food = gi_row['food_lower']
    # "Banana cake, made with sugar" -> "banana cake" (쉼표 앞부분)
    key = gi_food.split(',')[0].strip()
    
    # Nutrition Dataset에서 이 키워드를 포함하는 음식 찾기
    found = nut[nut['food_lower'].str.contains(key, na=False, regex=False)]
    
    if len(found) > 0:
        matched.append({
            'gi_food': gi_row['FOOD'],
            'gi_value': gi_row['Glycemic index (glucose = 100)'],
            'nut_match': found.iloc[0]['FoodName'],
            'matches': len(found)
        })
    else:
        not_matched.append(gi_row['FOOD'])

print("=" * 60)
print(f"매칭 성공: {len(matched)}/{len(gi)}개")
print(f"매칭 실패: {len(not_matched)}개")
print("=" * 60)

print("\n[매칭 성공 샘플 10개]")
for m in matched[:10]:
    print(f"  GI={m['gi_value']:3} | {m['gi_food'][:40]:40} → {m['nut_match'][:50]}")

print("\n[매칭 실패 샘플 10개]")
for n in not_matched[:10]:
    print(f"  {n}")

# 중복 고려한 최종 예상 학습 데이터 크기
existing_gi_count = nut['GyclemicIndex'].notna().sum()
total_estimate = existing_gi_count + len(matched)
print(f"\n=== 최종 예상 학습 데이터: 약 {total_estimate}개 ===")
print(f"  (Nutrition 자체 GI: {existing_gi_count}개 + 매칭: {len(matched)}개, 중복 일부 있음)")