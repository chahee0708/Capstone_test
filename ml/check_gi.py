import pandas as pd

nut = pd.read_csv("eurisko/Nutrition Dataset (1).csv", encoding='latin-1')

print("=" * 60)
print("GI 컬럼 유효성 체크")
print("=" * 60)

# GI 컬럼 2개 확인
for col in ['GyclemicIndex', 'GlycemicIndex']:
    total = len(nut)
    not_null = nut[col].notna().sum()
    print(f"\n[{col}]")
    print(f"  전체: {total}, 값 있음: {not_null}, 비율: {not_null/total*100:.1f}%")
    if not_null > 0:
        print(f"  최소값: {nut[col].min()}, 최대값: {nut[col].max()}")
        print(f"  샘플 5개: {nut[col].dropna().head(5).tolist()}")

# GI가 있는 행 몇 개인지 (둘 중 하나라도 있으면 OK)
has_gi = nut['GyclemicIndex'].notna() | nut['GlycemicIndex'].notna()
print(f"\n=== 둘 중 하나라도 GI가 있는 행: {has_gi.sum()}개 ===")

# GI 값이 있는 행의 FoodName 샘플
if has_gi.sum() > 0:
    print("\nGI 있는 음식 샘플 5개:")
    print(nut.loc[has_gi, ['FoodName', 'GyclemicIndex', 'GlycemicIndex']].head(5))