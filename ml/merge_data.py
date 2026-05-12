import pandas as pd

# ============================================================
# 1. 기존 Nutrition Dataset에서 GI 있는 것만 추출
# ============================================================
nut = pd.read_csv("eurisko/Nutrition Dataset (1).csv", encoding='latin-1')
gi = pd.read_excel("eurisko/glycemicindex.xlsx")

# 컬럼명을 new_data.csv 형식으로 통일
nut_renamed = nut.rename(columns={
    'FoodName':                                      'Food Name',
    'GyclemicIndex':                                 'GI Value',
    'Protein(g)':                                    'protein_g',
    'Totalfat(g)':                                   'fat_g',
    'Availablecarbohydrateswithoutsugaralcohol(g)':  'carbohydrate_g',
    'Dietaryfibre(g)':                               'fiber_g',
    'Totalsugars(g)':                                'sugar_g',
    'Phosphorus(P)(mg)':                             'phosphorus_mg',
    'Potassium(K)(mg)':                              'potassium_mg',
    'Sodium(Na)(mg)':                                'sodium_mg',
    'Totalsaturatedfat(g)':                          'saturated_fat_g',
})
nut_renamed['energy_kcal'] = nut_renamed['Energywithdietaryfibre(kJ)'] / 4.184
nut_renamed['trans_fat_g'] = nut_renamed['Totaltransfattyacids(mg)'] / 1000

# glycemicindex.xlsx로 GI 보강
nut_renamed['food_lower'] = nut_renamed['Food Name'].str.lower().str.strip()
gi['food_lower'] = gi['FOOD'].str.lower().str.strip()

for _, gi_row in gi.iterrows():
    key = gi_row['food_lower'].split(',')[0].strip()
    gi_value = gi_row['Glycemic index (glucose = 100)']
    mask = nut_renamed['food_lower'].str.contains(key, na=False, regex=False) & nut_renamed['GI Value'].isna()
    if mask.any():
        nut_renamed.loc[nut_renamed[mask].index[0], 'GI Value'] = gi_value

# GI 있는 것만 추출 + 필요한 컬럼만 선택
feature_cols = ['Food Name', 'GI Value', 'energy_kcal', 'protein_g', 'fat_g',
                'carbohydrate_g', 'fiber_g', 'sugar_g', 'phosphorus_mg',
                'potassium_mg', 'sodium_mg', 'saturated_fat_g', 'trans_fat_g']

nut_filtered = nut_renamed[nut_renamed['GI Value'].notna()][feature_cols]
print(f"기존 데이터 (GI 있는 것): {len(nut_filtered)}개")

# ============================================================
# 2. new_data.csv 로드 + 컬럼 맞추기
# ============================================================
new_data = pd.read_csv("eurisko/new_data.csv")
new_data = new_data[new_data['GI Value'].notna()][feature_cols]
print(f"신규 데이터 (GI 있는 것): {len(new_data)}개")

# ============================================================
# 3. 합치고 중복 제거
# ============================================================
combined = pd.concat([nut_filtered, new_data], ignore_index=True)
before = len(combined)
combined = combined.drop_duplicates(subset=['Food Name'])
after = len(combined)

# ↓ 여기 추가
nutrient_cols = ['energy_kcal', 'fat_g', 'carbohydrate_g', 'protein_g']
combined = combined.drop_duplicates(subset=nutrient_cols, keep='first')
print(f"영양소 중복 제거 후: {len(combined)}개")

print(f"병합 후 중복 제거: {before}개 → {after}개 ({before - after}개 제거)")
combined.to_csv("eurisko/combined_data.csv", index=False, encoding='utf-8-sig')
print(f"저장 완료: eurisko/combined_data.csv")