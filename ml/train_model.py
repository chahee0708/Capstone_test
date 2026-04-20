"""
당뇨 적합성 분류 모델 학습 스크립트
- 입력: 11개 영양소
- 출력: GI Category (0=Low, 1=Medium, 2=High)
- 모델: RandomForest (November16 Prediction 노트북 기반)
"""

import pandas as pd
import numpy as np
import pickle
from pathlib import Path

from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, cross_val_score, KFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report, confusion_matrix

# ============================================================
# 1. 데이터 로드
# ============================================================
print("[1/6] 데이터 로드 중...")

nut = pd.read_csv("eurisko/Nutrition Dataset (1).csv", encoding='latin-1')
gi = pd.read_excel("eurisko/glycemicindex.xlsx")

# ============================================================
# 2. 컬럼명 통일 + 영양소 매핑
# ============================================================
print("[2/6] 컬럼 매핑 중...")

# Nutrition Dataset 컬럼명 → November16 포맷으로 변환
nut_renamed = nut.rename(columns={
    'Protein(g)':                                    'Protein (g)',
    'Totalfat(g)':                                   'Fats (g)',
    'Availablecarbohydrateswithoutsugaralcohol(g)':  'Carbs (g)',
    'Dietaryfibre(g)':                               'Fiber (g)',
    'Totalsugars(g)':                                'Sugar (g)',
    'Phosphorus(P)(mg)':                             'Phosphorus (mg)',
    'Potassium(K)(mg)':                              'Potassium (mg)',
    'Sodium(Na)(mg)':                                'Sodium (mg)',
    'Totalsaturatedfat(g)':                          'Saturated Fat (g)',
})

# kJ → kcal 변환 (1 kcal = 4.184 kJ)
nut_renamed['Calories (kcal)'] = nut_renamed['Energywithdietaryfibre(kJ)'] / 4.184

# Trans Fat: mg → g 변환
nut_renamed['Trans Fat (g)'] = nut_renamed['Totaltransfattyacids(mg)'] / 1000

# ============================================================
# 3. GI 데이터 병합 (Nutrition 자체 GI + GI Dataset 매칭)
# ============================================================
print("[3/6] GI 데이터 병합 중...")

# 자체 GI (58개)
nut_renamed['GI'] = nut_renamed['GyclemicIndex']

# GI Dataset에서 FoodName 매칭으로 GI 보강
nut_renamed['food_lower'] = nut_renamed['FoodName'].str.lower().str.strip()
gi['food_lower'] = gi['FOOD'].str.lower().str.strip()

matched_count = 0
for _, gi_row in gi.iterrows():
    key = gi_row['food_lower'].split(',')[0].strip()
    gi_value = gi_row['Glycemic index (glucose = 100)']
    
    # 매칭되는 첫 번째 행에만 GI 값 부여 (자체 GI 없는 경우)
    mask = nut_renamed['food_lower'].str.contains(key, na=False, regex=False) & nut_renamed['GI'].isna()
    if mask.any():
        first_idx = nut_renamed[mask].index[0]
        nut_renamed.loc[first_idx, 'GI'] = gi_value
        matched_count += 1

print(f"  - Nutrition 자체 GI: 58개")
print(f"  - GI Dataset 매칭 보강: {matched_count}개")

# GI 값이 있는 행만 선택
data = nut_renamed[nut_renamed['GI'].notna()].copy()
print(f"  - 최종 학습 데이터: {len(data)}개")

# ============================================================
# 4. GI Category 라벨링 + 피처 준비
# ============================================================
print("[4/6] 전처리 중...")

# GI → Low(0) / Medium(1) / High(2)
def gi_to_category(gi_value):
    if gi_value <= 55:
        return 0  # Low
    elif gi_value <= 69:
        return 1  # Medium
    else:
        return 2  # High

data['GI Category'] = data['GI'].apply(gi_to_category)

# 11개 피처 컬럼
feature_cols = [
    'Calories (kcal)', 'Protein (g)', 'Fats (g)', 'Carbs (g)',
    'Fiber (g)', 'Sugar (g)', 'Phosphorus (mg)', 'Potassium (mg)',
    'Sodium (mg)', 'Saturated Fat (g)', 'Trans Fat (g)'
]

# 결측치는 0으로 대체 (원본 논문 방식)
X_raw = data[feature_cols].fillna(0)
Y = data['GI Category']

print(f"  - 피처 수: {len(feature_cols)}")
print(f"  - GI 카테고리 분포:")
print(f"    Low(0):    {(Y==0).sum()}개")
print(f"    Medium(1): {(Y==1).sum()}개")
print(f"    High(2):   {(Y==2).sum()}개")

# 스케일링
scaler = StandardScaler()
X = scaler.fit_transform(X_raw)

# ============================================================
# 5. 학습 + 평가
# ============================================================
print("[5/6] 모델 학습 중...")

# 원본 November16의 최종 하이퍼파라미터
model = RandomForestClassifier(
    n_estimators=100,
    max_depth=29,
    max_features=4,
    random_state=42
)

# Train/Test 분할
X_train, X_test, Y_train, Y_test = train_test_split(
    X, Y, test_size=0.2, stratify=Y, random_state=42
)

model.fit(X_train, Y_train)

# 성능
train_acc = accuracy_score(Y_train, model.predict(X_train))
test_acc = accuracy_score(Y_test, model.predict(X_test))

print(f"\n  - Train 정확도: {train_acc:.3f}")
print(f"  - Test 정확도:  {test_acc:.3f}")

# K-Fold 교차검증
print(f"\n  [10-Fold 교차검증]")
cv_scores = cross_val_score(model, X, Y, cv=KFold(n_splits=10, shuffle=True, random_state=42))
print(f"  - 평균 정확도: {cv_scores.mean():.3f} (±{cv_scores.std():.3f})")

# 상세 리포트
print(f"\n  [Test 상세 리포트]")
print(classification_report(Y_test, model.predict(X_test),
                            target_names=['Low', 'Medium', 'High'],
                            zero_division=0))

# ============================================================
# 6. 모델 저장
# ============================================================
print("[6/6] 모델 저장 중...")

Path("output").mkdir(exist_ok=True)

with open("output/diabetes_model.pkl", "wb") as f:
    pickle.dump({
        'model': model,
        'scaler': scaler,
        'feature_cols': feature_cols,
    }, f)

print("\n" + "=" * 60)
print("완료!")
print("=" * 60)
print(f"모델 저장: output/diabetes_model.pkl")
print(f"백엔드에서 이 파일을 로드해서 예측할 수 있습니다.")