import pandas as pd
import numpy as np
import pickle
from pathlib import Path

from sklearn.preprocessing import StandardScaler
from sklearn.model_selection import train_test_split, GridSearchCV, StratifiedKFold
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, classification_report

# ============================================================
# 1. 데이터 로드 (기존 103개)
# ============================================================
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
print(f"학습 데이터: {len(data)}개")

# ============================================================
# 2. 라벨링 + 피처 준비
# ============================================================
def gi_to_category(v):
    if v <= 55: return 0
    elif v <= 69: return 1
    else: return 2

data['GI Category'] = data['GI'].apply(gi_to_category)
Y = data['GI Category']
print(f"클래스 분포: Low={sum(Y==0)}, Medium={sum(Y==1)}, High={sum(Y==2)}")

feature_cols = [
    'Calories (kcal)', 'Protein (g)', 'Fats (g)', 'Carbs (g)',
    'Fiber (g)', 'Sugar (g)', 'Phosphorus (mg)', 'Potassium (mg)',
    'Sodium (mg)', 'Saturated Fat (g)', 'Trans Fat (g)'
]

X_raw = data[feature_cols].fillna(0)
scaler = StandardScaler()
X = scaler.fit_transform(X_raw)

# ============================================================
# 3. test set 먼저 분리 (절대 튜닝에 사용 안 함)
# ============================================================
X_train, X_test, Y_train, Y_test = train_test_split(
    X, Y, test_size=0.2, stratify=Y, random_state=42
)
print(f"train: {len(X_train)}개 / test: {len(X_test)}개")

# ============================================================
# 4. GridSearchCV + K-fold (train set 안에서만)
# ============================================================
print("\n하이퍼파라미터 튜닝 중...")

param_grid = {
    'n_estimators':     [100, 200, 300],
    'max_depth':        [5, 10, 15, None],
    'min_samples_leaf': [1, 2, 4],
    'max_features':     ['sqrt', 4, 6],
    'class_weight':     ['balanced', None],
}

cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=42)
grid = GridSearchCV(
    RandomForestClassifier(random_state=42),
    param_grid,
    cv=cv,
    scoring='f1_macro',
    n_jobs=-1,
    verbose=1
)
grid.fit(X_train, Y_train)

print(f"\n최적 파라미터: {grid.best_params_}")
print(f"CV f1_macro: {grid.best_score_:.3f}")

# ============================================================
# 5. 최적 파라미터로 train 재학습 → test 평가
# ============================================================
best_model = RandomForestClassifier(**grid.best_params_, random_state=42)
best_model.fit(X_train, Y_train)

test_acc = accuracy_score(Y_test, best_model.predict(X_test))
print(f"\n최종 test 정확도: {test_acc:.3f}")
print(classification_report(Y_test, best_model.predict(X_test),
                            target_names=['Low', 'Medium', 'High'],
                            zero_division=0))

# ============================================================
# 6. 저장
# ============================================================
Path("output").mkdir(exist_ok=True)
with open("output/diabetes_model.pkl", "wb") as f:
    pickle.dump({
        'model': best_model,
        'scaler': scaler,
        'feature_cols': feature_cols,
        'best_params': grid.best_params_,
        'test_accuracy': test_acc,
    }, f)

print("\n완료! output/diabetes_model.pkl 저장됨")