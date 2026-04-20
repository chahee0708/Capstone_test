"""
하이퍼파라미터 튜닝 스크립트
- GridSearchCV로 최적 조합 자동 탐색
- class_weight='balanced'로 클래스 불균형 해결
- 최종 모델 저장
"""

import pandas as pd
import numpy as np
import pickle
from pathlib import Path

from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, GridSearchCV, StratifiedKFold, cross_val_score
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

# ============================================================
# 1. 데이터 준비 (train_model.py와 동일)
# ============================================================
print("[1/5] 데이터 로드 및 전처리...")

nut = pd.read_csv("eurisko/Nutrition Dataset (1).csv", encoding='latin-1')
gi = pd.read_excel("eurisko/glycemicindex.xlsx")

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
nut_renamed['Calories (kcal)'] = nut_renamed['Energywithdietaryfibre(kJ)'] / 4.184
nut_renamed['Trans Fat (g)'] = nut_renamed['Totaltransfattyacids(mg)'] / 1000

# GI 병합
nut_renamed['GI'] = nut_renamed['GyclemicIndex']
nut_renamed['food_lower'] = nut_renamed['FoodName'].str.lower().str.strip()
gi['food_lower'] = gi['FOOD'].str.lower().str.strip()

for _, gi_row in gi.iterrows():
    key = gi_row['food_lower'].split(',')[0].strip()
    gi_value = gi_row['Glycemic index (glucose = 100)']
    mask = nut_renamed['food_lower'].str.contains(key, na=False, regex=False) & nut_renamed['GI'].isna()
    if mask.any():
        nut_renamed.loc[nut_renamed[mask].index[0], 'GI'] = gi_value

data = nut_renamed[nut_renamed['GI'].notna()].copy()

def gi_to_category(v):
    if v <= 55: return 0
    elif v <= 69: return 1
    else: return 2
data['GI Category'] = data['GI'].apply(gi_to_category)

feature_cols = [
    'Calories (kcal)', 'Protein (g)', 'Fats (g)', 'Carbs (g)',
    'Fiber (g)', 'Sugar (g)', 'Phosphorus (mg)', 'Potassium (mg)',
    'Sodium (mg)', 'Saturated Fat (g)', 'Trans Fat (g)'
]

X_raw = data[feature_cols].fillna(0)
Y = data['GI Category']

scaler = StandardScaler()
X = scaler.fit_transform(X_raw)

print(f"  데이터: {len(data)}개 / 피처: {len(feature_cols)}개")
print(f"  클래스 분포: Low={sum(Y==0)}, Medium={sum(Y==1)}, High={sum(Y==2)}")

# ============================================================
# 2. Train/Test 분할 (튜닝용과 최종 평가용 분리)
# ============================================================
X_train, X_test, Y_train, Y_test = train_test_split(
    X, Y, test_size=0.2, stratify=Y, random_state=42
)

# ============================================================
# 3. GridSearchCV로 최적 하이퍼파라미터 탐색
# ============================================================
print("\n[2/5] 하이퍼파라미터 탐색 중... (1~2분 소요)")

param_grid = {
    'n_estimators':      [50, 100, 200],
    'max_depth':         [3, 5, 7, 10, 15, None],
    'min_samples_leaf':  [1, 2, 4],
    'max_features':      ['sqrt', 4, 6],
    'class_weight':      ['balanced', None],
}

base_model = RandomForestClassifier(random_state=42)

# 5-fold로 (104개 작은 데이터에 10-fold는 과함)
cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)

grid = GridSearchCV(
    base_model,
    param_grid,
    cv=cv,
    scoring='f1_macro',  # 불균형 데이터라 f1_macro가 accuracy보다 적절
    n_jobs=-1,
    verbose=1
)

grid.fit(X_train, Y_train)

print(f"\n  [최적 파라미터]")
for k, v in grid.best_params_.items():
    print(f"    {k}: {v}")
print(f"  [CV f1_macro]: {grid.best_score_:.3f}")

# ============================================================
# 4. 최적 모델로 Test 세트 평가
# ============================================================
print("\n[3/5] 최적 모델 평가...")

best_model = grid.best_estimator_

train_acc = accuracy_score(Y_train, best_model.predict(X_train))
test_acc = accuracy_score(Y_test, best_model.predict(X_test))

print(f"  Train 정확도: {train_acc:.3f}")
print(f"  Test 정확도:  {test_acc:.3f}")

# 전체 데이터 10-fold로 안정성 재확인
cv10_acc = cross_val_score(best_model, X, Y, cv=StratifiedKFold(n_splits=10, shuffle=True, random_state=42))
cv10_f1 = cross_val_score(best_model, X, Y, cv=StratifiedKFold(n_splits=10, shuffle=True, random_state=42), scoring='f1_macro')
print(f"\n  [10-Fold 교차검증]")
print(f"  정확도: {cv10_acc.mean():.3f} (±{cv10_acc.std():.3f})")
print(f"  F1 macro: {cv10_f1.mean():.3f} (±{cv10_f1.std():.3f})")

print(f"\n  [Test 상세 리포트]")
print(classification_report(Y_test, best_model.predict(X_test),
                            target_names=['Low', 'Medium', 'High'],
                            zero_division=0))

# ============================================================
# 5. 전체 데이터로 재학습 후 최종 저장
# ============================================================
print("[4/5] 전체 데이터로 최종 모델 재학습...")

# Test까지 포함 전체 데이터로 재학습 (배포용)
final_model = RandomForestClassifier(**grid.best_params_, random_state=42)
final_model.fit(X, Y)

print("[5/5] 모델 저장...")
Path("output").mkdir(exist_ok=True)

with open("output/diabetes_model.pkl", "wb") as f:
    pickle.dump({
        'model': final_model,
        'scaler': scaler,
        'feature_cols': feature_cols,
        'best_params': grid.best_params_,
        'test_accuracy': test_acc,
        'cv10_accuracy': cv10_acc.mean(),
        'cv10_f1_macro': cv10_f1.mean(),
    }, f)

print(f"\n{'=' * 60}")
print(f"완료! output/diabetes_model.pkl 저장됨")
print(f"{'=' * 60}")